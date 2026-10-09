-- Case journal: every official entry records the date the action actually
-- happened (occurredOn), and a status change carries the proof photo that
-- backs it (attachmentUrl). Both columns are nullable so existing rows and
-- automated entries keep their current meaning. Journal rows stay append-only;
-- createdAt is still the moment the entry was recorded.
ALTER TABLE "CaseStatusHistory"
  ADD COLUMN "occurredOn" TIMESTAMP(3),
  ADD COLUMN "attachmentUrl" TEXT;
