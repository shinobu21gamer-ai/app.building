import { describe, expect, it } from "vitest";

import { documentToCsv, textColumn, numericColumn } from "@/lib/reports/document";
import type { ReportDocument } from "@/lib/reports/document";
import {
  CSV_CHUNK_ROWS,
  csvChunks,
  csvStreamHeaders,
  sectionCsvChunks,
  streamDocumentCsv,
  streamSectionCsv,
} from "@/lib/reports/stream";

function document(): ReportDocument {
  return {
    key: "engineering",
    title: "Engineering report",
    generatedAt: "2026-10-12T02:00:00.000Z",
    period: { key: "90d", from: new Date("2026-07-15T16:00:00Z"), to: null, days: 90 },
    stats: [{ label: "Cases", value: 3 }],
    sections: [
      {
        key: "byType",
        title: "Cases by type",
        columns: [textColumn("type", "Type"), numericColumn("count", "Cases")],
        rows: [
          { type: "Repair", count: 2 },
          { type: "Ayuda", count: 1 },
        ],
      },
      {
        key: "empty",
        title: "Cases by area",
        columns: [textColumn("area", "Area")],
        rows: [],
      },
    ],
  };
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

describe("csvChunks", () => {
  it("starts each section with its title, then the header row", () => {
    const chunks = csvChunks(document());
    expect(chunks[0]).toBe("# Cases by type\n");
    expect(chunks[1]).toBe('"Type","Cases"\n"Repair","2"\n"Ayuda","1"\n');
  });

  it("writes the header even for a section with no rows", () => {
    const chunks = csvChunks(document());
    expect(chunks).toContain("# Cases by area\n");
    expect(chunks).toContain('"Area"\n');
  });

  it("splits on row boundaries and repeats the header only once", () => {
    const rows = Array.from({ length: CSV_CHUNK_ROWS + 5 }, (_, index) => ({
      type: `T${index.toString()}`,
      count: index,
    }));
    const chunks = csvChunks({
      ...document(),
      sections: [
        { key: "big", title: "Big", columns: [textColumn("type", "Type")], rows },
      ],
    });
    expect(chunks[0]).toBe("# Big\n");
    expect(chunks[1]).toContain('"Type"\n');
    expect(chunks[1]?.split("\n").filter(Boolean)).toHaveLength(CSV_CHUNK_ROWS + 1);
    // The continuation chunk carries the remaining 5 rows and no header.
    expect(chunks[2]?.split("\n").filter(Boolean)).toHaveLength(5);
    expect(chunks[2]).not.toContain('"Type"');
  });

  it("never splits a CSV line across chunks", () => {
    const chunks = csvChunks(document());
    for (const chunk of chunks) {
      // Every chunk that carries rows ends on a newline.
      if (chunk.includes('"')) expect(chunk.endsWith("\n")).toBe(true);
    }
  });

  it("treats a nonsensical chunk size as one row at a time", () => {
    const chunks = csvChunks(document(), 0);
    expect(chunks.some((chunk) => chunk.includes('"Repair"'))).toBe(true);
  });
});

describe("streamDocumentCsv", () => {
  it("produces exactly the bytes the synchronous exporter produces", async () => {
    const streamed = await drain(streamDocumentCsv(document()));
    expect(streamed).toBe(documentToCsv(document()));
  });

  it("matches for documents large enough to span several chunks", async () => {
    const rows = Array.from({ length: 600 }, (_, index) => ({
      type: "Repair",
      count: index,
    }));
    const big: ReportDocument = {
      ...document(),
      sections: [
        {
          key: "big",
          title: "Volume",
          columns: [textColumn("type", "Type"), numericColumn("count", "Cases")],
          rows,
        },
      ],
    };
    expect(await drain(streamDocumentCsv(big))).toBe(documentToCsv(big));
  });

  it("delivers the first chunk before it has built the whole file", async () => {
    const rows = Array.from({ length: 1000 }, (_, index) => ({ type: `T${index}`, count: index }));
    const stream = streamDocumentCsv({
      ...document(),
      sections: [
        { key: "big", title: "Volume", columns: [textColumn("type", "Type")], rows },
      ],
    });
    const reader = stream.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe("# Volume\n");
    await reader.cancel();
  });

  it("streams an empty document as an empty body", async () => {
    const empty: ReportDocument = { ...document(), sections: [] };
    expect(await drain(streamDocumentCsv(empty))).toBe("");
  });
});

describe("streamSectionCsv", () => {
  it("streams a bare table, without the section title line", async () => {
    const section = document().sections[0];
    const text = await drain(streamSectionCsv(section));
    expect(text.startsWith('"Type","Cases"')).toBe(true);
    expect(text).not.toContain("# Cases by type");
  });

  it("is the section table with nothing trimmed", () => {
    const section = document().sections[0];
    const chunks = sectionCsvChunks(section);
    const joined = chunks.join("");
    expect(joined).toBe(
      '"Type","Cases"\n"Repair","2"\n"Ayuda","1"\n'
    );
  });

  it("keeps every row when the section spans chunks", async () => {
    const section = {
      key: "big",
      title: "Big",
      columns: [textColumn("type", "Type")],
      rows: Array.from({ length: 501 }, (_, index) => ({
        type: `T${index.toString()}`,
      })),
    };
    const text = await drain(streamSectionCsv(section, { chunkRows: 500 }));
    const lines = text.split("\n").filter(Boolean);
    expect(lines).toHaveLength(502); // header + 501 rows
    expect(lines[0]).toBe('"Type"');
    expect(lines[501]).toBe('"T500"');
  });
});

describe("csvStreamHeaders", () => {
  it("names the file after the report and the period", () => {
    const headers = csvStreamHeaders("engineering-90d");
    expect(headers["Content-Disposition"]).toMatch(
      /^attachment; filename="barangayresolve-engineering-90d-\d{4}-\d{2}-\d{2}\.csv"$/
    );
  });

  it("forbids caching and proxy buffering", () => {
    const headers = csvStreamHeaders("engineering-90d");
    expect(headers["Cache-Control"]).toBe("no-store");
    expect(headers["X-Accel-Buffering"]).toBe("no");
    expect(headers["Content-Type"]).toContain("text/csv");
  });
});
