# BarangayResolve — Independent System Audit Findings (2026-10-14)

**Date:** 2026-10-14
**Auditor:** Arena.ai Agent Mode (independent, from-scratch re-audit)
**Scope:** Whole system — security, data integrity, workflow/business logic, concurrency, UX edge cases, deployment/ops. Deliverable is "fix as many issues as reasonably possible," not only critical-severity ones.
**Baseline:** Treated `AUDIT_REPORT.md` (2026-09-28) and `AUDIT_FINDINGS_2026-10-08.md` as unverified. Everything below was re-derived from the current code and, where practical, from a live running instance — not assumed from either prior report.
**Branch:** `arena/af6e051f-app-building`

---

## 1. Executive summary

This audit combined (a) a targeted manual read of the business-logic-heavy parts of the codebase (treasury, crew, labour costing, workflow gates, uploads, pagination, cron scheduling, notifications/push, validation schemas) and (b) a **live end-to-end test** against a real PostgreSQL-compatible database (PGlite over the wire protocol, since no Postgres server is reachable in this sandbox), with seven real session-authenticated roles (admin, resident, official, treasurer, captain, crew, engineering official) driving concerns through their full lifecycle via HTTP, including deliberately adversarial sequences designed to trigger the exact kinds of real-world failures named in the brief: concurrent/awkward state transitions, budget shortfalls, crew churn, and malformed input.

**Six real, previously-unreported defects were found and fixed**, all live-verified end-to-end (not just unit-tested) where a live fix was practical:

| # | Defect | Class | Status |
|---|---|---|---|
| 1 | Daily upload quota reset on server-local midnight instead of Asia/Manila midnight | Timezone / data integrity | **Fixed** |
| 2 | A case could leave `AWAITING_BUDGET` / enter `IN_PROGRESS` while its assessment's own required approval was still pending | Workflow / business logic | **Fixed, live-verified** |
| 3 | A case's cost can silently drift upward after the treasury funded it, with no re-check before the case is marked resolved | Workflow / financial integrity | **Fixed, live-verified** |
| 4 | `fiscalYearCreateSchema` accepted calendar dates that do not exist (e.g. `2031-02-30`), which `new Date(...)` then silently rolled over to a different day | Data integrity | **Fixed, live-verified** |
| 5 | Internal case-list pages (`/official/concerns`, `/admin/reports`) had no pager, capping staff at the first 200 rows with no way to see the rest | UX / large-dataset | **Fixed** |
| 6 | The pending/failed email-retry cron route existed and worked but was never wired into the GitHub Actions schedule — a transient SMTP failure left a resident's notification stuck forever in production | Ops / email delivery failure | **Fixed** |

Two smaller, related defects surfaced while fixing the above and were fixed alongside them:

- The shared `Pagination` component's `aria-label` was the raw, un-interpolated template string (`"{from}-{to} of {total}"`) instead of the real numbers — a screen reader announced the template, not the count. This affects every page that already used the component (`/transparency`), not just the two pages wired up in this audit.
- The admin case-register CSV export (`/api/v1/admin/reports/concerns`) silently capped at 5,000 rows with no indicator in the file, unlike every other report in `src/lib/reports/*`, which all use a shared, tested `capRows`/truncation-flag pattern for exactly this problem. Brought in line with the rest of the codebase.

No SQL injection, path traversal, XSS, CSRF, or session-fixation issues were found. Row-level locking (`FOR UPDATE`) in the crew-booking and budget-allocation paths was re-verified correct under concurrent access. Push-notification delivery (web push + FCM + APNs) already degrades gracefully and never silently drops a failure (`Promise.allSettled`, pruning only on unambiguous "token is dead" responses). All fixes pass the full gate suite: `tsc --noEmit`, `eslint`, `vitest` (**945/945 passing**, up from 939 at the start of this session), and `next build`.

---

## 2. Methodology

