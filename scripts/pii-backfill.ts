import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  PII_KEY_ENV,
  decryptField,
  encryptField,
  hasPiiKey,
  lookupHash,
} from "../src/lib/privacy/crypto";
import { normalizePhone, phoneLast4 } from "../src/lib/privacy/phone";

// ---------------------------------------------------------------------------
// Phase 1 of the two-phase phone migration (see
// docs/revamp/03-migration-plan.md).
//
//   * every User.phone that still holds a plaintext number is normalised,
//     encrypted into phoneEncrypted, given a keyed phoneHash for lookups and a
//     readable phoneLast4, and the row is marked phoneVerifiedAt = null;
//   * the plaintext column is NOT cleared here — it is dropped in the stage-5
//     privacy migration, after this backfill has been verified in production;
//   * rows whose phoneEncrypted is already set and whose plaintext matches are
//     skipped, so the script is idempotent and safe to re-run.
//
// Usage:
//   npm run privacy:pii-backfill             # dry run, reports what it would do
//   npm run privacy:pii-backfill -- --apply   # writes the encrypted columns
//   npm run privacy:pii-backfill -- --verify  # decrypts and compares, writes nothing
// ---------------------------------------------------------------------------

const prisma = new PrismaClient();

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const verify = args.has("--verify");

async function main() {
  if (!hasPiiKey()) {
    console.error(
      `${PII_KEY_ENV} is not set, so nothing can be encrypted.\n` +
        "Generate one with:  node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"\n" +
        "and add it to the environment before running the backfill."
    );
    process.exitCode = 1;
    return;
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      phone: true,
      phoneEncrypted: true,
      phoneLast4: true,
      phoneHash: true,
    },
    orderBy: { id: "asc" },
  });

  const report = {
    scanned: users.length,
    alreadyEncrypted: 0,
    toEncrypt: 0,
    invalid: 0,
    encrypted: 0,
    verified: 0,
    failed: [] as { id: number; reason: string }[],
  };

  for (const user of users) {
    const plaintext = user.phone;

    if (!plaintext) {
      if (user.phoneEncrypted) report.alreadyEncrypted += 1;
      continue;
    }

    const normalized = normalizePhone(plaintext);
    if (!normalized) {
      report.invalid += 1;
      report.failed.push({
        id: user.id,
        reason: `not a Philippine mobile number: ${JSON.stringify(plaintext)}`,
      });
      continue;
    }

    if (user.phoneEncrypted) {
      report.alreadyEncrypted += 1;
      if (verify) {
        try {
          const decrypted = decryptField(user.phoneEncrypted);
          if (decrypted === normalized) report.verified += 1;
          else
            report.failed.push({
              id: user.id,
              reason: "stored ciphertext does not match the plaintext column",
            });
        } catch {
          report.failed.push({
            id: user.id,
            reason: "ciphertext could not be decrypted with the current key",
          });
        }
      }
      continue;
    }

    report.toEncrypt += 1;

    if (verify) {
      // Verifying without an encrypted column can only confirm the shape.
      report.verified += 1;
      continue;
    }
    if (!apply) continue;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        phoneEncrypted: encryptField(normalized),
        phoneHash: lookupHash(normalized),
        phoneLast4: phoneLast4(normalized),
      },
    });
    report.encrypted += 1;
  }

  console.log(
    JSON.stringify(
      {
        mode: verify ? "verify" : apply ? "apply" : "dry-run",
        ...report,
      },
      null,
      2
    )
  );

  if (!apply && !verify) {
    console.log(
      "\nDry run: nothing was written. Re-run with --apply to encrypt the numbers,\n" +
        "then with --verify to confirm every ciphertext decrypts to the same value."
    );
  }
}

main()
  .catch((error) => {
    console.error("PII backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
