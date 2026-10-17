import { z } from "zod";
import { CALENDAR_DAY_RE, isValidCalendarDay, todayManila } from "@/lib/cases/action-date";
import { booleanFlag } from "@/lib/validations/boolean";
import {
  ACCOUNT_CLASSES,
  isValidCoaCode,
  normalizeCoaCode,
} from "@/lib/treasury/coa";
import {
  APPROVAL_DECISIONS,
  DISBURSEMENT_ACTIONS,
  DISBURSEMENT_STATUSES,
} from "@/lib/treasury/ledger";

function optionalText(max: number, message?: string) {
  return z.preprocess(
    (value) =>
      value === null || (typeof value === "string" && value.trim() === "")
        ? undefined
        : value,
    z.string().trim().max(max, message).optional()
  );
}

function nullableId(label: string) {
  return z.preprocess(
    (value) =>
      value === "" || value === null || value === undefined ? null : value,
    z.coerce
      .number()
      .int(`${label} must be a whole number.`)
      .positive(`${label} is not valid.`)
      .nullable()
      .optional()
  );
}

/** A peso amount. Two decimals, never negative — used for appropriations,
 * earmarks and vouchers. */
export function amountSchema(label: string) {
  return z.coerce
    .number()
    .refine(Number.isFinite, `${label} must be a number.`)
    .refine((value) => value > 0, `${label} must be more than zero.`)
    .refine(
      (value) => value <= 1_000_000_000,
      `${label} is larger than this system allows (₱1,000,000,000).`
    )
    .transform((value) => Math.round(value * 100) / 100);
}

/** An adjustment may be negative (it reduces the appropriation) but not zero. */
const adjustmentSchema = z.coerce
  .number()
  .refine(Number.isFinite, "The adjustment must be a number.")
  .refine((value) => value !== 0, "The adjustment must not be zero.")
  .refine(
    (value) => Math.abs(value) <= 1_000_000_000,
    "The adjustment is larger than this system allows."
  )
  .transform((value) => Math.round(value * 100) / 100);

// The regex alone only checks the shape: without the calendar-validity
// refine, "2026-02-30" (which does not exist) would pass here and then
// silently roll over to March 2 once `new Date(...)` parses it in
// `createFiscalYear` — the fiscal year's real start/end would quietly drift
// away from what was typed, with no error at any point. `isValidCalendarDay`
// is the same check `src/lib/validations/case.ts` already uses for exactly
// this reason.
const calendarDay = z
  .string()
  .trim()
  .regex(CALENDAR_DAY_RE, "Use a date in YYYY-MM-DD form.")
  .refine(isValidCalendarDay, "That date does not exist. Use a real calendar date (YYYY-MM-DD).");

const httpsOrRelative = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) =>
      value.startsWith("/") ||
      value.startsWith("https://") ||
      value.startsWith("http://"),
    "The link must be a stored file path or an http(s) URL."
  );

// ---------------------------------------------------------------------------
// COA accounts and fund sources (verification desk)
// ---------------------------------------------------------------------------

export const coaAccountCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .transform(normalizeCoaCode)
    .refine(isValidCoaCode, "Use a COA object code such as 5-02-16-010."),
  name: z.string().trim().min(3, "The account name is too short.").max(160),
  accountClass: z.enum(ACCOUNT_CLASSES),
  groupCode: optionalText(2),
  subObjectCodes: optionalText(200),
  description: optionalText(500),
  isMooe: booleanFlag.optional(),
  isActive: booleanFlag.optional(),
});

export const coaAccountVerifySchema = z
  .object({
    verificationStatus: z.enum(["VERIFIED", "DEPRECATED", "UNVERIFIED"]),
    verificationSource: z
      .string()
      .trim()
      .min(3, "Say where the code was verified against.")
      .max(200),
    verificationUrl: optionalText(500),
    verificationNotes: optionalText(500),
  })
  .refine(
    (value) =>
      value.verificationStatus !== "VERIFIED" || Boolean(value.verificationUrl),
    {
      message:
        "A verified code needs the link to the source (for example the COA GAM page).",
      path: ["verificationUrl"],
    }
  );

export const fundSourceCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, "The fund code is too short.")
    .max(20)
    .regex(/^[A-Z0-9-]+$/, "Use letters, digits and dashes only."),
  name: z.string().trim().min(3, "The fund name is too short.").max(160),
  description: optionalText(500),
});

