// Wire types for the Macro Deck 3 UI protocol (version 1).
// Mirrors Macro-Deck/ui/runtime/src/protocol and Macro-Deck/ui/runtime/src/transport.

export const md3UiProtocolVersion = 1;
export const md3UiSocketPath = "/ws/ui";
export const md3UiTicketPath = "/api/ui-websocket/tickets";
export const md3UiSubProtocol = "macrodeck.ui.v1";

export type Md3EnvelopeKind =
  | "hello"
  | "welcome"
  | "request"
  | "response"
  | "message"
  | "ping"
  | "pong"
  | "cancel"
  | "goodbye"
  | "error";

export interface Md3Envelope {
  protocolVersion: number;
  kind: Md3EnvelopeKind;
  type?: string;
  id?: string;
  correlationId?: string;
  payload?: unknown;
  error?: { code: string; message?: unknown };
}

export interface Md3AuthStatus {
  setupComplete: boolean;
  authenticated: boolean;
  trusted: boolean;
  scope?: "admin" | "client" | null;
  username?: string | null;
  version?: string;
  minimumCompanionVersion?: string;
}

export type Md3DeviceClientType = "web-client" | "admin-ui" | "native" | "provider" | "unknown";
export type Md3DeviceFormFactor = "phone" | "tablet" | "desktop" | "unknown";

export interface Md3DeviceLoginInfo {
  deviceId?: string;
  deviceSecret?: string;
  clientType?: Md3DeviceClientType;
  proposedName?: string;
  platform?: string;
  browser?: string;
  formFactor?: Md3DeviceFormFactor;
  appVersion?: string;
}

export interface Md3DeviceCredential {
  deviceId: string;
  deviceSecret?: string;
  startupProfileId?: string;
}

export interface Md3TokenResponse {
  accessToken: string;
  expiresInSeconds: number;
  scope: "admin" | "client";
  username: string;
  device?: Md3DeviceCredential;
  hostKey?: string;
}

export interface Md3RedeemDeviceEnrollmentRequest {
  token: string;
  device: Md3DeviceLoginInfo;
}

export interface Md3TicketResponse {
  value: string;
}

export interface Md3IpcProfile {
  id: string;
  name: string;
  order: number;
  isDefault?: boolean;
}

export interface Md3IpcWidget {
  id: string;
  type: string;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  data?: string;
  isPinned?: boolean;
  pinScope?: string;
}

export interface Md3IpcFolder {
  id: string;
  name: string;
  profileId?: string;
  parentId?: string;
  order: number;
  rows?: number;
  columns?: number;
  backgroundColor?: string;
  backgroundColorSource?: string;
  widgetSpacing?: number;
  widgetBorderRadius?: number;
  emptyCellStyle?: string;
  isDefault?: boolean;
  viewId?: string;
  viewConfiguration?: string;
  widgets: Md3IpcWidget[];
}

export interface Md3GetProfilesResponse {
  profiles: Md3IpcProfile[];
}

export interface Md3GetFoldersResponse {
  folders: Md3IpcFolder[];
}

export interface Md3OpenWidgetUiSessionResponse {
  accepted: boolean;
  sessionId: string;
  code?: string;
  message?: string;
}

export interface Md3AttachUiSessionResponse {
  accepted: boolean;
  sessionId: string;
  code?: string;
  message?: string;
  surfaceKind?: string;
  sessionMode?: string;
  revision?: number;
}

export interface Md3UiSessionTreeUpdatedEvent {
  sessionId: string;
  revision: number;
  tree: unknown;
}

export interface Md3UiSessionPatchedEvent {
  sessionId: string;
  fromRevision: number;
  toRevision: number;
  patch: unknown;
}

export interface Md3UiSessionInvalidatedEvent {
  sessionId: string;
  code: string;
  message: string;
  retryable: boolean;
}

export interface Md3UiSessionClosedEvent {
  sessionId: string;
  reason?: string;
}

export interface Md3FolderNavigationEvent {
  command: string;
  folderId?: string;
  profileId?: string;
  navigationToken?: string;
}

export interface Md3FolderCreatedEvent {
  folder: Md3IpcFolder;
}

export interface Md3FolderUpdatedEvent {
  folder: Md3IpcFolder;
}

export interface Md3FolderDeletedEvent {
  folderId: string;
}

export interface Md3WidgetsCreatedEvent {
  folderId: string;
  widgets: Md3IpcWidget[];
}

export interface Md3WidgetsDeletedEvent {
  folderId: string;
  widgetIds: string[];
}

export interface Md3WidgetStateInvalidatedEvent {
  widgetId: string;
}

export interface Md3LabelTextUpdatedEvent {
  widgetId: string;
  state: string;
  text: string | null;
}

export interface Md3WidgetStateUpdatedEvent {
  widgetId: string;
  stateId: string | null;
  stateLabel: unknown;
  states?: { id: string; label: string }[];
}

export interface Md3ExecuteActionButtonTriggerRequest {
  widgetId: string;
  folderId: string;
  triggerType: string;
  clientId?: string;
}

export interface Md3ActionExecutionResult {
  success: boolean;
  error?: { code: string; message: unknown };
  executionId?: string;
  status?: string;
  durationMs?: number;
}

// The three triggers a single tap produces. Only the gesture ones report a failure to the user;
// the touch lifecycle pair would say the same thing three times.
export const md3GestureTriggers: readonly string[] = ["onShortPress", "onLongPress", "onDoublePress"];
