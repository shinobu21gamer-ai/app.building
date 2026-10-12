# Migration plan (from the current schema) and rollback

The revamp is delivered as **expand-only** database changes plus code that uses
them. No column is dropped, no table is rewritten, and the pre-revamp application
keeps working against the migrated database. That is deliberate: it lets the
migration ship first, the code ship later, and a rollback of either side happen
without a data restore.

| Migration | Stage | Contents | Rollback |
|---|---|---|---|
| `20261012000000_revamp_core_schema` | 1 | 28 new tables, 34 new columns on 6 tables, 73 indexes/FKs, backfills, seed reference data | `prisma/rollbacks/20261012000000_revamp_core_schema_rollback.sql` |
| *(planned)* `…_rbac_and_privacy` | 2 | `AppSetting`-driven privacy notice version, any column tweaks found while wiring RBAC | same folder convention |
| *(planned)* `…_treasury_refinements` | 4 | Only if the treasury build needs extra columns; the tables already exist | same |
| *(planned)* `…_privacy_phone_drop` | 5 | Drops the legacy plaintext `User.phone` after the backfill is verified | re-adds the column, **data not restorable** (documented) |

Each new migration gets a matching `prisma/rollbacks/<name>_rollback.sql` before it
is merged; stage 1's is already written and reviewed.

---

## 1. Pre-flight (do this before touching production)

```bash
# 1. Backup. Keep the dump until the new code has run for a full business day.
pg_dump "$DIRECT_URL" -Fc -f barangayresolve-$(date +%Y%m%d-%H%M).dump

# 2. Record the current state for the after-comparison.
psql "$DIRECT_URL" -c "select count(*) from \"Concern\";"
psql "$DIRECT_URL" -c "select status, count(*) from \"Concern\" group by 1 order by 1;"
psql "$DIRECT_URL" -c "select count(*) from \"User\" where phone is not null;"
psql "$DIRECT_URL" -c "select migration_name from \"_prisma_migrations\" order by finished_at desc limit 3;"

# 3. Rehearse on a copy of production (or a staging database restored from it).
DATABASE_URL=<staging-url> npx prisma migrate deploy
```

Requirements: PostgreSQL 11+ (the `ADD COLUMN … NOT NULL DEFAULT` statements are
metadata-only there; on older servers they rewrite the table). The app already
targets Postgres via Prisma, so this is normally satisfied. `DIRECT_URL` is used
for migrations when it is set (poolers reject migration connections — the same rule
`scripts/vercel-build.mjs` already follows).

## 2. Applying it

```bash
# Production: the Vercel production build already runs `prisma migrate deploy`
# before `next build` (scripts/vercel-build.mjs). Manually:
npx prisma migrate deploy        # applies pending migrations only

# Development:
npm run db:migrate:dev           # or: npx prisma migrate dev
npm run db:generate              # regenerate the client (also runs on npm install)
```

Order of operations: **migration first, code second.** The migration is additive,
so deploying it ahead of the new code changes nothing for the running (old) app.
Stage 1 therefore ships as a schema-only change with no user-visible behaviour.

### What the stage-1 migration does, in order

1. **CreateTable** — the 28 new tables, ordered so every FK target exists first.
2. **AlterTable** — the new nullable columns on `User`, `ConcernCategory`,
   `Concern`, `CaseStatusHistory`, `ResolutionRecord`, `Audit`. Only
   `Concern.stageEnteredAt` (NOT NULL, default `CURRENT_TIMESTAMP`) and
   `CaseStatusHistory.visibility` (NOT NULL, default `'RESIDENT_VISIBLE'`) are
   non-nullable additions; both have defaults, so existing rows are valid
   immediately.
3. **CreateIndex / AddForeignKey** — 73 index statements and 73 FKs. FK creation
   takes a lock on each new table only.
4. **Backfill** (§3).
5. **Reference data** (§4), all idempotent.

### Locking

