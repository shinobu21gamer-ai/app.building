# BarangayResolve — Complete Revamp

Planning and delivery notes for the UI/UX, workflow, schema and module revamp.
**Status: all seven stages are implemented on this branch.** Stage 7 (reports,
dashboards and the retention sweep) closed the revamp; the frozen set is untouched
and its contracts are unchanged.

| Stage | Scope | State |
|---|---|---|
| 1 | Architecture and schema | **Delivered** (this branch) |
| 2 | RBAC and auth (6 roles, ID verification, RA 10173 controls) | **Delivered** (this branch) |
| 3 | Core workflow, including manpower planning and crew assignment | **Delivered** (this branch) |
| 4 | Treasury (COA MOOE budgets, earmarks, disbursements, approvals, live balances) | **Delivered** (this branch) |
| 5 | SLA (48-hour escalation via cron) and the hash-chained audit log | **Delivered** (this branch) |
| 6 | UI revamp (design system + mobile-first role portals) | **Delivered** (this branch) |
| 7 | Reports and dashboards (+ the retention sweep from decision 9) | **Delivered** (this branch) |

Documents in this folder:

- `README.md` — frozen set, rules, the full file inventory, decisions that need your sign-off.
- `01-architecture.md` — module map, RBAC matrix, workflow state machine, manpower gate, treasury flow, SLA and audit design, privacy architecture, notification contract, design-system principles, report conventions.
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

### Stage 5 — SLA and audit ✅

| Path | | Purpose |
|---|---|---|
| `src/lib/sla/policy.ts` | N ✅ | Pure SLA rules: policy specificity, window resolution, level, dedupe key, labels (21 tests) |
| `src/lib/sla/escalation.ts` | N ✅ | The run (`runSlaEscalations`, `planEscalations`), the case clock (`resolveStageWindow`, `armCaseStageClock`), the queue/acknowledge/resolve desk, policy CRUD, overview (12 tests) |
| `src/lib/audit/chain.ts` | N ✅ | Pure chain rules: canonical payload, `sha256` chaining, verification of a row range (12 tests) |
| `src/lib/audit/store.ts` | N ✅ | Chained writer, verifier + `AuditVerificationRun`, explorer queries, facets, digest, legacy backfill, `serialize*` projections |
| `src/lib/audit.ts` | M ✅ | `recordAudit(input, { tx?, actorRole? })` now appends through the chain; still never breaks the caller. All 70 call sites unchanged |
| `src/lib/cases/sla.ts` | M ✅ | Thin facade over `runSlaEscalations` that keeps the existing `scanSlaBreaches(): Promise<number>` |
| `src/lib/validations/sla.ts`, `audit.ts` | N ✅ | `slaPolicySaveSchema`, `slaPolicyToggleSchema`, `escalationActionSchema` (a resolve needs a note), `auditVerifySchema` |
| `src/lib/cases/service.ts`, `src/app/api/v1/concerns/route.ts` | M ✅ | The case clock is armed/re-armed on every stage change and on submit (policy-resolved window, not `CASE_SLA_HOURS`) |
| `src/app/api/v1/cron/sla-escalations/route.ts`, `cron/audit-verify/route.ts` | N ✅ | `CRON_SECRET`-guarded jobs (same pattern as `cron/email-deliveries`); `CronRun` + `AuditVerificationRun` bookkeeping |
| `src/app/api/v1/admin/sla/policies/route.ts`, `policies/[id]/route.ts` | N ✅ | Policy list, create, full edit, activate/deactivate |
| `src/app/api/v1/admin/sla/scan/route.ts` | N ✅ | Manual run from the SLA desk (`triggeredBy: "MANUAL"`) |
| `src/app/api/v1/sla/escalations/[id]/route.ts` | N ✅ | Acknowledge / resolve an escalation (`sla.escalation.acknowledge`) |
| `src/app/api/v1/admin/audit/route.ts`, `audit/verify/route.ts` | N ✅ | Explorer (filters + paging), printable digest, on-demand verification |
| `src/app/admin/sla/page.tsx`, `captain/escalations/page.tsx` | N ✅ | SLA desk (queue, counts, policies, run history) and the Captain's queue |
| `src/app/admin/audit/page.tsx` | N ✅ | Chain status, verify button, digest, filter + paging explorer |
| `src/components/sla/{escalation-table,escalation-actions,run-scan-button,policy-form,policy-actions}.tsx` | N ✅ | Queue cards, ack/resolve, manual scan, policy create/edit/activate |
| `src/components/audit/{verify-button,audit-table}.tsx` | N ✅ | Range verification with an OK/BROKEN report, sequence + hash columns |
| `src/app/{admin,captain}/layout.tsx` | M ✅ | Nav entries for the SLA desk, audit trail and Captain queue |
| `src/lib/i18n.ts` | M ✅ | `revamp.slaDesk` (70 keys) and `revamp.auditDesk` (50 keys) in en + fil, `slaNav`/`auditNav` inline labels |
| `scripts/audit-chain-backfill.ts` | N ✅ | Chains pre-existing audit rows, dry run unless `--apply` (`npm run audit:chain-backfill`) |
| `.github/workflows/sla-cron.yml` | N ✅ | Hourly escalation scan + weekly audit verification, both through the app's own cron routes |
| `.env.example` | M ✅ | `CRON_SECRET` documented with the three jobs; the retired `CASE_SLA_HOURS` removed |

