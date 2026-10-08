import { describe, expect, it } from "vitest";
import { acknowledgeAlertsSchema } from "./alert";

describe("acknowledgeAlertsSchema", () => {
  it("accepts a unique batch of alert IDs", () => {
    expect(acknowledgeAlertsSchema.safeParse({ alertIds: [1, 2, 3] }).success).toBe(true);
  });

  it("rejects an empty batch, duplicates, and batches over the active-alert limit", () => {
    expect(acknowledgeAlertsSchema.safeParse({ alertIds: [] }).success).toBe(false);
    expect(acknowledgeAlertsSchema.safeParse({ alertIds: [1, 1] }).success).toBe(false);
    expect(
      acknowledgeAlertsSchema.safeParse({ alertIds: Array.from({ length: 501 }, (_, index) => index + 1) }).success
    ).toBe(false);
  });
});