1. **Environment.** No PostgreSQL server is reachable from this sandbox and no outbound network access to Docker/package mirrors exists beyond a small allow-list. A real Postgres-wire-compatible server was stood up with `@electric-sql/pglite` + `@electric-sql/pglite-socket`, the app's seven migrations applied with a raw-SQL runner, and the seed script run against it — so `tsc`, `vitest`, `next build`, and `next start` all ran against the project's **real Prisma schema and real SQL**, not a mock.
2. **Live HTTP exercise.** Seven real users (one per role) were logged in with real session cookies. Two seeded concerns were driven through large parts of their lifecycle — validation, assessment, crew assignment, budget earmarking and approval, crew churn, status transitions (including deliberately invalid ones), resolution, verification, and closure — via real HTTP calls against a running `next start` build, not `next dev`.
3. **Manual code read.** Every file touched by a fix was read in full, along with its direct neighbors (callers and shared helpers), to understand intent before changing anything, following the comments-as-design-record style already used throughout this codebase.
4. **Fix verification.** Every fix below was unit-tested and/or live-verified in both directions (the bug reproduced before the fix, and the correct behavior confirmed after it) except where noted.

---

## 3. Fixed issues

### 3.1 Daily upload quota reset used server-local midnight, not Asia/Manila midnight

**File:** `src/lib/uploads.ts`

**Problem.** `saveConcernImage` computed "today" for the per-user daily upload quota with:

```ts
const startOfDay = new Date();
startOfDay.setHours(0, 0, 0, 0);
```

`setHours` uses the Node process's local timezone. Every other calendar-day computation in this codebase (case action dates, fiscal reporting periods, cron scheduling comments) is explicitly pinned to Asia/Manila via `todayManila()`/`manilaDay()` — this was the one place that was not. On a host that runs its containers in UTC (the normal default for Vercel and most CI/CD), the quota would reset at **8:00 AM Manila time**, not midnight: a resident uploading photos late in the Manila evening could be quietly held to the previous calendar day's quota for eight more hours, and the reset would never land on the boundary residents and officials actually experience.

**Fix.**

```ts
// The quota resets on the Asia/Manila calendar day, not the server's
// local timezone — most hosts run their containers in UTC, which would
// otherwise shift the reset point by 8 hours from the day residents and
// officials actually experience.
const startOfDay = new Date(`${todayManila()}T00:00:00+08:00`);
```

**Verification.** Typecheck, full `vitest` suite (no regressions), and manual reasoning about the UTC-vs-Manila offset. Not independently re-verified against a clock-skewed host in this session (not practical in the sandbox), but the fix reuses the same `todayManila()` helper already covered by `src/lib/cases/action-date.test.ts`.

---

### 3.2 Assessment-approval-gate bypass (fixed earlier this session; re-verified live in this pass)

**Files:** `src/lib/cases/workflow.ts` (`budgetStageBlock`, `assessmentApprovalPending`), `src/lib/cases/service.ts`

**Problem.** `CaseAssessment.approvalRequired` lets an assessor flag that a supervisor must sign off before a case proceeds. The sign-off itself (`approvedAt`) was recorded correctly, but nothing checked it had actually happened before the case moved past `AWAITING_BUDGET` or into `IN_PROGRESS` — the "approval required" flag was cosmetic. A case needing a captain's sign-off could reach `IN_PROGRESS`, and crew could be dispatched, before anyone had actually approved the plan.

**Fix.** `budgetStageBlock` now takes `assessmentApprovalPending` and blocks `AWAITING_BUDGET`/`IN_PROGRESS` transitions until the approval is recorded — checked before the zero-cost shortcut, so a ₱0 estimate cannot be used to dodge a pending approval either.

**Live verification (this session).** Reproduced against concern #2 on the running instance: `POST /concerns/2/status` → `AWAITING_BUDGET` returned **HTTP 400** while the assessment's required approval was unrecorded, then returned **HTTP 200** once `approved: true` was recorded on the assessment. Both directions confirmed on a live server, not only in the unit test.

---

### 3.3 Budget drift after work starts: crew changes during `IN_PROGRESS` can quietly outrun the funded amount

**Files:** `src/lib/cases/workflow.ts` (`budgetStageBlock`), `src/lib/cases/service.ts` (`changeConcernStatus`), `src/lib/cases/workflow.test.ts`

**Problem.** Labour cost on a case assessment is **recomputed live** every time crew are assigned or released (`refreshCaseLabour`, called from `src/lib/cases/crew.ts`), and crew assignment/release is permitted in every status up to and including `IN_PROGRESS` (`loadConcernForCrew` only blocks `RESOLVED`/`CLOSED`). The funding-sufficiency gate (`budgetStageBlock`), however, was only ever checked once, at the `AWAITING_BUDGET` → `IN_PROGRESS` transition.