`CREATE TABLE`/`CREATE INDEX` touch only new tables. The two non-nullable
`ADD COLUMN`s take a brief `ACCESS EXCLUSIVE` lock on `Concern` /
`CaseStatusHistory` but do no row rewrite on PG 11+. The backfill `UPDATE`s rewrite
the `Concern` rows they match (`stageEnteredAt`, `typeId`) — at barangay volumes
(hundreds to low thousands of cases) this is milliseconds, and at worst a full
table rewrite. For a very large installation, run the two `UPDATE`s out of band
(they are idempotent: they only touch rows where the column is still unset for
`typeId`, and they are safe to re-run for `stageEnteredAt`).

## 3. Backfills

| What | Where | When |
|---|---|---|
| `Concern.stageEnteredAt` ← last status change (or `submittedAt`) | inside the migration (idempotent) | with the migration |
| Legacy `ConcernCategory.typeId` (ROAD/DRAINAGE/STREETLIGHT/WASTE → REPAIR, HEALTH/ASSISTANCE/… → AYUDA, DOC_REQUEST/… → DOCUMENTS, BUDGET_REQUEST/… → BUDGET) | inside the migration | with the migration |
| `Concern.typeId` ← its category's type | inside the migration | with the migration |
| Categories left `NULL` (NOISE, OTHER) | admin triage queue | manually, after go-live |
| `User.phoneEncrypted`/`phoneLast4`/`phoneHash` ← plaintext `phone` | `scripts/pii-backfill.ts` | stage 2, verified before the plaintext column is dropped in stage 5 |
| `Audit.seq`/`prevHash`/`hash` for pre-revamp rows | `scripts/audit-chain-backfill.ts` | stage 5, before enabling the verification job |
| `PublicCaseRecord` for historical cases | `scripts/public-record-backfill.ts`, gated on `ConsentRecord(TRANSPARENCY_PUBLICATION)` and a title that survives scrubbing — the script imports the live path's own `publicationDecision()`, so it can never publish what the app would not | after the consent review (stage 6/7, dry run first: `npm run privacy:public-backfill`) |
| Re-encrypted PII after a key rotation | `scripts/pii-rotate.ts` (rules in `src/lib/privacy/rotate.ts`, unit tested) | whenever `PII_ENCRYPTION_KEY` changes; dry run, then `--apply`, then `--verify` |

## 4. Reference data seeded by the migration

Seeded because production only ever runs `prisma migrate deploy` (never
`prisma seed`):

- 6 `Role` rows (`RESIDENT`, `OFFICIAL`, `ADMIN`, `TREASURER`, `CAPTAIN`, `CREW`).
- 3 destination offices: `SOCIAL` (Social Services / Assistance Committee),
  `MAINTENANCE` (Maintenance Team / Engineering Office), `TREASURY` (Office of the
  Barangay Treasurer) — inserted only if the code is not already taken, so an
  existing installation keeps its own office rows and only adds what is missing.
- 4 `ConcernType` rows, wired to their offices (`SECRETARY` is reused for
  Documents when it exists).
- 4 `SlaPolicy` rows: 48 hours for `ASSIGNED`, `UNDER_ASSESSMENT`,
  `AWAITING_BUDGET`, `IN_PROGRESS`, escalating to `CAPTAIN`, notifying
  `ADMIN,TREASURER`.
- 8 `RetentionPolicy` rows (images 365 d, ID verification 365 d, PII access log
  1825 d, case records 1825 d anonymize, notifications 180 d, audit 3650 d,
  DSR 1825 d, revoked tokens 7 d).
- 22 `CoaAccount` rows for the object codes the four offices actually spend
  against (supplies, utilities, desilting/dredging, repairs & maintenance,
  subsidies-others, labor and wages, …), each carrying its provenance
  (`verificationSource`, `verificationUrl`) and a note asking the treasurer to
  confirm it against the barangay's approved budget.
- 4 `FundSource` rows (`GF`, `DF20`, `SEF`, `TRUST`) left `UNVERIFIED` on purpose.
- The `AuditChainState` singleton (`id = 1`).

