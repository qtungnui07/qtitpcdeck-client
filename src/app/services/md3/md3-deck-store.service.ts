import {Injectable} from '@angular/core';
import {BehaviorSubject} from 'rxjs';
import {HostHttpService} from "../host-http/host-http.service";
import {Md3AuthSessionService} from "./md3-auth-session.service";
import {Md3WebSocketService} from "./md3-websocket.service";
import {Connection} from "../../datatypes/connection";
import {
  Md3FolderCreatedEvent,
  Md3FolderDeletedEvent,
  Md3FolderNavigationEvent,
  Md3FolderUpdatedEvent,
  Md3GetFoldersResponse,
  Md3GetProfilesResponse,
  Md3IpcFolder,
  Md3IpcProfile,
  Md3IpcWidget,
  Md3WidgetsCreatedEvent,
  Md3WidgetsDeletedEvent
} from "../../datatypes/md3/md3-protocol";

const requestTimeoutMs = 10000;

@Injectable({
  providedIn: 'root'
})
export class Md3DeckStoreService {

  public readonly profiles = new BehaviorSubject<Md3IpcProfile[]>([]);
  public readonly folders = new BehaviorSubject<Md3IpcFolder[]>([]);
  public readonly currentFolderId = new BehaviorSubject<string | null>(null);

  private hostBaseUrl: string | null = null;
  private hostConnection: Connection | null = null;
  private unsubscribers: Array<() => void> = [];

  constructor(private hostHttp: HostHttpService,
              private auth: Md3AuthSessionService,
              private socket: Md3WebSocketService) {
  }

  public async load(baseUrl: string, connection: Connection): Promise<void> {
    this.hostBaseUrl = baseUrl;
    this.hostConnection = connection;
    this.subscribe();
    await this.refreshProfiles();
    await this.refreshFolders();

    // The socket outlives the host it connected to: a host restart (an update,
    // a crash) drops the WebSocket, the service reconnects on its own, and the
    // event subscriptions survive - but the snapshot this store holds is from
    // the dead host. Refetch on every fresh "connected" so the deck follows
    // the host it is actually talking to.
    const stateSubscription = this.socket.state.subscribe(state => {
      if (state === "connected") {
        void this.refreshProfiles();
        void this.refreshFolders();
      }
    });
    this.unsubscribers.push(() => stateSubscription.unsubscribe());
  }

  public async refreshProfiles(): Promise<void> {
    const response = await this.get<Md3GetProfilesResponse>("/api/profiles");
    if (response === null) {
      return;
    }
    this.profiles.next(response.profiles ?? []);
  }

  public async refreshFolders(profileId?: string | null): Promise<void> {
    const query = profileId ? `?profileId=${encodeURIComponent(profileId)}` : "";
    const response = await this.get<Md3GetFoldersResponse>(`/api/folders${query}`);
    if (response === null) {
      return;
    }
    const folders = response.folders ?? [];
    this.folders.next(folders);
    if (this.currentFolderId.value === null) {
      const initial = folders.find(folder => folder.isDefault === true) ?? folders[0];
      this.currentFolderId.next(initial?.id ?? null);
    }
  }

  public navigateTo(folderId: string, profileId?: string | null): void {
    if (profileId && profileId !== this.profileIdOf(folderId)) {
      void this.refreshFolders(profileId);
    }
    this.currentFolderId.next(folderId);
  }

  public folder(id: string): Md3IpcFolder | undefined {
    return this.folders.value.find(folder => folder.id === id);
  }

  public baseUrl(): string | null {
    return this.hostBaseUrl;
  }

  public connection(): Connection | null {
    return this.hostConnection;
  }