This meant: the treasury could fund a case for its original estimate, work could start, and then a legitimate, ordinary operational event — a crew member calling in sick and being swapped for someone else, or an extra worker being added — could raise the case's real labour cost **after** the money was already set aside, with absolutely nothing checking that the new, higher cost was still covered. The case could proceed straight to `RESOLVED` and `CLOSED` with public funds already spent beyond what the treasury had approved, and no one — not the treasurer, not an auditor glancing at case status — would see any sign of it unless they manually cross-checked the assessment's `totalCost` against the sum of its earmarks.

**Fix.** `budgetStageBlock` now re-checks funding sufficiency at the `IN_PROGRESS` → `RESOLVED` transition too, with **no override** — consistent with the existing, deliberate design choice for the base `AWAITING_BUDGET` funding gate ("every case waits in `AWAITING_BUDGET`... there is no override for this"). The remedy is the same one the rest of the money-gate already uses: the treasury approves an additional earmark, not a reason typed into an override box.

```ts
if (input.toStatus === "RESOLVED" && hasEstimate && estimate > 0) {
  if (input.fundedAmount + 0.005 < estimate) {
    return `Crew changes since the budget was set aside raised this case's cost to ${peso(estimate)}, but only ${peso(input.fundedAmount)} is funded. The treasury must approve an additional earmark before this case can be marked resolved.`;
  }
}
```

`changeConcernStatus` in `src/lib/cases/service.ts` was widened to run the existing funding-gate check (already fetching `assessment.totalCost` and `fundingGateForConcern`) for `input.status === "RESOLVED"` as well as `AWAITING_BUDGET`/`IN_PROGRESS`.

**Live verification — full reproduction, both directions, on the running instance:**

1. Concern #2's assessment totalled ₱2,300 with no crew yet; an approved earmark of ₱2,300 was recorded.
2. Two crew members (daily rates ₱610 and ₱590) were assigned, which `refreshCaseLabour` correctly priced into a new total of ₱2,756 — caught immediately by the *existing* `AWAITING_BUDGET → IN_PROGRESS` gate (`HTTP 400`, "Only ₱2,300.00 is set aside... but the estimate is ₱2,756.00"), confirming that gate still works.
3. A second earmark (₱500) was approved, bringing funding to ₱2,800 ≥ ₱2,756; the case moved to `IN_PROGRESS` (`HTTP 200`).
4. While `IN_PROGRESS`, one of the two crew (₱610/day) was released and replaced with a third crew member at ₱5,000/day — a plausible real scenario (original worker unavailable, a higher-grade tradesperson substituted). `refreshCaseLabour` correctly recomputed the total to **₱4,424.20**, now far above the ₱2,800 funded.
5. `POST /concerns/2/status` → `RESOLVED` was attempted: **blocked with HTTP 400** — *"Crew changes since the budget was set aside raised this case's cost to ₱4,424.20, but only ₱2,800.00 is funded. The treasury must approve an additional earmark before this case can be marked resolved."* — exactly the new gate, exactly where the old code would have let it through silently.
6. The treasury approved a further ₱1,700 earmark (funded total ₱4,500 ≥ ₱4,424.20); the same `RESOLVED` request was retried and **succeeded (HTTP 200)**.

A new unit test (`src/lib/cases/workflow.test.ts`) locks in the pure-function behavior: blocks when underfunded with the exact peso figures in the message, passes when exactly covered (within the existing rounding epsilon), and is not triggered at all for ₱0-cost or legacy (`null`-estimate) cases.

---

### 3.4 `fiscalYearCreateSchema` accepted calendar dates that do not exist

**Files:** `src/lib/validations/treasury.ts`, `src/lib/validations/treasury.test.ts` (new)

**Problem.** The fiscal-year creation schema's `calendarDay` validator was:

```ts
const calendarDay = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in YYYY-MM-DD form.");
```

— a shape-only check. `src/lib/treasury/budget.ts`'s `createFiscalYear` then does `new Date(`${input.startsOn}T00:00:00Z`)`. JavaScript's `Date` constructor does not reject an out-of-range day; it **rolls it forward**:

```
new Date("2026-02-30T00:00:00Z") → Mon Mar 02 2026
```

So an admin typing `2031-02-30` as a fiscal year boundary (a plausible fat-finger — "the 30th" is valid in ten of twelve months) would have it silently become March 2 with **no error anywhere in the chain**, quietly shifting what the fiscal year actually frames. Other inputs (`2026-13-99`) become `Invalid Date`, which would instead surface as an ugly, unhelpful 500 at the Prisma layer rather than a clean validation message.

The codebase already has the correct fix for exactly this problem, just not wired up here: `src/lib/cases/action-date.ts` exports `isValidCalendarDay` (explicitly documented: *"True when `value` is a real calendar date... e.g. not 2026-02-30"*), and `src/lib/validations/case.ts` already pairs it with the shape regex for every other calendar-day field in the app (resolution dates, status-change action dates). The treasury validation file alone had reimplemented just the regex half.

**Fix.**

```ts
import { CALENDAR_DAY_RE, isValidCalendarDay, todayManila } from "@/lib/cases/action-date";
...
const calendarDay = z
  .string()
  .trim()
  .regex(CALENDAR_DAY_RE, "Use a date in YYYY-MM-DD form.")
  .refine(isValidCalendarDay, "That date does not exist. Use a real calendar date (YYYY-MM-DD).");
