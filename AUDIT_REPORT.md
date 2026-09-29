# Final Audit & Hardening Report — BarangayResolve (A–O)

> **Second review pass (2026-09-28)** — a full system review was run and every
> finding below was fixed. Summary of that pass:
>
> - **Auth/session:** middleware now revalidates the session against the database
>   (`isActive`, `tokenVersion`, current role), removing the redirect loop that
>   deactivated/role-changed/revoked users hit; cookie clearing honors the
>   configured `Secure` flag; login honors `?next=`; reset-password equalizes
>   response timing with a dummy bcrypt compare; registration maps `P2002` to 409.
> - **Rate limiting:** IP is taken from the trusted proxy header
>   (`cf-connecting-ip`, set by the Cloudflare tunnel); unverifiable callers fall
>   into a shared bucket (fail-closed) instead of bypassing throttles; a
>   successful login clears only the email bucket so the IP counter cannot be
>   drained by rotating accounts; `Retry-After` is returned on 429.
> - **Uploads:** multipart bodies are capped (`Content-Length` + streamed byte
>   cap → 413) before buffering; the daily quota check-and-insert is serialized
>   per user (TOCTOU closed); file names are validated before deletion; a failed
>   record insert no longer orphans a file.
> - **Workflow/API:** `/status` forwards the optional `resolvedOn` date (new date
>   field in the resolve form); `P2002` races map to 409 on status, resolutions
>   and assignments; the assignments GET no longer exposes unassigned cases to
>   officials from other offices; `z.coerce.boolean()` inversion (`"false"` →
>   `true`) replaced with an explicit flag validator; priority thresholds/overrides
>   are restricted to the real priority levels; SLA breach history/notification
>   types are declared in one place and render a proper label instead of
>   "Update".
> - **Data/scale:** case numbers are sequence-based (correct past 10 000/day),
>   all list queries are bounded, the dashboard processing-time scan is linear
>   (no spread RangeError) and sampled, expired revoked tokens are pruned.
> - **UX/cleanup:** push-enable result is now rendered, alert acknowledgement
>   surfaces errors and focuses the dialog, reaction errors are shown, and
>   duplicated `extractError`/`firstParam` helpers and the three identical role
>   layouts were consolidated (`RoleShell`, `extractApiError`, `firstParam`).

**Scope**: BarangayResolve web application (Next.js 15 App Router, TypeScript, Prisma/SQLite, JWT HttpOnly cookie, bcrypt, Zod, Tailwind v4).
**Phases executed**: P1–P19 mapped to 11 batches (B1–B11). All batches complete.
**Environment**: Windows/PowerShell; `npm.cmd`/`npx.cmd`/`curl.exe`; Node 25; SQLite `prisma/dev.db`.
**Demo accounts**: password `BarangayResolve123!` — `admin@barangayresolve.dev`, `official.*@`, `resident@...`.
**Secrets policy**: never shipped; `.env` excluded; `.env.example` documents required variables.

---

## A. Executive Summary

Completed a comprehensive security, correctness, and operability hardening pass across the entire BarangayResolve codebase. Nine major functional areas were addressed:
- Security headers & CSP (P2)
- Route authorization sweep (P3, P6)
- Login/register rate limiting (P4)
- Admin-initiated password reset + session invalidation via `tokenVersion` (P5)
- DB index + referential integrity audit (P8)
- Per-user daily upload quota (P9)
- Structured JSON logging + correlation IDs (P11, P12)
- Accessibility fixes (P13, P14)
- Pagination/N+1 performance audit (P15)
- Production build/boot verification (P16)
- Vitest unit suite (41 tests) + live HTTP smoke scripts (P17)
- Full gate re-run + docs (SECURITY.md, README refresh) + final test cleanup (P18, P19)

All automated gates (typecheck, lint, Vitest, clean build, smoke) pass. The database is returned to a pristine seeded state.

---

## B. Security Posture

| Area | Status | Details |
|---|---|---|
| **Transport** | Hardened | `SESSION_COOKIE_SECURE=true` in production; `SameSite=Lax`, `HttpOnly`. |
| **Headers** | Hardened | `nosniff`, `DENY`, `strict-origin-when-cross-origin`, `Permissions-Policy`, `COOP`, CSP (prod-only). |
| **Auth** | Hardened | bcrypt(12), generic failure messages, dummy-hash timing, `tokenVersion` revocation on every password change, email + IP rate limits. |
| **Password reset** | Implemented | Admin generates 16-char hex code (30 min TTL, bcrypt-hashed); public redeem endpoint throttled; uniform error message; single-use; revokes all sessions. |
| **Authorization** | Verified | Full `/api/v1` sweep — every state-changing route Zod-validated + role-guarded; `[id]` params positive-int; no `passwordHash` leaks; only `health` and `logout` intentionally unauthenticated. |
| **Uploads** | Hardened | Magic-byte validation (JPEG/PNG/WebP), 5 MB max, UUID filenames, `UPLOAD_DIR` outside web root, authenticated serving with ownership checks, per-user daily quota (default 25 MiB). |
| **Logging** | Added | Structured JSON lines per request + error; `x-request-id` header on errors; health excluded. |
| **Known advisories** | Tracked | 5 transitive build-time advisories (`postcss` in Next.js, `deepmerge-ts` in Prisma CLI). Fixes require breaking upgrades (`next@16`, `prisma@6.12`) — documented in SECURITY.md. |

