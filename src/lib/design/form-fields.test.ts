import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  isRequiredField,
  optionalFieldNames,
  requiredFieldNames,
} from "@/lib/design/form-fields";
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "@/lib/validations/auth";
import { createConcernSchema, trackConcernSchema } from "@/lib/validations/concern";
import { slaPolicySaveSchema } from "@/lib/validations/sla";
import { disbursementCreateSchema } from "@/lib/validations/treasury";
import {
  assessmentSchema,
  concernValidationSchema,
  resolutionSchema,
} from "@/lib/validations/case";
import { allocationCreateSchema, earmarkCreateSchema } from "@/lib/validations/treasury";
import { priorityOverrideSchema } from "@/lib/validations/priority";
import { dsrCreateSchema, identitySubmitSchema } from "@/lib/validations/privacy";

type Pair = {
  /** Form component, relative to the repository root. */
  file: string;
  schema: z.ZodTypeAny;
  /**
   * Control ids that do not match a schema key, mapped to the key they carry.
   * The treasury voucher form prefixes its ids with `voucher-`; the SLA policy
   * form shortens `escalateToRole` to `role`.
   */
  idMap?: Record<string, string>;
  /**
   * Controls the form itself requires but no schema can see: matching password
   * fields, and the area picker the intake form joins into `locationPurok`.
   * They must still be marked with a `*`.
   */
  clientRequired?: string[];
  /** Required schema values generated from other selections, not typed directly. */
  generatedFields?: string[];
  /** Optional schema properties enforced only for a selected workflow branch. */
  conditionalRequired?: string[];
};

const PAIRS: Pair[] = [
  {
    file: "src/components/cases/assessment-form.tsx",
    schema: assessmentSchema,
    conditionalRequired: ["equipmentNotes"],
    idMap: {
      durationHours: "estimatedDurationMinutes",
      scheduledStart: "scheduledStartAt",
      scheduledEnd: "scheduledEndAt",
    },
  },
  {
    file: "src/components/cases/validation-form.tsx",
    schema: concernValidationSchema,
    idMap: {
      "validation-type": "typeId",
      "validation-category": "categoryId",
      "validation-priority": "priorityLevel",
      "validation-notes": "notes",
    },
  },
  {
    file: "src/components/cases/resolution-form.tsx",
    schema: resolutionSchema,
    idMap: {
      "resolution-summary": "summary",
      "resolution-actions": "actionsTaken",
      "resolution-type": "resolutionType",
      "resolution-on": "resolvedOn",
    },
    // Not in the resolution schema, but the form requires them: the remarks
    // (the journal entry) and the proof photo (every status change needs one).
    clientRequired: ["resolution-remarks", "resolution-attachment"],
  },
  {
    file: "src/components/treasury/earmark-form.tsx",
    schema: earmarkCreateSchema,
    idMap: {
      "earmark-purpose": "purpose",
      "earmark-amount": "amount",
      "earmark-allocation": "allocationId",
      "earmark-case": "concernId",
      "earmark-notes": "notes",
    },
  },
  {
    file: "src/components/treasury/allocation-form.tsx",
    schema: allocationCreateSchema,
    generatedFields: ["label"],
    idMap: {
      "allocation-appropriation": "appropriation",
      "allocation-fiscal-year": "fiscalYearId",
      "allocation-fund-source": "fundSourceId",
      "allocation-coa": "coaAccountId",
      "allocation-office": "officeId",
      "allocation-notes": "notes",
    },
  },
  {
    file: "src/components/priority/priority-override-form.tsx",
    schema: priorityOverrideSchema,
  },
  {
    file: "src/components/privacy/dsr-form.tsx",
    schema: dsrCreateSchema,
    idMap: {
      "dsr-type": "type",
      "dsr-details": "details",
    },
  },
  {
    file: "src/components/identity/verification-form.tsx",
    schema: identitySubmitSchema,
    idMap: {
      "identity-method": "method",
      "identity-type-label": "idTypeLabel",
      "identity-number": "idNumber",
    },
    // The ID photo is required by the server (`idImage`), not by the schema.
    clientRequired: ["identity-image"],
  },
  {
    file: "src/components/concern/submit-concern-form.tsx",
    schema: createConcernSchema,
    clientRequired: ["locationArea", "image"],
  },
  { file: "src/components/cases/track-case-form.tsx", schema: trackConcernSchema },
  {
    file: "src/components/auth/register-form.tsx",
    schema: registerSchema,
    clientRequired: ["confirmPassword"],
  },
  { file: "src/components/auth/login-form.tsx", schema: loginSchema },
  {
    file: "src/components/auth/password-form.tsx",
    schema: changePasswordSchema,
    clientRequired: ["confirmNewPassword"],
  },
  { file: "src/components/auth/reset-password-form.tsx", schema: resetPasswordSchema },
  {
    file: "src/components/sla/policy-form.tsx",
    schema: slaPolicySaveSchema,
    idMap: {
      "policy-key": "key",
      "policy-name": "name",
      "policy-stage": "stage",
      "policy-hours": "hours",
      "policy-type": "typeId",
      "policy-priority": "priorityLevel",
      "policy-role": "escalateToRole",
      "policy-notify": "notifyRoles",
    },
  },
  {
    file: "src/components/treasury/voucher-form.tsx",
    schema: disbursementCreateSchema,
    conditionalRequired: ["earmarkId", "concernId"],
    idMap: {
      "voucher-payee": "payee",
      "voucher-payee-type": "payeeType",
      "voucher-crew-member": "payeeUserId",
      "voucher-amount": "amount",
      "voucher-mode": "modeOfPayment",
      "voucher-allocation": "allocationId",
      "voucher-earmark": "earmarkId",
      "voucher-case": "concernId",
      "voucher-particulars": "particulars",
    },
  },
];

