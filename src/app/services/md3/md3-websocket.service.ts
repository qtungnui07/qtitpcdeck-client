import {Injectable} from '@angular/core';
import {BehaviorSubject, Observable} from 'rxjs';
import {HostHttpService} from "../host-http/host-http.service";
import {Md3AuthSessionService} from "./md3-auth-session.service";
import {Connection} from "../../datatypes/connection";
import {
  Md3Envelope,
  Md3TicketResponse,
  md3UiProtocolVersion,
  md3UiSocketPath,
  md3UiSubProtocol,
  md3UiTicketPath
} from "../../datatypes/md3/md3-protocol";

const ticketTimeoutMs = 10000;
const reconnectDelayMs = 2000;
const maxPendingRequests = 256;
// The host closes a socket that has been silent for longer than this, so the client keeps its own
// bound slightly tighter and reconnects rather than waiting to be dropped.
const staleAfterMs = 60000;

export type Md3ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

@Injectable({
  providedIn: 'root'
})
export class Md3WebSocketService {

  public readonly state = new BehaviorSubject<Md3ConnectionState>("disconnected");

  private socket: WebSocket | null = null;
  private wanted = false;
  private attempt = 0;
  private retryTimer: any = null;
  private staleTimer: any = null;
  private sequence = 0;
  private baseUrl: string | null = null;
  private connection: Connection | null = null;
  private clientId: string | null = null;
  private features: string[] = [];

  private readonly pending = new Map<string, PendingRequest>();
  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();
  private readonly anyHandlers = new Set<(type: string, payload: unknown) => void>();

  constructor(private hostHttp: HostHttpService, private auth: Md3AuthSessionService) {
  }

  public connect(baseUrl: string, connection: Connection, clientId: string, features: string[] = []): void {
    this.baseUrl = baseUrl;
    this.connection = connection;
    this.clientId = clientId;
    this.features = features;
    this.wanted = true;
    if (this.socket !== null || this.state.value === "connecting") {
      return;
    }
    this.state.next(this.state.value === "disconnected" ? "connecting" : "reconnecting");
    void this.establish(++this.attempt);
  }

  public disconnect(): void {
    this.wanted = false;
    this.clearRetry();
    const closing = this.socket;
    this.socket = null;
    if (closing !== null) {
      try {
        closing.send(JSON.stringify({protocolVersion: md3UiProtocolVersion, kind: "goodbye"}));
      } catch {
        // The socket may already be gone; closing it is all that is left to do.
      }
      closing.close();
    }
    this.settlePending(new Error("WebSocket disconnected."));
    this.state.next("disconnected");
  }

  /** Fire-and-forget notification. */
  public send(type: string, payload?: unknown): void {
    this.write({protocolVersion: md3UiProtocolVersion, kind: "message", type: type, payload: payload});
  }

  /** Correlated request; rejects on an error envelope, a disconnect, or a timeout. */
  public request<T>(type: string, payload?: unknown): Promise<T> {
    const id = `${++this.sequence}-${Math.random().toString(36).substring(2, 10)}`;
    return new Promise<T>((resolve, reject) => {
      if (this.socket === null || this.socket.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket is not connected."));
        return;
      }
      if (this.pending.size >= maxPendingRequests) {
        reject(new Error("Too many pending WebSocket requests."));
        return;
      }
      this.pending.set(id, {resolve: resolve as (value: unknown) => void, reject: reject});
      try {
        this.write({protocolVersion: md3UiProtocolVersion, kind: "request", type: type, id: id, payload: payload});
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  /** Subscribe to a notification type. Returns an unsubscribe function. */
  public on(type: string, handler: (payload: unknown) => void): () => void {
    const handlers = this.handlers.get(type) ?? new Set<(payload: unknown) => void>();
    handlers.add(handler);
    this.handlers.set(type, handlers);
    return () => handlers.delete(handler);
  }

  public onAny(handler: (type: string, payload: unknown) => void): () => void {
    this.anyHandlers.add(handler);
    return () => this.anyHandlers.delete(handler);
  }

  private async establish(attempt: number): Promise<void> {
    let opening: WebSocket | null = null;
    try {
      const ticket = await this.mintTicket();
      if (!this.isCurrent(attempt)) {
        return;
      }

      const socket = new WebSocket(this.socketUrl(ticket), md3UiSubProtocol);
      opening = socket;
      this.socket = socket;

      await this.handshake(socket);
      if (!this.isCurrent(attempt)) {
        this.abandon(socket);
        return;
      }

      const registration = this.features.length > 0
        ? [this.clientId, this.features]
        : [this.clientId];
      await this.request<void>("RegisterClient", registration);
      if (!this.isCurrent(attempt)) {
        this.abandon(socket);
        return;
      }

      this.clearRetry();
      this.state.next("connected");
    } catch (error) {
      if (opening !== null && this.socket === opening) {
        this.abandon(opening);
      }
      if (!this.isCurrent(attempt)) {
        return;
      }
      this.state.next(this.wanted ? "reconnecting" : "disconnected");
      this.scheduleRetry();
    }
  }

  // Resolves once the host has answered the hello with a welcome. Everything else the socket
  // delivers is routed as usual, so a notification that races the welcome is not lost.
  private handshake(socket: WebSocket): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      };

      socket.onopen = () => {
        try {
          socket.send(JSON.stringify({protocolVersion: md3UiProtocolVersion, kind: "hello"}));
        } catch (error) {
          fail(error as Error);
        }
      };
      socket.onerror = () => fail(new Error("WebSocket connection failed."));
      socket.onclose = () => {
        this.handleClose(socket);
        fail(new Error("WebSocket closed before the handshake completed."));
      };
      socket.onmessage = event => {
        this.refreshStaleTimer();
        let envelope: Md3Envelope;
        try {
          envelope = JSON.parse(String(event.data)) as Md3Envelope;
        } catch {
          fail(new Error("The host sent a message that is not JSON."));
          socket.close();
          return;
        }
        if (envelope.protocolVersion !== md3UiProtocolVersion) {
          fail(new Error("Unsupported UI WebSocket protocol."));
          socket.close();
          return;
        }
        if (envelope.kind === "welcome") {
          settled = true;
          resolve();
          return;
        }
        this.receive(envelope);
      };
    });
  }

