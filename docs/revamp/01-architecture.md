# Architecture — BarangayResolve revamp

This is the target architecture the seven stages implement. It keeps the existing
shape of the codebase (Next.js 15 App Router, Prisma/Postgres, Zod, custom JWT
sessions, pure domain modules under `src/lib/<domain>/`) and adds the modules the
revamp needs. The frozen alert system is treated as a black box: everything new
talks to it through `src/lib/notifications/service.ts` and never touches the push
tables or `android/`.

---

## 1. Layers and module map

```
src/app/**                      Route handlers (thin) + RSC pages
   api/v1/<domain>/**           parse → authorize → service → ok()
src/lib/<domain>/*.ts           Domain: pure rules + DB-touching services
   workflow.ts / rules.ts       Pure functions, unit-tested, no DB imports
   service.ts                   Transactional operations (take Prisma.TransactionClient)
   query.ts                     Read models for pages/dashboards
src/lib/validations/*.ts        Zod schemas shared by client forms and route handlers
src/components/**               UI (server components by default, client where interactive)
prisma/**                       Schema, migrations, rollbacks
```

| Module | State | Responsibility |
|---|---|---|
| `src/lib/api.ts`, `src/lib/logger.ts`, `src/lib/rate-limit.ts`, `src/lib/uploads.ts` | exists | Envelope, errors, logging, throttling, uploads |
| `src/lib/auth/*` | extend | Sessions, roles, permission matrix, office scoping |
| `src/lib/privacy/*` | new | RA 10173: consent, encryption, masking, DSR, retention, access log |
| `src/lib/identity/*` | new | Resident ID verification |
| `src/lib/routing/*`, `src/lib/priority/*` | extend | Concern type → office, priority engine (unchanged mechanics) |
| `src/lib/cases/*` | extend | Lifecycle, assessment, manpower, crew, closure, public projection |
| `src/lib/sla/*` | new | Policy resolution + 48-hour escalation scan |
| `src/lib/treasury/*` | new | COA codes, appropriations, earmarks, disbursements, ledger, balances |
| `src/lib/audit.ts` + `src/lib/audit/*` | extend | Hash-chained, tamper-evident audit journal |
| `src/lib/reports/*` | new | Engineering, treasury, privacy and public reports |
| `src/lib/cases/figures.ts` | new | The shared case figures: tallies, duration summaries, "finished" |
| `src/lib/treasury/utilisation.ts` | new | MOOE utilisation, shared by the treasury dashboard and report |
| `src/lib/notifications/*` | exists, **untouched** | Every notification in the system |

**Authorization placement.** Route handlers authenticate and check a permission;
services re-check the *rules that protect data* (office scoping, ownership, state)
so no caller can bypass them. This mirrors today's `requireApiRole` +
`canManageConcern` split.

---

## 2. Roles and RBAC

Six roles, seeded as `Role` rows: `RESIDENT`, `OFFICIAL`, `ADMIN`, `TREASURER`,
`CAPTAIN`, `CREW`. One role per user (unchanged `User.roleId`), plus an office
link where it matters.

| Capability (permission key) | RESIDENT | OFFICIAL | CREW | TREASURER | CAPTAIN | ADMIN |
|---|---|---|---|---|---|---|
| `concern.submit`, `concern.track.own` | ✅ | – | – | – | – | – |
| `privacy.consent.manage`, `privacy.dsr.create` | ✅ | – | – | – | – | – |
| `identity.submit` | ✅ | – | – | – | – | – |
| `case.view.office` | own only | ✅ | assigned only | ✅ (budget) | ✅ (all) | ✅ (all) |
| `case.validate` (validate, categorize, confirm priority) | – | – | – | – | – | ✅ |
| `case.assess` (eligibility, inspection, resources, approval) | – | ✅ | – | – | – | ✅ |
| `case.manpower.plan` (`workersNeeded*`, duration, equipment) | – | ✅ | – | – | – | ✅ |
| `case.crew.assign` | – | ✅ | – | – | – | ✅ |
| `case.status.progress` (UNDER_ASSESSMENT → IN_PROGRESS → RESOLVED) | – | ✅ | – | – | – | ✅ |
| `case.status.close` | – | – | – | – | ✅ | ✅ |
| `case.override.crew_shortfall`, `case.override.budget_skip` | – | ✅ (reason required) | – | – | ✅ | ✅ |
| `case.override.countersign` | – | – | – | – | ✅ | ✅ |
| `crew.job.view.own`, `crew.job.update.own` | – | – | ✅ | – | – | – |
| `treasury.coa.verify`, `treasury.allocation.*`, `treasury.earmark.*` | – | – | – | ✅ | countersign | ✅ |
| `treasury.disbursement.prepare` | – | – | – | ✅ | – | ✅ |
| `treasury.disbursement.certify` (funds available) | – | – | – | ✅ | – | – |
| `treasury.disbursement.approve` (AAO release) | – | – | – | – | ✅ | ✅ |
| `sla.escalation.acknowledge` | – | – | – | – | ✅ | ✅ |
| `audit.view`, `audit.verify.run` | – | – | – | – | – | ✅ |
| `privacy.dsr.handle`, `privacy.retention.manage`, `privacy.pii_access.view` | – | – | – | – | – | ✅ |
| `rbac.manage`, `report.view.*` | – | status | own jobs | treasury | all | ✅ |

