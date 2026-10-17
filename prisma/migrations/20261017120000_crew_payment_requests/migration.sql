-- A closed case creates a zero-amount crew payment request. Pay/Hold decisions
-- are per crew member; only a Pay decision creates a draft disbursement voucher.
CREATE TABLE "CrewPaymentRequest" (
    "id" SERIAL NOT NULL,
    "concernId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CrewPaymentRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CrewPaymentRequestLine" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "crewId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "holdReason" TEXT,
    "decidedById" INTEGER,
    "decidedAt" TIMESTAMP(3),
    "disbursementId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CrewPaymentRequestLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CrewPaymentRequest_concernId_key" ON "CrewPaymentRequest"("concernId");
CREATE INDEX "CrewPaymentRequest_status_createdAt_idx" ON "CrewPaymentRequest"("status", "createdAt");
CREATE UNIQUE INDEX "CrewPaymentRequestLine_requestId_crewId_key" ON "CrewPaymentRequestLine"("requestId", "crewId");
CREATE UNIQUE INDEX "CrewPaymentRequestLine_disbursementId_key" ON "CrewPaymentRequestLine"("disbursementId");
CREATE INDEX "CrewPaymentRequestLine_requestId_status_idx" ON "CrewPaymentRequestLine"("requestId", "status");
CREATE INDEX "CrewPaymentRequestLine_crewId_status_idx" ON "CrewPaymentRequestLine"("crewId", "status");

ALTER TABLE "CrewPaymentRequest"
    ADD CONSTRAINT "CrewPaymentRequest_concernId_fkey"
    FOREIGN KEY ("concernId") REFERENCES "Concern"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CrewPaymentRequestLine"
    ADD CONSTRAINT "CrewPaymentRequestLine_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "CrewPaymentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "CrewPaymentRequestLine_crewId_fkey"
    FOREIGN KEY ("crewId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "CrewPaymentRequestLine_decidedById_fkey"
    FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "CrewPaymentRequestLine_disbursementId_fkey"
    FOREIGN KEY ("disbursementId") REFERENCES "Disbursement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
