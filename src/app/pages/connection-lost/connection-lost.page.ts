import {Component} from '@angular/core';
import {Connection} from "../../datatypes/connection";
import {Subscription} from "rxjs";
import {NavigationService} from "../../services/navigation/navigation.service";
import {NavigationDestination} from "../../enums/navigation-destination";
import {IonicModule, ViewDidEnter, ViewDidLeave} from "@ionic/angular";
import {Md3ConnectionService} from "../../services/md3/md3-connection.service";

@Component({
  selector: 'app-connection-lost',
  templateUrl: './connection-lost.page.html',
  styleUrls: ['./connection-lost.page.scss'],
  imports: [
    IonicModule
  ]
})
export class ConnectionLostPage implements ViewDidEnter, ViewDidLeave {

  retryCountdown: number = 10;

  connection: Connection | null = null;

  private subscription: Subscription = new Subscription();

  private interval: any;

  constructor(private md3ConnectionService: Md3ConnectionService,
              private navigationService: NavigationService) {
    this.connection = md3ConnectionService.connection();
  }

  ionViewDidLeave() {
    this.subscription.unsubscribe();
  }

  async ionViewDidEnter() {
    this.subscription.add(this.md3ConnectionService.state.subscribe(state => {
      if (state.stage === "failed") {
        void this.startRetry();
      }
    }));
    await this.startRetry();
  }

  async startRetry() {
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
    if (this.connection == null) {
      await this.navigationService.navigateTo(NavigationDestination.Home);
      return;
    }
    await this.md3ConnectionService.connect(this.connection);
  }

  async cancel() {
    clearInterval(this.interval);
    await this.navigationService.navigateTo(NavigationDestination.Home);
  }
}
