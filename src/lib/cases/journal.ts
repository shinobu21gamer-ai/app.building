import { journalDay } from "@/lib/cases/action-date";

export type JournalEntryDates = {
  id: number;
  createdAt: Date;
  occurredOn: Date | null;
};

/**
 * Orders journal entries for display: by the day each one is dated to (its
 * action date, or the day it was recorded), then by record order. Backdated
 * entries therefore sit where they happened, while each still shows when it
 * was actually recorded.
 */
export function sortJournal<T extends JournalEntryDates>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => {
    const dayA = journalDay(a);
    const dayB = journalDay(b);
    if (dayA !== dayB) return dayA < dayB ? -1 : 1;
    const recorded = a.createdAt.getTime() - b.createdAt.getTime();
    if (recorded !== 0) return recorded;
    return a.id - b.id;
  });
}

/**
 * When a journal entry is treated as having happened for the progress stepper.
 * An entry with an action date reports that calendar day (date only); an
 * automated entry reports its record time.
 */
export function journalReachedAt(entry: {
  occurredOn: Date | null;
  createdAt: Date;
}): { at: Date; dateOnly: boolean } {
  return entry.occurredOn
    ? { at: entry.occurredOn, dateOnly: true }
    : { at: entry.createdAt, dateOnly: false };
}
