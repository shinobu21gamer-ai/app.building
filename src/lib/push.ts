import webpush from "web-push";
import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { db } from "@/lib/db";
import { isIP } from "node:net";
import type { PushPlatformReport, SystemAlertPushReport } from "@/lib/push-types";

export type { PushPlatformReport, SystemAlertPushReport } from "@/lib/push-types";

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const FCM_ENDPOINT = "https://fcm.googleapis.com/v1/projects";
const APNS_SANDBOX_HOST = "https://api.sandbox.push.apple.com";

interface AlertPayload {
  title: string;
  message: string;
  severity: string;
  alertId: number;
  sound: boolean;
  createdAt: string;
  expiresAt: string | null;
}

function emptyPlatformReport(
  registered = 0,
  configured = false,
  reason?: string
): PushPlatformReport {
  return {
    registered,
    accepted: 0,
    failed: 0,
    skipped: registered,
    configured,
    ...(reason ? { reason } : {}),
  };
}

const SEVERITY_CHANNELS: Record<
  string,
  { channelId: string; sound: string; androidPriority: "PRIORITY_DEFAULT" | "PRIORITY_HIGH"; apnsInterruption: "passive" | "active" | "time-sensitive" }
> = {
  INFO: { channelId: "alerts_info", sound: "alert_info_long", androidPriority: "PRIORITY_HIGH", apnsInterruption: "time-sensitive" },
  WARNING: { channelId: "alerts_warning", sound: "alert_warning_long", androidPriority: "PRIORITY_HIGH", apnsInterruption: "time-sensitive" },
  CRITICAL: { channelId: "alerts_critical", sound: "alert_critical_long", androidPriority: "PRIORITY_HIGH", apnsInterruption: "time-sensitive" },
};

function severitySettings(severity: string) {
  return SEVERITY_CHANNELS[severity] ?? SEVERITY_CHANNELS.INFO;
}

interface ServiceAccount {
  project_id: string;
  private_key: string;
  client_email: string;
}

/**
 * Loads the Firebase service account without ever persisting credentials in
 * the repository. Prefer a file path; fall back to an inline JSON env var.
 */
async function loadServiceAccount(): Promise<ServiceAccount | null> {
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path) {
    try {
      return JSON.parse(await readFile(path, "utf8")) as ServiceAccount;
    } catch (error) {
      console.error("[push] could not read FIREBASE_SERVICE_ACCOUNT_PATH:", error);
      return null;
    }
  }
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (inline) {
    try {
      return JSON.parse(inline) as ServiceAccount;
    } catch {
      console.error("[push] FIREBASE_SERVICE_ACCOUNT is not valid JSON");
      return null;
    }
  }
  return null;
}

const ACCESS_TOKEN_TTL_MS = 50 * 60 * 1000;
let cachedAccessToken: { value: string; expiresAt: number } | null = null;

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function getFcmAccessToken(account: ServiceAccount): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) {
    return cachedAccessToken.value;
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: FCM_SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: issuedAt,
      exp: issuedAt + 3600,
    })
  );

  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${signer
    .sign(account.private_key)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    throw new Error(`FCM auth failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  cachedAccessToken = {
    value: data.access_token,
    expiresAt: Date.now() + Math.min(data.expires_in * 1000, ACCESS_TOKEN_TTL_MS),
  };
  return cachedAccessToken.value;
}

async function sendFcmMessage(token: string, payload: AlertPayload, account: ServiceAccount): Promise<void> {
  const accessToken = await getFcmAccessToken(account);
  const settings = severitySettings(payload.severity);

  // Data-only message: the native app's AlertMessagingService receives every alert even
  // when the app is backgrounded, and builds the notification / alarm / popup itself.
  const response = await fetch(`${FCM_ENDPOINT}/${account.project_id}/messages:send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      message: {
        token,
        data: {
          alertId: String(payload.alertId),
          title: payload.title,
          body: payload.message,
          severity: payload.severity,
          sound: String(payload.sound),
          channelId: settings.channelId,
          createdAt: payload.createdAt,
          ...(payload.expiresAt ? { expiresAt: payload.expiresAt } : {}),
          url: "/alerts",
        },
        android: {
          priority: "HIGH",
          ttl: "43200s",
        },
        apns: {
          headers: { "apns-priority": "10" },
          payload: {
            aps: {
              alert: { title: payload.title, body: payload.message },
              ...(payload.sound ? { sound: "default" } : {}),
              "interruption-level": "time-sensitive",
              "thread-id": "barangayresolve-alerts",
            },
            alertId: String(payload.alertId),
            createdAt: payload.createdAt,
            ...(payload.expiresAt ? { expiresAt: payload.expiresAt } : {}),
            url: "/alerts",
          },
        },
      },
    }),
  });

  if (response.ok) return;

  const text = await response.text();
  let code: string | null = null;
  try {
    const parsed = JSON.parse(text) as {
      error?: { status?: string; details?: Array<{ errorCode?: string }> };
    };
    code = parsed.error?.details?.[0]?.errorCode ?? parsed.error?.status ?? null;
  } catch {
    /* keep raw text */
  }
  const error = new Error(`FCM send failed: ${response.status} ${text}`) as Error & { fcmCode?: string | null };
  error.fcmCode = code;
  throw error;
}