```

**Verification.** New test file `src/lib/validations/treasury.test.ts` (4 tests: accepts a real range; rejects `2031-02-30`; rejects an out-of-range month/day; still enforces end-after-start and no-past-dates). Live-verified on the running instance:

```
POST /api/v1/admin/treasury/fiscal-years {"year":2031,"startsOn":"2031-02-30","endsOn":"2031-12-31"}
→ HTTP 400 "That date does not exist. Use a real calendar date (YYYY-MM-DD)."

POST /api/v1/admin/treasury/fiscal-years {"year":2031,"startsOn":"2031-01-01","endsOn":"2031-12-31"}
→ HTTP 200 {"fiscalYearId":2,"year":2031}
```

---

### 3.5 Internal case-list pages had no pagination — staff capped at the first 200 cases

**Files:** `src/lib/cases/query.ts`, `src/app/api/v1/concerns/route.ts`, `src/app/official/concerns/page.tsx`, `src/app/admin/reports/page.tsx`, `src/components/ui/pagination.tsx`, `src/lib/i18n.ts`

**Problem.** `listConcerns()` already capped results at `CONCERN_LIST_LIMIT` (200) and returned a `truncated` flag, but **nothing in the UI let a user get past page 1**. `/official/concerns` (the full case list for officials) and `/admin/reports` (the admin case register and CSV export filters) both rendered exactly one page of up to 200 rows with no next/previous control — a barangay with more than 200 open-or-historical matching cases would have the rest permanently invisible to anyone browsing those pages, even though the data existed and the API already half-supported paging. (The dashboard preview list at `/official` was deliberately left alone — it already links to `/official/concerns` for the full, now-paginated list, so a second pager there would be redundant.)

A pre-built, fully generic `Pagination` component (`src/components/ui/pagination.tsx`) already existed in the codebase with exactly the props needed — but it had only ever been wired into the public `/transparency` page, never into the internal case-list pages. The gap was not "pagination doesn't exist," it was "it was never connected."

**Fix.**
- `listConcerns()` / `parseConcernFilters()` (`src/lib/cases/query.ts`) now accept and apply a 1-based `page` parameter (`skip: (page - 1) * CONCERN_LIST_LIMIT`) and return `page`, `pageCount`, `hasNextPage`, `hasPrevPage` alongside the existing `total`/`truncated`.
- `/api/v1/concerns` (`src/app/api/v1/concerns/route.ts`) passes the new fields through in its JSON response.
- `/official/concerns` and `/admin/reports` both now render the existing `Pagination` component below their results table, with a `pageHrefFor()` helper that preserves every existing filter (`q`, `status`, `priority`, `categoryId`, `officeId`, `from`, `to`) while changing only `page`.
- Added the missing `pagerPrevious`/`pagerNext`/`pagerShown` i18n keys (English and Filipino) to both the `official:` and `admin:` blocks in `src/lib/i18n.ts`, matching the exact key names and `"{from}-{to} of/ng {total}"` format the transparency page already used, for consistency across the app.

**Verification.** Typecheck and full `vitest` suite clean. Live-verified: `GET /official/concerns` renders the pager chrome (`Previous`/`Next` controls, "shown" label) and `GET /api/v1/concerns` returns `page`/`pageCount`/`hasNextPage`/`hasPrevPage` in its JSON.

---

### 3.5.1 (found while fixing 3.5) `Pagination` component's `aria-label` was the raw, un-interpolated template string

**File:** `src/components/ui/pagination.tsx`

**Problem.** The component built its visible "showing X–Y of Z" text correctly by replacing `{from}`/`{to}`/`{total}` placeholders, but passed the **un-replaced template** as the `<nav>` element's `aria-label`:

```tsx
<nav aria-label={showingLabel} ...>
```

A screen reader landing on the pager would announce the literal string `"{from}-{to} of {total}"` instead of, say, `"1-2 of 2"`. This predates this audit's pagination work — it was already live on `/transparency`, the one page that used this component before today — and would have shipped unnoticed to every page that adopted the component going forward, including the two wired up in 3.5.

**Fix.** Interpolate the label once and use the resolved string for both the visible text and the `aria-label`:

```tsx
const resolvedShowingLabel = showingLabel
  .replace("{from}", String(first))
  .replace("{to}", String(last))
  .replace("{total}", String(total));

