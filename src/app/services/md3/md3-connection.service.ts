import {Injectable} from '@angular/core';
import {BehaviorSubject} from 'rxjs';
import {Connection} from "../../datatypes/connection";
import {SettingsService} from "../settings/settings.service";
import {ConnectionService} from "../connection/connection.service";
import {Md3AuthError, Md3AuthSessionService} from "./md3-auth-session.service";
import {Md3WebSocketService} from "./md3-websocket.service";
import {Md3DeckStoreService} from "./md3-deck-store.service";
import {Md3ActionService} from "./md3-action.service";
import {Md3WidgetSessionService} from "./md3-widget-session.service";
import {MacroDeck3DetectionService} from "../macro-deck3/macro-deck3-detection.service";

export type Md3ConnectStage =
  | "idle"
  | "detecting"
  | "signingIn"
  | "connecting"
  | "loadingDeck"
  | "ready"
  | "needsPairingCode"
  | "failed";

export interface Md3ConnectState {
  stage: Md3ConnectStage;
  baseUrl: string | null;
  connection: Connection | null;
  message: string | null;
}

/**
 * Drives the whole deck connection: detect the host, sign in, open the UI socket, load the
 * deck. Every other MD3 service is configured from here so the pages only deal with one entry point.
 */
@Injectable({
  providedIn: 'root'
})
export class Md3ConnectionService {

  public readonly state = new BehaviorSubject<Md3ConnectState>({
    stage: "idle", baseUrl: null, connection: null, message: null
  });

  constructor(private settings: SettingsService,
              private connections: ConnectionService,
              private detection: MacroDeck3DetectionService,
              private auth: Md3AuthSessionService,
              private socket: Md3WebSocketService,
              private store: Md3DeckStoreService,
              private actions: Md3ActionService,
              private sessions: Md3WidgetSessionService) {
  }

  /**
   * Connects to a host. When the connection carries no usable credential the caller is asked for a
   * pairing code, which is then redeemed through `redeem`.
   */
  public async connect(connection: Connection): Promise<boolean> {
    this.set("detecting", connection, null);
    const baseUrl = await this.detection.detect(connection);
    if (baseUrl === null) {
      this.set("failed", connection, "No qtitpcdeck host answered at this address.");
      return false;
    }

    this.set("signingIn", connection, null, baseUrl);
    let signedIn = false;
    try {
      signedIn = await this.signIn(baseUrl, connection);
    } catch (error) {
      this.set("failed", connection, this.describe(error), baseUrl);
      return false;
    }
    if (!signedIn) {
      this.set("needsPairingCode", connection, null, baseUrl);
      return false;
    }

    return this.openDeck(baseUrl, connection);
  }

  /** Redeems a pairing code the person typed, then continues the connection. */
  public async redeem(connection: Connection, code: string): Promise<boolean> {
    const baseUrl = this.state.value.baseUrl ?? await this.detection.detect(connection);
    if (baseUrl === null) {
      this.set("failed", connection, "No qtitpcdeck host answered at this address.");
      return false;
    }

    this.set("signingIn", connection, null, baseUrl);
    try {
      await this.auth.redeem(baseUrl, connection, code);
    } catch (error) {
      this.set("needsPairingCode", connection, this.describe(error), baseUrl);
      return false;
    }
    return this.openDeck(baseUrl, connection);
  }

  public disconnect(): void {
    this.socket.disconnect();
    this.sessions.dispose();
    this.store.dispose();
    this.auth.clear();
    this.state.next({stage: "idle", baseUrl: null, connection: null, message: null});
  }

  /** The connection the current state belongs to, or `null` before the first attempt. */
  public connection(): Connection | null {
    return this.state.value.connection;
  }

  private async signIn(baseUrl: string, connection: Connection): Promise<boolean> {
    // Re-identification runs on the refresh cookie the last sign-in stored; a
    // device record alone buys nothing at the host's enrollment endpoint.
    if (connection.refreshCookie) {
      const session = await this.auth.reauthenticate(baseUrl, connection);
      if (session !== null) {
        return true;
      }
    }
    if (connection.pairingCode) {
      await this.auth.redeem(baseUrl, connection, connection.pairingCode);
      // The code is single-use, so it is dropped once it has been spent.
      connection.pairingCode = undefined;
      await this.connections.addUpdateConnection(connection);
      return true;
    }
    return false;
  }

  private async openDeck(baseUrl: string, connection: Connection): Promise<boolean> {
    this.set("connecting", connection, null, baseUrl);
    const clientId = await this.settings.getClientId();
    this.actions.configure(baseUrl, connection, clientId);
    this.socket.connect(baseUrl, connection, clientId);

    try {
      await this.store.load(baseUrl, connection);
    } catch (error) {
      this.set("failed", connection, this.describe(error), baseUrl);
      return false;
    }

    this.set("ready", connection, null, baseUrl);
    return true;
  }

  private describe(error: unknown): string {
    if (error instanceof Md3AuthError) {
      return error.message;
    }
    return error instanceof Error ? error.message : "The connection failed.";
  }

  private set(stage: Md3ConnectStage, connection: Connection, message: string | null, baseUrl?: string): void {
    this.state.next({
      stage: stage,
      baseUrl: baseUrl ?? this.state.value.baseUrl,
      connection: connection,
      message: message
    });
  }
}
