# BarangayResolve

Development of a web-based **Smart Community Concern Prioritization, Routing, and Resolution Management System** for barangays.

Residents submit community concerns online; the system categorizes them, computes a transparent rule-based priority score, routes each case to the appropriate barangay office, and lets officials process and resolve it — with a complete, auditable history that residents can track.

## Technology Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) + TypeScript |
| Database | PostgreSQL via Prisma ORM |
| Auth | Custom credentials + JWT (HttpOnly cookie) + bcrypt |
| Validation | Zod (client + server) |
| UI | Tailwind CSS v4 + custom design system + dependency-free SVG charts |
| Tests | Vitest unit suite + `tsx` live API/flow scripts |

> Authentication, roles, sessions, protected routes, **resident concern submission**, the **rule-based priority assessment engine** (auto-scoring, official override, admin-configurable rules), the **automatic routing engine** (category → office assignment, admin-configurable rules, office-scoped reassignment), the **official case-management workflow** (search/filter, status lifecycle, progress remarks, actions taken, resolution with date + attachment), **resident case tracking** (My Concerns list, detailed case page with lifecycle stepper, server-side ownership checks), **resident feedback** (resolved check, 1-5 rating, comment, duplicate protection), **role-based dashboards** (live database-driven figures and charts for residents, officials, and administrators), the **administrator management system** (accounts, officials, offices, concern categories, routing rules, priority rules, and key/value system settings — with historical-integrity guards), and the **in-app notification system** (event-driven notifications, unread/read state, related case links, mark-one/mark-all-as-read) are **implemented**. Reports are **not implemented yet** — they are built in the next development stage.

## Prerequisites

- Node.js 18.18+ (developed against Node 25)
- npm

On this machine npm is invoked as `npm.cmd` because PowerShell blocks the `npm.ps1` shim.

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
copy .env.example .env    # then edit .env: set DATABASE_URL to your PostgreSQL
                          # database (a free Neon Postgres instance works well)

# 3. Generate the Prisma client (also runs automatically after npm install)
npm run db:generate

# 4. Apply migrations (creates the full schema in your DATABASE_URL database)
npm run db:migrate        # for an existing project use: npx prisma migrate dev

# 5. Seed development/testing data
npm run db:seed

# 6. Run
npm run dev               # http://localhost:3000
```

## Available Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start the Next.js development server |
| `npm run build` | Production build (does not apply database migrations) |
| `npm run vercel-build` | Vercel build; production deploys apply pending migrations first |
| `npm run start` | Run the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript type-check (`tsc --noEmit`) |
| `npm run db:generate` | Regenerate the Prisma client |
| `npm run db:migrate` | Apply migrations (dev) |
| `npm run db:migrate:reset` | Reset the database + re-run migrations |
| `npm run db:seed` | Seed development/testing data |
| `npm run db:check` | Print a summary of the seeded data |
| `npm run db:studio` | Open Prisma Studio (browse the database) |
| `npm run db:validate` | Validate `prisma/schema.prisma` |
| `npm run email:retry` | Process due failed/pending SMTP deliveries once |
| `npm run android:sync` | Re-generate the Capacitor Android assets (config + plugin list) |
| `npm run android:apk` | Build a sideloadable **debug** APK (syncs Capacitor first) |
| `npm run android:apk:release` | Build a **release** APK (requires `android/keystore.properties`) |

## Building the Android APK

The APK is a thin Capacitor WebView: it does not bundle the site, it loads
`server.url` from `capacitor.config.ts` (currently
`https://barangayresolve.vercel.app`). Everything the APK needs to know lives in
`android/app/src/main/assets/capacitor.config.json`, which Capacitor only writes
when `npx cap sync android` runs — **so always build through the scripts below**,
never by running Gradle on its own:

```bash
npm run android:apk             # debug APK  -> android/app/build/outputs/apk/debug/app-debug.apk
npm run android:apk:release     # release APK -> android/app/build/outputs/apk/release/app-release.apk
```