---

## C. Backend Correctness

| Component | Changes | Verification |
|---|---|---|
| **API envelope** | `ok()`, `handleError()`, `withErrorBoundary()` unified; 429 support added. | All routes return `{ success, data \| error }`. |
| **Rate limiting** | `src/lib/rate-limit.ts` (hybrid in-memory + SQLite); login/register/reset endpoints wired. | Manual + smoke: 5×401 → 429 with `x-request-id`. |
| **Session invalidation** | `User.tokenVersion` bumped on self password change, admin password set, reset redemption. `getAuthUser()` rejects `tv` mismatch. | Smoke: old session 401 after reset/change; new password 200. |
| **Validation** | Zod schemas for all mutating endpoints; real calendar date validation for `resolvedOn`. | Unit tests cover bounds, regex, date validity. |
| **Referential integrity** | App-level delete guards (409 on historical references); soft-delete pattern. | Admin UI/API refuse delete with reference count. |
| **DB indexes** | Composite indexes: `Concern[assignedOfficeId, status, createdAt]`, `Notification[userId, createdAt]`. | Migration applied; query plans verified (no scans). |

---

## D. Data Integrity

- **Migrations applied**: 4 new migrations (`20260920023746_login_attempt_bucket`, `20260920024339_session_invalidation_and_reset_codes`, `20260920024640_add_case_list_indexes`, `20260920024801_add_upload_records`).
- **Schema additions**: `User.tokenVersion`, `PasswordResetCode`, `LoginAttemptBucket`, `UploadRecord`, new composite indexes.
- **Seed data**: Unchanged; 9 demo accounts preserved.
- **Test artifacts**: All smoke/test users (`smoke.*`, `cycle.test@example.ph`, `ratelimit.test@nowhere.ph`) and their buckets/codes deleted in final cleanup pass. DB returned to pristine seed state.

---

## E. Payments / Financial Flows

**N/A — BarangayResolve has no payment subsystem.** The closest analogue is the **upload quota** feature (P9), which enforces a per-user daily byte budget to protect disk space and prevent abuse. Enforced at write time via `UploadRecord` daily sum; configurable at runtime via `/admin/settings` (key `uploads.daily_quota_bytes`).

---

## F. HRMS / Personnel Features

**N/A — BarangayResolve is a citizen concern management system, not an HRMS.** The analogous domain concepts:
- **Accounts**: Residents, Officials (scoped to one office), Administrators.
- **Offices**: Barangay offices (Infrastructure, Environment, Peace & Order, Secretary, Health) — configurable, reference-counted, soft-deleted.
- **Officials ↔ Offices**: One-to-many; admins manage via `/admin/officials` and `/admin/offices`.

---

## G. POS / UX & Visual Identity

**N/A — Not a POS system.** UX/visual identity preserved:
- Tailwind v4 design system unchanged.
- All existing pages (`/resident`, `/official`, `/admin`, `/login`, `/register`, `/profile`, `/notifications`, `/reset-password`) retain their look and flows.
- No speculative rewrites; only targeted fixes (A11y label wiring, form-state disable-on-submit already present).

---

## H. Accessibility (WCAG 2.1 AA)

| Fix | File | Verification |
|---|---|---|
| Search input `id="admin-filter-q"` + `<label htmlFor>` | `admin-filter-bar.tsx` | Agent + manual |
| Per-field select labels (`admin-filter-{name}`) | `admin-filter-bar.tsx` | Agent + manual |
| Filter input `aria-label="Filter by category or office"` | `routing-rules-manager.tsx` | Agent + manual |
| All forms: submit disabled during fetch | Already compliant | Agent audit |
| Focus-visible via Tailwind | Global | Unchanged |

No other violations found by the automated agent scan.

---

## I. Performance

| Check | Result |
|---|---|
| **List pagination** | Capped at 200; response includes `truncated` + `total` (no N+1). |
| **Notification list** | Capped at 200; single query with `concern` select. |
| **N+1 elimination** | All dashboard/queue queries use single Prisma calls with targeted `include`/`select`. |
| **Production build** | Clean `npm run build` EXIT=0; `BUILD_ID` generated (`XhM9hkYJWuxAK3YqbOpTd`). |
| **Boot time** | ~3–5 s to listener on port 3000 (observed). |
| **Smoke latency** | Full 7-step credential cycle < 2 s against warm server. |

---

## J. Tests Added

