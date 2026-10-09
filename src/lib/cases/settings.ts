// Runtime key/value application settings, stored in the AppSetting table.
// Admins configure these through the /admin/settings page and API.

export const FEEDBACK_RESUBMISSION_KEY = "feedback.resubmission_allowed";
export const UPLOAD_DAILY_QUOTA_KEY = "uploads.daily_quota_bytes";
export const BARANGAY_AREAS_KEY = "barangay.areas";

export const DEFAULT_BARANGAY_AREAS = [
  "Purok 1",
  "Purok 2",
  "Purok 3",
  "Purok 4",
  "Purok 5",
  "Purok 6",
  "Purok 7",
  "Barangay Hall",
  "Public Market",
  "Health Center",
  "School Zone",
  "Other area",
];

const DEFAULT_DAILY_UPLOAD_QUOTA_BYTES = 25 * 1024 * 1024; // 25 MiB

type SettingsClient = {
  appSetting: {
    findUnique(args: {
      where: { key: string };
    }): Promise<{ value: string } | null>;
  };
};

/**
 * Reads the flag that lets residents revise their feedback after submitting.
 * Missing rows are treated as "not allowed".
 */
export async function isFeedbackResubmissionAllowed(
  client: SettingsClient
): Promise<boolean> {
  const row = await client.appSetting.findUnique({
    where: { key: FEEDBACK_RESUBMISSION_KEY },
  });
  return row?.value === "true";
}

/**
 * Daily per-user upload budget in bytes. Missing or unparseable rows fall
 * back to the documented default (25 MiB) so a bad setting can never raise
 * or disable the quota entirely.
 */
export async function getUploadDailyQuotaBytes(
  client: SettingsClient
): Promise<number> {
  const row = await client.appSetting.findUnique({
    where: { key: UPLOAD_DAILY_QUOTA_KEY },
  });
  if (!row) return DEFAULT_DAILY_UPLOAD_QUOTA_BYTES;
  const value = Number(row.value);
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_DAILY_UPLOAD_QUOTA_BYTES;
  }
  return Math.floor(value);
}

const MAX_AREAS = 50;
const MAX_AREA_LENGTH = 80;

/**
 * One area per line. Empty/invalid lists fall back to the default purok set
 * so the submit form never renders with zero options.
 */
export function parseBarangayAreas(value: string | null | undefined): string[] {
  if (!value) return [...DEFAULT_BARANGAY_AREAS];
  const seen = new Set<string>();
  const areas: string[] = [];
  for (const line of value.split(/\r?\n/)) {
    const area = line.trim().slice(0, MAX_AREA_LENGTH);
    if (!area) continue;
    const key = area.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    areas.push(area);
    if (areas.length >= MAX_AREAS) break;
  }
  return areas.length > 0 ? areas : [...DEFAULT_BARANGAY_AREAS];
}

export async function getBarangayAreas(
  client: SettingsClient
): Promise<string[]> {
  const row = await client.appSetting.findUnique({
    where: { key: BARANGAY_AREAS_KEY },
  });
  return parseBarangayAreas(row?.value);
}
