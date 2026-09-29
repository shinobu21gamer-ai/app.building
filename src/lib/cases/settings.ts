// Runtime key/value application settings, stored in the AppSetting table.
// Admins configure these through the /admin/settings page and API.

export const FEEDBACK_RESUBMISSION_KEY = "feedback.resubmission_allowed";
export const UPLOAD_DAILY_QUOTA_KEY = "uploads.daily_quota_bytes";

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