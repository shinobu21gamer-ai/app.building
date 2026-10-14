// Opt-in, tab-session-only draft. No photos, GPS pins, credentials, or account
// data. Keys are scoped to the signed-in resident and cleared at sign-out.
export const CONCERN_DRAFT_FIELDS = {
  title: 150, description: 2000, locationArea: 100, locationAddress: 255,
  categoryId: 20, typeId: 20, urgencyScore: 20, impactScore: 20,
  affectedPopulationScore: 20, safetyScore: 20,
} as const;
export type ConcernDraft = { version: 1; savedAt: number; fields: Partial<Record<keyof typeof CONCERN_DRAFT_FIELDS, string>> };
const PREFIX = "barangayresolve.concernDraft.";
const TTL = 24 * 60 * 60 * 1000;
export function saveConcernDraft(storage: Storage, userId: number, data: FormData, now = Date.now()): ConcernDraft {
  const fields: ConcernDraft["fields"] = {};
  for (const [key, max] of Object.entries(CONCERN_DRAFT_FIELDS)) {
    const value = data.get(key);
    if (typeof value === "string") fields[key as keyof typeof fields] = value.slice(0, max);
  }
  const draft: ConcernDraft = { version: 1, savedAt: now, fields };
  storage.setItem(`${PREFIX}${userId}`, JSON.stringify(draft));
  return draft;
}
export function readConcernDraft(storage: Storage, userId: number, now = Date.now()): ConcernDraft | null {
  try {
    const raw = storage.getItem(`${PREFIX}${userId}`);
    if (!raw) return null;
    const value = JSON.parse(raw) as ConcernDraft;
    if (value.version !== 1 || !Number.isFinite(value.savedAt) || value.savedAt > now || now - value.savedAt >= TTL || !value.fields || typeof value.fields !== "object") {
      removeConcernDraft(storage, userId);
      return null;
    }
    const fields: ConcernDraft["fields"] = {};
    for (const [key, max] of Object.entries(CONCERN_DRAFT_FIELDS)) {
      const field = value.fields[key as keyof typeof value.fields];
      if (typeof field === "string") fields[key as keyof typeof fields] = field.slice(0, max);
    }
    return { version: 1, savedAt: value.savedAt, fields };
  } catch { return null; }
}
export function removeConcernDraft(storage: Storage, userId: number): void {
  storage.removeItem(`${PREFIX}${userId}`);
}
export function clearConcernDrafts(storage: Storage): void {
  for (let i = storage.length - 1; i >= 0; i--) {
    const key = storage.key(i);
    if (key?.startsWith(PREFIX)) storage.removeItem(key);
  }
}
