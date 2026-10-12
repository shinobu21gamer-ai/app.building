import { describe, expect, it } from "vitest";
import { isCronAuthorized } from "@/lib/cron-auth";

function request(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("https://example.test/api/v1/cron/x", { headers });
}

const env = { CRON_SECRET: "a-long-random-secret-value" };

describe("isCronAuthorized", () => {
  it("accepts the exact bearer secret", () => {
    expect(
      isCronAuthorized(request("Bearer a-long-random-secret-value"), env)
    ).toBe(true);
  });

  it("refuses when CRON_SECRET is unset, even with a header", () => {
    expect(
      isCronAuthorized(request("Bearer anything"), {})
    ).toBe(false);
  });

  it("refuses a missing header", () => {
    expect(isCronAuthorized(request(), env)).toBe(false);
  });

  it("refuses a wrong secret of the same length", () => {
    expect(
      isCronAuthorized(request("Bearer a-long-random-secret-valuX"), env)
    ).toBe(false);
  });

  it("refuses a prefix or a different length without throwing", () => {
    expect(isCronAuthorized(request("Bearer a-long-random"), env)).toBe(false);
    expect(
      isCronAuthorized(request("Bearer a-long-random-secret-value-extra"), env)
    ).toBe(false);
  });

  it("requires the Bearer scheme", () => {
    expect(
      isCronAuthorized(request("a-long-random-secret-value"), env)
    ).toBe(false);
  });
});
