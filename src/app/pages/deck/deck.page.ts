import {Component} from '@angular/core';
import {Router} from "@angular/router";
import {SettingsModalComponent} from "../shared/modals/settings-modal/settings-modal.component";
import {IonicModule, ModalController, ViewDidEnter, ViewDidLeave} from "@ionic/angular";
import {environment} from "../../../environments/environment";
import {SettingsService} from "../../services/settings/settings.service";
import {DiagnosticService} from "../../services/diagnostic/diagnostic.service";
import {NavigationService} from "../../services/navigation/navigation.service";
import {NavigationDestination} from "../../enums/navigation-destination";
import {Md3DeckComponent} from "./md3-deck/md3-deck.component";
import {Md3ConnectionService} from "../../services/md3/md3-connection.service";
import {Md3DeckStoreService} from "../../services/md3/md3-deck-store.service";
import {Md3IpcFolder} from "../../datatypes/md3/md3-protocol";


@Component({
  selector: 'app-deck',
  templateUrl: './deck.page.html',
  styleUrls: ['./deck.page.scss'],
  imports: [
    IonicModule,
    Md3DeckComponent
]
})
export class DeckPage implements ViewDidEnter {

  showMenuButton: boolean = true;
  clientId: string = "";
  version: string = "";
  md3Folder: Md3IpcFolder | undefined;

  constructor(private modalController: ModalController,
              private settingsService: SettingsService,
              private diagnosticsService: DiagnosticService,
              private navigationService: NavigationService,
              private md3ConnectionService: Md3ConnectionService,
              private md3Store: Md3DeckStoreService) {
  }

  async ionViewDidEnter() {
    if (this.md3ConnectionService.state.value.stage !== "ready") {
      await this.navigationService.navigateTo(NavigationDestination.Home);
      return;
    }

    this.clientId = await this.settingsService.getClientId();
    this.version = await this.diagnosticsService.getVersion();
    await this.loadSettings();

    this.md3Store.currentFolderId.subscribe(() => this.md3Folder = this.md3Store.currentFolder());
    this.md3Folder = this.md3Store.currentFolder();
  }

  async close() {
    this.md3ConnectionService.disconnect();
    await this.navigationService.navigateTo(NavigationDestination.Home);
  }

  async openSettings() {
    const modal = await this.modalController.create({
      component: SettingsModalComponent
    });
    await modal.present();
    await modal.onWillDismiss();
    await this.loadSettings();
  }

  openFullscreen() {
    const elem = document.documentElement;
    if (elem.requestFullscreen) {
      elem.requestFullscreen().then();
    }
  }

  private async loadSettings() {
    this.showMenuButton = await this.settingsService.getShowMenuButton();
  }

  protected readonly environment = environment;
}
