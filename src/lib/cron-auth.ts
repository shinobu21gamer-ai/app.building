import { timingSafeEqual } from "node:crypto";

/**
 * Guard for the scheduled-job routes (`/api/v1/cron/*`).
 *
 * A caller must send `Authorization: Bearer <CRON_SECRET>`. An unset secret
 * refuses every request, so an unconfigured deployment never runs jobs open to
 * the internet. The comparison is constant-time, so the secret cannot be
 * recovered by timing how quickly a wrong guess is rejected.
 */
export function isCronAuthorized(
  req: Request,
  env: Record<string, string | undefined> = process.env
): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;

  const provided = Buffer.from(req.headers.get("authorization") ?? "", "utf8");
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
