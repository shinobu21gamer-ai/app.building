import { describe, expect, it } from "vitest";
import { residentVisibleJournal } from "./journal-visibility";

describe("residentVisibleJournal", () => {
  it("keeps only entries explicitly marked resident-visible", () => {
    const visible = { id: 1, visibility: "RESIDENT_VISIBLE", remarks: "Published update" };
    const internal = { id: 2, visibility: "INTERNAL", remarks: "Staff-only note" };
    const legacyOrUnknown = { id: 3, visibility: "", remarks: "Unknown" };

    expect(residentVisibleJournal([visible, internal, legacyOrUnknown])).toEqual([visible]);
  });
});
