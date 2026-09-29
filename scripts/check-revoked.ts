import { PrismaClient } from "@prisma/client";

async function main() {
  const db = new PrismaClient();
  const tokens = await db.revokedToken.findMany();
  console.log("Revoked tokens:", tokens.length);
  tokens.forEach(t => console.log(t));
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});