import "dotenv/config";
import { db } from "@/lib/db";
import { scrubPublicTitle } from "@/lib/cases/geo";
import {
  TRANSPARENCY_CONSENT_PURPOSE,
  publicationDecision,
  syncPublicRecord,
  type PublicationReason,
} from "@/lib/cases/public-record";
import { hasConsent } from "@/lib/privacy/consent";

// ---------------------------------------------------------------------------
// Projects historical concerns into PublicCaseRecord (see
// docs/revamp/README.md decision 7).
//
// The live path publishes a case when its status changes; cases that were
// resolved or closed *before* the revamp therefore have no public projection at
// all, and the transparency page would stay empty until new cases close. This
// script fills that gap.
//
// Two rules are shared with the live path on purpose — the script imports
// `publicationDecision()`, `syncPublicRecord()` and the consent lookup rather
// than re-implementing them, so the backfill can never publish something the
// live path would not:
//   * a case is published only when the resident consented to
//     TRANSPARENCY_PUBLICATION (a case is never published because it exists);
//   * the title must survive scrubbing (a title that is only the resident's
//     name scrubs to nothing and is skipped).
//
// Nothing else leaves the projection: no case number, no resident, no address,
// coarse coordinates only. Re-running is safe: `syncPublicRecord` is idempotent,
// keeps the existing `BR-PUB-…` reference and flips `published` back off if the
// consent was withdrawn in the meantime.
//
// Usage:
//   npm run privacy:public-backfill               # dry run, reports what it would do
//   npm run privacy:public-backfill -- --apply     # writes the projection
//   npm run privacy:public-backfill -- --only-closed --apply
//                                                  # historical closed cases only
// ---------------------------------------------------------------------------

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const onlyClosed = args.has("--only-closed");

const PAGE_SIZE = 250;

type Summary = {
  scanned: number;
  alreadyProjected: number;
  decisions: Record<PublicationReason, number>;
  written: number;
  refreshedOff: number;
  failed: { id: number; reason: string }[];
};

async function previewConcern(concern: {
  userId: number;
  title: string;
  user: { firstName: string; lastName: string };
}): Promise<PublicationReason> {
  const consented = await hasConsent(
    concern.userId,
    TRANSPARENCY_CONSENT_PURPOSE,
    db
  );
  const publicTitle = scrubPublicTitle(concern.title, [
    concern.user.firstName,
    concern.user.lastName,
  ]);
  return publicationDecision(consented, publicTitle);
}

async function main() {
  const summary: Summary = {
    scanned: 0,
    alreadyProjected: 0,
    decisions: { published: 0, consent_missing: 0, no_safe_title: 0 },
    written: 0,
    refreshedOff: 0,
    failed: [],
  };

  const statuses = onlyClosed ? { in: ["RESOLVED", "CLOSED"] } : undefined;

  let cursor = 0;
  for (;;) {
    const page = await db.concern.findMany({
      where: {
        id: { gt: cursor },
        ...(statuses ? { status: statuses } : {}),
      },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
      select: {
        id: true,
        userId: true,
        title: true,
        user: { select: { firstName: true, lastName: true } },
        publicRecord: { select: { published: true } },
      },
    });
    if (page.length === 0) break;

    for (const concern of page) {
      cursor = concern.id;
      summary.scanned += 1;
      if (concern.publicRecord) summary.alreadyProjected += 1;

      try {
        if (apply) {
          const result = await db.$transaction((tx) =>
            syncPublicRecord(tx, concern.id)
          );
          summary.decisions[result.reason] += 1;
          if (result.published) {
            summary.written += 1;
          } else if (concern.publicRecord?.published) {
            // The projection existed and the consent or title no longer holds:
            // the row stays, but it is no longer published.
            summary.refreshedOff += 1;
          }
        } else {
          const decision = await previewConcern(concern);
          summary.decisions[decision] += 1;
        }
      } catch (error) {
        summary.failed.push({
          id: concern.id,
          reason: error instanceof Error ? error.message : "unknown error",
        });
      }
    }

    process.stdout.write(
      `  … ${summary.scanned} scanned (last id ${cursor})\n`
    );
  }

  console.log(
    [
      "",
      apply ? "Public-record backfill applied." : "Public-record backfill (dry run).",
      `  scanned            ${summary.scanned}`,
      `  already projected  ${summary.alreadyProjected}`,
      `  publishable        ${summary.decisions.published}`,
      `  no consent         ${summary.decisions.consent_missing}`,
      `  no safe title      ${summary.decisions.no_safe_title}`,
      apply ? `  written            ${summary.written}` : "",
      apply ? `  unpublished stale  ${summary.refreshedOff}` : "",
      `  failed             ${summary.failed.length}`,
      summary.failed.length > 0
        ? summary.failed
            .slice(0, 20)
            .map((row) => `    #${row.id}: ${row.reason}`)
            .join("\n")
        : "",
      apply
        ? ""
        : "\nRe-run with --apply to write the projection. Nothing was changed.",
      "",
    ]
      .filter((line) => line !== "")
      .join("\n")
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
