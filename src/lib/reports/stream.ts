import { csvFilename, csvRows, type CsvValue } from "@/lib/reports/csv";
import type { ReportDocument, ReportSection } from "@/lib/reports/document";

/**
 * Streaming CSV export.
 *
 * `documentToCsv` builds the whole file as one string, which is fine for the
 * summary reports (they are capped at a few thousand rows) and wrong for the
 * case register, which grows with the barangay. This module emits the same bytes
 * in chunks instead: a `ReadableStream` pulls one chunk at a time, so the
 * route's memory stays flat and the browser starts receiving data immediately.
 *
 * Chunk boundaries are invisible in the output — the tests assert that the
 * streamed text is byte-identical to the synchronous exporter's — so either one
 * can be used for the same document.
 */

/** Rows per chunk: 250 rows is a few tens of kB, comfortably above the MTU. */
export const CSV_CHUNK_ROWS = 250;

function cellsFor(section: ReportSection, rowIndex: number): CsvValue[] {
  const row = section.rows[rowIndex];
  return section.columns.map((column) => row[column.key] as CsvValue);
}

/**
 * One section as chunks: the header row, then the rows in slices. Never splits a
 * CSV line, so any client can concatenate the pieces.
 */
export function sectionCsvChunks(
  section: ReportSection,
  chunkRows: number = CSV_CHUNK_ROWS
): string[] {
  const size = Math.max(1, Math.trunc(chunkRows));
  const header = csvRows([section.columns.map((column) => column.label)]);
  const chunks: string[] = [];

  if (section.rows.length === 0) {
    // Still write the header: an empty section should look empty, not absent.
    return [`${header}\n`];
  }

  for (let start = 0; start < section.rows.length; start += size) {
    const rows: CsvValue[][] = [];
    const end = Math.min(section.rows.length, start + size);
    for (let index = start; index < end; index += 1) {
      rows.push(cellsFor(section, index));
    }
    chunks.push(start === 0 ? `${header}\n${csvRows(rows)}\n` : `${csvRows(rows)}\n`);
  }

  return chunks;
}

/**
 * The whole document as strings, each safe to write on its own. This is the
 * chunked form of `documentToCsv`: section title, its table, a blank line.
 */
export function csvChunks(
  document: ReportDocument,
  chunkRows: number = CSV_CHUNK_ROWS
): string[] {
  const chunks: string[] = [];
  for (const section of document.sections) {
    chunks.push(`# ${section.title}\n`);
    chunks.push(...sectionCsvChunks(section, chunkRows));
    chunks.push("\n");
  }
  return chunks;
}

function streamChunks(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let cursor = 0;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (cursor >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[cursor]));
      cursor += 1;
    },
  });
}

/** The same bytes as `documentToCsv(document)`, produced lazily. */
export function streamDocumentCsv(
  document: ReportDocument,
  options: { chunkRows?: number } = {}
): ReadableStream<Uint8Array> {
  return streamChunks(csvChunks(document, options.chunkRows ?? CSV_CHUNK_ROWS));
}

/**
 * A single table, with no `# title` preamble — the shape the case register has
 * always exported, so existing spreadsheet templates keep working.
 */
export function streamSectionCsv(
  section: ReportSection,
  options: { chunkRows?: number } = {}
): ReadableStream<Uint8Array> {
  return streamChunks(sectionCsvChunks(section, options.chunkRows ?? CSV_CHUNK_ROWS));
}

/** Headers for a streamed export: no `Content-Length`, plus buffering hints. */
export function csvStreamHeaders(filename: string): Record<string, string> {
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${csvFilename(filename)}"`,
    "Cache-Control": "no-store",
    // Tells a reverse proxy not to buffer the whole file before responding.
    "X-Accel-Buffering": "no",
  };
}
