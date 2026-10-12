-- Rollback for 20261012120000_canonical_destination_offices.
--
-- Restores what the migration changed that can be restored exactly:
--   * the legacy SOCIAL and MAINTENANCE offices are active again;
--   * the Ayuda and Repair case types point at them again.
--
-- Not restored (recorded here so nobody is surprised):
--   * Concern.assignedOfficeId, CaseAssignment.officeId, User.officeId and
--     CrewProfile.officeId rows that were moved to SOCIAL_SERVICES / ENGINEERING /
--     SECRETARY stay where they are. The original office of each row is not stored,
--     and those offices are the correct ones for the seeded officials and crew.
--     Put them back by hand only if an office was genuinely wrong before.
--   * The SECRETARY office and the DOCUMENTS default stay in place. Removing them
--     would break any history that now points at them.
--
-- Running this restores the routing bug (Ayuda and Repair cases to offices with no
-- members). Use it only when rolling the code back to a version that needs it.

UPDATE "Office" SET "isActive" = true WHERE "code" IN ('SOCIAL', 'MAINTENANCE');

UPDATE "ConcernType" SET "defaultOfficeId" = (SELECT "id" FROM "Office" WHERE "code" = 'SOCIAL')
  WHERE "key" = 'AYUDA';
UPDATE "ConcernType" SET "defaultOfficeId" = (SELECT "id" FROM "Office" WHERE "code" = 'MAINTENANCE')
  WHERE "key" = 'REPAIR';
