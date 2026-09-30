const { db } = await import("@/lib/db");
import "dotenv/config";

// Keep only the newest active token per user, deactivate the rest
const all = await db.nativePushToken.findMany({
  where: { active: true, platform: "android" },
  orderBy: { createdAt: "desc" },
});

const seen = new Set();
const toDeactivate = [];
for (const t of all) {
  if (seen.has(t.userId)) {
    toDeactivate.push(t.id);
  } else {
    seen.add(t.userId);
  }
}

if (toDeactivate.length > 0) {
  await db.nativePushToken.updateMany({
    where: { id: { in: toDeactivate } },
    data: { active: false },
  });
}
console.log(`deactivated ${toDeactivate.length} stale token(s)`);

const remaining = await db.nativePushToken.findMany({ where: { active: true }, orderBy: { createdAt: "desc" } });
console.log("active tokens:", remaining.length);
for (const t of remaining) {
  console.log(`- user=${t.userId} platform=${t.platform} token=${t.token.slice(0, 30)}...`);
}
await db.$disconnect();