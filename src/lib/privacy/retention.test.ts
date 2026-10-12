import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  ANONYMISED_CASE_NOTE,
  RETENTION_ACTIONS,
  RETENTION_HANDLERS,
  RETENTION_MAX_ROWS,
  RETENTION_MIN_INTERVAL_HOURS,
  RETENTION_POLICY_KEYS,
  cutoffFor,
  planRetention,
  type RetentionPolicyLike,
} from "@/lib/privacy/retention";

const NOW = new Date("2026-10-12T02:00:00Z");

function policy(overrides: Partial<RetentionPolicyLike> = {}): RetentionPolicyLike {
  return {
    id: 1,
    key: "notification.inbox",
    dataCategory: "Notification inbox",
    retentionDays: 180,
    action: "DELETE",
    isActive: true,
    lastRunAt: null,
    ...overrides,
  };
}

describe("cutoffFor", () => {
  it("subtracts the policy's retention window from now", () => {
    expect(cutoffFor(policy({ retentionDays: 180 }), NOW).toISOString()).toBe(
      "2026-04-15T02:00:00.000Z"
    );
  });

  it("handles a seven-day window", () => {
    expect(cutoffFor(policy({ retentionDays: 7 }), NOW).toISOString()).toBe(
      "2026-10-05T02:00:00.000Z"
    );
  });

  it("handles a ten-year window as 3650 days, leap days included", () => {
    const cutoff = cutoffFor(policy({ retentionDays: 3650 }), NOW);
    expect(NOW.getTime() - cutoff.getTime()).toBe(3650 * 86_400_000);
    // 3650 days is not exactly ten calendar years: the leap days move it.
    expect(cutoff.toISOString().slice(0, 10)).toBe("2016-10-14");
  });

  it("makes a zero-day policy's cutoff now, i.e. everything is out of time", () => {
    expect(cutoffFor(policy({ retentionDays: 0 }), NOW).getTime()).toBe(NOW.getTime());
  });
});

describe("planRetention", () => {
  it("runs an active policy that has never run", () => {
    const plan = planRetention([policy()], NOW);
    expect(plan.due.map((row) => row.key)).toEqual(["notification.inbox"]);
    expect(plan.skipped).toEqual([]);
  });

  it("skips an inactive policy, and says why", () => {
    const plan = planRetention([policy({ isActive: false })], NOW);
    expect(plan.due).toEqual([]);
    expect(plan.skipped).toEqual([
      { key: "notification.inbox", reason: "INACTIVE", lastRunAt: null },
    ]);
  });

  it("does not sweep the same policy twice in a day", () => {
    const plan = planRetention(
      [policy({ lastRunAt: new Date("2026-10-12T01:00:00Z") })],
      NOW
    );
    expect(plan.due).toEqual([]);
    expect(plan.skipped[0].reason).toBe("RECENTLY_RUN");
  });

  it("runs again once the interval has passed", () => {
    const hours = RETENTION_MIN_INTERVAL_HOURS + 1;
    const plan = planRetention(
      [policy({ lastRunAt: new Date(NOW.getTime() - hours * 3_600_000) })],
      NOW
    );
    expect(plan.due).toHaveLength(1);
  });

  it("ignores the interval when forced", () => {
    const plan = planRetention(
      [policy({ lastRunAt: new Date("2026-10-12T01:59:00Z") })],
      NOW,
      { force: true }
    );
    expect(plan.due).toHaveLength(1);
  });

  it("narrows to the selected keys", () => {
    const plan = planRetention(
      [policy({ id: 1, key: "notification.inbox" }), policy({ id: 2, key: "case.records" })],
      NOW,
      { keys: ["case.records"] }
    );
    expect(plan.due.map((row) => row.key)).toEqual(["case.records"]);
    expect(plan.skipped).toEqual([
      { key: "notification.inbox", reason: "NOT_SELECTED", lastRunAt: null },
    ]);
  });

  it("treats an empty key list as 'everything', not 'nothing'", () => {
    const plan = planRetention([policy()], NOW, { keys: [] });
    expect(plan.due).toHaveLength(1);
  });

  it("plans the whole seeded set when nothing has run yet", () => {
    const seeded = RETENTION_POLICY_KEYS.map((key, index) =>
      policy({ id: index + 1, key, lastRunAt: null })
    );
    const plan = planRetention(seeded, NOW);
    expect(plan.due).toHaveLength(RETENTION_POLICY_KEYS.length);
  });
});

describe("the handler registry", () => {
  it("has a handler for every seeded policy key", () => {
    for (const key of RETENTION_POLICY_KEYS) {
      expect(RETENTION_HANDLERS[key], `no handler for ${key}`).toBeTypeOf("function");
    }
  });

  it("has no handler for a key that is not seeded", () => {
    const extra = Object.keys(RETENTION_HANDLERS).filter(
      (key) => !(RETENTION_POLICY_KEYS as readonly string[]).includes(key)
    );
    expect(extra).toEqual([]);
  });
});

describe("the seeded policies in the migration", () => {
  const sql = readFileSync(
    path.join(process.cwd(), "prisma/migrations/20261012000000_revamp_core_schema/migration.sql"),
    "utf8"
  );

  it("seeds exactly the keys this module knows how to enforce", () => {
    const block = sql.slice(sql.indexOf('INSERT INTO "RetentionPolicy"'));
    const seeded: string[] = [];
    for (const key of RETENTION_POLICY_KEYS) {
      if (block.includes(`'${key}'`)) seeded.push(key);
    }
    expect(seeded).toHaveLength(RETENTION_POLICY_KEYS.length);
    expect(block).toContain("ON CONFLICT");
  });

  it("gives every seeded policy a retention window and a known action", () => {
    // ("key", "Category", "Description", DAYS, "ACTION", …) — read the window
    // and the action back out of the SQL so a hand-edited seed cannot drift.
    for (const key of RETENTION_POLICY_KEYS) {
      const pattern = new RegExp(
        `'${key.replace(/\./g, "\\.")}'\\s*,\\s*'[^']*'\\s*,\\s*'[^']*'\\s*,\\s*(\\d+)\\s*,\\s*'([A-Z]+)'`
      );
      const match = pattern.exec(sql);
      expect(match, `no seed row for ${key}`).not.toBeNull();
      expect(Number(match?.[1])).toBeGreaterThan(0);
      expect(RETENTION_ACTIONS).toContain(match?.[2]);
    }
  });
});

describe("the sweep's published constants", () => {
  it("keeps the once-a-day guard at 20 hours", () => {
    expect(RETENTION_MIN_INTERVAL_HOURS).toBe(20);
  });

  it("bounds each handler's batch", () => {
    expect(RETENTION_MAX_ROWS).toBe(5000);
  });

  it("writes a recognisable tombstone into anonymised cases", () => {
    expect(ANONYMISED_CASE_NOTE).toMatch(/^\[anonymised:/);
  });
});
