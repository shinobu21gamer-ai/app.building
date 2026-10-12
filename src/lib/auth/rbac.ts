// Permission catalogue and role matrix.
//
// The matrix in this file is the canonical source of truth: it is mirrored
// into the `Permission` / `RolePermission` tables by
// `npm run db:bootstrap-rbac`, and a database row always wins at runtime so an
// administrator can grant or revoke a single capability without a deploy
// (deleting the row falls back to the code default). See
// docs/revamp/01-architecture.md §2.
//
// The pure functions here are unit-tested without a database;
// `effectivePermissions()` is the only database-aware entry point.

import { isRoleKey, type RoleKey } from "@/lib/auth/roles";

export const PERMISSION_CATEGORIES = [
  "CASE",
  "CREW",
  "TREASURY",
  "SLA",
  "PRIVACY",
  "ADMIN",
  "REPORT",
] as const;

export type PermissionCategory = (typeof PERMISSION_CATEGORIES)[number];

export type PermissionDefinition = {
  key: string;
  category: PermissionCategory;
  description: string;
};

export const PERMISSIONS = [
  // ------------------------------------------------------------- case work
  {
    key: "concern.submit",
    category: "CASE",
    description: "Submit a concern.",
  },
  {
    key: "concern.track.own",
    category: "CASE",
    description: "Track a case by case number, without personal data.",
  },
  {
    key: "case.view.own",
    category: "CASE",
    description: "View the resident's own cases.",
  },
  {
    key: "case.view.office",
    category: "CASE",
    description: "View cases assigned to the user's office.",
  },
  {
    key: "case.view.all",
    category: "CASE",
    description: "View every case, including cases of other offices.",
  },
  {
    key: "case.view.assigned",
    category: "CASE",
    description: "View cases the user is personally assigned to as crew.",
  },
  {
    key: "case.validate",
    category: "CASE",
    description:
      "Validate a submitted concern, categorize it and confirm its priority.",
  },
  {
    key: "case.assess",
    category: "CASE",
    description:
      "Record the under-assessment findings: eligibility, inspection, resources, approval.",
  },
  {
    key: "case.manpower.plan",
    category: "CASE",
    description:
      "Plan manpower: workers needed, estimated duration, equipment and the cost estimate.",
  },
  {
    key: "case.crew.assign",
    category: "CASE",
    description: "Assign and release named crew members on a case.",
  },
  {
    key: "case.status.progress",
    category: "CASE",
    description:
      "Move a case forward: UNDER_ASSESSMENT, AWAITING_BUDGET, IN_PROGRESS, RESOLVED.",
  },
  {
    key: "case.fieldcheck.request",
    category: "CASE",
    description: "Ask an official or crew member to confirm a concern is real (field check).",
  },
  {
    key: "case.fieldcheck.perform",
    category: "CASE",
    description: "Carry out a field check you were assigned and record the finding.",
  },
  {
    key: "case.fieldcheck.review",
    category: "CASE",
    description: "Approve or send back a submitted field-check finding.",
  },
  {
    key: "case.status.close",
    category: "CASE",
    description: "Close a resolved case after verification.",
  },
  {
    key: "case.resolution.verify",
    category: "CASE",
    description: "Verify the proof of completion before a case is closed.",
  },
  {
    key: "case.override.crew_shortfall",
    category: "CASE",
    description:
      "Start work with fewer crew than planned. Requires a written reason.",
  },
  {
    key: "case.override.budget_skip",
    category: "CASE",
    description:
      "Skip the AWAITING_BUDGET stage. Requires a written reason.",
  },
  {
    key: "case.override.countersign",
    category: "CASE",
    description: "Countersign another user's workflow override.",
  },
  {
    key: "case.type.manage",
    category: "CASE",
    description: "Manage concern types and their routing defaults.",
  },

  // ------------------------------------------------------------------ crew
  {
    key: "crew.job.view.own",
    category: "CREW",
    description: "View the crew member's own assigned jobs.",
  },
  {
    key: "crew.job.update.own",
    category: "CREW",
    description: "Update progress and upload proof on the crew member's own jobs.",
  },
  {
    key: "crew.roster.manage",
    category: "CREW",
    description: "Manage crew profiles, trades, rates and availability.",
  },

  // -------------------------------------------------------------- treasury
  {
    key: "treasury.coa.verify",
    category: "TREASURY",
    description:
      "Verify or deprecate a COA object code or fund source and record its provenance.",
  },
  {
    key: "treasury.allocation.prepare",
    category: "TREASURY",
    description: "Prepare a budget allocation for a fiscal year.",
  },
  {
    key: "treasury.allocation.approve",
    category: "TREASURY",
    description: "Approve a budget allocation.",
  },
  {
    key: "treasury.earmark.prepare",
    category: "TREASURY",
    description: "Earmark part of an allocation for a case or a purchase.",
  },
  {
    key: "treasury.earmark.approve",
    category: "TREASURY",
    description: "Approve an earmark.",
  },
  {
    key: "treasury.disbursement.prepare",
    category: "TREASURY",
    description: "Prepare a disbursement voucher.",
  },
  {
    key: "treasury.disbursement.certify",
    category: "TREASURY",
    description: "Certify that funds are available for a disbursement.",
  },
  {
    key: "treasury.disbursement.approve",
    category: "TREASURY",
    description:
      "Approve and release a disbursement as the Authorized Approving Official.",
  },
  {
    key: "treasury.balance.view",
    category: "TREASURY",
    description: "View budget balances and the ledger.",
  },

  // ------------------------------------------------------------------- SLA
  {
    key: "sla.escalation.view",
    category: "SLA",
    description: "View the 48-hour escalation queue.",
  },
  {
    key: "sla.escalation.acknowledge",
    category: "SLA",
    description: "Acknowledge an escalation.",
  },
  {
    key: "sla.policy.manage",
    category: "SLA",
    description: "Manage SLA policies per stage, type and priority.",
  },

  // --------------------------------------------------------------- privacy
  {
    key: "privacy.consent.manage",
    category: "PRIVACY",
    description: "Grant or withdraw the user's own data privacy consents.",
  },
  {
    key: "privacy.dsr.create",
    category: "PRIVACY",
    description:
      "File a data subject request (access, correction, erasure) on the user's own data.",
  },
  {
    key: "privacy.dsr.handle",
    category: "PRIVACY",
    description: "Handle data subject requests and record the outcome.",
  },
  {
    key: "privacy.retention.manage",
    category: "PRIVACY",
    description: "Manage retention policies and run the retention sweep.",
  },
  {
    key: "privacy.pii_access.view",
    category: "PRIVACY",
    description:
      "Unmask personal data such as a phone number. Every unmasking is logged with a reason.",
  },
  {
    key: "privacy.identity.submit",
    category: "PRIVACY",
    description: "Submit an identity document for verification.",
  },
  {
    key: "privacy.identity.review",
    category: "PRIVACY",
    description: "Review a submitted identity document and decide the outcome.",
  },

  // ----------------------------------------------------------------- admin
  {
    key: "admin.user.manage",
    category: "ADMIN",
    description: "Create, edit, deactivate and re-role user accounts.",
  },
  {
    key: "admin.setting.manage",
    category: "ADMIN",
    description: "Manage runtime application settings.",
  },
  {
    key: "admin.rbac.manage",
    category: "ADMIN",
    description: "Override role permissions.",
  },
  {
    key: "admin.audit.view",
    category: "ADMIN",
    description: "Read the audit trail and its chain verification status.",
  },
  {
    key: "admin.cron.run",
    category: "ADMIN",
    description: "Trigger scheduled jobs manually.",
  },

  // --------------------------------------------------------------- reports
  {
    key: "report.view.all",
    category: "REPORT",
    description: "View barangay-wide reports and dashboards.",
  },
  {
    key: "report.view.office",
    category: "REPORT",
    description: "View reports for the user's own office.",
  },
  {
    key: "report.view.treasury",
    category: "REPORT",
    description: "View treasury reports: utilisation, register, aging.",
  },
  {
    key: "report.view.own",
    category: "REPORT",
    description: "View reports limited to the user's own work.",
  },
] as const satisfies readonly PermissionDefinition[];

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