Both scripts run `npx cap sync android` first and abort if the generated config
is missing. They also require `android/app/google-services.json` (see
[Push alerts on the phone](#push-alerts-on-the-phone)): an APK built without it
can never receive alerts, so that configuration is now a build failure rather
than a surprise on the phone. Keep the file out of the repository (it is
gitignored) and either drop it into `android/app/` or point the build at it:

```bash
npm run android:apk -- --push-config ../secrets/google-services.json
```

Building an alerts-less APK on purpose is possible with
`npm run android:apk -- --allow-missing-push`; the app then says on the Alerts
screen that this build cannot register, instead of failing silently.

Copy the APK to the phone and open it (allow *Install unknown apps* for your
file manager/browser).

### Release signing (recommended for updates you install over each other)

`android/app/build.gradle` signs release builds when `android/keystore.properties`
exists (gitignored). Create the keystore once:

```bash
keytool -genkeypair -v -keystore android/barangayresolve-release.jks \
  -alias barangayresolve -keyalg RSA -keysize 2048 -validity 10000
```

then create `android/keystore.properties`:

```properties
storeFile=barangayresolve-release.jks   # path relative to android/
storePassword=...
keyAlias=barangayresolve
keyPassword=...
```

Without that file, `assembleRelease` produces an *unsigned* APK that Android
refuses to install — use the debug APK instead.

### Bumping the version before you hand out an APK

Raise `versionCode` (and `versionName`) in `android/app/build.gradle` for every
APK you distribute. Android rejects an update whose `versionCode` is not higher
than the installed one.

### If the app opens to a blank/white screen

That means the APK was built without `capacitor.config.json` (Capacitor fell
back to the empty local bundle instead of the deployed site). Rebuild with
`npm run android:apk` — the script guarantees the config is packaged.

### If the app closes immediately (or shows a "could not start" screen)

The native shell reports startup failures on screen instead of closing silently,
so the message you see names the cause (for example a missing Capacitor config
or an exception during WebView setup).

The next launch also explains the previous one. Two records are shown when they
exist:

- a banner at the top of the app ("The app closed last time…") with the report,
  and
- **Alerts → Alert diagnostics**, which keeps the details and has a copy button.

Those cover the closes that never reach the app's own error handler: an
uncaught exception on a background thread, a WebView renderer failure (the shell
now reloads itself instead of letting Android kill the process), and Android's
own record of the last exit — a native crash, an ANR ("app not responding") or a
low-memory kill, which is read back from `ApplicationExitInfo`.

If nothing is recorded at all, capture Logcat over USB and look for
`FATAL EXCEPTION`:

```bash
adb logcat -c && adb logcat -d > crash.txt   # clear, open the app, then dump
```

### If the app shows "Push failed" (and/or closes right after opening)

The red banner at the bottom prints the reason this phone could not register for
push alerts. Open **Alerts → Alert diagnostics** and press *Copy diagnostics* to
get the full text; it reports three independent things:

| Report | Meaning | Fix |
| --- | --- | --- |
| `google-services.json packaged: unknown` / native rows show `old APK` | The APK on the phone was built before the app could report its push state, so nothing native can be read from it | Reinstall the latest APK — build it with `android/app/google-services.json` in place (`npm run android:apk -- --push-config …`) |
| `google-services.json packaged: no` | The APK has no Firebase project | Rebuild with `android/app/google-services.json` in place (the build script now refuses to skip this) |
| `Firebase started: no` | The file's package name does not match `com.barangayresolve.app` | Re-download it from the Firebase console for that package |
| `Last push error: …SERVICE_NOT_AVAILABLE…` | The phone could not reach Firebase (no connection, no/outdated Google Play services, or a Google-account restriction) | Fix the phone's network/Play services, then press *Refresh* |
| `Server has FCM credentials: no` | The phone is fine, but the **server** is missing `FIREBASE_SERVICE_ACCOUNT` (`FIREBASE_SERVICE_ACCOUNT_PATH`), so it cannot send anything | Set the variable on the deployment and redeploy |
| `…already registered to another account` | Another account on this phone owned the token | Sign out of that account and register again |

An APK whose build has no Firebase project will not kill the app any more: it
reports the problem instead. The Capacitor `PushNotifications.register()` call,
which throws an unhandled exception on such a build, is only used as a fallback
for APKs older than this one.

### If Android says "App not installed"

The APK is signed with a different key than the app already on the phone (or the
`versionCode` is too low). Uninstall the old app first, then install the new
APK; from then on keep using the same keystore so updates install in place.

## Environment Variables

See `.env.example`. The only required variable is `DATABASE_URL`, a PostgreSQL connection string (for example `postgresql://user:password@host:5432/barangayresolve`, or a Neon connection string).

### Web Push

For browser push, generate VAPID keys with `npx web-push generate-vapid-keys`,
then set `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, and `VAPID_PRIVATE_KEY`. Users
must open the Alerts page and choose **Enable phone alerts**. Browser push remains
available as a silent visual notification; the web page does not play an alarm.
Sound and vibration alarms are handled by the native app. Browser/OS policy
still controls delivery when the browser is closed.

### Native Android APK Alerts

The APK uses high-priority, data-only FCM messages and a native foreground
service for the alert tone, vibration, and popup. Configure
`android/app/google-services.json` for package `com.barangayresolve.app` (the
build script refuses to produce a push-less APK without
`--allow-missing-push`, and `--push-config <path>` copies the file in from
wherever you keep it), and configure the server with
`FIREBASE_SERVICE_ACCOUNT` (the service-account JSON string; use this for
serverless deployments) or `FIREBASE_SERVICE_ACCOUNT_PATH` on a server that can
read that file. Registration happens inside the app's own code
(`AlertBridge.requestPushToken()`), which catches every failure; the Capacitor
plugin is only a fallback for older APKs. Users must sign in, enable phone alerts,
and allow Android notification and alert-display permissions. Android 14+
full-screen lock-screen popups require the corresponding special access.

This works only while the phone is powered on and connected. An APK cannot
receive FCM or turn on a phone that is completely powered off. Android battery
policies, a force-stop, notification/channel settings, Do Not Disturb, and
manufacturer-specific background restrictions can also delay or suppress an
alert. A provider accepting a push request is not proof that the phone received
it. The admin composer reports provider acceptance/failure counts for this
reason.

Back up the production database before a schema-change release. Production
Vercel builds run `prisma migrate deploy` before building the app, so new schema
changes are applied before code that depends on them is published.
Set `DATABASE_URL` in Vercel, and set `DIRECT_URL` too if the provider requires a
non-pooled connection for migrations. Preview deployments intentionally skip
migrations so they cannot change a shared production database. For a non-Vercel
deployment, back up the database and run `npx prisma migrate deploy` as a
release step before deploying the new code. The office migration normalizes
existing null contacts to empty strings. Office map and address fields have been
removed from the admin workflow; a follow-up migration removes the unused map
columns while preserving migration history.

When several system alerts are queued, users can acknowledge them one at a time
or record acknowledgment for all queued alerts in one action.

### Email Retry Scheduling

SMTP delivery failures are stored in `EmailDelivery` and retried up to five
times. Schedule `npm run email:retry` every minute with Windows Task Scheduler,
cron, or a container scheduler. Hosted deployments can instead send a `POST`
request to `/api/v1/cron/email-deliveries` every minute with:

```text
Authorization: Bearer $CRON_SECRET
```

The endpoint returns `401` without the configured `CRON_SECRET`.

## Demo Accounts (seeded — development/testing only)

All seeded passwords: `BarangayResolve123!`

| Email | Role |
|---|---|
| `admin@barangayresolve.dev` | Administrator |
| `official.infra@barangayresolve.dev` | Official — Infrastructure |
| `official.infra2@barangayresolve.dev` | Official — Infrastructure (second member) |
| `official.env@barangayresolve.dev` | Official — Environment & Sanitation |
| `official.env2@barangayresolve.dev` | Official — Environment & Sanitation (second member) |
| `official.peace@barangayresolve.dev` | Official — Peace and Order |
| `official.secretary@barangayresolve.dev` | Official — Secretary |
| `official.health@barangayresolve.dev` | Official — Health |
| `resident@barangayresolve.dev` | Resident |

## Database Schema

15 relational tables managed by Prisma migrations in `prisma/migrations/`:

- `Role`, `Office`, `User` — roles, barangay offices, and users
- `ConcernCategory`, `RoutingRule` — categories and configurable routing rules
- `Concern` — the case record (case number, status, priority, assignments)
- `PriorityAssessment` — factor scores + total + level for every (re-)assessment
- `CaseAssignment` — full assignment/reassignment history (self-referencing chain)
- `CaseStatusHistory` — append-only journal of every status change, remark, resolution, and override
- `ResolutionRecord` — final resolution information (one per concern)
- `PriorityConfig` — runtime-configurable priority score thresholds
- `PriorityFactorConfig` — runtime-configurable scoring factors (label, weight, score range)
- `Notification`, `Feedback`, `Audit` — notifications, post-resolution feedback, and the audit log

Status flow: `SUBMITTED → ASSIGNED → IN_PROGRESS → RESOLVED → CLOSED`.

## API Structure

REST endpoints live under `src/app/api/v1/`. All routes return a consistent
`{ success, data | error }` JSON envelope via the helpers in `src/lib/api.ts`
(`ApiError`, `ok()`, `handleError()`, `parseBody()`, `withErrorBoundary()`).

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/health` | Public | Readiness check (API + database) |
| POST | `/auth/register` | Public | Create a RESIDENT account + start session |
| POST | `/auth/login` | Public | Authenticate and set the session cookie |
| POST | `/auth/logout` | Authenticated | Clear the session cookie and revoke the JWT server-side |
| GET | `/auth/me` | Authenticated | Return the current user |
| PATCH | `/auth/profile` | Authenticated | Update the caller's own profile |
| PATCH | `/auth/password` | Authenticated | Change the caller's own password |
| POST | `/concerns` | RESIDENT | Submit a concern (multipart, required proof image) + auto-assess priority + auto-route |
| GET | `/concerns` | OFFICIAL / ADMIN | Search/filter the case queue (officials see only their office) |
| POST | `/concerns/[id]/priority` | OFFICIAL / ADMIN | Override a concern's priority (re-rate factors and/or set a level) |
| GET | `/concerns/[id]/assignments` | Assigned office / ADMIN | Read a concern's assignment history |
| POST | `/concerns/[id]/assignments` | Assigned office / ADMIN | Assign or reassign a concern to an office (and optional official) |
| POST | `/concerns/[id]/status` | Assigned office / ADMIN | Advance the case status (in progress / resolved / closed) |
| POST | `/concerns/[id]/resolutions` | Assigned office / ADMIN | Record a resolution (summary, action taken, type, resolution date, optional attachment) and mark the case resolved |
| POST | `/concerns/[id]/notes` | Assigned office / ADMIN | Append a progress remark or an action-taken entry |
| GET | `/concerns/[id]/feedback` | RESIDENT (owner) | Read the resident's own feedback for a case |
| POST | `/concerns/[id]/feedback` | RESIDENT (owner) | Rate a resolved/closed case (resolved check, 1-5 rating, optional comment) |
| GET | `/admin/users` | ADMIN | List accounts (`?q=`, `?role=`, `?status=active\|disabled`) |
| POST | `/admin/users` | ADMIN | Create a resident/official/admin account |
| PATCH | `/admin/users/[id]` | ADMIN | Update profile, role/office, password, or account status |
| DELETE | `/admin/users/[id]` | ADMIN | Delete an account with no historical references (guarded) |
| GET | `/admin/offices` | ADMIN | List offices with reference counts (`?q=`, `?status=`) |
| POST | `/admin/offices` | ADMIN | Create an office |
| PATCH | `/admin/offices/[id]` | ADMIN | Update / enable / disable an office |
| DELETE | `/admin/offices/[id]` | ADMIN | Delete an unreferenced office (guarded) |
| GET | `/admin/concern-categories` | ADMIN | List categories with reference counts (`?q=`, `?status=`) |
| POST | `/admin/concern-categories` | ADMIN | Create a concern category |
| PATCH | `/admin/concern-categories/[id]` | ADMIN | Update / enable / disable a category |
| DELETE | `/admin/concern-categories/[id]` | ADMIN | Delete an unreferenced category (guarded) |
| GET | `/admin/settings` | ADMIN | List key/value settings (+ feedback flag) |
| POST | `/admin/settings` | ADMIN | Create a setting (`{ key, value }`) |
| PUT | `/admin/settings` | ADMIN | Upsert a setting (`{ key, value }`) |
| DELETE | `/admin/settings?key=` | ADMIN | Delete a setting (reverts to its default) |
| GET | `/dashboard/resident` | RESIDENT | Live totals, recent concerns, and notifications for the signed-in resident |
| GET | `/dashboard/official` | OFFICIAL / ADMIN | Office-scoped counts, recently resolved list, and filterable case list |
| GET | `/dashboard/admin` | ADMIN | System-wide aggregates (status/category/office/priority) and processing-time stats |
| GET | `/notifications` | Authenticated | List the caller's notifications with related case (`?unread=true`, `?concernId=`, `?limit=`) + unread count |
| PATCH | `/notifications/[id]` | Authenticated (owner) | Mark one of the caller's notifications read/unread (records `readAt`) |
| POST | `/notifications/read-all` | Authenticated | Mark all of the caller's unread notifications as read |
| GET | `/admin/priority-config` | ADMIN | Read the priority factor/threshold configuration |
| PUT | `/admin/priority-config` | ADMIN | Replace the priority factor/threshold configuration |
| GET | `/admin/routing-rules` | ADMIN | List routing rules (`?active=true` for active only) |
| POST | `/admin/routing-rules` | ADMIN | Create a routing rule (category → office + priority) |
| PUT | `/admin/routing-rules/[id]` | ADMIN | Update / enable / disable a routing rule |
| DELETE | `/admin/routing-rules/[id]` | ADMIN | Delete a routing rule (pure configuration) |
| GET | `/uploads/[filename]` | Owner / assigned office / ADMIN | Serve a stored concern image |

## Authentication & Authorization

- **Registration** creates RESIDENT accounts only; official/admin accounts are
  provisioned by administrators from `/admin/users` (and `/admin/officials`).
- **Login** issues a signed JWT (HS256, 7-day expiry) stored in an
  `HttpOnly`, `SameSite=Lax` cookie. Passwords are hashed with bcrypt (12
  rounds) — plain text is never stored.
- **Passwords** must be at least 8 characters with a lowercase letter,
  uppercase letter, and number (validated on client and server with Zod).
- **Invalid logins** return a generic "Invalid email or password" message and
  run a dummy hash comparison so response timing does not reveal whether an
  account exists.
- **Protected routes** are enforced by `src/middleware.ts` and re-checked
  server-side by `requireUser()` / `requireRole()` in pages:
  - `/resident` → RESIDENT only
  - `/official` → OFFICIAL (ADMIN may also view)
  - `/admin` → ADMIN only
  - `/profile` → any authenticated user
  - `/notifications` → any authenticated user (records are always scoped to the session user)
- Residents can only read and update their own profile; they can never target
  another user's record (the API scopes updates to the session user's id).
- **Auditing:** registration, login success/failure, logout, profile changes,
  and password changes are written to the `Audit` table.

> **Forgot password is intentionally not implemented** in this stage: the
> stack has no email delivery configured, so a reset link cannot be sent. It
> will be added once an email/messaging integration is chosen.

## Login Rate Limiting & Password Reset

- **Login & registration** are throttled per email (5 failures / 15 min) and
  per IP (20 login / 15 min, 10 register / 15 min). Localhost IPs skip the IP
  bucket. Exhausting the email bucket returns `429 Too Many Requests` with a
  `Retry-After` hint and a structured error body.
- **Admin-initiated password reset** replaces the missing email flow:
  an administrator generates a one-time, 16-char hex code (30-min TTL) via
  `POST /api/v1/admin/users/[id]/reset-password`. The resident redeems it at the
  public `/reset-password` page with `POST /api/v1/auth/reset-password` (email +
  code + new password). Redemption is throttled per IP (5 / 15 min) and
  intentionally returns a uniform "Invalid or expired reset code" message — no
  user-enumeration signal.
- **Session invalidation on password change:** every password change (self-service,
  admin set, or reset redemption) increments `User.tokenVersion`. The new JWT
  carries the bumped version; all previously issued sessions are rejected
  immediately by `getAuthUser()`. Self password change re-issues a fresh token so
  the current device stays signed in.
- **Logout revocation:** `POST /api/v1/auth/logout` clears the session cookie and
  stores a SHA-256 hash of the JWT in the `RevokedToken` table (7-day TTL matching
  the token expiry). `getAuthUser()` and the middleware both consult this table, so
  a logged-out token is rejected (redirect to `/login`) even while it remains
  cryptographically valid, and the stale cookie is cleared on that redirect. This
  also stops the browser-back "restore logged-in page" behavior after signing out.

## Resident Concern Submission

Residents submit concerns from `/resident/concerns/new` (title, category,
description, location, required proof image) and are redirected to the case details
page (`/resident/concerns/[id]`) with a success message on completion.

On submission the server, inside a single transaction:

1. Generates a unique, human-readable case number `BR-YYYYMMDD-NNNN`
   (per-day sequence, retried on the unique constraint).
2. Runs the rule-based priority engine on the resident's factor ratings and
   stores the resulting level/total on the `Concern`.
3. Stores the required proof image and creates the `Concern` with status `SUBMITTED`.
4. Appends the initial `CaseStatusHistory` entry (`null → SUBMITTED`) and a
   `PRIORITY_ASSESSED` history entry.
5. Creates an initial `PriorityAssessment` (the automated, non-override
   assessment) with the full calculation snapshot.
6. Routes the concern through the routing engine (see *Automatic Routing
   Engine*): on a match it creates the `CaseAssignment`, sets the assigned
   office, advances the status to `ASSIGNED`, and notifies every official in
   the office; with no active rule it stays `SUBMITTED` and administrators are
   notified for manual routing.
7. Creates an initial `Notification` for the resident (including the
   preliminary priority level and, when routed, the responsible office).
8. Records a `CONCERN_ROUTED`/`CONCERN_SUBMITTED` audit entry.

**Validation** (Zod, server-authoritative; mirrored client-side for UX):
title 5–150, description 10–2000, location 3–255, an existing *active*
category, and the four factor ratings (must fall within the configured
range). Residents may only submit as themselves and may only view their own
cases — requests for another resident's case return 404.

**Image uploads** are optional and validated by real content (magic bytes),
not just the declared MIME type: JPEG/PNG/WebP only, max 5 MB. Files are
stored under `UPLOAD_DIR` (default `<project>/uploads`, git-ignored) with a
random UUID filename; executables, SVG, and type-mismatched files are
rejected. Images are served through `GET /api/v1/uploads/[filename]`, which
requires a session and allows only the owner, the assigned office's officials,
or an ADMIN.

## Per-User Daily Upload Quota

A configurable daily upload limit protects disk space. The setting
`uploads.daily_quota_bytes` (default `26214400` = 25 MiB) is enforced in
`saveConcernImage()` before writing the file — it sums the resident's
`UploadRecord` bytes for the current calendar day and rejects the upload with
`413 Payload Too Large` when the limit would be exceeded. The same logic
applies to resolution attachments. `UploadRecord` rows are cleaned up when
images are deleted.

## Security Headers (Production)

`next.config.ts` serves a fixed set of hardening headers on every response:

| Header | Value |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Content-Security-Policy` | `default-src 'self'; base-uri 'self'; font-src 'self' data:; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'` |

CSP is emitted only when `NODE_ENV=production` (Next.js RSC requires
`script-src 'unsafe-inline'` for the inline module loader).

## Structured Logging & Correlation IDs

All API requests are logged as JSON lines to stdout with a unique
`x-request-id` (UUID v4). Errors include the same correlation ID in the
response header and the log entry, enabling end-to-end traceability:

```json
{
  "level": "info",
  "message": "API request",
  "requestId": "a1b2-c3d4...",
  "method": "POST",
  "path": "/api/v1/auth/login",
  "status": 200,
  "durationMs": 12,
  "ip": "127.0.0.1"
}
```

Health checks (`/api/v1/health`) are intentionally omitted from the request log
to reduce noise.

## Accessibility (WCAG 2.1 AA)

- All form controls have associated `<label>` elements or `aria-label` (fixed
  in `admin-filter-bar.tsx`, `routing-rules-manager.tsx`).
- Every submit button is disabled during the fetch, preventing double
  submissions and giving screen-reader users clear state.
- Focus-visible styles are provided by Tailwind; no custom focus outlines were
  removed.
- No `tabindex` hacks; natural DOM order is preserved.

## Tests

- **Unit tests (Vitest):** 41 tests across 6 files covering the priority engine,
  workflow transitions + permissions, case validations (real calendar date
  validation), auth schemas (password policy, reset code bounds), and the query
  parsers for concerns and notifications. Run with `npm run test`.
- **Live HTTP smoke scripts (`tsx`):** `scripts/smoke/run.ts` exercises the
  full credential lifecycle against a running production server — health,
  security headers, login throttling (5×401→429), the admin reset cycle (code
  generation → redemption → old session revoked → old password rejected → new
  password works → second redeem rejected), and self password change keeping the
  session. Run with `npx tsx scripts/smoke/run.ts` (requires a server on
  `SMOKE_BASE_URL`).

## Environment Variables (additions)

| Variable | Default | Description |
|---|---|---|
| `uploads.daily_quota_bytes` | `26214400` (25 MiB) | Per-user daily upload byte budget; set via `/admin/settings` (key `uploads.daily_quota_bytes`) |

## Production Build Verification

A clean production build (`Remove-Item .next -Recurse -Force` → `npm run build`)
must exit `0` and produce a `.next/BUILD_ID`. The build is then started
(`npm run start`), the listener on port 3000 is polled, and the full smoke
suite passes. This gate is run after every batch of changes.

## Priority Assessment Engine

Priority is computed by a **transparent, rule-based** engine (not machine
learning or AI). Residents rate four factors when submitting; the engine
multiplies each rating by an administrator-configured weight, sums them into a
total score, and maps that total to a priority level.

- **Default factors** (weight `1` each, scores `1`–`5`): `URGENCY`, `IMPACT`,
  `AFFECTED_POPULATION`, `SAFETY` → defaults produce a total of `4`–`20`.
- **Default thresholds:** LOW `4`–`8`, MEDIUM `9`–`12`, HIGH `13`–`16`,
  CRITICAL `17`–`20`.
- **Admins** configure factor labels/weights/score ranges and the thresholds at
  `/admin/priority` (API: `GET`/`PUT /api/v1/admin/priority-config`). A
  configuration is rejected unless thresholds are contiguous and cover the
  full possible score range implied by the factors.
- **Officials** review the full breakdown (per-factor score × weight,
  total, matched threshold) at `/official/concerns/[id]` and may **override**
  the priority — either by re-rating factors or by choosing a level directly —
  with a **mandatory reason** (API: `POST /api/v1/concerns/[id]/priority`).
- **Immutability:** the original automated `PriorityAssessment`
  (`isOverride=false`, `assessedById=null`) is never edited. Each override
  appends a new assessment (`isOverride=true`) and updates the concern, writes
  a `PRIORITY_OVERRIDE` history entry, notifies the resident, and records an
  audit entry. Residents see the latest assessment plus the override reason on
  their case details page.
- Enum-like factor keys and levels are stored as strings and validated in
  `src/lib/priority/engine.ts` (the schema keeps value sets application-defined
  rather than DB-enforced).

## Automatic Routing Engine

After a concern has been assessed, a **transparent, database-driven routing
engine** determines the responsible barangay office from
administrator-configured rules. Office assignment is never hard-coded in the
UI.

- **Routing rules** map a concern category to an office with a `priorityOrder`
  and an `isActive` flag. Admins manage them at `/admin/routing` (API:
  `GET`/`POST /api/v1/admin/routing-rules`, `PUT /api/v1/admin/routing-rules/[id]`).
- **Rule selection** (pure function in `src/lib/routing/engine.ts`): among the
  category's **active** rules that point at an **active** office, the one with
  the lowest `priorityOrder` wins (ties break on lowest id). A disabled rule or
  a rule pointing at an inactive office is skipped, so a lower-priority fallback
  rule can still match.
- **On a match** the engine, inside the submission transaction, creates a
  `CaseAssignment` (with `assignedById = null` — i.e. system-generated), stores
  the assigned office on the concern, advances `SUBMITTED → ASSIGNED` (recording
  an `ASSIGNMENT` history entry), and notifies **every** official in that office.
- **No matching rule is never a blocker:** the concern stays `SUBMITTED` with no
  office, an explanatory `REMARK` history entry is written, and all
  administrators receive a `CONCERN_UNROUTED` notification so the case can be
  routed manually.
- **Reassignment** is done from the official case page (`ReassignForm`, API:
  `POST /api/v1/concerns/[id]/assignments`). It appends a new `CaseAssignment`
  linked to the previous one via `prevAssignmentId`, marks the previous
  assignment `isCurrent = false`, updates the concern's office, writes an
  `ASSIGNMENT` history entry with the reason, notifies the destination office's
  officials and the resident, and **never regresses** a concern that has already
  progressed past `ASSIGNED`.
- **Authorization:** an OFFICIAL may only reassign a concern their own office
  already owns (or one that is still unassigned); ADMIN may reassign any case.
  The target office must be active, and an optional target official must be an
  active OFFICIAL in that office.
- **Residents** see the responsible office (and assignment date) on their case
  list and details page, or an “Awaiting office assignment” state when no rule
  matched.

## Official Case Management

Officials work their office's caseload from `/official/concerns` (search and
filters) and `/official/concerns/[id]` (full case file plus workflow actions).
Administrators can view and act on any office's cases.

