-- Rollback for 20261012130000_field_checks. Drops the field-check table; any
-- findings recorded in it are lost, so export the table first if they matter.
-- Audit-log entries about field checks are kept; they are append-only.
DROP TABLE IF EXISTS "FieldCheck";
