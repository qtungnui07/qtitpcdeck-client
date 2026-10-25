import {Injectable} from '@angular/core';
import {applyUiPatch, rootNodeOf, UiNode, UiPatch} from '@macro-deck/runtime';
import {HostHttpService} from "../host-http/host-http.service";
import {Md3AuthSessionService} from "./md3-auth-session.service";
import {Md3WebSocketService} from "./md3-websocket.service";
import {Connection} from "../../datatypes/connection";
import {
  Md3AttachUiSessionResponse,
  Md3OpenWidgetUiSessionResponse,
  Md3UiSessionClosedEvent,
  Md3UiSessionInvalidatedEvent,
  Md3UiSessionPatchedEvent,
  Md3UiSessionTreeUpdatedEvent
} from "../../datatypes/md3/md3-protocol";

const resourceTimeoutMs = 15000;
// The host caps concurrent widget sessions per provider, so a deck larger than this mounts only what
// is on screen and the rest wait for a slot.
const maxConcurrentSessions = 96;
const resourceCacheBytes = 64 * 1024 * 1024;

export interface Md3WidgetSession {
  widgetId: string;
  sessionId: string;
  revision: number;
  // The root node, never the tree document: the grid renders a UiNode and a
  // document has no type, which paints every tile blank.
  tree: UiNode | null;
}

export interface Md3WidgetSessionEvents {
  onTree(widgetId: string, tree: UiNode, revision: number): void;
  onPatch(widgetId: string, patch: unknown, revision: number): void;
  onEnded(widgetId: string): void;
}

interface CachedResource {
  url: string;
  bytes: number;
}

@Injectable({
  providedIn: 'root'
})
export class Md3WidgetSessionService {

  private baseUrl: string | null = null;
  private connection: Connection | null = null;
  private events: Md3WidgetSessionEvents | null = null;
  private unsubscribers: Array<() => void> = [];

  private readonly sessions = new Map<string, Md3WidgetSession>();
  private readonly sessionByWidget = new Map<string, string>();
  private readonly widgetBySession = new Map<string, string>();
  private readonly opening = new Set<string>();
  private readonly wanted = new Set<string>();
  private readonly closing = new Map<string, any>();

  private readonly resources = new Map<string, CachedResource>();
  private readonly resourcePending = new Map<string, Promise<string | null>>();
  private resourceBytes = 0;

  constructor(private hostHttp: HostHttpService,
              private auth: Md3AuthSessionService,
              private socket: Md3WebSocketService) {
  }

  public configure(baseUrl: string, connection: Connection, events: Md3WidgetSessionEvents): void {
    this.baseUrl = baseUrl;
    this.connection = connection;
    this.events = events;
    this.subscribe();
  }

  /** Declares the widgets that should hold a session. Anything else is closed. */
  public sync(widgetIds: readonly string[]): void {
    const next = new Set(widgetIds);
    for (const widgetId of next) {
      this.wanted.add(widgetId);
      this.cancelClose(widgetId);
      if (!this.sessionByWidget.has(widgetId) && !this.opening.has(widgetId)) {
        void this.open(widgetId);
      }
    }
    for (const widgetId of Array.from(this.wanted)) {
      if (!next.has(widgetId)) {
        this.wanted.delete(widgetId);
        this.scheduleClose(widgetId);
      }
    }
  }

  public tree(widgetId: string): UiNode | undefined {
    return this.sessions.get(this.sessionByWidget.get(widgetId) ?? "")?.tree ?? undefined;
  }

  /** Forwards an in-tree component event to the host, which owns the widget's behaviour. */
  public sendEvent(widgetId: string, nodeId: string, name: string, data?: unknown): void {
    const sessionId = this.sessionByWidget.get(widgetId);
    if (sessionId === undefined) {
      return;
    }
    void this.socket.request("SendUiEvent", [{
      sessionId: sessionId,
      nodeId: nodeId,
      name: name,
      data: data,
      revision: this.sessions.get(sessionId)?.revision
    }]).catch(() => undefined);
  }

  public dispose(): void {
    this.unsubscribers.forEach(unsubscribe => unsubscribe());
    this.unsubscribers = [];
    this.closing.forEach(timer => clearTimeout(timer));
    this.closing.clear();
    for (const widgetId of Array.from(this.sessionByWidget.keys())) {
      this.close(widgetId);
    }
    this.wanted.clear();
    this.releaseResources();
    this.baseUrl = null;
    this.connection = null;
    this.events = null;
  }