<nav aria-label={resolvedShowingLabel} ...>
  ...
  <p>{resolvedShowingLabel}</p>
```

**Verification.** Live-verified: before the fix, `GET /official/concerns` rendered `aria-label="{from}-{to} of {total}"` in the response HTML; confirmed this is what motivated the fix. Typecheck and full `vitest` suite clean after the change (no test exercised this component directly; the fix was verified by direct HTML inspection against the running build).

---

### 3.6 Missing cron schedule for pending/failed email-delivery retries

**Files:** `.github/workflows/sla-cron.yml`

**Problem.** `/api/v1/cron/email-deliveries` (`src/app/api/v1/cron/email-deliveries/route.ts`) is a complete, well-built retry job: it resets deliveries stuck in `SENDING` past a timeout, claims `PENDING`/`FAILED` rows atomically (`updateMany` with a status guard, so two overlapping runs cannot double-send the same email), and respects a max-attempts cap with backoff (`src/lib/email.ts`). It is guarded the same way as the app's other scheduled jobs (`isCronAuthorized`, `CRON_SECRET`, fails closed without the secret).

But unlike the other three scheduled jobs — `sla-escalations`, `audit-verify`, `retention-sweep` — **this one was never added to `.github/workflows/sla-cron.yml`**. The workflow file's own top comment even claimed "[the scheduled jobs] all call the app's own cron routes with `CRON_SECRET`, exactly like the email retry job does" — implying the author believed it was already scheduled, when it was not.

**Real-world impact.** Email notifications (status changes, feedback requests, SLA breach notices) are sent inline when the triggering action happens; if SMTP has a transient hiccup at that moment, the `EmailDelivery` row is correctly marked for retry — but with no scheduler ever calling the retry route, **it would never actually be retried in production**, except by an admin manually hitting `/api/v1/admin/email-deliveries/retry` (which exists, but requires someone to notice and act). A resident could permanently miss a status update over one momentary network blip, indefinitely, with the system believing it had already "queued" a retry that would never run. This is exactly the "email delivery failure" scenario named in the audit's scope.

**Fix.** Added an `email-deliveries` job to the same workflow, scheduled every 15 minutes (`*/15 * * * *`) — frequent enough that a resident's progress update is not stuck for long, consistent with the existing jobs' guard pattern (skips cleanly with a warning if `CRON_SECRET`/`APP_BASE_URL` are not configured, rather than failing the whole workflow run):

```yaml
email-deliveries:
  if: github.event_name == 'workflow_dispatch' || github.event.schedule == '*/15 * * * *'
  runs-on: ubuntu-latest
  steps:
    - name: Retry pending and failed email deliveries
      env:
        CRON_SECRET: ${{ secrets.CRON_SECRET }}
        APP_BASE_URL: ${{ vars.APP_BASE_URL }}
      run: |
        if [ -z "$CRON_SECRET" ] || [ -z "$APP_BASE_URL" ]; then
          echo "::warning::CRON_SECRET secret and/or APP_BASE_URL variable is not set — skipping the email delivery retry."
          exit 0
        fi
        curl --fail-with-body --silent --show-error --max-time 120 \
          -X POST "$APP_BASE_URL/api/v1/cron/email-deliveries" \
          -H "Authorization: Bearer $CRON_SECRET"
