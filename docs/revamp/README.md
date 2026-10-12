# BarangayResolve — Complete Revamp

Planning and delivery notes for the UI/UX, workflow, schema and module revamp.
**Status: Stage 4 of 7 (treasury) is implemented on this branch.**
Stages 4–7 are specified here and are delivered one at a time, on your go-ahead.

| Stage | Scope | State |
|---|---|---|
| 1 | Architecture and schema | **Delivered** (this branch) |
| 2 | RBAC and auth (6 roles, ID verification, RA 10173 controls) | **Delivered** (this branch) |
| 3 | Core workflow, including manpower planning and crew assignment | **Delivered** (this branch) |
| 4 | Treasury (COA MOOE budgets, earmarks, disbursements, approvals, live balances) | **Delivered** (this branch) |
| 5 | SLA (48-hour escalation via cron) and the hash-chained audit log | Specified, awaiting go-ahead |
| 6 | UI revamp (design system + mobile-first role portals) | Specified, awaiting go-ahead |
| 7 | Reports and dashboards | Specified, awaiting go-ahead |

Documents in this folder:

- `README.md` — frozen set, rules, the full file inventory, decisions that need your sign-off.
- `01-architecture.md` — module map, RBAC matrix, workflow state machine, manpower gate, treasury flow, SLA and audit design, privacy architecture, notification contract, design-system principles.
- `02-data-model.md` — every new/changed table and column, with its invariants.
- `03-migration-plan.md` — migration order, backfills, deployment per stage, rollback procedure, verification queries.

---

## 1. The frozen set (not touched, ever, in this revamp)

These files, tables and environment variables keep working exactly as they are,
because the Android WebView depends on their routes, page paths and contracts.

**Files — do not edit:**

| Area | Frozen paths |
|---|---|
| Push/FCM delivery | `src/lib/push.ts`, `src/lib/push-device.ts`, `src/lib/push-types.ts`, `src/lib/capacitor-types.ts` |
| Alert data layer | `src/lib/alerts.ts` |
| Notification service | `src/lib/notifications/service.ts` **(called as-is)** |
| Alerts page + diagnostics | `src/app/alerts/page.tsx`, `src/components/alerts/alert-listener.tsx`, `alert-archive.tsx`, `native-diagnostics-card.tsx`, `native-crash-notice.tsx`, `native-push-listener.tsx`, `push-session-sync.tsx`, `push-setup.tsx`, `src/lib/native-diagnostics.ts` |
| Alert API contracts | `src/app/api/v1/alerts/**` (including `push/route.ts` and `push/token/route.ts`) |
| Admin alert composer | `src/components/admin/alert-composer.tsx` |
| Android project | `android/**`, `capacitor.config.ts`, `scripts/build-android.mjs` |

**Tables — schema-shape frozen:** `SystemAlert`, `SystemAlertAcknowledgement`,
`SystemAlertReaction`, `PushSubscription`, `NativePushToken` (plus `Notification`).
Stage 1 adds *only* new tables and nullable columns; those five tables are byte-identical
in `prisma/schema.prisma` and are not mentioned in the migration except as FK *targets*
that already existed.

**Routes/pages that must keep working:** `/alerts`, `/api/v1/alerts/*`
(incl. `/api/v1/alerts/push/token` GET/POST/DELETE), `/api/v1/notifications/*`,
and the `AlertBridge` JS contract (`window.AlertBridge.*`).

**Env vars — unchanged:** `VAPID_*`, `FIREBASE_SERVICE_ACCOUNT[_PATH]`,
`APNS_*`, `NEXT_PUBLIC_CAPACITOR_APP`. New variables are *added* (see §4), none are
renamed or repurposed.

Verified at the start of this stage with `git diff` against `70e5bbb`: **no file in the
frozen set is modified by anything in the plan below.** If a later stage turns out to
need a change in a frozen file, work stops there and the change is raised with you first.

---

## 2. Rules the whole revamp follows

1. **Conventions from the repo, not new ones.** Zod schemas in `src/lib/validations/*`,
   the `{ success, data | error }` envelope built by `ok()` / `handleError()` /
   `withErrorBoundary()` from `src/lib/api.ts`, Prisma migrations with a written rollback,
   office scoping enforced in the service layer (`canManageConcern` and friends),
   actions recorded through `recordAudit`, domain logic pure and unit-testable
   (`src/lib/<domain>/*.ts` + `*.test.ts`).
