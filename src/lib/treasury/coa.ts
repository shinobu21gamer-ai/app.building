// COA / UACS object-code rules for the treasury module.
//
// Pure: no database, no framework imports, so the parsing and the
// verification gates are unit testable. The accounting facts behind these
// rules are documented in `docs/revamp/01-architecture.md` (section 5) and
// come from the COA Government Accounting Manual, Chapter 3 (MOOE).
//
// Object codes are the 10-digit Revised Chart of Accounts object codes,
// displayed as `X-XX-XX-XXX-XX`: eight RCA digits plus the two-digit
// sub-object. The third digit is the allotment class
// (1 PS, 2 MOOE, 3 FEx, 4 Direct Costs, 5 Non-Cash, 6 CO).

/**
 * `5-02-03-010` (eight RCA digits) or `5-02-13-030-01` with the sub-object.
 * Displayed with dashes; the compact form is accepted on input.
 */
export const COA_CODE_PATTERN = /^\d-\d{2}-\d{2}-\d{3}(?:-\d{2})?$/;

export const ACCOUNT_CLASSES = ["PS", "MOOE", "FEx", "DIRECT", "NONCASH", "CO"] as const;
export type AccountClass = (typeof ACCOUNT_CLASSES)[number];

export const ALLOTMENT_CLASS_LABELS: Record<string, string> = {
  "1": "PS — Personnel Services",
  "2": "MOOE — Maintenance and Other Operating Expenses",
  "3": "FEx — Financial Expenses",
  "4": "Direct Costs",
  "5": "Non-Cash",
  "6": "CO — Capital Outlays",
};

export const VERIFICATION_STATUSES = [
  "UNVERIFIED",
  "VERIFIED",
  "DEPRECATED",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  UNVERIFIED: "Not yet verified",
  VERIFIED: "Verified against the COA manual",
  DEPRECATED: "Retired — no longer usable",
};

/**
 * Where the shipped codes come from. Stored on every seeded row and shown next
 * to the code in the UI, so a treasurer can see the provenance of the
 * accounting fact instead of trusting the system.
 */
export const COA_PROVENANCE = {
  source: "COA GAM Chapter 3 — Description of Accounts (02 MOOE)",
  url: "https://www.coa.gov.ph/wp-content/uploads/ABC-Help/GAM_3/GAM.htm",
  notes: "Confirm against the barangay annual budget before use.",
} as const;

/**
 * Fund sources are the LGU's own creation (General Fund, the 20% Development
 * Fund, the Special Education Fund, trust funds), so they ship unverified:
 * confirming them against the appropriation ordinance is the treasurer's job,
 * not a formality the system may pre-approve.
 */
export const FUND_SOURCE_PROVENANCE = {
  source: "LGU appropriation ordinance (confirm locally)",
  notes:
    "This system ships fund sources unverified on purpose: the General Fund, the 20% Development Fund, the SEF and trust funds all depend on the barangay's own ordinance.",
} as const;

/**
 * Normalizes user input: trims, drops spaces/underscores, and inserts the
 * dashes when someone types the digits straight through (`50203010`), which is
 * how the codes appear in most budget worksheets.
 */
export function normalizeCoaCode(value: string): string {
  const compact = value.trim().replace(/[\s_]/g, "");
  if (/^\d{8}$/.test(compact)) {
    return `${compact.slice(0, 1)}-${compact.slice(1, 3)}-${compact.slice(3, 5)}-${compact.slice(5)}`;
  }
  if (/^\d{10}$/.test(compact)) {
    return `${compact.slice(0, 1)}-${compact.slice(1, 3)}-${compact.slice(3, 5)}-${compact.slice(5, 8)}-${compact.slice(8)}`;
  }
  return compact;
}

export type ParsedCoaCode = {
  code: string;
  /** The eight RCA digits, without dashes. */
  digits: string;
  /** Third digit of the object code: 1 PS, 2 MOOE, 3 FEx, 4 Direct, 5 Non-Cash, 6 CO. */
  allotmentClass: string;
  groupCode: string;
  objectCode: string;
  subObjectCode: string | null;
};