The matrix above is the canonical list; it lives in code
(`src/lib/auth/rbac.ts`) and is mirrored into `Permission`/`RolePermission` by
`npm run db:bootstrap-rbac`. A database row overrides the code default, so an
admin can grant a narrow extra capability without a deploy; deleting the row
falls back to code. Every override is audited (`RolePermission.updatedById`).

**Office scoping.** `OFFICIAL` sees cases whose `assignedOfficeId` equals their
`User.officeId` (existing `canManageConcern`, extended to the new statuses).
`CREW` sees only cases with an active `CrewAssignment` for them. `TREASURER` and
`CAPTAIN` see the treasury side of every case but not the resident's PII beyond
the masked view. `ADMIN` sees everything and is the only role that can validate
or recategorize.

**ID verification.** A resident row starts at `IdentityVerification.status =
UNVERIFIED`; submitting an ID moves it to `PENDING`, an admin decision to
`VERIFIED`/`REJECTED` (with a reason). Verification gates `AYUDA`/`BUDGET`
submissions by default (admin-switchable), and staff never see the ID number —
only `idNumberLast4`.

---

## 3. The workflow

```
                 ┌──────────────┐
 resident ──────►│  SUBMITTED   │
                 └──────┬───────┘
                        │ admin validates + categorizes + confirms priority
                        ▼
                 ┌──────────────┐   routing engine (type → office)
                 │   ASSIGNED   │◄─── Ayuda → Social Services/Assistance Committee
                 └──────┬───────┘     Repair → Maintenance Team/Engineering Office
                        │             Documents → Barangay Secretary
                        │             Budget → Treasurer / AAO
                        ▼
                 ┌────────────────────┐
                 │  UNDER_ASSESSMENT  │  eligibility · inspection · resources · approval
                 │  + manpower plan*  │  workersNeeded* · estimated duration · equipment notes
                 └──────┬─────────────┘
                        │            requiresBudget (AYUDA/BUDGET/REPAIR)
                        ▼
                 ┌────────────────────┐   skippable for DOCUMENTS with a reasoned
                 │  AWAITING_BUDGET   │──► CaseWorkflowOverride(BUDGET_STAGE_SKIP)
                 └──────┬─────────────┘
                        │ earmark approved + funds confirmed
                        ▼
                 ┌──────────────┐   gate: assigned crew ≥ workersNeeded*
                 │  IN_PROGRESS │   else CaseWorkflowOverride(CREW_SHORTFALL, reason*)
                 └──────┬───────┘
                        │ action: release assistance / perform the repair (proof*)
                        ▼
                 ┌──────────────┐
                 │   RESOLVED   │   resolution recorded + proof + verification
                 └──────┬───────┘
                        │ verification & closure: proof, status, notify, completion record
                        ▼
                 ┌──────────────┐
                 │    CLOSED    │
                 └──────────────┘
```

Guards and effects (all enforced inside the transaction, never only in the UI):

| Transition | Guards | Effects |
|---|---|---|
| SUBMITTED → ASSIGNED | admin validation done (`validatedAt`), type + category + priority set | `CaseAssignment`, `AssignedAt`, status history `ASSIGNMENT`, notify office officials + resident |
| ASSIGNED → UNDER_ASSESSMENT | assigned office matches actor (or ADMIN) | `stageEnteredAt` reset, SLA clock per `SlaPolicy` |
| UNDER_ASSESSMENT → AWAITING_BUDGET | assessment `SUBMITTED` with `workersNeeded ≥ 1*`, duration, equipment notes; resources verified | `awaitingBudgetAt`, `CaseAssessment` rows audited, treasury sees the funding request |
| UNDER_ASSESSMENT → IN_PROGRESS | `requiresBudget = false` **or** `BUDGET_STAGE_SKIP` override with reason* | override row, `budgetSkippedAt`, history `OVERRIDE` |
| AWAITING_BUDGET → IN_PROGRESS | earmark approved + treasurer fund certification | ledger `EARMARK` reservation, disbursement draft may exist |
| IN_PROGRESS → RESOLVED | proof photo*, resolution record, crew releases | `ResolutionRecord`, notify resident, feedback request |
| RESOLVED → CLOSED | verification step done (`verifiedAt`, `verificationStatus`) | `closedAt`, completion record, public projection refresh, notify resident |

