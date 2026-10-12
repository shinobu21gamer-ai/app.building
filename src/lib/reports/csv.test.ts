import { describe, expect, it } from "vitest";

import { csvCell, csvFilename, toCsv } from "@/lib/reports/csv";
import {
  documentToCsv,
  sectionToCsv,
  type ReportDocument,
} from "@/lib/reports/document";

describe("csvCell", () => {
  it("quotes plain text", () => {
    expect(csvCell("Purok 3")).toBe('"Purok 3"');
  });

  it("doubles inner quotes so a row cannot shift", () => {
    expect(csvCell('Barangay "Poblacion"')).toBe('"Barangay ""Poblacion"""');
  });

  it("keeps commas and newlines inside the cell", () => {
    expect(csvCell("Fallen tree, near the hall")).toBe('"Fallen tree, near the hall"');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });

  it("neutralises formula injection", () => {
    expect(csvCell("=1+1")).toBe('"\'=1+1"');
    expect(csvCell("+63 917 000 0000")).toBe('"\'+63 917 000 0000"');
    expect(csvCell("-5")).toBe('"\'-5"');
    expect(csvCell("@SUM(A1)")).toBe('"\'@SUM(A1)"');
    expect(csvCell("\tleading tab")).toBe('"\'\tleading tab"');
  });

  it("renders empty cells for null and undefined", () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });

  it("renders dates as ISO instants and booleans as yes/no", () => {
    expect(csvCell(new Date("2026-10-12T00:00:00Z"))).toBe(
      '"2026-10-12T00:00:00.000Z"'
    );
    expect(csvCell(true)).toBe('"yes"');
    expect(csvCell(false)).toBe('"no"');
  });

  it("renders a non-finite number as an empty cell rather than NaN", () => {
    expect(csvCell(Number.NaN)).toBe('""');
    expect(csvCell(Number.POSITIVE_INFINITY)).toBe('""');
  });

  it("keeps zero as a value", () => {
    expect(csvCell(0)).toBe('"0"');
  });
});

describe("toCsv", () => {
  it("writes a header row, one row per record, and a trailing newline", () => {
    const csv = toCsv(
      ["Case", "Status"],
      [
        ["BR-1", "RESOLVED"],
        ["BR-2", "IN_PROGRESS"],
      ]
    );
    expect(csv).toBe('"Case","Status"\n"BR-1","RESOLVED"\n"BR-2","IN_PROGRESS"\n');
  });

  it("still writes the header for an empty report", () => {
    expect(toCsv(["Case"], [])).toBe('"Case"\n');
  });
});

describe("csvFilename", () => {
  it("slugs the name and stamps the date", () => {
    expect(csvFilename("Engineering report", new Date("2026-10-12T02:00:00Z"))).toBe(
      "barangayresolve-engineering-report-2026-10-12.csv"
    );
  });

  it("falls back to 'export' when the slug is empty", () => {
    expect(csvFilename("///", new Date("2026-10-12T02:00:00Z"))).toBe(
      "barangayresolve-export-2026-10-12.csv"
    );
  });

  it("never emits a quote or a path separator", () => {
    const name = csvFilename('../../etc/"passwd"', new Date("2026-10-12T02:00:00Z"));
    expect(name).not.toContain("/");
    expect(name).not.toContain('"');
  });
});

const document: ReportDocument = {
  key: "engineering",
  title: "Engineering",
  generatedAt: "2026-10-12T02:00:00.000Z",
  period: { key: "90d", from: null, to: null, days: 90 },
  stats: [{ label: "Cases", value: 3 }],
  sections: [
    {
      key: "byStatus",
      title: "By status",
      columns: [
        { key: "status", label: "Status" },
        { key: "count", label: "Cases", align: "right" },
      ],
      rows: [
        { status: "SUBMITTED", count: 2 },
        { status: "RESOLVED", count: 1 },
      ],
    },
    {
      key: "crew",
      title: "Crew",
      columns: [{ key: "name", label: "Crew" }],
      rows: [{ name: "=danger" }],
    },
  ],
};

describe("report documents as CSV", () => {
  it("exports one section with its column labels", () => {
    expect(sectionToCsv(document.sections[0])).toBe(
      '"Status","Cases"\n"SUBMITTED","2"\n"RESOLVED","1"\n'
    );
  });

  it("exports every section, headed by a comment line", () => {
    const csv = documentToCsv(document);
    expect(csv).toContain("# By status");
    expect(csv).toContain("# Crew");
    expect(csv).toContain('"\'=danger"');
  });

  it("ignores row keys that are not in the column list", () => {
    const csv = sectionToCsv({
      key: "s",
      title: "s",
      columns: [{ key: "a", label: "A" }],
      rows: [{ a: "1", b: "ignored" }],
    });
    expect(csv).toBe('"A"\n"1"\n');
  });
});
