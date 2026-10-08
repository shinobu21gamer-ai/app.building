import { describe, expect, it } from "vitest";
import { acknowledgeAlertsSchema, logoutDeviceSchema } from "./alert";

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

describe("logoutDeviceSchema", () => {
  it("accepts an empty hint so clients without push can still sign out", () => {
    expect(logoutDeviceSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a web-push endpoint on its own", () => {
    const result = logoutDeviceSchema.safeParse({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a native device token with its platform", () => {
    const result = logoutDeviceSchema.safeParse({
      token: "fcm-device-token-abcdefghij",
      platform: "android",
    });
    expect(result.success).toBe(true);
  });

  it("rejects malformed device hints", () => {
    expect(logoutDeviceSchema.safeParse({ endpoint: "not-a-url" }).success).toBe(false);
    expect(logoutDeviceSchema.safeParse({ token: "short" }).success).toBe(false);
    expect(logoutDeviceSchema.safeParse({ platform: "windows" }).success).toBe(false);
  });

  it("strips unrelated keys instead of failing", () => {
    const result = logoutDeviceSchema.safeParse({
      token: "fcm-device-token-abcdefghij",
      subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: {} },
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual({ token: "fcm-device-token-abcdefghij" });
  });
});
