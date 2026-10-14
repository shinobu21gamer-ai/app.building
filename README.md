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

> Authentication, roles, sessions, protected routes, **resident concern submission**, the **rule-based priority assessment engine** (auto-scoring, official override, admin-configurable rules), the **automatic routing engine** (category → office assignment, admin-configurable rules, office-scoped reassignment), the **official case-management workflow** (search/filter, status lifecycle, progress remarks, actions taken, resolution with date and a proof photo, every status change backed by a proof photo and an action date), **resident case tracking** (My Concerns list, detailed case page with lifecycle stepper, server-side ownership checks), **resident feedback** (resolved check, 1-5 rating, comment, duplicate protection), **role-based dashboards** (live database-driven figures and charts for residents, officials, and administrators), the **administrator management system** (accounts, officials, offices, concern categories, routing rules, priority rules, and key/value system settings — with historical-integrity guards), and the **in-app notification system** (event-driven notifications, unread/read state, related case links, mark-one/mark-all-as-read) are **implemented**. Reports are **not implemented yet** — they are built in the next development stage.

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

See `.env.example`. `DATABASE_URL` (a PostgreSQL connection string, for example
`postgresql://user:password@host:5432/barangayresolve`, or a Neon connection
string) is required for the app to start, and a production deployment needs two
more before residents can use it:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | The app cannot start without it. |
| `JWT_SECRET` | yes | Signs session cookies. A long random string; the app throws on the first login without it. |
| `PII_ENCRYPTION_KEY` | yes in production | Encrypts personal data at rest (RA 10173): resident phone numbers and ID numbers. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Secrets under 32 bytes, and the `.env.example` placeholders, are rejected. |

**What happens without `PII_ENCRYPTION_KEY`:** nothing is ever stored in the
clear. Identity verification is disabled on the resident page (with the reason
shown), registration with a phone number is refused, and staff see masked
numbers only. `npm run env:check-pii` reports the state of the variable, and
production Vercel builds print the same warning into the build log. Set the
variable in the hosting dashboard and redeploy — for Vercel that is *Project
Settings → Environment Variables*. A deployment that deliberately stores no
personal data can set `ALLOW_MISSING_PII_KEY=true` to silence the build warning.

`DIRECT_URL`, `CRON_SECRET`, `SESSION_COOKIE_SECURE` and the SMTP, web-push and
Firebase variables are optional; the features they enable are documented below
and degrade on their own when they are unset.

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
changes are applied before code that depends on them is published. The same
build runs `scripts/check-pii-key.ts`, which warns in the build log when the
deployment cannot store personal data (see *Environment Variables* above).
Set `DATABASE_URL` in Vercel, and set `DIRECT_URL` too if the provider requires a
non-pooled connection for migrations. Preview deployments intentionally skip
migrations so they cannot change a shared production database. For a non-Vercel
deployment, back up the database and run `npx prisma migrate deploy` as a
release step before deploying the new code. The office migration normalizes
existing null contacts to empty strings. Office map and address fields have been
removed from the admin workflow; a follow-up migration removes the unused map
columns while preserving migration history.

Consent is recorded per resident (`ConsentRecord`): filing a concern processes
personal data, so the API refuses it without a `DATA_PROCESSING` grant. Accounts
created before that table existed have no grant yet. They can give one in a
single click — the submit-concern page and the resident dashboard show the
statement and the button, and the privacy center at `/privacy/requests` lists
every purpose — and `npm run privacy:consent-notice` (dry run, then `-- --apply`)
tells each affected resident once, through the notification service.

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
| `official.social_services@barangayresolve.dev` | Official — Social Services / Assistance Committee |
| `official.engineering@barangayresolve.dev` | Official — Maintenance Team / Engineering Office |
| `official.treasury@barangayresolve.dev` | Official — Office of the Barangay Treasurer |
| `treasurer@barangayresolve.dev` | Barangay Treasurer (treasury role) |
| `captain@barangayresolve.dev` | Barangay Captain (approving official) |
| `crew1@barangayresolve.dev` | Maintenance crew — masonry (crew profile) |
| `crew2@barangayresolve.dev` | Maintenance crew — plumbing (crew profile) |
| `resident@barangayresolve.dev` | Resident |

Accounts are created by `npm run db:seed` (see `prisma/seed.ts`). By default, the seed only inserts missing accounts (`upsert` with an empty `update`), so existing seeded accounts keep their current passwords. If an existing demo account needs the documented password restored, run the seed once with `RESET_DEMO_PASSWORDS=true`:

```sh
RESET_DEMO_PASSWORDS=true npm run db:seed
```

