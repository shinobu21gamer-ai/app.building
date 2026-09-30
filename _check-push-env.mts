const { db } = await import("@/lib/db");
import "dotenv/config";

const tokens = await db.nativePushToken.findMany({
  orderBy: { createdAt: "desc" },
  take: 20,
});
const subs = await db.pushSubscription.count();

console.log("=== native push tokens ===");
console.log(
  tokens.length,
  "rows; active:",
  tokens.filter((t) => t.active).length
);
for (const t of tokens) {
  console.log(
    `- id=${t.id} user=${t.userId} platform=${t.platform} active=${t.active} deviceId=${t.deviceId ?? "-"} token=${t.token.slice(0, 24)}... created=${t.createdAt.toISOString()}`
  );
}
console.log("=== web push subscriptions ===", subs);

console.log("=== push env present (server process) ===");
console.log("FIREBASE_SERVICE_ACCOUNT_PATH:", process.env.FIREBASE_SERVICE_ACCOUNT_PATH ? "set" : "NOT SET");
console.log("FIREBASE_SERVICE_ACCOUNT:", process.env.FIREBASE_SERVICE_ACCOUNT ? "set" : "NOT SET");
console.log("VAPID_PUBLIC_KEY:", process.env.VAPID_PUBLIC_KEY ? "set" : "NOT SET");
console.log("VAPID_PRIVATE_KEY:", process.env.VAPID_PRIVATE_KEY ? "set" : "NOT SET");
console.log("VAPID_SUBJECT:", process.env.VAPID_SUBJECT ? "set" : "NOT SET");
console.log("APNS_*:", process.env.APNS_KEY_PATH ? "set" : "NOT SET");

await db.$disconnect();