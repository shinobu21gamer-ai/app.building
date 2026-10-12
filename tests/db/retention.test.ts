import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  ANONYMISED_CASE_NOTE,
  executeRetentionPolicy,
  heldResidentIds,
  listRetentionPolicies,
  planRetention,
  retentionDesk,
  runRetentionSweep,
} from "@/lib/privacy/retention";
import { DAY_MS, daysBefore, requireDatabase, resetDatabase, seedCategory } from "./helpers";

/**
 * The retention sweep against a real PostgreSQL database.
 *
 * The unit suite proves the arithmetic of `planRetention` and the cutoffs; these
 * tests prove the part that only a database can show — that the handlers really
 * delete, really anonymise, really leave held residents alone, and that the runs
 * they file say what happened.
 */
requireDatabase();

const NOW = new Date("2026-10-12T02:00:00.000Z");

/** The five active policies the sweep is expected to execute. */
const ACTIVE_KEYS = [
  "audit.entries",
  "case.records",
  "notification.inbox",
  "pii.id_verification",
  "session.revoked_tokens",
];

let heldUserId = 0;
let freeUserId = 0;
let heldConcernId = 0;
let freeConcernId = 0;
let heldCaseRecordId = 0;
let heldOldNotificationId = 0;
let freeOldNotificationId = 0;
let freeRecentNotificationId = 0;
let heldVerificationId = 0;
let freshVerificationId = 0;
let heldRevokedTokenId = "";
let heldDsrId = 0;

async function policy(key: string) {
  return db.retentionPolicy.findUniqueOrThrow({ where: { key } });
}

