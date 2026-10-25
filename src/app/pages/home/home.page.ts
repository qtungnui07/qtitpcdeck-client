import {Component, OnInit} from '@angular/core';
import {
  AlertController, IonicModule,
  ItemReorderEventDetail,
  ModalController,
  ViewDidEnter,
  ViewDidLeave,
  ViewWillEnter
} from "@ionic/angular";
import {SettingsService} from "../../services/settings/settings.service";
import {environment} from "../../../environments/environment";
import {DiagnosticService} from "../../services/diagnostic/diagnostic.service";
import {SettingsModalComponent} from "../shared/modals/settings-modal/settings-modal.component";
import {PingService} from "../../services/ping/ping.service";
import {Connection} from "../../datatypes/connection";
import {AddConnectionComponent} from "./modals/add-connection/add-connection.component";
import {ConnectionService} from "../../services/connection/connection.service";
import {WakelockService} from "../../services/wakelock/wakelock.service";
import {Subscription} from "rxjs";
import {ConnectionFailedComponent} from "./modals/connection-failed/connection-failed.component";
import {AppComponent} from "../../app.component";
import {QuickSetupQrCodeData} from "../../datatypes/quick-setup-qr-code-data";
import {
  QrCodeScannerUiComponent
} from "./modals/add-connection/qr-code-scanner/qr-code-scanner-ui/qr-code-scanner-ui.component";
import {LoadingService} from "../../services/loading/loading.service";
import {MacroDeck3DetectionService} from "../../services/macro-deck3/macro-deck3-detection.service";
import {MacroDeck3DetectedComponent} from "./modals/macro-deck3-detected/macro-deck3-detected.component";
import {MacroDeck3PairingComponent} from "./modals/macro-deck3-pairing/macro-deck3-pairing.component";
import {Md3ConnectionService} from "../../services/md3/md3-connection.service";
import {NavigationService} from "../../services/navigation/navigation.service";
import {NavigationDestination} from "../../enums/navigation-destination";


@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  imports: [
    IonicModule,
    QrCodeScannerUiComponent
]
})
export class HomePage implements OnInit, ViewWillEnter, ViewDidEnter, ViewDidLeave {
  clientId: string | undefined;
  version: string | undefined;
  savedConnections: Connection[] = [];
  availableConnections: string[] = [];
  savedConnectionsInitialized = false;
  usbConnectionAvailable: boolean = false;

  private subscription: Subscription = new Subscription();
  private connectionAttempt = 0;
  // Tried once per app run: an offline host would otherwise pop the failure
  // dialog every time the home page re-enters.
  private autoConnectAttempted = false;

  constructor(private settingsService: SettingsService,
              private modalController: ModalController,
              private diagnosticsService: DiagnosticService,
              private connectionService: ConnectionService,
              private alertController: AlertController,
              private wakeLockService: WakelockService,
              private pingService: PingService,
              private loadingService: LoadingService,
              private macroDeck3DetectionService: MacroDeck3DetectionService,
              private md3ConnectionService: Md3ConnectionService,
              private navigationService: NavigationService) {
  }

  ionViewWillEnter(): void {
    // Mapping because this creates a new array and not a reference
    this.availableConnections = this.pingService.availableConnections.map(object => object);
    this.usbConnectionAvailable = this.pingService.usbConnectionAvailable;
  }

  ionViewDidLeave(): void {
    this.pingService.stop();
    this.subscription.unsubscribe();
  }

  async ionViewDidEnter() {
    this.subscription = new Subscription();
    await this.loadConnections();
    this.subscription.add(this.pingService.connectionAvailable.subscribe(async connection => {
      if (!this.availableConnections.includes(connection.id)) {
        this.availableConnections.push(connection.id);
        if (connection.usbConnection) {
          this.usbConnectionAvailable = true;
          if (connection.autoConnect) {
            await this.connect(connection);
          }
          return;
        }

        let savedConnection = this.savedConnections.find(x => x.id == connection.id);
        if (savedConnection?.autoConnect === true) {
          await this.connect(savedConnection);
        }
      }
    }));
    this.subscription.add(this.pingService.connectionUnavailable.subscribe(connection => {
      if (connection.usbConnection) {
        this.usbConnectionAvailable = false;
      }
      if (this.availableConnections.includes(connection.id)) {
        this.availableConnections.splice(this.availableConnections.indexOf(connection.id), 1);
      }
    }));
    this.subscription.add(this.md3ConnectionService.state.subscribe(async state => {
      if (state.stage === "idle") {
        await this.pingService.start();
      }
    }));
    this.subscription.add(this.loadingService.canceled.subscribe(() => {
      this.connectionAttempt++;
    }));
    this.subscription.add(AppComponent.quickSetupLinkScanned.subscribe(async data => {
      await this.openAddConnectionModal(null, data);
    }));
    await this.pingService.start();
    void this.autoConnect();
  }

  // A connection that has succeeded once gets autoConnect persisted, and every
  // later app start goes straight to the deck without a tap. Quietly: a host
  // that is simply offline must not greet the user with a failure dialog.
  private async autoConnect(): Promise<void> {
    if (this.autoConnectAttempted) {
      return;
    }
    const stage = this.md3ConnectionService.state.value.stage;
    if (stage !== "idle" && stage !== "failed") {
      return;
    }
    const connection = this.savedConnections.find(saved => saved.autoConnect === true);
    if (connection === undefined) {
      return;
    }
    this.autoConnectAttempted = true;
    await this.connect(connection, {auto: true});
  }

  private async loadConnections() {
    this.savedConnections = await this.connectionService.getConnections() ?? [];
    this.savedConnectionsInitialized = true;
  }

