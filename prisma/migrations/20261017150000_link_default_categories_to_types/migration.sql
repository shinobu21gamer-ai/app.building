-- Link the shipped default categories to the service types the seed maps
-- them to, where nobody has connected them yet. Databases created before
-- the category-to-type connection existed hold these categories with a
-- NULL typeId, which left the validation form with no category to offer
-- for e.g. Repair / Public Works ("No active category is configured for
-- this service type") even though Road Damage was right there. Only
-- unconnected rows are touched: a connection an administrator made is
-- never overridden. NOISE and OTHER stay unconnected on purpose (see the
-- seed); validation offers unconnected categories in their own group and
-- connects the chosen one.
UPDATE "ConcernCategory" AS c
SET "typeId" = t."id",
    "updatedAt" = CURRENT_TIMESTAMP
FROM "ConcernType" AS t
WHERE c."typeId" IS NULL
  AND t."key" = CASE c."code"
    WHEN 'ROAD' THEN 'REPAIR'
    WHEN 'DRAINAGE' THEN 'REPAIR'
    WHEN 'STREETLIGHT' THEN 'REPAIR'
    WHEN 'WASTE' THEN 'REPAIR'
    WHEN 'DOC_REQUEST' THEN 'DOCUMENTS'
    WHEN 'HEALTH' THEN 'AYUDA'
  END;