In PowerShell:

```powershell
$env:RESET_DEMO_PASSWORDS = "true"; npm run db:seed; Remove-Item Env:RESET_DEMO_PASSWORDS
```

This resets only the seeded demo accounts to `BarangayResolve123!` and bumps their session versions so old sessions are revoked. It does not reactivate disabled accounts or change the passwords of registered/non-seeded users. The reset flag is rejected when `NODE_ENV=production`; use it only for development/testing.

## Database Schema

55 models in `prisma/schema.prisma`, managed by the migrations in
`prisma/migrations/`, grouped as:

- **People & access:** `Role`, `Permission`, `RolePermission`, `Office`, `User`,
  `CrewProfile`, plus the RA 10173 privacy tables (`IdentityVerification`,
  `ConsentRecord`, `DataSubjectRequest`, `ErasureExecution`, `RetentionPolicy`,
  `RetentionRun`, `PiiAccessLog`).
- **The case:** `Concern`, `ConcernCategory`, `ConcernType`, `RoutingRule`,
  `PriorityAssessment`/`PriorityConfig`/`PriorityFactorConfig`,
  `CaseAssignment`, `CaseStatusHistory`, `ResolutionRecord`, `CaseAssessment`,
  `CrewAssignment`, `FieldCheck`, `CaseWorkflowOverride`, `PublicCaseRecord`,
  `SlaPolicy`, `CaseEscalation`.
- **Money (COA/MOOE):** `FiscalYear`, `CoaAccount`, `FundSource`,
  `BudgetAllocation`, `BudgetEarmark`, `Disbursement`, `DisbursementApproval`,
  `BudgetLedgerEntry`.
- **Comms & operations:** `Notification`, the frozen alert tables
  (`SystemAlert`, `SystemAlertAcknowledgement`, `SystemAlertReaction`,
  `PushSubscription`, `NativePushToken`), `Feedback`, `AppSetting`,
  `LoginAttemptBucket`, `RevokedToken`, `PasswordResetCode`, `UploadRecord`.
- **Audit & maintenance:** `Audit`, `AuditChainState`, `AuditVerificationRun`,
  `CronRun`, `EmailDelivery`.

Column-level detail, indexes and the rule each table encodes are in
`docs/revamp/02-data-model.md`.

Status flow: `SUBMITTED → ASSIGNED → UNDER_ASSESSMENT → AWAITING_BUDGET →
IN_PROGRESS → RESOLVED → CLOSED` — no stage may be skipped.

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
| POST | `/concerns/[id]/status` | Assigned office / ADMIN | Advance the case status (in progress / resolved / closed). Multipart form only, with a **required proof photo** (JPEG/PNG/WebP, ≤5 MB) and an optional action date `occurredOn` (`YYYY-MM-DD`, defaults to today). JSON is refused with `400`. |
| POST | `/concerns/[id]/resolutions` | Assigned office / ADMIN | Record a resolution (summary, action taken, type, resolution date, **required proof photo**) and mark the case resolved |
| POST | `/concerns/[id]/notes` | Assigned office / ADMIN | Append a progress remark or an action-taken entry (JSON, optional action date `occurredOn`, no photo) |
| GET | `/concerns/[id]/feedback` | RESIDENT (owner) | Read the resident's own feedback for a case |
| POST | `/concerns/[id]/feedback` | RESIDENT (owner) | Rate a resolved/closed case (resolved check, 1-5 rating, optional comment) |
| GET | `/admin/users` | ADMIN | List accounts (`?q=`, `?role=`, `?status=active\|disabled`) |
| GET | `/admin/crew` | `case.crew.assign` | Crew roster for the picker (`?availability=`, `?officeId=`, `?includeOtherOffices=1`). `?scope=desk` (needs `crew.roster.manage`) lists every crew account, profiled or not |
| POST | `/admin/crew` | `crew.roster.manage` | Create or update a crew profile (trade, employment, rates, availability, max cases, office, notes, roster state) |
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
| POST | `/concerns/[id]/field-checks` | `case.fieldcheck.request` | Step 1: send somebody to confirm a concern is real at the resident's location (allowed while the case is `SUBMITTED` or `ASSIGNED`) |
| POST | `/field-checks/[checkId]/submit` | `case.fieldcheck.perform` | The assigned person records the finding (confirmed / not confirmed / could not verify) with notes and a photo |
| POST | `/field-checks/[checkId]/review` | `case.fieldcheck.review` | The admin approves the finding or sends it back; approving "not confirmed" closes the case as unfounded |
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
applies to every proof photo: concern images, status-change proofs and resolution
proofs. `UploadRecord` rows are cleaned up when images are deleted.

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