// Only provider responses that unambiguously mean the installation token is
// no longer registered should deactivate a device. Other errors can indicate
// project credentials or a malformed payload and must not prune valid devices.
const INVALID_FCM_CODES = new Set(["UNREGISTERED"]);
const INVALID_APNS_CODES = new Set([410]);

async function sendApnsMessage(
  token: string,
  payload: AlertPayload,
  bundleId: string,
  environment: "sandbox" | "production"
): Promise<number | null> {
  const keyPath = process.env.APNS_KEY_PATH;
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  if (!keyPath || !keyId || !teamId) return null;

  const settings = severitySettings(payload.severity);
  const { readFileSync } = await import("node:fs");
  const privateKey = readFileSync(keyPath, "utf8");
  const signer = createSign("SHA256");
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const claims = base64url(JSON.stringify({ iss: teamId, iat: issuedAt }));
  signer.update(`${header}.${claims}`);
  const esder = signer.sign({ key: privateKey, dsaEncoding: "ieee-p1363" });
  const jwt = `${header}.${claims}.${base64url(esder)}`;

  const { connect } = await import("node:http2");
  const host = environment === "sandbox" ? new URL(APNS_SANDBOX_HOST).host : "api.push.apple.com";

  return new Promise<number | null>((resolve, reject) => {
    const client = connect(`https://${host}`);
    const request = client.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      authorization: `bearer ${jwt}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });

    let status = 0;
    let body = "";
    request.on("response", (headers) => {
      status = Number(headers[":status"] ?? 0);
    });
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      client.close();
      if (status === 200) resolve(null);
      else {
        const error = new Error(`APNs send failed: ${status} ${body}`) as Error & { apnsStatus?: number };
        error.apnsStatus = status;
        reject(error);
      }
    });
    request.on("error", (error) => {
      client.close();
      reject(error);
    });

    request.end(
      JSON.stringify({
        aps: {
          alert: { title: payload.title, body: payload.message },
          ...(payload.sound ? { sound: `${settings.sound}.wav` } : {}),
          "interruption-level": settings.apnsInterruption,
          "thread-id": "barangayresolve-alerts",
        },
        alertId: String(payload.alertId),
        severity: payload.severity,
        sound: String(payload.sound),
        createdAt: payload.createdAt,
        ...(payload.expiresAt ? { expiresAt: payload.expiresAt } : {}),
        url: "/alerts",
      })
    );
  });
}

function configure() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return { publicKey, privateKey };
}

export function getPushPublicKey(): string | null {
  try {
    return configure()?.publicKey ?? null;
  } catch (error) {
    console.error("[push] invalid VAPID configuration:", error);
    return null;
  }
}

/**
 * Whether this server holds the Firebase service-account credentials it needs to
 * reach phones at all.
 *
 * Registering a phone and *delivering* to it fail independently: a device can be
 * registered successfully while the server has no credentials, in which case
 * nothing is ever sent and the phone looks broken. The alert-diagnostics screen
 * reports this so the two halves are never confused.
 */
export async function isNativePushConfigured(): Promise<boolean> {
  try {
    return (await loadServiceAccount()) !== null;
  } catch (error) {
    console.error("[push] could not read the Firebase service account:", error);
    return false;
  }
}

const LOOPBACK_HOST = /^localhost(\.[a-z]+)?$/i;

/**
 * Validates a push subscription endpoint the server is willing to contact.
 * Only public, DNS-named HTTPS endpoints are allowed. Raw IP literals
 * (which could point at private / loopback / link-local networks) and
 * loopback hostnames are rejected so an authenticated user cannot turn the
 * server into a blind HTTP client against internal networks (SSRF).
 */
export function isValidPushEndpoint(endpoint: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname;
  if (!host) return false;
  if (LOOPBACK_HOST.test(host)) return false;
  // Reject numeric IPs outright; legitimate push endpoints are domain names.
  if (isIP(host) !== 0) return false;
  return true;
}

async function deliverWebPush(payload: AlertPayload): Promise<PushPlatformReport> {
  const subscriptions = await db.pushSubscription.findMany({
    where: { user: { isActive: true } },
  });

  let configured = false;
  try {
    configured = Boolean(configure());
  } catch (error) {
    console.error("[push] invalid VAPID configuration:", error);
  }
  if (!configured) {
    console.warn(
      "[push] VAPID keys not configured (VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT); skipping web push."
    );
    return emptyPlatformReport(subscriptions.length, false, "Web push is not configured.");
  }

  const body = JSON.stringify({
    title: payload.title,
    body: payload.message,
    severity: payload.severity,
    alertId: payload.alertId,
    sound: payload.sound,
    createdAt: payload.createdAt,
    expiresAt: payload.expiresAt,
    url: "/alerts",
  });

  let accepted = 0;
  let failed = 0;
  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          body
        );
        accepted += 1;
      } catch (error) {
        failed += 1;
        const statusCode =
          error && typeof error === "object" && "statusCode" in error ? error.statusCode : null;
        if (statusCode === 404 || statusCode === 410) {
          await db.pushSubscription.delete({ where: { id: subscription.id } });
        } else {
          console.error("[push] failed to deliver alert:", error);
        }
      }
    })
  );

  return {
    registered: subscriptions.length,
    accepted,
    failed,
    skipped: 0,
    configured: true,
  };
}

async function deliverNativePush(
  payload: AlertPayload
): Promise<Pick<SystemAlertPushReport, "android" | "ios">> {
  const tokens = await db.nativePushToken.findMany({
    where: { active: true, user: { isActive: true } },
  });
  const androidTokens = tokens.filter((token) => token.platform !== "ios");
  const iosTokens = tokens.filter((token) => token.platform === "ios");

  let account: ServiceAccount | null = null;
  const firebaseCredentialsConfigured = Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.FIREBASE_SERVICE_ACCOUNT
  );
  if (androidTokens.length > 0 && firebaseCredentialsConfigured) {
    account = await loadServiceAccount();
  }
  const androidReport = emptyPlatformReport(
    androidTokens.length,
    Boolean(account),
    account ? undefined : androidTokens.length > 0 ? "Firebase service-account credentials are not configured or could not be loaded." : undefined
  );
  if (!account && androidTokens.length > 0) {
    // On serverless hosts (Vercel) a file path like FIREBASE_SERVICE_ACCOUNT_PATH
    // will not exist; the service account must be supplied inline via
    // FIREBASE_SERVICE_ACCOUNT (a JSON string) for FCM to work at all.
    console.error(
      "[push] Firebase service account not configured (set FIREBASE_SERVICE_ACCOUNT to the service-account JSON on Vercel); skipping Android FCM delivery for " +
        androidTokens.length +
        " device(s)."
    );
  }

  const apnsBundleId = process.env.APNS_BUNDLE_ID;
  const apnsConfigured = Boolean(
    apnsBundleId && process.env.APNS_KEY_PATH && process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID
  );
  const iosReport = emptyPlatformReport(
    iosTokens.length,
    apnsConfigured,
    apnsConfigured ? undefined : iosTokens.length > 0 ? "APNs credentials are not configured." : undefined
  );

  let androidAccepted = 0;
  let androidFailed = 0;
  const firebaseAccount = account;
  if (firebaseAccount) {
    await Promise.all(
      androidTokens.map(async (row) => {
        try {
          await sendFcmMessage(row.token, payload, firebaseAccount);
          androidAccepted += 1;
        } catch (error) {
          androidFailed += 1;
          const fcmCode = (error as { fcmCode?: string | null }).fcmCode;
          if (fcmCode && INVALID_FCM_CODES.has(fcmCode)) {
            await db.nativePushToken.update({ where: { id: row.id }, data: { active: false } });
            return;
          }
          console.error("[push] failed to deliver native alert:", error);
        }
      })
    );
  }

  let iosAccepted = 0;
  let iosFailed = 0;
  if (apnsConfigured && apnsBundleId) {
    const apnsEnvironment = process.env.APNS_ENVIRONMENT === "sandbox" ? "sandbox" : "production";
    await Promise.all(
      iosTokens.map(async (row) => {
        try {
          await sendApnsMessage(row.token, payload, apnsBundleId, apnsEnvironment);
          iosAccepted += 1;
        } catch (error) {
          iosFailed += 1;
          const apnsStatus = (error as { apnsStatus?: number }).apnsStatus;
          if (apnsStatus && INVALID_APNS_CODES.has(apnsStatus)) {
            await db.nativePushToken.update({ where: { id: row.id }, data: { active: false } });
            return;
          }
          console.error("[push] failed to deliver native alert:", error);
        }
      })
    );
  }

  return {
    android: {
      ...androidReport,
      accepted: androidAccepted,
      failed: androidFailed,
      skipped: account ? 0 : androidTokens.length,
    },
    ios: {
      ...iosReport,
      accepted: iosAccepted,
      failed: iosFailed,
      skipped: apnsConfigured ? 0 : iosTokens.length,
    },
  };
}

export async function sendSystemAlertPush(input: AlertPayload): Promise<SystemAlertPushReport> {
  const [web, native] = await Promise.allSettled([
    deliverWebPush(input),
    deliverNativePush(input),
  ]);
  const failureReport = (reason: unknown): PushPlatformReport => {
    console.error("[push] could not evaluate alert delivery:", reason);
    return {
      registered: 0,
      accepted: 0,
      failed: 0,
      skipped: 0,
      configured: false,
      reason: "Push delivery could not be evaluated; check server logs.",
    };
  };

  return {
    web: web.status === "fulfilled" ? web.value : failureReport(web.reason),
    android:
      native.status === "fulfilled"
        ? native.value.android
        : failureReport(native.reason),
    ios:
      native.status === "fulfilled" ? native.value.ios : failureReport(native.reason),
  };
}