**Where this diverged from the stage-5 plan** (deliberate, so the docs do not promise files that are not there):

- The explorer queries live in `src/lib/audit/store.ts`; there is no separate
  `src/lib/audit/query.ts`.
- There is no `/admin/cron` page: the `CronRun` history is part of `/admin/sla`,
  where the escalation job it describes belongs.
- There is no `/api/v1/admin/escalations` group: the queue is rendered by the two
  desks and the single action route `PATCH /api/v1/sla/escalations/[id]`.
- **The retention sweep was not in this stage** (`src/lib/privacy/retention.ts`
  and `/api/v1/cron/retention`). Stage 5 built the SLA and audit jobs; the sweep
  was held for stage 7, where "what was deleted, and when" is also a reportable
  figure. It is delivered there — see decision 9.

### Stage 6 — UI revamp ✅

| Path | | Purpose |
|---|---|---|
| `src/app/globals.css` | M ✅ | Tokens v2: semantic surfaces/ink/lines, status colours, radius, elevation, type scale, tab-bar height; `.has-tabbar`, `.no-scrollbar`, `.tap-target`, `.safe-bottom` |
| `src/components/ui/page-header.tsx` | N ✅ | The title/description/actions block every portal page starts with |
| `src/components/ui/empty-state.tsx` | N ✅ | "Nothing here yet" with an explanation and an optional action |
| `src/components/ui/table.tsx` | N ✅ | `Table`/`THead`/`TBody`/`TR`/`TH`/`TD`, edge-to-edge horizontal scroll on phones |
| `src/components/ui/pagination.tsx` | N ✅ | Two large targets + "showing 41-60 of 438", filters preserved by `hrefFor` |
| `src/components/ui/sheet.tsx` | N ✅ | Bottom sheet: Escape, backdrop, focus and scroll-lock handling |
| `src/components/ui/mobile-tab-bar.tsx` | N ✅ | Fixed bottom tab bar (<md) with the role's first four destinations + a "More" sheet |
| `src/components/ui/nav-icons.ts` | N ✅ | Glyph per destination, keyed off the last path segment |
| `src/components/ui/role-nav.tsx` | M ✅ | Now the sticky desktop sidebar (same active logic as the tab bar) |
| `src/components/role-shell.tsx` | M ✅ | One column + tab bar on phones, sidebar + content from `md` up; the six portals inherit it unchanged |
| `src/components/ui/{card,badge,button,field}.tsx` | M ✅ | Token colours, `Card` actions/flush, new `Select`/`FieldHint`, `StatusBadge` for all seven stages |
| `src/components/ui/map-frame.tsx` | N ✅ | Static OSM tile mosaic with marker, attribution and an external link — the "open map" fallback and the public transparency preview |
| `src/components/ui/leaflet-map.tsx` | N ✅ | Interactive Leaflet view (bundled, `dynamic`-imported) for staff/resident case pages, with the static mosaic as its loading and failure state |
| `src/components/concern/concern-map.tsx` | M ✅ | Case-location panel: interactive map when the case has coordinates, the same props as before so the call sites were untouched |
| `next.config.ts` | M ✅ | OSM tile hosts added to `img-src` only; `connect-src` stays `'self'` |
| `src/lib/nav.ts` + `nav.test.ts` | N ✅ | Active-href rule, tab partitioning, icon keys (15 tests) |
| `src/lib/maps.ts` + `maps.test.ts` | M ✅ | Slippy-map tile maths, mosaic and marker placement (18 tests) |
| `src/lib/cases/public-query.ts` + `public-query.test.ts` | N ✅ | Public read model: filters, paging, stats, facets; never joins back to `Concern` (14 tests) |
| `src/app/transparency/page.tsx`, `transparency/[publicRef]/page.tsx` | N ✅ | The public PII-free transparency list (filters, stats, pager) and one anonymised case with a coarse map |
| `src/lib/design/form-fields.ts` + `form-fields.test.ts` | N ✅ | Requiredness derived from Zod + a parity test against the forms' own `*` markers (10 tests) |
| `src/app/**` (43 pages), `src/components/portals/portal-intro.tsx` | M ✅ | Every portal page now opens with `PageHeader` (list and detail pages use the new `eyebrow`/`actions` slots); the resident intake and auth forms gained the missing `*` markers |
| 6 portal surfaces | M ✅ | `data-stack` + `data-label` phone layout for the five hand-written tables and `/transparency`; `src/components/site/site-header.tsx` gained the Transparency link |
| `src/components/{site/site-footer.tsx,auth/register-form.tsx}` | M ✅ | Transparency link, tab-bar clearance, consent markers |
| `src/app/**`, `src/components/**` (119 files) | M ✅ | Migrated from raw `slate-*`/`bg-white`/`rounded-*` classes to the semantic tokens |
| `src/lib/i18n.ts` | M ✅ | `revamp.transparency` (43 keys), `revamp.common.statuses`, `submit.requiredLegend`, footer label, `statusLabelFor()` — en + fil |