2. **Notifications only through the existing service.** Every resident- or
   staff-facing notice in the new modules goes through
   `src/lib/notifications/service.ts` (called as-is; it is not edited). New events map
   onto its existing helpers — see §4 of `01-architecture.md`. Machine-written rows keep
   using its exported `NOTIFICATION_TYPES` contract, exactly like the current SLA scanner.
3. **Every required form field is marked with `*`.** Zod is the source of truth: a field
   is required when it is neither `.optional()` nor `.default()`-ed. The shared
   `<Field required>` component renders the `*`, sets `aria-required`, and the form's
   help text explains that `*` means required. Stage 6 ships a lint-visible checklist and
   a unit test over the form configs so a required field cannot lose its marker.
4. **Money is `Decimal(14,2)` and ledgered.** No balance is ever stored as a float, and
   no balance is trusted from a summary column: `BudgetLedgerEntry` is the record.
5. **Personal data is minimised, encrypted, masked, logged.** See §6 of
   `01-architecture.md`. Staff never see a full phone number or ID number, and every
   unmasking requires a reason that lands in `PiiAccessLog`.
6. **Every workflow exception is explicit.** Skipping `AWAITING_BUDGET`, starting work
   with fewer crew than planned, or forcing a status writes an append-only
   `CaseWorkflowOverride` row with a mandatory reason, an actor and (optionally) a
   countersignature.

---

## 3. Full change inventory (all seven stages)

`N` = new file, `M` = modified, `D` = deleted (none planned).
Stages 1–4 are marked ✅; everything else is the committed plan for that stage.

### Stage 1 — Architecture and schema ✅

| Path | | Purpose |
|---|---|---|
| `docs/revamp/README.md` | N ✅ | This document |
| `docs/revamp/01-architecture.md` | N ✅ | Architecture, RBAC matrix, workflow, module map |
| `docs/revamp/02-data-model.md` | N ✅ | Table/column dictionary |
| `docs/revamp/03-migration-plan.md` | N ✅ | Migration + rollback plan |
| `prisma/schema.prisma` | M ✅ | 28 new models, new columns on `User`/`Concern`/`ConcernCategory`/`CaseStatusHistory`/`ResolutionRecord`/`Audit` |
| `prisma/migrations/20261012000000_revamp_core_schema/migration.sql` | N ✅ | The migration itself (additive only) |
| `prisma/rollbacks/20261012000000_revamp_core_schema_rollback.sql` | N ✅ | Exact reverse of the above |

### Stage 2 — RBAC and auth ✅

| Path | | Purpose |
|---|---|---|
| `src/lib/auth/rbac.ts` | N ✅ | Permission catalogue + role matrix + `can()` + office scoping |
| `src/lib/auth/roles.ts` | N ✅ | The six role keys, labels, home routes |
| `src/lib/auth/session.ts` | M ✅ | `requirePermission`/`requireApiPermission`, role homes, masked `publicUser` |
| `src/middleware.ts` | M ✅ | Route guards for `/treasury`, `/captain`, `/crew` (alerts/notifications untouched) |
| `src/lib/privacy/crypto.ts` | N ✅ | AES-256-GCM field encryption + keyed lookup hash (HKDF from one key) |
| `src/lib/privacy/phone.ts` | N ✅ | Mask/unmask policy and formatting |
| `src/lib/privacy/consent.ts` | N ✅ | Consent grant/withdraw + `requireConsent` |
| `src/lib/privacy/service.ts` | N ✅ | DSR intake/handling/erasure, PII access logging |
| `src/lib/identity/verification.ts` | N ✅ | Resident ID submission + review workflow |
| `src/lib/validations/auth.ts` | M ✅ | Registration with consent + phone field |
| `src/lib/validations/admin.ts` | M ✅ | Six role keys, permission/admin schemas |
| `src/lib/validations/privacy.ts` | N ✅ | Consent, DSR, verification schemas |
| `scripts/bootstrap-rbac.ts` | N ✅ | Seeds the permission catalogue from code |
| `scripts/pii-backfill.ts` | N ✅ | Encrypts existing `User.phone` values (phase 1 of 2) |
| `src/app/api/v1/auth/{register,profile,me}/route.ts` | M ✅ | Consent, masking, role exposure |
| `src/app/api/v1/identity/route.ts` | N ✅ | Resident submits ID for verification |
| `src/app/api/v1/admin/identity/[id]/route.ts` | N ✅ | Verify/reject a resident |
| `src/app/api/v1/admin/roles/route.ts`, `admin/permissions/route.ts` | N ✅ | RBAC administration |
| `src/app/api/v1/privacy/{consents,requests}/route.ts`, `admin/privacy/requests/[id]/route.ts` | N ✅ | RA 10173 endpoints |
| `src/app/api/v1/admin/users/[id]/route.ts`, `users/route.ts` | M ✅ | Create/edit the new roles, crew profiles |
| `.env.example` | M ✅ | Documents the new `PII_ENCRYPTION_KEY` (frozen alert env vars are left exactly as they are) |
| `src/app/{treasury,captain,crew}/layout.tsx` | N ✅ | Role portals |
| `src/app/resident/verification/page.tsx` | N ✅ | ID upload + status |
| `src/app/privacy/page.tsx` | M ✅ | Full privacy notice, rights, consent history |
| `src/app/privacy/requests/page.tsx` | N ✅ | Access/correction/erasure requests |
| `src/app/admin/{roles,privacy}/page.tsx` | N ✅ | RBAC matrix, DSR queue, PII access log |
| `src/components/admin/permission-matrix.tsx`, `verification-review.tsx`, `privacy/*` | N ✅ | UI |
| `src/components/auth/register-form.tsx` | M ✅ | Consent checkboxes, phone, `*` markers |
| `src/lib/auth/rbac.test.ts`, `src/lib/privacy/crypto.test.ts` | N ✅ | Tests |

