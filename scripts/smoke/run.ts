/**
 * Live HTTP smoke tests against a running production server.
 *
 * Usage (server must be running on $SMOKE_BASE_URL):
 *   npx tsx scripts/smoke/run.ts
 *
 * Env overrides:
 *   SMOKE_BASE_URL       default http://localhost:3000
 *   SMOKE_ADMIN_EMAIL    default admin@barangayresolve.dev
 *   SMOKE_ADMIN_PASSWORD default BarangayResolve123!
 *
 * Covers: health, security headers, login throttling (email bucket), the
 * full admin-generated reset cycle (sessions revoked, one-time code), and
 * self password change keeping the current session. Cleans up the test user
 * and failure-bucket rows it creates. Exits non-zero on any failure.
 */
import { PrismaClient } from "@prisma/client";

const BASE_URL = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL =
  process.env.SMOKE_ADMIN_EMAIL ?? "admin@barangayresolve.dev";
const ADMIN_PASSWORD =
  process.env.SMOKE_ADMIN_PASSWORD ?? "BarangayResolve123!";

const db = new PrismaClient();
const stamp = Date.now().toString(36);
const RESET_EMAIL = `smoke.reset.${stamp}@example.ph`;
const THROTTLE_EMAIL = `smoke.throttle.${stamp}@example.ph`;

function fail(label: string): never {
  throw new Error(`FAILED: ${label}`);
}

function check(condition: boolean, label: string): void {
  if (!condition) fail(label);
  console.log(`  ok - ${label}`);
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  cookie?: string | null;
};

async function api(path: string, options: RequestOptions = {}) {
  const headers: Record<string, string> = { Origin: BASE_URL };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const cookie = options.cookie;
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: "manual",
  });
  return res;
}

async function apiJson(path: string, options: RequestOptions = {}) {
  const res = await api(path, options);
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { res, json };
}

function sessionCookie(res: Response): string | null {
  return (
    res.headers.getSetCookie().find((c) => c.startsWith("br_session="))?.split(";")[0] ?? null
  );
}

async function clearLoginFailures(email: string): Promise<void> {
  await db.loginAttemptBucket.deleteMany({
    where: { key: `email:${email}` },
  });
}

