import { PrismaClient } from "@prisma/client";

async function main() {
  const db = new PrismaClient();
  const emails = [
    "cycle.test@example.ph",
    "ratelimit.test@nowhere.ph",
  ];
  await db.passwordResetCode.deleteMany({
    where: { user: { email: { in: emails } } },
  });
  await db.user.deleteMany({ where: { email: { in: emails } } });
  const buckets = await db.loginAttemptBucket.deleteMany({
    where: {
      OR: [
        { key: { contains: "ratelimit.test@nowhere.ph" } },
        { key: { contains: "cycle.test@example.ph" } },
      ],
    },
  });
  console.log("deleted buckets:", buckets.count);
  const remaining = await db.user.findMany({
    where: { email: { contains: "test@" } },
    select: { email: true },
  });
  console.log("remaining test users:", JSON.stringify(remaining));
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});