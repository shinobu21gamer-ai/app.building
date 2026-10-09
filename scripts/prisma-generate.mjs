import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Runs `prisma generate` with a placeholder DATABASE_URL when none is set.
 *
 * `prisma generate` validates the schema's `env("DATABASE_URL")` reference
 * even though it never connects to the database. On a fresh clone there is no
 * `.env` yet, so the old bare `prisma generate` postinstall failed with
 * "Environment variable not found: DATABASE_URL". That failed `npm install`
 * and left `@prisma/client` uninitialized — every page then crashed with
 * "@prisma/client did not initialize yet" and rendered the "We couldn't load
 * this page" error.
 *
 * Generating against the placeholder URL (the same one `.env.example` ships)
 * keeps installation green on a fresh clone; the placeholder is replaced as
 * soon as a real DATABASE_URL is configured.
 */
const PLACEHOLDER_DATABASE_URL =
  "postgresql://user:password@localhost:5432/barangayresolve";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const prismaCli = join(projectRoot, "node_modules", "prisma", "build", "index.js");

if (!existsSync(prismaCli)) {
  console.error(
    "[prisma] Could not find the local Prisma CLI at node_modules/prisma. Run `npm install` first."
  );
  process.exit(1);
}

const env = { ...process.env };
if (!env.DATABASE_URL) {
  env.DATABASE_URL = PLACEHOLDER_DATABASE_URL;
  console.warn(
    "[prisma] DATABASE_URL is not set: generating the client with a placeholder URL.\n" +
      "[prisma] Set DATABASE_URL in .env before running the app (see .env.example)."
  );
}

const result = spawnSync(process.execPath, [prismaCli, "generate"], {
  cwd: projectRoot,
  env,
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
