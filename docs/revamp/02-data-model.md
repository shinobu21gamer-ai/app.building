# Data model — what stage 1 adds, and why

`prisma/schema.prisma` now has **54 models** (26 before). Everything here is
additive: no column is dropped and no pre-revamp table changes shape. Frozen
tables (`SystemAlert*`, `PushSubscription`, `NativePushToken`, `Notification`) are
untouched.

Conventions kept from the existing schema: enum-like values are `String` with the
allowed values in the comment (validated by Zod + services), JSON payloads are
`String` columns (`…Json`), money is `Decimal @db.Decimal(14, 2)`, and every
relation has a Prisma-level name when two models are linked more than once.

---

## 1. New tables (28)

### RBAC

| Model | Key columns | Invariants & notes |
|---|---|---|
| `Permission` | `key` (unique), `category`, `isActive` | Dotted keys, seeded from code (`src/lib/auth/rbac.ts`) |
| `RolePermission` | `roleId`, `permissionId`, `allowed`, `updatedById` | Unique per `(role, permission)`; a row **overrides** the code default, deleting it falls back |

### Organization and identity

| Model | Key columns | Invariants & notes |
|---|---|---|
| `ConcernType` | `key` (`AYUDA`/`REPAIR`/`DOCUMENTS`/`BUDGET`), `defaultOfficeId`, `requiresBudget`, `requiresCrew`, `slaHours` | The type decides the office and whether the case must pass `AWAITING_BUDGET` |
| `CrewProfile` | `userId` (unique), `trade`, `hourlyRate`, `dailyRate`, `availability`, `maxConcurrentCases` | Rates price labor in a case estimate; `maxConcurrentCases` defaults to 1 (no parallel bookings) |
| `IdentityVerification` | `userId` (unique), `status`, `method`, `idNumberEncrypted`, `idNumberLast4`, `idNumberHash`, `reviewedById`, `expiresAt` | One row per resident; re-verification reuses the row so history stays linear; the ID number itself is never returned to staff |

### RA 10173 privacy

| Model | Key columns | Invariants & notes |
|---|---|---|
| `ConsentRecord` | `userId`, `purpose`, `status`, `policyVersion`, `method`, `ip` | Append-only: withdrawal is a new row, never an update. Purposes: `DATA_PROCESSING`, `PRIVACY_NOTICE`, `TRANSPARENCY_PUBLICATION`, `NOTIFICATIONS`, `SMS`, `ID_VERIFICATION` |
| `DataSubjectRequest` | `referenceCode` (unique, `DSR-YYYY-NNNN`), `type`, `status`, `requestedAt`, `dueAt`, `handledById` | `dueAt` = +15 working days; types `ACCESS`/`RECTIFICATION`/`ERASURE`/`PORTABILITY`/`OBJECTION`/`COMPLAINT` |
| `ErasureExecution` | `requestId` (unique), `scopeJson`, `retainedCategoriesJson`, `reportJson` | Records what was erased *and* what was retained under another legal obligation |
| `RetentionPolicy` | `key` (unique), `dataCategory`, `retentionDays`, `action`, `legalBasis` | `action` ∈ `ANONYMIZE`/`DELETE`/`ARCHIVE`; the cron reads these rows, nothing hard-codes a window |
| `RetentionRun` | `policyId`, `job`, `status`, `scanned`, `affected`, `cronRunId` | One row per policy per sweep |
| `PiiAccessLog` | `actorId`, `subjectUserId`, `field`, `purpose`, `resourceType/Id` | Written whenever unmasked personal data is read; the accountability record for staff access |

### Concerns, workflow and manpower

