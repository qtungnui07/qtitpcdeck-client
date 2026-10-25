import {Component} from '@angular/core';
import {FormsModule} from "@angular/forms";
import {IonicModule, ModalController} from "@ionic/angular";
import {Connection} from "../../../../datatypes/connection";

/**
 * Asks for the pairing code the deck host shows on its own screen.
 *
 * The code is single-use and expires, so a refusal sends the person back here rather than failing
 * the connection outright.
 */
@Component({
  selector: 'app-macro-deck3-pairing',
  templateUrl: './macro-deck3-pairing.component.html',
  imports: [
    IonicModule,
    FormsModule
  ]
})
export class MacroDeck3PairingComponent {

  connection: Connection | undefined;
  code = "";
  error: string | null = null;

  constructor(private modalController: ModalController) {
  }

  get hostName(): string {
    return this.connection?.name || this.connection?.host || "";
  }

  get canConfirm(): boolean {
    return /^\d{4,}$/.test(this.code.trim());
  }

  async confirm() {
    const code = this.code.trim();
    if (!this.canConfirm) {
      this.error = "Enter the pairing code shown in qtitpcdeck.";
      return;
    }
    await this.modalController.dismiss(code, "confirm");
  }

  async cancel() {
    await this.modalController.dismiss(null, "cancel");
  }
}
