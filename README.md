# Motion

Motion is an Android-first, local-first fitness and health app. This repository currently contains the Milestone 0 foundation only: the mobile shell, Android/Capacitor project, and native SQLite persistence probe. Product domain behavior starts in Milestone 1.

## Repository layout

- `apps/mobile` — React, TypeScript, Vite, Tailwind, and Capacitor Android app
- `apps/api` — intentionally empty API workspace reserved by the accepted architecture
- `packages/domain` — future platform-neutral domain logic
- `packages/shared` — future shared contracts and utilities
- `packages/recommendation` — future deterministic recommendation logic
- `packages/integrations` — future integration adapters
- `docs` — accepted product and engineering specifications

## Prerequisites

- Node.js 22.12 or newer
- Corepack, used to provide the repository-pinned pnpm release
- Android Studio and the Android SDK for native builds
- JDK 21 for the generated Capacitor Android project

## Development

```powershell
corepack pnpm install
corepack pnpm dev
```

Run the complete web-side validation suite with:

```powershell
corepack pnpm validate
```

Build and sync the web bundle into Android with:

```powershell
corepack pnpm cap:sync
```

Then open the native project with `corepack pnpm android:open`, select a Samsung device or emulator, and run the `app` configuration.

## Release signing

The Android application ID is permanently fixed at `app.motion`. Generate one private release key once, keep its passwords in a password manager, and store two offline backups outside this repository. Never commit the key or `keystore.properties`.

With JDK 21 installed, create a long-lived PKCS12 key outside the repository:

```powershell
keytool -genkeypair -v -keystore "$env:USERPROFILE\motion-release.jks" -storetype PKCS12 -alias motion -keyalg RSA -keysize 4096 -validity 10000
```

Copy `apps/mobile/android/keystore.properties.example` to `apps/mobile/android/keystore.properties`, fill in the absolute key path and passwords, then build with:

```powershell
Set-Location apps/mobile/android
.\gradlew.bat assembleRelease -PmotionVersionCode=1 -PmotionVersionName=1.0.0
```

The Gradle configuration fails a release build when the signing properties are absent; debug builds remain available for development.

## Native M0 acceptance check

On native startup, Motion opens the SQLite database named `motion`, creates only the technical `m0_storage_probe` table, and reads or creates one stable installation record. Logcat reports `Native SQLite persistence probe passed` without printing its identifier.

To complete M0 device acceptance:

1. Install and launch the signed APK on a supported Samsung device.
2. Exercise all five tabs and the Coach placeholder.
3. Force-stop and relaunch; confirm there is no crash and the persistence-probe success log appears.
4. Reboot the device and repeat the check.
5. Build `-PmotionVersionCode=2 -PmotionVersionName=1.0.1`, install it with `adb install -r`, and confirm the app upgrades without uninstalling and the success log still appears.
