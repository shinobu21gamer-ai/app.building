// Pure catalogues for the RA 10173 privacy controls: consent purposes,
// data-subject request types and their statuses, plus the privacy-notice
// version residents agree to.
//
// No database, no Node built-ins: this module is imported by Zod schemas,
// server components and client components alike.

export const PRIVACY_POLICY_VERSION = "2026-10-12";

export const CONSENT_PURPOSES = [
  "DATA_PROCESSING",
  "PRIVACY_NOTICE",
  "TRANSPARENCY_PUBLICATION",
  "NOTIFICATIONS",
  "SMS",
  "ID_VERIFICATION",
] as const;

export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export type ConsentPurposeDefinition = {
  purpose: ConsentPurpose;
  label: string;
  description: string;
  /** Refusing this consent blocks account creation (RA 10173 §12–13). */
  requiredAtSignup: boolean;
  /** Residents may withdraw it later without losing access to their cases. */
  withdrawable: boolean;
};

export const CONSENT_PURPOSES_DEFINITIONS: readonly ConsentPurposeDefinition[] =
  [
    {
      purpose: "DATA_PROCESSING",
      label: "Data processing for my concern",
      description:
        "I allow BarangayResolve to collect and process the personal information I submit so my concern can be acted upon.",
      requiredAtSignup: true,
      withdrawable: false,
    },
    {
      purpose: "PRIVACY_NOTICE",
      label: "I have read the privacy notice",
      description:
        "I have read how BarangayResolve collects, uses, stores and shares my information.",
      requiredAtSignup: true,
      withdrawable: false,
    },
    {
      purpose: "TRANSPARENCY_PUBLICATION",
      label: "Publish my case without personal details",
      description:
        "Allow my case to appear on the public transparency page. Only an anonymous reference and a coarse location are published; my name, contact details and exact address are never shown.",
      requiredAtSignup: false,
      withdrawable: true,
    },
    {
      purpose: "NOTIFICATIONS",
      label: "In-app notifications",
      description:
        "Send me status updates about my concern inside BarangayResolve.",
      requiredAtSignup: false,
      withdrawable: true,
    },
    {
      purpose: "SMS",
      label: "Text message updates",
      description:
        "I agree the hall may send case updates by text if an SMS gateway is later configured. This checkbox only records consent — BarangayResolve does not send SMS today.",
      requiredAtSignup: false,
      withdrawable: true,
    },
    {
      purpose: "ID_VERIFICATION",
      label: "Identity verification",
      description:
        "Process the identity document I submit to verify who I am. The document is encrypted and staff only ever see the last four characters of the ID number.",
      requiredAtSignup: false,
      withdrawable: true,
    },
  ];

export const CONSENT_PURPOSE_LABELS: Record<ConsentPurpose, ConsentPurposeDefinition> =
  CONSENT_PURPOSES_DEFINITIONS.reduce(
    (acc, definition) => {
      acc[definition.purpose] = definition;
      return acc;
    },
    {} as Record<ConsentPurpose, ConsentPurposeDefinition>
  );

/** Consents the registration form must tick. */
export const REQUIRED_SIGNUP_CONSENTS: readonly ConsentPurpose[] =
  CONSENT_PURPOSES_DEFINITIONS.filter((c) => c.requiredAtSignup).map(
    (c) => c.purpose
  );

export const OPTIONAL_SIGNUP_CONSENTS: readonly ConsentPurpose[] =
  CONSENT_PURPOSES_DEFINITIONS.filter((c) => !c.requiredAtSignup).map(
    (c) => c.purpose
  );

export const CONSENT_STATUSES = ["GRANTED", "WITHDRAWN"] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export const DSR_TYPES = [
  "ACCESS",
  "RECTIFICATION",
  "ERASURE",
  "PORTABILITY",
  "OBJECTION",
  "COMPLAINT",
] as const;

export type DsrType = (typeof DSR_TYPES)[number];

export const DSR_TYPE_LABELS: Record<DsrType, string> = {
  ACCESS: "Access my data",
  RECTIFICATION: "Correct my data",
  ERASURE: "Erase my data",
  PORTABILITY: "Copy of my data",
  OBJECTION: "Object to processing",
  COMPLAINT: "Complaint",
};

export const DSR_STATUSES = ["RECEIVED", "IN_REVIEW", "COMPLETED", "REJECTED"] as const;
export type DsrStatus = (typeof DSR_STATUSES)[number];

export const DSR_STATUS_LABELS: Record<DsrStatus, string> = {
  RECEIVED: "Received",
  IN_REVIEW: "In review",
  COMPLETED: "Completed",
  REJECTED: "Rejected",
};

export function isConsentPurpose(value: unknown): value is ConsentPurpose {
  return (
    typeof value === "string" &&
    (CONSENT_PURPOSES as readonly string[]).includes(value)
  );
}

export function isConsentStatus(value: unknown): value is ConsentStatus {
  return (
    typeof value === "string" &&
    (CONSENT_STATUSES as readonly string[]).includes(value)
  );
}

export function isDsrType(value: unknown): value is DsrType {
  return typeof value === "string" && (DSR_TYPES as readonly string[]).includes(value);
}

export function isDsrStatus(value: unknown): value is DsrStatus {
  return (
    typeof value === "string" && (DSR_STATUSES as readonly string[]).includes(value)
  );
}

export function dsrTypeLabel(type: string): string {
  return isDsrType(type) ? DSR_TYPE_LABELS[type] : type;
}

export function dsrStatusLabel(status: string): string {
  return isDsrStatus(status) ? DSR_STATUS_LABELS[status] : status;
}

export function consentPurposeLabel(purpose: string): string {
  return isConsentPurpose(purpose)
    ? CONSENT_PURPOSE_LABELS[purpose].label
    : purpose;
}
