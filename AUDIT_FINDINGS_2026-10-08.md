# BarangayResolve — Independent System Audit Findings

**Date:** 2026-10-08
**Auditor:** Arena.ai Agent Mode (independent re-audit)
**Scope:** Whole-system correctness audit — bugs, broken flows, broken logic — plus independent verification of the claims in `AUDIT_REPORT.md` (2026-09-28).
**Branch:** `arena/09aef86a-app-building` (base `81f90d6`)

---

## 1. Executive summary

The prior `AUDIT_REPORT.md` claims "all gates pass." That claim is **true for the automated gates** — I independently re-ran `prisma generate`, `tsc --noEmit`, `eslint`, `vitest` (67/67), and `next build`, and all pass. **But the gates do not cover runtime behavior, and the audit missed four real problems**, three of which are security-critical data exposures already committed to git:

1. **Live session JWTs committed to git** (6 cookie files).
2. **A production database with bcrypt password hashes and personal emails committed to git** (`prisma/dev.db`), plus 3 uploaded concern images.
3. **A Firebase `google-services.json` with a real-format API key committed to git.**
4. **An unresolved merge conflict committed in `README.md`.**
5. **A live-verified bug: `notFound()` returns HTTP 200 instead of 404** on the dynamic case-detail pages — missed by every gate (typecheck/lint/test/build all pass). **Fixed in this audit.**

Beyond the gates, I ran a **198-check live end-to-end HTTP test suite** against a running production build (scratch copy with a SQLite driver adapter, since no PostgreSQL server exists in this environment). Final result: **198 passed, 0 failed**, covering auth, RBAC, the full concern workflow, routing, priority, notifications, alerts, push tokens, password flows, admin APIs, dashboards, page rendering, and edge cases. A full manual code review of `src/lib/**`, all `src/app/api/v1/**` routes, the Prisma schema/migrations/seed, middleware, and dashboards found no additional blocking bugs.

**Fixes applied in this audit:** the notFound-200 bug, the README merge conflict, removal of 34 committed secret/junk files from git tracking, and a hardened `.gitignore`.

---

## 2. Verification of the prior audit's claim

| Gate | Prior claim | Independently verified |
|---|---|---|
| `prisma generate` | pass | ✅ pass |
| `tsc --noEmit` | pass | ✅ pass |
| `eslint` | pass | ✅ pass |
| `vitest` | "41 tests" | ✅ pass — **67 tests / 12 files** (report is stale on the count) |
| `next build` | pass | ✅ pass (~31–34 s, all routes dynamic) |
| "No committed secrets" | implied | ❌ **false** — see §3.1–3.3 |
| "README clean" | implied | ❌ **false** — committed merge conflict |
| Runtime behavior | not covered | ❌ **notFound() 200 bug found live** — see §3.4 |

The prior report also references "4 migrations squashed into `20260929000000_init_postgres_baseline`" — the repo actually contains exactly that one baseline migration, so that part is accurate. The test-count and docs drift are noted in §6.

---

## 3. Confirmed findings (severity-ordered)

### 3.1 CRITICAL — Live session JWTs committed to git (FIXED: untracked)

Tracked files `cookies.txt`, `cookies_official.txt`, `cookies_resident.txt`, `cookies_resident2.txt`, `cookies_sec.txt`, `tunnel_cookies.txt` (plus empty `local-cookies.txt`, `tunnel-cookies.txt`) contained `br_session` HS256 JWTs with visible `sub`/`role`/`officeId`/`email` claims — i.e., **working admin/official/resident session tokens**. Anyone with repo access could impersonate users until token expiry.

**Fix applied:** `git rm --cached` all cookie files; `.gitignore` now covers `*cookies*.txt`, `*cookie*.json`, `cookies*.json`.
**Still required (cannot be done in-repo):** rotate `JWT_SECRET` (burns all outstanding tokens), and **purge these files from git history** (`git filter-repo` / BFG) if the repo was ever pushed/shared — the tokens remain recoverable from history until then.

### 3.2 CRITICAL — `prisma/dev.db` and uploaded images committed to git (FIXED: untracked)