  private receive(envelope: Md3Envelope): void {
    if (envelope.kind === "ping") {
      this.write({protocolVersion: md3UiProtocolVersion, kind: "pong", correlationId: envelope.id});
      return;
    }
    if (envelope.kind === "message" && envelope.type) {
      const type = envelope.type;
      this.handlers.get(type)?.forEach(handler => handler(envelope.payload));
      this.anyHandlers.forEach(handler => handler(type, envelope.payload));
      return;
    }
    if ((envelope.kind === "response" || envelope.kind === "error") && envelope.correlationId) {
      const pending = this.pending.get(envelope.correlationId);
      if (pending === undefined) {
        return;
      }
      this.pending.delete(envelope.correlationId);
      if (envelope.kind === "response") {
        pending.resolve(envelope.payload);
      } else {
        pending.reject(envelope.error ?? new Error("Request failed."));
      }
    }
  }

  private write(envelope: Md3Envelope): void {
    if (this.socket === null || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not connected.");
    }
    this.socket.send(JSON.stringify(envelope));
  }

  private async mintTicket(): Promise<string> {
    if (this.baseUrl === null || this.connection === null) {
      throw new Error("The UI connection has no host.");
    }
    const token = await this.auth.token(this.baseUrl, this.connection);
    if (token === null) {
      throw new Error("Not signed in to the host.");
    }
    const response = await this.hostHttp.postJson(
      `${this.baseUrl}${md3UiTicketPath}`, {}, ticketTimeoutMs,
      {headers: {Authorization: `Bearer ${token}`, "X-MacroDeck-Ui-Protocol": String(md3UiProtocolVersion)}});
    if (response.status !== 200) {
      throw new Error(`UI WebSocket ticket request failed: ${response.status}`);
    }
    const body = response.data as Md3TicketResponse | null;
    if (body === null || typeof body.value !== "string" || body.value.length === 0) {
      throw new Error("The UI WebSocket ticket response carried no ticket.");
    }
    return body.value;
  }

  private socketUrl(ticket: string): string {
    const base = this.baseUrl ?? "";
    const ws = base.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
    return `${ws}${md3UiSocketPath}?ticket=${encodeURIComponent(ticket)}`;
  }

  private handleClose(socket: WebSocket): void {
    if (this.socket !== socket) {
      return;
    }
    this.socket = null;
    this.settlePending(new Error("WebSocket disconnected."));
    this.state.next(this.wanted ? "reconnecting" : "disconnected");
    this.scheduleRetry();
  }

  private abandon(socket: WebSocket): void {
    if (this.socket === socket) {
      this.socket = null;
    }
    socket.onopen = null;
    socket.onerror = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.close();
  }

  private settlePending(reason: Error): void {
    const pending = Array.from(this.pending.values());
    this.pending.clear();
    pending.forEach(entry => entry.reject(reason));
  }

  private isCurrent(attempt: number): boolean {
    return this.wanted && attempt === this.attempt;
  }

  private scheduleRetry(): void {
    if (!this.wanted || this.retryTimer !== null || this.socket !== null) {
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect(this.baseUrl!, this.connection!, this.clientId!, this.features);
    }, reconnectDelayMs);
  }

  private clearRetry(): void {
    if (this.retryTimer === null) {
      return;
    }
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private refreshStaleTimer(): void {
    if (this.staleTimer !== null) {
      clearTimeout(this.staleTimer);
    }
    this.staleTimer = setTimeout(() => this.socket?.close(), staleAfterMs);
  }

  public observeState(): Observable<Md3ConnectionState> {
    return this.state.asObservable();
  }
}