Not seeded here (deliberately): the `Permission`/`RolePermission` catalogue
(stage 2, bootstrapped from code with `npm run db:bootstrap-rbac`, so it cannot
drift), and any `PublicCaseRecord` rows.

## 5. Deployment order per stage

| Stage | Database | Code | Rollback path |
|---|---|---|---|
| 1 | apply migration (this doc) | none — no behaviour change | run the rollback SQL (safe: nothing writes the new tables yet) |
| 2 | *(optional migration)* + `db:bootstrap-rbac` + `pii-backfill` | RBAC, roles, verification, privacy | revert code, keep the schema (additive), or roll back the migration |
| 3 | none expected | workflow, assessment, manpower, crew | revert code; new statuses on cases are still valid for the old app (they are extra strings, but old pages will show them unknown — see §7 risk 5) |
| 4 | none expected | treasury modules | revert code; ledger/earmark rows stay for a later re-deploy |
| 5 | `privacy_phone_drop` (two-phase) | SLA cron, audit chain, retention | roll back the drop migration restores the column (values empty) — that is why the drop is last |
| 6 | none | UI/UX | revert code (UI only) |
| 7 | none | reports | revert code |

## 6. Rollback procedure (stage 1)

```bash
# 1. Freeze writes: put the site in maintenance (or scale the web service down).
# 2. Roll the application back to the pre-revamp release.
# 3. Backup one more time, then run the reverse migration:
psql "$DIRECT_URL" -f prisma/rollbacks/20261012000000_revamp_core_schema_rollback.sql

# 4. Tell Prisma the migration is no longer applied, so it can be re-applied later:
psql "$DIRECT_URL" -c "DELETE FROM \"_prisma_migrations\" WHERE \"migration_name\" = '20261012000000_revamp_core_schema';"

# 5. Verify (§8) and unfreeze.
```

The rollback script drops the 34 added columns and the 28 new tables (reverse
creation order, `DROP TABLE IF EXISTS … CASCADE`). It never touches pre-revamp
objects and never references the frozen alert tables. **Data written into the new
tables/columns is lost** — that is the trade-off of an expand/contract rollback,
and it is why step 2 (backup) is mandatory.

Partial rollback during the revamp: if only stage 3 is being rolled back, do
*not* run the stage-1 rollback; the schema stays and only the code reverts. The
stage-1 rollback is for abandoning the revamp entirely.

### PII key rotation (no schema change, still reversible)

`PII_ENCRYPTION_KEY` is the one secret whose loss or change is unrecoverable
without a script, so it gets a procedure of its own:

```bash
# 1. Set the NEW key in PII_ENCRYPTION_KEY and keep the old one as
#    PII_ENCRYPTION_KEY_PREVIOUS (both are read only by the rotation script).
npm run privacy:pii-rotate               # dry run: how many rows move, what fails
npm run privacy:pii-rotate -- --apply     # re-encrypt + re-hash, row by row
npm run privacy:pii-rotate -- --verify    # every row decrypts and its hash matches
# 2. Only after --verify is clean, remove PII_ENCRYPTION_KEY_PREVIOUS.
```

Rotation is two moves per row and they cannot be split: the same secret derives
the AES-256-GCM key **and** the lookup HMAC, so a row re-encrypted without
re-hashing becomes unfindable, and one re-hashed without re-encrypting becomes
unreadable. `src/lib/privacy/rotate.ts` returns both values or neither.

The property that makes it safe to interrupt: each row is one update, a row
already on the new key is detected and skipped (so re-running resumes instead of
double-rotating), and while `PII_ENCRYPTION_KEY_PREVIOUS` is still set the
rotation can be reversed by swapping the two variables and running `--apply`
again — the same script, the same rules.