`prisma/dev.db` (SQLite, 28 tables) was tracked despite `*.db` being in `.gitignore` (it was committed before the rule, or with `-f`). Verified contents: **13 users including personal email addresses, bcrypt password hashes, 2 concerns, 9 revoked tokens, 230 audit-log rows.** Also tracked: 3 resident-uploaded images under `uploads/` (privacy exposure), despite `/uploads` being ignored.

**Fix applied:** `git rm --cached prisma/dev.db uploads/*`.
**Still required:** delete the local file (it is burned), purge from history, and treat all dev.db passwords as compromised.

### 3.3 CRITICAL — `android/app/google-services.json` committed (FIXED: untracked)

Tracked despite `android/app/google-services.json` being listed in `.gitignore`. Contains a Firebase config with a real-format API key (`current_key`, 39 chars), `project_id`, `mobilesdk_app_id`, package `com.barangayresolve.app`.

**Fix applied:** `git rm --cached android/app/google-services.json`.
**Still required:** rotate the key in the Google Cloud console, purge from history. Note: `google-services.json` API keys are client identifiers, not full credentials, but exposure enables quota abuse and project identification.

### 3.4 HIGH — `notFound()` returns HTTP 200 instead of 404 (FIXED — live-verified)

**Symptom (live-verified against a production build):** `GET /resident/concerns/999999`, `/resident/concerns/abc`, `/resident/concerns/undefined` (valid resident session) → **HTTP 200** with the not-found UI embedded and the page title "Case Details | BarangayResolve". Same for `/official/concerns/{999999,abc,undefined}` with an official session. Controls behaved correctly: unknown top-level route → 404, deep unknown path → 404, wrong-role page → 307 (role gate works). Authorization logic itself was correct (cross-user/cross-office access properly denied) — only the **status code** was wrong.

**Root cause (isolated with a minimal probe):** the root `src/app/loading.tsx` — which rendered **`null`**, i.e., provided zero loading UI — created a route-level Suspense boundary. Per Next.js's own `not-found` documentation, streamed responses return **200** for `notFound()` and 404 only for non-streamed responses. A minimal probe page calling `notFound()` (not even matched by middleware) reproduced the 200; deleting the root `loading.tsx` restored correct 404s. This is why every gate missed it: typecheck/lint/test/build say nothing about response status codes.

**Impact:** search engines see soft-404s (duplicate/low-value "not found" pages indexed as 200), monitoring/APM never sees 404s, and any API consumer or crawler relying on status codes is misled. It also masks the intended 404 for cross-user/cross-office case access.

**Fix applied:** deleted `src/app/loading.tsx` (it rendered nothing — no UX loss).
**Verification:** after the fix, all of `/resident/concerns/{999999,abc,undefined}` and `/official/concerns/{999999,abc,undefined}` return **404** with the not-found UI; unknown routes still 404; real case pages still 200. `tsc`, `eslint`, `vitest` 67/67, and `next build` all pass with the file removed. Locked in as regression checks in the E2E suite (§4).

### 3.5 HIGH — Unresolved merge conflict committed in `README.md` (FIXED)

Conflict markers (`<<<<<<< HEAD` line 1, `=======` line 768, `>>>>>>> 0b6dc7d…` line 770) were committed; the incoming side was a junk line `# app.building`. A README with conflict markers is broken documentation and signals a bad merge was pushed.

**Fix applied:** resolved to the HEAD side (the full BarangayResolve README); the fixed file is byte-identical to the pre-conflict HEAD content (766 lines).

### 3.6 MEDIUM — Plaintext demo credentials committed (FIXED: untracked)

`login.json`, `login_official.json`, `login_resident.json`, `login_sec.json`, `login_tunnel.json` contained `admin@barangayresolve.dev` / `BarangayResolve123!` — the exact seeded demo credentials (`prisma/seed.ts`), i.e., **working login credentials** for every demo role.

**Fix applied:** `git rm --cached` all five; `.gitignore` covers `login*.json`.
**Still required:** purge from history; change the seeded demo password if this repo/deployment is shared.