| `src/lib/privacy/dates.ts` | N ✅ | Statutory working-day arithmetic (15 days) and `DSR-YYYY-NNNN` references |
| `src/lib/privacy/phone-store.ts` | N ✅ | Encrypt/lookup/mask a phone column, with the legacy-plaintext fallback |
| `src/lib/privacy/catalog.ts` | N ✅ | Consent + DSR catalogues and the privacy-notice version |
| `src/lib/identity/policy.ts` | N ✅ | ID statuses/methods and the AYUDA/BUDGET gate decision |
| `src/lib/auth/rbac-db.ts` | N ✅ | DB-authoritative permission lookup (RolePermission rows override code) |
| `src/app/api/v1/admin/privacy/{reveal,access-log}/route.ts` | N ✅ | Audited phone reveal + the PII access log |
| `src/app/admin/verification/page.tsx` | N ✅ | ID review queue |
| `src/components/identity/verification-form.tsx`, `components/privacy/*` | N ✅ | Resident verification + privacy-center UI |
| `src/components/portals/portal-intro.tsx`, `src/app/{treasury,captain,crew}/page.tsx`, `src/app/admin/layout.tsx`, `src/app/resident/layout.tsx` | N/M ✅ | Role portal landings and navigation |
| `src/lib/admin/query.ts`, `src/components/admin/user-manager.tsx` | M ✅ | Six-role user administration with masked phone numbers |
| `src/components/ui/field.tsx` | M ✅ | `Label required` marker + `RequiredLegend` for the `*` rule |
| `prisma/seed.ts` | M ✅ | Six roles, four concern types with office routing, crew profiles |
| `package.json` | M ✅ | `db:bootstrap-rbac` and `privacy:pii-backfill` scripts |
### Stage 3 — Core workflow (including manpower) ✅