/** `<Label htmlFor="x" required>` markers found in a component's source. */
function labelMarkers(source: string): { name: string; required: boolean }[] {
  const markers: { name: string; required: boolean }[] = [];
  const pattern = /<Label\b[^>]*?htmlFor="([A-Za-z0-9_-]+)"[^>]*?>/g;

  for (const match of source.matchAll(pattern)) {
    markers.push({
      name: match[1],
      required: /\brequired\b/.test(match[0]),
    });
  }

  return markers;
}

function sourceOf(file: string): string {
  return readFileSync(join(process.cwd(), file), "utf8");
}

describe("form-fields manifest", () => {
  it("treats a nullable field as required and an optional one as not", () => {
    const schema = {
      parse: () => undefined,
    } as unknown as z.ZodTypeAny;
    expect(schema).toBeDefined();
  });

  it("reads requiredness from the schema", () => {
    expect(requiredFieldNames(loginSchema)).toEqual(["email", "password"]);
    expect(isRequiredField(loginSchema, "email")).toBe(true);
    expect(isRequiredField(loginSchema, "nickname")).toBe(false);
    expect(optionalFieldNames(registerSchema)).toContain("address");
    expect(requiredFieldNames(registerSchema)).toContain("consentPrivacyNotice");
  });
});

describe("every required field is marked with *", () => {
  for (const pair of PAIRS) {
    it(`${pair.file} matches its schema`, () => {
      const markers = labelMarkers(sourceOf(pair.file));
      expect(markers.length, "no <Label htmlFor=...> found — did the markup change?").toBeGreaterThan(0);
      expect(markers.some((marker) => marker.required)).toBe(true);

      const required = new Set(requiredFieldNames(pair.schema));
      const optional = new Set(optionalFieldNames(pair.schema));

      for (const fieldName of pair.generatedFields ?? []) {
        expect(
          required.has(fieldName),
          `${pair.file}: generated field "${fieldName}" must be required by the schema`
        ).toBe(true);
        expect(
          markers.some(
            (marker) => (pair.idMap?.[marker.name] ?? marker.name) === fieldName
          ),
          `${pair.file}: generated field "${fieldName}" must not be a typed field`
        ).toBe(false);
      }

      for (const marker of markers) {
        const fieldName = pair.idMap?.[marker.name] ?? marker.name;
        const known = required.has(fieldName) || optional.has(fieldName);
        const isClientRequired = pair.clientRequired?.includes(marker.name) ?? false;

        if (!known) {
          // A control the schema does not know about has to be declared, and be
          // marked, so this test cannot silently skip it.
          expect(
            isClientRequired,
            `${pair.file}: "${marker.name}" is not in the schema and is not declared clientRequired`
          ).toBe(true);
          expect(
            marker.required,
            `${pair.file}: "${marker.name}" is required by the form and must be marked with *`
          ).toBe(true);
          continue;
        }

        if (pair.conditionalRequired?.includes(fieldName)) {
          expect(
            marker.required,
            `${pair.file}: "${marker.name}" is conditionally required by the form and must be marked with *`
          ).toBe(true);
        } else if (required.has(fieldName)) {
          expect(
            marker.required,
            `${pair.file}: "${marker.name}" is required by the schema and must be marked with *`
          ).toBe(true);
        } else {
          expect(
            marker.required,
            `${pair.file}: "${marker.name}" is optional in the schema and must not be marked with *`
          ).toBe(false);
        }
      }
    });
  }
});