| Model | Key columns | Invariants & notes |
|---|---|---|
| `CaseAssessment` | `concernId` (unique), `status`, `eligibilityChecked`, `inspection*`, `resourcesVerified*`, `approval*`, `workersNeeded`, `estimatedDurationMinutes`, `scheduledStartAt/EndAt`, `equipmentNotes`, `laborCost`, `materialsCost`, `equipmentCost`, `otherCost`, `totalCost`, `laborCostBasisJson` | One per case; `workersNeeded ≥ 1`, duration and equipment notes are mandatory before the case leaves `UNDER_ASSESSMENT`; the cost snapshot keeps labor explainable |
| `CrewAssignment` | `concernId`, `crewId`, `scheduledStartAt/EndAt`, `assignedAt`, `releasedAt`, `isActive` | Unique `(concernId, crewId)`; releasing flips `isActive` (the row is reused on re-assignment). Overlap checks use these windows |
| `CaseWorkflowOverride` | `concernId`, `kind`, `reason` (required), `actorId`, `approvedById` | Append-only exception log; kinds `CREW_SHORTFALL`, `BUDGET_STAGE_SKIP`, `STATUS_FORCE`, `SLA_EXTENSION`, `VALIDATION_BYPASS`, `ASSESSMENT_BYPASS` |
| `PublicCaseRecord` | `publicRef` (unique, `BR-PUB-…`), `concernId` (unique), `typeKey`, `categoryName`, `publicTitle`, `status`, `areaLabel`, `geohash`, `responseHours`, `published` | The **only** table public pages read; no names, no case number, no exact coordinates |

### SLA

| Model | Key columns | Invariants & notes |
|---|---|---|
| `SlaPolicy` | `key` (unique), `stage`, `typeId?`, `priorityLevel?`, `hours` (default 48), `escalateToRole`, `notifyRoles` | Most specific active policy wins; resolved policy id is stored on the case |
| `CaseEscalation` | `concernId`, `stage`, `level`, `hoursOverdue`, `escalatedToRole/UserId`, `acknowledgedById`, `dedupeKey` (unique) | `dedupeKey = "<concernId>:<stage>:<level>"` makes the cron idempotent |

### Treasury

| Model | Key columns | Invariants & notes |
|---|---|---|
| `CoaAccount` | `code` (unique, UACS), `name`, `accountClass`, `groupCode`, `subObjectCodes`, `isMooe`, `verificationStatus`, `verificationSource/Url`, `verifiedById` | `verificationStatus` ∈ `UNVERIFIED`/`VERIFIED`/`DEPRECATED` and **gates** earmarks/disbursements |
| `FundSource` | `code` (unique: `GF`, `DF20`, `SEF`, `TRUST`), `verificationStatus`, `verifiedById` | LGU-specific, shipped `UNVERIFIED` for the treasurer to confirm |
| `FiscalYear` | `year` (unique), `startsOn`, `endsOn`, `isClosed` | Nothing may be posted into a closed year |
| `BudgetAllocation` | `fiscalYearId`, `fundSourceId`, `coaAccountId`, `officeId?`, `appropriation`, `status`, `approvedById` | Unique `(year, fund, code, office)`; `officeId = NULL` means barangay-wide (Postgres allows duplicates across NULLs, so the service enforces one such row) |
| `BudgetEarmark` | `allocationId`, `concernId?`, `code` (unique), `purpose`, `amount`, `status`, `preparedById`, `approvedById` | Reserve money before it moves; `PROPOSED → APPROVED → RESERVED → RELEASED` (or `CANCELLED` with a reason) |
| `Disbursement` | `voucherNumber` (unique), `allocationId`, `earmarkId?`, `concernId?`, `payee`, `payeeType`, `payeeUserId?`, `amount`, `modeOfPayment`, `status`, `preparedById`, `releasedById`, `proofUrl`, `liquidation*` | `DRAFT → PENDING_APPROVAL → APPROVED → RELEASED` (or `REJECTED`/`CANCELLED`); nothing leaves `DRAFT` without approvals |
| `DisbursementApproval` | `disbursementId`, `approverId`, `approverRole`, `level`, `decision`, `remarks` | Unique `(disbursement, level, approver)`; level 1 = treasurer certifies funds, level 2 = Captain/AAO approves |
| `BudgetLedgerEntry` | `allocationId`, `entryType`, `amount`, `reservedDelta`, `disbursedDelta`, `reservedAfter`, `disbursedAfter`, `availableAfter`, `referenceType/Id`, `actorId` | Append-only. Balances are the newest row per allocation and are recomputable from the deltas |

### Operations and audit