## Loading States & Motion

- **Navigation feedback** (`src/components/loading/navigation-progress.tsx`): a
  click on an in-app link shows a thin bar at the top of the page straight away.
  If the navigation takes longer than about 160 ms, a skeleton also covers the
  content below the header. The component never calls `preventDefault`, and it
  sits outside `<main>` so it does not wrap the pages.
- **Route fallbacks** (`loading.tsx`): add one only to a segment whose pages
  never call `notFound()` and never redirect from inside the page. A `loading`
  boundary streams the response with HTTP 200, which would break the 404 status
  of `notFound()`. The resident and official case routes, and the notifications,
  alerts and profile pages, therefore have no `loading.tsx`. Admin, the concern
  form, and the public help, privacy, track and sign-in pages do.
- **Skeleton shapes**: `routeSkeletonVariant()` in
  `src/lib/loading/route-skeleton.ts` maps a path to a shape, and
  `src/components/loading/page-skeleton.tsx` draws it. Add new routes there.
- **Motion** is defined in the "Motion system" block of `src/app/globals.css`.
  Under `prefers-reduced-motion: reduce`, every decorative animation is turned
  off. The spinner keeps turning, and the navigation bar becomes a static
  segment, so people can still see that something is loading.
- Charts animate in once on mount. Scroll reveals use CSS scroll-driven
  animations where the browser supports them, and content is fully visible
  everywhere else.

## Accessibility (WCAG 2.1 AA)

- All form controls have associated `<label>` elements or `aria-label` (fixed
  in `admin-filter-bar.tsx`, `routing-rules-manager.tsx`).
- Every submit button is disabled during the fetch, preventing double
  submissions and giving screen-reader users clear state.
- Focus-visible styles are provided by Tailwind; no custom focus outlines were
  removed.
- No `tabindex` hacks; natural DOM order is preserved.

## Tests

- **Unit tests (Vitest):** cover the priority engine, workflow transitions and
  permissions, case validations (real calendar dates, optional action dates,
  blank-value handling), the action-date rules (Asia/Manila days, future,
  submission and last-status bounds), journal ordering, auth schemas (password
  policy, reset code bounds), and the query parsers for concerns and notifications.
  Run with `npm run test`.
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
- **Status lifecycle:** `SUBMITTED → ASSIGNED → UNDER_ASSESSMENT →
  AWAITING_BUDGET → IN_PROGRESS → RESOLVED → CLOSED`. A single transition map
  validates every move, so steps cannot be skipped, repeated, reversed, or
  applied to a closed case.
- **Reality check first:** step 1 of every case is answering "is this report
  real?". The admin desk sends an official or a crew member to the location the
  resident gave; that person reports what they found; an admin approves the
  finding. A report that is not real closes the case as unfounded before any
  office work happens, and nothing else on the case can proceed until the
  finding confirms it — enforced at every door (see *Field checks* below).
