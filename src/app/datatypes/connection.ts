export interface Connection {
  id: string,
  name: string,
  host: string,
  port: number,
  ssl: boolean,
  index: number | undefined,
  autoConnect: boolean | undefined,
  usbConnection: boolean | undefined,
  // The pairing code from a connect link, redeemed once for an access token.
  pairingCode: string | undefined,
  // The credential the host issued for this device, replayed on later sign-ins so the host
  // recognises the same device instead of registering a new one.
  deviceId: string | undefined,
  deviceSecret: string | undefined,
  // The refresh cookie the host set on the last sign-in, replayed verbatim on
  // /api/auth/refresh. CapacitorHttp keeps no cookie jar, so the client has to
  // carry it; the host rotates the value on every refresh, and this always
  // stores the latest one.
  refreshCookie?: string | undefined
}
