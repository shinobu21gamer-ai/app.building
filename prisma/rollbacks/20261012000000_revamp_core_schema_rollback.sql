-- ============================================================================
-- BarangayResolve - rollback for 20261012000000_revamp_core_schema
-- ----------------------------------------------------------------------------
-- Reverses prisma/migrations/20261012000000_revamp_core_schema/migration.sql.
--
-- READ THIS FIRST
--   * This is destructive: every row written into the new tables, and every
--     value written into the new columns, is lost. The pre-revamp columns
--     (Concern.status, Concern.slaDueAt, User.phone, CaseStatusHistory.entryType
--     values, ...) all still exist, so the application keeps working after the
--     rollback - but the revamp data is gone.
--   * Take a backup first (see docs/revamp/03-migration-plan.md):
--       pg_dump "$DATABASE_URL" -Fc -f barangayresolve-before-rollback.dump
--   * Roll the application back to the pre-revamp release BEFORE running this,
--     so nothing writes to tables that are about to disappear.
--   * After the rollback, mark the migration as rolled back so a later
--     `prisma migrate deploy` re-applies it cleanly:
--       DELETE FROM "_prisma_migrations"
--        WHERE "migration_name" = '20261012000000_revamp_core_schema';
--
-- Only the objects created by that migration are touched. Nothing pre-revamp is
-- dropped, and the frozen alert tables are not referenced at all.
-- ============================================================================

-- Drop the indexes and columns added to pre-existing tables -------------------

-- ConcernCategory
ALTER TABLE "ConcernCategory" DROP COLUMN IF EXISTS "typeId";

-- User
ALTER TABLE "User" DROP COLUMN IF EXISTS "phoneEncrypted";
ALTER TABLE "User" DROP COLUMN IF EXISTS "phoneLast4";
ALTER TABLE "User" DROP COLUMN IF EXISTS "phoneHash";
ALTER TABLE "User" DROP COLUMN IF EXISTS "phoneVerifiedAt";
ALTER TABLE "User" DROP COLUMN IF EXISTS "position";

-- Concern
ALTER TABLE "Concern" DROP COLUMN IF EXISTS "typeId";
ALTER TABLE "Concern" DROP COLUMN IF EXISTS "locationAccuracyM";
ALTER TABLE "Concern" DROP COLUMN IF EXISTS "locationSource";
ALTER TABLE "Concern" DROP COLUMN IF EXISTS "locationPurok";
ALTER TABLE "Concern" DROP COLUMN IF EXISTS "locationGeohash";
ALTER TABLE "Concern" DROP COLUMN IF EXISTS "locationVerifiedAt";
ALTER TABLE "Concern" DROP COLUMN IF EXISTS "locationVerifiedById";
ALTER TABLE "Concern" DROP COLUMN IF EXISTS "stageEnteredAt";
ALTER TABLE "Concern" DROP COLUMN IF EXISTS "validatedById";
ALTER TABLE "Concern" DROP COLUMN IF EXISTS "validatedAt";
ALTER TABLE "Concern" DROP COLUMN IF EXISTS "validationNotes";
ALTER TABLE "Concern" DROP COLUMN IF EXISTS "priorityConfirmedById";
ALTER TABLE "Concern" DROP COLUMN IF EXISTS "priorityConfirmedAt";
ALTER TABLE "Concern" DROP COLUMN IF EXISTS "assessmentCompletedAt";
ALTER TABLE "Concern" DROP COLUMN IF EXISTS "awaitingBudgetAt";
ALTER TABLE "Concern" DROP COLUMN IF EXISTS "awaitingBudgetResolvedAt";
ALTER TABLE "Concern" DROP COLUMN IF EXISTS "slaPolicyId";

-- CaseStatusHistory
ALTER TABLE "CaseStatusHistory" DROP COLUMN IF EXISTS "visibility";
ALTER TABLE "CaseStatusHistory" DROP COLUMN IF EXISTS "metadataJson";

-- ResolutionRecord
ALTER TABLE "ResolutionRecord" DROP COLUMN IF EXISTS "verifiedById";
ALTER TABLE "ResolutionRecord" DROP COLUMN IF EXISTS "verifiedAt";
ALTER TABLE "ResolutionRecord" DROP COLUMN IF EXISTS "verificationNotes";
ALTER TABLE "ResolutionRecord" DROP COLUMN IF EXISTS "verificationStatus";

-- Audit
ALTER TABLE "Audit" DROP COLUMN IF EXISTS "actorRole";
ALTER TABLE "Audit" DROP COLUMN IF EXISTS "seq";
ALTER TABLE "Audit" DROP COLUMN IF EXISTS "prevHash";
ALTER TABLE "Audit" DROP COLUMN IF EXISTS "hash";
ALTER TABLE "Audit" DROP COLUMN IF EXISTS "chainVersion";

-- Drop the revamp tables (reverse of creation order) -------------------------
DROP TABLE IF EXISTS "AuditVerificationRun" CASCADE;
DROP TABLE IF EXISTS "AuditChainState" CASCADE;
DROP TABLE IF EXISTS "BudgetLedgerEntry" CASCADE;
DROP TABLE IF EXISTS "DisbursementApproval" CASCADE;
DROP TABLE IF EXISTS "Disbursement" CASCADE;
DROP TABLE IF EXISTS "BudgetEarmark" CASCADE;
DROP TABLE IF EXISTS "BudgetAllocation" CASCADE;
DROP TABLE IF EXISTS "FiscalYear" CASCADE;
DROP TABLE IF EXISTS "FundSource" CASCADE;
DROP TABLE IF EXISTS "CoaAccount" CASCADE;
DROP TABLE IF EXISTS "CaseEscalation" CASCADE;
DROP TABLE IF EXISTS "SlaPolicy" CASCADE;
DROP TABLE IF EXISTS "PublicCaseRecord" CASCADE;
DROP TABLE IF EXISTS "CaseWorkflowOverride" CASCADE;
DROP TABLE IF EXISTS "CrewAssignment" CASCADE;
DROP TABLE IF EXISTS "CaseAssessment" CASCADE;
DROP TABLE IF EXISTS "PiiAccessLog" CASCADE;
DROP TABLE IF EXISTS "RetentionRun" CASCADE;
DROP TABLE IF EXISTS "CronRun" CASCADE;
DROP TABLE IF EXISTS "RetentionPolicy" CASCADE;
DROP TABLE IF EXISTS "ErasureExecution" CASCADE;
DROP TABLE IF EXISTS "DataSubjectRequest" CASCADE;
DROP TABLE IF EXISTS "ConsentRecord" CASCADE;
DROP TABLE IF EXISTS "IdentityVerification" CASCADE;
DROP TABLE IF EXISTS "CrewProfile" CASCADE;
DROP TABLE IF EXISTS "ConcernType" CASCADE;
DROP TABLE IF EXISTS "RolePermission" CASCADE;
DROP TABLE IF EXISTS "Permission" CASCADE;

-- ============================================================================
-- Done. The database is back to the pre-revamp schema. If the revamp is
-- re-applied later, the migration re-seeds its reference data (idempotent
-- ON CONFLICT DO NOTHING inserts) and re-runs the documented backfills.
-- ============================================================================
