import { createHash } from "node:crypto";

// Hash-chained audit log — pure rules.
//
// Every audit row gets a `seq` (assigned inside the caller's transaction from
// the singleton `AuditChainState` row) and
//
//     hash = sha256( prevHash + "\n" + canonical(payload) )
//
// where `canonical` is a deterministic JSON encoding of the row's payload:
// an array of [field, value] pairs in a fixed order, never an object whose key
// order a runtime could reorder. Dates are ISO strings, bigints are strings,
// and absent values are an explicit `null`, so two rows with the same payload
// always produce the same bytes.
//
// What this proves and what it does not: a chain makes any silent edit,
// deletion or reordering of the log detectable from the log alone. It does not
// protect against an attacker who can rewrite `AuditChainState` as well — that
// is what the periodically recorded `AuditVerificationRun` digest is for.
export const AUDIT_CHAIN_VERSION = 1;

/** The `prevHash` of the first chained row. */
export const AUDIT_GENESIS_PREV_HASH = "";

export type AuditChainPayload = {
  seq: bigint;
  action: string;
  resourceType: string;
  resourceId: string | null;
  userId: number | null;
  actorRole: string | null;
  description: string | null;
  ip: string | null;
  createdAt: Date;
};

/** Field order of the canonical payload. Changing it changes every hash. */
const CANONICAL_FIELDS = [
  "seq",
  "action",
  "resourceType",
  "resourceId",
  "userId",
  "actorRole",
  "description",
  "ip",
  "createdAt",
] as const;

type CanonicalField = (typeof CANONICAL_FIELDS)[number];

function canonicalValue(
  field: CanonicalField,
  payload: AuditChainPayload
): string | number | null {
  switch (field) {
    case "seq":
      return payload.seq.toString();
    case "createdAt":
      return payload.createdAt.toISOString();
    case "userId":
      return payload.userId ?? null;
    case "action":
      return payload.action;
    case "resourceType":
      return payload.resourceType;
    case "resourceId":
      return payload.resourceId ?? null;
    case "actorRole":
      return payload.actorRole ?? null;
    case "description":
      return payload.description ?? null;
    case "ip":
      return payload.ip ?? null;
  }
}

