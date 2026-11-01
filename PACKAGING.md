# Packaging Crabs vs Toucans as an app

The game is one web page (`index.html`). [Capacitor](https://capacitorjs.com) wraps it in a native iOS and Android app shell. Everything the stores need is ready in this folder:

| What | Where |
|---|---|
| Capacitor settings (app ID `com.lobstergames.crabsvstoucans`) | `capacitor.config.json` |
| Copies the game into `www/` for Capacitor | `tools/build-www.js` (`npm run build`) |
| Icon and splash sources for `@capacitor/assets` | `assets/` |
| Store screenshots, feature graphic | `screenshots/`, `store/` |
| Store text, age rating and privacy answers | `store/listing.md` |
| Privacy policy page | `privacy.html` |

Change the app ID in `capacitor.config.json` **before** registering it with Apple or Google. It can't be changed after the first upload.

## 1. One-time setup (any computer with Node.js)

```bash
npm install @capacitor/core @capacitor/ios @capacitor/android
npm install -D @capacitor/cli @capacitor/assets
npm run build
npx cap add ios        # Mac only
npx cap add android
npm run assets         # makes every icon and splash size from assets/
```

After any change to the game: `npm run sync`.

## 2. iPhone / iPad → TestFlight

You need a **Mac with Xcode** (free from the Mac App Store). Xcode does not run on Windows. If you have no Mac, a cloud Mac build service (for example Codemagic or Ionic Appflow) can build and upload for you from this folder.

1. **Apple Developer website** → Certificates, Identifiers & Profiles → Identifiers → **+** → App IDs → App. Bundle ID: `com.lobstergames.crabsvstoucans` (explicit).
2. **App Store Connect** → Apps → **+** → New App. Platform iOS, name "Crabs vs Toucans", language English (UK), the bundle ID from step 1, SKU e.g. `crabs-vs-toucans`.
3. On the Mac: `npm run sync`, then `npm run open:ios` to open Xcode.
4. In Xcode → App target → **Signing & Capabilities**: tick "Automatically manage signing" and choose your team. Under **General**, set Version `1.0.0` and Build `1`. Choose "Any iOS Device" as the run target.
5. **Product → Archive**. When it finishes, the Organizer opens → **Distribute App** → App Store Connect → Upload.
6. Wait about 10 to 30 minutes for processing. In App Store Connect → your app → **TestFlight**, answer the export compliance question (the game uses no encryption beyond Apple's own, so answer "None of the algorithms mentioned"). Then add yourself as an internal tester.
7. Install the **TestFlight** app on your iPhone and open the invite.

For each new build, increase the Build number in Xcode, then Archive and Upload again.

Useful extra: in Xcode, set the device orientations you want under General → Deployment Info. The game works in all of them.

## 3. Android → Google Play internal testing

Needs **Android Studio** (Windows is fine) and a Google Play developer account ($25 one-off).

1. `npm run sync`, then `npm run open:android`.
2. In Android Studio: **Build → Generate Signed App Bundle** → Android App Bundle → create a new upload key. **Back up the key file and passwords**: you need them for every future update.
3. In the Play Console: Create app → upload the `.aab` under Testing → Internal testing → add testers.

## 4. Before submitting for public release

- **Privacy policy** is live at https://charliederoth.github.io/crabs-vs-toucans/privacy.html (GitHub Pages). Paste that link into both stores.
- Fill in the store text, screenshots, age rating and privacy answers from `store/listing.md`.
- Test on real phones: touch, sound (iPhone needs one tap before audio plays, which the game handles), saves after closing the app, and speed on an older phone.

## Notes

- Saves use the web view's local storage, which persists inside the app. iOS may clear it if the phone is extremely low on space, and that's what **Settings → Back up** is for.
- The game makes no network requests, so no extra permissions are needed.
