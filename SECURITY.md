# Security Policy

## Supported Versions

This is a pre-1.0 project; no formal LTS. The latest `main` branch receives
all security fixes.

## Reporting a Vulnerability

Do **not** open a public issue for security problems. Send details to the
maintainers privately so they can be triaged and a fix can be prepared.

## Hardening Summary (as of the current build)

### Authentication & Session Management
- **Passwords** are hashed with bcrypt (12 rounds); plain text is never stored.
- **Session cookie**: `HttpOnly`, `SameSite=Lax`, `Secure` (production), 7-day
  expiry, `Path=/`. Rotated on every password change (see tokenVersion).
- **Stateless JWT** (HS256): payload `{ sub, role, officeId, email, tv, iat, exp }`.
  The `tv` claim mirrors `User.tokenVersion` and is checked on every request
  via `getAuthUser()`. Incrementing `tokenVersion` revokes all existing sessions
  instantly.
- **Logout revocation**: `POST /api/v1/auth/logout` clears the cookie **and**
  stores a SHA-256 hash of the session JWT in the `RevokedToken` table (7-day
  TTL mirroring the JWT expiry). The token hash is checked in `getAuthUser()`
  and in middleware (`src/middleware.ts`, Node.js runtime) before any protected
  page/API is served, so a logged-out session JWT is rejected with a redirect
  to `/login` even if it is still cryptographically valid. The stale cookie is
  cleared on that redirect.
- **Dummy hash timing**: failed logins run `bcrypt.compare()` against a fixed
  dummy hash so response time does not reveal account existence.
- **Generic error messages**: invalid credentials always return the same
  "Invalid email or password" text.

### Login / Registration Rate Limiting
| Bucket | Limit | Window | Scope | Response |
|---|---|---|---|---|
| Email (login) | 5 failures | 15 min | exact email | 429 + `Retry-After` |
| IP (login) | 20 attempts | 15 min | client IP | 429 (localhost skipped) |
| IP (register) | 10 attempts | 15 min | client IP | 429 (localhost skipped) |
| IP (reset redemption) | 5 attempts | 15 min | client IP | 429 |

Backed by a hybrid in-memory map + SQLite `LoginAttemptBucket` table. Safe for
single-instance deployments; the in-memory cache avoids a DB hit on every
request while the table provides durability across restarts.

### Password Reset (Admin-Initiated)
- No email delivery exists in this build. The reset flow is:
  1. Admin `POST /api/v1/admin/users/[id]/reset-password` → returns a **one-time**
     16-char hex code (30 min TTL, bcrypt-hashed at rest).
  2. Resident redeems at `/reset-password` via `POST /api/v1/auth/reset-password`
     (email + code + new password).
  3. Redemption runs inside a transaction: marks code `usedAt`, sets new
     `passwordHash`, increments `tokenVersion`, and deletes the email's
     login-failure bucket.
  4. Uniform error message ("Invalid or expired reset code") prevents
     user-enumeration.

### Authorization Model
| Role | Scope |
|---|---|
| ADMIN | All cases, all offices, all admin APIs |
| OFFICIAL | Only cases assigned to their own office; can reassign within their office or to another active office; cannot override priority/status on `RESOLVED`/`CLOSED` cases (409) |
| RESIDENT | Own cases only (read/write); cannot target other residents |

Guarded at middleware (`src/middleware.ts`) and re-checked server-side in every
API route via `requireUser()` / `requireRole()`.

### Input Validation
- All mutating endpoints validate with **Zod** (server-authoritative; client
  mirrors for UX).
- File uploads: **magic-byte sniffing** (JPEG/PNG/WebP only), 5 MB max, UUID
  filenames, stored outside web root, served through authenticated route with
  ownership checks.
- Upload quota: per-user daily byte budget (`uploads.daily_quota_bytes`,
  default 25 MiB) enforced before write via `UploadRecord` daily sum.

### HTTP Security Headers (Production)
| Header | Value |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Content-Security-Policy` | `default-src 'self'; base-uri 'self'; font-src 'self' data:; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'` |

CSP is emitted only in `NODE_ENV=production`.

### Logging & Correlation
- Every API request produces a JSON log line with a UUID `x-request-id`.
- Errors include the same ID in the response header and the log entry.
- Health endpoint is excluded from request logging.

### Data Integrity
- **Soft deletion**: users/offices/categories with historical references are
  deactivated (`isActive=false`), never hard-deleted. Delete APIs return `409`
  with the reference count.
- **Referential guards**: admin self-demotion, last-admin protection, and
  cascading reference checks all return `409` with explanation.
- **Lifecycle enforcement**: status transitions follow
  `SUBMITTED → ASSIGNED → IN_PROGRESS → RESOLVED → CLOSED` — skips, reversals,
  and repeats are rejected.

### Known Limitations / Trade-offs
- **No email infrastructure**: password reset is admin-only; residents who
  forget their password must contact an administrator.
- **Revocation table growth**: logout inserts a `RevokedToken` row (one per
  signed-out session token; each login issues a fresh JWT so each logout is a
  new row). Rows carry a 7-day expiry that mirrors the JWT lifetime, keeping
  the useful lifetime bounded; periodic cleanup of expired rows is left to an
  administrative job. If the JWT secret is rotated, all sessions are
  invalidated.
- **Single-instance rate limiting**: the in-memory cache assumes one process;
  a multi-instance deployment would need Redis or a shared store.
- **Build-time advisories**: `npm audit` reports 5 transitive vulnerabilities
  in `postcss` (bundled by Next.js) and `deepmerge-ts` (used by Prisma CLI).
  Fixes require breaking major upgrades (`next@16`, `prisma@6.12`) and are
  tracked but not applied.

### Verification Gate
Before any release candidate is tagged, the following clean-room gate is run:

1. `Remove-Item .next -Recurse -Force`
2. `npm run build` → EXIT=0, `.next/BUILD_ID` present
3. `npm run start` (port 3000 listener polled)
4. `npm run test` (Vitest unit suite, 41 tests)
5. `npx tsx scripts/smoke/run.ts` (full credential lifecycle + headers)
6. Server stopped, test artifacts cleaned, DB pristine