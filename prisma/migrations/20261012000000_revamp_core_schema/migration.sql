-- ============================================================================
-- BarangayResolve - revamp core schema
-- ----------------------------------------------------------------------------
-- Adds everything the seven-stage revamp needs at the data layer:
--   * RBAC tables (Permission / RolePermission)
--   * resident identity verification + RA 10173 privacy controls
--     (ConsentRecord, DataSubjectRequest, ErasureExecution, RetentionPolicy,
--      RetentionRun, PiiAccessLog)
--   * concern types, geotag metadata and the PII-free public projection
--   * the new lifecycle's assessment / manpower-plan tables
--     (CaseAssessment, CrewProfile, CrewAssignment, CaseWorkflowOverride)
--   * 48-hour SLA policies and escalation records (SlaPolicy, CaseEscalation)
--   * COA/MOOE treasury tables (CoaAccount, FundSource, FiscalYear,
--     BudgetAllocation, BudgetEarmark, Disbursement, DisbursementApproval,
--     BudgetLedgerEntry)
--   * the tamper-evident audit chain (Audit.seq/prevHash/hash,
--     AuditChainState, AuditVerificationRun) and CronRun bookkeeping.
--
-- Everything is additive: the pre-revamp tables keep their shape, so code that
-- has not been migrated yet (and the frozen alert system) keeps working against
-- this database. No column is dropped here; the plaintext User.phone column is
-- retired in code first (scripts/pii-backfill.ts) and dropped in the stage-5
-- privacy migration.
--
-- ROLLBACK: prisma/rollbacks/20261012000000_revamp_core_schema_rollback.sql
-- (drops exactly what this file creates; see docs/revamp/03-migration-plan.md
-- for the pre-flight backup and post-rollback steps).
-- ============================================================================