const PERMISSION_KEYS: readonly string[] = PERMISSIONS.map((p) => p.key);

export function isPermissionKey(value: string): value is PermissionKey {
  return PERMISSION_KEYS.includes(value);
}

export function permissionDefinition(
  key: string
): PermissionDefinition | undefined {
  return PERMISSIONS.find((p) => p.key === key);
}

/** Permission catalogue grouped by category, in catalogue order. */
export function permissionsByCategory(): {
  category: PermissionCategory;
  permissions: PermissionDefinition[];
}[] {
  return PERMISSION_CATEGORIES.map((category) => ({
    category,
    permissions: PERMISSIONS.filter((p) => p.category === category).map((p) => ({
      key: p.key,
      category: p.category,
      description: p.description,
    })),
  })).filter((group) => group.permissions.length > 0);
}

// --------------------------------------------------------- the role matrix

const RESIDENT_PERMISSIONS = [
  "concern.submit",
  "concern.track.own",
  "case.view.own",
  "privacy.consent.manage",
  "privacy.dsr.create",
  "privacy.identity.submit",
] as const satisfies readonly PermissionKey[];

const OFFICIAL_PERMISSIONS = [
  "case.view.office",
  "case.assess",
  "case.manpower.plan",
  "case.crew.assign",
  "case.status.progress",
  "case.fieldcheck.request",
  "case.fieldcheck.perform",
  "case.resolution.verify",
  "case.override.crew_shortfall",
  "case.override.budget_skip",
  "privacy.consent.manage",
  "report.view.office",
] as const satisfies readonly PermissionKey[];

