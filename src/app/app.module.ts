import {NgModule, isDevMode} from '@angular/core';
import {BrowserModule} from '@angular/platform-browser';

import {IonicModule} from '@ionic/angular';

import {AppComponent} from './app.component';
import {FormsModule} from "@angular/forms";
import {IonicStorageModule} from "@ionic/storage-angular";
import {ServiceWorkerModule} from '@angular/service-worker';
import {SettingsModalComponent} from "./pages/shared/modals/settings-modal/settings-modal.component";
import {HttpClientModule} from "@angular/common/http";
import {WebHomePageModule} from "./pages/web-home/web-home.module";
import {HomePageModule} from "./pages/home/home.module";
import {DeckPageModule} from "./pages/deck/deck.module";
import {ConnectionLostPageModule} from "./pages/connection-lost/connection-lost.module";
import {environment} from "../environments/environment";

@NgModule({
    imports: [
        BrowserModule,
        HttpClientModule,
        IonicModule.forRoot({ swipeBackEnabled: false }),
        IonicStorageModule.forRoot(),
        FormsModule,
        WebHomePageModule,
        HomePageModule,
        DeckPageModule,
        ConnectionLostPageModule,
        ServiceWorkerModule.register('ngsw-worker.js', {
            // Only the hosted web version is a PWA; in the native app a
            // surviving worker served stale bundles over app updates.
            enabled: !isDevMode() && environment.webVersion,
            // Register the ServiceWorker as soon as the application is stable
            // or after 30 seconds (whichever comes first).
            registrationStrategy: 'registerWhenStable:30000'
        }),
        AppComponent,
        SettingsModalComponent
    ],
    providers: [],
    bootstrap: [AppComponent],
})
export class AppModule {
}