| Path | | Purpose |
|---|---|---|
| `src/lib/cases/workflow.ts` | M ✅ | Seven statuses, transition guards, labels |
| `src/lib/cases/service.ts` | M ✅ | Validation, assignment, status changes, closure |
| `src/lib/cases/assessment.ts` | N ✅ | UNDER_ASSESSMENT record: eligibility, inspection, resources, approval |
| `src/lib/cases/manpower.ts` | N ✅ | `workersNeeded*`, duration, equipment, labor-inclusive cost estimate |
| `src/lib/cases/crew.ts` | N ✅ | Crew assignment, double-booking prevention, progress (`2 of 3`) |
| `src/lib/cases/public-record.ts` | N ✅ | Writes the PII-free `PublicCaseRecord` projection |
| `src/lib/cases/query.ts` | M ✅ | New status filters, crew counts, legacy-case flags |
| `src/lib/routing/service.ts` | M ✅ | Type → office assignment from the new flow |
| `src/lib/validations/case.ts` | M ✅ | Assessment/crew/override/closure schemas |
| `src/lib/validations/concern.ts` | M ✅ | `typeId`, geotag fields, accuracy, purok |
| `src/lib/validations/crew.ts` | N ✅ | Crew profile + assignment schemas |
| `src/app/api/v1/concerns/route.ts` | M ✅ | Type + geotag on submit |
| `src/app/api/v1/concerns/[id]/validation/route.ts` | N ✅ | Admin validate/categorize/prioritize |
| `src/app/api/v1/concerns/[id]/assessment/route.ts` | N ✅ | Under-assessment record + manpower plan |
| `src/app/api/v1/concerns/[id]/crew/route.ts` | N ✅ | Assign/release named crew |
| `src/app/api/v1/concerns/[id]/overrides/route.ts` | N ✅ | Reasoned overrides |
| `src/app/api/v1/concerns/[id]/status/route.ts` | M ✅ | New transitions + the crew gate |
| `src/app/api/v1/concerns/[id]/resolutions/verify/route.ts` | N ✅ | Verification before closure |
| `src/app/api/v1/admin/crew/route.ts` | N ✅ | Crew roster management |
| `src/app/api/v1/concerns/track/route.ts`, `concerns/route.ts` | M ✅ | Public tracking stays PII-free |
| `src/app/resident/**`, `src/app/official/**` | M ✅ | New statuses, timelines, crew progress |
| `src/app/official/concerns/[id]/assessment/page.tsx` | N ✅ | Assessment + crew planning screen |
| `src/app/crew/**` | N ✅ | Crew portal: today's jobs, my assignments |
| `src/app/admin/validation/page.tsx` | N ✅ | Admin validation queue |
| `src/components/cases/*` | M/N ✅ | Stepper, workflow form, assessment form, crew panel, override dialog |
| `src/components/concern/{geotag-picker,concern-map}.tsx` | N ✅ | Map + geotag capture |
| `src/lib/cases/*.test.ts` | N/M ✅ | Transition, gate, double-booking and cost tests |
| `src/lib/cases/crew-rules.ts` | N ✅ | Pure double-booking, remaining-slot and coverage rules (`2 of 3 assigned`) |
| `src/lib/cases/geo.ts` | N ✅ | Geohash encode, coordinate coarsening, public-title scrubbing |
| `src/lib/cases/journal.ts` | M ✅ | Journal dating (`journalReachedAt`) used by the progress stepper |
| `src/components/concern/case-timeline.tsx` | M ✅ | Labels for the nine new journal entry types |
| `src/app/resident/concerns/new/page.tsx`, `src/components/concern/submit-concern-form.tsx` | M ✅ | Optional service-type picker and the geotag picker |
| `src/app/resident/concerns/[id]/page.tsx`, `src/app/official/concerns/[id]/page.tsx` | M ✅ | Seven-stage stepper, crew progress, map card, desks |
| `src/app/resident/concerns/[id]/print/page.tsx`, `src/app/official/concerns/[id]/print/page.tsx` | M ✅ | Journal labels on the printed case record |
| `src/lib/i18n.ts` | M ✅ | en/fil copy for every new desk (assessment, manpower, crew, validation, verification) |

### Stage 4 — Treasury ✅