  public widget(id: string): Md3IpcWidget | undefined {
    for (const folder of this.folders.value) {
      const found = folder.widgets?.find(widget => widget.id === id);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }

  public folderOfWidget(widgetId: string): Md3IpcFolder | undefined {
    return this.folders.value.find(folder => folder.widgets?.some(widget => widget.id === widgetId));
  }

  public currentFolder(): Md3IpcFolder | undefined {
    const id = this.currentFolderId.value;
    return id === null ? undefined : this.folder(id);
  }

  public dispose(): void {
    this.unsubscribers.forEach(unsubscribe => unsubscribe());
    this.unsubscribers = [];
    this.profiles.next([]);
    this.folders.next([]);
    this.currentFolderId.next(null);
    this.hostBaseUrl = null;
    this.hostConnection = null;
  }

  private profileIdOf(folderId: string): string | undefined {
    return this.folder(folderId)?.profileId;
  }

  private subscribe(): void {
    if (this.unsubscribers.length > 0) {
      return;
    }
    this.unsubscribers.push(
      this.socket.on("FolderCreatedEvent", payload => {
        const event = payload as Md3FolderCreatedEvent;
        if (event?.folder) {
          this.folders.next([...this.folders.value, event.folder]);
        }
      }),
      this.socket.on("FolderUpdatedEvent", payload => {
        const event = payload as Md3FolderUpdatedEvent;
        if (!event?.folder) {
          return;
        }
        this.folders.next(this.folders.value.map(folder =>
          folder.id === event.folder.id ? event.folder : folder));
      }),
      this.socket.on("FolderDeletedEvent", payload => {
        const event = payload as Md3FolderDeletedEvent;
        if (!event?.folderId) {
          return;
        }
        this.folders.next(this.folders.value.filter(folder => folder.id !== event.folderId));
        if (this.currentFolderId.value === event.folderId) {
          const fallback = this.folders.value.find(folder => folder.isDefault === true) ?? this.folders.value[0];
          this.currentFolderId.next(fallback?.id ?? null);
        }
      }),
      this.socket.on("FoldersReorderedEvent", () => void this.refreshFolders()),
      this.socket.on("WidgetsCreatedEvent", payload => {
        const event = payload as Md3WidgetsCreatedEvent;
        if (!event?.folderId || !Array.isArray(event.widgets)) {
          return;
        }
        this.folders.next(this.folders.value.map(folder => folder.id === event.folderId
          ? {...folder, widgets: [...(folder.widgets ?? []), ...event.widgets]}
          : folder));
      }),
      this.socket.on("WidgetsDeletedEvent", payload => {
        const event = payload as Md3WidgetsDeletedEvent;
        if (!event?.folderId || !Array.isArray(event.widgetIds)) {
          return;
        }
        const removed = new Set(event.widgetIds);
        this.folders.next(this.folders.value.map(folder => folder.id === event.folderId
          ? {...folder, widgets: (folder.widgets ?? []).filter(widget => !removed.has(widget.id))}
          : folder));
      }),
      this.socket.on("WidgetPositionsUpdatedEvent", () => void this.refreshFolders()),
      this.socket.on("ProfileUpdatedEvent", () => void this.refreshProfiles()),
      this.socket.on("ProfilesReorderedEvent", () => void this.refreshProfiles()),
      this.socket.on("FolderNavigationEvent", payload => {
        const event = payload as Md3FolderNavigationEvent;
        if (event?.command === "changeTo" && event.folderId) {
          this.navigateTo(event.folderId, event.profileId);
        }
      })
    );
  }

  private async get<T>(path: string): Promise<T | null> {
    if (this.hostBaseUrl === null || this.hostConnection === null) {
      return null;
    }
    const token = await this.auth.token(this.hostBaseUrl, this.hostConnection);
    if (token === null) {
      return null;
    }
    const response = await this.hostHttp.getJson(
      `${this.hostBaseUrl}${path}`, requestTimeoutMs, {headers: {Authorization: `Bearer ${token}`}});
    if (response.status !== 200 || response.data === null) {
      return null;
    }
    return response.data as T;
  }
}