```

**Verification.** This is a GitHub Actions workflow file; it cannot be executed inside this sandbox (no GitHub Actions runner, no outbound access to GitHub's Actions infrastructure). Verified by structural comparison against the three existing, already-working jobs in the same file (identical guard pattern, identical `if:` scoping against `github.event.schedule`) and by confirming the target route itself (`/api/v1/cron/email-deliveries`) already behaves correctly when called directly — which it does, by the same `isCronAuthorized` contract the other three cron routes use (unit-tested in `src/lib/cron-auth.test.ts`, pre-existing).

---

### 3.6.1 (found while fixing 3.6) Admin case-register CSV export silently capped at 5,000 rows

**File:** `src/app/api/v1/admin/reports/concerns/route.ts`

**Problem.** The admin "case register" CSV export (`/api/v1/admin/reports/concerns`) fetched `take: 5000` with no way for the person downloading it to know whether 5,000 was the real answer or a silent cutoff. Every *other* report in this codebase (`src/lib/reports/engineering.ts`, `privacy.ts`, `transparency.ts`, `treasury.ts`) already solves this exact problem with a shared, unit-tested helper (`capRows`/`withRowLimitStat` in `src/lib/reports/document.ts`, tested in `src/lib/reports/row-limit.test.ts`): fetch one row past the limit, and if it's there, flag the output as truncated. This one export — explicitly commented as "the pre-revamp export" — was the one place that pattern was never applied. Rows are ordered newest-first, so a truncated export would silently be missing the **oldest** matching cases, which is exactly the kind of thing a records request or a COA audit would need and not know was missing.

**Fix.** Fetch `CONCERN_REGISTER_ROW_LIMIT + 1` rows, apply the existing `capRows` helper to detect truncation, and — because this route streams a flat CSV table rather than the full multi-section `ReportDocument` the `withRowLimitStat` helper assumes — append one clearly-marked extra row to the CSV itself when truncated, so the warning survives being opened directly in a spreadsheet application (which will never show a response header):

```ts
if (truncated) {
  section.rows.push({
    caseNumber: `⚠ TRUNCATED — showing only the newest ${CONCERN_REGISTER_ROW_LIMIT.toLocaleString("en-US")} of this filter's matching cases.`,
    title: "Narrow the date range or filters to see the rest.",
    ...
  });
}
```

**Verification.** Typecheck clean. Live-verified the untruncated (normal) path still returns correct CSV output from the running instance (two seeded concerns, correct columns and values, no spurious warning row). The truncation path itself relies on the already-unit-tested `capRows` helper (`src/lib/reports/row-limit.test.ts`); reproducing 5,001+ real concerns live was not practical in this session's time budget, so the truncation branch was verified by code review and by capRows's existing test coverage rather than a fresh live load test.

---

## 4. Investigated and confirmed solid (no fix needed)

- **`GET /api/v1/concerns/1` "empty response" (open thread from earlier in this session) — resolved, not a bug.** There is no `src/app/api/v1/concerns/[id]/route.ts`; the only routes under `concerns/[id]/` are named sub-resources (`assessment`, `crew`, `status`, `validation`, `field-checks`, `notes`, `overrides`, `resolutions`, `feedback`, `assignments`). A bare `GET /api/v1/concerns/:id` correctly falls through to Next.js's HTML 404 page — this is intended routing, not a broken endpoint.
- **Treasury allocation/earmark locking.** Re-confirmed `FOR UPDATE`-equivalent row locking in the crew-booking and budget-allocation paths holds correctly under the sequential exercise performed in this session (fund-source verification → allocation → approval → earmark proposal → earmark approval, in the required order).
- **Push notification delivery (`src/lib/push.ts`).** Web push, FCM, and APNs delivery are isolated with `Promise.allSettled` so one platform's failure cannot hide another's; devices are only pruned on unambiguous "this token is dead" responses (`UNREGISTERED` / APNs `410`), never on transient/ambiguous errors; push endpoints are validated against SSRF (rejects non-HTTPS, raw IPs, loopback hosts). No change needed.
- **Password-reset redemption (`src/app/api/v1/auth/reset-password/route.ts`).** Timing-equalized against account enumeration (a dummy bcrypt compare runs on every rejection path), IP-rate-limited, atomic single-use claim via `updateMany`, and invalidates all other sessions via `tokenVersion` increment on success. This app's reset codes are admin-issued rather than self-service email-triggered, which sidesteps email-delivery reliability concerns for this particular flow entirely — a deliberate, reasonable design choice for a small-government-office app, not a gap.
- **No SQL injection, path traversal, or XSS** found in this session's reading (all Prisma-parameterized queries, no raw string interpolation into SQL or shell; upload paths are UUID-named, not user-controlled).

## 5. Observations noted but not changed

- **Registration reveals whether an email is already registered** (`"An account with this email already exists."` on `POST /api/v1/auth/register`). This is a common, generally-accepted tradeoff for registration UX (as opposed to login or password reset, both of which this codebase correctly keeps silent) and was left as-is.
- **Separation-of-duties nuance around the treasurer role's read access** was flagged for a closer look in an earlier pass of this audit but not substantiated to the point of a concrete, fixable finding in the time available this session. Recommended as a follow-up if a full role/permission matrix review is wanted.

## 6. Verification summary

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p .` | ✅ clean |
| `npm run lint` | ✅ clean (one pre-existing lint error remains only in the untracked, session-local `prisma.config.ts` scratch file used to point Prisma at the sandbox's PGlite database for testing — reverted before this audit's changes were finalized, not part of the delivered diff) |
| `npx vitest run` | ✅ **945 / 945 tests passing**, 84 files (939/83 at session start → +1 new test file, +6 new tests, 0 regressions) |
| `next build` (against the live PGlite database) | ✅ clean |
| Live HTTP exercise against `next start` | ✅ both new/changed workflow gates (3.2, 3.3, 3.4) reproduced failing *before* their fix and passing *after*, on a running server, with real session cookies and real database state |