/** Deterministic serialisation of one audit payload. */
export function canonicalizeAuditPayload(payload: AuditChainPayload): string {
  return JSON.stringify(
    CANONICAL_FIELDS.map((field) => [field, canonicalValue(field, payload)])
  );
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** The exact bytes a row hash is computed over. */
export function auditHashInput(prevHash: string, canonical: string): string {
  return `${prevHash}\n${canonical}`;
}

export function computeAuditHash(input: {
  prevHash: string;
  payload: AuditChainPayload;
}): string {
  return sha256Hex(
    auditHashInput(input.prevHash, canonicalizeAuditPayload(input.payload))
  );
}

/** A stored audit row, as far as the verifier is concerned. */
export type AuditRowForVerification = {
  id?: number;
  seq: bigint | null;
  prevHash: string | null;
  hash: string | null;
  chainVersion?: number | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  userId: number | null;
  actorRole: string | null;
  description: string | null;
  ip: string | null;
  createdAt: Date;
};

export type AuditChainCheck = {
  /** Verdict for the inspected rows. */
  ok: boolean;
  /** Rows inspected. */
  checked: number;
  /** First seq whose hash or link did not match, if any. */
  firstBrokenSeq: bigint | null;
  /** Human-readable description of the first problem. */
  problem: string | null;
  /** seq of the last inspected row. */
  lastSeq: bigint | null;
  /** hash of the last inspected row. */
  lastHash: string | null;
  /**
   * True when the inspected range did not start at seq 1, so the very first
   * link could not be checked against its predecessor.
   */
  boundaryUnverified: boolean;
};

/**
 * Recomputes every hash in `rows` (expected in ascending `seq` order) and
 * checks each row against its predecessor.
 *
 * `startPrevHash` is the hash of the row *before* the first inspected row —
 * `AUDIT_GENESIS_PREV_HASH` when verification starts at seq 1, or `null` to skip
 * the link check for a partial range (reported as `boundaryUnverified`).
 */
export function checkAuditRows(
  rows: AuditRowForVerification[],
  startPrevHash: string | null,
  options: { expectSeqFrom?: bigint | null } = {}
): AuditChainCheck {
  let expectedPrev = startPrevHash;
  let expectedSeq = options.expectSeqFrom ?? null;
  let checked = 0;

  for (const row of rows) {
    checked += 1;

    if (row.seq === null || row.hash === null) {
      return {
        ok: false,
        checked,
        firstBrokenSeq: row.seq,
        problem: `Row ${row.seq === null ? "(no seq)" : row.seq.toString()} is not chained (seq/hash missing).`,
        lastSeq: null,
        lastHash: null,
        boundaryUnverified: startPrevHash === null,
      };
    }

    if (expectedSeq !== null && row.seq !== expectedSeq) {
      return {
        ok: false,
        checked,
        firstBrokenSeq: row.seq,
        problem: `Expected seq ${expectedSeq.toString()} but found ${row.seq.toString()} — a row is missing or out of order.`,
        lastSeq: null,
        lastHash: null,
        boundaryUnverified: startPrevHash === null,
      };
    }

    if (expectedPrev !== null && (row.prevHash ?? "") !== expectedPrev) {
      return {
        ok: false,
        checked,
        firstBrokenSeq: row.seq,
        problem: `Row ${row.seq.toString()} does not link to the previous hash.`,
        lastSeq: null,
        lastHash: null,
        boundaryUnverified: false,
      };
    }

    const recomputed = computeAuditHash({
      prevHash: row.prevHash ?? "",
      payload: {
        seq: row.seq,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        userId: row.userId,
        actorRole: row.actorRole,
        description: row.description,
        ip: row.ip,
        createdAt: row.createdAt,
      },
    });

    if (recomputed !== row.hash) {
      return {
        ok: false,
        checked,
        firstBrokenSeq: row.seq,
        problem: `Row ${row.seq.toString()} was modified after it was written (hash mismatch).`,
        lastSeq: null,
        lastHash: null,
        boundaryUnverified: startPrevHash === null,
      };
    }

    expectedPrev = row.hash;
    expectedSeq = row.seq + BigInt(1);
  }

  const last = rows.length > 0 ? rows[rows.length - 1] : null;
  return {
    ok: true,
    checked,
    firstBrokenSeq: null,
    problem: null,
    lastSeq: last?.seq ?? options.expectSeqFrom ?? null,
    lastHash: last?.hash ?? startPrevHash,
    boundaryUnverified: startPrevHash === null,
  };
}

/**
 * The printable digest an auditor compares against: one line per field, no
 * personal data, identical for the same inputs.
 */
export function formatAuditDigest(input: {
  status: string;
  fromSeq: bigint;
  toSeq: bigint;
  checkedCount: number;
  firstBrokenSeq: bigint | null;
  tipSeq: bigint;
  tipHash: string;
  unchainedCount: number;
  startedAt: Date;
  finishedAt: Date | null;
  triggeredBy: string;
}): string[] {
  return [
    "BarangayResolve — audit chain digest",
    `Status: ${input.status}`,
    `Range: seq ${input.fromSeq.toString()} → ${input.toSeq.toString()}`,
    `Rows checked: ${input.checkedCount}`,
    `Chain tip: seq ${input.tipSeq.toString()} hash ${input.tipHash || "(empty)"}`,
    `Unchained rows (pre-chain legacy): ${input.unchainedCount}`,
    input.firstBrokenSeq === null
      ? "First broken seq: none"
      : `First broken seq: ${input.firstBrokenSeq.toString()}`,
    `Triggered by: ${input.triggeredBy}`,
    `Started: ${input.startedAt.toISOString()}`,
    `Finished: ${input.finishedAt ? input.finishedAt.toISOString() : "still running"}`,
  ];
}
