import { spawnSync } from "node:child_process";

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function run(command, args, env = process.env, { retryAdvisoryLock = false } = {}) {
  const executable = process.platform === "win32" ? `${command}.cmd` : command;
  const maxAttempts = retryAdvisoryLock ? 6 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = spawnSync(executable, args, {
      env,
      stdio: retryAdvisoryLock ? "pipe" : "inherit",
      encoding: retryAdvisoryLock ? "utf8" : undefined,
      maxBuffer: 10 * 1024 * 1024,
      shell: process.platform === "win32",
    });

    if (result.error) {
      throw result.error;
    }

    if (retryAdvisoryLock) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }

    if (result.status === 0) return;

    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    const advisoryLockTimeout =
      retryAdvisoryLock &&
      output.includes("P1002") &&
      /advisory lock|pg_advisory_lock/i.test(output);

    if (!advisoryLockTimeout || attempt === maxAttempts) {
      process.exit(result.status ?? 1);
    }

    const delayMs = Math.min(2 ** attempt * 1_000, 30_000);
    console.warn(
      `[prisma] Migration advisory lock timed out; retrying in ${Math.round(delayMs / 1_000)}s (${attempt + 1}/${maxAttempts}).`
    );
    sleepSync(delayMs);
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
    { ...process.env, DATABASE_URL: migrationUrl },
    { retryAdvisoryLock: true }
  );
}

// Report personal-data readiness while the build log is still open: a deploy
// without PII_ENCRYPTION_KEY ships an app whose identity verification and
// phone-number storage fail at runtime, which is hard to spot from a browser.
// Warning only — the fix must be able to ship regardless.
run("npx", ["tsx", "scripts/check-pii-key.ts"]);

run("npx", ["prisma", "generate"]);
run("npx", ["next", "build", "--turbopack"]);
