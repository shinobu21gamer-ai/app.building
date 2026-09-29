import { PrismaClient } from "@prisma/client";

async function main() {
  const db = new PrismaClient();
  const users = await db.user.findMany({
    where: { email: { contains: "smoke." } },
    select: { email: true },
  });
  const buckets = await db.loginAttemptBucket.findMany({
    where: { key: { contains: "smoke." } },
    select: { key: true },
  });
  console.log("remaining smoke users:", JSON.stringify(users));
  console.log("remaining smoke buckets:", JSON.stringify(buckets));
  const codes = await db.passwordResetCode.count();
  console.log("passwordResetCode rows:", codes);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});