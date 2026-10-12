import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PERMISSIONS, permissionsForRole, permissionDiff } from "../src/lib/auth/rbac";
import { ROLE_DEFINITIONS } from "../src/lib/auth/roles";

// ---------------------------------------------------------------------------
// Mirrors the code RBAC matrix into the database.
//
//   * every Permission in src/lib/auth/rbac.ts is upserted (key, category,
//     description), so a new capability ships in the same deploy as its row;
//   * every permission the code matrix grants a role gets a RolePermission row
//     with allowed = true — but only if the role does not have a row for it
//     yet, so an administrator's explicit revocation is never resurrected;
//   * rows that merely restate the code default are reported and can be pruned
//     with --prune, which returns those roles to the code defaults.
//
// Safe to run repeatedly (idempotent). Usage:
//   npm run db:bootstrap-rbac
//   npm run db:bootstrap-rbac -- --prune
//   npm run db:bootstrap-rbac -- --dry-run
// ---------------------------------------------------------------------------

const prisma = new PrismaClient();

const args = new Set(process.argv.slice(2));
const prune = args.has("--prune");
const dryRun = args.has("--dry-run");

async function main() {
  const summary = {
    permissionsUpserted: 0,
    rolePermissionsCreated: 0,
    rolePermissionsPruned: 0,
    rolesMissing: [] as string[],
    divergences: [] as { role: string; granted: string[]; revoked: string[] }[],
  };

  for (const permission of PERMISSIONS) {
    if (!dryRun) {
      await prisma.permission.upsert({
        where: { key: permission.key },
        update: {
          category: permission.category,
          description: permission.description,
          isActive: true,
        },
        create: {
          key: permission.key,
          category: permission.category,
          description: permission.description,
        },
      });
    }
    summary.permissionsUpserted += 1;
  }

  for (const definition of ROLE_DEFINITIONS) {
    const role = await prisma.role.findUnique({
      where: { key: definition.key },
      include: {
        permissions: {
          select: { id: true, allowed: true, permission: { select: { key: true } } },
        },
      },
    });
    if (!role) {
      summary.rolesMissing.push(definition.key);
      continue;
    }

    type RolePermissionRow = {
      id: number;
      allowed: boolean;
      permission: { key: string };
    };
    const rows = role.permissions as RolePermissionRow[];
    const existing = new Map(rows.map((row) => [row.permission.key, row]));
    const diff = permissionDiff(
      definition.key,
      rows.map((row) => ({
        key: row.permission.key,
        allowed: row.allowed,
      }))
    );
    if (diff.granted.length > 0 || diff.revoked.length > 0) {
      summary.divergences.push({
        role: definition.key,
        granted: diff.granted,
        revoked: diff.revoked,
      });
    }

    for (const permissionKey of permissionsForRole(definition.key)) {
      if (existing.has(permissionKey)) continue;
      const permission = await prisma.permission.findUnique({
        where: { key: permissionKey },
        select: { id: true },
      });
      if (!permission) {
        console.warn(`  ! permission row missing for ${permissionKey}`);
        continue;
      }
      if (!dryRun) {
        await prisma.rolePermission.create({
          data: { roleId: role.id, permissionId: permission.id, allowed: true },
        });
      }
      summary.rolePermissionsCreated += 1;
    }

    if (prune) {
      const redundantIds = rows
        .filter((row: RolePermissionRow) =>
          diff.redundant.includes(row.permission.key)
        )
        .map((row: RolePermissionRow) => row.id);
      if (redundantIds.length > 0) {
        if (!dryRun) {
          await prisma.rolePermission.deleteMany({
            where: { id: { in: redundantIds } },
          });
        }
        summary.rolePermissionsPruned += redundantIds.length;
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        prune,
        ...summary,
      },
      null,
      2
    )
  );

  if (summary.rolesMissing.length > 0) {
    console.warn(
      `\nMissing roles: ${summary.rolesMissing.join(", ")}.\n` +
        "Run the stage-1 migration (prisma migrate deploy) first: it seeds the six role rows."
    );
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("RBAC bootstrap failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