| Path | | Purpose |
|---|---|---|
| `src/lib/treasury/coa.ts` | N ✅ | Code parsing/formatting, the "usable code" gate, provenance metadata |
| `src/lib/treasury/ledger.ts` | N ✅ | Money helpers, append-only snapshots, no-overspend, voucher lifecycle, aging |
| `src/lib/treasury/budget.ts` | N ✅ | Fiscal years, allocations, earmarks, ledger writes, the case funding gate |
| `src/lib/treasury/disbursement.ts` | N ✅ | Draft → treasurer certification → AAO approval → release → liquidation |
| `src/lib/treasury/query.ts` | N ✅ | Live balances, registers, aging summary, per-case funding view |
| `src/lib/validations/treasury.ts` | N ✅ | Every treasury schema + the payee / mode-of-payment catalogues |
| `src/app/api/v1/treasury/allocations/route.ts`, `allocations/[id]/route.ts` | N ✅ | Register + prepare, approve, adjust (admin memo), close |
| `src/app/api/v1/treasury/earmarks/route.ts`, `earmarks/[id]/route.ts` | N ✅ | Propose, approve (reserve), cancel (release) |
| `src/app/api/v1/treasury/disbursements/route.ts`, `disbursements/[id]/route.ts` | N ✅ | Prepare + the seven lifecycle actions, with separation of duties |
| `src/app/api/v1/treasury/balances/route.ts` | N ✅ | Dashboard figures and pending-queue counts |
| `src/app/api/v1/admin/treasury/accounts/**`, `fund-sources/**`, `fiscal-years/**` | N ✅ | COA catalogue, fund sources, fiscal years (verify / open / close) |
| `src/app/treasury/{page,budgets,budgets/[id],earmarks,disbursements,disbursements/[id],ledger,codes}/page.tsx` | N ✅ | Treasurer portal: dashboard, budgets, earmarks, vouchers, ledger, verification desk |
| `src/app/captain/approvals/page.tsx` | N ✅ | AAO approval queue (allocations, earmarks, certified vouchers) |
| `src/app/admin/treasury/page.tsx` | N ✅ | Administrator view: fiscal years, fund sources, appropriation register |
| `src/components/treasury/*` | N ✅ | Balance cards, ledger + aging table, five forms, verify form, funding panel |
| `src/app/{treasury,captain,admin}/layout.tsx` | M ✅ | Nav entries for the new desks |
| `src/lib/i18n.ts` | M ✅ | `revamp.treasuryDesk` copy (en + fil, key parity) |
| `src/app/official/concerns/[id]/page.tsx` | M ✅ | Case funding panel for holders of `treasury.balance.view` |
| `src/lib/treasury/{coa,ledger,desk,flows}.test.ts` | N ✅ | 56 tests: code rules, balance math, approval order, no overspend |

### Stage 5 — SLA and audit

| Path | | Purpose |
|---|---|---|
| `src/lib/sla/policy.ts` | N | Policy resolution (type + priority + stage) |
| `src/lib/sla/escalation.ts` | N | 48-hour scan, escalation rows, notifications via the existing service |
| `src/lib/audit/chain.ts` | N | Canonical payload, SHA-256 chaining, locked append, verification |
| `src/lib/audit.ts` | M | `recordAudit` appends through the chain |
| `src/lib/audit/query.ts` | N | Audit explorer queries |
| `src/lib/privacy/retention.ts` | N/M | Retention sweep (from stage 2 helpers) |
| `scripts/audit-chain-backfill.ts` | N | Chains pre-existing audit rows |
| `src/app/api/v1/cron/sla-escalations/route.ts` | N | `CRON_SECRET`-guarded escalation job |
| `src/app/api/v1/cron/{retention,audit-verify}/route.ts` | N | Retention + chain verification jobs |
| `src/app/api/v1/cron/email-deliveries/route.ts` | M | Wrapped in `CronRun` bookkeeping (behaviour unchanged) |
| `src/app/api/v1/admin/{audit,sla,escalations,cron}/**` | N | Ops screens |
| `src/app/admin/{audit,sla,cron}/page.tsx`, `captain/escalations/page.tsx` | N | UI |
| `src/components/audit/*`, `src/components/sla/*` | N | Timeline, chain-verification badge, escalation queue |
| `.github/workflows/sla-cron.yml` | N | Schedules the escalation job (alternative: Vercel crons) |
| `src/lib/audit/*.test.ts`, `src/lib/sla/*.test.ts` | N | Chain tamper detection, escalation idempotency |

### Stage 6 — UI revamp