**Where this diverged from the stage-6 plan** (deliberate):

- No `dialog`/`tabs`/`timeline` primitives: the sheet covers the modals in use,
  filters are links (shareable, survive reload), and the case timeline already
  exists as `components/concern/case-timeline.tsx`.
- The field manifest is **derived** from the schemas and enforced by a parity test
  over eight forms, rather than every form rendering its labels from a manifest.
  Rewriting 45 form components to render from a manifest would have been a large
  mechanical change with no extra guarantee; the test gives the same guarantee for
  the forms it covers and fails loudly if a form's markup changes shape.
- Public pages were polished in place (tokens, header, footer, focus states)
  rather than re-composed; the landing page keeps its hero and sections.
- `role-shell.tsx` renders a sidebar from `md` up (not only from `lg`), and the
  tab bar carries the first four destinations rather than a fixed global set —
  each portal decides its own order.
- **The case map changed from an embedded iframe to tiles, and then to Leaflet
  on the pages that need it.** The iframe was blocked by the production CSP, so
  the first pass replaced it with a static 3×2 mosaic. Case pages now go one step
  further and mount Leaflet (installed from npm, imported only on pages that show
  a map) over the same tile host, so staff can actually pan and zoom to plan a
  repair. The public transparency page keeps the static mosaic: it shows a coarse
  location and should not load a map library for every anonymous visitor. Neither
  path adds a `frame-src` exemption or an API key, and `connect-src` stays
  `'self'`.
- **Two frozen surfaces are still on the old markup.** `/alerts` (the page, its
  diagnostics and the alert composer) and `/notifications` were left out of the
  token migration and the header sweep on purpose: the Android WebView depends on
  them. They will keep working, but they will look like the previous design until
  you want them migrated — that is a separate change with its own test pass.

### Stage 7 — Reports ✅