- **Scoping:** officials only see and mutate cases assigned to their own
  office; administrators may act on any case (including unrouted ones). The
  list API forces the office scope server-side, so it cannot be widened with a
  query parameter. The same rule guards direct reads and writes: the case
  detail page, the assignment-history endpoint, and the priority-override and
  status/notes/resolution endpoints all return `404` (reads) or `403` (writes)
  when an official targets another office's case.
- **Search and filters:** free-text search across case number, title,
  description, location and resident name/email; filters for status, priority,
  category, office (admin) and submission date range (interpreted in
  Asia/Manila).
- **Status lifecycle:** `ASSIGNED → IN_PROGRESS → RESOLVED → CLOSED` (with
  `SUBMITTED → ASSIGNED` performed by the routing/assignment services). A single
  transition map validates every move, so steps cannot be skipped, repeated,
  reversed, or applied to a closed case.
- **Journaling:** every status change writes a `CaseStatusHistory` row with the
  previous status, new status, acting user and role, remarks and timestamp.
  Resolving also creates the unique `ResolutionRecord` (summary, actions taken,
  resolution type) and sets `resolvedAt`; closing sets `closedAt`.
- **Progress remarks and actions taken:** additive journal entries (`REMARK` and
  `ACTION`) that record work without changing the status. Closed cases reject
  further changes.
