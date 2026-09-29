import { PrismaClient } from "@prisma/client";

async function main() {
  const db = new PrismaClient();
  const emails = await db.user.findMany({
    where: { email: { startsWith: "smoke." } },
    select: { email: true },
  });
  const emailList = emails.map((e) => e.email);
  await db.passwordResetCode.deleteMany({
    where: { user: { email: { in: emailList } } },
  });
  await db.user.deleteMany({ where: { email: { in: emailList } } });
  const buckets = await db.loginAttemptBucket.deleteMany({
    where: {
      OR: emailList.map((e) => ({ key: { contains: e } })),
    },
  });
  console.log("deleted users:", emailList);
  console.log("deleted buckets:", buckets.count);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});