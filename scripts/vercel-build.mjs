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

run("npx", ["prisma", "generate"]);
run("npx", ["next", "build", "--turbopack"]);
