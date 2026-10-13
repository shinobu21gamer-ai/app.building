import "dotenv/config";
import {
  PII_KEY_ENV,
  piiKeyProblemMessage,
  piiKeyStatus,
} from "../src/lib/privacy/crypto";

// ---------------------------------------------------------------------------
// Reports whether this deployment can store personal data.
//
// Run from `scripts/vercel-build.mjs` (production builds) and by hand with
// `npm run env:check-pii`. It only ever *warns*: refusing to build would keep
// unrelated fixes from shipping, and the app itself already degrades safely
// (identity verification is disabled in the UI, and the API refuses to store a
// phone number instead of writing it in the clear).
//
// Set ALLOW_MISSING_PII_KEY=true to silence the warning on a deployment that
// deliberately stores no personal data.
// ---------------------------------------------------------------------------

const status = piiKeyStatus();

if (status.ready) {
  console.log(
    `[env] ${PII_KEY_ENV} is configured (${status.byteLength.toString()} bytes of key material).`
  );
  process.exit(0);
}

const message = piiKeyProblemMessage(status);
const allowMissing = process.env.ALLOW_MISSING_PII_KEY === "true";

if (allowMissing) {
  console.warn(`[env] ${message}`);
  console.warn(
    "[env] ALLOW_MISSING_PII_KEY=true is set: continuing without personal-data encryption. " +
      "Identity verification and resident phone numbers will fail at runtime."
  );
  process.exit(0);
}

console.warn(
  [
    "",
    "=".repeat(78),
    "[env] PERSONAL-DATA ENCRYPTION IS NOT CONFIGURED ON THIS DEPLOYMENT",
    "",
    `[env] ${message}`,
    "",
    "[env] Until a usable key is in place: identity verification is disabled,",
    "[env] registration with a phone number is refused, and staff cannot read",
    "[env] stored numbers.",
    "[env] Set the variable in the hosting dashboard (Vercel: Project Settings >",
    "[env] Environment Variables) and redeploy.",
    "=".repeat(78),
    "",
  ].join("\n")
);
