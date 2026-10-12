import "dotenv/config";
import { db } from "@/lib/db";
import { PII_KEY_ENV, parseKeyMaterial } from "@/lib/privacy/crypto";
import {
  rotateCipherValue,
  verifyCipherValue,
  type RotateOutcome,
} from "@/lib/privacy/rotate";

// ---------------------------------------------------------------------------
// PII key rotation (see docs/revamp/README.md decision 3 and
// docs/revamp/03-migration-plan.md §6).
//
// Encryption is per-record: `encryptField` writes `v1.<iv>.<tag>.<ciphertext>`
// under a key derived (HKDF) from `PII_ENCRYPTION_KEY`, and `lookupHash` derives
// a separate HMAC key from the *same* secret — so rotating the secret means
// re-encrypting every ciphertext **and** recomputing every lookup hash in the
// same run. The rules live in `src/lib/privacy/rotate.ts` (unit tested); this
// script is the database half.
//
// The four fields it owns:
//   User.phoneEncrypted          + User.phoneHash
//   IdentityVerification.idNumberEncrypted + IdentityVerification.idNumberHash
//
// Environment:
//   PII_ENCRYPTION_KEY            the NEW secret (already active for writes)
//   PII_ENCRYPTION_KEY_PREVIOUS   the OLD secret, only during a rotation
//
// Usage:
//   npm run privacy:pii-rotate             # dry run, reports what it would do
//   npm run privacy:pii-rotate -- --apply   # re-encrypts with the new key
//   npm run privacy:pii-rotate -- --verify  # decrypts every row with the new key
//
// Idempotent: a row already encrypted under the new key is detected (the old key
// cannot read it) and left alone, so an interrupted rotation can simply be run
// again. Rows that are not ciphertext at all are reported and skipped — those
// need `npm run privacy:pii-backfill` first, not this script.
// ---------------------------------------------------------------------------

const PREVIOUS_KEY_ENV = `${PII_KEY_ENV}_PREVIOUS`;

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const verify = args.has("--verify");

type Summary = {
  scanned: number;
  rotated: number;
  already: number;
  plaintext: number;
  failed: { field: string; id: number; reason: string }[];
  verified: number;
  verifyFailed: string[];
};

function tally(
  summary: Summary,
  field: string,
  id: number,
  outcome: RotateOutcome
): "rotated" | "already" | "plaintext" | "failed" {
  switch (outcome.state) {
    case "rotated":
      summary.rotated += 1;
      return "rotated";
    case "already":
      summary.already += 1;
      return "already";
    case "plaintext":
      summary.plaintext += 1;
      return "plaintext";
    case "failed":
      summary.failed.push({ field, id, reason: outcome.reason });
      return "failed";
  }
}

async function rotateUsers(previous: Buffer, next: Buffer, summary: Summary) {
  const users = await db.user.findMany({
    where: { phoneEncrypted: { not: null } },
    select: { id: true, email: true, phoneEncrypted: true, phoneHash: true },
    orderBy: { id: "asc" },
  });

  for (const user of users) {
    const ciphertext = user.phoneEncrypted;
    if (!ciphertext) continue;
    summary.scanned += 1;

    if (verify) {
      if (
        user.phoneHash !== null &&
        verifyCipherValue(ciphertext, user.phoneHash, next)
      ) {
        summary.verified += 1;
      } else {
        summary.verifyFailed.push(`User#${user.id} (${user.email})`);
      }
      continue;
    }

    const outcome = rotateCipherValue(ciphertext, previous, next);
    const state = tally(summary, "User.phoneEncrypted", user.id, outcome);
    if (state === "rotated" && apply && outcome.state === "rotated") {
      await db.user.update({
        where: { id: user.id },
        data: {
          phoneEncrypted: outcome.encrypted,
          phoneHash: outcome.hash,
        },
      });
    }
  }
}

async function rotateIdentity(previous: Buffer, next: Buffer, summary: Summary) {
  const rows = await db.identityVerification.findMany({
    where: { idNumberEncrypted: { not: null } },
    select: {
      id: true,
      userId: true,
      idNumberEncrypted: true,
      idNumberHash: true,
    },
    orderBy: { id: "asc" },
  });

  for (const row of rows) {
    const ciphertext = row.idNumberEncrypted;
    if (!ciphertext) continue;
    summary.scanned += 1;

    if (verify) {
      if (
        row.idNumberHash !== null &&
        verifyCipherValue(ciphertext, row.idNumberHash, next)
      ) {
        summary.verified += 1;
      } else {
        summary.verifyFailed.push(
          `IdentityVerification#${row.id} (user ${row.userId})`
        );
      }
      continue;
    }

    const outcome = rotateCipherValue(ciphertext, previous, next);
    const state = tally(
      summary,
      "IdentityVerification.idNumberEncrypted",
      row.id,
      outcome
    );
    if (state === "rotated" && apply && outcome.state === "rotated") {
      await db.identityVerification.update({
        where: { id: row.id },
        data: {
          idNumberEncrypted: outcome.encrypted,
          idNumberHash: outcome.hash,
        },
      });
    }
  }
}

async function main() {
  const next = parseKeyMaterial(process.env[PII_KEY_ENV]);
  const previous = parseKeyMaterial(process.env[PREVIOUS_KEY_ENV]);

  if (!next) {
    console.error(
      `${PII_KEY_ENV} is not set (or is too short). Set the NEW key first.`
    );
    process.exitCode = 1;
    return;
  }
  if (!verify && !previous) {
    console.error(
      `${PREVIOUS_KEY_ENV} is not set, so no row can be read under the old key.\n` +
        "Add it for the duration of the rotation and remove it afterwards.\n" +
        "If the records are already on the new key, run with --verify instead."
    );
    process.exitCode = 1;
    return;
  }

  const summary: Summary = {
    scanned: 0,
    rotated: 0,
    already: 0,
    plaintext: 0,
    failed: [],
    verified: 0,
    verifyFailed: [],
  };

  const oldMaterial = previous ?? next;
  await rotateUsers(oldMaterial, next, summary);
  await rotateIdentity(oldMaterial, next, summary);

  if (verify) {
    console.log(
      [
        "",
        "PII key verification (new key).",
        `  rows scanned ${summary.scanned}`,
        `  verified     ${summary.verified}`,
        `  failed       ${summary.verifyFailed.length}`,
        ...summary.verifyFailed
          .slice(0, 20)
          .map((row) => `    ${row}: does not decrypt, or its hash does not match`),
        "",
      ].join("\n")
    );
    if (summary.verifyFailed.length > 0) process.exitCode = 1;
    return;
  }

  console.log(
    [
      "",
      apply
        ? "PII key rotation applied."
        : "PII key rotation (dry run — nothing written).",
      `  rows scanned       ${summary.scanned}`,
      `  to re-encrypt      ${summary.rotated}`,
      `  already on new key ${summary.already}`,
      `  not ciphertext     ${summary.plaintext}`,
      `  failed             ${summary.failed.length}`,
      ...summary.failed
        .slice(0, 20)
        .map((row) => `    ${row.field} #${row.id}: ${row.reason}`),
      summary.plaintext > 0
        ? "\nRows that are not ciphertext need `npm run privacy:pii-backfill` first."
        : "",
      apply
        ? `\nNow run with --verify, then remove ${PREVIOUS_KEY_ENV}.`
        : "\nRe-run with --apply to write the rotation. Nothing was changed.",
      "",
    ]
      .filter((line) => line !== "")
      .join("\n")
  );
  if (summary.failed.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
