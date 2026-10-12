// The six BarangayResolve roles.
//
// This module is deliberately dependency-free (no Prisma, no Next): it is
// imported by the Edge-adjacent middleware, by React Server Components and by
// plain Node scripts, and it must stay safe to load in any of them.
//
// Authoritative keys match the `Role.key` rows seeded by
// `prisma/migrations/20261012000000_revamp_core_schema` and `prisma/seed.ts`.

export const ROLE_KEYS = [
  "RESIDENT",
  "OFFICIAL",
  "CREW",
  "TREASURER",
  "CAPTAIN",
  "ADMIN",
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export type RoleDefinition = {
  key: RoleKey;
  /** Matches `Role.name` in the database. */
  name: string;
  /** Compact label for tables, badges and navigation. */
  shortLabel: string;
  description: string;
  /** Landing route after sign-in. */
  home: string;
  /** Portal route tree this role owns (null = no portal of its own). */
  portal: string | null;
  /** Hall staff rather than a resident. */
  staff: boolean;
};

export const ROLE_DEFINITIONS: readonly RoleDefinition[] = [
  {
    key: "RESIDENT",
    name: "Resident",
    shortLabel: "Resident",
    description: "Community member who submits and tracks concerns.",
    home: "/resident",
    portal: "/resident",
    staff: false,
  },
  {
    key: "OFFICIAL",
    name: "Barangay Official",
    shortLabel: "Official",
    description:
      "Barangay official who assesses assigned concerns, plans manpower and performs the work.",
    home: "/official",
    portal: "/official",
    staff: true,
  },
  {
    key: "CREW",
    name: "Maintenance Crew",
    shortLabel: "Crew",
    description:
      "Named crew member assigned to a case by an official. Sees only their own jobs.",
    home: "/crew",
    portal: "/crew",
    staff: true,
  },
  {
    key: "TREASURER",
    name: "Barangay Treasurer",
    shortLabel: "Treasurer",
    description:
      "Prepares budget allocations, earmarks and disbursements, and certifies that funds are available.",
    home: "/treasury",
    portal: "/treasury",
    staff: true,
  },
  {
    key: "CAPTAIN",
    name: "Barangay Captain",
    shortLabel: "Captain",
    description:
      "Authorized Approving Official: approves disbursements, closes cases and countersigns overrides.",
    home: "/captain",
    portal: "/captain",
    staff: true,
  },
  {
    key: "ADMIN",
    name: "Administrator",
    shortLabel: "Admin",
    description: "System administrator with full configuration access.",
    home: "/admin",
    portal: "/admin",
    staff: true,
  },
];

export const ROLE_MAP: Record<RoleKey, RoleDefinition> = ROLE_DEFINITIONS.reduce(
  (acc, role) => {
    acc[role.key] = role;
    return acc;
  },
  {} as Record<RoleKey, RoleDefinition>
);

export const ROLE_HOME: Record<RoleKey, string> = {
  RESIDENT: "/resident",
  OFFICIAL: "/official",
  CREW: "/crew",
  TREASURER: "/treasury",
  CAPTAIN: "/captain",
  ADMIN: "/admin",
};

/**
 * Route-prefix → roles allowed inside that portal. The middleware walks this
 * table; `/admin`, `/official` and `/resident` keep exactly the behaviour they
 * had before the revamp, and the three new portals follow the same shape.
 */
export const PORTAL_GUARDS: readonly {
  prefix: string;
  roles: readonly RoleKey[];
}[] = [
  { prefix: "/admin", roles: ["ADMIN"] },
  { prefix: "/official", roles: ["OFFICIAL", "ADMIN"] },
  { prefix: "/resident", roles: ["RESIDENT"] },
  { prefix: "/treasury", roles: ["TREASURER", "ADMIN"] },
  { prefix: "/captain", roles: ["CAPTAIN", "ADMIN"] },
  { prefix: "/crew", roles: ["CREW", "ADMIN"] },
];

export function isRoleKey(value: unknown): value is RoleKey {
  return (
    typeof value === "string" && (ROLE_KEYS as readonly string[]).includes(value)
  );
}

/** Landing route for a role key; unknown roles fall back to the resident home. */
export function roleHome(roleKey: string): string {
  return isRoleKey(roleKey) ? ROLE_HOME[roleKey] : ROLE_HOME.RESIDENT;
}

/** Human name for a role key; unknown keys are returned unchanged. */
export function roleName(roleKey: string): string {
  return isRoleKey(roleKey) ? ROLE_MAP[roleKey].name : roleKey;
}

export function roleShortLabel(roleKey: string): string {
  return isRoleKey(roleKey) ? ROLE_MAP[roleKey].shortLabel : roleKey;
}

/** Every role except RESIDENT works from the barangay hall. */
export function staffRoleKeys(): RoleKey[] {
  return ROLE_DEFINITIONS.filter((role) => role.staff).map((role) => role.key);
}

/** Role keys an administrator may assign from the admin console. */
export function assignableRoleKeys(): RoleKey[] {
  return ROLE_DEFINITIONS.map((role) => role.key);
}

/** Roles allowed into a portal prefix (empty array = unguarded prefix). */
export function portalRoles(prefix: string): readonly RoleKey[] {
  return PORTAL_GUARDS.find((guard) => guard.prefix === prefix)?.roles ?? [];
}

/** Portal prefixes that require a session, in stable order. */
export function portalPrefixes(): string[] {
  return PORTAL_GUARDS.map((guard) => guard.prefix);
}
