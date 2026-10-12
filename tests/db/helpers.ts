import { db } from "@/lib/db";

/**
 * These tests run against a real PostgreSQL database.
 *
 * They exist because the report loaders and the retention handlers are the only
 * layer whose bugs live in SQL rather than in arithmetic: every other module is
 * covered by the unit suite with fixture objects. Nothing here runs as part of
 * `npx vitest run` (that config only includes `src/**`), so a developer without
 * a database still gets a green suite — but this file's tests are the ones CI
 * runs against the `postgres` service container, where `prisma migrate deploy`
 * has applied the hand-written migrations first.
 */
export function requireDatabase(): void {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "The database suite needs a real DATABASE_URL. Apply the migrations to a " +
        "PostgreSQL instance first (`npx prisma migrate deploy`) and run this suite " +
        "with `npx vitest run --config vitest.db.config.mts` and the same URL set. " +
        "See .github/workflows/ci.yml (`database` job)."
    );
  }
}

/**
 * Empties every table in the public schema except Prisma's own migration
 * bookkeeping, so each test file starts from a known database.
 *
 * `CASCADE` handles the foreign keys, and a table added by a future migration is
 * picked up automatically — a hard-coded list would quietly go stale.
 */
export async function resetDatabase(): Promise<void> {
  await db.$executeRawUnsafe(
    `DO $$
     DECLARE r RECORD;
     BEGIN
       FOR r IN
         SELECT tablename FROM pg_tables
         WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
       LOOP
         EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
       END LOOP;
     END $$;`
  );
}

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

export function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/** The six roles the RBAC matrix assumes; the migration seeds the same keys. */
export async function seedRoles(): Promise<Record<string, number>> {
  const keys = ["RESIDENT", "OFFICIAL", "ADMIN", "TREASURER", "CAPTAIN", "CREW"];
  const roles: Record<string, number> = {};
  for (const key of keys) {
    const role = await db.role.create({
      data: { key, name: key },
      select: { id: true },
    });
    roles[key] = role.id;
  }
  return roles;
}

export async function seedOffice(code: string, name = code): Promise<number> {
  const office = await db.office.create({
    data: { code, name, contact: "0917 000 0000" },
    select: { id: true },
  });
  return office.id;
}

export async function seedType(key: string, name = key): Promise<number> {
  const type = await db.concernType.create({
    data: { key, name },
    select: { id: true },
  });
  return type.id;
}

export async function seedCategory(code: string, typeId?: number): Promise<number> {
  const category = await db.concernCategory.create({
    data: { code, name: code, ...(typeId ? { typeId } : {}) },
    select: { id: true },
  });
  return category.id;
}

export async function seedUser(input: {
  email: string;
  roleId: number;
  officeId?: number;
  firstName?: string;
  lastName?: string;
}): Promise<number> {
  const user = await db.user.create({
    data: {
      email: input.email,
      passwordHash: "not-a-real-hash",
      firstName: input.firstName ?? "Test",
      lastName: input.lastName ?? "User",
      roleId: input.roleId,
      ...(input.officeId ? { officeId: input.officeId } : {}),
    },
    select: { id: true },
  });
  return user.id;
}