- **Resident notifications:** the in-progress, resolved and closed transitions
  each notify the resident.

## Resident Case Tracking

Residents follow their submitted cases from `/resident/concerns` (My Concerns)
and `/resident/concerns/[id]` (case details).

- **My Concerns list:** shows case number, title, category, priority, assigned
  office, date submitted, last update and current status for every concern the
  resident submitted.
- **Case details:** the case file plus a **lifecycle stepper** showing the
  `SUBMITTED → ASSIGNED → IN PROGRESS → RESOLVED → CLOSED` stages and the date
  each one was reached, and a **journal timeline** with every status change,
  progress remark, action taken and the resolution details with dates.
- **Authorization:** the detail page is fetched with the logged-in resident's
  id, so a resident can never open another resident's case — even by changing
  the URL or case id it returns `404`, leaking nothing. Anonymous visitors are
  redirected to login, and non-resident roles are redirected to their own
  homes. Residents are also blocked (403) from the official/administrator case
  APIs. Access control is enforced server-side; nothing is hidden by the
  frontend alone.

## Resolution Management & Resident Feedback

Officials resolve cases from the case-management card with a dedicated
multipart form (`/concerns/[id]/resolutions`) that records the **action taken**,
**resolution description**, **resolution type**, **resolution date** (defaults
to today, cannot be in the future) and an optional **supporting attachment**
(JPEG/PNG/WebP, ≤5 MB). Resolving is one atomic transaction that:

