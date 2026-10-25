import {Component} from '@angular/core';
import {IonicModule, ModalController} from "@ionic/angular";
import {Connection} from "../../../../datatypes/connection";


@Component({
  selector: 'app-macro-deck3-detected',
  templateUrl: 'macro-deck3-detected.component.html',
  imports: [
    IonicModule
  ]
})
export class MacroDeck3DetectedComponent {

  baseUrl: string | null = null;
  name: string | undefined;
  connection: Connection | undefined;
  expectedIdentityFingerprint: string | null = null;
  fromConnectLink = false;
  hostName = "";

  constructor(private modalController: ModalController) {
  }

  ngOnInit() {
    this.hostName = this.name || (this.baseUrl ? new URL(this.baseUrl).host : "");
  }

  /** Hands the connection back to the caller, which runs the sign-in. */
  async connect() {
    await this.modalController.dismiss(this.connection, "connect");
  }

  async dismiss() {
    await this.modalController.dismiss();
  }
}