| Path | | Purpose |
|---|---|---|
| `src/lib/reports/period.ts` | N ✅ | Period vocabulary (`30d`/`90d`/`ytd`/`12m`/`custom`/`all`) resolved on Asia/Manila calendar days; month and day keys (20 tests) |
| `src/lib/reports/document.ts` | N ✅ | The `ReportDocument` shape every report returns (`stats`, `sections`, `columns`, optional share bars) and the value formatters (`count`, `decimal`, `percent`, `sharePercent`, `peso`, `day`, `monthLabel`) |
| `src/lib/reports/csv.ts` | N ✅ | Pure, formula-safe CSV cells/rows/files and the filename slug — no Next import, so scripts can use it too (16 tests) |
| `src/lib/reports/stream.ts` | N ✅ | `streamDocumentCsv` / `streamSectionCsv`: 250 rows per chunk, byte-identical to the non-streaming writer, `X-Accel-Buffering: no` (14 tests) |
| `src/lib/reports/catalog.ts` | N ✅ | Report keys, tab keys, per-report permissions, `reportTabs()` |
| `src/lib/reports/labels.ts` | N ✅ | Labels the screens share: status text, period label, range, generated-at |
| `src/lib/reports/engineering.ts` | N ✅ | Volume, turnaround (median/p90), SLA compliance, crew utilisation — percentile math, working-day conversion, and overlap detection reusing `cases/crew-rules` + loader (30 tests) |
| `src/lib/reports/treasury.ts` | N ✅ | MOOE utilisation (CLOSED allocations excluded, as on the dashboard), disbursement register, liquidation aging + loader (12 tests) |
| `src/lib/reports/privacy.ts` | N ✅ | DSR log with working-day lateness, consent counts, PII-access summary, retention-run report — counts only, never a value (17 tests) |
| `src/lib/reports/transparency.ts` | N ✅ | Public aggregates computed over `PublicCaseRecord` only (13 tests) |
| `src/app/api/v1/reports/[report]/route.ts` | N ✅ | One endpoint for all four reports: `?period&from&to&format=csv`, per-report permission, `REPORT_EXPORTED` audit row on export, 404 for an unknown report |
| `src/components/reports/report-view.tsx` | N ✅ | `ReportPeriodPicker` (a GET form, so the URL is shareable), `ReportTabs`, section tables with CSS share bars |
| `src/components/reports/report-screen.tsx` | N ✅ | `ReportScreen` + `reportsExportHref` — the one composition every report page uses |
| `src/app/admin/reports/{page,engineering,treasury,privacy,transparency}/page.tsx` | N/M ✅ | The admin hub gains report tabs; the four new reports hang off it |
| `src/app/{official,treasury,captain}/reports/page.tsx` | N ✅ | The same screens from the other desks (official is office-scoped by the query helpers) |
| `src/lib/privacy/retention.ts` | N ✅ | The retention sweep: `planRetention`, one handler per seeded policy, `executeRetentionPolicy` (never throws; failure is a `FAILED` run), `runRetentionSweep`, and `retentionDesk()` for the admin card (19 tests) |
| `src/app/api/v1/cron/retention/route.ts` | N ✅ | `CRON_SECRET`-guarded daily job (03:10 UTC = 11:10 Manila), bookkept in `CronRun` |
| `src/app/api/v1/admin/privacy/retention/route.ts`, `src/lib/validations/retention.ts` | N ✅ | Manual run / dry run from the admin privacy desk |
| `src/components/admin/retention-desk.tsx`, `src/app/admin/privacy/page.tsx` | N/M ✅ | "Run retention now" card: per-policy last run, next due, and what the last run affected |
| `src/lib/loading/route-skeleton.ts`, `src/app/{official,treasury,captain}/layout.tsx`, `src/app/admin/reports/page.tsx` | M ✅ | Reports nav entries and loading skeletons for the four report surfaces |
| `src/lib/i18n.ts` | M ✅ | `revamp.reports` (titles, stats, sections, columns, metrics, notes) and `revamp.adminDesk.retention*`, in en + fil |
| `.github/workflows/sla-cron.yml` | M ✅ | The retention sweep joins the hourly escalation scan and the weekly audit verification; each job now runs on its own cron slot |

**Where this diverged from the stage-7 plan** (deliberate, so the docs do not
promise files that are not there):

- **One report engine, not one code path per report.** Every report returns the
  same `ReportDocument`, so the screen, the print layout and the CSV writer are
  built once. `csv.ts` is the pure cell/row writer; `stream.ts` streams that same
  document. The admin concern report's CSV route now uses the shared writer too.
