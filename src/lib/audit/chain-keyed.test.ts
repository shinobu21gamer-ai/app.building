import { describe, expect, it } from "vitest";
import {
  AUDIT_CHAIN_VERSION,
  AUDIT_CHAIN_VERSION_KEYED,
  AUDIT_GENESIS_PREV_HASH,
  auditChainKey,
  auditChainKeyed,
  checkAuditRows,
  computeAuditHash,
  type AuditChainPayload,
  type AuditRowForVerification,
} from "./chain";

const KEY = "k".repeat(40);
const OTHER_KEY = "x".repeat(40);

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

function payload(seq: number): AuditChainPayload {
  return { ...BASE, seq: BigInt(seq) };
}

/** A chain written the way the store writes it, with the key when given. */
function keyedChain(count: number, key: string | null): AuditRowForVerification[] {
  const rows: AuditRowForVerification[] = [];
  let prevHash = AUDIT_GENESIS_PREV_HASH;
  for (let seq = 1; seq <= count; seq += 1) {
    const rowPayload = payload(seq);
    const hash = computeAuditHash({ prevHash, payload: rowPayload, key });
    rows.push({
      ...rowPayload,
      prevHash,
      hash,
      chainVersion: key ? AUDIT_CHAIN_VERSION_KEYED : AUDIT_CHAIN_VERSION,
    });
    prevHash = hash;
  }
  return rows;
}

describe("auditChainKey", () => {
  it("is null when unset", () => {
    expect(auditChainKey({})).toBeNull();
    expect(auditChainKeyed({})).toBe(false);
  });

  it("refuses a short key rather than writing weak v2 rows", () => {
    expect(auditChainKey({ AUDIT_CHAIN_KEY: "short" })).toBeNull();
  });

  it("accepts a key of at least 32 characters, trimmed", () => {
    const env = { AUDIT_CHAIN_KEY: `  ${KEY}  ` };
    expect(auditChainKey(env)).toBe(KEY);
    expect(auditChainKeyed(env)).toBe(true);
  });
});

describe("keyed (v2) audit hashes", () => {
  it("differs from the unkeyed v1 hash for the same row", () => {
    const p = payload(1);
    expect(computeAuditHash({ prevHash: "", payload: p, key: KEY })).not.toBe(
      computeAuditHash({ prevHash: "", payload: p })
    );
  });

  it("depends on the key", () => {
    const p = payload(1);
    expect(computeAuditHash({ prevHash: "", payload: p, key: KEY })).not.toBe(
      computeAuditHash({ prevHash: "", payload: p, key: OTHER_KEY })
    );
  });

  it("keeps v1 hashes unchanged when no key is given", () => {
    const p = payload(1);
    expect(computeAuditHash({ prevHash: "", payload: p, key: null })).toBe(
      computeAuditHash({ prevHash: "", payload: p })
    );
  });
});

describe("checkAuditRows with keyed rows", () => {
  it("accepts a keyed chain when the key is supplied", () => {
    const verdict = checkAuditRows(keyedChain(4, KEY), AUDIT_GENESIS_PREV_HASH, {
      key: KEY,
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.checked).toBe(4);
  });

  it("refuses a keyed chain verified with the wrong key", () => {
    const verdict = checkAuditRows(keyedChain(3, KEY), AUDIT_GENESIS_PREV_HASH, {
      key: OTHER_KEY,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.firstBrokenSeq).toBe(BigInt(1));
  });

  it("does not pass keyed rows as clean when the key is missing", () => {
    const verdict = checkAuditRows(keyedChain(3, KEY), AUDIT_GENESIS_PREV_HASH);
    expect(verdict.ok).toBe(false);
    expect(verdict.problem).toContain("AUDIT_CHAIN_KEY");
  });

  it("catches an attacker who rewrites a keyed row and recomputes its hash without the key", () => {
    const rows = keyedChain(3, KEY);
    // The forger edits row 2 and recomputes the hashes with the only hash they
    // can compute: unkeyed SHA-256 (what a database-only attacker has).
    rows[1] = {
      ...rows[1],
      description: "Forged note.",
    };
    const forgedHash = computeAuditHash({
      prevHash: rows[1].prevHash ?? "",
      payload: { ...payload(2), description: "Forged note." },
    });
    rows[1] = { ...rows[1], hash: forgedHash };
    rows[2] = {
      ...rows[2],
      prevHash: forgedHash,
      hash: computeAuditHash({
        prevHash: forgedHash,
        payload: payload(3),
        key: KEY,
      }),
    };
    const verdict = checkAuditRows(rows, AUDIT_GENESIS_PREV_HASH, { key: KEY });
    expect(verdict.ok).toBe(false);
  });

  it("still verifies legacy v1 rows alongside the key", () => {
    const v1: AuditRowForVerification[] = [];
    let prevHash = AUDIT_GENESIS_PREV_HASH;
    for (let seq = 1; seq <= 2; seq += 1) {
      const p = payload(seq);
      const hash = computeAuditHash({ prevHash, payload: p });
      v1.push({ ...p, prevHash, hash, chainVersion: AUDIT_CHAIN_VERSION });
      prevHash = hash;
    }
    expect(checkAuditRows(v1, AUDIT_GENESIS_PREV_HASH, { key: KEY }).ok).toBe(true);
    expect(checkAuditRows(v1, AUDIT_GENESIS_PREV_HASH).ok).toBe(true);
  });
});