- **Guided step-by-step flow:** the case page opens with the whole flow as a
  numbered rail — `Check the report → Validate → Assess → Fund → Crew → Start
  work → Work → Verify → Close` — and each step panel says what to do, who does
  it, and what it is waiting for. Step 1 is the reality check, and the form that
  sends the checker lives on it. The case's current step is marked and opened by
  default;
  the form that performs a step lives inside that step, so nobody has to guess
  the order or which button comes next. The official list shows each case's
  current step, the official case sheet prints the flow, the admin dashboard
  and the validation queue (`/admin/validation`) put the same numbered guide
  above the workload, and the crew duty view carries the crew's four steps
  (check the plan → travel and set up → send progress → finish the task). The
  step order comes from one pure module (`src/lib/cases/process-flow.ts`), so
  every desk sees the same sequence. Each step names the desk that owns it
  ("the treasury's queue", the case office, the Captain's office) and a step
  the case never reached — because it was closed as unfounded — reads **not
  needed** instead of pretending to be done. The Captain works the last step
  from `/captain/closure`, the list of resolved cases with their verification
  state.
- **Every case waits for its budget:** the `AWAITING_BUDGET` stage is not
  skippable. A case cannot move from `UNDER_ASSESSMENT` straight to
  `IN_PROGRESS`, and there is no override for it. To leave the stage the case
  needs a saved cost estimate (labour included; a saved ₱0 says the case costs
  nothing) and approved earmarks whose total covers it, which is what makes the
  treasury's decision visible before any work starts. The retired
  `BUDGET_STAGE_SKIP` override kind stays readable on old records only.
- **The funding decision is shown in full, not guessed at:** because a case
  cannot leave `AWAITING_BUDGET` without an approved earmark, the person
  approving one is committing money to a resident's concern they did not scope —
  usually one the treasurer or an administrator proposed. Every earmark
  therefore carries an **approval brief** (`src/lib/treasury/approval.ts`, pure
  and unit-tested; rendered by `src/components/treasury/earmark-review.tsx` on
  `/treasury/earmarks`, `/treasury/budgets/[id]` and `/captain/approvals`) that
  names the concern it is for and links to it, that concern's saved estimate,
  what is already set aside, what approving this one adds, the exact shortfall
  left over, the allocation it draws on and what remains available afterwards,
  and who proposed it. It then states the outcome in one sentence: approving
  covers the estimate so the case can leave `AWAITING_BUDGET`, or it still
  leaves the case short by a stated amount. The two ways an approval fails —
  the reader is the one who proposed it (segregation of duties), or the
  allocation cannot cover the amount — are stated on the card instead of being
  discovered as an error after the click, and a card the reader may not decide
  offers no button that can only fail. `/treasury/earmarks` reads as a decision
  queue: what this reader can decide comes first, then a case sitting in
  `AWAITING_BUDGET`, then the longest-queued proposal, with filters for
  needs-a-decision / set-aside / cancelled. A case's funding panel is the other
  end of the same thread — it states the estimate, the amount set aside, the
  shortfall and whose desk the proposal is waiting on, and for a reader who may
  propose an earmark it links straight to the guided funding flow with that
  case's card highlighted.
- **Funding a case is guided, not re-derived from dropdowns:** the treasurer
  cannot open the case screens (those are scoped to the case's office), so
  `/treasury/fund` (`src/lib/treasury/funding-guide.ts`, pure and unit-tested)
  brings the cases to the money instead. The page opens with the three-step
  explanation of the money stage (estimate → proposal → approval), then lists
  the open cases: those still short of money first (each with the treasury's
  own figures — estimate, set aside, waiting on the Captain, still to set
  aside), then an "not ready" list that says why (no estimate yet, or already
  covered). Each card carries the proposal form with the numbers already in
  it, and — the decision that used to mean reading a dropdown of COA object
  codes — a **recommended budget line**: allocations that can cover the need on
  their own, ranked with the case office's own money first, barangay-wide
  next, then other offices, each by the headroom left after the reservation
  (`rankFundingOptions`; no recommendation when nothing covers the need alone,
  because preselecting a line that would fail the approval's ledger check
  would just be a button that can only fail). Proposing states the hand-over
  out loud — the Captain approves, and only that approval reserves the money.
  The pending-proposal arithmetic never double-books: a proposal waiting on
  the Captain counts towards what a new one must cover
  (`uncommittedShortfall`), and a card whose pending proposal already covers
  the case says so instead of offering a second one. The treasury dashboard
  counts "cases waiting for their budget" from the same rows the page lists,
  and the Captain's approval brief opens with a three-tick summary (right
  case · budget covers it · proposed by someone else) ahead of the full
  figures, so "am I good to approve?" is answered at a glance.
- **Field checks — is the report real?** Step 1 of every case, and the first
  thing the admin does with a new report: the admin desk (or the assigned
  office) picks an official or crew member, who sees the location the resident
  pinned (address, purok and a map link), goes there, and records what they
  found — confirmed, not confirmed, or impossible to verify — with notes and a
  photo. The finding is a notification to every admin, and the case waits until
  an admin answers it. The check can be sent from the moment the report arrives
  (status `SUBMITTED`), before it is validated or routed. Approving a "not
  confirmed" finding closes the case as unfounded, marks the steps that never
  happened as not needed, and tells the resident in plain words why the case
  ended with no work done; sending it back reopens the check for the same person
  with the reviewer's note shown on their screen. While the check has not been
  approved, the case cannot move on: the validation that leaves the inbox
  (`validateConcern`), the status change out of `ASSIGNED` and the first
  assessment save (`saveAssessment`) all check the same rule. The checker picks
  the work up on their own dashboard (`/official` for officials, `/crew` for
  crew) — the check follows the person, not the office, so somebody sent from
  another office still gets the case location and the finding form. The whole
  queue is at `/admin/field-checks`, whose "send someone" picker leads with the
  reports that have just arrived.
- **Crew roster and profiles:** every Maintenance Crew account carries a roster
  profile — trade, employment type, hourly/daily rate, availability, how many
  open cases they may hold, office, notes and whether they are on the roster.
  Profiles are created with the account ("Crew profile" fields appear when the
  role is Maintenance Crew) or on the crew roster screen (`/admin/crew`), which
  also enables/disables the account. The assignment picker leads with the case
  office's own crew and lists profiled crew from other offices after them with
  their office's name, so a case routed to an office without crew of its own is
  not a dead end.
- **Proof photo for every status change:** moving a case to in progress, resolved
  or closed requires a proof photo (JPEG, PNG or WebP, up to 5 MB, checked by its
  content and not just its file name). Without one the request is refused with
  `400` and nothing is written: no status change, journal row, notification or
  stored file. The status form and the resolve form both require the photo.
  Remarks and actions are text entries and do not need one.
- **Action dates ("Date of action"):** every official entry (status change,
  remark, action taken, resolution) records the calendar day the work actually
  happened, in Asia/Manila time. It defaults to today. An earlier day is allowed,
  but:
  - it cannot be in the future;
  - it cannot be before the day the case was submitted;
  - a status change (including a resolution) cannot be dated before the previous
    status change, so the stepper stays in order. Remarks and actions are not held
    to this rule.

  The record time (`createdAt`) is the moment the entry was made and is never
  changed. The journal is append-only: a backdated entry is added as a new row, and
  no existing row is rewritten.
- **No dates in the past where the past makes no sense:** the assessment's planned
  start and planned finish, and a fiscal year's start and end, cannot be set to an
  earlier day — the pickers are floored at today (Asia/Manila) and the server
  refuses an earlier day with `400` even if the form is bypassed
  (`src/lib/cases/plan-window.ts`, `fiscalYearCreateSchema`). An assessment that
  already has a plan keeps its stored window, so editing an overdue plan does not
  lock the official out. The past is still allowed where it is needed: action dates
  on journal entries and the report/filter date ranges (a range that reaches past
  today is clamped to today instead of rejected).
- **Two rights in the assessment:** the findings (eligibility, inspection,
  resources, approval) need `case.assess`; the manpower plan (workers needed,
  duration, equipment) and the cost estimate the budget gate is measured
  against need `case.manpower.plan` as well. A role can be trusted with one
  without the other, and the API enforces both.
- **Journaling:** every status change writes a `CaseStatusHistory` row with the
  previous status, new status, acting user and role, remarks, action date, proof
  photo and record time. Resolving also creates the unique `ResolutionRecord`
  (summary, actions taken, resolution type, resolution date and proof photo) and
  sets `resolvedAt`; closing sets `closedAt`.
- **Progress remarks and actions taken:** additive journal entries (`REMARK` and
  `ACTION`) that record work without changing the status. They take an optional
  action date. Closed cases reject further changes.
- **Timeline and printouts:** the case timeline is ordered by action date, and each
  entry shows its action date and when it was recorded. Proof photos appear as
  thumbnails on the official and resident case pages, in the timeline, and on both
  printouts. The official case sheet prints the full journal, and the resident
  receipt lists the case progress.
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
  each one was reached (the action date when the official recorded one), and a
  **journal timeline** with every status change, progress remark, action taken and
  the resolution details. Each timeline entry shows its action date, when it was
  recorded, and any proof photo.
- **Printable receipt:** `/resident/concerns/[id]/print` also lists the case
  progress with action dates and proof photos.
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
to today, with the same action-date rules as above) and a required **proof
photo** of the fix (JPEG/PNG/WebP, ≤5 MB). Resolving is one atomic transaction
that:

1. advances the status to `RESOLVED` (and sets `resolvedAt`),
2. writes a `RESOLUTION` history entry with the actor, remarks, action date, proof
   photo and timestamp,
3. records the `ResolutionRecord` (unique per case),
4. notifies the resident, and
5. renders the resolution — summary, actions, date and proof photo — on the
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
  profiles, reset passwords, change role/office, and enable/disable access. When
  the role is **Maintenance Crew**, the dialog also collects the crew profile
  (trade, employment type, rates, availability, max open cases, notes and roster
  state), so a new crew account can be assigned to a case immediately.
- **Crew** (`/admin/crew`): the roster desk — every crew account with its trade,
  rates, availability, open caseload and roster state, a filter for available
  crew and for accounts that still need a profile, plus "add a crew profile" for
  an existing account and enable/disable for the account itself.
- **Field checks** (`/admin/field-checks`): step 1 of the workflow — send
  somebody to confirm a concern is real (assignee + what to confirm), starting
  with the reports that have just arrived, read the findings waiting for an
  answer, and approve them or send them back for another look.
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
