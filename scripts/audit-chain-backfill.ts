import "dotenv/config";
import { auditChainStatus, chainLegacyAuditEntries } from "@/lib/audit/store";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Chains the audit rows written before the hash chain existed (see
// docs/revamp/01-architecture.md §7).
//
//   * rows are chained in (createdAt, id) order, so the chain follows the order
//     the events actually happened in;
//   * the original createdAt is preserved — backfilling must not change what the
//     log says happened, only add the link that proves it was not edited;
//   * the script only touches rows whose `seq` is still null, so it is safe to
//     re-run and safe to interrupt.
//
// Usage:
//   npm run audit:chain-backfill            # dry run, reports what it would do
//   npm run audit:chain-backfill -- --apply  # writes the chain columns
// ---------------------------------------------------------------------------

async function main() {
  const apply = process.argv.includes("--apply");
  const before = await auditChainStatus();

  console.log(
    `[audit-chain] tip seq ${before.state.lastSeq}, ` +
      `${before.chainedCount} chained, ${before.unchainedCount} unchained, ` +
      `${before.totalCount} row(s) in total.`
  );

  if (before.unchainedCount === 0) {
    console.log("[audit-chain] nothing to do: every row is already in the chain.");
    return;
  }

  if (!apply) {
    console.log(
      "[audit-chain] dry run — re-run with --apply to chain the rows above."
    );
    return;
  }

  const chained = await chainLegacyAuditEntries({
    onProgress: (count) => {
      if (count % 500 === 0) console.log(`[audit-chain] chained ${count}...`);
    },
  });

  const after = await auditChainStatus();
  console.log(
    `[audit-chain] chained ${chained} row(s); tip is now seq ${after.state.lastSeq}, ` +
      `${after.unchainedCount} unchained remaining.`
  );
  console.log(
    "[audit-chain] run the verifier next: `POST /api/v1/admin/audit/verify` " +
      "(or the weekly cron) to record an AuditVerificationRun."
  );
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error("[audit-chain] failed:", error);
    await db.$disconnect();
    process.exit(1);
  });
