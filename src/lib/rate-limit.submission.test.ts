import { beforeEach, describe, expect, it, vi } from "vitest";

// A tiny in-memory stand-in for the LoginAttemptBucket table, just enough to
// exercise the bump/read/upsert code paths the rate limiter relies on.
const rows = new Map<string, { failures: number; windowStart: Date }>();

vi.mock("@/lib/db", () => ({
  db: {
    loginAttemptBucket: {
      findUnique: vi.fn(({ where: { key } }: { where: { key: string } }) => {
        const row = rows.get(key);
        return Promise.resolve(row ? { key, ...row } : null);
      }),
      upsert: vi.fn(
        ({
          where: { key },
          create,
        }: {
          where: { key: string };
          create: { failures: number; windowStart: Date };
          update: { failures: number; windowStart: Date };
        }) => {
          rows.set(key, { failures: create.failures, windowStart: create.windowStart });
          return Promise.resolve();
        }
      ),
      updateMany: vi.fn(
        ({
          where,
        }: {
          where: { key: string; windowStart: { gt: Date } };
        }) => {
          const row = rows.get(where.key);
          if (!row || row.windowStart.getTime() <= where.windowStart.gt.getTime()) {
            return Promise.resolve({ count: 0 });
          }
          row.failures += 1;
          return Promise.resolve({ count: 1 });
        }
      ),
      deleteMany: vi.fn(({ where: { key } }: { where: { key: string } }) => {
        rows.delete(key);
        return Promise.resolve({ count: 1 });
      }),
    },
  },
}));

import { checkConcernSubmissionAllowed, recordConcernSubmission } from "./rate-limit";

describe("concern submission throttle", () => {
  beforeEach(() => {
    rows.clear();
  });

  it("blocks a single IP after 8 submissions even from one signed-in account", async () => {
    // The per-IP cap (8) is deliberately tighter than the per-account cap
    // (15): for the common case of one resident on one connection, the IP
    // bucket is what actually binds. Both still apply together.
    const userId = 90001;
    const ip = "203.0.113.50";
    for (let i = 0; i < 8; i++) {
      const decision = await checkConcernSubmissionAllowed(userId, ip);
      expect(decision.allowed).toBe(true);
      await recordConcernSubmission(userId, ip);
    }
    const blocked = await checkConcernSubmissionAllowed(userId, ip);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("still caps one account at 15 even if it rotates IPs to dodge the per-IP cap", async () => {
    const userId = 90002;
    for (let i = 0; i < 15; i++) {
      const decision = await checkConcernSubmissionAllowed(userId, `198.51.100.${i}`);
      expect(decision.allowed).toBe(true);
      await recordConcernSubmission(userId, `198.51.100.${i}`);
    }
    const blocked = await checkConcernSubmissionAllowed(userId, "198.51.100.200");
    expect(blocked.allowed).toBe(false);
  });

  it("throttles the anonymous path by IP even though every call uses a new account", async () => {
    // Anonymous mode mints a brand-new user id on every call, so the
    // per-account bucket can never accumulate — only the IP bucket can,
    // which is exactly why it must be checked even when userId is null.
    const ip = "198.51.100.77";
    for (let i = 0; i < 8; i++) {
      const decision = await checkConcernSubmissionAllowed(null, ip);
      expect(decision.allowed).toBe(true);
      await recordConcernSubmission(null, ip);
    }
    const blocked = await checkConcernSubmissionAllowed(null, ip);
    expect(blocked.allowed).toBe(false);
  });

  it("keeps a different account's or IP's bucket independent", async () => {
    const ip = "198.51.100.88";
    for (let i = 0; i < 8; i++) {
      await recordConcernSubmission(null, ip);
    }
    const sameIpBlocked = await checkConcernSubmissionAllowed(null, ip);
    expect(sameIpBlocked.allowed).toBe(false);

    const otherIp = await checkConcernSubmissionAllowed(null, "198.51.100.89");
    expect(otherIp.allowed).toBe(true);

    const differentAccountSameIp = await checkConcernSubmissionAllowed(90003, ip);
    // The IP is still over its own cap, so a different account on that same
    // IP is correctly still blocked — the IP bucket doesn't care who's
    // attached to the account.
    expect(differentAccountSameIp.allowed).toBe(false);

    const differentAccountDifferentIp = await checkConcernSubmissionAllowed(
      90003,
      "198.51.100.90"
    );
    expect(differentAccountDifferentIp.allowed).toBe(true);
  });
});
