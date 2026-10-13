import { describe, expect, it } from "vitest";
import { planWindowFloor, planWindowProblem } from "./plan-window";

const TODAY = "2026-10-13";
const at = (iso: string) => new Date(iso);

describe("planWindowProblem", () => {
  it("accepts a window that starts today or later", () => {
    expect(
      planWindowProblem({
        scheduledStartAt: at("2026-10-13T08:00:00+08:00"),
        scheduledEndAt: at("2026-10-13T12:00:00+08:00"),
        today: TODAY,
      })
    ).toBeNull();
    expect(
      planWindowProblem({
        scheduledStartAt: at("2026-11-02T09:00:00+08:00"),
        scheduledEndAt: null,
        today: TODAY,
      })
    ).toBeNull();
  });

  it("ignores a blank window", () => {
    expect(
      planWindowProblem({
        scheduledStartAt: null,
        scheduledEndAt: null,
        today: TODAY,
      })
    ).toBeNull();
  });

  it("rejects a planned finish before the planned start", () => {
    const message = planWindowProblem({
      scheduledStartAt: at("2026-10-15T09:00:00+08:00"),
      scheduledEndAt: at("2026-10-15T08:00:00+08:00"),
      today: TODAY,
    });
    expect(message).toContain("after the planned start");
  });

  it("rejects a planned start in the past", () => {
    const message = planWindowProblem({
      scheduledStartAt: at("2026-10-10T08:00:00+08:00"),
      scheduledEndAt: null,
      today: TODAY,
    });
    expect(message).toContain("planned start cannot be in the past");
  });

  it("rejects a planned finish in the past", () => {
    const message = planWindowProblem({
      scheduledStartAt: null,
      scheduledEndAt: at("2026-10-01T08:00:00+08:00"),
      today: TODAY,
    });
    expect(message).toContain("planned finish cannot be in the past");
  });

  it("keeps a window that was already stored, even when it has passed", () => {
    // A case that is already running must stay editable: re-saving the same
    // days is allowed, moving them further into the past is not.
    const existing = {
      scheduledStartAt: at("2026-10-05T08:00:00+08:00"),
      scheduledEndAt: at("2026-10-05T17:00:00+08:00"),
    };
    expect(
      planWindowProblem({
        ...existing,
        existing,
        today: TODAY,
      })
    ).toBeNull();

    expect(
      planWindowProblem({
        scheduledStartAt: at("2026-10-04T08:00:00+08:00"),
        scheduledEndAt: existing.scheduledEndAt,
        existing,
        today: TODAY,
      })
    ).toContain("planned start cannot be in the past");
  });
});

describe("planWindowFloor", () => {
  it("is midnight today in Manila", () => {
    expect(planWindowFloor(TODAY).toISOString()).toBe("2026-10-12T16:00:00.000Z");
  });
});