- **One endpoint** (`GET /api/v1/reports/[report]`) rather than a route per
  report; the report key is the only variable, and permissions are looked up per
  key. The pre-existing `/api/v1/admin/reports/concerns` export keeps its URL and its
  columns, and now streams through the shared writer as well.
- **Four more report screens than planned**: `/official/reports`,
  `/treasury/reports` and `/captain/reports` reuse the admin components. Residents
  get no reports screen: every report is either barangay-wide, office-scoped or
  privacy data.
- **No chart library and no PDF writer.** Shares render as CSS bars and the print
  stylesheet handles paper; adding either would be a dependency for a page that
  already works.
- **The retention sweep rides along here** (decision 9): `/admin/privacy` gained
  the manual run, and the daily job went to `/api/v1/cron/retention`. ARCHIVE
  policies count rows without deleting anything.

**New tests in this stage: 141, in eight files** (period 20, csv 16, stream 14,
engineering 30, treasury 12, privacy 17, transparency 13, retention 19) — the suite
goes from 389 (stage 6) to 530 across 46 files.

**Close-out additions** (after the table above):

- **Crew members are now told when they are put on a case.**
  `src/lib/cases/crew.ts` writes one notification row per newly assigned crew
  member through the frozen service's own `NOTIFICATION_TYPES.CONCERN_ASSIGNED`
  — a machine-written row exactly like the SLA job's, so no new type and no edit
  to the frozen file. Before this, assignment wrote a case-history entry and
  nothing else: a crew member who was not already looking at the portal was
  never told.
- **Withdrawing the publication consent — and completing an erasure request —
  takes the resident's cases off the public page at once.** Both paths now call
  `unpublishResidentRecords()` (`cases/public-record.ts`): consent withdrawal from
  `DELETE /api/v1/privacy/consents` (audited, with the count returned), erasure
  from `executeErasure()` in the same transaction that withdraws the consent rows
  and anonymises the resident, recorded in the erasure report as
  `public_case_projection`. Before this the projection only refreshed on a case's
  *next status change*, so a withdrawn consent could sit published indefinitely.