const CREW_PERMISSIONS = [
  "case.view.assigned",
  "case.fieldcheck.perform",
  "crew.job.view.own",
  "crew.job.update.own",
  "report.view.own",
] as const satisfies readonly PermissionKey[];

const TREASURER_PERMISSIONS = [
  "case.view.office",
  "treasury.coa.verify",
  "treasury.allocation.prepare",
  "treasury.earmark.prepare",
  "treasury.disbursement.prepare",
  "treasury.disbursement.certify",
  "treasury.balance.view",
  "report.view.treasury",
] as const satisfies readonly PermissionKey[];

const CAPTAIN_PERMISSIONS = [
  "case.view.all",
  "case.status.close",
  "case.resolution.verify",
  "case.override.countersign",
  "treasury.allocation.approve",
  "treasury.earmark.approve",
  "treasury.disbursement.approve",
  "treasury.balance.view",
  "sla.escalation.view",
  "sla.escalation.acknowledge",
  "report.view.all",
] as const satisfies readonly PermissionKey[];

const ADMIN_PERMISSIONS = PERMISSIONS.filter(
  (permission) =>
    !["concern.submit", "concern.track.own", "case.view.own"].includes(
      permission.key
    )
).map((permission) => permission.key);

export const ROLE_PERMISSIONS: Record<RoleKey, readonly PermissionKey[]> = {
  RESIDENT: RESIDENT_PERMISSIONS,
  OFFICIAL: OFFICIAL_PERMISSIONS,
  CREW: CREW_PERMISSIONS,
  TREASURER: TREASURER_PERMISSIONS,
  CAPTAIN: CAPTAIN_PERMISSIONS,
  ADMIN: ADMIN_PERMISSIONS,
};

/** The permissions the code matrix grants a role (no database rows consulted). */
export function permissionsForRole(roleKey: string): readonly PermissionKey[] {
  return isRoleKey(roleKey) ? ROLE_PERMISSIONS[roleKey] : [];
}

/** Whether the code matrix grants `key` to `roleKey`. */
export function roleHasCodePermission(
  roleKey: string,
  key: PermissionKey
): boolean {
  return permissionsForRole(roleKey).includes(key);
}

export type PermissionOverrideRow = { key: string; allowed: boolean };

// Database lookups live in ./rbac-db so this module stays importable from
// pure unit tests and client components.

/**
 * Applies database overrides on top of the code matrix: `allowed: true` adds a
 * capability, `allowed: false` removes one. Rows referencing unknown keys are
 * ignored, so a stale row can never widen access by accident.
 */
export function applyPermissionOverrides(
  codePermissions: readonly string[],
  rows: readonly PermissionOverrideRow[]
): Set<string> {
  const effective = new Set<string>(codePermissions);
  for (const row of rows) {
    if (!isPermissionKey(row.key)) continue;
    if (row.allowed) effective.add(row.key);
    else effective.delete(row.key);
  }
  return effective;
}

/**
 * How a role's stored rows differ from the code matrix.
 * `redundant` rows merely restate the code default and can be pruned safely.
 */
export function permissionDiff(
  roleKey: string,
  rows: readonly PermissionOverrideRow[]
): { granted: string[]; revoked: string[]; redundant: string[] } {
  const code = new Set<string>(permissionsForRole(roleKey));
  const granted: string[] = [];
  const revoked: string[] = [];
  const redundant: string[] = [];
  for (const row of rows) {
    if (!isPermissionKey(row.key)) continue;
    const inCode = code.has(row.key);
    if (row.allowed && !inCode) granted.push(row.key);
    else if (!row.allowed && inCode) revoked.push(row.key);
    else redundant.push(row.key);
  }
  return { granted: granted.sort(), revoked: revoked.sort(), redundant: redundant.sort() };
}

/** Case visibility scope for a role, used by the case query layer. */
export type CaseScope = "all" | "office" | "assigned" | "own" | "none";

export function caseScopeFor(roleKey: string): CaseScope {
  switch (roleKey) {
    case "ADMIN":
    case "CAPTAIN":
    case "TREASURER":
      return "all";
    case "OFFICIAL":
      return "office";
    case "CREW":
      return "assigned";
    case "RESIDENT":
      return "own";
    default:
      return "none";
  }
}