-- CreateTable
CREATE TABLE "Permission" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" SERIAL NOT NULL,
    "roleId" INTEGER NOT NULL,
    "permissionId" INTEGER NOT NULL,
    "allowed" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConcernType" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultOfficeId" INTEGER,
    "requiresBudget" BOOLEAN NOT NULL DEFAULT false,
    "requiresCrew" BOOLEAN NOT NULL DEFAULT false,
    "slaHours" INTEGER NOT NULL DEFAULT 48,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL

    CONSTRAINT "ConcernType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrewProfile" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "trade" TEXT,
    "employmentType" TEXT NOT NULL DEFAULT 'JOB_ORDER',
    "hourlyRate" DECIMAL(10,2),
    "dailyRate" DECIMAL(10,2),
    "availability" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "maxConcurrentCases" INTEGER NOT NULL DEFAULT 1,
    "officeId" INTEGER,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL

    CONSTRAINT "CrewProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentityVerification" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "method" TEXT,
    "idTypeLabel" TEXT,
    "idNumberEncrypted" TEXT,
    "idNumberLast4" TEXT,
    "idNumberHash" TEXT,
    "idImageUrl" TEXT,
    "selfieUrl" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedById" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL

    CONSTRAINT "IdentityVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'GRANTED',
    "policyVersion" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'WEB',
    "ip" TEXT,
    "userAgent" TEXT,
    "notes" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSubjectRequest" (
    "id" SERIAL NOT NULL,
    "referenceCode" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "details" TEXT,
    "scopeJson" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "handledById" INTEGER,
    "resolutionNotes" TEXT,
    "denialReason" TEXT,
    "attachmentUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL

    CONSTRAINT "DataSubjectRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErasureExecution" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "executedById" INTEGER,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scopeJson" TEXT,
    "retainedCategoriesJson" TEXT,
    "reportJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP

    CONSTRAINT "ErasureExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionPolicy" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "dataCategory" TEXT NOT NULL,
    "description" TEXT,
    "retentionDays" INTEGER NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'ANONYMIZE',
    "legalBasis" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL

    CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CronRun" (
    "id" SERIAL NOT NULL,
    "job" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "processed" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "error" TEXT,
    "triggerSource" TEXT NOT NULL DEFAULT 'CRON',
    "actorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP

    CONSTRAINT "CronRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionRun" (
    "id" SERIAL NOT NULL,
    "policyId" INTEGER,
    "job" TEXT NOT NULL DEFAULT 'RETENTION',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "scanned" INTEGER NOT NULL DEFAULT 0,
    "affected" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "error" TEXT,
    "triggeredById" INTEGER,
    "cronRunId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP

    CONSTRAINT "RetentionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PiiAccessLog" (
    "id" SERIAL NOT NULL,
    "actorId" INTEGER,
    "subjectUserId" INTEGER NOT NULL,
    "field" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP

    CONSTRAINT "PiiAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseAssessment" (
    "id" SERIAL NOT NULL,
    "concernId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "eligibilityChecked" BOOLEAN NOT NULL DEFAULT false,
    "eligibilityNotes" TEXT,
    "inspectionRequired" BOOLEAN NOT NULL DEFAULT false,
    "inspectionNotes" TEXT,
    "inspectionCompletedAt" TIMESTAMP(3),
    "inspectedById" INTEGER,
    "resourcesVerified" BOOLEAN NOT NULL DEFAULT false,
    "resourcesVerificationNotes" TEXT,
    "resourcesVerifiedAt" TIMESTAMP(3),
    "resourcesVerifiedById" INTEGER,
    "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
    "approvalNotes" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" INTEGER,
    "workersNeeded" INTEGER,
    "estimatedDurationMinutes" INTEGER,
    "scheduledStartAt" TIMESTAMP(3),
    "scheduledEndAt" TIMESTAMP(3),
    "equipmentNotes" TEXT,
    "laborCost" DECIMAL(14,2),
    "materialsCost" DECIMAL(14,2),
    "equipmentCost" DECIMAL(14,2),
    "otherCost" DECIMAL(14,2),
    "totalCost" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "laborCostBasisJson" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdById" INTEGER,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL

    CONSTRAINT "CaseAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrewAssignment" (
    "id" SERIAL NOT NULL,
    "concernId" INTEGER NOT NULL,
    "crewId" INTEGER NOT NULL,
    "taskNote" TEXT,
    "scheduledStartAt" TIMESTAMP(3),
    "scheduledEndAt" TIMESTAMP(3),
    "assignedById" INTEGER,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "releasedById" INTEGER,
    "releaseReason" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL

    CONSTRAINT "CrewAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseWorkflowOverride" (
    "id" SERIAL NOT NULL,
    "concernId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "detailsJson" TEXT,
    "actorId" INTEGER NOT NULL,
    "actorRole" TEXT NOT NULL,
    "approvedById" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP

    CONSTRAINT "CaseWorkflowOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicCaseRecord" (
    "id" SERIAL NOT NULL,
    "publicRef" TEXT NOT NULL,
    "concernId" INTEGER NOT NULL,
    "typeKey" TEXT,
    "categoryName" TEXT,
    "publicTitle" TEXT,
    "status" TEXT NOT NULL,
    "areaLabel" TEXT,
    "geohash" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "responseHours" INTEGER,
    "resolutionType" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "anonymizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL

    CONSTRAINT "PublicCaseRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaPolicy" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "typeId" INTEGER,
    "priorityLevel" TEXT,
    "hours" INTEGER NOT NULL DEFAULT 48,
    "escalateToRole" TEXT NOT NULL DEFAULT 'CAPTAIN',
    "notifyRoles" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL

    CONSTRAINT "SlaPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseEscalation" (
    "id" SERIAL NOT NULL,
    "concernId" INTEGER NOT NULL,
    "policyId" INTEGER,
    "stage" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "hoursOverdue" INTEGER NOT NULL,
    "escalatedToRole" TEXT NOT NULL,
    "escalatedToUserId" INTEGER,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" INTEGER,
    "resolvedAt" TIMESTAMP(3),
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP

    CONSTRAINT "CaseEscalation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoaAccount" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountClass" TEXT NOT NULL DEFAULT 'MOOE',
    "groupCode" TEXT,
    "subObjectCodes" TEXT,
    "description" TEXT,
    "isMooe" BOOLEAN NOT NULL DEFAULT false,
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" INTEGER,
    "verificationSource" TEXT,
    "verificationUrl" TEXT,
    "verificationNotes" TEXT,
    "createdById" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL

    CONSTRAINT "CoaAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundSource" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" INTEGER,
    "verificationSource" TEXT,
    "verificationNotes" TEXT,
    "createdById" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL

    CONSTRAINT "FundSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalYear" (
    "id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "startsOn" TIMESTAMP(3) NOT NULL,
    "endsOn" TIMESTAMP(3) NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "closedAt" TIMESTAMP(3),
    "closedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL

    CONSTRAINT "FiscalYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetAllocation" (
    "id" SERIAL NOT NULL,
    "fiscalYearId" INTEGER NOT NULL,
    "fundSourceId" INTEGER NOT NULL,
    "coaAccountId" INTEGER NOT NULL,
    "officeId" INTEGER,
    "label" TEXT NOT NULL,
    "appropriation" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvedById" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "createdById" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL

    CONSTRAINT "BudgetAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetEarmark" (
    "id" SERIAL NOT NULL,
    "allocationId" INTEGER NOT NULL,
    "concernId" INTEGER,
    "code" TEXT,
    "purpose" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "preparedById" INTEGER,
    "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL

    CONSTRAINT "BudgetEarmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Disbursement" (
    "id" SERIAL NOT NULL,
    "voucherNumber" TEXT,
    "allocationId" INTEGER NOT NULL,
    "earmarkId" INTEGER,
    "concernId" INTEGER,
    "payee" TEXT NOT NULL,
    "payeeType" TEXT NOT NULL DEFAULT 'SUPPLIER',
    "payeeUserId" INTEGER,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "particulars" TEXT NOT NULL,
    "modeOfPayment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "preparedById" INTEGER,
    "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "releasedById" INTEGER,
    "proofUrl" TEXT,
    "liquidationDueAt" TIMESTAMP(3),
    "liquidationStatus" TEXT,
    "liquidationNotes" TEXT,
    "rejectionReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL

    CONSTRAINT "Disbursement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisbursementApproval" (
    "id" SERIAL NOT NULL,
    "disbursementId" INTEGER NOT NULL,
    "approverId" INTEGER NOT NULL,
    "approverRole" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "decision" TEXT NOT NULL,
    "remarks" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP

    CONSTRAINT "DisbursementApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetLedgerEntry" (
    "id" SERIAL NOT NULL,
    "allocationId" INTEGER NOT NULL,
    "entryType" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "memo" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "reservedDelta" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "disbursedDelta" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "reservedAfter" DECIMAL(14,2) NOT NULL,
    "disbursedAfter" DECIMAL(14,2) NOT NULL,
    "availableAfter" DECIMAL(14,2) NOT NULL,
    "actorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP

    CONSTRAINT "BudgetLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditChainState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "lastSeq" BIGINT NOT NULL DEFAULT 0,
    "lastHash" TEXT NOT NULL DEFAULT '',
    "lastVerifiedSeq" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL

    CONSTRAINT "AuditChainState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditVerificationRun" (
    "id" SERIAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "fromSeq" BIGINT NOT NULL,
    "toSeq" BIGINT NOT NULL,
    "checkedCount" INTEGER NOT NULL DEFAULT 0,
    "firstBrokenSeq" BIGINT,
    "detailsJson" TEXT,
    "triggeredBy" TEXT NOT NULL DEFAULT 'CRON',
    "actorId" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP

    CONSTRAINT "AuditVerificationRun_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ConcernCategory"
  ADD COLUMN "typeId" INTEGER;

ALTER TABLE "User"
  ADD COLUMN "phoneEncrypted" TEXT,
  ADD COLUMN "phoneLast4" TEXT,
  ADD COLUMN "phoneHash" TEXT,
  ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "position" TEXT;

ALTER TABLE "Concern"
  ADD COLUMN "typeId" INTEGER,
  ADD COLUMN "locationAccuracyM" DOUBLE PRECISION,
  ADD COLUMN "locationSource" TEXT,
  ADD COLUMN "locationPurok" TEXT,
  ADD COLUMN "locationGeohash" TEXT,
  ADD COLUMN "locationVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "locationVerifiedById" INTEGER,
  ADD COLUMN "stageEnteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "validatedById" INTEGER,
  ADD COLUMN "validatedAt" TIMESTAMP(3),
  ADD COLUMN "validationNotes" TEXT,
  ADD COLUMN "priorityConfirmedById" INTEGER,
  ADD COLUMN "priorityConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "assessmentCompletedAt" TIMESTAMP(3),
  ADD COLUMN "awaitingBudgetAt" TIMESTAMP(3),
  ADD COLUMN "awaitingBudgetResolvedAt" TIMESTAMP(3),
  ADD COLUMN "slaPolicyId" INTEGER;

ALTER TABLE "CaseStatusHistory"
  ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'RESIDENT_VISIBLE',
  ADD COLUMN "metadataJson" TEXT;

ALTER TABLE "ResolutionRecord"
  ADD COLUMN "verifiedById" INTEGER,
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "verificationNotes" TEXT,
  ADD COLUMN "verificationStatus" TEXT NOT NULL DEFAULT 'PENDING';

ALTER TABLE "Audit"
  ADD COLUMN "actorRole" TEXT,
  ADD COLUMN "seq" BIGINT,
  ADD COLUMN "prevHash" TEXT,
  ADD COLUMN "hash" TEXT,
  ADD COLUMN "chainVersion" INTEGER DEFAULT 1;

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");
-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_roleId_permissionId_key" ON "RolePermission"("roleId", "permissionId");
-- CreateIndex
CREATE UNIQUE INDEX "ConcernType_key_key" ON "ConcernType"("key");
-- CreateIndex
CREATE UNIQUE INDEX "CrewProfile_userId_key" ON "CrewProfile"("userId");
-- CreateIndex
CREATE UNIQUE INDEX "IdentityVerification_userId_key" ON "IdentityVerification"("userId");
-- CreateIndex
CREATE UNIQUE INDEX "DataSubjectRequest_referenceCode_key" ON "DataSubjectRequest"("referenceCode");
-- CreateIndex
CREATE UNIQUE INDEX "ErasureExecution_requestId_key" ON "ErasureExecution"("requestId");
-- CreateIndex
CREATE UNIQUE INDEX "RetentionPolicy_key_key" ON "RetentionPolicy"("key");
-- CreateIndex
CREATE UNIQUE INDEX "CaseAssessment_concernId_key" ON "CaseAssessment"("concernId");
-- CreateIndex
CREATE UNIQUE INDEX "CrewAssignment_concernId_crewId_key" ON "CrewAssignment"("concernId", "crewId");
-- CreateIndex
CREATE UNIQUE INDEX "PublicCaseRecord_publicRef_key" ON "PublicCaseRecord"("publicRef");
-- CreateIndex
CREATE UNIQUE INDEX "PublicCaseRecord_concernId_key" ON "PublicCaseRecord"("concernId");
-- CreateIndex
CREATE UNIQUE INDEX "SlaPolicy_key_key" ON "SlaPolicy"("key");
-- CreateIndex
CREATE UNIQUE INDEX "CaseEscalation_dedupeKey_key" ON "CaseEscalation"("dedupeKey");
-- CreateIndex
CREATE UNIQUE INDEX "CoaAccount_code_key" ON "CoaAccount"("code");
-- CreateIndex
CREATE UNIQUE INDEX "FundSource_code_key" ON "FundSource"("code");
-- CreateIndex
CREATE UNIQUE INDEX "FiscalYear_year_key" ON "FiscalYear"("year");
-- CreateIndex
CREATE UNIQUE INDEX "BudgetAllocation_fy_fund_coa_key" ON "BudgetAllocation"("fiscalYearId", "fundSourceId", "coaAccountId", "officeId");
-- CreateIndex
CREATE UNIQUE INDEX "BudgetEarmark_code_key" ON "BudgetEarmark"("code");
-- CreateIndex
CREATE UNIQUE INDEX "Disbursement_voucherNumber_key" ON "Disbursement"("voucherNumber");
-- CreateIndex
CREATE UNIQUE INDEX "DisbursementApproval_disbursementId_level_approverId_key" ON "DisbursementApproval"("disbursementId", "level", "approverId");
-- CreateIndex
CREATE INDEX "ConcernCategory_typeId_idx" ON "ConcernCategory"("typeId");
-- CreateIndex
CREATE INDEX "User_phoneHash_idx" ON "User"("phoneHash");
-- CreateIndex
CREATE INDEX "User_roleId_isActive_idx" ON "User"("roleId", "isActive");
-- CreateIndex
CREATE INDEX "Concern_status_stageEnteredAt_idx" ON "Concern"("status", "stageEnteredAt");
-- CreateIndex
CREATE INDEX "Concern_typeId_status_idx" ON "Concern"("typeId", "status");
-- CreateIndex
CREATE INDEX "Concern_locationGeohash_idx" ON "Concern"("locationGeohash");
-- CreateIndex
CREATE INDEX "CaseStatusHistory_concernId_visibility_idx" ON "CaseStatusHistory"("concernId", "visibility");
-- CreateIndex
CREATE INDEX "Audit_action_createdAt_idx" ON "Audit"("action", "createdAt");

-- CreateIndex
CREATE INDEX "Permission_category_idx" ON "Permission"("category");
-- CreateIndex
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");
-- CreateIndex
CREATE INDEX "ConcernType_defaultOfficeId_idx" ON "ConcernType"("defaultOfficeId");
-- CreateIndex
CREATE INDEX "CrewProfile_availability_isActive_idx" ON "CrewProfile"("availability", "isActive");
-- CreateIndex
CREATE INDEX "CrewProfile_officeId_idx" ON "CrewProfile"("officeId");
-- CreateIndex
CREATE INDEX "IdentityVerification_status_submittedAt_idx" ON "IdentityVerification"("status", "submittedAt");
-- CreateIndex
CREATE INDEX "ConsentRecord_userId_purpose_idx" ON "ConsentRecord"("userId", "purpose");
-- CreateIndex
CREATE INDEX "ConsentRecord_createdAt_idx" ON "ConsentRecord"("createdAt");
-- CreateIndex
CREATE INDEX "DataSubjectRequest_status_dueAt_idx" ON "DataSubjectRequest"("status", "dueAt");
-- CreateIndex
CREATE INDEX "DataSubjectRequest_userId_idx" ON "DataSubjectRequest"("userId");
-- CreateIndex
CREATE INDEX "RetentionPolicy_isActive_idx" ON "RetentionPolicy"("isActive");
-- CreateIndex
CREATE INDEX "CronRun_job_startedAt_idx" ON "CronRun"("job", "startedAt");
-- CreateIndex
CREATE INDEX "CronRun_status_idx" ON "CronRun"("status");
-- CreateIndex
CREATE INDEX "RetentionRun_policyId_startedAt_idx" ON "RetentionRun"("policyId", "startedAt");
-- CreateIndex
CREATE INDEX "RetentionRun_status_idx" ON "RetentionRun"("status");
-- CreateIndex
CREATE INDEX "PiiAccessLog_subjectUserId_createdAt_idx" ON "PiiAccessLog"("subjectUserId", "createdAt");
-- CreateIndex
CREATE INDEX "PiiAccessLog_actorId_createdAt_idx" ON "PiiAccessLog"("actorId", "createdAt");
-- CreateIndex
CREATE INDEX "CaseAssessment_status_idx" ON "CaseAssessment"("status");
-- CreateIndex
CREATE INDEX "CaseAssessment_scheduledStartAt_scheduledEndAt_idx" ON "CaseAssessment"("scheduledStartAt", "scheduledEndAt");
-- CreateIndex
CREATE INDEX "CrewAssignment_crewId_isActive_scheduledStartAt_idx" ON "CrewAssignment"("crewId", "isActive", "scheduledStartAt");
-- CreateIndex
CREATE INDEX "CrewAssignment_concernId_isActive_idx" ON "CrewAssignment"("concernId", "isActive");
-- CreateIndex
CREATE INDEX "CaseWorkflowOverride_concernId_kind_idx" ON "CaseWorkflowOverride"("concernId", "kind");
-- CreateIndex
CREATE INDEX "PublicCaseRecord_status_submittedAt_idx" ON "PublicCaseRecord"("status", "submittedAt");
-- CreateIndex
CREATE INDEX "PublicCaseRecord_typeKey_idx" ON "PublicCaseRecord"("typeKey");
-- CreateIndex
CREATE INDEX "PublicCaseRecord_geohash_idx" ON "PublicCaseRecord"("geohash");
-- CreateIndex
CREATE INDEX "SlaPolicy_stage_isActive_idx" ON "SlaPolicy"("stage", "isActive");
-- CreateIndex
CREATE INDEX "SlaPolicy_typeId_idx" ON "SlaPolicy"("typeId");
-- CreateIndex
CREATE INDEX "CaseEscalation_concernId_createdAt_idx" ON "CaseEscalation"("concernId", "createdAt");
-- CreateIndex
CREATE INDEX "CaseEscalation_escalatedToUserId_acknowledgedAt_idx" ON "CaseEscalation"("escalatedToUserId", "acknowledgedAt");
-- CreateIndex
CREATE INDEX "CoaAccount_accountClass_isActive_idx" ON "CoaAccount"("accountClass", "isActive");
-- CreateIndex
CREATE INDEX "CoaAccount_verificationStatus_idx" ON "CoaAccount"("verificationStatus");
-- CreateIndex
CREATE INDEX "FundSource_isActive_idx" ON "FundSource"("isActive");
-- CreateIndex
CREATE INDEX "BudgetAllocation_fiscalYearId_status_idx" ON "BudgetAllocation"("fiscalYearId", "status");
-- CreateIndex
CREATE INDEX "BudgetAllocation_officeId_idx" ON "BudgetAllocation"("officeId");
-- CreateIndex
CREATE INDEX "BudgetEarmark_allocationId_status_idx" ON "BudgetEarmark"("allocationId", "status");
-- CreateIndex
CREATE INDEX "BudgetEarmark_concernId_idx" ON "BudgetEarmark"("concernId");
-- CreateIndex
CREATE INDEX "Disbursement_allocationId_status_idx" ON "Disbursement"("allocationId", "status");
-- CreateIndex
CREATE INDEX "Disbursement_concernId_idx" ON "Disbursement"("concernId");
-- CreateIndex
CREATE INDEX "Disbursement_status_submittedAt_idx" ON "Disbursement"("status", "submittedAt");
-- CreateIndex
CREATE INDEX "DisbursementApproval_disbursementId_idx" ON "DisbursementApproval"("disbursementId");
-- CreateIndex
CREATE INDEX "BudgetLedgerEntry_allocationId_createdAt_idx" ON "BudgetLedgerEntry"("allocationId", "createdAt");
-- CreateIndex
CREATE INDEX "BudgetLedgerEntry_referenceType_referenceId_idx" ON "BudgetLedgerEntry"("referenceType", "referenceId");
-- CreateIndex
CREATE INDEX "AuditVerificationRun_startedAt_idx" ON "AuditVerificationRun"("startedAt");
-- CreateIndex
CREATE INDEX "AuditVerificationRun_status_idx" ON "AuditVerificationRun"("status");

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ConcernType" ADD CONSTRAINT "ConcernType_defaultOfficeId_fkey" FOREIGN KEY ("defaultOfficeId") REFERENCES "Office"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CrewProfile" ADD CONSTRAINT "CrewProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CrewProfile" ADD CONSTRAINT "CrewProfile_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "IdentityVerification" ADD CONSTRAINT "IdentityVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "IdentityVerification" ADD CONSTRAINT "IdentityVerification_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_handledById_fkey" FOREIGN KEY ("handledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ErasureExecution" ADD CONSTRAINT "ErasureExecution_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "DataSubjectRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ErasureExecution" ADD CONSTRAINT "ErasureExecution_executedById_fkey" FOREIGN KEY ("executedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "RetentionPolicy" ADD CONSTRAINT "RetentionPolicy_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CronRun" ADD CONSTRAINT "CronRun_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "RetentionRun" ADD CONSTRAINT "RetentionRun_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "RetentionPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "RetentionRun" ADD CONSTRAINT "RetentionRun_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "RetentionRun" ADD CONSTRAINT "RetentionRun_cronRunId_fkey" FOREIGN KEY ("cronRunId") REFERENCES "CronRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "PiiAccessLog" ADD CONSTRAINT "PiiAccessLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "PiiAccessLog" ADD CONSTRAINT "PiiAccessLog_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CaseAssessment" ADD CONSTRAINT "CaseAssessment_concernId_fkey" FOREIGN KEY ("concernId") REFERENCES "Concern"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CaseAssessment" ADD CONSTRAINT "CaseAssessment_inspectedById_fkey" FOREIGN KEY ("inspectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CaseAssessment" ADD CONSTRAINT "CaseAssessment_resourcesVerifiedById_fkey" FOREIGN KEY ("resourcesVerifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CaseAssessment" ADD CONSTRAINT "CaseAssessment_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CaseAssessment" ADD CONSTRAINT "CaseAssessment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CaseAssessment" ADD CONSTRAINT "CaseAssessment_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CrewAssignment" ADD CONSTRAINT "CrewAssignment_concernId_fkey" FOREIGN KEY ("concernId") REFERENCES "Concern"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CrewAssignment" ADD CONSTRAINT "CrewAssignment_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CrewAssignment" ADD CONSTRAINT "CrewAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CrewAssignment" ADD CONSTRAINT "CrewAssignment_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CaseWorkflowOverride" ADD CONSTRAINT "CaseWorkflowOverride_concernId_fkey" FOREIGN KEY ("concernId") REFERENCES "Concern"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CaseWorkflowOverride" ADD CONSTRAINT "CaseWorkflowOverride_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CaseWorkflowOverride" ADD CONSTRAINT "CaseWorkflowOverride_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "PublicCaseRecord" ADD CONSTRAINT "PublicCaseRecord_concernId_fkey" FOREIGN KEY ("concernId") REFERENCES "Concern"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "SlaPolicy" ADD CONSTRAINT "SlaPolicy_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "ConcernType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "SlaPolicy" ADD CONSTRAINT "SlaPolicy_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CaseEscalation" ADD CONSTRAINT "CaseEscalation_concernId_fkey" FOREIGN KEY ("concernId") REFERENCES "Concern"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CaseEscalation" ADD CONSTRAINT "CaseEscalation_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "SlaPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CaseEscalation" ADD CONSTRAINT "CaseEscalation_escalatedToUserId_fkey" FOREIGN KEY ("escalatedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CaseEscalation" ADD CONSTRAINT "CaseEscalation_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CoaAccount" ADD CONSTRAINT "CoaAccount_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "CoaAccount" ADD CONSTRAINT "CoaAccount_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "FundSource" ADD CONSTRAINT "FundSource_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "FundSource" ADD CONSTRAINT "FundSource_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "FiscalYear" ADD CONSTRAINT "FiscalYear_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "BudgetAllocation" ADD CONSTRAINT "BudgetAllocation_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "FiscalYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "BudgetAllocation" ADD CONSTRAINT "BudgetAllocation_fundSourceId_fkey" FOREIGN KEY ("fundSourceId") REFERENCES "FundSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "BudgetAllocation" ADD CONSTRAINT "BudgetAllocation_coaAccountId_fkey" FOREIGN KEY ("coaAccountId") REFERENCES "CoaAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "BudgetAllocation" ADD CONSTRAINT "BudgetAllocation_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "BudgetAllocation" ADD CONSTRAINT "BudgetAllocation_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "BudgetAllocation" ADD CONSTRAINT "BudgetAllocation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "BudgetEarmark" ADD CONSTRAINT "BudgetEarmark_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "BudgetAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "BudgetEarmark" ADD CONSTRAINT "BudgetEarmark_concernId_fkey" FOREIGN KEY ("concernId") REFERENCES "Concern"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "BudgetEarmark" ADD CONSTRAINT "BudgetEarmark_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "BudgetEarmark" ADD CONSTRAINT "BudgetEarmark_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Disbursement" ADD CONSTRAINT "Disbursement_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "BudgetAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Disbursement" ADD CONSTRAINT "Disbursement_earmarkId_fkey" FOREIGN KEY ("earmarkId") REFERENCES "BudgetEarmark"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Disbursement" ADD CONSTRAINT "Disbursement_concernId_fkey" FOREIGN KEY ("concernId") REFERENCES "Concern"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Disbursement" ADD CONSTRAINT "Disbursement_payeeUserId_fkey" FOREIGN KEY ("payeeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Disbursement" ADD CONSTRAINT "Disbursement_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Disbursement" ADD CONSTRAINT "Disbursement_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "DisbursementApproval" ADD CONSTRAINT "DisbursementApproval_disbursementId_fkey" FOREIGN KEY ("disbursementId") REFERENCES "Disbursement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "DisbursementApproval" ADD CONSTRAINT "DisbursementApproval_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "BudgetLedgerEntry" ADD CONSTRAINT "BudgetLedgerEntry_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "BudgetAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "BudgetLedgerEntry" ADD CONSTRAINT "BudgetLedgerEntry_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "AuditVerificationRun" ADD CONSTRAINT "AuditVerificationRun_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ConcernCategory" ADD CONSTRAINT "ConcernCategory_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "ConcernType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Concern" ADD CONSTRAINT "Concern_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "ConcernType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Concern" ADD CONSTRAINT "Concern_locationVerifiedById_fkey" FOREIGN KEY ("locationVerifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Concern" ADD CONSTRAINT "Concern_validatedById_fkey" FOREIGN KEY ("validatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Concern" ADD CONSTRAINT "Concern_priorityConfirmedById_fkey" FOREIGN KEY ("priorityConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Concern" ADD CONSTRAINT "Concern_slaPolicyId_fkey" FOREIGN KEY ("slaPolicyId") REFERENCES "SlaPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ResolutionRecord" ADD CONSTRAINT "ResolutionRecord_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- Data backfill (existing rows only - no schema change)
-- ============================================================================

-- The escalation clock is driven by Concern.stageEnteredAt. Existing cases get
-- the timestamp of the last status change that produced their current status,
-- falling back to the submission time. Without this, every open case would look
-- like it just entered its stage and no escalation would ever fire.
UPDATE "Concern" c
SET "stageEnteredAt" = COALESCE(
  (
    SELECT MAX(h."createdAt")
    FROM "CaseStatusHistory" h
    WHERE h."concernId" = c."id"
      AND (h."toStatus" = c."status" OR (h."fromStatus" = c."status" AND h."toStatus" = c."status"))
  ),
  c."submittedAt"
);

-- Map the pre-revamp categories onto the four concern types so routing keeps
-- working for existing data. Types are data-driven (ConcernType), so this is an
-- UPDATE, not a constraint. Categories left null (NOISE, OTHER) surface on the
-- admin "needs categorization" queue instead of being guessed at.
UPDATE "ConcernCategory" SET "typeId" = (SELECT "id" FROM "ConcernType" WHERE "key" = 'REPAIR')
  WHERE "code" IN ('ROAD', 'DRAINAGE', 'STREETLIGHT', 'WASTE') AND "typeId" IS NULL;
UPDATE "ConcernCategory" SET "typeId" = (SELECT "id" FROM "ConcernType" WHERE "key" = 'AYUDA')
  WHERE "code" IN ('HEALTH', 'ASSISTANCE', 'MEDICAL', 'BURIAL', 'EDUCATIONAL') AND "typeId" IS NULL;
UPDATE "ConcernCategory" SET "typeId" = (SELECT "id" FROM "ConcernType" WHERE "key" = 'DOCUMENTS')
  WHERE "code" IN ('DOC_REQUEST', 'CERTIFICATE', 'CLEARANCE') AND "typeId" IS NULL;
UPDATE "ConcernCategory" SET "typeId" = (SELECT "id" FROM "ConcernType" WHERE "key" = 'BUDGET')
  WHERE "code" IN ('BUDGET_REQUEST', 'FUND_SUPPORT') AND "typeId" IS NULL;

-- Existing cases inherit the type of their category.
UPDATE "Concern" c
SET "typeId" = cc."typeId"
FROM "ConcernCategory" cc
WHERE c."categoryId" = cc."id" AND c."typeId" IS NULL AND cc."typeId" IS NOT NULL;

-- ============================================================================
-- Reference data the revamp cannot work without (idempotent)
-- ----------------------------------------------------------------------------
-- Roles, the four concern types and their destination offices, the 48-hour SLA
-- policies, retention rules, and the COA object codes used by the treasury
-- module. Re-running this migration's statements is safe: every insert is
-- ON CONFLICT DO NOTHING and every wiring step is a guarded UPDATE.
--
-- The permission catalogue is NOT seeded here - it is derived from the code
-- matrix in src/lib/auth/rbac.ts and bootstrapped by the stage-2 script
-- (npm run db:bootstrap-rbac), so the two can never drift.
-- ============================================================================

-- Roles ---------------------------------------------------------------------
INSERT INTO "Role" ("key", "name", "description", "createdAt", "updatedAt") VALUES
  ('RESIDENT',  'Resident',                'Community member who submits and tracks concerns.',                              CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('OFFICIAL',  'Barangay Official',       'Barangay staff who process and act on assigned cases.',                          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ADMIN',     'Administrator',           'System administrator with full configuration access.',                           CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('TREASURER', 'Barangay Treasurer',      'Certifies fund availability and records disbursements.',                         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('CAPTAIN',   'Barangay Captain / AAO',  'Authorized Approving Official; approves budget releases and overrides.',         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('CREW',      'Maintenance Crew',        'Named crew member assigned to repair and assistance work.',                      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- Destination offices required by the four service types --------------------
INSERT INTO "Office" ("name", "code", "description", "headOfficer", "contact", "isActive", "createdAt", "updatedAt") VALUES
  ('Social Services / Assistance Committee', 'SOCIAL',      'Ayuda: financial and in-kind assistance to residents.',        NULL, '', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('Maintenance Team / Engineering Office',  'MAINTENANCE', 'Repair: infrastructure, drainage, streetlight and facility works.', NULL, '', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('Office of the Barangay Treasurer',       'TREASURY',    'Budget: fund availability, earmarks, disbursements and liquidation.', NULL, '', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Concern types -------------------------------------------------------------
INSERT INTO "ConcernType" ("key", "name", "description", "requiresBudget", "requiresCrew", "slaHours", "displayOrder", "isActive", "createdAt", "updatedAt") VALUES
  ('AYUDA',     'Ayuda / Assistance', 'Financial or in-kind assistance to a resident.',            true,  false, 48, 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('REPAIR',    'Repair / Public Works', 'Repairs to roads, drainage, lights and facilities.',      true,  true,  48, 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('DOCUMENTS', 'Documents / Records', 'Barangay certificates, clearances and records requests.',   false, false, 48, 3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('BUDGET',    'Budget / Fund Support', 'Requests that need an appropriation or a fund release.',  true,  false, 48, 4, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

UPDATE "ConcernType" SET "defaultOfficeId" = (SELECT "id" FROM "Office" WHERE "code" = 'SOCIAL')
  WHERE "key" = 'AYUDA' AND "defaultOfficeId" IS NULL;
UPDATE "ConcernType" SET "defaultOfficeId" = (SELECT "id" FROM "Office" WHERE "code" = 'MAINTENANCE')
  WHERE "key" = 'REPAIR' AND "defaultOfficeId" IS NULL;
UPDATE "ConcernType" SET "defaultOfficeId" = (SELECT "id" FROM "Office" WHERE "code" = 'SECRETARY')
  WHERE "key" = 'DOCUMENTS' AND "defaultOfficeId" IS NULL;
UPDATE "ConcernType" SET "defaultOfficeId" = (SELECT "id" FROM "Office" WHERE "code" = 'TREASURY')
  WHERE "key" = 'BUDGET' AND "defaultOfficeId" IS NULL;

-- 48-hour SLA policies, one per open lifecycle stage ------------------------
INSERT INTO "SlaPolicy" ("key", "name", "stage", "hours", "escalateToRole", "notifyRoles", "isActive", "createdAt", "updatedAt") VALUES
  ('sla.assigned',          'Assignment clock',        'ASSIGNED',          48, 'CAPTAIN', 'ADMIN,TREASURER', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('sla.under_assessment',  'Assessment clock',        'UNDER_ASSESSMENT',  48, 'CAPTAIN', 'ADMIN,TREASURER', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('sla.awaiting_budget',   'Budget clock',            'AWAITING_BUDGET',   48, 'CAPTAIN', 'ADMIN,TREASURER', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('sla.in_progress',       'Work clock',              'IN_PROGRESS',       48, 'CAPTAIN', 'ADMIN',           true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- Retention rules (RA 10173: keep nothing longer than necessary) ------------
INSERT INTO "RetentionPolicy" ("key", "dataCategory", "description", "retentionDays", "action", "legalBasis", "isActive", "createdAt", "updatedAt") VALUES
  ('uploads.concern_images', 'Concern images',        'Photos attached to concerns and resolutions.',                 365,  'DELETE',    'RA 10173 s.11 - storage limitation', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pii.id_verification',    'ID verification',       'Resident ID images and ID numbers captured for verification.', 365,  'DELETE',    'RA 10173 s.11 - storage limitation', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pii.pii_access_log',     'PII access log',        'Who read a resident personal-data field, and why.',             1825, 'ARCHIVE',   'RA 10173 s.16 - accountability',     true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('case.records',           'Case records',          'Concerns, journal entries and resolutions.',                    1825, 'ANONYMIZE', 'COA retention of supporting documents', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('notification.inbox',     'Notification inbox',    'Read in-app notifications.',                                    180,  'DELETE',    'RA 10173 s.11 - storage limitation', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('audit.entries',          'Audit trail',           'Hash-chained audit journal.',                                   3650, 'ARCHIVE',   'RA 10173 s.16 - accountability',     true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('dsr.records',            'Data subject requests', 'Requests, decisions and erasure reports.',                      1825, 'ARCHIVE',   'RA 10173 s.16 - accountability',     true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('session.revoked_tokens', 'Revoked session tokens','Server-side logout blacklist.',                                 7,    'DELETE',    'RA 10173 s.11 - storage limitation', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- COA object codes (Revised Chart of Accounts / UACS) -----------------------
-- Codes verified against the Commission on Audit "Government Accounting
-- Manual - Chapter 3, Description of Accounts (02 Maintenance and Other
-- Operating Expenses)". verificationNotes asks the treasurer to confirm the
-- code against the barangay's approved annual budget before posting to it;
-- treasury actions refuse an unverified or deprecated code.
INSERT INTO "CoaAccount" ("code", "name", "accountClass", "groupCode", "subObjectCodes", "description", "isMooe", "verificationStatus", "verificationSource", "verificationUrl", "verificationNotes", "verifiedAt", "isActive", "createdAt", "updatedAt") VALUES
  ('5-02-01-010', 'Traveling Expenses - Local',                        'MOOE', '01', NULL,            'Movement of officers/employees within the country.',                        true,  'VERIFIED', 'COA GAM Chapter 3 - Description of Accounts (02 MOOE)', 'https://www.coa.gov.ph/wp-content/uploads/ABC-Help/GAM_3/GAM.htm', 'Confirm against the barangay annual budget before use.', CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('5-02-02-010', 'Training Expenses',                                'MOOE', '02', NULL,            'Training, conventions, seminars and workshops.',                            true,  'VERIFIED', 'COA GAM Chapter 3 - Description of Accounts (02 MOOE)', 'https://www.coa.gov.ph/wp-content/uploads/ABC-Help/GAM_3/GAM.htm', 'Confirm against the barangay annual budget before use.', CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('5-02-03-010', 'Office Supplies Expenses',                         'MOOE', '03', NULL,            'Bond paper, ink and similar items issued to end-users.',                    true,  'VERIFIED', 'COA GAM Chapter 3 - Description of Accounts (02 MOOE)', 'https://www.coa.gov.ph/wp-content/uploads/ABC-Help/GAM_3/GAM.htm', 'Confirm against the barangay annual budget before use.', CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('5-02-03-020', 'Accountable Forms Expenses',                       'MOOE', '03', NULL,            'Official receipts, certificates and other accountable forms.',              true,  'VERIFIED', 'COA GAM Chapter 3 - Description of Accounts (02 MOOE)', 'https://www.coa.gov.ph/wp-content/uploads/ABC-Help/GAM_3/GAM.htm', 'Confirm against the barangay annual budget before use.', CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('5-02-03-030', 'Non-Accountable Forms Expenses',                   'MOOE', '03', NULL,            'Pre-printed forms, application forms and the like.',                        true,  'VERIFIED', 'COA GAM Chapter 3 - Description of Accounts (02 MOOE)', 'https://www.coa.gov.ph/wp-content/uploads/ABC-Help/GAM_3/GAM.htm', 'Confirm against the barangay annual budget before use.', CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('5-02-03-060', 'Welfare Goods Expenses',                           'MOOE', '03', NULL,            'Goods issued to people affected by calamities or disasters.',               true,  'VERIFIED', 'COA GAM Chapter 3 - Description of Accounts (02 MOOE)', 'https://www.coa.gov.ph/wp-content/uploads/ABC-Help/GAM_3/GAM.htm', 'Confirm against the barangay annual budget before use.', CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('5-02-03-070', 'Drugs and Medicines Expenses',                     'MOOE', '03', NULL,            'Drugs and medicines issued to end-users.',                                  true,  'VERIFIED', 'COA GAM Chapter 3 - Description of Accounts (02 MOOE)', 'https://www.coa.gov.ph/wp-content/uploads/ABC-Help/GAM_3/GAM.htm', 'Confirm against the barangay annual budget before use.', CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('5-02-03-210', 'Semi-Expendable Machinery and Equipment Expenses', 'MOOE', '03', NULL,            'Semi-expendable machinery and equipment used in operations.',               true,  'VERIFIED', 'COA GAM Chapter 3 - Description of Accounts (02 MOOE)', 'https://www.coa.gov.ph/wp-content/uploads/ABC-Help/GAM_3/GAM.htm', 'Confirm against the barangay annual budget before use.', CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('5-02-03-990', 'Other Supplies and Materials Expenses',            'MOOE', '03', NULL,            'Materials not classified under a specific inventory account.',              true,  'VERIFIED', 'COA GAM Chapter 3 - Description of Accounts (02 MOOE)', 'https://www.coa.gov.ph/wp-content/uploads/ABC-Help/GAM_3/GAM.htm', 'Confirm against the barangay annual budget before use.', CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('5-02-04-010', 'Water Expenses',                                   'MOOE', '04', NULL,            'Water consumed in government operations/projects.',                         true,  'VERIFIED', 'COA GAM Chapter 3 - Description of Accounts (02 MOOE)', 'https://www.coa.gov.ph/wp-content/uploads/ABC-Help/GAM_3/GAM.htm', 'Confirm against the barangay annual budget before use.', CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('5-02-04-020', 'Electricity Expenses',                             'MOOE', '04', NULL,            'Electricity consumed in government operations/projects.',                   true,  'VERIFIED', 'COA GAM Chapter 3 - Description of Accounts (02 MOOE)', 'https://www.coa.gov.ph/wp-content/uploads/ABC-Help/GAM_3/GAM.htm', 'Confirm against the barangay annual budget before use.', CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('5-02-04-990', 'Other Utility Expenses',                           'MOOE', '04', NULL,            'Utilities not falling under a specific utility account.',                   true,  'VERIFIED', 'COA GAM Chapter 3 - Description of Accounts (02 MOOE)', 'https://www.coa.gov.ph/wp-content/uploads/ABC-Help/GAM_3/GAM.htm', 'Confirm against the barangay annual budget before use.', CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('5-02-08-010', 'Demolition and Relocation Expenses',               'MOOE', '08', NULL,            'Demolition of structures and relocation of affected settlers.',             true,  'VERIFIED', 'COA GAM Chapter 3 - Description of Accounts (02 MOOE)', 'https://www.coa.gov.ph/wp-content/uploads/ABC-Help/GAM_3/GAM.htm', 'Confirm against the barangay annual budget before use.', CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('5-02-08-020', 'Desilting and Dredging Expenses',                  'MOOE', '08', NULL,            'Clearing and deepening of canals, creeks and sewerage.',                    true,  'VERIFIED', 'COA GAM Chapter 3 - Description of Accounts (02 MOOE)', 'https://www.coa.gov.ph/wp-content/uploads/ABC-Help/GAM_3/GAM.htm', 'Confirm against the barangay annual budget before use.', CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('5-02-13-030', 'Repairs and Maintenance - Infrastructure Assets',  'MOOE', '13', '01-Road Networks,02-Flood Control Systems,03-Sewer Systems,05-Power Supply Systems,09-Parks, Plazas, Monuments,99-Other Infrastructure Assets', 'Roads, drainage, streetlights, water and power supply systems.', true, 'VERIFIED', 'COA GAM Chapter 3 - Description of Accounts (02 MOOE)', 'https://www.coa.gov.ph/wp-content/uploads/ABC-Help/GAM_3/GAM.htm', 'Confirm against the barangay annual budget before use.', CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('5-02-13-040', 'Repairs and Maintenance - Buildings and Other Structures', 'MOOE', '13', '01-Buildings,02-School Buildings,03-Hospitals and Health Centers,04-Markets,99-Other Structures', 'Repairs to barangay halls, health centers, markets and other structures.', true, 'VERIFIED', 'COA GAM Chapter 3 - Description of Accounts (02 MOOE)', 'https://www.coa.gov.ph/wp-content/uploads/ABC-Help/GAM_3/GAM.htm', 'Confirm against the barangay annual budget before use.', CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('5-02-13-050', 'Repairs and Maintenance - Machinery and Equipment', 'MOOE', '13', '01-Machinery,02-Office Equipment,03-ICT Equipment,08-Construction and Heavy Equipment', 'Repairs to machinery, office, ICT and heavy equipment.', true, 'VERIFIED', 'COA GAM Chapter 3 - Description of Accounts (02 MOOE)', 'https://www.coa.gov.ph/wp-content/uploads/ABC-Help/GAM_3/GAM.htm', 'Confirm against the barangay annual budget before use.', CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('5-02-13-060', 'Repairs and Maintenance - Transportation Equipment', 'MOOE', '13', '01-Motor Vehicles,04-Watercrafts', 'Repairs to motor vehicles and watercraft.', true, 'VERIFIED', 'COA GAM Chapter 3 - Description of Accounts (02 MOOE)', 'https://www.coa.gov.ph/wp-content/uploads/ABC-Help/GAM_3/GAM.htm', 'Confirm against the barangay annual budget before use.', CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('5-02-13-210', 'Repairs and Maintenance - Semi-Expendable Machinery and Equipment', 'MOOE', '13', NULL, 'Repairs to semi-expendable machinery and equipment.', true, 'VERIFIED', 'COA GAM Chapter 3 - Description of Accounts (02 MOOE)', 'https://www.coa.gov.ph/wp-content/uploads/ABC-Help/GAM_3/GAM.htm', 'Confirm against the barangay annual budget before use.', CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('5-02-14-990', 'Subsidies - Others (Financial Assistance to Individuals)', 'MOOE', '14', NULL, 'Financial assistance to individuals and institutions (ayuda).', true, 'VERIFIED', 'COA GAM Chapter 3 - Description of Accounts (02 MOOE)', 'https://www.coa.gov.ph/wp-content/uploads/ABC-Help/GAM_3/GAM.htm', 'Confirm against the barangay annual budget before use.', CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('5-02-15-030', 'Insurance Expenses',                               'MOOE', '15', NULL,            'Premiums for insurable risks of government property.',                      true,  'VERIFIED', 'COA GAM Chapter 3 - Description of Accounts (02 MOOE)', 'https://www.coa.gov.ph/wp-content/uploads/ABC-Help/GAM_3/GAM.htm', 'Confirm against the barangay annual budget before use.', CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('5-02-16-010', 'Labor and Wages',                                  'MOOE', '16', NULL,            'Labor payroll for projects undertaken by administration (crew labor).',     true,  'VERIFIED', 'COA GAM Chapter 3 - Description of Accounts (02 MOOE)', 'https://www.coa.gov.ph/wp-content/uploads/ABC-Help/GAM_3/GAM.htm', 'Confirm against the barangay annual budget before use.', CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Funding sources -----------------------------------------------------------
-- Left UNVERIFIED on purpose: these are set by the LGU's own appropriation
-- ordinance, so the treasurer must confirm the code and the amount before the
-- treasury module will post against them.
INSERT INTO "FundSource" ("code", "name", "description", "verificationStatus", "verificationSource", "isActive", "createdAt", "updatedAt") VALUES
  ('GF',    'Barangay General Fund',        'Regular barangay budget (MOOE and PS).',                          'UNVERIFIED', 'LGU appropriation ordinance - confirm with the Municipal/City Budget Office', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('DF20',  '20% Development Fund',         'Development fund under RA 7160 s.287.',                            'UNVERIFIED', 'LGU appropriation ordinance - confirm with the Municipal/City Budget Office', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('SEF',   'Special Education Fund',       'Special Education Fund receipts.',                                 'UNVERIFIED', 'LGU appropriation ordinance - confirm with the Municipal/City Budget Office', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('TRUST', 'Trust / Donation Fund',        'Funds held in trust or received as donations.',                    'UNVERIFIED', 'LGU appropriation ordinance - confirm with the Municipal/City Budget Office', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Audit chain tip (singleton row id = 1) -------------------------------------
INSERT INTO "AuditChainState" ("id", "lastSeq", "lastHash", "lastVerifiedSeq", "updatedAt")
VALUES (1, 0, '', 0, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- ============================================================================
-- Deliberately NOT part of this migration
-- ----------------------------------------------------------------------------
-- 1. Permission / RolePermission rows - seeded from the code matrix in stage 2
--    (npm run db:bootstrap-rbac), so the catalogue cannot drift from the code.
-- 2. PublicCaseRecord rows for historical cases - created in stage 6 only for
--    cases whose residents have consented to publication, and never by replaying
--    the PII tables blindly (see docs/revamp/06-ui-and-design-system.md).
-- 3. Audit chain values for rows written before the chain existed - the stage-5
--    script scripts/audit-chain-backfill.ts assigns seq/hash in (createdAt, id)
--    order and records the chain genesis in AuditVerificationRun.
-- ============================================================================