async function main(): Promise<void> {
  console.log(`SMOKE target: ${BASE_URL}`);
  console.log("step 1 - health");
  {
    const { res } = await apiJson("/api/v1/health");
    check(res.status === 200, "health returns 200");
  }

  console.log("step 2 - security headers");
  {
    const res = await api("/api/v1/health");
    const headers: Record<string, string> = {
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "cross-origin-opener-policy": "same-origin",
    };
    for (const [name, expected] of Object.entries(headers)) {
      check(res.headers.get(name) === expected, `${name}: ${expected}`);
    }
    check(
      res.headers.get("referrer-policy")?.includes("strict-origin") ?? false,
      "referrer-policy set"
    );
    check(
      res.headers.get("permissions-policy")?.includes("camera=()") ?? false,
      "permissions-policy set"
    );
    const csp = res.headers.get("content-security-policy") ?? "";
    check(csp.length > 0, "content-security-policy present (production)");
    check(csp.includes("frame-ancestors 'none'"), "csp frame-ancestors none");
  }

  console.log("step 3 - login throttling (email bucket)");
  {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const { res, json } = await apiJson("/api/v1/auth/login", {
        method: "POST",
        body: { email: THROTTLE_EMAIL, password: "WrongPass1" },
      });
      statuses.push(res.status);
      if (i === 5) {
        check(res.headers.get("x-request-id") !== null, "429 carries x-request-id");
        check(
          typeof json === "object" && json !== null && "error" in json,
          "429 has structured error body"
        );
      }
    }
    check(
      statuses.slice(0, 5).every((s) => s === 401) && statuses[5] === 429,
      `5x401 then 429 (got ${statuses.join(",")})`
    );
  }

  console.log("step 4 - register resident");
  let userCookie: string | null = null;
  {
    const { res, json } = await apiJson("/api/v1/auth/register", {
      method: "POST",
      body: {
        email: RESET_EMAIL,
        password: "FirstPass1",
        firstName: "Smoke",
        lastName: "Reset",
      },
    });
    check(res.status === 201, "register returns 201");
    userCookie = sessionCookie(res);
    check(userCookie !== null, "register issues session cookie");
    const { res: me } = await apiJson("/api/v1/auth/me", {
      cookie: userCookie,
    });
    check(me.status === 200, "me returns 200 with registered session");
    const user = (json as { data?: { user?: { id?: number } } })?.data?.user;
    check(typeof user?.id === "number", "register response has numeric user id");
  }

  console.log("step 5 - admin generates a reset code");
  let code: string | null = null;
  {
    const { res: adminRes, json: adminJson } = await apiJson("/api/v1/auth/login", {
      method: "POST",
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    check(adminRes.status === 200, "admin login returns 200");
    const adminCookie = sessionCookie(adminRes);
    check(adminCookie !== null, "admin session cookie issued");

    const admin = adminJson as { data?: { user?: { id?: number } } };
    const myUser = await (
      await apiJson("/api/v1/auth/me", { cookie: userCookie })
    ).json;
    const userId = (myUser as { data?: { user?: { id?: number } } })?.data
      ?.user?.id;
    check(typeof userId === "number", "registered user id resolved");

    const { res, json } = await apiJson(
      `/api/v1/admin/users/${String(userId)}/reset-password`,
      { method: "POST", cookie: adminCookie }
    );
    check(res.status === 200, "reset code generation returns 200");
    code = (json as { data?: { code?: string } })?.data?.code ?? null;
    check(
      typeof code === "string" && code.length === 16,
      "code is 16 hex chars"
    );
    check(admin?.data?.user?.id !== undefined, "admin actor resolved");
  }

  console.log("step 6 - redeem the code (reset-password)");
  const newPassword = "SecondPass2";
  {
    check(code !== null, "code captured before redemption");
    const { res } = await apiJson("/api/v1/auth/reset-password", {
      method: "POST",
      body: { email: RESET_EMAIL, code, newPassword },
    });
    check(res.status === 200, "redemption returns 200");

    const { res: oldMe } = await apiJson("/api/v1/auth/me", {
      cookie: userCookie,
    });
    check(oldMe.status === 401, "old session revoked after redemption (401)");

    const { res: oldLogin } = await apiJson("/api/v1/auth/login", {
      method: "POST",
      body: { email: RESET_EMAIL, password: "FirstPass1" },
    });
    check(oldLogin.status === 401, "old password rejected after reset");

    const { res: newLogin } = await apiJson("/api/v1/auth/login", {
      method: "POST",
      body: { email: RESET_EMAIL, password: newPassword },
    });
    check(newLogin.status === 200, "new password logs in");
    userCookie = sessionCookie(newLogin);

    const { res: reuse } = await apiJson("/api/v1/auth/reset-password", {
      method: "POST",
      body: { email: RESET_EMAIL, code, newPassword: "ThirdPass3" },
    });
    check(reuse.status === 400, "code is single-use (second redeem 400)");
    check((await apiJson("/api/v1/auth/me", { cookie: userCookie })).res.status === 200, "new session works");
  }

  console.log("step 7 - self password change keeps current session");
  const finalPassword = "FourthPass4";
  {
    const { res: change } = await apiJson("/api/v1/auth/password", {
      method: "PATCH",
      cookie: userCookie,
      body: {
        currentPassword: newPassword,
        newPassword: finalPassword,
      },
    });
    check(change.status === 200, "password change returns 200");
    const reissued = sessionCookie(change);
    check(reissued !== null, "password change re-issues the session cookie");
    userCookie = reissued;

    const { res: meAfter } = await apiJson("/api/v1/auth/me", {
      cookie: userCookie,
    });
    check(meAfter.status === 200, "current session kept after change");

    const { res: stale } = await apiJson("/api/v1/auth/login", {
      method: "POST",
      body: { email: RESET_EMAIL, password: newPassword },
    });
    check(stale.status === 401, "superseded password rejected");

    const { res: finalLogin } = await apiJson("/api/v1/auth/login", {
      method: "POST",
      body: { email: RESET_EMAIL, password: finalPassword },
    });
    check(finalLogin.status === 200, "final password logs in");
  }

  console.log(`SMOKE PASSED (target ${BASE_URL})`);
}

main()
  .then(async () => {
    await db.passwordResetCode.deleteMany({
      where: { user: { email: RESET_EMAIL } },
    });
    await db.user.deleteMany({ where: { email: RESET_EMAIL } });
    await clearLoginFailures(RESET_EMAIL);
    await clearLoginFailures(THROTTLE_EMAIL);
    await db.$disconnect();
    process.exitCode = 0;
  })
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
    try {
      await db.passwordResetCode.deleteMany({
        where: { user: { email: RESET_EMAIL } },
      });
      await db.user.deleteMany({ where: { email: RESET_EMAIL } });
      await clearLoginFailures(RESET_EMAIL);
      await clearLoginFailures(THROTTLE_EMAIL);
    } finally {
      await db.$disconnect();
    }
  })
  .finally(() => {
    console.log("SMOKE DONE");
  });