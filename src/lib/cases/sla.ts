import { runSlaEscalations } from "@/lib/sla/escalation";

/**
 * Kept for the callers and the admin route written before the revamp: it used
 * to be the only SLA scanner. The rules (48-hour windows, per-stage policies,
 * level 2 at twice the window, one escalation per case and level) now live in
 * `src/lib/sla/`, and the escalation rows, history entries, notifications and
 * `CronRun` bookkeeping are written there.
 *
 * Returns the number of escalations written, which is what the old scanner
 * reported as "breached cases".
 */
export async function scanSlaBreaches(): Promise<number> {
  const result = await runSlaEscalations({ triggeredBy: "MANUAL" });
  return result.escalated;
}