## 7. Risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | Backfill `UPDATE`s lock `Concern` briefly on a large installation | The statements are idempotent; run them out of band on very large installs. `stageEnteredAt` keeps its `CURRENT_TIMESTAMP` default, so a missed row is still valid |
| 2 | Legacy statuses in flight when the new flow lands | The old values are a subset of the new ones; `ASSIGNED`/`IN_PROGRESS` cases stay workable, are exempt from the crew gate, and are flagged “no manpower plan recorded” |
| 3 | `BudgetAllocation` unique constraint with a `NULL` `officeId` | Postgres treats NULLs as distinct; the service enforces “one barangay-wide line per (year, fund, code)” and the migration plan documents it |
| 4 | Plaintext phone numbers still readable during stages 2–5 | The plaintext column is dual-written until the stage-2 backfill is verified; staff-facing reads switch to the masked value immediately, and the drop is its own migration with its own rollback |
| 5 | Old app reading new status values | Stage 5/6 code deploys with the UI; if a rollback of the *code* happens after some cases advanced, the old pages show an unknown status. Acceptable, and re-deploying the new code resolves it |
| 6 | Escalations firing for stale legacy cases | The migration backfills `stageEnteredAt`, and `SlaPolicy` only starts escalating once the stage-5 cron is enabled; the first run's `CronRun` record and escalation list are reviewed before scheduling it hourly |
| 7 | Audit chain backfill mistakes | `scripts/audit-chain-backfill.ts` runs before the verifier is enabled, writes an `AuditVerificationRun` genesis record, and is re-runnable (it skips rows that already have a `seq`) |
| 8 | Reference data conflicting with an existing installation's rows | Every insert is `ON CONFLICT DO NOTHING` and every wiring step is a guarded `UPDATE … WHERE … IS NULL`; existing offices/codes win |

## 8. Verification after applying (stage 1)

```sql
-- 28 new tables exist
SELECT count(*) FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN ('Permission','RolePermission','ConcernType','CrewProfile',
       'IdentityVerification','ConsentRecord','DataSubjectRequest','ErasureExecution',
       'RetentionPolicy','RetentionRun','PiiAccessLog','CaseAssessment','CrewAssignment',
       'CaseWorkflowOverride','PublicCaseRecord','SlaPolicy','CaseEscalation','CoaAccount',
       'FundSource','FiscalYear','BudgetAllocation','BudgetEarmark','Disbursement',
       'DisbursementApproval','BudgetLedgerEntry','AuditChainState',
       'AuditVerificationRun','CronRun');            -- expect 28

-- new columns on existing tables
SELECT count(*) FROM information_schema.columns
 WHERE table_name = 'Concern' AND column_name IN
   ('typeId','stageEnteredAt','awaitingBudgetAt','slaPolicyId','locationGeohash');  -- expect 5

-- reference data
SELECT count(*) FROM "Role";                -- expect 6
SELECT count(*) FROM "ConcernType";         -- expect 4 (each with a defaultOfficeId)
SELECT count(*) FROM "SlaPolicy";           -- expect 4, all 48
SELECT count(*) FROM "CoaAccount";          -- expect 22, verificationStatus='VERIFIED'
SELECT count(*) FROM "FundSource";          -- expect 4, verificationStatus='UNVERIFIED'
SELECT count(*) FROM "AuditChainState";     -- expect 1

-- backfill spot checks
SELECT count(*) FROM "Concern" WHERE "stageEnteredAt" IS NULL;                     -- expect 0
SELECT status, count(*) FROM "Concern" GROUP BY 1 ORDER BY 1;                      -- unchanged from pre-flight
SELECT count(*) FROM "Concern" c JOIN "ConcernCategory" cc ON cc.id = c."categoryId"
 WHERE cc."typeId" IS NOT NULL AND c."typeId" IS NULL;                             -- expect 0

-- frozen tables untouched (shape and row counts must match the pre-flight numbers)
SELECT count(*) FROM "SystemAlert";
SELECT count(*) FROM "PushSubscription";
SELECT count(*) FROM "NativePushToken";
```

Application-level checks after the later stages: `npm run lint`, `npm run
typecheck`, `npm test` (the unit suite — no database needed), `npm run db:validate`,
the database suite (`npx vitest run --config vitest.db.config.mts`, which CI's
`database` job runs against a `postgres:16` service container after `prisma
migrate deploy`), and the smoke script (`scripts/smoke/run.ts`) against the
deployment.
