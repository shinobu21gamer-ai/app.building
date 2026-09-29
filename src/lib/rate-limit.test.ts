import { describe, expect, it } from "vitest";
import { reliableClientIp } from "./rate-limit";

describe("reliableClientIp", () => {
  it("passes a real client address through", () => {
    expect(reliableClientIp("203.0.113.7")).toBe("203.0.113.7");
    expect(reliableClientIp("  198.51.100.9  ")).toBe("198.51.100.9");
  });

  it("treats loopback as trusted local traffic (no IP throttle)", () => {
    expect(reliableClientIp("::1")).toBeNull();
    expect(reliableClientIp("localhost")).toBeNull();
  });

  it("collapses missing addresses into a shared bucket instead of failing open", () => {
    const sentinel = reliableClientIp(null);
    expect(sentinel).toBe("__unverified_ip__");
    expect(reliableClientIp("")).toBe(sentinel);
    expect(reliableClientIp("   ")).toBe(sentinel);
  });
});
