#!/usr/bin/env bash
# Builds the Android APK.
#
#   bash scripts/build-apk.sh                    # against the deployed Render URL
#   SERVER_URL=http://192.168.1.5:2567 bash scripts/build-apk.sh   # against a LAN server
#
# Requirements: JDK 21, Android SDK (platform-tools, platforms;android-35,
# build-tools;34+), and `npm install` already run inside ./mobile.
# On a fresh machine the GitHub Actions workflow does all of this for you.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_URL="${SERVER_URL:-https://aimong-us.onrender.com}"
VERSION="$(node -p "require('$ROOT/package.json').version")"

: "${ANDROID_HOME:=${ANDROID_SDK_ROOT:-}}"
if [ -z "${ANDROID_HOME}" ]; then
  echo "ANDROID_HOME (or ANDROID_SDK_ROOT) must point at an Android SDK" >&2
  exit 1
fi
export ANDROID_HOME ANDROID_SDK_ROOT="$ANDROID_HOME"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$HOME/.gradle}"

echo "▸ building the web client against $SERVER_URL"
cd "$ROOT"
VITE_SERVER_URL="$SERVER_URL" pnpm --filter @aimong/client build

echo "▸ staging assets into mobile/www"
rm -rf mobile/www
mkdir -p mobile/www
cp -r apps/client/dist/. mobile/www/

echo "▸ capacitor sync"
cd mobile
if [ ! -d node_modules ]; then npm install --silent; fi
npx cap sync android

echo "▸ gradle assembleDebug (JDK ${JAVA_HOME:-system})"
cd android
echo "sdk.dir=$ANDROID_HOME" > local.properties
./gradlew --no-daemon assembleDebug

APK=app/build/outputs/apk/debug/app-debug.apk
OUT="$ROOT/docs/app/aimong-us-${VERSION}.apk"
mkdir -p "$ROOT/docs/app"
cp "$APK" "$OUT"
( cd "$ROOT/docs/app" && sha256sum "aimong-us-${VERSION}.apk" > "aimong-us-${VERSION}.apk.sha256" )

SIZE=$(du -h "$OUT" | cut -f1)
echo
echo "✅ $OUT ($SIZE)"
echo "   sha256: $(cut -d' ' -f1 "$ROOT/docs/app/aimong-us-${VERSION}.apk.sha256")"
echo
echo "Install on the phone:"
echo "  1. Copy the APK to the phone (or download it from the GitHub Actions run)."
echo "  2. Tap it → allow 'install unknown apps' for Chrome/Files when asked."
echo "  3. Open AImong Us from the home screen."
