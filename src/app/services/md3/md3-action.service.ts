import {Injectable} from '@angular/core';
import {HostHttpService} from "../host-http/host-http.service";
import {Md3AuthSessionService} from "./md3-auth-session.service";
import {Connection} from "../../datatypes/connection";
import {
  Md3ActionExecutionResult,
  Md3ExecuteActionButtonTriggerRequest,
  md3GestureTriggers
} from "../../datatypes/md3/md3-protocol";

const requestTimeoutMs = 15000;

@Injectable({
  providedIn: 'root'
})
export class Md3ActionService {

  private baseUrl: string | null = null;
  private connection: Connection | null = null;
  private clientId: string | null = null;

  constructor(private hostHttp: HostHttpService, private auth: Md3AuthSessionService) {
  }

  public configure(baseUrl: string, connection: Connection, clientId: string): void {
    this.baseUrl = baseUrl;
    this.connection = connection;
    this.clientId = clientId;
  }

  /**
   * Runs a widget trigger. A single tap produces onTouchStart, onTouchEnd and onShortPress; only the
   * gesture triggers report a failure, because the touch lifecycle pair would repeat the same error.
   */
  public async execute(widgetId: string, folderId: string, triggerType: string): Promise<void> {
    if (this.baseUrl === null || this.connection === null) {
      return;
    }
    const token = await this.auth.token(this.baseUrl, this.connection);
    if (token === null) {
      return;
    }

    const body: Md3ExecuteActionButtonTriggerRequest = {
      widgetId: widgetId,
      folderId: folderId,
      triggerType: triggerType,
      clientId: this.clientId ?? undefined
    };
    const response = await this.hostHttp.postJson(
      `${this.baseUrl}/api/actions/execute`, body, requestTimeoutMs,
      {headers: {Authorization: `Bearer ${token}`}});

    if (response.status !== 200) {
      if (md3GestureTriggers.includes(triggerType)) {
        console.warn(`Action trigger ${triggerType} failed with status ${response.status}.`);
      }
      return;
    }

    const result = response.data as Md3ActionExecutionResult | null;
    if (result?.success === false && md3GestureTriggers.includes(triggerType)) {
      console.warn(`Action trigger ${triggerType} failed:`, result.error?.code ?? "unknown");
    }
  }
}
