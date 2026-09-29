import { describe, expect, it } from "vitest";
import { enqueueAlerts, removeAlert, type QueuedAlert } from "./alert-queue";

const alert = (id: number, createdAt: string): QueuedAlert => ({ id, createdAt });

describe("enqueueAlerts", () => {
  it("queues several alerts instead of dropping all but one", () => {
    const result = enqueueAlerts([], [alert(1, "2026-01-01T00:00:00Z"), alert(2, "2026-01-01T00:01:00Z")], new Set());
    expect(result.map((a) => a.id)).toEqual([1, 2]);
  });

  it("does not re-queue an alert that is already pending", () => {
    const pending = [alert(1, "2026-01-01T00:00:00Z")];
    const result = enqueueAlerts(pending, [alert(1, "2026-01-01T00:00:00Z"), alert(2, "2026-01-01T00:01:00Z")], new Set());
    expect(result.map((a) => a.id)).toEqual([1, 2]);
  });

  it("does not re-queue an alert that has already been shown", () => {
    const result = enqueueAlerts([], [alert(1, "2026-01-01T00:00:00Z")], new Set([1]));
    expect(result).toHaveLength(0);
  });

  it("keeps existing pending alerts ahead of newly arrived ones", () => {
    const pending = [alert(1, "2026-01-01T00:00:00Z")];
    const result = enqueueAlerts(pending, [alert(2, "2026-01-01T00:01:00Z")], new Set());
    expect(result.map((a) => a.id)).toEqual([1, 2]);
  });

  it("drains oldest first when the API returns newest first", () => {
    const result = enqueueAlerts(
      [],
      [alert(3, "2026-01-01T00:02:00Z"), alert(1, "2026-01-01T00:00:00Z"), alert(2, "2026-01-01T00:01:00Z")],
      new Set(),
    );
    expect(result.map((a) => a.id)).toEqual([1, 2, 3]);
  });

  it("returns the same reference when nothing is added", () => {
    const pending = [alert(1, "2026-01-01T00:00:00Z")];
    expect(enqueueAlerts(pending, [], new Set())).toBe(pending);
    expect(enqueueAlerts(pending, [alert(1, "2026-01-01T00:00:00Z")], new Set())).toBe(pending);
  });
});

describe("removeAlert", () => {
  it("removes only the acknowledged alert", () => {
    const pending = [alert(1, "2026-01-01T00:00:00Z"), alert(2, "2026-01-01T00:01:00Z"), alert(3, "2026-01-01T00:02:00Z")];
    expect(removeAlert(pending, 2).map((a) => a.id)).toEqual([1, 3]);
  });

  it("leaves the queue untouched when the id is unknown", () => {
    const pending = [alert(1, "2026-01-01T00:00:00Z")];
    expect(removeAlert(pending, 99).map((a) => a.id)).toEqual([1]);
  });

  it("empties the queue once the last alert is acknowledged", () => {
    expect(removeAlert([alert(1, "2026-01-01T00:00:00Z")], 1)).toEqual([]);
  });
});
