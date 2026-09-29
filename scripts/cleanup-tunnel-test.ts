import { db } from "../src/lib/db";

async function main() {
  const subs = await db.pushSubscription.findMany({
    select: { id: true, endpoint: true, userId: true },
  });
  console.log(JSON.stringify(subs, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => process.exit(0));