Manpower rules (stage 3):

- `workersNeeded` is an integer ≥ 1 and is **required** to leave
  `UNDER_ASSESSMENT`; the form marks it `workersNeeded*`. Same for
  `estimatedDurationMinutes*` and `equipmentNotes*`.
- `CrewAssignment` links a case to named `CREW` users. Officials may assign up
  to `workersNeeded` people (the UI shows `2 of 3 assigned`). Assigning more than
  planned requires the same override path, so the plan and reality cannot drift
  silently.
- **Double-booking prevention**: a crew member cannot hold two active
  assignments whose effective windows overlap. Effective window =
  `scheduledStartAt/scheduledEndAt` when set, otherwise
  `stageEnteredAt → stageEnteredAt + estimatedDurationMinutes` for a case that
  has not reached `RESOLVED`. `CrewProfile.maxConcurrentCases = 1` by default and
  raising it is an explicit admin decision.
- **Labor in the cost estimate**: `laborCost` is computed from
  `CrewProfile.hourlyRate|dailyRate × estimatedDurationMinutes × workersNeeded`
  when a rate exists, otherwise entered manually; the derivation is snapshotted in
  `laborCostBasisJson` so an estimate can be explained later. `totalCost` sums
  labor + materials + equipment + other.
- Every change to the plan, the crew list or the estimate writes a
  `CaseStatusHistory` entry (`MANPOWER_PLAN`, `CREW_ASSIGNMENT`,
  `CREW_PROGRESS`) **and** an `Audit` row.

Legacy cases (already `ASSIGNED`/`IN_PROGRESS` at deploy) have no
`CaseAssessment`; they stay workable, are exempt from the crew gate, and are
flagged `no manpower plan recorded` in the UI.

---

## 4. Notification contract (existing service, called as-is)

`src/lib/notifications/service.ts` is not modified. New events map onto its
existing helpers, and the machine-written rows keep the exported
`NOTIFICATION_TYPES` contract exactly as the current SLA scanner uses it:

| New event | Uses |
|---|---|
| Case validated / categorized / priority confirmed | `notifyPriorityChanged` (only when the level actually changes) |
| Assigned or reassigned to an office | `notifyConcernAssigned`, `notifyConcernReassigned`, `notifyResidentAssigned` |
| Entered UNDER_ASSESSMENT / AWAITING_BUDGET / IN_PROGRESS | `notifyStatusChanged` |
| Crew assigned/released, crew progress | `notifyConcernAssigned` to the office officials (crew members are staff, not residents) |
| Resolution recorded | `notifyResolutionRecorded` + `notifyFeedbackRequested` |
| Case closed | `notifyCaseClosed` |
| Dispatch failure / no office | `notifyConcernUnrouted` |
| 48-hour escalation | `NOTIFICATION_TYPES.SLA_BREACHED` rows written inside the same transaction, exactly like `src/lib/cases/sla.ts` does today (the SLA scanner is the one documented writer of this type) |

Delivery channel behaviour (FCM, web push, APNs, the Alerts page) is untouched:
notifications are written to the `Notification` table and the existing push path
picks them up as it does now.

---

## 5. Treasury (COA MOOE)

```
CoaAccount (verified object codes)  FundSource (GF, 20% DF, SEF, trust)
        └──────────────┬───────────────────────┘
                 FiscalYear
                       │
              BudgetAllocation  (appropriation per year + fund + code + office)
                       │
                BudgetEarmark   (reserve for a purpose or a specific case)
                       │
                Disbursement    (pay/ release to beneficiary, supplier or crew)
                       │
            DisbursementApproval (level 1 treasurer "funds available",
                       │          level 2 Captain/AAO approval)
                       ▼
              BudgetLedgerEntry  (append-only: reserved/disbursed/available snapshots)
```

- **Code verification.** `CoaAccount.verificationStatus` gates everything:
  earmarks and disbursements refuse an `UNVERIFIED`/`DEPRECATED` code. Codes ship
  verified against the COA Government Accounting Manual (Chapter 3, MOOE) with
  `verificationSource` + `verificationUrl` recorded; fund sources ship
  `UNVERIFIED` because they depend on the LGU's own appropriation ordinance, so
  the treasurer confirms them in the UI (that confirmation is the point of the
  feature, not a formality).
