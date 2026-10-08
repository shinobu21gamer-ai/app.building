-- Older office records may not have a contact yet. Preserve that fact as an
-- empty value so administrators are prompted to fill it in, then enforce that
-- every new office has a contact value at the database level.
UPDATE "Office" SET "contact" = '' WHERE "contact" IS NULL;
ALTER TABLE "Office" ALTER COLUMN "contact" SET NOT NULL;

-- Offices can store an address and an optional precise map pin.
ALTER TABLE "Office"
  ADD COLUMN "location" TEXT,
  ADD COLUMN "latitude" DOUBLE PRECISION,
  ADD COLUMN "longitude" DOUBLE PRECISION;
