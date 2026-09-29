export type QueuedAlert = {
  id: number;
  createdAt: string;
};

/**
 * Merge freshly fetched alerts into the pending queue.
 *
 * Rules:
 * - an alert is queued at most once, even if it arrives via both polling and a
 *   native push event in the same tick;
 * - an alert that has already been displayed is never queued again;
 * - the queue is drained oldest first, so alerts are acknowledged in the order
 *   they were raised.
 *
 * Returns the same array reference when nothing changed so callers can cheaply
 * skip re-renders.
 */
export function enqueueAlerts<T extends QueuedAlert>(
  pending: readonly T[],
  incoming: readonly T[],
  alreadyShown: ReadonlySet<number>,
): T[] {
  const queued = new Set(pending.map((alert) => alert.id));
  const added: T[] = [];

  for (const alert of incoming) {
    if (queued.has(alert.id) || alreadyShown.has(alert.id)) continue;
    queued.add(alert.id);
    added.push(alert);
  }

  if (added.length === 0) return pending as T[];

  added.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return [...pending, ...added];
}

/** Drop an alert from the queue by id. */
export function removeAlert<T extends QueuedAlert>(pending: readonly T[], id: number): T[] {
  return pending.filter((alert) => alert.id !== id);
}