beforeAll(async () => {
  await resetDatabase();

  const residentRole = await db.role.create({
    data: { key: "RESIDENT", name: "Resident" },
    select: { id: true },
  });
  const categoryId = await seedCategory("retention-test");

  heldUserId = (
    await db.user.create({
      data: {
        email: "held@example.test",
        passwordHash: "x",
        firstName: "Held",
        lastName: "Resident",
        roleId: residentRole.id,
      },
      select: { id: true },
    })
  ).id;
  freeUserId = (
    await db.user.create({
      data: {
        email: "free@example.test",
        passwordHash: "x",
        firstName: "Free",
        lastName: "Resident",
        roleId: residentRole.id,
      },
      select: { id: true },
    })
  ).id;

  const policies: {
    key: string;
    dataCategory: string;
    retentionDays: number;
    action: string;
    isActive: boolean;
  }[] = [
    { key: "case.records", dataCategory: "Case records", retentionDays: 1825, action: "ANONYMISE", isActive: true },
    { key: "notification.inbox", dataCategory: "Notification inbox", retentionDays: 180, action: "DELETE", isActive: true },
    { key: "pii.id_verification", dataCategory: "ID verification", retentionDays: 365, action: "DELETE", isActive: true },
    { key: "session.revoked_tokens", dataCategory: "Revoked tokens", retentionDays: 7, action: "DELETE", isActive: true },
    { key: "audit.entries", dataCategory: "Audit entries", retentionDays: 3650, action: "ARCHIVE", isActive: true },
    { key: "uploads.concern_images", dataCategory: "Concern images", retentionDays: 365, action: "DELETE", isActive: false },
  ];
  for (const entry of policies) {
    await db.retentionPolicy.create({ data: entry });
  }

  // Two closed cases, both long past the five-year window: one belongs to the
  // resident with an open request, one does not.
  const heldConcern = await db.concern.create({
    data: {
      caseNumber: "BR-2021-0001",
      userId: heldUserId,
      categoryId,
      title: "Held case",
      description: "Still says what the resident reported.",
      locationAddress: "Purok 1",
      locationLat: 14.3,
      locationLng: 120.9,
      locationPurok: "Purok 1",
      imageUrl: "/uploads/held-case.jpg",
      status: "CLOSED",
      submittedAt: daysBefore(NOW, 2100),
      closedAt: daysBefore(NOW, 2000),
      createdAt: daysBefore(NOW, 2100),
    },
    select: { id: true },
  });
  heldConcernId = heldConcern.id;

  const freeConcern = await db.concern.create({
    data: {
      caseNumber: "BR-2021-0002",
      userId: freeUserId,
      categoryId,
      title: "Free case",
      description: "Still says what the resident reported.",
      locationAddress: "Purok 2",
      locationLat: 14.31,
      locationLng: 120.91,
      locationAccuracyM: 12,
      locationPurok: "Purok 2",
      locationGeohash: "wdw4g1",
      imageUrl: "/uploads/free-case.jpg",
      status: "CLOSED",
      submittedAt: daysBefore(NOW, 2100),
      closedAt: daysBefore(NOW, 2000),
      createdAt: daysBefore(NOW, 2100),
    },
    select: { id: true },
  });
  freeConcernId = freeConcern.id;

  const heldRecord = await db.publicCaseRecord.create({
    data: {
      publicRef: "BR-PUB-RETENTION-1",
      concernId: heldConcernId,
      status: "CLOSED",
      submittedAt: daysBefore(NOW, 2100),
      published: true,
    },
    select: { id: true },
  });
  heldCaseRecordId = heldRecord.id;

  heldOldNotificationId = (
    await db.notification.create({
      data: {
        userId: heldUserId,
        type: "CASE_STATUS",
        title: "Old",
        message: "Read long ago.",
        isRead: true,
        readAt: daysBefore(NOW, 200),
        createdAt: daysBefore(NOW, 210),
      },
      select: { id: true },
    })
  ).id;
  freeOldNotificationId = (
    await db.notification.create({
      data: {
        userId: freeUserId,
        type: "CASE_STATUS",
        title: "Old",
        message: "Read long ago.",
        isRead: true,
        readAt: daysBefore(NOW, 200),
        createdAt: daysBefore(NOW, 210),
      },
      select: { id: true },
    })
  ).id;
  freeRecentNotificationId = (
    await db.notification.create({
      data: {
        userId: freeUserId,
        type: "CASE_STATUS",
        title: "Recent",
        message: "Read yesterday.",
        isRead: true,
        readAt: daysBefore(NOW, 1),
        createdAt: daysBefore(NOW, 2),
      },
      select: { id: true },
    })
  ).id;

  heldVerificationId = (
    await db.identityVerification.create({
      data: {
        userId: heldUserId,
        status: "VERIFIED",
        idTypeLabel: "PhilSys",
        idNumberEncrypted: "v1.held.cipher",
        idNumberLast4: "1234",
        idImageUrl: "/uploads/held-id.jpg",
        createdAt: daysBefore(NOW, 400),
      },
      select: { id: true },
    })
  ).id;
  freshVerificationId = (
    await db.identityVerification.create({
      data: {
        userId: freeUserId,
        status: "VERIFIED",
        idTypeLabel: "PhilSys",
        idNumberEncrypted: "v1.fresh.cipher",
        idImageUrl: "/uploads/fresh-id.jpg",
        createdAt: daysBefore(NOW, 1),
      },
      select: { id: true },
    })
  ).id;
  await db.identityVerification.create({
    data: {
      userId: freeUserId,
      status: "VERIFIED",
      idTypeLabel: "PhilSys",
      idNumberEncrypted: "v1.old.cipher",
      idNumberLast4: "5678",
      idImageUrl: "/uploads/old-id.jpg",
      createdAt: daysBefore(NOW, 400),
    },
  });

  heldRevokedTokenId = (
    await db.revokedToken.create({
      data: {
        tokenHash: "hash-held",
        userId: heldUserId,
        expiresAt: daysBefore(NOW, 30),
      },
      select: { id: true },
    })
  ).id;
  await db.revokedToken.create({
    data: {
      tokenHash: "hash-live",
      userId: freeUserId,
      expiresAt: new Date(NOW.getTime() + 30 * DAY_MS),
    },
  });

  heldDsrId = (
    await db.dataSubjectRequest.create({
      data: {
        referenceCode: "DSR-2026-0001",
        userId: heldUserId,
        type: "ERASURE",
        status: "RECEIVED",
        requestedAt: daysBefore(NOW, 3),
      },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("the legal hold, against real rows", () => {
  it("finds the resident whose request is still open", async () => {
    expect(await heldResidentIds()).toEqual([heldUserId]);
  });

  it("does not anonymise the held case, and says so in the run", async () => {
    const outcome = await executeRetentionPolicy(await policy("case.records"), { now: NOW });

    expect(outcome.status).toBe("SUCCESS");
    expect(outcome.scanned).toBe(1);
    expect(outcome.affected).toBe(1);
    expect(outcome.held).toBe(1);
    expect(outcome.cutoff.toISOString()).toBe(daysBefore(NOW, 1825).toISOString());
    expect(outcome.summary).toContain("held by open data-subject requests");

    const held = await db.concern.findUniqueOrThrow({ where: { id: heldConcernId } });
    expect(held.locationLat).toBeCloseTo(14.3);
    expect(held.description).toBe("Still says what the resident reported.");

    const swept = await db.concern.findUniqueOrThrow({ where: { id: freeConcernId } });
    expect(swept.locationLat).toBeNull();
    expect(swept.locationLng).toBeNull();
    expect(swept.locationAccuracyM).toBeNull();
    expect(swept.imageUrl).toBeNull();
    expect(swept.description).toBe(ANONYMISED_CASE_NOTE);
    // The coarse location and the case's facts survive anonymisation.
    expect(swept.locationGeohash).toBe("wdw4g1");
    expect(swept.locationPurok).toBe("Purok 2");
    expect(swept.status).toBe("CLOSED");

    const run = await db.retentionRun.findFirstOrThrow({
      where: { policy: { key: "case.records" } },
      orderBy: { startedAt: "desc" },
    });
    expect(run.status).toBe("SUCCESS");
    expect(run.scanned).toBe(1);
    expect(run.affected).toBe(1);
    expect(run.summary).toContain("1 row held by open data-subject requests");
  });

  it("is idempotent: a second pass has nothing left to do", async () => {
    const outcome = await executeRetentionPolicy(await policy("case.records"), { now: NOW });
    expect(outcome.scanned).toBe(0);
    expect(outcome.affected).toBe(0);
    // The held row is still a candidate — it is the hold, not the absence of
    // work, that keeps it out of the sweep.
    expect(outcome.held).toBe(1);
  });

  it("keeps the held resident's notification and ID number", async () => {
    const notifications = await executeRetentionPolicy(await policy("notification.inbox"), {
      now: NOW,
    });
    expect(notifications.affected).toBe(1);
    expect(notifications.held).toBe(1);
    expect(await db.notification.findUnique({ where: { id: heldOldNotificationId } })).not.toBeNull();
    expect(await db.notification.findUnique({ where: { id: freeOldNotificationId } })).toBeNull();
    expect(
      await db.notification.findUnique({ where: { id: freeRecentNotificationId } })
    ).not.toBeNull();

    const ids = await executeRetentionPolicy(await policy("pii.id_verification"), { now: NOW });
    expect(ids.affected).toBe(1);
    expect(ids.held).toBe(1);

    const held = await db.identityVerification.findUniqueOrThrow({
      where: { id: heldVerificationId },
    });
    expect(held.idNumberEncrypted).toBe("v1.held.cipher");
    expect(held.idImageUrl).toBe("/uploads/held-id.jpg");

    const fresh = await db.identityVerification.findUniqueOrThrow({
      where: { id: freshVerificationId },
    });
    expect(fresh.idNumberEncrypted).toBe("v1.fresh.cipher");

    const destroyed = await db.identityVerification.findMany({
      where: { userId: freeUserId, status: "VERIFIED", idNumberLast4: "5678" },
    });
    expect(destroyed).toHaveLength(1);
    expect(destroyed[0].idNumberEncrypted).toBeNull();
    expect(destroyed[0].idNumberLast4).toBeNull();
    expect(destroyed[0].idImageUrl).toBeNull();
    // The decision itself is kept: the barangay can still show it verified the
    // resident, it just cannot show the number any more.
    expect(destroyed[0].status).toBe("VERIFIED");
  });

  it("does not hold a revoked session token: it is an artefact, not personal data", async () => {
    const outcome = await executeRetentionPolicy(await policy("session.revoked_tokens"), {
      now: NOW,
    });
    expect(outcome.affected).toBe(1);
    expect(outcome.held).toBe(0);
    expect(await db.revokedToken.findUnique({ where: { id: heldRevokedTokenId } })).toBeNull();
    expect(await db.revokedToken.findMany()).toHaveLength(1);
  });
});

describe("the sweep", () => {
  let firstSweep: Awaited<ReturnType<typeof runRetentionSweep>>;

  it("runs every due policy once and files the run", async () => {
    firstSweep = await runRetentionSweep({ now: NOW, triggerSource: "CRON" });

    expect(firstSweep.totals.policies).toBe(ACTIVE_KEYS.length);
    expect(firstSweep.totals.succeeded).toBe(ACTIVE_KEYS.length);
    expect(firstSweep.totals.failed).toBe(0);
    // `uploads.concern_images` is inactive, so the plan skips it.
    expect(firstSweep.totals.skipped).toBe(1);
    // Deterministic: the three held rows are the case, the notification and the
    // ID verification.
    expect(firstSweep.totals.held).toBe(3);

    const keys = firstSweep.outcomes.map((outcome) => outcome.policyKey).sort();
    expect(keys).toEqual(ACTIVE_KEYS);

    const cronRun = await db.cronRun.findUniqueOrThrow({
      where: { id: firstSweep.cronRunId },
    });
    expect(cronRun.status).toBe("SUCCESS");
    expect(cronRun.summary).toContain("held");

    const archival = firstSweep.outcomes.find((o) => o.policyKey === "audit.entries");
    expect(archival?.action).toBe("ARCHIVE");
    expect(archival?.affected).toBe(0);
    expect(archival?.summary).toContain("kept in place");
  });

  it("advances lastRunAt only, and refuses to run again within the day", async () => {
    const policies = await listRetentionPolicies();
    for (const key of ACTIVE_KEYS) {
      expect(policies.find((p) => p.key === key)?.lastRunAt).not.toBeNull();
    }
    expect(policies.find((p) => p.key === "uploads.concern_images")?.lastRunAt).toBeNull();

    const plan = planRetention(policies, NOW);
    expect(plan.due).toHaveLength(0);
    expect(plan.skipped.filter((skip) => skip.reason === "RECENTLY_RUN")).toHaveLength(
      ACTIVE_KEYS.length
    );
    expect(plan.skipped.find((skip) => skip.reason === "INACTIVE")?.key).toBe(
      "uploads.concern_images"
    );

    const second = await runRetentionSweep({ now: NOW });
    expect(second.totals.policies).toBe(0);
    expect(second.outcomes).toHaveLength(0);
    // The five recently-run policies plus the inactive one.
    expect(second.totals.skipped).toBe(ACTIVE_KEYS.length + 1);

    // `force` is what the admin re-run uses to bypass the guard; the other
    // policies are then NOT_SELECTED rather than skipped, so only the inactive
    // policy is left in the skip count.
    const forced = await runRetentionSweep({ now: NOW, force: true, keys: ["case.records"] });
    expect(forced.totals.policies).toBe(1);
    expect(forced.totals.skipped).toBe(1);
    expect(forced.outcomes[0].policyKey).toBe("case.records");
  });

  it("reports the hold on the desk without storing it", async () => {
    const desk = await retentionDesk(NOW);
    expect(desk.heldResidents).toBe(1);
    expect(desk.dueKeys).toEqual([]);
    expect(desk.lastSweepAt).not.toBeNull();
    expect(desk.rows.length).toBeGreaterThanOrEqual(ACTIVE_KEYS.length);
  });

  it("lifts the hold when the request is decided, because it is derived", async () => {
    await db.dataSubjectRequest.update({
      where: { id: heldDsrId },
      data: { status: "COMPLETED", resolvedAt: NOW },
    });
    expect(await heldResidentIds()).toEqual([]);

    const outcome = await executeRetentionPolicy(await policy("case.records"), { now: NOW });
    expect(outcome.affected).toBe(1);
    expect(outcome.held).toBe(0);

    const nowAnonymised = await db.concern.findUniqueOrThrow({ where: { id: heldConcernId } });
    expect(nowAnonymised.description).toBe(ANONYMISED_CASE_NOTE);
    expect(nowAnonymised.locationLat).toBeNull();
    expect(nowAnonymised.imageUrl).toBeNull();

    // The public projection is untouched by anonymisation; only the case's own
    // personal fields were rewritten.
    expect(
      await db.publicCaseRecord.findUniqueOrThrow({ where: { id: heldCaseRecordId } })
    ).not.toBeNull();
  });
});
