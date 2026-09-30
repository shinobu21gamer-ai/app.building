import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { cache } from "react";
import { db } from "@/lib/db";
import { createApiError } from "@/lib/api";

export const SESSION_COOKIE = "br_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export type SessionClaims = {
  sub: string;
  role: string;
  officeId: number | null;
  email: string;
  // Session version. Bumped whenever the user's password changes; a token
  // carrying an older version is rejected, which revokes old sessions.
  tv: number;
};

export type AuthUser = Prisma.UserGetPayload<{
  include: { role: true; office: true };
}>;

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "JWT_SECRET is not configured. Add it to your .env file (see .env.example)."
    );
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(
  claims: SessionClaims
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());
}

export async function verifySessionToken(
  token: string
): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.sub !== "string") return null;
    const subNumber = Number(payload.sub);
    // Reject non-symmetric garbage like "null" / "1.5". Otherwise these
    // would be passed to Prisma as NaN and surface as a 500 instead of a
    // clean authentication failure.
    if (!Number.isInteger(subNumber) || subNumber <= 0) return null;
    return {
      sub: payload.sub,
      role: typeof payload.role === "string" ? payload.role : "",
      officeId: typeof payload.officeId === "number" ? payload.officeId : null,
      email: typeof payload.email === "string" ? payload.email : "",
      tv: typeof payload.tv === "number" ? payload.tv : 0,
    };
  } catch {
    return null;
  }
}

/** SHA-256 hex digest via Web Crypto, so this module loads in Edge too. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function isTokenRevoked(token: string): Promise<boolean> {
  const tokenHash = await hashToken(token);
  const revoked = await db.revokedToken.findUnique({
    where: { tokenHash },
    select: { id: true },
  });
  return revoked !== null;
}

/**
   * Whether the session cookie carries the `Secure` flag.
   * Defaults to true in production, but can be overridden with
   * SESSION_COOKIE_SECURE (useful when running `next start` over plain HTTP
   * on a local machine). Never disable this in a real HTTPS deployment.
   */
  function isSecureCookie(): boolean {
    const explicit = process.env.SESSION_COOKIE_SECURE;
    if (explicit !== undefined) return explicit.toLowerCase() === "true";
    return process.env.NODE_ENV === "production";
  }

  function isCapacitor(): boolean {
    return process.env.NEXT_PUBLIC_CAPACITOR_APP === "true";
  }

  export const sessionCookieOptions = {
    httpOnly: true,
    sameSite: isCapacitor() ? ("none" as const) : ("lax" as const),
    secure: isSecureCookie(),
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };

export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions);
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
}

export function roleHome(roleKey: string): string {
  if (roleKey === "ADMIN") return "/admin";
  if (roleKey === "OFFICIAL") return "/official";
  return "/resident";
}

/** Loads the current signed-in user from the session cookie, or null. */
export const getAuthUser = cache(async (): Promise<AuthUser | null> => {
  const token = await getSessionToken();
  if (!token) return null;

  const claims = await verifySessionToken(token);
  if (!claims) return null;

  const revoked = await isTokenRevoked(token);
  if (revoked) return null;

  const user = await db.user.findUnique({
    where: { id: Number(claims.sub) },
    include: { role: true, office: true },
  });
  if (!user || !user.isActive || user.tokenVersion !== claims.tv) return null;
  return user;
});

/** RSC/page guard: redirects to /login when there is no valid session. */
export async function requireUser(): Promise<AuthUser> {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  return user;
}

/** RSC/page guard: requires one of the given role keys. */
export async function requireRole(keys: string[]): Promise<AuthUser> {
  const user = await requireUser();
  if (!keys.includes(user.role.key)) redirect(roleHome(user.role.key));
  return user;
}

/** API guard: throws 401 when there is no valid session. */
export async function requireApiUser(): Promise<AuthUser> {
  const user = await getAuthUser();
  if (!user) throw createApiError.unauthorized();
  return user;
}

/** API guard: requires one of the given role keys, otherwise throws 403. */
export async function requireApiRole(keys: string[]): Promise<AuthUser> {
  const user = await requireApiUser();
  if (!keys.includes(user.role.key)) throw createApiError.forbidden();
  return user;
}

/** Safe, serializable representation of a user (never exposes the hash). */
export function publicUser(user: AuthUser) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    address: user.address,
    role: user.role?.key ?? null,
    roleName: user.role?.name ?? null,
    office: user.office
      ? { id: user.office.id, name: user.office.name, code: user.office.code }
      : null,
    createdAt: user.createdAt,
  };
}