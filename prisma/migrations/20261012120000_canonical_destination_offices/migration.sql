-- Canonical destination offices (follow-up to 20261012000000_revamp_core_schema).
--
-- The revamp migration created destination offices with the codes SOCIAL and
-- MAINTENANCE and pointed the Ayuda and Repair case types at them. The seed
-- creates the offices that actually have officials and crew: SOCIAL_SERVICES
-- and ENGINEERING. So on a database built from the migrations, an Ayuda case
-- was routed to an office with no members, and a Repair case likewise.
--
-- This migration:
--   1. makes sure SOCIAL_SERVICES and ENGINEERING exist (same names as the seed);
--   2. repoints every reference from SOCIAL -> SOCIAL_SERVICES and
--      MAINTENANCE -> ENGINEERING (case types, cases, assignments, users, crew);
--   3. deactivates SOCIAL and MAINTENANCE. They are not deleted, so history keeps
--      its foreign keys and nothing is lost.
--
-- Rollback: UPDATE "Office" SET "isActive" = true WHERE "code" IN ('SOCIAL','MAINTENANCE');
-- and point the references back, reversing the mapping below. No data is dropped.

INSERT INTO "Office" ("name", "code", "description", "headOfficer", "contact", "isActive", "createdAt", "updatedAt") VALUES
  ('Social Services / Assistance Committee', 'SOCIAL_SERVICES', 'Ayuda: financial and in-kind assistance to residents.', NULL, '', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('Maintenance Team / Engineering Office', 'ENGINEERING', 'Repair: infrastructure, drainage, streetlight and facility works.', NULL, '', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('Office of the Barangay Secretary', 'SECRETARY', 'Documents: certificates, clearances and records requests.', NULL, '', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Documents cases had no destination office because SECRETARY did not exist
-- when the revamp migration ran. Point them at it now.
UPDATE "ConcernType" SET "defaultOfficeId" = (SELECT "id" FROM "Office" WHERE "code" = 'SECRETARY')
  WHERE "key" = 'DOCUMENTS' AND "defaultOfficeId" IS NULL;

UPDATE "ConcernType" SET "defaultOfficeId" = (SELECT "id" FROM "Office" WHERE "code" = 'SOCIAL_SERVICES')
  WHERE "defaultOfficeId" = (SELECT "id" FROM "Office" WHERE "code" = 'SOCIAL');
UPDATE "ConcernType" SET "defaultOfficeId" = (SELECT "id" FROM "Office" WHERE "code" = 'ENGINEERING')
  WHERE "defaultOfficeId" = (SELECT "id" FROM "Office" WHERE "code" = 'MAINTENANCE');

UPDATE "Concern" SET "assignedOfficeId" = (SELECT "id" FROM "Office" WHERE "code" = 'SOCIAL_SERVICES')
  WHERE "assignedOfficeId" = (SELECT "id" FROM "Office" WHERE "code" = 'SOCIAL');
UPDATE "Concern" SET "assignedOfficeId" = (SELECT "id" FROM "Office" WHERE "code" = 'ENGINEERING')
  WHERE "assignedOfficeId" = (SELECT "id" FROM "Office" WHERE "code" = 'MAINTENANCE');

UPDATE "CaseAssignment" SET "officeId" = (SELECT "id" FROM "Office" WHERE "code" = 'SOCIAL_SERVICES')
  WHERE "officeId" = (SELECT "id" FROM "Office" WHERE "code" = 'SOCIAL');
UPDATE "CaseAssignment" SET "officeId" = (SELECT "id" FROM "Office" WHERE "code" = 'ENGINEERING')
  WHERE "officeId" = (SELECT "id" FROM "Office" WHERE "code" = 'MAINTENANCE');

UPDATE "User" SET "officeId" = (SELECT "id" FROM "Office" WHERE "code" = 'SOCIAL_SERVICES')
  WHERE "officeId" = (SELECT "id" FROM "Office" WHERE "code" = 'SOCIAL');
UPDATE "User" SET "officeId" = (SELECT "id" FROM "Office" WHERE "code" = 'ENGINEERING')
  WHERE "officeId" = (SELECT "id" FROM "Office" WHERE "code" = 'MAINTENANCE');

UPDATE "CrewProfile" SET "officeId" = (SELECT "id" FROM "Office" WHERE "code" = 'ENGINEERING')
  WHERE "officeId" = (SELECT "id" FROM "Office" WHERE "code" = 'MAINTENANCE');

UPDATE "Office" SET "isActive" = false WHERE "code" IN ('SOCIAL', 'MAINTENANCE');
