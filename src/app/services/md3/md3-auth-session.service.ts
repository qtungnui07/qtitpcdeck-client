import {Injectable} from '@angular/core';
import {HostHttpService} from "../host-http/host-http.service";
import {SettingsService} from "../settings/settings.service";
import {ConnectionService} from "../connection/connection.service";
import {Connection} from "../../datatypes/connection";
import {
  Md3AuthStatus,
  Md3DeviceLoginInfo,
  Md3RedeemDeviceEnrollmentRequest,
  Md3TokenResponse
} from "../../datatypes/md3/md3-protocol";

const requestTimeoutMs = 10000;
// Refresh a little before the host would reject the token, so a request in flight does not race expiry.
const expiryLeewayMs = 60000;

export type Md3AuthFailure =
  | "invalidCode"
  | "throttled"
  | "notSetup"
  | "unreachable"
  | "unknown";

export class Md3AuthError extends Error {
  constructor(public readonly failure: Md3AuthFailure, message: string) {
    super(message);
    this.name = "Md3AuthError";
  }
}

export interface Md3Session {
  accessToken: string;
  expiresAt: number;
  scope: string;
  username: string;
  deviceId: string | null;
  deviceSecret: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class Md3AuthSessionService {

  private session: Md3Session | null = null;
  private connectionId: string | null = null;
  // A single in-flight sign-in per connection, so a burst of 401s does not redeem the same code twice.
  private pending: Promise<Md3Session | null> | null = null;

  constructor(private hostHttp: HostHttpService,
              private settings: SettingsService,
              private connections: ConnectionService) {
  }

  public async status(baseUrl: string): Promise<Md3AuthStatus | null> {
    const response = await this.hostHttp.getJson(`${baseUrl}/api/auth/status`, requestTimeoutMs);
    if (response.status !== 200 || response.data === null || typeof response.data !== "object") {
      return null;
    }
    return response.data as Md3AuthStatus;
  }

  /**
   * Redeem a pairing code for an access token. The host issues a device credential the first time,
   * which is persisted on the connection so later sign-ins reuse the same device record.
   */
  public async redeem(baseUrl: string, connection: Connection, code: string): Promise<Md3Session> {
    const body: Md3RedeemDeviceEnrollmentRequest = {
      token: code,
      device: await this.deviceInfo(connection)
    };
    const response = await this.hostHttp.postJson(
      `${baseUrl}/api/auth/device-enrollment/redeem`, body, requestTimeoutMs);

    if (response.status === 429) {
      throw new Md3AuthError("throttled", "Too many attempts. Wait a moment and try again.");
    }
    if (response.status === 401 || response.status === 403) {
      throw new Md3AuthError("invalidCode", "The pairing code is not valid or has expired.");
    }
    if (response.status === 409) {
      throw new Md3AuthError("notSetup", "The host has not finished its first-time setup.");
    }
    if (response.status !== 200 || response.data === null) {
      throw new Md3AuthError("unknown", `Sign-in failed with status ${response.status}.`);
    }

    return this.accept(baseUrl, connection, response.data as Md3TokenResponse, response.headers);
  }

  /**
   * Sign in again with the refresh cookie the host set on the last sign-in.
   *
   * The host has no "sign in with my device credential" endpoint: re-identification goes through
   * /api/auth/refresh, which reads the md_refresh_<port> cookie. CapacitorHttp keeps no cookie jar,
   * so the value is stored on the connection and replayed; a refresh response rotates it, and the
   * newest one is always what gets kept. Returns null when there is no cookie or the host refused
   * it, which sends the caller back to the pairing code.
   */
  public async reauthenticate(baseUrl: string, connection: Connection): Promise<Md3Session | null> {
    if (!connection.refreshCookie) {
      return null;
    }
    const response = await this.hostHttp.postJson(
      `${baseUrl}/api/auth/refresh`, {}, requestTimeoutMs,
      {headers: {Cookie: `${this.refreshCookieName(connection)}=${connection.refreshCookie}`}});
    if (response.status !== 200 || response.data === null) {
      return null;
    }
    return this.accept(baseUrl, connection, response.data as Md3TokenResponse, response.headers);
  }

  // The host names the cookie per listener so two hosts on one machine do not
  // overwrite each other's session.
  private refreshCookieName(connection: Connection): string {
    const port = this.portOf(connection);
    return `md_refresh_${port}`;
  }

  private portOf(connection: Connection): number {
    const fromUrl = this.lastBaseUrl !== null ? this.lastBaseUrl.match(/:(\d+)(?:\/|$)/) : null;
    return fromUrl !== null ? Number(fromUrl[1]) : connection.port;
  }

  // CapacitorHttp flattens repeated headers into one string, so both the
  // per-listener and the legacy name are matched wherever they appear.
  private extractRefreshCookie(headers: Record<string, unknown> | undefined): string | null {
    if (headers === undefined || headers === null) {
      return null;
    }
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() !== "set-cookie") {
        continue;
      }
      const value = headers[key];
      const lines = Array.isArray(value) ? value.map(String) : [String(value ?? "")];
      for (const line of lines) {
        const match = /md_refresh(?:_\d+)?=([^;\s]+)/.exec(line);
        if (match !== null) {
          return match[1];
        }
      }
    }
    return null;
  }

  /** The current token, signing in again first when it is missing or about to expire. */
  public async token(baseUrl: string, connection: Connection): Promise<string | null> {
    if (this.session !== null && this.connectionId === connection.id && !this.isExpiring(this.session)) {
      return this.session.accessToken;
    }
    if (this.pending !== null) {
      const shared = await this.pending;
      return shared?.accessToken ?? null;
    }
    this.pending = this.reauthenticate(baseUrl, connection);
    try {
      const refreshed = await this.pending;
      return refreshed?.accessToken ?? null;
    } finally {
      this.pending = null;
    }
  }

  /** The session for a connection, or null when it belongs to a different one. */
  public current(connectionId: string): Md3Session | null {
    return this.connectionId === connectionId ? this.session : null;
  }

  public clear(): void {
    this.session = null;
    this.connectionId = null;
  }

  private isExpiring(session: Md3Session): boolean {
    return session.expiresAt - expiryLeewayMs <= Date.now();
  }

  private lastBaseUrl: string | null = null;

  private async accept(baseUrl: string,
                       connection: Connection,
                       token: Md3TokenResponse,
                       headers?: Record<string, unknown>): Promise<Md3Session> {
    this.lastBaseUrl = baseUrl;
    const deviceId = token.device?.deviceId ?? connection.deviceId ?? null;
    const deviceSecret = token.device?.deviceSecret ?? connection.deviceSecret ?? null;
    const refreshCookie = this.extractRefreshCookie(headers) ?? connection.refreshCookie ?? undefined;
    if (deviceId !== connection.deviceId
      || deviceSecret !== connection.deviceSecret
      || refreshCookie !== connection.refreshCookie) {
      connection.deviceId = deviceId ?? undefined;
      connection.deviceSecret = deviceSecret ?? undefined;
      connection.refreshCookie = refreshCookie;
      await this.connections.addUpdateConnection(connection);
    }

    this.session = {
      accessToken: token.accessToken,
      expiresAt: Date.now() + token.expiresInSeconds * 1000,
      scope: token.scope,
      username: token.username,
      deviceId: deviceId,
      deviceSecret: deviceSecret
    };
    this.connectionId = connection.id;
    return this.session;
  }

  private async deviceInfo(connection: Connection): Promise<Md3DeviceLoginInfo> {
    return {
      deviceId: connection.deviceId,
      deviceSecret: connection.deviceSecret,
      // Only a native client is treated as a companion device by the host.
      clientType: "native",
      proposedName: connection.name,
      platform: this.platform(),
      formFactor: this.formFactor(),
      appVersion: await this.settings.getAppVersion()
    };
  }

  private platform(): string {
    const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
    if (/android/i.test(userAgent)) {
      return "android";
    }
    if (/iphone|ipad|ipod/i.test(userAgent)) {
      return "ios";
    }
    return "web";
  }

  private formFactor(): "phone" | "tablet" | "desktop" {
    const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
    if (/ipad|tablet/i.test(userAgent)) {
      return "tablet";
    }
    if (/iphone|android/i.test(userAgent)) {
      return "phone";
    }
    return "desktop";
  }
}
