import { db } from "@/lib/db";

/**
 * Brute-force / abuse protection for credential endpoints.
 *
 * Two layers share one logical state per bucket:
 *  - an in-memory sliding-window bucket for speed in the running process, and
 *  - a durable SQLite bucket (LoginAttemptBucket) that survives restarts and
 *    is read back as the fallback when a key is not resident in memory.
 *
 * The current deployment runs a single Node instance, so the in-memory map is
 * authoritative while the DB row mirrors it. If this app is ever scaled to
 * multiple instances, the DB fallback still bounds every unknown key, but the
 * in-memory layer would under-count shared keys -- so keep the concurrency
 * model single-instance, or replace the memory layer with a shared store.
 *
 * Policy (per fixed 15-minute window):
 *  - email bucket: N failed attempts for one email  => locked for the rest of the window
 *  - ip bucket:    N failed attempts from one IP     => locked for the rest of the window
 *
 * Failed = "credentials rejected" (login) or "registration rejected"
 * (e.g. email already taken). A successful login/registration clears the
 * caller's buckets.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MEMORY_LIMIT = 5000;

type Bucket = {
  failures: number;
  windowStart: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number | null;
};

const buckets = new Map<string, Bucket>();

function key(scope: "email" | "ip", value: string): string {
  return `${scope}:${value}`;
}

function prune(bucket: Bucket, now: number): Bucket {
  if (now - bucket.windowStart >= WINDOW_MS) {
    return { failures: 0, windowStart: now };
  }
  return bucket;
}

/** Trims expired and then oldest entries once the memory map grows too large. */
function trimMemory(now: number): void {
  if (buckets.size < MEMORY_LIMIT) return;
  for (const [k, b] of buckets) {
    if (now - b.windowStart >= WINDOW_MS) buckets.delete(k);
  }
  while (buckets.size >= MEMORY_LIMIT) {
    const oldest = buckets.keys().next().value as string | undefined;
    if (!oldest) break;
    buckets.delete(oldest);
  }
}

async function loadFromDb(bucketKey: string): Promise<Bucket | null> {
  const row = await db.loginAttemptBucket.findUnique({ where: { key: bucketKey } });
  if (!row) return null;
  return { failures: row.failures, windowStart: row.windowStart.getTime() };
}

async function persist(bucketKey: string, bucket: Bucket): Promise<void> {
  await db.loginAttemptBucket.upsert({
    where: { key: bucketKey },
    update: {
      failures: bucket.failures,
      windowStart: new Date(bucket.windowStart),
    },
    create: {
      key: bucketKey,
      failures: bucket.failures,
      windowStart: new Date(bucket.windowStart),
    },
  });
}

async function readBucket(scope: "email" | "ip", value: string, now: number): Promise<Bucket> {
  const bucketKey = key(scope, value);
  let bucket = buckets.get(bucketKey);
  if (!bucket) {
    bucket = (await loadFromDb(bucketKey)) ?? { failures: 0, windowStart: now };
  }
  bucket = prune(bucket, now);
  buckets.set(bucketKey, bucket);
  return bucket;
}

function decide(bucket: Bucket, maxFailures: number, now: number): RateLimitDecision {
  if (bucket.failures >= maxFailures && now < bucket.windowStart + WINDOW_MS) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((bucket.windowStart + WINDOW_MS - now) / 1000),
    };
  }
  return { allowed: true, retryAfterSeconds: null };
}

