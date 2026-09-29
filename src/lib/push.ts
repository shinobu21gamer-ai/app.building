import webpush from "web-push";
import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { db } from "@/lib/db";
import { isIP } from "node:net";

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const FCM_ENDPOINT = "https://fcm.googleapis.com/v1/projects";
const APNS_SANDBOX_HOST = "https://api.sandbox.push.apple.com";

interface AlertPayload {
  title: string;
  message: string;
  severity: string;
  alertId: number;
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

async function sendFcmMessage(token: string, payload: AlertPayload, account: ServiceAccount): Promise<string | null> {
  const accessToken = await getFcmAccessToken(account);
  const settings = severitySettings(payload.severity);
  const isCritical = payload.severity === "CRITICAL";
  const isWarning = payload.severity === "WARNING";

  // Custom vibration patterns per severity (milliseconds)
  const vibrationPatterns: Record<string, number[]> = {
    CRITICAL: [0, 1000, 500, 1000, 500, 1000, 500, 1000, 500, 1000],  // 10 seconds of strong vibration
    WARNING: [0, 500, 200, 500, 200, 500, 200, 500],                  // Medium, repeating
    INFO: [0, 300, 100, 300],                                          // Short buzz
  };

  const vibrateTimings = vibrationPatterns[payload.severity] || vibrationPatterns.INFO;

  const response = await fetch(`${FCM_ENDPOINT}/${account.project_id}/messages:send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: payload.title, body: payload.message },
        data: {
          alertId: String(payload.alertId),
          title: payload.title,
          body: payload.message,
          severity: payload.severity,
          url: "/alerts",
        },
        android: {
          priority: "HIGH",
          notification: {
            channel_id: settings.channelId,
            sound: "alert_long",
            notification_priority: "PRIORITY_MAX",
            visibility: "PUBLIC",
            default_sound: false,
            default_vibrate_timings: false,
            vibrate_timings: vibrationPatterns[payload.severity].map((ms) => `${ms}ms`),
            priority: "MAX",
          },
        },
        apns: {
          payload: {
            aps: {
              alert: { title: payload.title, body: payload.message },
              sound: "default",
              "interruption-level": "time-sensitive",
            },
          },
        },
      },
    }),
  });

  if (response.ok) return null;

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

const INVALID_FCM_CODES = new Set([
  "UNREGISTERED",
  "INVALID_ARGUMENT",
  "SENDER_ID_MISMATCH",
  "THIRD_PARTY_AUTH_ERROR",
]);

const INVALID_APNS_CODES = new Set([410, 400]);

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
          sound: `${settings.sound}.wav`,
          "interruption-level": settings.apnsInterruption,
          "thread-id": "barangayresolve-alerts",
        },
        alertId: String(payload.alertId),
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
  return configure()?.publicKey ?? null;
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

async function deliverWebPush(payload: AlertPayload): Promise<void> {
  if (!configure()) return;
  const subscriptions = await db.pushSubscription.findMany({
    where: { user: { isActive: true } },
  });

  const body = JSON.stringify({
    title: payload.title,
    body: payload.message,
    severity: payload.severity,
    alertId: payload.alertId,
    url: "/alerts",
  });

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
      } catch (error) {
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
}

async function deliverNativePush(payload: AlertPayload): Promise<void> {
  const tokens = await db.nativePushToken.findMany({
    where: { active: true, user: { isActive: true } },
  });
  if (tokens.length === 0) return;

  const account = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.FIREBASE_SERVICE_ACCOUNT
    ? await loadServiceAccount()
    : null;
  if (!account && tokens.some((t) => t.platform !== "ios")) {
    console.warn("[push] Firebase service account not configured; skipping FCM delivery");
  }
  const apnsBundleId = process.env.APNS_BUNDLE_ID;
  const apnsEnvironment = process.env.APNS_ENVIRONMENT === "sandbox" ? "sandbox" : "production";

  await Promise.all(
    tokens.map(async (row) => {
      try {
        if (row.platform === "ios") {
          if (!apnsBundleId) return;
          const status = await sendApnsMessage(row.token, payload, apnsBundleId, apnsEnvironment);
          if (status && INVALID_APNS_CODES.has(status)) {
            await db.nativePushToken.update({ where: { id: row.id }, data: { active: false } });
          }
          return;
        }
        if (!account) return;
        const code = await sendFcmMessage(row.token, payload, account);
        if (code && INVALID_FCM_CODES.has(code)) {
          await db.nativePushToken.update({ where: { id: row.id }, data: { active: false } });
        }
      } catch (error) {
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

export async function sendSystemAlertPush(input: AlertPayload): Promise<void> {
  await Promise.allSettled([deliverWebPush(input), deliverNativePush(input)]);
}