- **Live balances** are read from the newest `BudgetLedgerEntry` per allocation
  (`availableAfter`, `reservedAfter`, `disbursedAfter`) and recomputable from the
  deltas. `BudgetAllocation.appropriation` is the opening figure only.
- **No overspend:** an earmark/disbursement is rejected when
  `amount > availableAfter`. Adjustment entries must carry a memo and are
  admin-only; they never rewrite history.
- **Separation of duties:** the treasurer prepares and certifies, the Captain
  (AAO) approves, and the same person cannot fill both roles for one voucher
  (`DisbursementApproval.level` unique per approver). Self-approval is rejected in
  the service and covered by a unit test.
- **Case linkage:** `Disbursement.concernId` closes the loop with the workflow:
  an `AYUDA` release is a disbursement; a `REPAIR` job is materials + a labor
  disbursement (`5-02-16-010 Labor and Wages`).

---

## 6. SLA and escalation (48 hours)

*Delivered in stage 5: `src/lib/sla/policy.ts` (pure rules, 21 tests),
`src/lib/sla/escalation.ts` (the run + the desks), `src/lib/cases/sla.ts` (the
facade `src/lib/cases/service.ts` and the concern routes already called).*

- `SlaPolicy` rows resolve per `(stage, typeId?, priorityLevel?)`; the most
  specific active policy wins (equal specificity → lowest id), and the resolved
  policy id is stored on the case (`Concern.slaPolicyId`) so an escalation can be
  explained after the fact. The default is **48 hours** (`SLA_DEFAULT_HOURS`) for
  every open stage, so the system works before anybody writes a policy.
- Two entry points build the clock: `resolveStageWindow(client, scope)` answers
  "what window applies to this case right now", and `armCaseStageClock(tx, …)`
  stores `Concern.slaDueAt` + `slaPolicyId` and re-arms whenever a case enters an
  open stage (`armCaseStageClock` returns `null` for `RESOLVED`/`CLOSED`, and
  re-arming also resolves the case's open escalations via
  `resolveEscalationsForCase`).
- The clock is `Concern.stageEnteredAt` (not `updatedAt`, which edits would move).
- `/api/v1/cron/sla-escalations` (guarded by `CRON_SECRET`, same pattern as the
  existing `/api/v1/cron/email-deliveries`) scans open cases, and for each
  overdue case writes one `CaseEscalation` row keyed by
  `"<concernId>:<stage>:<level>"` — the unique `dedupeKey` makes re-running the
  job harmless — plus a `CaseStatusHistory` entry (`ESCALATION`) and an
  `SLA_BREACHED` notification through the existing service contract.