1. advances the status to `RESOLVED` (and sets `resolvedAt`),
2. writes a `RESOLUTION` history entry with the actor, remarks and timestamp,
3. records the `ResolutionRecord` (unique per case),
4. notifies the resident, and
5. renders the resolution — summary, actions, date and attachment — on the
   resident's case page (and on the official's page).

The attachment is served through the authenticated uploads endpoint with the
same ownership rules as concern images: the resident owner, the assigned
office, and administrators; everyone else gets `403`.

After resolution, residents rate their own case: **was the concern resolved?**
(`wasResolved`), a **1-5 satisfaction rating** (mapped to
`SATISFIED`/`NEUTRAL`/`DISSATISFIED`), and an **optional comment**. Feedback is
always stored against the correct case (`concernId` unique, `userId` = case
owner) and only the owner may read or submit it (other residents get `404`).
Feedback is only accepted once the case is `RESOLVED` or `CLOSED`.

Duplicate feedback is prevented by default: a second submission is rejected
with `409`. An administrator can explicitly **allow feedback revision** from
`/admin/settings`; when enabled, the resident's new submission updates the same
row in place, so a case never accumulates multiple feedback entries.

## Role Dashboards

Each role lands on a dashboard whose figures are **computed live from the
database** on every request — there are no stored or hard-coded statistics, so
the numbers (and the charts drawn from them) change as soon as records do.

