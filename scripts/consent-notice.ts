import "dotenv/config";
import { db } from "../src/lib/db";
import { notifyConsentRequired } from "../src/lib/notifications/service";
import { hasConsent } from "../src/lib/privacy/consent";

// ---------------------------------------------------------------------------
// One-time notice for residents who have no DATA_PROCESSING consent on record.
// Such residents are blocked from filing concerns until they grant consent on
// their Privacy page. This script tells each of them once, through the
// notification service. It writes nothing else and never creates consent.
//
// Usage:
//   npm run privacy:consent-notice             # dry run, counts only
//   npm run privacy:consent-notice -- --apply  # sends the notices
// Safe to re-run: residents who already have a notice, or who have consent, are skipped.
// ---------------------------------------------------------------------------

async function main() {
  const apply = process.argv.includes("--apply");
  const residents = await db.user.findMany({
    where: { isActive: true, role: { key: "RESIDENT" } },
    select: { id: true },
  });

  let withConsent = 0;
  let alreadyNotified = 0;
  let toNotify = 0;
  for (const resident of residents) {
    if (await hasConsent(resident.id, "DATA_PROCESSING")) {
      withConsent += 1;
      continue;
    }
    const prior = await db.notification.findFirst({
      where: { userId: resident.id, type: "CONSENT_REQUIRED" },
      select: { id: true },
    });
    if (prior) {
      alreadyNotified += 1;
      continue;
    }
    toNotify += 1;
    if (apply) await notifyConsentRequired(db, { userId: resident.id });
  }

  console.log(
    `residents: ${residents.length}, with consent: ${withConsent}, already notified: ${alreadyNotified}, ${
      apply ? "notified now" : "would notify"
    }: ${toNotify}${apply ? "" : " (dry run; pass --apply to send)"}`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
