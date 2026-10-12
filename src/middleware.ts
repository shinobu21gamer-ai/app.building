import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  SESSION_COOKIE,
  hashToken,
  verifySessionToken,
} from "@/lib/auth/session";
import { PORTAL_GUARDS, roleHome } from "@/lib/auth/roles";

export const runtime = "nodejs";

// Pages that require a signed-in session: every role portal, plus the shared
// account surfaces. `/alerts` and `/notifications` are shared by all roles and
// keep their existing behaviour (the Android WebView depends on them).
const PROTECTED_PREFIXES = [
  ...PORTAL_GUARDS.map((guard) => guard.prefix),
  "/profile",
  "/notifications",
  "/alerts",
  "/privacy/requests",
];

// Pages that are only for guests (signed-in users are redirected away).
const GUEST_PAGES = ["/login", "/register", "/reset-password"];

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function redirectTo(url: URL, pathname: string, preserveNext = true): NextResponse {
  const next = new URL(pathname, url);
  if (preserveNext) next.searchParams.set("next", url.pathname + url.search);
  const res = NextResponse.redirect(next);
  Object.entries(NO_STORE_HEADERS).forEach(([k, v]) => res.headers.set(k, v));
  return res;
}

function redirectToLoginAndClearSession(url: URL): NextResponse {
  const reqUrl = new URL(url);
  const res = redirectTo(reqUrl, "/login", true);
  const secureFlag = process.env.SESSION_COOKIE_SECURE
    ? process.env.SESSION_COOKIE_SECURE.toLowerCase() === "true"
    : process.env.NODE_ENV === "production";
  res.cookies.set(SESSION_COOKIE, "", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: secureFlag,
    maxAge: 0,
  });
  return res;
}

function addNoStoreHeaders(res: NextResponse): NextResponse {
  Object.entries(NO_STORE_HEADERS).forEach(([k, v]) => res.headers.set(k, v));
  return res;
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Whether the given session token has been revoked server-side (logout). */
async function isTokenRevoked(token: string): Promise<boolean> {
  const tokenHash = await hashToken(token);
  const revoked = await db.revokedToken.findUnique({
    where: { tokenHash },
    select: { id: true },
  });
  return revoked !== null;
}

type LiveSession = {
  role: string;
  officeId: number | null;
};

/**
 * Resolves the *current, authoritative* session state from the database, not
 * from the JWT claims. A well-signed token is not necessarily a live session:
 * admins can deactivate an account, change a role, or set a new password
 * (which bumps tokenVersion) without the user signing out. The middleware must
 * route on the database state, otherwise deactivated / re-roled / reset users
 * get trapped in a login<->home redirect loop.
 */
async function resolveLiveSession(
  token: string
): Promise<LiveSession | null> {
  if (await isTokenRevoked(token)) return null;

  const claims = await verifySessionToken(token);
  if (!claims) return null;
  const subject = Number(claims.sub);
  if (!Number.isInteger(subject) || subject <= 0) return null;

  const user = await db.user.findUnique({
    where: { id: subject },
    select: {
      isActive: true,
      tokenVersion: true,
      role: { select: { key: true } },
      officeId: true,
    },
  });
  if (!user || !user.isActive || user.tokenVersion !== claims.tv) return null;

  return {
    role: user.role?.key ?? "",
    officeId: user.officeId,
  };
}

export async function middleware(request: NextRequest) {
  const url = request.nextUrl;
  const pathname = url.pathname;

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  let role: string | null = null;

  if (token) {
    const live = await resolveLiveSession(token);
    role = live?.role ?? null;
  }

  const isProtected = PROTECTED_PREFIXES.some((p) => matchesPrefix(pathname, p));
  const isGuestPage = GUEST_PAGES.includes(pathname);

  // Not signed in.
  if (!role) {
    if (isProtected) {
      return redirectToLoginAndClearSession(url);
    }
    return addNoStoreHeaders(NextResponse.next());
  }

  // Signed in: keep guests off the auth pages, send them to their home.
  if (isGuestPage) {
    return redirectTo(url, roleHome(role), false);
  }

  // Role gates: each portal lists the roles allowed inside it. A user who
  // knocks on the wrong door is sent to their own portal, never to a dead end.
  for (const guard of PORTAL_GUARDS) {
    if (!matchesPrefix(pathname, guard.prefix)) continue;
    if (!(guard.roles as readonly string[]).includes(role)) {
      return redirectTo(url, roleHome(role), false);
    }
  }

  return addNoStoreHeaders(NextResponse.next());
}

export const config = {
  matcher: [
    "/resident/:path*",
    "/official/:path*",
    "/admin/:path*",
    "/treasury/:path*",
    "/captain/:path*",
    "/crew/:path*",
    "/profile/:path*",
    "/notifications",
    "/alerts",
    "/privacy/requests/:path*",
    "/login",
    "/register",
    "/reset-password",
  ],
};