- **The last palette literals are gone from every migrated surface.**
  `slate-*` and `bg-white` were swept out of `src/app/**` and
  `src/components/**` onto the semantic tokens: `surface`/`surface-muted`/
  `surface-sunken`, `ink`/`ink-muted`/`ink-subtle`, `line`/`line-strong`. The
  mapping is exact for `slate-50/100/200/300/500/600/900` and `bg-white`, so the
  pass is a rename and not a restyle; the darker text literals
  (`slate-700`/`800`/`950`, 19 call sites) collapse onto `ink`, a shade darker
  than they were. The one new rung is `--color-ink-faint` (#94a3b8),
  the quiet tier the old `text-slate-400` calls meant: separators, ghost and
  disabled affordances, chart neutrals — deliberately below AA, so it must never
  carry text a user has to read. The two keyboard-focus outlines that were
  `outline-slate-400/500` now use `outline-brand-600`, the same focus colour the
  form controls use. The frozen alert stack (`/alerts`, the diagnostics, the
  admin composer) and `/notifications` keep their literals on purpose — they are
  the surfaces the Android WebView pins. Verified by compiling the Tailwind
  sheet and asserting every new utility class resolves to CSS.
- **The sweep now honours a legal hold.** While a resident has a data-subject
  request that is `RECEIVED`/`IN_REVIEW`, the four policies that delete or
  overwrite personal data (`uploads.concern_images`, `pii.id_verification`,
  `case.records`, `notification.inbox`) skip that resident's rows and count them
  as `held`; the archival policies are untouched, everyone else is swept
  on schedule, and the hold lifts on its own when the request is decided because
  it is derived from the request rows rather than stored. Numbers reach the run
  record (in the summary line), the API response (`outcomes[].held`,
  `totals.held`) and the `/admin/privacy` card
  (`{held} resident(s) have an open data-subject request`).
- `scripts/public-record-backfill.ts` (decision 7) and `scripts/pii-rotate.ts`
  with its unit-tested core `src/lib/privacy/rotate.ts` (decision 3).
- `.env.example` documents both scripts beside the secret they belong to.

**Known gaps, stated rather than hidden:** the four report loaders have no
database-level tests — the sandbox has no PostgreSQL, so the aggregate math is
covered by fixture tests and the loaders by types + a clean build. In
`engineering.ts` a crew member's utilisation is derived from assignment windows;
`treasury.ts` prints a worker's trade as blank because `CrewAssignment` carries no
trade column (`CrewProfile.trade` is the column to join if that is wanted). Data
subject requests show their working-day lateness on `/admin/privacy`, but there is
no reminder job for them: the frozen notification contract has no staff-facing
privacy type, so a reminder needs either a new type in a frozen file or a machine
row that misstates what it is. That is a decision, not an oversight.

---

### Verification

- `npm run lint`, `npm run typecheck`, `npm test` — the unit suite (552 tests).
  It needs no database: `vitest.config.mts` includes `src/**` only.
- `npx vitest run --config vitest.db.config.mts` — the database suite
  (`tests/db/**`). It expects a real PostgreSQL with the migrations applied
  (`npx prisma migrate deploy`), which is exactly what the `database` job in
  `.github/workflows/ci.yml` provides through a `postgres:16` service container.
  It covers the two layers whose bugs live in SQL rather than arithmetic: the
  report loaders (engineering, privacy, transparency — treasury goes through the
  office-scoped service layer the unit suite covers) and the retention handlers,
  including the legal hold and its lift.
- `npm run build` (Prisma generate + Next build) and the Android APK job, both in
  CI on every push and pull request.

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
   unrecoverable, so the rotation is built rather than described:
   `npm run privacy:pii-rotate` (`scripts/pii-rotate.ts`, rules in
   `src/lib/privacy/rotate.ts`) re-encrypts every ciphertext **and** re-derives
   every lookup hash from `PII_ENCRYPTION_KEY_PREVIOUS` to `PII_ENCRYPTION_KEY`
   in one pass — dry run first, idempotent if interrupted, and reversible by
   swapping the two variables while the old key is still configured.
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
   to a coarse geohash. Historical cases are only projected after the consent review — the
   migration does not publish anything by itself, and neither does the backfill:
   `npm run privacy:public-backfill` (`scripts/public-record-backfill.ts`) walks the
   existing cases and imports the live path's own `publicationDecision()`, so a case is
   published only when the resident consented to `TRANSPARENCY_PUBLICATION` and the title
   still says something after the resident's name is scrubbed out of it. Dry run by
   default, `--apply` to write, safe to re-run: the `BR-PUB-…` reference is preserved and
   a withdrawn consent flips `published` back off. Withdrawal and erasure do not wait for
   the backfill or for a status change — see the close-out additions below.
8. **The case map is interactive on case pages and static in public.** Staff and
   resident case pages mount Leaflet over the same OpenStreetMap tiles, so the pin
   can be panned and zoomed while planning a repair; the public transparency page
   keeps the static mosaic, because it publishes a deliberately coarse location
   and there is no reason to load a map library for an anonymous visitor. Leaflet
   is bundled with the app (no third-party script tag, no API key, no per-view
   cost) and its removal is a one-file change — `concern-map.tsx` falls back to
   the mosaic and the app is back to the previous behaviour. Decided under "do
   what you think best"; say the word if you would rather stay static everywhere.

9. **Retention sweep — delivered in stage 7.** Stage 2 landed the retention
   *policy* data (`RetentionRun`, consent records, the privacy helpers on
   `/admin/privacy`) but no job that applies it. The sweep was held back from
   stage 5 and built in stage 7 next to the reports, where "what was deleted, and
   when" is also a reportable figure: `src/lib/privacy/retention.ts`,
   `/api/v1/cron/retention` (daily, `CRON_SECRET`) and a manual run on
   `/admin/privacy`. Each run writes a `RetentionRun` per policy and a `CronRun`
   for the sweep; `ARCHIVE` categories are counted, never deleted; a resident with
   an open data-subject request is on **legal hold** and their rows are skipped by
   the destructive policies (see the close-out additions); the admin card shows
   the last run, its effect and who is currently held. The brief's "retention rules" now have an
   executor. `/admin/privacy` and `/admin/reports/privacy` are the two places to
   watch it.