| Suite | Files | Tests | Coverage |
|---|---|---|---|
| **Vitest unit** | 6 (`workflow.test.ts`, `engine.test.ts`, `case.test.ts`, `auth.test.ts`, `query.test.ts` × 2) | 41 | Priority engine (scoring, bounds, thresholds, validation), workflow transitions + `canManageConcern` + feedback rules, case validations (real calendar date), auth schemas (password policy, reset code 8–16 chars), concern/notification query parsers (status/priority normalization, Manila date→UTC, caps). |
| **Live HTTP smoke** | `scripts/smoke/run.ts` (tsx) | 7 steps, 28 assertions | Health, 5 security headers + CSP, login throttling (5×401→429 + `x-request-id`), register→me, admin code generation, reset redemption (old session 401, old password 401, new password 200, second redeem 400), self password change keeps session (cookie re-issue). |

---

## K. Tests Executed

| Command | Exit | Duration |
|---|---|---|
| `npm run test` | 0 | ~6 s |
| `npm run typecheck` | 0 | ~3 s |
| `npm run lint` | 0 | ~4 s |
| `npm run build` (clean) | 0 | ~58 s |
| `npm run start` + smoke | 0 | ~8 s |
| **All gates** | **PASS** | — |

---

## L. Remaining Issues / Deliberate Waivers

| Item | Decision | Rationale |
|---|---|---|
| **No email delivery** | Waived | Stack has no SMTP/email provider; admin reset is the documented fallback. |
| **Stateless sessions** | Accepted | `tokenVersion` provides instant revocation; no server-side store needed. Documented trade-off. |
| **Single-instance rate limiting** | Accepted | In-memory cache + SQLite table; multi-instance would need Redis. Not required for current deployment model. |
| **Cursor pagination** | Waived | Capped lists (200) with `truncated`/`total` flags; no infinite scroll or cursor UI in product yet. |
| **Build-time npm advisories** | Tracked | 5 transitive vulns in `postcss`/`deepmerge-ts`; fixes force breaking upgrades. Documented in SECURITY.md. |
| **Reports module** | Out of scope | Explicitly excluded per user direction (to be built in next stage). |
| **Git/CI** | Skipped | User directed "skip git/CI". |

---

## M. Environment & Deploy Notes

### Required `.env` variables
```
DATABASE_URL="file:./dev.db"
JWT_SECRET="<long-random-hex>"
SESSION_COOKIE_SECURE="true"      # "false" only for local `next start` over HTTP
UPLOAD_DIR="./uploads"            # optional; defaults to <project>/uploads
UPLOAD_DAILY_QUOTA_BYTES="26214400"  # optional; 25 MiB default
```

### Production checklist
1. `SESSION_COOKIE_SECURE=true` (HTTPS required).
2. `JWT_SECRET` rotated from the example value.
3. `DATABASE_URL` pointed at a managed PostgreSQL/MySQL instance (Prisma schema portable).
4. `UPLOAD_DIR` on a persistent volume with appropriate permissions.
5. CSP `script-src 'self' 'unsafe-inline'` is required for Next.js RSC; if a stricter CSP is needed, a nonce/hash strategy must be implemented (out of scope).

---

## N. Files Changed (Key)

| Category | Files |
|---|---|
| **Config** | `next.config.ts`, `vitest.config.mts`, `package.json` (`test` script), `.env.example` |
| **Auth/Session** | `src/lib/auth/session.ts` (tv claim), `src/lib/auth/password.ts`, `src/app/api/v1/auth/{login,register,password,reset-password}/route.ts`, `src/app/api/v1/admin/users/[id]/reset-password/route.ts` |
| **Rate limit** | `src/lib/rate-limit.ts`, `src/lib/api.ts` (429, `assertSameOrigin`), `src/app/api/v1/auth/{login,register}/route.ts` |
| **Upload quota** | `src/lib/cases/settings.ts`, `src/lib/uploads.ts`, `src/app/api/v1/concerns/route.ts`, `src/app/api/v1/concerns/[id]/resolutions/route.ts` |
| **Logging** | `src/lib/logger.ts`, `src/lib/api.ts` (`handleError`, `withErrorBoundary`) |
| **A11y** | `src/components/admin/admin-filter-bar.tsx`, `src/components/admin/routing-rules-manager.tsx` |
| **DB** | `prisma/schema.prisma`, 4 migrations in `prisma/migrations/` |
| **Tests** | `vitest.config.mts`, `src/lib/**/*.test.ts` (6 files), `scripts/smoke/run.ts` |
| **Docs** | `README.md`, `SECURITY.md` |

---

## O. Migration & Rollback Notes

- All 4 migrations are **forward-only** (additive: new tables, columns, indexes). No destructive changes.
- To roll back: `npx prisma migrate reset` (drops all tables, re-runs full history + seed) — acceptable for dev/staging; production would use a backup/restore strategy.
- `User.tokenVersion` defaults to 0; existing sessions remain valid until their next password change or admin reset.
- `PasswordResetCode` table is empty at baseline; no migration data needed.
- `LoginAttemptBucket` and `UploadRecord` start empty; populate on first use.

---

**Sign-off**: All B1–B11 batches complete. Gates green. Database pristine. Documentation current.
**Next stage**: Reports module (P10) + email integration for resident self-service password reset.