  /**
   * Resolves a resource to a blob URL. The host requires an Authorization header on the resource
   * endpoint, so the bytes are fetched here and the renderer is handed a URL it can put in an <img>.
   */
  public async resourceUrl(resourceId: string, contentHash: string | undefined, size: number | undefined): Promise<string | null> {
    const key = `${resourceId}|${contentHash ?? ""}|${size ?? ""}`;
    const cached = this.resources.get(key);
    if (cached !== undefined) {
      return cached.url;
    }
    const pending = this.resourcePending.get(key);
    if (pending !== undefined) {
      return pending;
    }
    const fetch = this.fetchResource(key, resourceId, contentHash, size);
    this.resourcePending.set(key, fetch);
    try {
      return await fetch;
    } finally {
      this.resourcePending.delete(key);
    }
  }

  private async fetchResource(key: string, resourceId: string, contentHash: string | undefined, size: number | undefined): Promise<string | null> {
    if (this.baseUrl === null || this.connection === null) {
      return null;
    }
    const token = await this.auth.token(this.baseUrl, this.connection);
    if (token === null) {
      return null;
    }
    const query: string[] = [];
    if (contentHash) {
      query.push(`v=${encodeURIComponent(contentHash)}`);
    }
    if (size !== undefined) {
      query.push(`size=${size}`);
    }
    const path = `/api/ui/resources/${encodeURIComponent(resourceId)}${query.length > 0 ? `?${query.join("&")}` : ""}`;
    const response = await this.hostHttp.getBytes(
      `${this.baseUrl}${path}`, resourceTimeoutMs, {headers: {Authorization: `Bearer ${token}`}});
    if (response.status !== 200 || response.data === null) {
      return null;
    }

    const blob = Md3WidgetSessionService.blobOf(response.data);
    const url = URL.createObjectURL(blob);
    this.resources.set(key, {url: url, bytes: blob.size});
    this.resourceBytes += blob.size;
    this.evictResources();
    return url;
  }

