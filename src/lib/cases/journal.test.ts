import { describe, expect, it } from "vitest";
import { actionDateForDay } from "./action-date";
import { journalReachedAt, sortJournal } from "./journal";

describe("sortJournal", () => {
  it("orders entries by the day they are dated to, then by record order", () => {
    const entries = [
      {
        // Recorded last, but the action happened on Sep 24.
        id: 3,
        createdAt: new Date("2026-10-09T03:00:00Z"),
        occurredOn: actionDateForDay("2026-09-24"),
      },
      {
        id: 1,
        createdAt: new Date("2026-09-20T02:00:00Z"),
        occurredOn: null,
      },
      {
        // Same action day as entry 3 but recorded earlier.
        id: 2,
        createdAt: new Date("2026-09-24T01:00:00Z"),
        occurredOn: actionDateForDay("2026-09-24"),
      },
    ];

    expect(sortJournal(entries).map((entry) => entry.id)).toEqual([1, 2, 3]);
  });

  it("breaks ties on the same day by the record id", () => {
    const at = new Date("2026-09-24T01:00:00Z");
    const entries = [
      { id: 9, createdAt: at, occurredOn: actionDateForDay("2026-09-24") },
      { id: 4, createdAt: at, occurredOn: actionDateForDay("2026-09-24") },
    ];
    expect(sortJournal(entries).map((entry) => entry.id)).toEqual([4, 9]);
  });

  it("does not mutate the input array", () => {
    const entries = [
      { id: 2, createdAt: new Date("2026-10-01T00:00:00Z"), occurredOn: null },
      { id: 1, createdAt: new Date("2026-09-01T00:00:00Z"), occurredOn: null },
    ];
    sortJournal(entries);
    expect(entries.map((entry) => entry.id)).toEqual([2, 1]);
  });
});

describe("journalReachedAt", () => {
  it("reports a recorded action date as a calendar day", () => {
    const occurredOn = actionDateForDay("2026-09-24");
    expect(
      journalReachedAt({
        occurredOn,
        createdAt: new Date("2026-10-09T01:00:00Z"),
      })
    ).toEqual({ at: occurredOn, dateOnly: true });
  });

  it("reports an automated entry by its record time", () => {
    const createdAt = new Date("2026-09-20T02:00:00Z");
    expect(journalReachedAt({ occurredOn: null, createdAt })).toEqual({
      at: createdAt,
      dateOnly: false,
    });
  });
});
