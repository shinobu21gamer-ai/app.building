import { z } from "zod";

// Audit-chain verification requests. A range is optional: leaving both ends out
// verifies the whole chain, which is what the weekly job does.

const bigintFromInput = z.preprocess(
  (value) => {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value === "bigint") return value;
    const asString = String(value).trim();
    return /^\d+$/.test(asString) ? BigInt(asString) : value;
  },
  z
    .bigint({ error: "Sequence numbers must be whole positive numbers." })
    .nonnegative("Sequence numbers cannot be negative.")
    .optional()
);

export const auditVerifySchema = z.object({
  fromSeq: bigintFromInput,
  toSeq: bigintFromInput,
});

export type AuditVerifyInput = z.infer<typeof auditVerifySchema>;
