import {Component, Inject, OnInit} from '@angular/core';
import {SettingsService} from "../../services/settings/settings.service";
import { DOCUMENT } from "@angular/common";
import {environment} from "../../../environments/environment";
import {IonicModule} from "@ionic/angular";
import {Md3ConnectionService} from "../../services/md3/md3-connection.service";
import {Connection} from "../../datatypes/connection";

@Component({
  selector: 'app-web-home',
  templateUrl: './web-home.page.html',
  styleUrls: ['./web-home.page.scss'],
  imports: [
    IonicModule
]
})
export class WebHomePage implements OnInit {

  clientId: string | undefined;
  version: string | undefined;

  connectionLost: boolean = false;
  retryCountdown: number = 10;

  private interval: any;

  constructor(@Inject(DOCUMENT) private document: Document,
              private md3ConnectionService: Md3ConnectionService,
              private settingsService: SettingsService) { }

  async ngOnInit() {
    this.clientId = await this.settingsService.getClientId();
    this.version = "Web Version";
    await this.connect();
    this.md3ConnectionService.state.subscribe(state => {
      if (state.stage === "failed") {
        void this.lostConnection();
      }
    });
  }

  async lostConnection() {
    this.connectionLost = true;
    this.retryCountdown = 10;
    this.interval = setInterval(async () => {
      this.retryCountdown--;
      if (this.retryCountdown == 0) {
        await this.connect();
      }
    }, 1000);
  }

  async connect() {
    clearInterval(this.interval);
    this.connectionLost = false;
    // The web client is served by the host itself, so the page's own origin is the host.
    const origin = new URL(this.document.baseURI).origin;
    const connection: Connection = {
      id: "web-client",
      name: "Macro Deck 3",
      host: new URL(origin).hostname,
      port: Number(new URL(origin).port) || (origin.startsWith("https") ? 443 : 80),
      ssl: origin.startsWith("https"),
      usbConnection: false,
      autoConnect: false,
      index: 0,
      pairingCode: undefined,
      deviceId: undefined,
      deviceSecret: undefined
    };
    await this.md3ConnectionService.connect(connection);
  }

  protected readonly environment = environment;
}