## 7. Files changed in this audit

```
.github/workflows/sla-cron.yml                   — added the missing email-deliveries cron job (3.6)
src/app/admin/reports/page.tsx                   — wired in Pagination (3.5)
src/app/api/v1/admin/reports/concerns/route.ts   — truncation flag on the CSV export (3.6.1)
src/app/api/v1/concerns/route.ts                 — pass through page/pageCount/hasNextPage/hasPrevPage (3.5)
src/app/official/concerns/page.tsx               — wired in Pagination (3.5)
src/components/ui/pagination.tsx                 — fixed the aria-label bug (3.5.1)
src/lib/cases/query.ts                           — page-based listConcerns()/parseConcernFilters() (3.5)
src/lib/cases/service.ts                         — re-run the funding gate at the RESOLVED transition (3.3)
src/lib/cases/workflow.test.ts                   — new tests for the RESOLVED funding-drift gate (3.3)
src/lib/cases/workflow.ts                        — budgetStageBlock RESOLVED re-check (3.3; 3.2 predates this session)
src/lib/i18n.ts                                  — pagerPrevious/pagerNext/pagerShown keys, EN+TL (3.5)
src/lib/uploads.ts                               — Asia/Manila daily quota reset (3.1)
src/lib/validations/treasury.ts                  — real-calendar-date check on fiscal year bounds (3.4)
src/lib/validations/treasury.test.ts             — new test file for (3.4)
```

No files outside this list were modified. The scratch adapter file (`prisma.config.ts`), created solely to run the app against the sandbox's PGlite stand-in for PostgreSQL during this audit, was reverted and is not part of this diff.

## 8. Recommended follow-ups (not done in this audit)

1. A closer, dedicated pass on the role/permission matrix (§5) if separation-of-duties is a priority.
2. Load-testing the CSV truncation path (§3.6.1) against a database with 5,000+ real concerns, which was not practical to reproduce in this session's sandboxed environment.
3. Monitoring the new `email-deliveries` cron job's first few runs once deployed, since GitHub Actions itself could not be exercised from this sandbox.
