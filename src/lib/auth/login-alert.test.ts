import { describe, expect, it } from "vitest";
import { isNewLoginContext } from "./login-alert";

describe("isNewLoginContext", () => {
  it("flags a different browser or device", () => {
    expect(
      isNewLoginContext(
        { userAgent: "Browser A", ip: "192.0.2.1" },
        { userAgent: "Browser B", ip: "192.0.2.1" }
      )
    ).toBe(true);
  });

  it("flags a new network even when the browser is the same", () => {
    expect(
      isNewLoginContext(
        { userAgent: "Browser A", ip: "192.0.2.1" },
        { userAgent: "Browser A", ip: "192.0.2.2" }
      )
    ).toBe(true);
  });

  it("does not flag the same context when whitespace differs", () => {
    expect(
      isNewLoginContext(
        { userAgent: " Browser A ", ip: "192.0.2.1" },
        { userAgent: "Browser A", ip: "192.0.2.1" }
      )
    ).toBe(false);
  });

  it("does not alert on the first login or unknown context data", () => {
    expect(isNewLoginContext(null, { userAgent: "Browser A", ip: null })).toBe(false);
    expect(
      isNewLoginContext(
        { userAgent: null, ip: null },
        { userAgent: null, ip: null }
      )
    ).toBe(false);
  });
});