| Model | Key columns | Invariants & notes |
|---|---|---|
| `AuditChainState` | singleton `id = 1`, `lastSeq`, `lastHash`, `lastVerifiedSeq` | Row-locked on every append so the chain cannot fork |
| `AuditVerificationRun` | `status` (`OK`/`BROKEN`/`FAILED`), `fromSeq`, `toSeq`, `checkedCount`, `firstBrokenSeq`, `triggeredBy` | Proof-of-verification history; the digest an auditor compares |
| `CronRun` | `job`, `status`, `startedAt`, `finishedAt`, `processed`, `summary`, `error`, `triggerSource` | One row per scheduled job run; answers “did the 48-hour job run?” |

---

## 2. Changed tables (6)

| Table | Added | Notes |
|---|---|---|
| `User` | `phoneEncrypted`, `phoneLast4`, `phoneHash`, `phoneVerifiedAt`, `position` | `phone` (plaintext) stays during the two-phase migration and is dropped in stage 5. `position` prints on reports/clearances. New relation fields for crew profile, identity, consent, DSR, PII access, assessments, crew jobs, overrides, escalations, treasury, cron |
| `ConcernCategory` | `typeId` | Rolls a category up to a concern type; `NULL` = still to be categorized (surfaces on the admin triage queue) |
| `Concern` | `typeId`, `locationAccuracyM`, `locationSource`, `locationPurok`, `locationGeohash`, `locationVerifiedAt`, `locationVerifiedById`, `stageEnteredAt`, `validatedById`, `validatedAt`, `validationNotes`, `priorityConfirmedById`, `priorityConfirmedAt`, `assessmentCompletedAt`, `awaitingBudgetAt`, `awaitingBudgetResolvedAt`, `slaPolicyId` | `stageEnteredAt` drives the SLA clock; new indexes `(status, stageEnteredAt)`, `(typeId, status)`, `(locationGeohash)` |
| `CaseStatusHistory` | `visibility` (`RESIDENT_VISIBLE` default, `INTERNAL`, `SYSTEM`), `metadataJson` | Lets staff keep internal notes out of the resident timeline without deleting evidence. New entry types documented in the schema comment |
| `ResolutionRecord` | `verifiedById`, `verifiedAt`, `verificationNotes`, `verificationStatus` | Step 5 of the flow: verification before closure, by someone other than the recorder |
| `Audit` | `actorRole`, `seq` (unique), `prevHash`, `hash`, `chainVersion` | Chain columns are nullable so pre-revamp rows survive; the backfill script fills them |

---

## 3. Lifecycle values now in use

`Concern.status`: `SUBMITTED → ASSIGNED → UNDER_ASSESSMENT → AWAITING_BUDGET`
(skippable) `→ IN_PROGRESS → RESOLVED → CLOSED`. The previous five values are a
subset, so existing rows remain valid; no data rewrite is required.

`CaseStatusHistory.entryType` keeps its documented set and gains `ASSESSMENT`,
`MANPOWER_PLAN`, `CREW_ASSIGNMENT`, `CREW_PROGRESS`, `ESCALATION`, `BUDGET`,
`DISBURSEMENT`, `OVERRIDE`, `VERIFICATION`.

## 4. Indexes added for the new read paths

| Query | Index |
|---|---|
| Escalation scan (open cases by stage age) | `Concern(status, stageEnteredAt)` |
| Case lists per type | `Concern(typeId, status)` |
| Map clustering | `Concern(locationGeohash)` |
| Resident timelines that hide internal notes | `CaseStatusHistory(concernId, visibility)` |
| Crew availability / double-booking | `CrewAssignment(crewId, isActive, scheduledStartAt)`, `CaseAssessment(scheduledStartAt, scheduledEndAt)` |
| Treasury registers | `Disbursement(status, submittedAt)`, `BudgetEarmark(allocationId, status)`, `BudgetLedgerEntry(allocationId, createdAt)` |
| Audit explorer | `Audit(action, createdAt)`, `Audit(seq)` |
| Ops | `CronRun(job, startedAt)`, `RetentionRun(policyId, startedAt)` |