  async openAddConnectionModal(existingConnection?: Connection | null, quickSetupQrCodeData?: QuickSetupQrCodeData | null) {
    this.pingService.stop();
    let props = {};

    if (existingConnection) {
      props = {
        id: existingConnection?.id,
        name: existingConnection?.name,
        host: existingConnection?.host,
        port: existingConnection?.port ?? 8191,
        useSsl: existingConnection?.ssl ?? false,
        autoConnect: existingConnection?.autoConnect ?? false,
        index: existingConnection?.index ?? 0,
        editConnection: true
      };
    } else if (quickSetupQrCodeData) {
      props = {
        quickSetupQrCodeData: quickSetupQrCodeData
      };
    }

    const modal = await this.modalController.create({
      component: AddConnectionComponent,
      componentProps: props,
      cssClass: "scanner-hide"
    });
    await modal.present();

    const {data, role} = await modal.onWillDismiss();
    if (role === 'confirm') {
      await this.connectionService.addUpdateConnection(data);
    }
    if (role === 'macroDeck3') {
      await this.showMacroDeck3DetectedModal(data.baseUrl, data.name, data.identityFingerprint, true);
    }

    await this.loadConnections();
    await this.pingService.start();
  }

  async handleReorder({event}: { event: CustomEvent<ItemReorderEventDetail> }) {
    this.savedConnections = event.detail.complete(this.savedConnections);
    this.updateIndexes()
    await this.connectionService.saveConnections(this.savedConnections);
  }

  private updateIndexes() {
    for (let i = 0; i < this.savedConnections.length; i++) {
      this.savedConnections[i].index = i;
    }
  }

  async deleteConnection(connection: Connection) {
    const alert = await this.alertController.create({
      subHeader: `Delete the connection ${connection.name}?`,
      buttons: [
        {
          text: 'No',
          role: 'cancel'
        },
        {
          text: 'Yes',
          role: 'confirm',
          handler: async () => {
            await this.connectionService.deleteConnection(connection.id);
            await this.loadConnections();
          },
        }
      ],
    });

    await alert.present();
  }

  async editConnection(connection: Connection) {
    await this.openAddConnectionModal(connection);
  }

  async connect(connection: Connection, options: {auto?: boolean} = {}) {
    this.connectionAttempt++;
    await this.wakeLockService.updateWakeLock();

    // The deck host speaks its own protocol, so it is detected before the
    // socket is opened rather than after it fails.
    if (!connection.usbConnection) {
      await this.loadingService.showLoading(`Connecting to ${connection.name}...`);
      const attempt = this.connectionAttempt;
      const baseUrl = await this.macroDeck3DetectionService.detect(connection);
      if (attempt !== this.connectionAttempt) {
        return;
      }
      await this.loadingService.dismiss();
      if (baseUrl === null) {
        if (options.auto !== true) {
          await this.showConnectionFailedModal(
            "No qtitpcdeck host was found at this address.", connection.name);
        }
        return;
      }
    }

    await this.connectMacroDeck3(connection, options);
  }

  private async connectMacroDeck3(connection: Connection, options: {auto?: boolean} = {}) {
    const attempt = this.connectionAttempt;
    const connected = await this.md3ConnectionService.connect(connection);
    if (attempt !== this.connectionAttempt) {
      return;
    }
    if (connected) {
      // "Connect once, always connected": remember the connection as the one
      // this app opens on its own.
      if (connection.autoConnect !== true) {
        connection.autoConnect = true;
        await this.connectionService.addUpdateConnection(connection);
        this.savedConnections = await this.connectionService.getConnections() ?? [];
      }
      await this.navigationService.navigateTo(NavigationDestination.Deck);
      return;
    }
    if (this.md3ConnectionService.state.value.stage === "needsPairingCode") {
      await this.showMacroDeck3PairingModal(connection);
      return;
    }
    await this.showConnectionFailedModal(
      this.md3ConnectionService.state.value.message ?? "The connection failed.", connection.name);
  }

  private async showMacroDeck3PairingModal(connection: Connection) {
    const modal = await this.modalController.create({
      component: MacroDeck3PairingComponent,
      componentProps: {connection: connection}
    });
    await modal.present();
    const {data, role} = await modal.onWillDismiss();
    if (role !== "confirm" || typeof data !== "string") {
      return;
    }
    if (await this.md3ConnectionService.redeem(connection, data)) {
      await this.navigationService.navigateTo(NavigationDestination.Deck);
      return;
    }
    await this.showConnectionFailedModal(
      this.md3ConnectionService.state.value.message ?? "The pairing code was refused.", connection.name);
  }

  async connectUsb() {
    let usbConnection: Connection = await this.connectionService.getUsbConnection();
    await this.connect(usbConnection);
  }

  async ngOnInit() {
    this.clientId = await this.settingsService.getClientId();
    this.version = await this.diagnosticsService.getVersion();
  }

  protected readonly environment = environment;

  async openSettings() {
    const modal = await this.modalController.create({
      component: SettingsModalComponent
    });
    await modal.present();
    await modal.onWillDismiss();
    await this.pingService.restart();
  }

  private async showMacroDeck3DetectedModal(baseUrl: string | null, name?: string, identityFingerprint?: string | null,
                                            fromConnectLink = false) {
    const modal = await this.modalController.create({
      component: MacroDeck3DetectedComponent,
      componentProps: {
        baseUrl: baseUrl,
        name: name,
        expectedIdentityFingerprint: identityFingerprint ?? null,
        fromConnectLink: fromConnectLink
      }
    });
    await modal.present();
  }

  private async showConnectionFailedModal(errorInformation: string, name: string | undefined) {
    const modal = await this.modalController.create({
      component: ConnectionFailedComponent,
      componentProps: {
        name: name,
        errorInformation: errorInformation
      }
    });
    await modal.present();
  }

}
