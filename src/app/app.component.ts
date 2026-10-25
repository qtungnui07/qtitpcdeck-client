import {AfterViewInit, Component, EventEmitter, OnInit} from '@angular/core';
import {Storage} from "@ionic/storage";
import {WakelockService} from "./services/wakelock/wakelock.service";
import {ScreenOrientationService} from "./services/screen-orientation/screen-orientation.service";
import {SslHandler} from "../../capacitor_plugins/sslhandler/src";
import {SettingsService} from "./services/settings/settings.service";
import {DiagnosticService} from "./services/diagnostic/diagnostic.service";
import {ThemeService} from "./services/theme/theme.service";
import {HomePage} from "./pages/home/home.page";
import {environment} from "../environments/environment";
import {WebHomePage} from "./pages/web-home/web-home.page";
import {App, URLOpenListenerEvent} from "@capacitor/app";
import {QuickSetupQrCodeData} from "./datatypes/quick-setup-qr-code-data";
import {QrCodeScannerComponent} from "./pages/home/modals/add-connection/qr-code-scanner/qr-code-scanner.component";
import {IonicModule} from "@ionic/angular";

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  imports: [
    IonicModule
  ]
})
export class AppComponent implements OnInit {
  public static quickSetupLinkScanned: EventEmitter<QuickSetupQrCodeData> = new EventEmitter();

  constructor(private storage: Storage,
              private wakeLockService: WakelockService,
              private screenOrientationService: ScreenOrientationService,
              private settingsService: SettingsService,
              private diagnosticService: DiagnosticService,
              private themeService: ThemeService) {
  }

  rootComponent = environment.webVersion ? WebHomePage : HomePage;

  async ngOnInit() {
    await this.storage.create();
    // The native app used to ship a service worker. The WebView keeps both the
    // registration and its precached bundle per origin (https://localhost), so
    // an installed APK update was still served the previous JavaScript - fixes
    // never reached the phone. The native build no longer ships one, and this
    // cleans out what an older install left behind. The hosted web version
    // keeps its worker.
    if (!environment.webVersion && 'serviceWorker' in navigator) {
      void navigator.serviceWorker.getRegistrations().then(registrations => {
        for (const registration of registrations) {
          void registration.unregister();
        }
      });
      if ('caches' in window) {
        void caches.keys().then(keys => {
          for (const key of keys) {
            void caches.delete(key);
          }
        });
      }
    }
    await this.screenOrientationService.updateScreenOrientation();
    await this.wakeLockService.updateWakeLock();
    await this.themeService.updateTheme();

    if (this.diagnosticService.isAndroid()) {
      let skipSslValidation = await this.settingsService.getSkipSslValidation();
      SslHandler.skipValidation({value: skipSslValidation});
    }

    App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
      const dataBase64 = event.url.split("quick-setup/").pop();
      if (dataBase64) {
        const dataJson = atob(dataBase64);
        const data = JSON.parse(dataJson) as QuickSetupQrCodeData;
        AppComponent.quickSetupLinkScanned.emit(data);
      }
    });
  }
}