### 3.7 LOW — Repo hygiene: junk files tracked (FIXED)

All untracked from git and (where pure garbage) deleted from the working tree; `.gitignore` extended so they cannot return:

- `build.log` (binary garbage), `dev-url.txt` (Cloudflare tunnel URL), `tsconfig.tsbuildinfo` (build artifact), `out/index.html` (Capacitor splash stub), `llms.txt` (stale content from an unrelated "Portfolio" template project)
- 12 API test-payload JSONs (`alert_*.json` ×6, `status.json`, `status2.json`, `close.json`, `resolve.json`, `new_concern.json`)
- Empty cookie files (`local-cookies.txt`, `tunnel-cookies.txt`)

### 3.8 INFO — Documentation/config drift (documented, not changed)

- `AUDIT_REPORT.md` is stale: claims "41 tests" (now 67) and predates the findings above.
- `README.md` says "SQLite via Prisma ORM" / default `prisma/dev.db`, but the schema, `migration_lock.toml`, and `.env.example` are PostgreSQL. Live-verified: the SQLite path does not even compile against this schema (Postgres-only `skipDuplicates` in `acknowledge-all`) and the committed dev.db schema had drifted. The README's SQLite instructions are broken as written.
- `src/lib/rate-limit.ts` comments mention a "durable SQLite bucket" that no longer matches the implementation.
- `package.json` `name` is `integ2` (scaffold leftover).
- `.env.example` contains a duplicated commented env block.
- README contains a dev-machine-specific `npm.cmd` PowerShell note.

### 3.9 INFO — No `.env` shipped (documented)

A fresh clone cannot `npm install`/`build` without creating `.env` first (the install postinstall runs `prisma generate`, which needs `DATABASE_URL`). `.env.example` exists and is sufficient as a template — recommend making install resilient or documenting the copy step prominently.

---

## 4. Live end-to-end verification (198/198 green)

