export type JournalVisibilityEntry = { visibility: string };

/** Only explicitly resident-visible journal entries belong in the resident timeline. */
export function residentVisibleJournal<T extends JournalVisibilityEntry>(
  entries: readonly T[],
): T[] {
  return entries.filter((entry) => entry.visibility === "RESIDENT_VISIBLE");
}