- **Resident** (`/resident`): total, active, and resolved concern counts for the
  signed-in resident, a "Recent concerns" list, and the latest notifications
  with an unread count. A **Submit concern** action is always available.
- **Official** (`/official`): office-scoped **assigned**, **pending**,
  **high-priority**, and **in-progress** case counts; a **recently resolved**
  list; and the same **search/filter** tools as the case queue (keyword,
  status, priority, category, office, date) that drive an inline result table.
  Officials are locked to their own office; administrators viewing this page
  see the whole system (or a selected office).
- **Administrator** (`/admin`): system-wide totals with **cases by status**
  (donut), **cases by category**, **cases by office**, and **cases by
  priority** (bar charts), the resolved/unresolved split, and **processing-time
  statistics** (average, fastest, slowest) computed only from cases that have
  reliable timestamps — both a submission time and a recorded resolution time.
  Cases without a resolution timestamp are excluded from that measurement and
  reported as not yet resolved.

The charts are dependency-free SVG/CSS components (`DonutChart`, `BarChart`)
built from the same arrays returned by the dashboard queries, so the legend and
the drawing can never disagree with the data.

## Administrator Management

Administrators configure the whole system from the `/admin` area. Every page
supports search/filtering and every create, update, enable/disable and delete
action is confirmed and written to the `Audit` log.