| Path | | Purpose |
|---|---|---|
| `src/app/globals.css` | M | Design tokens v2 (colour, type scale, spacing, radius, elevation, motion) |
| `src/components/ui/*` | M/N | Button, card, badge, field (with `*`), input, select, dialog/sheet, tabs, table, stat, timeline, empty state, pagination, map frame |
| `src/lib/design/form-fields.ts` | N | Field manifest (label, `required`, help) that forms render from, so a required Zod field cannot lose its `*` |
| `src/components/site/*` | M | Role-aware header, mobile nav, footer, language toggle |
| `src/app/layout.tsx` | M | Shell wiring only — the frozen alert listeners (`AlertListener`, `NativePushListener`, `PushSessionSync`, `NativeCrashNotice`) stay mounted, unchanged |
| `src/components/role-shell.tsx` | M | Mobile-first shell: bottom tab bar on small screens, sidebar on large |
| `next.config.ts` | M | Adds the OpenStreetMap tile host to `img-src` only (map tiles load as images; `connect-src` stays `'self'`) |
| `src/app/page.tsx`, `help/`, `track/`, `register/`, `login/` | M | Public pages |
| `src/app/transparency/page.tsx`, `transparency/[publicRef]/page.tsx` | N | PII-free public transparency + map |
| `src/app/{resident,official,admin,treasury,captain,crew}/**` | M | Every role portal restyled and reorganised |
| `src/components/{cases,concern,dashboard,priority,routing}/**` | M/N | Screens and widgets |
| `src/lib/i18n.ts` | M | New copy for both locales |
| `src/lib/design/form-fields.test.ts` | N | Asserts every required Zod field is marked `required` in the manifest (no DOM test dependency) |

### Stage 7 — Reports

| Path | | Purpose |
|---|---|---|
| `src/lib/reports/engineering.ts` | N | Volume, turnaround, SLA compliance, crew utilisation |
| `src/lib/reports/treasury.ts` | N | MOOE utilisation, disbursement register, liquidation aging |
| `src/lib/reports/privacy.ts` | N | DSR log, PII access summary, retention runs |
| `src/lib/reports/transparency.ts` | N | Public aggregates (no PII) |
| `src/lib/reports/csv.ts` | N | Streaming CSV export |
| `src/app/api/v1/reports/**` | N/M | Report + export endpoints (extends `admin/reports/concerns`) |
| `src/app/{admin,official,treasury,captain}/reports/**` | N | Report screens |
| `src/components/reports/*` | N | Tables, chart wrappers, export buttons |
| `src/lib/reports/*.test.ts` | N | Aggregate math against fixtures |

---

## 4. Decisions that need your sign-off

1. **Reference data inside the migration.** `Role` (6 rows), the three destination
   offices, the four `ConcernType` rows, the four 48-hour `SlaPolicy` rows, the retention
   policies, the COA object codes and the fund sources are inserted (idempotently) by the
   stage-1 migration, because production deploys run `prisma migrate deploy` and never
   run `prisma seed`. The permission catalogue deliberately stays in code (stage 2,
   `npm run db:bootstrap-rbac`) so it cannot drift. Say the word if you would rather have
   *all* of it in a separate bootstrap script.
2. **`User.phone` is retired in two phases.** Stage 2 adds `phoneEncrypted`/`phoneLast4`/
   `phoneHash` and a backfill script; the plaintext column is dropped only in the stage-5
   privacy migration, after the backfill has been verified. Rollback of the ciphertext
   path is therefore always possible.
3. **New env var: `PII_ENCRYPTION_KEY`.** One 32-byte secret; HKDF derives the AES-256-GCM
   key and the lookup-HMAC key. Documented in `.env.example` (which is edited — it is not
   a frozen env var). Losing this key makes encrypted phone numbers/ID numbers
   unrecoverable; the plan includes a key-rotation note.
4. **Resident ID verification gating.** Proposal: verification is required to submit
   `AYUDA` and `BUDGET` concerns (benefit-bearing), advisory for `REPAIR`/`DOCUMENTS`,
   and the whole rule is switchable by an admin setting (`resident.verification_required`).
   Confirm, or make it hard-gate for everything.
5. **Portal routes for the new roles.** Proposal: new top-level trees `/treasury`,
   `/captain`, `/crew` (mobile-first, own shells) alongside the existing `/official`,
   `/admin`, `/resident`. `/alerts`, `/notifications`, `/profile` stay shared and
   unchanged in behaviour.
6. **Legacy cases.** A case already in `ASSIGNED`/`IN_PROGRESS` when the new flow lands
   has no `CaseAssessment` row; it stays fully workable (no manpower gate) and is flagged
   in the UI as “no manpower plan recorded”. Confirm that is the behaviour you want.
7. **Public transparency page.** Published rows live in `PublicCaseRecord` and carry an
   anonymous reference (`BR-PUB-…`), never the real case number; coordinates are rounded
   to a coarse geohash. Historical cases are only projected after the consent review in
   stage 6 — the migration does not publish anything by itself.
