const { db } = await import("@/lib/db");
import "dotenv/config";

const acct = JSON.parse(await (await import("node:fs/promises")).readFile("secrets/firebase-service-account.json", "utf8"));

async function makeAssertion(acct) {
  const { createSign } = await import("node:crypto");
  const b64url = (b) => Buffer.from(b).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const claims = b64url(JSON.stringify({ iss: acct.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const sig = signer.sign(acct.private_key).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return `${header}.${claims}.${sig}`;
}

const authResp = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: await makeAssertion(acct) }),
});
const authData = await authResp.json();
if (!authResp.ok) { console.log("AUTH FAILED:", authResp.status, JSON.stringify(authData).slice(0, 200)); process.exit(1); }
console.log("auth OK");

const token = await db.nativePushToken.findFirst({ where: { active: true, platform: "android" }, orderBy: { createdAt: "desc" } });
if (!token) { console.log("no active token"); process.exit(1); }
console.log("sending to token:", token.token.slice(0, 30) + "...");

const msgResp = await fetch(`https://fcm.googleapis.com/v1/projects/${acct.project_id}/messages:send`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${authData.access_token}` },
  body: JSON.stringify({
    message: {
      token: token.token,
      data: { alertId: "999999", title: "TEST ALARM", message: "If you see this, FCM delivery works!", severity: "CRITICAL" },
      android: { priority: "HIGH" },
    },
  }),
});
const msgData = await msgResp.json().catch(() => ({}));
console.log("FCM send result:", msgResp.status);
console.log("response:", JSON.stringify(msgData).slice(0, 400));
await db.$disconnect();