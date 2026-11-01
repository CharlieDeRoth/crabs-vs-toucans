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

Done already: the bundle ID `com.lobstergames.crabsvstoucans` is registered and the app exists in App Store Connect.

### 2a. Without a Mac: GitHub Actions (free for this public repo)

`.github/workflows/ios-testflight.yml` builds the app on a GitHub-hosted Mac, signs it and uploads it to TestFlight.

One-time setup:
1. **App Store Connect** → Users and Access → **Integrations** → App Store Connect API → Team Keys → **+**. Name it "GitHub Actions" and give it **Admin** access (needed so Xcode can create the signing certificate in the cloud). Download the `.p8` file. Apple only lets you download it once, so keep it safe and never commit it.
2. Note the **Key ID** (in the keys list) and the **Issuer ID** (shown above the list).
3. **GitHub** → the repo → Settings → Secrets and variables → Actions → **New repository secret**, three times:
   - `ASC_KEY_ID`: the Key ID
   - `ASC_ISSUER_ID`: the Issuer ID
   - `ASC_KEY_P8`: open the `.p8` file in Notepad and paste all of it, including the BEGIN and END lines

Each build: GitHub → **Actions** → "iOS build to TestFlight" → **Run workflow**, or push a tag like `v1.0.1`. The build number counts up automatically. The version comes from `package.json`. After about 10 to 30 minutes of Apple processing, the build appears under TestFlight. Add yourself as an internal tester, then install it with the **TestFlight** app on your iPhone.

### 2b. With a Mac and Xcode

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
