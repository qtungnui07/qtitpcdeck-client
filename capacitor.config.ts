import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.suchbyte.macrodeck',
  appName: 'qtitpcdeck',
  webDir: 'www',
  server: {
    androidScheme: 'http'
  },
  ios: {
    scheme: 'Macro Deck Client'
  }
};

export default config;