async function bump(scope: "email" | "ip", value: string, now: number): Promise<void> {
  trimMemory(now);
  const bucketKey = key(scope, value);
  const windowStart = new Date(now - WINDOW_MS);
  const existing = await db.loginAttemptBucket.findUnique({
    where: { key: bucketKey },
    select: { failures: true, windowStart: true },
  });
  let next: Bucket;

  if (existing && existing.windowStart.getTime() > now - WINDOW_MS) {
    const updated = await db.loginAttemptBucket.updateMany({
      where: { key: bucketKey, windowStart: { gt: windowStart } },
      data: { failures: { increment: 1 } },
    });
    if (updated.count === 1) {
      next = {
        failures: existing.failures + 1,
        windowStart: existing.windowStart.getTime(),
      };
    } else {
      next = { failures: 1, windowStart: now };
    }
  } else {
    next = { failures: 1, windowStart: now };
    await db.loginAttemptBucket.upsert({
      where: { key: bucketKey },
      update: { failures: 1, windowStart: new Date(now) },
      create: { key: bucketKey, failures: 1, windowStart: new Date(now) },
    });
  }

  buckets.set(bucketKey, next);
  if (next.failures === 1 && existing && existing.windowStart.getTime() > now - WINDOW_MS) {
    await persist(bucketKey, next);
  }
}

async function clear(bucketKey: string): Promise<void> {
  buckets.delete(bucketKey);
  await db.loginAttemptBucket.deleteMany({ where: { key: bucketKey } });
}

/**
 * Normalizes a candidate client IP for bucketing.
 *  - loopback => null (local development traffic is trusted, no IP throttle)
 *  - empty/unverifiable => shared sentinel so throttling never opens up
 *  - otherwise the raw addressed used unchanged
 */
export function reliableClientIp(ip: string | null): string | null {
  const raw = (ip ?? "").trim();
  if (raw === "") return "__unverified_ip__";
  if (raw === "::1" || raw.toLowerCase() === "localhost") return null;
  return raw;
}

/** Throttling applied to login attempts. */
export async function checkLoginAllowed(
  email: string,
  ip: string | null
): Promise<RateLimitDecision> {
  const now = Date.now();

  const emailDecision = decide(
    await readBucket("email", email.toLowerCase(), now),
    5,
    now
  );
  if (!emailDecision.allowed) return emailDecision;

  const reliableIp = reliableClientIp(ip);
  if (reliableIp !== null) {
    const ipDecision = decide(await readBucket("ip", reliableIp, now), 20, now);
    if (!ipDecision.allowed) return ipDecision;
  }

  return { allowed: true, retryAfterSeconds: null };
}

/** Throttling applied to account-registration attempts (IP only). */
export async function checkRegistrationAllowed(ip: string | null): Promise<RateLimitDecision> {
  return checkIpAllowed(ip, 10);
}

/** Generic IP-based throttle (used for password-reset code redemption). Never
 *  opens back up when the caller's IP cannot be verified. */
export async function checkIpAllowed(
  ip: string | null,
  maxFailures: number
): Promise<RateLimitDecision> {
  const now = Date.now();
  const reliableIp = reliableClientIp(ip);
  if (reliableIp === null) {
    // Loopback (local dev) is trusted; skip the IP throttle but never allow
    // unverifiable callers through — those fall back to the shared bucket.
    return { allowed: true, retryAfterSeconds: null };
  }
  return decide(await readBucket("ip", reliableIp, now), maxFailures, now);
}

export async function recordLoginFailure(email: string, ip: string | null): Promise<void> {
  const now = Date.now();
  await bump("email", email.toLowerCase(), now);
  const reliableIp = reliableClientIp(ip);
  if (reliableIp !== null) await bump("ip", reliableIp, now);
}

export async function recordRegistrationFailure(ip: string | null): Promise<void> {
  await recordIpFailure(ip);
}

export async function recordIpFailure(ip: string | null): Promise<void> {
  const reliableIp = reliableClientIp(ip);
  if (reliableIp !== null) await bump("ip", reliableIp, Date.now());
}

/** A successful login clears only the caller's email bucket. The IP bucket is
 *  deliberately left intact so failed guesses for several accounts can never
 *  drain one attacker's IP-side counter. */
export async function clearLoginFailures(email: string): Promise<void> {
  await clear(key("email", email.toLowerCase()));
}

export async function clearRegistrationFailures(ip: string | null): Promise<void> {
  const reliableIp = reliableClientIp(ip);
  if (reliableIp !== null) await clear(key("ip", reliableIp));
}