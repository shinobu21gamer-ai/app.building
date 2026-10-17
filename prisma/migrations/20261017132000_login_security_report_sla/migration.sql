CREATE TABLE "LoginSecurityReport" (
  "id" SERIAL NOT NULL,
  "reportedUserId" INTEGER NOT NULL,
  "reportedEmail" TEXT NOT NULL,
  "sourceNotificationId" INTEGER NOT NULL,
  "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "responseDueAt" TIMESTAMP(3) NOT NULL,
  "reminderSentAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" INTEGER,
  CONSTRAINT "LoginSecurityReport_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Notification"
  ADD COLUMN "loginSecurityReportId" INTEGER;

CREATE UNIQUE INDEX "LoginSecurityReport_sourceNotificationId_key"
  ON "LoginSecurityReport"("sourceNotificationId");
CREATE INDEX "LoginSecurityReport_reviewedAt_responseDueAt_idx"
  ON "LoginSecurityReport"("reviewedAt", "responseDueAt");
CREATE INDEX "LoginSecurityReport_reportedUserId_reportedAt_idx"
  ON "LoginSecurityReport"("reportedUserId", "reportedAt");
CREATE INDEX "Notification_loginSecurityReportId_idx"
  ON "Notification"("loginSecurityReportId");

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_loginSecurityReportId_fkey"
  FOREIGN KEY ("loginSecurityReportId") REFERENCES "LoginSecurityReport"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
