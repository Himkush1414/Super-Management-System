# Android signing key: keep a backup

Every APK of NR Management is signed with one keystore that **EAS creates
and stores** for the Expo project `@midas-hq/nr-management`. Android
installs an update over the existing app only if it is signed with the
same key. If the key is lost, every phone has to uninstall the app and
install it again. No data is lost, because the app keeps none and
everything is on the website, but everyone has to sign in again.

The application ID is **`com.midashq.nrmanagement`**. It is fixed for
good: a different ID is a different app.

## Download a backup (do this once after the first build)

```bash
cd mobile
npx eas-cli credentials -p android
```

1. Choose the build profile **preview**. It uses the same keystore as
   production.
2. Choose **Keystore: Manage everything needed to build your project →
   Download existing keystore**. The wording can differ slightly between
   eas-cli versions.
3. EAS saves a `.jks` file in the current folder and prints the
   **keystore password**, **key alias** and **key password**.

Then:

- Store the `.jks` file **and** the three values together in a password
  manager or an encrypted offline drive. Keep two copies.
- Delete the `.jks` from the `mobile/` folder. `*.jks` and `*.keystore`
  are gitignored, but don't leave it lying around.
- **Never** commit it, email it or paste the passwords into chat.

## Restore (only if EAS ever loses it)

Run `npx eas-cli credentials -p android`, choose **Keystore → Set up a new
keystore → Upload**, and give it the `.jks` file and the three values.

## Google Play later

If the app ever goes to Google Play, use *Play App Signing* and upload
with this same key as the upload key, so existing installs keep updating.
