# NR Management app: handoff

What the Android app is, what is done, what only a phone can confirm, and
what is left for the owner. No secrets and no private links are kept in
this file.

## The app and the website are one system

- The app is a window onto the **live website**. It loads the same pages,
  uses the same sign-in (username + 6-digit PIN, unchanged) and the same
  live updates. There is **no separate copy of the data** and no local
  database in the app.
- **Any website change reaches the app instantly**, because the app loads
  the live site. Only changes to the app shell itself (files in `mobile/`)
  need a new APK.
- A change made in the app is a change made on the website, and the other
  way round. Realtime updates (the website's own) reach both within
  seconds.
- After the phone wakes up or the connection comes back, the app
  reconnects the website's live updates at once. Pages without a form
  reload after 30 s or more away, because realtime doesn't replay what
  was missed.
- Nothing from the website is cached by the app. The pages are fetched
  with the website's own `no-store` headers. The only things kept on the
  phone are:
  - the page background colour (`shell-colors.json`), so the next start
    has no white flash;
  - the most recent download, in the app's cache;
  - the Diagnostics list (`diagnostics.json`): the last 50 page loads
    with their time, path and result, nothing else.
  - The splash and the offline screen are built into the app.

## What the app shell does (all in `mobile/`)

| Area | Behaviour |
|---|---|
| Feel | No pinch or double-tap zoom, no bounce or glow, no sideways page drag (tables still scroll in their own box), no tap flash, no long-press menu on links, buttons and images, text selection only in fields and table cells. Each tweak has its own flag in `mobile/src/appFeel.js` (`APP_FEEL`). |
| Launch | The native splash stays until the first page has painted, then fades. The root view, WebView, status bar and navigation bar take the page's real background colour, follow the dark/light toggle, and remember it for the next start. |
| Loading | A thin native progress bar during page loads, in-site page switches and file downloads. A **loading watchdog** follows every page switch: a loading skeleton still on screen after 8 s, or a page that hasn't changed for 8 s, is reloaded once by itself; if it sticks again, the error screen with **Retry**. Never a loop. The server is woken (`/api/health`) on launch and on resume. |
| Back (Android) | Closes an open dialog or the mobile menu first, then goes back in page history, then asks "Leave NR Management?". |
| Errors | Native screens instead of browser error pages: offline (retries when the connection returns), server error (retries by itself after 10 s, 20 s and 40 s), page stuck (one automatic reload, then this screen). Each has **Retry**. |
| Keyboard | The page is kept above the Android keyboard, and the focused field scrolls into view. |
| Links | Only the website's own address loads inside the app. Other sites, `tel:`, `mailto:`, `sms:` and WhatsApp open in the phone's own apps. File URLs, cleartext HTTP, mixed content and extra windows are blocked. |
| Session | The website's own cookie, shared with the WebView. After a sign-in or sign-out the app makes Android write the cookie to disk at once, so killing the app right after doesn't undo it. |
| Files | CSV export, order PDF and *Download All Orders* PDF are fetched inside the page with the signed-in session, then **Open** (the phone's PDF/CSV viewer) or **Share** (WhatsApp, Drive, print). |
| Kept blocked on purpose | The account-reset "download a copy, then delete" builds its file inside the page. That can't be saved safely in a WebView, so it fails in the app with the website's own "The download failed, so nothing was deleted" and **deletes nothing**. Do resets with an archive on a computer. |
| Other | Portrait only; app name "NR Management"; package `com.midashq.nrmanagement` (unchanged). |

**Pull-to-refresh is not added.** The website scrolls the whole page and
has its own pull-down gestures in dialogs and the mobile menu. A pull
gesture there would fight the page's own scrolling and could reload a
half-filled form. The app refreshes by itself instead: realtime updates,
plus a reload of pages without a form after time away.

**Safe areas.** The status bar, gesture bar and notch are handled natively
(`react-native-safe-area-context`), with the bars painted in the page
colour. Android WebViews report `env(safe-area-inset-*)` inconsistently,
and the app is portrait only, so the page itself needs no inset CSS. The
injected viewport still sets `viewport-fit=cover`.

## Merging the open PRs

All mobile work is in stacked PRs: **#5 → #6 → #7 → #8 → #9 → #10 → #11
→ #12 → #13 → #14 → #16**. Each is based on the one before. #5 already
targets `master`.

**#15 is not in this chain.** It is the website loading proposal (label
"website change: needs my review"). It only adds a document, and it stays
unmerged until you decide (see "Proposals for the website" below).

Two facts decide how to merge:
- Vercel refuses deploys whose commit author isn't `nrindustry`.
  Commits by `Himkush1414` showed "Deployment was blocked".
- A GitHub merge button creates a new merge commit authored by the
  account that clicks it.

Every commit on these branches is authored by `nrindustry`. So the way
that keeps Vercel deploying is a **fast-forward** of `master` to each PR
head, in order. That is how #3 and #4 were merged. GitHub then marks each
PR as merged by itself.

The assistant didn't run these: pushing to `master` was outside what it
was allowed to do. Run them from a checkout of the repository:

```bash
REPO=Himkush1414/Super-Management-System
git fetch origin
check() {  # live site after each merge: / 307, /login 200, /api/health 200
  for p in / /login /api/health; do
    printf '%s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "https://super-management-system-tau.vercel.app$p")"
  done
}
merge() {  # merge <PR number> <branch>: retarget to master, then fast-forward
  gh api -X PATCH "repos/$REPO/pulls/$1" -f base=master --jq '"#\(.number) base=\(.base.ref) state=\(.state)"'
  git fetch origin
  git merge-base --is-ancestor origin/master "origin/$2" || { echo "not a fast-forward, stop"; return 1; }
  git diff --name-only origin/master "origin/$2" | grep -Ev '^(mobile/|docs/|README\.md$|\.github/workflows/mobile-|supabase/mobile/)' && { echo "unexpected files, stop"; return 1; }
  git push origin "origin/$2:refs/heads/master"    # a normal push: fast-forward only, never --force
  gh pr view "$1" --repo "$REPO" --json state --jq .state   # should print MERGED
}
merge 5  feat/mobile-push;              check
merge 6  ci/mobile-eas-build;           check
merge 7  docs/readme-download;          check
merge 8  feat/mobile-app-feel;          check
merge 9  feat/mobile-launch-colors;     check
merge 10 feat/mobile-navigation-errors; check
merge 11 feat/mobile-downloads;         check
merge 12 chore/mobile-production-apk;   check
merge 13 docs/mobile-handoff;           check
merge 14 feat/mobile-loading-watchdog;  check
merge 16 docs/android-download;         check
```

Wait for the Vercel production deployment to show **Ready** after each
push (GitHub → the commit → status "Vercel"). Then delete the merged
branches. GitHub's "Delete branch" button on each merged PR, or:

```bash
for b in chore/mobile-scaffold feat/mobile-native feat/mobile-push ci/mobile-eas-build docs/readme-download \
         feat/mobile-app-feel feat/mobile-launch-colors feat/mobile-navigation-errors feat/mobile-downloads \
         chore/mobile-production-apk docs/mobile-handoff feat/mobile-loading-watchdog docs/android-download; do git push origin --delete "$b"; done
```

Merging changes nothing on the website. The PRs touch only `mobile/`,
`docs/`, `README.md`, `.github/workflows/mobile-*` and the dormant
`supabase/mobile/`. Vercel redeploys the same website.

The other alternative is GitHub's **Merge** button. It works, but its
merge commit is authored by the clicking account, so Vercel would block
that deployment. The live website would stay as it is, unchanged, but the
deployment shows as blocked.

## Install on a phone

The permanent download link (always the newest release):
<https://github.com/Himkush1414/Super-Management-System/releases/latest/download/NR-Management.apk>,
also as a QR code: [assets/qr-download.png](assets/qr-download.png).

1. Open the link on the phone (or scan the QR code with the camera) and
   download the APK.
2. Open the file. If Android asks, allow installs from that source:
   *Settings → Apps → (your browser) → Install unknown apps*. Tap
   **Install**. If Play Protect warns about an unknown developer: **More
   details → Install anyway**. The app isn't on Google Play.
3. Open **NR Management** and sign in. **A login is still required**: the
   link gives anyone the app, but only the existing staff accounts can see
   anything.

A newer APK installs over the old one and keeps you signed in. Every build
is signed with the same EAS-held key.

## Diagnostics (when a page is slow)

The app keeps a list of its last 50 page loads and switches: time, kind,
page path (never the query string), duration and result (`ok`, `retried`,
`stuck`). Only timings and paths are kept, never page content, data or the
session. To see it: turn on flight mode, then on the offline screen tap the
version number at the bottom **five times**. **Share** sends the list as
text, which is the evidence to compare with Vercel's logs (see
[WEBSITE-LOADING-PROPOSAL.md](WEBSITE-LOADING-PROPOSAL.md) in #15).

## Manual checklist (needs a real phone and a real sign-in)

The assistant never signed in to the live website and never created or
changed data. These need a person with a phone and their own account:

**Sign-in and session**
- [ ] Sign in on the phone with username + 6-digit PIN. It behaves exactly
      like the website in a mobile browser: same errors, same lockout.
- [ ] Swipe the app away (kill it) within 10 seconds of signing in, then
      open it again. You're still signed in.
- [ ] Sign out, kill the app, open it. You're on the sign-in page.
- [ ] Sign in with the **same account** on the phone and on a computer at
      the same time. Both work.

**The app and the website stay in sync**
- [ ] Create a test order on the phone. It appears on the website within
      seconds, without a reload.
- [ ] Edit that order on the website. The change appears on the phone
      within seconds.
- [ ] Move an order's stage on the phone. The website shows the new stage.
- [ ] Put the phone away for 2+ minutes, change an order on the website,
      then open the app. The change is there.
- [ ] Turn on flight mode, then off. The offline screen appears and clears
      by itself, and live updates work again.
- [ ] Delete the test order afterwards, the way you normally would.

**Feel**
- [ ] No pinch zoom; no sideways drag; no bounce at the top or bottom.
- [ ] The orders table still scrolls sideways inside its box, if it's
      wider than the screen.
- [ ] Long-press on a button or link: no menu. Long-press in a text field:
      paste still works.
- [ ] Tap the username and PIN fields. The keyboard never covers the field
      or the **Sign in** button.
- [ ] The dark/light toggle changes the status bar and navigation bar
      colours with the page.

**Page switching (the loading fix)**
- [ ] Switch between Orders, an order, Activity, Settings and back, about
      20 times on mobile data. No tab stays on the grey skeleton for more
      than about 8 s. If one does, the app reloads it by itself.
- [ ] Put the phone away for 2+ minutes on a tab, then open the app and
      switch tabs at once. The tab loads (it may reload itself once).
- [ ] Open Diagnostics (see above) and **Share** the list to yourself.
      Every line should say `ok`; send the list if you see `stuck`.

**Back button**
- [ ] Open a dialog and press back: the dialog closes. Open the menu and
      press back: the menu closes.
- [ ] Back goes to the previous page. On the orders list, back asks "Leave
      NR Management?".

**Files**
- [ ] Orders → **Export CSV** → **Open** shows it in a sheet/CSV app;
      **Share** offers WhatsApp.
- [ ] An order → **PDF** → **Open** shows it in the PDF viewer; **Share**
      → WhatsApp sends it.
- [ ] **Download All Orders** (month) → the PDF opens.

## Back up the Android signing key (do this once, soon)

EAS created and keeps the signing key, a single keystore whose certificate
SHA-256 starts with `7b7176ec` and ends with `71e44b4`. If it's lost,
phones can't update over the installed app.

```bash
cd mobile
npx eas-cli credentials -p android
# → profile: production-apk (or preview: same keystore)
# → Keystore: Manage everything needed to build your project
# → Download existing keystore
```

EAS saves a `.jks` file and shows the keystore password, key alias and key
password. Keep the file **and** the three values together in a password
manager or an encrypted drive, in two places. Delete the `.jks` from
`mobile/` afterwards (it's gitignored, but don't leave it). Never commit,
email or paste it. More: [android-signing.md](android-signing.md).

## Releasing a new APK

Only when files in `mobile/` changed. Run from a checkout of the merged
branch, with the Expo and GitHub tokens in the environment:

```bash
cd mobile
npm ci && npm run typecheck && npm run lint && npm test
npx eas-cli build --platform android --profile production-apk --non-interactive --wait
# the versionCode goes up by itself and the same key is used; note the build's commit and APK URL
curl -sSL -o /tmp/NR-Management.apk "<APK URL from the build page>"
BT=~/toolchain/android-sdk/build-tools/37.0.0
$BT/apksigner verify --print-certs /tmp/NR-Management.apk | grep SHA-256   # must be 7b7176ec…71e44b4
$BT/aapt2 dump badging /tmp/NR-Management.apk | head -1                     # package and versionCode
# secret scan: must print nothing
python3 -I -m zipfile -e /tmp/NR-Management.apk /tmp/apkx && find /tmp/apkx -type f -print0 | xargs -0 strings -n 8 \
  | grep -E -- '-----BEGIN [A-Z ]*PRIVATE KEY|eyJ[A-Za-z0-9_-]{10,}\.eyJ|service_role|sb_secret_|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}'
TAG=android-v1.0.0-vc<N>          # the new versionCode
git tag -a "$TAG" <built commit> -m "NR Management Android 1.0.0 (versionCode <N>)"
git push origin "$TAG"
gh release create "$TAG" /tmp/NR-Management.apk --title "NR Management for Android 1.0.0 (versionCode <N>)" --notes "…" --latest
curl -sIL https://github.com/Himkush1414/Super-Management-System/releases/latest/download/NR-Management.apk | grep -E '^HTTP|^location'
```

The download link and the QR code never change: they always point at the
newest release.

## QR codes

`node mobile/scripts/render-qr.mjs` writes `docs/assets/qr-download.png`
for the permanent link (black on white, error correction H, wide border,
1200 px); `node mobile/scripts/render-qr.mjs <url>=<file.png>` makes one
for any other link. Check a QR code by decoding it:

```bash
uv run --no-project --with zxing-cpp --with pillow python -I -c \
  "import sys,zxingcpp;from PIL import Image;print([r.text for r in zxingcpp.read_barcodes(Image.open(sys.argv[1]))])" docs/assets/qr-download.png
```

## Later, optional

**Push notifications (dormant).** The code is in the app and the server
parts are in `supabase/mobile/`, none of it applied. To turn it on:
1. Create a Firebase project and add `google-services.json` to EAS as the
   `GOOGLE_SERVICES_JSON` file variable.
2. Add `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` to
   the EAS environment.
3. Apply the SQL and deploy the edge function. The owner decides when
   ("APPLY").
4. Rebuild. Details: [mobile-push-setup.md](mobile-push-setup.md).

**Google Play.**
1. A Play Console account (one-time fee).
2. Decide the package name **before** the first upload; it can never
   change there. `com.midashq.nrmanagement` carries the agency's name.
3. Build the `production` profile (an app bundle) and use Play App Signing
   with the EAS key as the upload key.
4. Add a privacy policy page.
5. Expect Google to check "minimum functionality" for website wrappers.
   The native back handling, error screens, file opening/sharing and (once
   on) push help with that.
6. A private or internal-testing track avoids the public review.

**iPhone.** See [ios.md](ios.md). It needs an Apple Developer account and
TestFlight or an App Store listing; the app code already supports iOS.

## Still open for the owner

- **Old passwords in git history:** a credential-looking value was found
  in the history of `supabase/seed.sql` (commit `834f075` and other
  commits that touched that file). The repository is **public**. This is
  on hold by the owner's decision and nothing was changed.
- **Rotate the tokens that were pasted into chat** (GitHub and Expo). After
  rotating, update `~/.config/nr-mobile/tokens.sh` on the build machine
  (it's outside the repository and never committed).
- Push notifications, Firebase, the push SQL and edge function, and the
  Supabase values in EAS: all deliberately not done (see above).
- The signing-key backup (above).

## Proposals for the website (not applied)

**PR #15**, `docs/WEBSITE-LOADING-PROPOSAL.md`, labelled "website change:
needs my review". It explains the stuck tab skeleton:
- The website's router waits for the server with no time limit (verified).
- The database reads that build each tab have no time limit either
  (verified).
- That reads actually stall is assumed: it needs the server logs of a
  signed-in session.

It proposes exact patches: a time limit on reads plus a "Try again" error
page, and parallel reads on three tabs. **Nothing is applied.** The
website, its login, its data and its database are unchanged. Merging #15
only adds the document; applying a patch is a separate decision.
