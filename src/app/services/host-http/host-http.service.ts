import {Injectable} from '@angular/core';
import {CapacitorHttp, HttpResponseType} from "@capacitor/core";

export interface HostHttpResponse {
  status: number;
  data: any;
  // Response headers as the native bridge reports them: repeated headers are
  // flattened into one value.
  headers?: Record<string, string>;
}

export interface HostHttpOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

@Injectable({
  providedIn: 'root'
})
export class HostHttpService {

  public async getJson(url: string, timeoutMs: number, options?: HostHttpOptions): Promise<HostHttpResponse> {
    return this.request({url: url, method: "GET", headers: options?.headers}, options?.timeoutMs ?? timeoutMs);
  }

  public async postJson(url: string, body: any, timeoutMs: number, options?: HostHttpOptions): Promise<HostHttpResponse> {
    return this.request({
      url: url,
      method: "POST",
      headers: {"Content-Type": "application/json", ...options?.headers},
      data: body
    }, options?.timeoutMs ?? timeoutMs);
  }

  // Resource bytes need the Authorization header, so they cannot be handed to an <img src> directly.
  public async getBytes(url: string, timeoutMs: number, options?: HostHttpOptions): Promise<HostHttpResponse> {
    return this.request({
      url: url,
      method: "GET",
      headers: options?.headers,
      responseType: "blob"
    }, options?.timeoutMs ?? timeoutMs);
  }

  private async request(options: { url: string, method: string, headers?: any, data?: any, responseType?: HttpResponseType }, timeoutMs: number): Promise<HostHttpResponse> {
    const failed: HostHttpResponse = {status: 0, data: null};
    let timer: any;
    const timeout = new Promise<HostHttpResponse>(resolve => timer = setTimeout(() => resolve(failed), timeoutMs));
    const request = CapacitorHttp.request({
      ...options,
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs
    }).then(response => ({
      status: response.status,
      data: HostHttpService.parseBody(response.data),
      headers: response.headers
    }), () => failed);
    try {
      return await Promise.race([request, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  public static parseBody(data: any): any {
    if (typeof data !== "string") {
      return data;
    }
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }
}
