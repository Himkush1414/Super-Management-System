# New-order push notifications: one-time setup

The NR Management app already builds, installs and runs without any of
this. It shows the live website with realtime updates; it just doesn't
register for push. Do these steps once, in order, to turn on "new order"
notifications. Every step is done **by hand by you**. Nothing in this
repository changes the live database, Supabase settings or Firebase by
itself.

**What you get:** when an order is punched (on the website or in the
app), these people's phones get a notification with sound, even if the app is
closed:

* the production members the order was sent to
* admin and head_admin

The marketing account that punched the order is not notified. A
notification reads, for example:

> **New order · Shree Ganesh Traders**
> TRANSFORMER 250 KVA · Qty 2 · Delivery 05/11/2026

It never shows a price, GST or amount. Tapping it opens that order.

**How it works:** the database inserts the order → a trigger queues one
HTTPS call (pg_net, after the insert commits) → the `notify-new-order`
Edge Function → the Expo Push API → FCM (Android) / APNs (iOS) → the
phone. It is triggered by the database insert, not by the app, so orders
from the website and from the app both notify. Each order can notify only
once (`order_push_log`).

You need:

* the Firebase console (a Google account)
* the Expo account `midas-hq` (`npx eas-cli login`, or `EXPO_TOKEN` in your shell)
* the Supabase dashboard of project `ywzwzrzlittjiosskmcy`

Run every `eas` command below from the `mobile/` folder.

---

## A. Firebase (Android delivery)

1. Open <https://console.firebase.google.com>, then **Create a project**.
   Name it `NR Management`. Google Analytics can be off. Click **Create
   project**.
2. On the project overview, click the **Android** icon (*Add app*).
   * Android package name: **`com.midashq.nrmanagement`** (exactly this;
     it can never change).
   * App nickname: `NR Management`. Leave SHA-1 empty.
   * Click **Register app**, then **Download google-services.json**. Skip
     the remaining SDK steps (Expo already does them).
3. Give the file to EAS as a **secret file variable**. Never commit it;
   it is gitignored.
   ```bash
   cd mobile
   npx eas-cli env:set --name GOOGLE_SERVICES_JSON --type file \
     --value ./google-services.json --visibility secret \
     --environment preview --environment production
   ```
   Then delete the local copy: `rm google-services.json`.
4. Create the FCM V1 key that lets Expo send through your Firebase
   project. In Firebase, go to ⚙ **Project settings → Service accounts →
   Generate new private key → Generate key**. A JSON file downloads.
   Treat it like a password.
5. Upload it to Expo:
   ```bash
   npx eas-cli credentials -p android
   ```
   Choose the `preview` build profile, then **Google Service Account →
   Manage your Google Service Account Key for Push Notifications (FCM V1)
   → Set up a Google Service Account Key for Push Notifications (FCM V1)
   → Upload a new service account key**, and give the path to the JSON
   file. Then delete the JSON file from your computer.

## B. Supabase (the trigger and the function)

All in the dashboard of project `ywzwzrzlittjiosskmcy`. Both SQL files
only **add** new objects. They change no existing table, row, policy or
function.

1. **SQL Editor → New query.** Paste all of
   `supabase/mobile/001_device_tokens.sql` and click **Run**.
2. **Make the shared secret.** On your computer, run `openssl rand -hex 32`
   and copy the output. It is used twice below. Don't save it in any file
   in the repository.
3. **Deploy the Edge Function** (pick one):
   * **Dashboard:** go to **Edge Functions → Deploy a new function → Via
     Editor**. Name it **`notify-new-order`**, replace the sample code with
     all of `supabase/mobile/functions/notify-new-order/index.ts`, and
     click **Deploy**. Then open the function's **Details**, turn **Verify
     JWT** **off**, and save. The trigger authenticates with the secret
     header instead.
   * **CLI** (from the repository root):
     ```bash
     mkdir -p supabase/functions/notify-new-order
     cp supabase/mobile/functions/notify-new-order/index.ts supabase/functions/notify-new-order/
     supabase functions deploy notify-new-order --project-ref ywzwzrzlittjiosskmcy --no-verify-jwt
     rm -r supabase/functions/notify-new-order
     ```
4. **Function secret:** go to **Edge Functions → Secrets → Add new
   secret**. Name it `NR_WEBHOOK_SECRET` and paste the value from step 2.
   Only if you later turn on *Enhanced Security for Push Notifications* in
   Expo, also add `EXPO_ACCESS_TOKEN`. `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` are provided automatically.
5. **Vault secret** (same value): in the SQL Editor run
   ```sql
   select vault.create_secret('<the value from step 2>', 'nr_push_webhook_secret',
                              'NR Management new-order push webhook');
   ```
   Then clear the editor tab, so the value isn't left in a saved query.
6. **SQL Editor:** paste all of `supabase/mobile/002_new_order_push.sql`
   and **Run**. It enables `pg_net` if it isn't already on, and adds the
   trigger.
7. **SQL Editor:** run `supabase/mobile/verify.sql`. Every row of the
   first result must say `true`.

> Tell Claude **"APPLY"** once you have done steps 1–7, so nothing assumes
> they're live before then.

## C. EAS variables for the app build

The app needs the public Supabase URL and anon key to register phones.
The anon key is public by design, but it still lives in EAS, not in git.
Use the same values as the website's `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY`:

```bash
npx eas-cli env:set --name EXPO_PUBLIC_SUPABASE_URL --value https://ywzwzrzlittjiosskmcy.supabase.co \
  --visibility plaintext --environment preview --environment production
npx eas-cli env:set --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value '<anon key>' \
  --visibility sensitive --environment preview --environment production
```

## D. Rebuild and install

```bash
npx eas-cli build -p android --profile preview
```

Install the new APK over the old one. App data and logins are kept
because the signing key is the same. On each phone, sign in and tap
**Allow** when Android asks about notifications.

## E. Check it (you do this; never with a test order)

* Wait for the next real order, or punch one only if you choose to.
  Within a few seconds the assigned production member's phone and the
  admins' phones should sound.
* In the SQL Editor, run the second and third queries of `verify.sql`.
  `order_push_log` shows, per order, how many recipients and devices
  there were and how many notifications were sent or failed.
  `net._http_response` shows the function's replies (status 200).
* If a phone gets nothing, check that:
  * notifications are allowed for *NR Management* in Android settings,
    and the *New orders* channel is on
  * the person signed in on that phone at least once after step D
  * battery optimisation isn't set to *Restricted* for the app (some
    Xiaomi/Oppo/Vivo phones block background notifications)

## Turning it off

Run `supabase/mobile/rollback.sql`. It removes only the trigger;
notifications stop and every table and row stays. To turn it back on,
re-run `002_new_order_push.sql`.

## iOS

The same Edge Function and Expo push service deliver to iPhones through
APNs. It needs a paid Apple Developer account and an iOS build. See
[`ios.md`](ios.md). Not built or verified yet.
