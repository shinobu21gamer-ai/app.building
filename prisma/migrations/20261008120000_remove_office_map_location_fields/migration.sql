-- Office address/map pins were removed from the admin workflow. Keep the
-- earlier migration immutable, then safely remove its now-unused columns.
ALTER TABLE "Office"
  DROP COLUMN IF EXISTS "location",
  DROP COLUMN IF EXISTS "latitude",
  DROP COLUMN IF EXISTS "longitude";