Because no PostgreSQL server exists in this environment, the live test ran against a **scratch copy** of the repo (never the real repo) using Prisma's SQLite driver adapter + WASM query compiler, seeded with the repo's own `prisma/seed.ts`. The only scratch-only patches were the SQLite provider plumbing and one Postgres-only `skipDuplicates` → `upsert` rewrite (which itself confirmed the README's SQLite claim is stale). The real repo's schema/provider were never altered.

**Suite:** 26 sections, 198 checks — **198 passed, 0 failed.** Highlights:

- **Health/security:** DB connected; `nosniff`, `DENY`, CSP headers.
- **Auth:** 401 guards; login for all roles + role-based redirects; per-email login rate limit (6th → 429 + `Retry-After`); register (201 auto-login, 409 duplicate, 400 weak password); cross-origin POST → 403 CSRF; logout revokes the token (API 401 + middleware 307).
- **RBAC:** 403 on APIs, 307 page redirects in both directions; resident→admin 403; officials locked to their own office; resident case detail enforces ownership.
- **Concern lifecycle:** submit (201, image required, fake image → 400, auto-routing ROAD→Infrastructure / WASTE→Environment, priority assessed HIGH/16, case number `BR-YYYYMMDD-NNNN`); official workflow (note min-length, cross-office 403, invalid transitions rejected, feedback-before-resolution 400, resolve with attachment + `resolvedOn` persisted, future date 400); feedback (201, duplicate 409, other-resident 404, rating bounds); close (CLOSED, reopen rejected, notes-on-closed 409).
- **Priority:** override to CRITICAL (200), invalid level 400, short reason 400, cross-office 403; config validation rejects non-contiguous / overlapping / out-of-range / unknown-level thresholds and leaves stored config unchanged.
- **Admin:** users list (no `passwordHash` leaked), create official, official-without-office 400, deactivate→login 403, self-deactivate 400; offices/categories/routing CRUD + duplicate-rule 409; settings GET/PUT/DELETE; SLA scan; CSV export with formula-injection neutralization; email retry.
- **Alerts & push:** create with push report, ack hides from active, reactions shared counts, invalid reaction 400, acknowledge-all idempotent, resident-create 403, expired hidden; VAPID null without keys; SSRF guards reject `http://` and raw-IP endpoints; native token register/409 cross-account/deactivate.
- **Password flows:** self-change rotates the session cookie (verified) and revokes other sessions via `tokenVersion`; admin reset code is 16-hex, single-use, wrong code 400, old password fails after reset.
- **Notifications:** all types delivered (SUBMITTED/ASSIGNED/RESOLVED/FEEDBACK_REQUESTED/STATUS_CHANGED/CASE_CLOSED/PRIORITY_CHANGED/REASSIGNED), mark-read, read-all, cross-user 404.
- **Pages:** all 17 role pages render 200; **regression checks: `/resident/concerns/{999999,abc,undefined}` and `/official/concerns/{999999,abc,undefined}` → 404** (the §3.4 fix); other-resident case page → 404; cross-office case page → 404; unknown route → 404.
- **Uniqueness/edges:** 3 rapid submissions → 3 unique case numbers; duplicate-flagged submission accepted (non-blocking); validation 400/404 matrix; cron without/with wrong secret → 401.

---

## 5. Code review — verified clean (summary)

Full review of `src/lib/**` (auth/session, password, db, api envelope, rate-limit, audit, logger, format, utils, api-client, validation-errors, cases/{workflow,service,query,feedback,sla,settings,duplicates,resolution-date}, case-number, priority/{engine,config}, routing/{engine,service,config}, notifications, alerts, alert-queue, email, uploads, push, admin/query, dashboards), all `src/app/api/v1/**` routes, `prisma/schema.prisma` + migrations + seed, `next.config.ts`, `src/middleware.ts`, and the page/component layer. Verified correct, among others:

- Timing-safe login (dummy hash on unknown email); `tokenVersion` revocation; logout revocation.
- Reset code claimed transactionally (single-use) with IP throttle.
- Case-number generation retries on `P2002` uniqueness conflicts.
- Workflow transitions enforced server-side (RESOLVED only via the resolution route; ASSIGNED only via routing); closed-case guards.
- Multipart upload validated before save; attachment deleted if the transaction fails.
- Feedback race → 409; resolution date validated (real calendar date, not future, Manila midday).
- Notification per-user scoping; alert ack/reaction idempotency; alert activeOnly hides acknowledged (by design).
- Upload authorization (owner/admin/assigned office) with `nosniff`/`no-store`; CSV formula-injection neutralized.
- Cron fails closed without `CRON_SECRET`; push-token cross-account takeover guard + device-slot retirement; SSRF guards on push endpoints.
- Officials locked to their own office in dashboard/list/detail; resident detail enforces ownership.
- Every frontend API call maps to a real route; seed is idempotent.

**Minor observations (no fix required):** `admin/query.ts` counts only 5 of ~15 User FK relations (DELETE still safe via P2003→409); `assertSameOrigin` trusts `x-forwarded-*` (spoofable if directly reachable; SameSite=Lax still blocks cross-site POSTs); `readConcernImage` disk fallback can serve orphan files; `rate-limit.ts` `bump()` persist condition is convoluted but functional; middleware does one DB query per matched request (perf note); zod v4 `z.string().email()` is deprecated (works) in two validation files; `concerns` POST can orphan an uploaded file if duplicate-detection throws after image save (DB-down edge); reassign checks closed-case (409) before office permission (403) — a minor cross-office status info leak.

---

## 6. Fixes applied in this audit (working tree, staged)

| # | Fix | Files |
|---|---|---|
| 1 | **notFound() 200→404 bug** — deleted root `loading.tsx` (rendered `null`; its Suspense boundary forced streamed responses, which Next.js serves as 200 for `notFound()`) | `src/app/loading.tsx` (deleted) |
| 2 | Resolved committed merge conflict (kept full HEAD README) | `README.md` |
| 3 | Untracked 6 live-session cookie files + 2 empty ones | `cookies*.txt`, `tunnel_cookies.txt`, `local-cookies.txt`, `tunnel-cookies.txt` |
| 4 | Untracked 5 plaintext-credential login JSONs | `login*.json` |
| 5 | Untracked `prisma/dev.db` (13 users, bcrypt hashes, personal emails) | `prisma/dev.db` |
| 6 | Untracked 3 uploaded resident images | `uploads/*` |
| 7 | Untracked Firebase `google-services.json` | `android/app/google-services.json` |
| 8 | Untracked junk: `build.log`, `dev-url.txt`, `llms.txt`, `tsconfig.tsbuildinfo`, `out/index.html`, 12 test-payload JSONs | various |
| 9 | Hardened `.gitignore` (cookies, login/alert/status JSONs, `*.log`, `llms.txt`) | `.gitignore` |

**Post-fix gates (real repo):** `prisma generate` ✅, `tsc --noEmit` ✅, `eslint` ✅, `vitest` 67/67 ✅ (2 known sandbox-only unhandled Prisma engine errors from the sandbox's binary-path override), `next build` ✅.

---

## 7. Required follow-ups outside the repo (owner actions)

1. **Rotate `JWT_SECRET`** — the committed session tokens are burned; rotation invalidates them all.
2. **Purge git history** of the removed files (`git filter-repo` or BFG) if the repo was pushed/shared: `cookies*.txt`, `login*.json`, `prisma/dev.db`, `uploads/*`, `android/app/google-services.json`, and the credential JSONs remain in history until rewritten.
3. **Rotate the Firebase API key** in Google Cloud console. Note the credential split in this project: the committed `google-services.json` holds the **Android client** API key (package `com.barangayresolve.app`); the Vercel deployment's Firebase connection is separate — FCM sending uses a **service account** (`FIREBASE_SERVICE_ACCOUNT` / `FIREBASE_SERVICE_ACCOUNT_PATH`, verified **not** committed — it lives in Vercel env vars / `secrets/`, both gitignored), and browser push uses **VAPID** keys, not Firebase. Restricting or rotating the Android client key therefore has **no effect on the Vercel web deployment or FCM sending**; it only affects the Android app (see §7.8 for the APK nuance).
4. **Delete the local `prisma/dev.db`** (burned) and treat its demo passwords as compromised; change the seeded demo password if shared.
5. **Delete local cookie/login JSON files** (burned).
6. Fix the README's SQLite instructions to match the PostgreSQL schema (or add a real SQLite dev path — note the `skipDuplicates` blocker), refresh `AUDIT_REPORT.md`, rename the package from `integ2`, dedupe `.env.example`.
7. Consider adding an E2E smoke test (the 198-check suite exists at `/home/user/.audit-scratch/audit-e2e.mjs` in the audit workspace) to CI — the notFound-200 bug passed every existing gate.
8. **Android APK impact: none required for this audit's fixes.** `capacitor.config.ts` sets `server.url: 'https://barangayresolve.vercel.app'`, so the APK is a thin WebView that loads the deployed web app remotely (nothing is bundled — `android/app/src/main/assets/public/` is empty and there is no `output: 'export'`). The notFound fix and all other changes ship with the next web deployment; installed APKs pick them up automatically. The only APK-relevant item is the Firebase key remediation in §7.3: **prefer restricting the existing key** (package `com.barangayresolve.app` + release SHA-1 in Google Cloud console) — that needs no APK change; only if you **rotate** the key (delete + recreate) must you rebuild the APK with a freshly downloaded `google-services.json` and release a new version (the old key is baked into the shipped APK by the google-services Gradle plugin). Note `android/app/build.gradle` degrades gracefully when `google-services.json` is absent (plugin skipped, push notifications disabled) — and since the file is now gitignored, supply it locally or via CI secrets for Android builds.

---

## 8. Conclusion

The application's **core logic is sound**: the full concern lifecycle, RBAC, routing, priority engine, notifications, alerts, auth, and admin operations all behaved correctly under 198 live end-to-end checks, and the code review found no blocking logic bugs. The real problems were **operational/security**: secrets and a production database committed to git, a committed merge conflict, and a live status-code bug that no automated gate could see. All in-repo fixes are applied and verified; the remaining items are secret rotation and history purging, which must be done by the repo owner.