/**
 * Splits `5-02-13-030-01`. Returns null for anything that is not a valid
 * object code shape, so callers can reject input without guessing.
 */
export function parseCoaCode(value: string): ParsedCoaCode | null {
  const code = normalizeCoaCode(value);
  if (!COA_CODE_PATTERN.test(code)) return null;

  const parts = code.split("-");
  const digits = parts.slice(0, 4).join("");
  return {
    code,
    digits,
    allotmentClass: digits.charAt(2),
    groupCode: parts[2],
    objectCode: parts[3],
    subObjectCode: parts[4] ?? null,
  };
}

export function isValidCoaCode(value: string): boolean {
  return parseCoaCode(value) !== null;
}

/** `5-02-03-010-00` when a sub-object is given, otherwise the base code. */
export function formatCoaCode(
  code: string,
  subObjectCode?: string | null
): string {
  const parsed = parseCoaCode(code);
  if (!parsed) return normalizeCoaCode(code);

  const base = parsed.code.split("-").slice(0, 4).join("-");
  const sub = subObjectCode ?? parsed.subObjectCode;
  if (sub === null || sub === undefined || sub === "") return base;
  if (!/^\d{1,2}$/.test(String(sub))) return base;
  return `${base}-${String(sub).padStart(2, "0")}`;
}

/** MOOE is allotment class 2. Codes carry the class on the row as well. */
export function isMooeCode(
  value: string,
  accountClass?: string | null
): boolean {
  const parsed = parseCoaCode(value);
  if (parsed) return parsed.allotmentClass === "2";
  return (accountClass ?? "").toUpperCase() === "MOOE";
}

export function allotmentClassLabel(value: string): string {
  const parsed = parseCoaCode(value);
  return ALLOTMENT_CLASS_LABELS[parsed?.allotmentClass ?? ""] ?? "Unclassified";
}

export function verificationLabel(status: string): string {
  return (
    VERIFICATION_LABELS[status as VerificationStatus] ?? "Unknown verification"
  );
}

/**
 * Whether a code may be used on an earmark or a voucher. Deprecated and
 * unverified codes are refused; the message names the reason so the UI can
 * show it verbatim.
 */
export function codeUsable(input: {
  verificationStatus: string;
  isActive: boolean;
  code: string;
}): { usable: boolean; reason: string | null } {
  if (!input.isActive) {
    return {
      usable: false,
      reason: `${input.code} is turned off and cannot be used on new vouchers.`,
    };
  }
  if (input.verificationStatus === "DEPRECATED") {
    return {
      usable: false,
      reason: `${input.code} was retired by COA and cannot be used on new vouchers. Pick a current code.`,
    };
  }
  if (input.verificationStatus !== "VERIFIED") {
    return {
      usable: false,
      reason: `${input.code} has not been verified against the COA manual yet. An accountant or treasurer must verify it first.`,
    };
  }
  return { usable: true, reason: null };
}

export type CodeProvenance = {
  source: string | null;
  url: string | null;
  notes: string | null;
  verifiedAt: Date | null;
};

export function provenanceLine(code: {
  verificationStatus: string;
  verificationSource?: string | null;
  verificationUrl?: string | null;
  verificationNotes?: string | null;
  verifiedAt?: Date | null;
}): string {
  if (code.verificationStatus !== "VERIFIED") {
    return verificationLabel(code.verificationStatus);
  }
  const source = code.verificationSource ?? COA_PROVENANCE.source;
  return code.verifiedAt
    ? `Verified against ${source}`
    : `Verified against ${source}`;
}

/** Groups codes by their two-digit group for the verification desk. */
export function groupCodesByGroup<
  T extends { code: string; groupCode?: string | null },
>(rows: readonly T[]): Array<{ groupCode: string; rows: T[] }> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = row.groupCode ?? parseCoaCode(row.code)?.groupCode ?? "00";
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([groupCode, rows]) => ({ groupCode, rows }));
}
