import { spawnSync } from "node:child_process";

function run(command, args, env = process.env) {
  const executable = process.platform === "win32" ? `${command}.cmd` : command;
  const result = spawnSync(executable, args, {
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const isVercelProductionBuild = process.env.VERCEL_ENV === "production";

if (isVercelProductionBuild) {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL must be configured for production Vercel builds."
    );
  }

  const migrationUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;

  // Apply schema changes before publishing code that depends on them. Use the
  // direct database URL when one is configured, since pooled URLs can reject
  // migration connections. Preview deployments intentionally skip migrations
  // so they cannot alter a shared production database.
  run(
    "npx",
    ["prisma", "migrate", "deploy"],
    { ...process.env, DATABASE_URL: migrationUrl }
  );
}

// Report personal-data readiness while the build log is still open: a deploy
// without PII_ENCRYPTION_KEY ships an app whose identity verification and
// phone-number storage fail at runtime, which is hard to spot from a browser.
// Warning only — the fix must be able to ship regardless.
run("npx", ["tsx", "scripts/check-pii-key.ts"]);

run("npx", ["prisma", "generate"]);
run("npx", ["next", "build", "--turbopack"]);
