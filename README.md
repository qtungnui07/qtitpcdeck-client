# qtitpcdeck client

The phone client for [qtitpcdeck](https://github.com/qtungnui07/qtitpcdeck):
a full-screen deck of live widget trees driven by the host over its UI
session protocol.

This app is a **fork of [Macro Deck Client](https://github.com/Macro-Deck-App/Macro-Deck-Client-App)**
(Ionic + Angular, Apache-2.0), reworked for qtitpcdeck. Highlights of the
rework:

- Speaks the qtitpcdeck deck protocol: one session per visible widget, live
  patches, presses dispatched back as widget triggers.
- Pairs once - the host's refresh cookie is persisted and replayed, so later
  app starts go straight to the deck.
- The grid re-measures on rotation, icons decode correctly from the bridge's
  base64 responses, and the UI is rebranded to qtitpcdeck.
- The native build ships no service worker (one left stale bundles in the
  WebView across APK updates).

## Building the Android APK

```sh
npx ng build app --configuration production
npx cap sync android
cd android
JAVA_HOME=<jdk 21> ./gradlew assembleDebug
# android/app/build/outputs/apk/debug/app-debug.apk
```

## License

Apache-2.0, as upstream. Substantial portions (c) the Macro Deck authors.
