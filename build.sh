#!/usr/bin/env bash
# Builds a signed, installable APK without the Google-hosted Android SDK.
#
# Everything here comes from Debian/Ubuntu packages:
#   aapt2, zipalign, apksigner   -> aapt/zipalign/apksigner
#   dx (dexer)                   -> dalvik-exchange
#   android.jar                  -> android-sdk-platform-23
#
#   sudo apt-get install -y aapt zipalign apksigner dalvik-exchange \
#        android-sdk-build-tools android-sdk-platform-23
set -euo pipefail

SDK=${ANDROID_SDK:-/usr/lib/android-sdk}
DX=${DX:-$SDK/build-tools/29.0.3/dx}

# Linked against API 23 (the newest android.jar Debian ships) but the manifest
# declares targetSdk 34, which is what governs runtime behaviour on the device.
PLATFORM=$SDK/platforms/android-23/android.jar

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
APP=$ROOT/app
OUT=$ROOT/build
DIST=$ROOT/dist
KS=${KEYSTORE:-$ROOT/keystore/planner.keystore}
KS_PASS=${KEYSTORE_PASS:-plannerdebug}
APK=$DIST/paycheck-planner.apk

MIN_SDK=23
TARGET_SDK=34
VERSION_CODE=${VERSION_CODE:-1}
VERSION_NAME=${VERSION_NAME:-1.0}

# JAVA_TOOL_OPTIONS makes every JVM print a banner to stderr; drop just that line.
quiet() { "$@" 2> >(grep -v 'Picked up JAVA_TOOL_OPTIONS' >&2); }

say() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mxxx\033[0m %s\n' "$*" >&2; exit 1; }

for t in aapt2 zipalign apksigner keytool javac zip; do
  command -v "$t" >/dev/null || die "missing tool: $t"
done
[ -f "$PLATFORM" ] || die "missing android.jar at $PLATFORM"
[ -x "$DX" ]       || die "missing dexer at $DX"

rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" "$DIST" "$(dirname "$KS")"

say "Compiling resources"
aapt2 compile --dir "$APP/res" -o "$OUT/res.zip"

say "Linking resources, manifest and assets"
aapt2 link \
  -o "$OUT/base.apk" \
  -I "$PLATFORM" \
  --manifest "$APP/AndroidManifest.xml" \
  -A "$APP/assets" \
  --java "$OUT/gen" \
  --min-sdk-version "$MIN_SDK" \
  --target-sdk-version "$TARGET_SDK" \
  --version-code "$VERSION_CODE" \
  --version-name "$VERSION_NAME" \
  "$OUT/res.zip"

say "Compiling Java (source/target 8 so dx can read it)"
mapfile -t SRC < <(find "$APP/src" "$OUT/gen" -name '*.java')
quiet javac --release 8 -nowarn -encoding UTF-8 \
  -classpath "$PLATFORM" \
  -d "$OUT/classes" \
  "${SRC[@]}"

say "Dexing"
quiet "$DX" --dex --min-sdk-version="$MIN_SDK" --output="$OUT/classes.dex" "$OUT/classes"

say "Packaging dex into the APK"
( cd "$OUT" && zip -q -X base.apk classes.dex )

say "Aligning"
zipalign -p -f 4 "$OUT/base.apk" "$OUT/aligned.apk"

if [ ! -f "$KS" ]; then
  say "Creating a signing key (first run only — keep it to update in place)"
  quiet keytool -genkeypair -v \
    -keystore "$KS" -storetype PKCS12 \
    -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -alias planner -keyalg RSA -keysize 2048 -validity 10950 \
    -dname "CN=Paycheck Planner, OU=Personal, O=Paycheck Planner, C=US" >/dev/null
fi

say "Signing"
quiet apksigner sign \
  --ks "$KS" --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --ks-key-alias planner \
  --min-sdk-version "$MIN_SDK" \
  --v1-signing-enabled true \
  --v2-signing-enabled true \
  --v3-signing-enabled true \
  --out "$APK" \
  "$OUT/aligned.apk"

say "Verifying"
quiet apksigner verify --min-sdk-version "$MIN_SDK" --verbose "$APK"

printf '\n\033[1;32m==>\033[0m Built %s (%s)\n' "$APK" "$(du -h "$APK" | cut -f1)"