  /**
   * CapacitorHttp hands binary bodies over as a base64 string on every
   * platform; wrapping that string in a Blob uploads the base64 text itself,
   * which is why icons came back as unrenderable data. Decode first.
   */
  private static blobOf(data: any): Blob {
    if (data instanceof Blob) {
      return data;
    }
    if (typeof data === "string") {
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
      }
      return new Blob([bytes]);
    }
    return new Blob([data]);
  }

  private evictResources(): void {
    if (this.resourceBytes <= resourceCacheBytes) {
      return;
    }
    // Map iteration is insertion-ordered, so the oldest entry is evicted first.
    for (const [key, entry] of this.resources) {
      if (this.resourceBytes <= resourceCacheBytes) {
        return;
      }
      URL.revokeObjectURL(entry.url);
      this.resources.delete(key);
      this.resourceBytes -= entry.bytes;
    }
  }

  private releaseResources(): void {
    this.resources.forEach(entry => URL.revokeObjectURL(entry.url));
    this.resources.clear();
    this.resourceBytes = 0;
  }

  private async open(widgetId: string): Promise<void> {
    if (this.opening.has(widgetId) || this.sessions.size >= maxConcurrentSessions) {
      return;
    }
    this.opening.add(widgetId);
    try {
      const opened = await this.socket.request<Md3OpenWidgetUiSessionResponse>(
        "OpenWidgetUiSession", [{widgetId: widgetId}]);
      if (!opened || opened.accepted !== true || typeof opened.sessionId !== "string") {
        return;
      }
      const sessionId = opened.sessionId;
      this.sessionByWidget.set(widgetId, sessionId);
      this.widgetBySession.set(sessionId, widgetId);
      this.sessions.set(sessionId, {widgetId: widgetId, sessionId: sessionId, revision: 0, tree: null});

      if (!this.wanted.has(widgetId)) {
        this.close(widgetId);
        return;
      }

      // Opening a session does not subscribe to it. Until it is attached the host pushes nothing,
      // which is a widget that renders perfectly and shows nothing.
      const attached = await this.socket.request<Md3AttachUiSessionResponse>(
        "AttachUiSession", [{sessionId: sessionId}]);
      if (!attached || attached.accepted !== true) {
        this.forget(widgetId, sessionId);
        this.events?.onEnded(widgetId);
      }
    } catch {
      this.forget(widgetId, this.sessionByWidget.get(widgetId) ?? "");
    } finally {
      this.opening.delete(widgetId);
    }
  }

  private forget(widgetId: string, sessionId: string): void {
    if (this.widgetBySession.get(sessionId) === widgetId) {
      this.widgetBySession.delete(sessionId);
    }
    if (this.sessionByWidget.get(widgetId) === sessionId) {
      this.sessionByWidget.delete(widgetId);
    }
    this.sessions.delete(sessionId);
  }

  private scheduleClose(widgetId: string): void {
    if (this.closing.has(widgetId)) {
      return;
    }
    // The host does not flush a session's pending patches before it closes it, so closing the moment
    // a widget leaves would lose a patch that races the folder switch.
    this.closing.set(widgetId, setTimeout(() => {
      this.closing.delete(widgetId);
      if (this.wanted.has(widgetId)) {
        return;
      }
      this.close(widgetId);
    }, 250));
  }

  private cancelClose(widgetId: string): void {
    const timer = this.closing.get(widgetId);
    if (timer === undefined) {
      return;
    }
    clearTimeout(timer);
    this.closing.delete(widgetId);
  }

  private close(widgetId: string): void {
    this.cancelClose(widgetId);
    const sessionId = this.sessionByWidget.get(widgetId);
    if (sessionId === undefined) {
      return;
    }
    this.forget(widgetId, sessionId);
    void this.socket.request("CloseUiSession", [{sessionId: sessionId}]).catch(() => undefined);
  }

  private subscribe(): void {
    if (this.unsubscribers.length > 0) {
      return;
    }
    this.unsubscribers.push(
      this.socket.on("UiSessionTreeUpdatedEvent", payload => {
        const event = payload as Md3UiSessionTreeUpdatedEvent;
        const widgetId = this.widgetBySession.get(event?.sessionId);
        const session = this.sessions.get(event?.sessionId);
        if (widgetId === undefined || session === undefined) {
          return;
        }
        const root = rootNodeOf(event.tree);
        if (root === null) {
          return;
        }
        session.revision = event.revision;
        session.tree = root;
        this.events?.onTree(widgetId, root, event.revision);
      }),
      this.socket.on("UiSessionPatchedEvent", payload => {
        const event = payload as Md3UiSessionPatchedEvent;
        const widgetId = this.widgetBySession.get(event?.sessionId);
        const session = this.sessions.get(event?.sessionId);
        if (widgetId === undefined || session === undefined || session.tree === null) {
          return;
        }
        const patch: UiPatch = {
          fromRevision: event.fromRevision,
          toRevision: event.toRevision,
          operations: (event.patch as {operations?: UiPatch["operations"]} | null)?.operations ?? []
        };
        const next = applyUiPatch(session.tree, session.revision, patch);
        if (next === null) {
          // The patch did not apply to the tree this client holds; ask the host
          // for a fresh snapshot rather than leaving a stale frame on screen.
          this.reattach(widgetId, session.sessionId);
          return;
        }
        session.revision = event.toRevision;
        session.tree = next;
        this.events?.onPatch(widgetId, event.patch, event.toRevision);
      }),
      this.socket.on("UiSessionInvalidatedEvent", payload => {
        this.endSession((payload as Md3UiSessionInvalidatedEvent)?.sessionId);
      }),
      this.socket.on("UiSessionClosedEvent", payload => {
        this.endSession((payload as Md3UiSessionClosedEvent)?.sessionId);
      })
    );
  }

  // Attaching is idempotent and always forces a fresh snapshot, which is what a
  // client whose tree no longer matches the host's revisions needs.
  private reattach(widgetId: string, sessionId: string): void {
    void this.socket.request<Md3AttachUiSessionResponse>(
      "AttachUiSession", [{sessionId: sessionId}]).then(attached => {
      if (attached && attached.accepted === true) {
        return;
      }
      this.forget(widgetId, sessionId);
      this.events?.onEnded(widgetId);
      if (this.wanted.has(widgetId)) {
        void this.open(widgetId);
      }
    }).catch(() => undefined);
  }

  private endSession(sessionId: string | undefined): void {    if (sessionId === undefined) {
      return;
    }
    const widgetId = this.widgetBySession.get(sessionId);
    if (widgetId === undefined) {
      return;
    }
    this.forget(widgetId, sessionId);
    this.events?.onEnded(widgetId);
    // The widget is still on the deck, so it needs a session again.
    if (this.wanted.has(widgetId)) {
      void this.open(widgetId);
    }
  }
}