- Escalations go to `SlaPolicy.escalateToRole` (default `CAPTAIN`, this is also
  the row's `escalatedToRole`) and to the roles in `notifyRoles`; the Captain sees
  a queue (`/captain/escalations`) with an acknowledge action, and a Captain can
  only *resolve* an escalation with a note explaining what happened.
- Levels are capped at 3 (`SLA_MAX_ESCALATION_LEVEL`): level 1 at the deadline,
  level 2 at 2× the window, level 3 at 3×, and level 3 repeats no further because
  the `dedupeKey` for that case/stage is already taken. `SLA_OPEN_STAGES` is the
  five pre-`RESOLVED` statuses; only those stages can escalate.
- Every run is recorded in `CronRun` (counts, duration, errors), so “did the job
  run?” is answerable in the UI instead of by reading logs.
- The desks: `/admin/sla` (queue, counts, policy CRUD via
  `GET|POST /api/v1/admin/sla/policies` and `PATCH …/policies/[id]`, a manual run
  via `POST /api/v1/admin/sla/scan`, and the `CronRun` history) and the Captain's
  queue. `PATCH /api/v1/sla/escalations/[id]` is the acknowledge/resolve action.
- Scheduling: `.github/workflows/sla-cron.yml` runs the escalation job hourly on
  the `20 * * * *` mark and the audit verification weekly (see §7), each calling
  the app's own cron route with `CRON_SECRET` — the same shape as the existing
  email-delivery cron. Vercel cron entries are the documented alternative.

---

## 7. Tamper-evident audit chain

*Delivered in stage 5: `src/lib/audit/chain.ts` (pure hashing rules, 20 tests),
`src/lib/audit/store.ts` (writer, verifier, explorer queries), a chain-aware
`src/lib/audit.ts` — the 70 `recordAudit()` call sites are untouched.*

- `Audit` gains `seq`, `prevHash`, `hash`, `chainVersion`, `actorRole`.
- Append algorithm: `hash = sha256(prevHash + "\n" + canonical(payload))`, where
  the canonical payload is a JSON array of `[field, value]` pairs in a fixed order
  — `seq, action, resourceType, resourceId, userId, actorRole, description, ip,
  createdAt` — so the hash does not depend on key order or on how a JSON
  serializer happens to wander (`undefined` → `null`, `BigInt` → string, `Date` →
  ISO). Genesis `prevHash` is `""`, and `chainVersion` is `1` so the canonical
  form can evolve without invalidating old rows.
- The append happens inside the caller's transaction
  (`appendAuditEntry(tx, …)`), which bumps the singleton `AuditChainState`
  (`id = 1`) `lastSeq`/`lastHash` in the same order: the `UPDATE` takes the row
  lock, so two concurrent writers serialise instead of forking the chain. An
  audited write and its audit row therefore either both land or neither does.
  `appendAuditEntryStandalone()` (used where there is no transaction, e.g. cron
  bookkeeping) retries `P2002`/`P2034`/`P2028` three times before giving up.
- `recordAudit()` keeps its "never break the caller" contract: a failing audit
  write is logged and swallowed (as today), but a *successful* business write can
  no longer be committed without its chain row when they share a transaction.
- Verification (`verifyAuditChain`) walks `seq` order in 500-row batches,
  recomputes every hash and every link, and writes an `AuditVerificationRun`
  (`RUNNING` → `OK`/`BROKEN`/`FAILED`, with `firstBrokenSeq` and the reason). It
  only advances `AuditChainState.lastVerifiedSeq` on `OK` over a complete walk, so
  `auditChainStatus().healthy` means "the last run was `OK` and reached the tip" —
  a broken chain shows as a red banner on `/admin/audit`. The weekly
  `/api/v1/cron/audit-verify` job and the admin "verify now" button
  (`POST /api/v1/admin/audit/verify`, optional `fromSeq`/`toSeq` range) both write
  a run; `/api/v1/admin/audit?digest=1` returns `formatAuditDigest()` — the
  printable, PII-free line an auditor compares against a copy taken earlier.
- Pre-existing rows (no `seq`) are chained once by
  `npm run audit:chain-backfill` (`scripts/audit-chain-backfill.ts`, dry run
  unless `--apply`) in `(createdAt, id)` order, preserving the original
  `createdAt`; the explorer badges them `unchained` and the verifier reports the
  genesis boundary until that has run. A verifier run limited to a range reports
  `boundaryUnverified` instead of pretending the link into the window was checked.
- BigInt is kept away from `NextResponse.json` (which throws on it) by the
  `serialize*` projections in `src/lib/audit/store.ts`; the digest lines are built
  from those strings.
- Honest limitation, documented in the UI: a hash chain proves *internal*
  consistency and makes silent edits detectable; an attacker with write access to
  both the table and `AuditChainState` can still rewrite the whole chain, so the
  weekly `AuditVerificationRun` digest is what an auditor compares against
  (exportable, printable, and included in reports).

---

## 8. RA 10173 privacy architecture

| Control | Implementation |
|---|---|
| Lawful basis & consent | `ConsentRecord` append-only log per purpose + `AppSetting`-driven privacy-notice version; registration requires the notice consent, and withdrawal is a new row |
| Data minimisation | Public pages read `PublicCaseRecord` only; staff read masked fields only |
| Encryption at rest (application layer) | Phone numbers and ID numbers encrypted AES-256-GCM with `PII_ENCRYPTION_KEY` (HKDF-derived subkeys); lookup uses a keyed HMAC so no plaintext index is needed |
| Masking for staff | `phoneLast4` / `idNumberLast4` are the only visible parts; unmasking a full value requires a reason and writes `PiiAccessLog` |
| Rights of the data subject | `DataSubjectRequest` (access, rectification, erasure, portability, objection, complaint) with a 15-working-day `dueAt`; `dsrDeadlineState()` (`src/lib/privacy/dates.ts`) gives the one answer the queue, the desk badge and the report share — the deadline instant decides *late*, the last three working days decide *due soon*; `ErasureExecution` records exactly what was deleted and what had to be retained (audit, treasury, tax) |
| Retention & disposal | `RetentionPolicy` rows per data category, executed by `src/lib/privacy/retention.ts` — daily from `/api/v1/cron/retention` or on demand from `/admin/privacy` — logged in `RetentionRun`. An `ARCHIVE` policy (audit rows, PII access log, DSR records) counts its category and deletes nothing; a `DELETE`/`ANONYMISE` policy only touches rows older than its window, at most `RETENTION_MAX_ROWS` per run, so a backlog is worked off over several nights instead of one destructive sweep. **Legal hold:** while a resident's data-subject request is still `RECEIVED`/`IN_REVIEW`, their rows are skipped by the four destructive policies (`HOLD_SCOPED_POLICY_KEYS`) and counted as `held` — the sweep never destroys the evidence an open claim rests on, and the hold lifts by itself when the request is decided because it is derived, never stored |
| Transparency | Public page + map built from `PublicCaseRecord` (anonymous `BR-PUB-…` reference, coarse geohash, scrubbed title). Withdrawing the publication consent, and completing an erasure request, un-publish the resident's rows immediately (`unpublishResidentRecords`), because the projection is otherwise only refreshed on a case's next status change |
| Accountability | Hash-chained `Audit` + `PiiAccessLog` + `AuditVerificationRun` |

Encryption and masking live in one module (`src/lib/privacy/crypto.ts`,
`src/lib/privacy/phone.ts`) so there is exactly one way personal data is written
and one way it is read.

## 9. Geotagging and the map

- Concern capture stores `locationLat/Lng`, `locationAccuracyM`, `locationSource`
  (`GPS_PINNED`/`MAP_PINNED`/`ADDRESS_GEOCODED`/`MANUAL`), `locationPurok` and a
  `locationGeohash` for clustering. Residents can submit without a pin (text
  address only); the UI marks the pin as required for `REPAIR` cases, where an
  exact location is operationally necessary.
- **Delivered in stage 6**, in two tiers, both over the same OpenStreetMap tile
  host (`src/lib/maps.ts`, unit-tested):
  - `src/components/ui/map-frame.tsx` — a 3×2 mosaic of plain `<img>` tiles with a
    marker positioned by the fractional tile coordinates, the OSM attribution and
    an "open in OpenStreetMap" link. No iframe, no API key, no per-view cost.
    Used as the public transparency preview (zoom 14 over the coarse coordinates,
    so the exact pin is never published) and as the fallback below.
  - `src/components/ui/leaflet-map.tsx` — the interactive view for the staff and
    resident case pages (zoom 16). Leaflet is a dependency installed from npm and
    `import`ed inside the component's effect, so it ships in the app's own bundle,
    only on the pages that show a map, and never on the server. It is configured
    without plugins, workers or remote stylesheets; tiles are still plain `<img>`
    requests. If the chunk or the map fails to initialise, the component renders
    the mosaic above instead — a slow connection never loses the location.
  - It also fixes a production bug: the previous map was an iframe to
    `openstreetmap.org`, and the CSP (`default-src 'self'`, so `frame-src` was
    `'self'`) blocked it — every case page showed an empty box. Tiles need
    `img-src` only, which `next.config.ts` allows for the tile hosts; `connect-src`
    stays `'self'` and `frame-src` stays `'self'`, because Leaflet's script is the
    app's own bundle rather than a third-party origin.
- `locationVerifiedAt/ById` records staff confirmation of the pin (a `REPAIR`
  case assignment to a crew is blocked until the location is confirmed or the
  override path is used).

---

## 10. Design system and mobile-first layouts (stage 6)

*Delivered in stage 6. `src/lib/nav.test.ts`, `src/lib/maps.test.ts`,
`src/lib/cases/public-query.test.ts` and `src/lib/design/form-fields.test.ts`
cover the pure parts; the visual result is the same shell in all six portals.*

- **Tokens first.** `globals.css` keeps Tailwind v4 `@theme` and adds semantic
  tokens: `--color-surface*`, `--color-ink*` (`ink`, `-muted`, `-subtle`, plus the
  deliberately below-AA `-faint` tier for separators, disabled affordances and
  chart neutrals), `--color-line*`, `--color-{success,warning,danger,info}-*`,
  `--radius-control|card`, `--shadow-card|raised|tabbar`, `--container-content`
  and a `--text-*` scale (`display`, `title`, `subtitle`, `body`, `caption`). The
  palette values mirror the slate/emerald/amber/red shades they replace, so the
  change is a rename that makes a rebrand one file — and every migrated component
  now uses those names. The only literals left in the tree are the two surfaces
  kept on the old markup on purpose: `/alerts` (with its diagnostics and the
  admin composer) and `/notifications`.
- **Status colour contract.** One tone per workflow stage, ordered the way a list
  is scanned: `SUBMITTED` sky, `ASSIGNED` violet, `UNDER_ASSESSMENT` blue,
  `AWAITING_BUDGET` amber, `IN_PROGRESS` orange, `RESOLVED` green, `CLOSED` grey —
  rendered by `StatusBadge`, and the two new stages also have their own colour
  (the old badge map only knew five). Priority keeps four levels with text, never
  colour alone. Status *words* are translated too (`statusLabelFor()` +
  `revamp.common.statuses`), which the app previously printed in English inside
  Filipino pages.
- **Figure colour contract.** `StatTone` (`src/lib/design/tones.ts`) is the one
  vocabulary for stat tiles — `default`, `brand`, `success`, `warning`, `danger`,
  `info` — shared by `StatCard` (dashboards) and `ReportStat`
  (`src/lib/reports/document.ts`) and rendered by `ReportView`. A tone is set only
  when the number is itself the finding (an overdue count, a compliance rate below
  target, aged unliquidated money), never as decoration.
- **Mobile-first, thumb-first.** One column on phones with a fixed bottom tab bar
  (`MobileTabBar`): the first four destinations of the role become tabs, the rest
  live behind a "More" sheet; `md` and up swaps to the sticky sidebar (`RoleNav`),
  same destinations, same active logic (`src/lib/nav.ts`, tested — longest match
  wins, a page without its own item highlights its section). Tab height is a token
  (`--tabbar-h`), the footer and content reserve it, and targets are ≥44 px
  (`.tap-target`). `prefers-reduced-motion` was already respected by the motion
  system and still is.
- **Primitives.** `Button`, `Card` (now with an `actions` slot and a `flush`
  variant for tables), `Badge`/`StatusBadge`, `Container`, `Field`
  (`Label` + `*`, `RequiredLegend`, `FieldHint`, `Input`, `Textarea`, `Select`),
  `Table`/`THead`/`TR`/`TH`/`TD` (edge-to-edge horizontal scroll, or — with
  `stack`/`TD label` or a bare `data-stack` on a hand-written table — a stacked
  card per row below `md`),
  `PageHeader`, `EmptyState`, `Pagination`, `Sheet` (bottom sheet for the mobile
  menu) and `MapFrame`. A `<dialog>`/`<tabs>`/`<timeline>` primitive was not built:
  the sheet covers the modals actually needed, filters are links (so they survive a
  reload and can be shared), and the case timeline already lives in
  `src/components/concern/case-timeline.tsx`.
- **Forms and the `*` rule.** `src/lib/design/form-fields.ts` derives requiredness
  from the Zod schema (`required` = the schema rejects `undefined`; a nullable
  field is still required), and `form-fields.test.ts` parses each form's own
  `<Label htmlFor=... required>` markup and fails when a schema-required field is
  unmarked, when an optional field claims to be required, or when a control the
  schema does not know about is not declared (matching passwords, the area picker,
  the required photo upload). The audit it enforces found real gaps and they were
  fixed: the whole resident intake form (title, category, description, area and
  the exact address had no `*` at all), sign-in, reset-password, change-password,
  track-a-case, and the two consent checkboxes on registration.
- **Accessibility.** Focus-visible rings on every control, `aria-current="page"`
  on the active tab/sidebar item, `aria-modal` + Escape + focus handling in the
  sheet, `role="img"` with a label on the map frame, `aria-invalid` on invalid
  controls, and the existing `aria-live` regions kept. The unfilled-marker legend
  is rendered once per form.
- **Page headers.** Every portal page renders `PageHeader` — dashboards, lists and
  detail pages alike. Detail pages use the `eyebrow` slot for the case number or
  reference code and the `actions` slot for status/priority badges and primary
  buttons, so the top of a case page reads the same in all five staff portals.
  Two surfaces keep their own header on purpose: `/profile` (role badge + session
  actions) was folded into `PageHeader.actions`, and the public pages keep their
  kicker + display-type hero (`/`, `/help`, `/privacy`, `/terms`).
- **Mobile tables.** Five hand-written tables (`/admin/privacy`, `/admin/reports`,
  `/admin/sla`, `/official`, `/treasury/budgets`) plus `/transparency` stack into
  one card per row below `md`, each line prefixed by its column heading; the two
  concern queues already had a dedicated phone card list and were left alone.
- **Not done in this stage** (so the docs do not overpromise): the public pages
  were polished in place rather than re-composed (`/`, `/help`, `/track`, `/login`,
  `/register` keep their structure with the new tokens), and the frozen surfaces
  (`/alerts`, `/notifications` and their components) are untouched by design —
  they keep their pre-revamp markup, which is why they still carry a raw `slate-*`
  class or two.

## 11. API and data conventions

- `ok(data)` / `handleError` envelope everywhere; errors carry
  `{ code, message, details? }`, validation errors carry Zod issues.
- Every mutating handler: `assertSameOrigin` → `requireApiPermission(...)` →
  `parseBody(req, schema)` (or capped multipart for uploads) → transaction →
  `recordAudit` → `ok(...)`.
- Pagination: `?page`/`?pageSize` with a hard cap, `{ items, total, page, pageSize }`.
- Dates: calendar days (`YYYY-MM-DD`) for business dates (action dates,
  disbursement dates) using the existing Asia/Manila helpers; `DateTime` for
  system timestamps. Money crosses the API as strings (decimal-safe) and is
  formatted for display only.
- Money/time zone rules from the current codebase (`src/lib/cases/action-date.ts`)
  are reused rather than re-implemented.

## 12. Reports and exports (stage 7)

- **One document shape.** Every report — engineering, treasury, privacy and the
  public transparency aggregates — returns a `ReportDocument`
  (`src/lib/reports/document.ts`): `{ key, title, description?, generatedAt,
  period, stats, sections }`. A section is a table of `columns` + `rows` with an
  optional `bars` array for share visualisation. The screen
  (`src/components/reports/report-view.tsx`), the print layout and the CSV writer
  are therefore built once, and a new report is a new pure module plus its labels
  — no new UI.
- **Periods are vocabulary, not dates.** `?period=` accepts
  `30d | 90d | ytd | 12m | custom | all`; `custom` needs `from`/`to`
  (`YYYY-MM-DD`, Manila). Range maths lives in `src/lib/reports/period.ts` and is
  unit-tested against the +08:00 calendar, because a "day" in this app means a
  Manila day. An unknown or incomplete period falls back to 90 days rather than
  erroring.
- **Aggregates are pure.** Each report module exports pure functions
  (`summarizeVolume`, `summarizeTurnaround`, `summarizeSla`, `summarizeCrew`,
  `summarizeUtilisation`, `liquidationAging`, `summarizeRegister`, `summarizeDsr`,
  `summarizeConsents`, `summarizeRetention`, `summarizePublic*`) over plain rows,
  plus one loader that reads the database. The tests exercise the pure half; the
  DB half is thin by construction. Money and large integers pass through the
  formatters in `document.ts`, never through floating-point arithmetic.
- **One source for the figures.** Numbers a dashboard shows and a report prints
  are computed once. `src/lib/cases/figures.ts` owns what "finished" means
  (`isResolvedStatus`), the named buckets (`PENDING_STATUSES`,
  `HIGH_PRIORITY_LEVELS`), `resolveHours`/`closeHours`, `summarizeDurations` and
  the canonical status, priority and office tallies; `src/lib/treasury/utilisation.ts`
  owns utilisation (`utilisationOf`, `summarizeUtilisation` and the rule that a
  closed allocation is historical). The admin, official and treasury dashboards,
  the admin concern report and the report library all consume those modules, so
  "pending", "high priority", "how long a case takes" and "how much of the MOOE is
  utilised" have one definition each. The clock is submission → resolution
  everywhere — `Concern.submittedAt` is the field the SLA engine and the reports
  already use, and it is the same instant as row creation in practice.
- **Exports are streamed.** `src/lib/reports/stream.ts` writes the CSV in
  chunks of 250 rows (`X-Accel-Buffering: no`), byte-identical to the in-memory
  writer so tests can compare the two. Cells are quoted and formula-guarded
  (`src/lib/reports/csv.ts`): a value starting with `= + - @`, tab or CR gets an
  apostrophe. Resident-supplied text reaches these files.
- **Access is per report, and privacy reports count.** `GET
  /api/v1/reports/[report]` resolves the caller's permission from
  `src/lib/reports/catalog.ts`: engineering takes `report.view.all` or
  `report.view.office` (an office actor is scoped to their own office; `-1` is the
  empty scope), treasury takes `report.view.treasury` and reuses the office-scoped
  query helpers, the privacy report takes `privacy.pii_access.view` and returns
  **counts only — never a masked or raw value**, and the transparency report is
  public by design because it reads `PublicCaseRecord` alone. Every non-public
  export writes one `REPORT_EXPORTED` audit row.
- **The retention sweep is a job with a desk.** `src/lib/privacy/retention.ts`
  plans the due policies (`INACTIVE` / `RECENTLY_RUN 20 h` / `NOT_SELECTED`),
  runs one handler per seeded category, and records a `RetentionRun` per policy
  plus a `CronRun` for the sweep. A handler failure never throws the job: the run
  is marked `FAILED` and `lastRunAt` is not advanced, so the next night retries.
  `retentionDesk()` feeds the `/admin/privacy` card, including how many residents
  are currently on legal hold (an open data-subject request), whose rows the
  destructive policies skip and whose count travels in each run's summary.
