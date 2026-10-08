import { describe, expect, it } from "vitest";
import { toNativeAlertView } from "@/lib/capacitor-types";

describe("toNativeAlertView", () => {
  it("coerces FCM string IDs and false sound values", () => {
    const alert = toNativeAlertView({
      alertId: "42",
      sound: "false",
      body: "Road closure",
      createdAt: "2026-10-07T09:30:00.000Z",
      expiresAt: "2026-10-08T09:30:00.000Z",
    });
    expect(alert.id).toBe(42);
    expect(alert.sound).toBe(false);
    expect(alert.message).toBe("Road closure");
    expect(alert.createdAt).toBe("2026-10-07T09:30:00.000Z");
    expect(alert.expiresAt).toBe("2026-10-08T09:30:00.000Z");
  });

  it("accepts a legacy numeric ID and defaults sound to enabled", () => {
    const alert = toNativeAlertView({ id: 7 });
    expect(alert.id).toBe(7);
    expect(alert.sound).toBe(true);
  });
});