- **Accounts** (`/admin/users`): create RESIDENT/OFFICIAL/ADMIN accounts, edit
  profiles, reset passwords, change role/office, and enable/disable access.
- **Officials** (`/admin/officials`): a focused view for OFFICIAL accounts, where
  each official is linked to an active office.
- **Offices** (`/admin/offices`): create and maintain the offices that receive
  routed concerns (name, code, description, head officer, and contact details).
- **Concern categories** (`/admin/categories`): create and maintain the
  categories residents choose when submitting, and that routing rules map.
- **Routing rules** (`/admin/routing`): map category → office with a priority
  order; rules can be enabled, disabled, edited, deleted, and filtered.
- **Priority rules** (`/admin/priority`): tune factor labels/weights/score
  ranges, toggle individual factors on/off, and edit the level thresholds.
- **System settings** (`/admin/settings`): a generic key/value store, plus the
  resident-feedback re-submission toggle.

### Historical integrity (soft deletion)

Records that appear in the case history are never hard-deleted: a user who
submitted, handled, resolved, or acted on a case; an office a case was routed
to; or a category a case used. The API **refuses** such a delete with `409` and
tells the administrator to **deactivate** the record instead (`isActive=false`),
so residents never see a blank author/office/category and every historical
record keeps its meaning. Only records with **zero** references — and pure
configuration such as routing rules and settings — can be permanently deleted.

Guardrails that protect system integrity:

- An administrator **cannot disable or delete their own account**, nor change
  their own role.
- The system **cannot be left without an active ADMIN**: demoting or disabling
  the last active administrator returns `409`.
- Deleting a user/office/category returns `409` with the reference count when
  any historical record points at it (the UI dialog explains this and suggests
  deactivating).

## Notification System

Every notification is generated server-side from a real domain event — never
inserted as a free-form frontend message. Creation is centralized in
`src/lib/notifications/service.ts`, which the routing, case-workflow, priority,
and concern-submission code all call inside their existing transactions, so a
notification and the event that produced it commit together.

| Event | Type | Recipient |
|---|---|---|
| Concern submitted | `CONCERN_SUBMITTED` | Submitting resident |
| Concern auto-routed / manually assigned | `CONCERN_ASSIGNED` | Officials of the assigned office (+ resident on manual assignment) |
| Concern reassigned | `CONCERN_REASSIGNED` | Officials of the new office (+ resident) |
| No routing rule matched | `CONCERN_UNROUTED` | All active administrators |
| Status advanced | `STATUS_CHANGED` | Concern owner |
| Resolution recorded | `CONCERN_RESOLVED` | Concern owner |
| Feedback invited | `FEEDBACK_REQUESTED` | Concern owner |
| Case closed | `CASE_CLOSED` | Concern owner |
| Priority overridden | `PRIORITY_CHANGED` | Concern owner |

The inbox at `/notifications` (linked from the header with a live unread badge,
from each sub-navigation, and from the resident dashboard) lists notifications
newest first with title, message, timestamp, read/unread state, and a link to
the related case. Users can filter All/Unread, toggle an individual
notification read/unread, and mark all as read. Every query is scoped to the
session user; attempting to read or modify another user's notification returns
`404`.

## Cookie Security

The session cookie is `Secure` by default in production. Because running
`npm run start` locally serves over plain HTTP, set
`SESSION_COOKIE_SECURE="false"` in `.env` for local production-build testing
(already the default in the provided `.env`). Always use `true` on HTTPS.

## Project Structure