export const fundSourceVerifySchema = z.object({
  verificationStatus: z.enum(["VERIFIED", "DEPRECATED", "UNVERIFIED"]),
  verificationSource: z
    .string()
    .trim()
    .min(3, "Name the appropriation ordinance or document you checked.")
    .max(200),
  verificationNotes: optionalText(500),
});

export const fiscalYearCreateSchema = z
  .object({
    year: z.coerce
      .number()
      .int("The fiscal year must be a whole number.")
      .min(2000, "That fiscal year is out of range.")
      .max(2100, "That fiscal year is out of range."),
    name: optionalText(80),
    startsOn: calendarDay,
    endsOn: calendarDay,
  })
  .refine((value) => value.endsOn > value.startsOn, {
    message: "The fiscal year has to end after it starts.",
    path: ["endsOn"],
  })
  // A fiscal year frames money that has not been spent yet, so it cannot be
  // opened in the past. Both ends are checked: a year that already finished is
  // history, not a live frame for appropriations.
  .refine((value) => value.startsOn >= todayManila(), {
    message: "The fiscal year cannot start in the past. Pick today or a later day.",
    path: ["startsOn"],
  })
  .refine((value) => value.endsOn >= todayManila(), {
    message:
      "The fiscal year cannot end in the past. Pick today or a later day.",
    path: ["endsOn"],
  });

export const fiscalYearCloseSchema = z.object({
  notes: optionalText(500),
});

// ---------------------------------------------------------------------------
// Allocations
// ---------------------------------------------------------------------------

export const allocationCreateSchema = z.object({
  fiscalYearId: z.coerce.number().int().positive("Pick a fiscal year."),
  fundSourceId: z.coerce.number().int().positive("Pick a fund source."),
  coaAccountId: z.coerce.number().int().positive("Pick a COA account."),
  officeId: nullableId("Office"),
  label: z
    .string()
    .trim()
    .min(3, "Describe what this appropriation is for.")
    .max(160),
  appropriation: amountSchema("The appropriation"),
  notes: optionalText(500),
});

export const allocationApproveSchema = z.object({
  notes: optionalText(500),
});

export const allocationAdjustSchema = z.object({
  amount: adjustmentSchema,
  memo: z
    .string()
    .trim()
    .min(10, "An adjustment needs a memo explaining it (at least 10 characters).")
    .max(500),
});

export const allocationCloseSchema = z.object({
  notes: optionalText(500),
});

/** One PATCH endpoint per allocation, with the action deciding the payload. */
export const allocationActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("APPROVE"), notes: optionalText(500) }),
  z.object({
    action: z.literal("ADJUST"),
    amount: adjustmentSchema,
    memo: z
      .string()
      .trim()
      .min(10, "An adjustment needs a memo explaining it (at least 10 characters).")
      .max(500),
  }),
  z.object({ action: z.literal("CLOSE"), notes: optionalText(500) }),
]);

// ---------------------------------------------------------------------------
// Earmarks
// ---------------------------------------------------------------------------

export const earmarkCreateSchema = z.object({
  allocationId: z.coerce.number().int().positive("Pick an allocation."),
  concernId: nullableId("Case"),
  purpose: z
    .string()
    .trim()
    .min(5, "Say what the earmark is for.")
    .max(200),
  amount: amountSchema("The earmark amount"),
  notes: optionalText(500),
});

export const earmarkApproveSchema = z.object({
  notes: optionalText(500),
});

export const earmarkCancelSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, "Give the reason the earmark is being cancelled.")
    .max(500),
});

export const earmarkReleaseSchema = z.object({
  notes: optionalText(500),
});

export const earmarkActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("APPROVE"), notes: optionalText(500) }),
  z.object({
    action: z.literal("CANCEL"),
    reason: z
      .string()
      .trim()
      .min(5, "Give the reason the earmark is being cancelled.")
      .max(500),
  }),
]);

// ---------------------------------------------------------------------------
// Disbursements
// ---------------------------------------------------------------------------

export const PAYEE_TYPES = [
  "SUPPLIER",
  "BENEFICIARY",
  "CREW",
  "UTILITY",
  "OTHER",
] as const;

export const PAYEE_TYPE_LABELS: Record<(typeof PAYEE_TYPES)[number], string> = {
  SUPPLIER: "Supplier",
  BENEFICIARY: "Resident / beneficiary",
  CREW: "Crew member",
  UTILITY: "Utility",
  OTHER: "Other",
};

