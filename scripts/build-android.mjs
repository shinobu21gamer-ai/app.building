#!/usr/bin/env node
/**
 * Builds an installable Android APK for BarangayResolve.
 *
 * Why this script exists: the APK is a thin Capacitor WebView that loads the
 * deployed site (`server.url` in capacitor.config.ts). The URL lives in
 * `android/app/src/main/assets/capacitor.config.json`, which Capacitor only
 * writes when `npx cap sync android` runs. Building with Gradle alone (Android
 * Studio "Run", or `gradlew assembleDebug` in a fresh checkout) skips that step,
 * and the resulting APK falls back to the (empty) local bundle — it opens to a
 * blank screen. This script always syncs first.
 *
 * Usage:
 *   node scripts/build-android.mjs                 # debug APK (self-signed, sideloadable)
 *   node scripts/build-android.mjs --release       # release APK (needs android/keystore.properties)
 *   node scripts/build-android.mjs --sync-only     # just re-sync the Capacitor assets
 *   node scripts/build-android.mjs --push-config <path>
 *                                                  # install a google-services.json (kept
 *                                                  # outside the repo) before building
 *   node scripts/build-android.mjs --allow-missing-push
 *                                                  # build anyway, accepting that this APK
 *                                                  # cannot receive push alerts
 *
 * android/app/google-services.json is deliberately gitignored, so a fresh
 * checkout (or a build on another machine) silently produced an APK with no
 * Firebase project: push alerts could never register, and asking the plugin to
 * try ended in an unhandled native exception that closed the app. Missing
 * configuration is now a build failure unless it is explicitly accepted.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const ANDROID_DIR = path.join(ROOT, "android");
const ASSETS_DIR = path.join(ANDROID_DIR, "app", "src", "main", "assets");
const CONFIG_JSON = path.join(ASSETS_DIR, "capacitor.config.json");
const PLUGINS_JSON = path.join(ASSETS_DIR, "capacitor.plugins.json");

const args = process.argv.slice(2);
const wantsRelease = args.includes("--release");
const syncOnly = args.includes("--sync-only");
const allowMissingPush = args.includes("--allow-missing-push");
const pushConfigFlag = args.indexOf("--push-config");
const pushConfigSource = pushConfigFlag === -1 ? null : args[pushConfigFlag + 1] ?? null;
const isWindows = process.platform === "win32";

if (pushConfigFlag !== -1 && !pushConfigSource) {
  console.error("\n--push-config needs the path to a google-services.json file.");
  process.exit(1);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    stdio: "inherit",
    shell: isWindows,
    ...options,
  });
  if (result.error) {
    console.error(`\nFailed to run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`\n${command} ${commandArgs.join(" ")} exited with code ${result.status}.`);
    process.exit(result.status ?? 1);
  }
}

// ---------------------------------------------------------------------------
// 1. Capacitor sync - writes capacitor.config.json (the remote URL this app
//    loads) and capacitor.plugins.json (plugin registration) into the APK.
// ---------------------------------------------------------------------------
mkdirSync(ASSETS_DIR, { recursive: true }); // Capacitor's copy step does not create it
console.log("==> Syncing Capacitor assets (npx cap sync android)");
run("npx", ["cap", "sync", "android"]);

for (const file of [CONFIG_JSON, PLUGINS_JSON]) {
  if (!existsSync(file)) {
    console.error(
      `\n${path.relative(ROOT, file)} is missing after ` +
        "`npx cap sync android`.\n" +
        "An APK built without it opens to a blank screen. Fix the sync step before building."
    );
    process.exit(1);
  }
}

let serverUrl = null;
try {
  serverUrl = JSON.parse(readFileSync(CONFIG_JSON, "utf8"))?.server?.url ?? null;
} catch {
  // Malformed JSON is reported by the sync step above; keep going.
}
console.log(
  serverUrl
    ? `    App will load: ${serverUrl}`
    : "    WARNING: no server.url in capacitor.config.json - the APK will load bundled assets."
);

if (syncOnly) {
  console.log("\nSync complete (nothing was built).");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 2. Pre-flight checks
// ---------------------------------------------------------------------------
if (!existsSync(path.join(ASSETS_DIR, "capacitor.plugins.json"))) {
  console.error("\ncapacitor.plugins.json missing - aborting before Gradle.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 3. Firebase configuration
//
// The APK cannot register for push alerts without it, and the app now says so
// instead of dying. Copy the file in first when one was passed, then decide
// whether building without it is acceptable.
// ---------------------------------------------------------------------------
const googleServices = path.join(ANDROID_DIR, "app", "google-services.json");

if (pushConfigSource) {
  const source = path.resolve(ROOT, pushConfigSource);
  if (!existsSync(source)) {
    console.error(`\n--push-config file not found: ${source}`);
    process.exit(1);
  }
  copyFileSync(source, googleServices);
  console.log(`==> Installed google-services.json from ${source}`);
}

if (!existsSync(googleServices)) {
  const guidance =
    "\n    android/app/google-services.json is missing.\n" +
    "\n" +
    "    Without it this APK has no Firebase project: it cannot receive push\n" +
    "    alerts, and Android will show \"Push failed\" on the Alerts screen.\n" +
    "\n" +
    "    Fix it one of these ways:\n" +
    "      1. Firebase console > Project settings > Your apps > Android app\n" +
    "         (package com.barangayresolve.app) > Download google-services.json,\n" +
    "         then save it as android/app/google-services.json.\n" +
    "      2. Keep the file outside the repo (it is gitignored) and pass\n" +
    "         --push-config C:\\path\\to\\google-services.json\n" +
    "      3. Build an alerts-less APK on purpose with --allow-missing-push.\n";

  if (!allowMissingPush) {
    console.error(guidance);
    process.exit(1);
  }
  console.warn(guidance);
  console.warn("    --allow-missing-push was passed: building without push alerts.\n");
} else {
  console.log("==> Firebase configuration found (google-services.json)");
}

const keystoreProperties = path.join(ANDROID_DIR, "keystore.properties");
if (wantsRelease && !keystoreProperties) {
  console.warn(
    "\n    NOTE: android/keystore.properties is missing, so `assembleRelease`\n" +
      "    produces an UNSIGNED apk that Android will refuse to install.\n" +
      "    Either add that file (see android/app/build.gradle) or build the\n" +
      "    debug APK instead (no --release flag).\n"
  );
}

// ---------------------------------------------------------------------------
// 4. Gradle build
// ---------------------------------------------------------------------------
const gradleTask = wantsRelease ? "assembleRelease" : "assembleDebug";
const gradleWrapper = isWindows ? "gradlew.bat" : "./gradlew";

console.log(`\n==> Running ${gradleWrapper} ${gradleTask}`);
run(gradleWrapper, [gradleTask], { cwd: ANDROID_DIR });

const apkPath = path.join(
  ANDROID_DIR,
  "app",
  "build",
  "outputs",
  "apk",
  wantsRelease ? "release" : "debug",
  wantsRelease ? "app-release.apk" : "app-debug.apk"
);

console.log(
  existsSync(apkPath)
    ? `\nAPK ready: ${apkPath}\nCopy it to the phone, then open it to install ` +
        "(allow \"Install unknown apps\" for your file manager/browser)."
    : `\nGradle finished but ${apkPath} was not found - check the Gradle output above.`
);