```
prisma/
  schema.prisma      # full ERD
  seed.ts            # development/testing seed
  migrations/        # generated migration history
src/
  middleware.ts      # route protection + role gates
  app/
    layout.tsx       # app shell with session-aware header
    page.tsx         # landing page
    login/page.tsx   # login
    register/page.tsx# resident registration
    profile/page.tsx # own profile + password
    notifications/page.tsx # event-driven notifications inbox
    resident/
      layout.tsx     # resident sub-nav + role guard
      page.tsx       # resident dashboard (totals + recent + notifications)
      concerns/page.tsx        # My Concerns table (priority + last update)
      concerns/new/page.tsx    # submit concern
      concerns/[id]/page.tsx   # case details + status stepper + timeline + resolution
    official/
      layout.tsx     # official sub-nav + role guard
      page.tsx       # official dashboard (counts + recently resolved + search/filter)
      concerns/page.tsx        # office case queue with search + filters
      concerns/[id]/page.tsx   # case file + workflow/notes + override + assignment + timeline
    admin/
      layout.tsx     # admin sub-nav + role guard
      page.tsx       # admin dashboard (aggregates + charts + processing time)
      users/page.tsx           # account management (create/edit/status/delete)
      officials/page.tsx       # official accounts
      offices/page.tsx         # office management
      categories/page.tsx      # concern category management
      priority/page.tsx        # priority rules configuration
      routing/page.tsx         # routing rules configuration
      settings/page.tsx        # system settings + feedback re-submission
    error.tsx / global-error.tsx / not-found.tsx
    api/v1/
      health/route.ts
      auth/{register,login,logout,me,profile,password}/route.ts
      concerns/route.ts              # GET search/filter queue + POST submit (multipart)
      concerns/[id]/priority/route.ts# POST official/admin priority override
      concerns/[id]/assignments/route.ts # GET history + POST assign/reassign
      concerns/[id]/status/route.ts  # POST official/admin status transition
      concerns/[id]/notes/route.ts   # POST progress remark / action taken
      concerns/[id]/resolutions/route.ts # POST resolve (multipart, date + attachment)
      concerns/[id]/feedback/route.ts # GET/POST resident feedback
      dashboard/resident/route.ts    # GET resident dashboard figures
      dashboard/official/route.ts    # GET office-scoped figures + filtered list
      dashboard/admin/route.ts       # GET system-wide aggregates
      notifications/route.ts         # GET caller's notifications + unread count
      notifications/[id]/route.ts    # PATCH mark one read/unread (owner only)
      notifications/read-all/route.ts# POST mark all read
      admin/users/route.ts           # GET list + POST create accounts (ADMIN)
      admin/users/[id]/route.ts      # PATCH update/status + DELETE guarded (ADMIN)
      admin/offices/route.ts         # GET list + POST create offices (ADMIN)
      admin/offices/[id]/route.ts    # PATCH update/status + DELETE guarded (ADMIN)
      admin/concern-categories/route.ts    # GET list + POST create (ADMIN)
      admin/concern-categories/[id]/route.ts # PATCH + DELETE guarded (ADMIN)
      admin/priority-config/route.ts # GET/PUT priority rules (ADMIN)
      admin/routing-rules/route.ts   # GET/POST routing rules (ADMIN)
      admin/routing-rules/[id]/route.ts # PUT + DELETE routing rule (ADMIN)
      admin/settings/route.ts        # GET/POST/PUT/DELETE settings (ADMIN)
      uploads/[filename]/route.ts    # authenticated image serving (concern + resolution)
  components/
    ui/              # Button, Card, Badge, Field, Container, ...
    auth/            # forms, logout button
    concern/         # submit form, case timeline journal + stepper
    priority/        # breakdown view, override form
    routing/         # reassignment form
    cases/           # case filters, workflow form, resolution form, note form, feedback, status stepper
    dashboard/       # stat cards, dependency-free bar + donut charts
    notifications/   # notifications inbox (list, filter, read toggles)
    admin/           # user/office/category/settings managers, filter bar,
                     # priority + routing rule configuration
  lib/
    db.ts            # Prisma singleton
    api.ts           # API error handling + response helpers
    api-client.ts    # typed client fetch wrapper
    audit.ts         # audit recording
    case-number.ts   # BR-YYYYMMDD-NNNN generator
    uploads.ts       # image validation + safe storage
    format.ts        # date/time formatting (Asia/Manila)
    validation-errors.ts
    validations/auth.ts
    validations/concern.ts
    validations/priority.ts
    validations/routing.ts
    validations/case.ts      # workflow, feedback, settings schemas
    validations/admin.ts     # account/office/category/setting schemas
    validations/notification.ts # notification read/unread schema
    admin/
      query.ts       # admin list queries, filters, reference counts, views
    notifications/
      service.ts     # centralized event-driven notification creation
      query.ts       # notification queries, read state, serializers
    priority/
      engine.ts      # pure rule engine (scoring + configuration validation)
      config.ts      # load/save priority configuration
    routing/
      engine.ts      # pure routing rule selection
      service.ts     # auto-route + reassign domain service
      config.ts      # load routing rules
    cases/
      workflow.ts    # pure status map + manage-permission + feedback logic
      service.ts     # status change / notes / resolution domain service
      feedback.ts    # resident feedback domain service
      query.ts       # case search + filter where-builder
      settings.ts    # app settings helpers
    dashboards/
      resident.ts    # resident dashboard queries
      official.ts    # office-scoped dashboard queries
      admin.ts       # system-wide aggregate + processing-time queries
    auth/
      password.ts    # bcrypt hash/verify
      session.ts     # JWT + cookie + guards
    utils.ts
```

## Notes

- Known npm audit advisories exist in build-time tooling only (`prisma` CLI via
  `deepmerge-ts`, and Next.js's bundled `postcss`). The automatic fix would
  force breaking major upgrades (`next@16`), so they are tracked instead.
- Enum-like fields are stored as `String`; allowed values are documented in
  the schema and will be enforced by Zod + domain services.
- `CaseAssignment.assignedById` is nullable: `null` marks a system-generated
  assignment from the automatic routing engine, while a value identifies the
  official/admin who performed a manual reassignment.