export const MODES_OF_PAYMENT = [
  "CASH",
  "CHECK",
  "BANK_TRANSFER",
  "GCASH",
  "PAYROLL",
] as const;

export const disbursementCrewBatchSchema = z
  .object({
    allocationId: z.coerce.number().int().positive("Pick an allocation."),
    earmarkId: z.coerce.number().int().positive("Pick an approved earmark."),
    concernId: z.coerce.number().int().positive("Link the case this payment is for."),
    crew: z.array(z.object({
      payeeUserId: z.coerce.number().int().positive(),
      amount: amountSchema("Each crew voucher amount"),
    })).min(1).max(20),
    particulars: optionalText(300),
    modeOfPayment: z.enum(MODES_OF_PAYMENT).optional(),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<number>();
    value.crew.forEach((line, index) => {
      if (seen.has(line.payeeUserId)) {
        ctx.addIssue({
          code: "custom",
          path: ["crew", index, "payeeUserId"],
          message: "Select each crew member only once.",
        });
      }
      seen.add(line.payeeUserId);
    });
  });

export const crewPaymentRequestActionSchema = z
  .object({
    earmarkId: nullableId("Earmark"),
    decisions: z.array(
      z.discriminatedUnion("action", [
        z.object({
          lineId: z.coerce.number().int().positive(),
          action: z.literal("PAY"),
          amount: amountSchema("The crew payment amount"),
        }),
        z.object({
          lineId: z.coerce.number().int().positive(),
          action: z.literal("HOLD"),
          reason: z.string().trim().min(5, "A hold reason is required (at least 5 characters).").max(500),
        }),
      ])
    ).min(1, "Choose Pay or Hold for at least one crew member.").max(100),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<number>();
    value.decisions.forEach((decision, index) => {
      if (seen.has(decision.lineId)) {
        ctx.addIssue({
          code: "custom",
          path: ["decisions", index, "lineId"],
          message: "Choose each crew member only once.",
        });
      }
      seen.add(decision.lineId);
    });
  });

export const disbursementCreateSchema = z.object({
  allocationId: z.coerce.number().int().positive("Pick an allocation."),
  earmarkId: nullableId("Earmark"),
  concernId: nullableId("Case"),
  payee: z.string().trim().min(2, "Who is being paid?").max(160),
  payeeType: z.enum(PAYEE_TYPES),
  payeeUserId: nullableId("Resident"),
  amount: amountSchema("The voucher amount"),
  particulars: z
    .string()
    .trim()
    .min(5, "Describe what is being paid for.")
    .max(300),
  modeOfPayment: z.enum(MODES_OF_PAYMENT).optional(),
});

/**
 * One endpoint drives the whole voucher lifecycle, so the action carries its
 * own requirement: a rejection or cancellation needs a reason, a liquidation
 * needs notes, a release may carry the proof photo and the mode of payment.
 */
export const disbursementActionSchema = z
  .object({
    action: z.enum(DISBURSEMENT_ACTIONS),
    remarks: optionalText(500),
    reason: optionalText(500),
    modeOfPayment: z.enum(MODES_OF_PAYMENT).optional(),
    proofUrl: optionalText(500),
    liquidationNotes: optionalText(500),
    liquidationStatus: z.enum(["LIQUIDATED", "PARTIAL"]).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      (value.action === "REJECT" || value.action === "CANCEL") &&
      (!value.reason || value.reason.length < 5)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message:
          value.action === "REJECT"
            ? "Say why the voucher is being returned (at least 5 characters)."
            : "Say why the voucher is being cancelled (at least 5 characters).",
      });
    }
    if (
      value.action === "LIQUIDATE" &&
      (!value.liquidationNotes || value.liquidationNotes.length < 5)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["liquidationNotes"],
        message: "Describe how the amount was spent or returned.",
      });
    }
    if (value.proofUrl && !httpsOrRelative.safeParse(value.proofUrl).success) {
      ctx.addIssue({
        code: "custom",
        path: ["proofUrl"],
        message:
          "The proof must be a stored file path or an http(s) URL.",
      });
    }
  });

export const disbursementAdjustSchema = z.object({
  action: z.enum(APPROVAL_DECISIONS),
  remarks: z
    .string()
    .trim()
    .min(3, "Add a short remark for the record.")
    .max(500),
});

export const treasuryStatusFilterSchema = z.object({
  status: z.enum(DISBURSEMENT_STATUSES).optional(),
});
