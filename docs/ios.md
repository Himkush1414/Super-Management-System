# iPhone (iOS): what is ready and what is needed

**Status: prepared, NOT built, NOT verified on an iPhone.** No iOS build
has been made, and nothing about iOS (sign-in, push, downloads) has been
tested on a device.

An APK link or QR code **cannot** install anything on an iPhone. iOS only
installs apps through Apple: the App Store, TestFlight, or a
device-registered (Ad Hoc) build.

## Already in the code

- One Expo codebase. The iOS bundle identifier is
  **`com.midashq.nrmanagement`**, the same as the Android ID.
- HTTPS only (App Transport Security, no arbitrary loads).
  `ITSAppUsesNonExemptEncryption = false`, so App Store Connect doesn't
  ask the export-compliance question.
- Swipe-back gesture through the website's history, safe areas, and a
  status bar that follows the website's dark/light theme.
- Push through APNs: the same Edge Function and Expo push service as
  Android. No Firebase is needed for iOS.
- Downloads (order PDFs, CSV) open the iOS share sheet: *Save to Files*,
  AirDrop, print.
- No camera, photo or location access, so no permission-description
  strings are needed. The website uses none of these. The only system
  prompt is for notifications.

## What you need

1. **A paid Apple Developer Program membership** (USD 99/year) at
   <https://developer.apple.com/programs/>. For a company account, enroll
   as an **Organization**, which needs a D-U-N-S number and takes a few
   days. An Individual account is faster, but your personal name is
   shown as the seller.
2. Your Apple ID added to the Expo project, or used when EAS asks.
3. Then:
   ```bash
   cd mobile
   npx eas-cli build -p ios --profile production   # EAS creates the certificate,
                                                    # provisioning profile and APNs push key
   npx eas-cli submit -p ios                        # uploads to App Store Connect / TestFlight
   ```

## How staff can install it: the real options

| Option | Who can install | Apple review | Notes |
|---|---|---|---|
| **TestFlight, internal** | Up to 100 people who are users on your App Store Connect team | None | Easiest start. Each build expires after **90 days**, so re-upload regularly. |
| **TestFlight, external** | Up to 10,000 people by email or public link | Beta App Review (light) | Same 90-day expiry. |
| **Ad Hoc** (EAS internal distribution) | Up to 100 registered iPhones per year (`npx eas-cli device:create`) | None | Installs from an Expo link, but only on the registered devices. |
| **App Store, Unlisted** | Anyone with the direct link; not searchable | Full App Review | Apple must approve the unlisted request. |
| **Custom App** (Apple Business Manager) | Only your organization's devices | Full App Review | Made for internal business apps. Needs an Organization account. |
| **App Store, public** | Everyone | Full App Review | Highest rejection risk for this app (below). |

The Enterprise Program (in-house distribution) needs 100+ employees and
isn't a fit.

## App Store review risks for a WebView app

- **Guideline 4.2, Minimum Functionality:** Apple often rejects apps that
  are "a repackaged website". In our favour: native push notifications
  for new orders, a native offline screen, native file saving and
  sharing, and a back gesture. It is still a real risk for a public
  listing. **Unlisted** or **Custom App** distribution, or TestFlight,
  avoid most of it.
- **Guideline 2.1 / 5.1.1, sign-in:** the reviewer must be able to sign
  in. That means giving Apple a demo username and PIN. Be careful: that
  account would see **live business data**. Only do it with an account
  limited to harmless data, or choose TestFlight internal / Ad Hoc, which
  need no review.
- **Guideline 5.1.1, account deletion:** apps that let people create
  accounts must let them delete them. Accounts here are fixed and cannot
  be created in the app, so this should not apply, but be ready to
  explain it in the review notes.
- **Privacy:** App Store Connect asks for a privacy policy URL and
  "App Privacy" answers. The app itself collects nothing; the website
  handles business data.

**Recommendation:** start with **TestFlight (internal)** for the few
iPhone users. There is no review and the setup is quickest. Move to a
**Custom App** later if more iPhones are needed.
