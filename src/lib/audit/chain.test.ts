import { describe, expect, it } from "vitest";
import {
  AUDIT_GENESIS_PREV_HASH,
  canonicalizeAuditPayload,
  checkAuditRows,
  computeAuditHash,
  formatAuditDigest,
  type AuditChainPayload,
  type AuditRowForVerification,
} from "./chain";

const BASE: Omit<AuditChainPayload, "seq"> = {
  action: "case.status.changed",
  resourceType: "Concern",
  resourceId: "42",
  userId: 7,
  actorRole: "OFFICIAL",
  description: "Moved to IN_PROGRESS.",
  ip: "203.0.113.9",
  createdAt: new Date("2026-10-12T04:00:00.000Z"),
};

function payload(seq: number, overrides: Partial<AuditChainPayload> = {}): AuditChainPayload {
  return { ...BASE, seq: BigInt(seq), ...overrides };
}

/** Builds a valid chain of stored rows, exactly as the writer would. */
function chain(count: number): AuditRowForVerification[] {
  const rows: AuditRowForVerification[] = [];
  let prevHash = AUDIT_GENESIS_PREV_HASH;
  for (let seq = 1; seq <= count; seq += 1) {
    const rowPayload = payload(seq);
    const hash = computeAuditHash({ prevHash, payload: rowPayload });
    rows.push({ ...rowPayload, prevHash, hash, chainVersion: 1 });
    prevHash = hash;
  }
  return rows;
}

describe("canonicalizeAuditPayload", () => {
  it("is stable no matter how the payload object was built", () => {
    const first: AuditChainPayload = {
      seq: BigInt(5),
      action: "a",
      resourceType: "R",
      resourceId: null,
      userId: null,
      actorRole: null,
      description: null,
      ip: null,
      createdAt: new Date("2026-01-02T03:04:05.000Z"),
    };
    const second = {
      createdAt: new Date("2026-01-02T03:04:05.000Z"),
      ip: null,
      description: null,
      actorRole: null,
      userId: null,
      resourceId: null,
      resourceType: "R",
      action: "a",
      seq: BigInt(5),
    } as AuditChainPayload;

    expect(canonicalizeAuditPayload(first)).toBe(canonicalizeAuditPayload(second));
    expect(canonicalizeAuditPayload(first)).toBe(
      '[["seq","5"],["action","a"],["resourceType","R"],["resourceId",null],' +
        '["userId",null],["actorRole",null],["description",null],["ip",null],' +
        '["createdAt","2026-01-02T03:04:05.000Z"]]'
    );
  });

  it("treats undefined optional values as null, so old call sites hash the same", () => {
    const withNulls = canonicalizeAuditPayload({
      ...BASE,
      seq: BigInt(1),
      resourceId: null,
      userId: null,
      actorRole: null,
      description: null,
      ip: null,
    });
    const withUndefined = canonicalizeAuditPayload({
      ...BASE,
      seq: BigInt(1),
      resourceId: undefined as unknown as null,
      userId: undefined as unknown as null,
      actorRole: undefined as unknown as null,
      description: undefined as unknown as null,
      ip: undefined as unknown as null,
    });
    expect(withUndefined).toBe(withNulls);
  });
});

describe("computeAuditHash", () => {
  it("is deterministic and depends on the previous hash", () => {
    const row = payload(2);
    const a = computeAuditHash({ prevHash: "abc", payload: row });
    const b = computeAuditHash({ prevHash: "abc", payload: row });
    const c = computeAuditHash({ prevHash: "abd", payload: row });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any chained field changes", () => {
    const original = computeAuditHash({ prevHash: "", payload: payload(1) });
    const edited = computeAuditHash({
      prevHash: "",
      payload: payload(1, { description: "Adjusted wording." }),
    });
    expect(edited).not.toBe(original);
  });
});

describe("checkAuditRows", () => {
  it("accepts an untouched chain", () => {
    const verdict = checkAuditRows(chain(4), AUDIT_GENESIS_PREV_HASH);
    expect(verdict.ok).toBe(true);
    expect(verdict.checked).toBe(4);
    expect(verdict.firstBrokenSeq).toBeNull();
    expect(verdict.lastSeq).toBe(BigInt(4));
    expect(verdict.boundaryUnverified).toBe(false);
  });

  it("catches a row edited after it was written", () => {
    const rows = chain(3);
    rows[1] = { ...rows[1], description: "quietly rewritten" };
    const verdict = checkAuditRows(rows, AUDIT_GENESIS_PREV_HASH);
    expect(verdict.ok).toBe(false);
    expect(verdict.firstBrokenSeq).toBe(BigInt(2));
    expect(verdict.problem).toContain("modified");
  });

  it("catches a broken link", () => {
    const rows = chain(3);
    rows[2] = { ...rows[2], prevHash: "0".repeat(64) };
    const verdict = checkAuditRows(rows, AUDIT_GENESIS_PREV_HASH);
    expect(verdict.ok).toBe(false);
    expect(verdict.firstBrokenSeq).toBe(BigInt(3));
  });

  it("catches a deleted row as a gap in seq", () => {
    const rows = chain(4).filter((row) => row.seq !== BigInt(2));
    const verdict = checkAuditRows(rows, AUDIT_GENESIS_PREV_HASH);
    expect(verdict.ok).toBe(false);
    expect(verdict.problem).toContain("missing or out of order");
  });

  it("refuses a row that was never chained", () => {
    const rows: AuditRowForVerification[] = [
      ...chain(1),
      { ...payload(2), seq: null, prevHash: null, hash: null },
    ];
    const verdict = checkAuditRows(rows, AUDIT_GENESIS_PREV_HASH);
    expect(verdict.ok).toBe(false);
    expect(verdict.problem).toContain("not chained");
  });

  it("reports an unverified boundary for a partial range", () => {
    const rows = chain(5).slice(2);
    const verdict = checkAuditRows(rows, null, { expectSeqFrom: BigInt(3) });
    expect(verdict.ok).toBe(true);
    expect(verdict.boundaryUnverified).toBe(true);
    expect(verdict.checked).toBe(3);
  });

  it("still catches tampering inside a partial range", () => {
    const rows = chain(5).slice(2);
    rows[1] = { ...rows[1], action: "case.deleted" };
    const verdict = checkAuditRows(rows, null, { expectSeqFrom: BigInt(3) });
    expect(verdict.ok).toBe(false);
    expect(verdict.firstBrokenSeq).toBe(BigInt(4));
  });
});

describe("formatAuditDigest", () => {
  it("renders the fields an auditor checks, with no personal data", () => {
    const lines = formatAuditDigest({
      status: "OK",
      fromSeq: BigInt(1),
      toSeq: BigInt(10),
      checkedCount: 10,
      firstBrokenSeq: null,
      tipSeq: BigInt(10),
      tipHash: "a".repeat(64),
      unchainedCount: 0,
      startedAt: new Date("2026-10-12T00:00:00.000Z"),
      finishedAt: new Date("2026-10-12T00:00:02.000Z"),
      triggeredBy: "CRON",
    });
    expect(lines[1]).toBe("Status: OK");
    expect(lines[2]).toBe("Range: seq 1 → 10");
    expect(lines[6]).toBe("First broken seq: none");
    expect(lines.join("\n")).not.toContain("203.0.113.9");
  });
});
