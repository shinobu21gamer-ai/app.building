import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";

// The middleware routes on the *live* session row, not the token claims, so the
// suite stubs the one table it reads. `vi.hoisted` keeps the fixture reachable
// from the mock factory, which vitest hoists above the imports.
const state = vi.hoisted(() => ({
  roleKey: "CAPTAIN",
  isActive: true,
  revoked: false,
}));

vi.mock("@/lib/db", () => ({
  db: {
    revokedToken: {
      findUnique: async () => (state.revoked ? { id: 1 } : null),
    },
    user: {
      findUnique: async () => ({
        isActive: state.isActive,
        tokenVersion: 0,
        role: { key: state.roleKey },
        officeId: null,
      }),
    },
  },
}));

import { SESSION_COOKIE, createSessionToken } from "@/lib/auth/session";
import { middleware } from "@/middleware";

/** The header Next sets on a request it lets through instead of redirecting. */
function passedThrough(res: NextResponse): boolean {
  return res.headers.get("x-middleware-next") === "1";
}

/** Where a gated request was sent, as a path — `null` when it went through. */
function redirectPath(res: NextResponse): string | null {
  const location = res.headers.get("location");
  return location === null ? null : new URL(location).pathname;
}

async function visit(roleKey: string, pathname: string, options = {}) {
  state.roleKey = roleKey;
  state.isActive = true;
  state.revoked = false;
  Object.assign(state, options);

  const token = await createSessionToken({
    sub: "7",
    role: roleKey,
    officeId: null,
    email: "session@example.com",
    tv: 0,
  });
  const request = new NextRequest(
    new URL(pathname, "https://barangayresolve.example"),
    { headers: { cookie: `${SESSION_COOKIE}=${token}` } }
  );
  return middleware(request);
}

describe("middleware role gates", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = "test-secret-that-is-long-enough-to-sign-with";
  });

  it("lets the Captain open a case sheet to verify and close the case", async () => {
    // The bug this guards: the sheet is the Captain's only way to work a case,
    // and the portal gate used to bounce them back to /captain before the page
    // — which admits them on purpose — ever ran.
    const res = await visit("CAPTAIN", "/official/concerns/42");
    expect(passedThrough(res)).toBe(true);
  });

  it("sends the Captain away from the rest of the office's portal", async () => {
    expect(redirectPath(await visit("CAPTAIN", "/official"))).toBe("/captain");
    expect(redirectPath(await visit("CAPTAIN", "/official/concerns"))).toBe(
      "/captain"
    );
    expect(redirectPath(await visit("CAPTAIN", "/official/reports"))).toBe(
      "/captain"
    );
  });

  it("keeps the case sheet to the office that holds the case", async () => {
    expect(passedThrough(await visit("OFFICIAL", "/official/concerns/42"))).toBe(
      true
    );
    expect(passedThrough(await visit("ADMIN", "/official/concerns/42"))).toBe(
      true
    );
    expect(
      redirectPath(await visit("RESIDENT", "/official/concerns/42"))
    ).toBe("/resident");
    // Treasurers may read the case sheet to compare it against funding; this
    // is a shared route, not access to the rest of the official portal.
    expect(passedThrough(await visit("TREASURER", "/official/concerns/42"))).toBe(
      true
    );
    expect(redirectPath(await visit("CREW", "/official/concerns/42"))).toBe(
      "/crew"
    );
  });

  it("leaves the portals themselves exactly as they were", async () => {
    expect(passedThrough(await visit("CAPTAIN", "/captain/closure"))).toBe(true);
    expect(redirectPath(await visit("CAPTAIN", "/admin"))).toBe("/captain");
    expect(redirectPath(await visit("OFFICIAL", "/captain/closure"))).toBe(
      "/official"
    );
    expect(passedThrough(await visit("RESIDENT", "/resident/concerns/3"))).toBe(
      true
    );
    expect(passedThrough(await visit("OFFICIAL", "/notifications"))).toBe(true);
  });

  it("still turns away a visitor with no live session", async () => {
    expect(
      redirectPath(await visit("CAPTAIN", "/official/concerns/42", { revoked: true }))
    ).toBe("/login");
    expect(
      redirectPath(await visit("CAPTAIN", "/official/concerns/42", { isActive: false }))
    ).toBe("/login");

    const anonymous = new NextRequest(
      new URL("/official/concerns/42", "https://barangayresolve.example")
    );
    expect(redirectPath(await middleware(anonymous))).toBe("/login");
  });
});
