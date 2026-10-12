-- CreateTable
CREATE TABLE "FieldCheck" (
    "id" SERIAL NOT NULL,
    "concernId" INTEGER NOT NULL,
    "assigneeId" INTEGER NOT NULL,
    "requestedById" INTEGER NOT NULL,
    "instructions" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "finding" TEXT,
    "findingNotes" TEXT,
    "findingPhotoUrl" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedById" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FieldCheck_concernId_status_idx" ON "FieldCheck"("concernId", "status");

-- CreateIndex
CREATE INDEX "FieldCheck_assigneeId_status_idx" ON "FieldCheck"("assigneeId", "status");

-- AddForeignKey
ALTER TABLE "FieldCheck" ADD CONSTRAINT "FieldCheck_concernId_fkey" FOREIGN KEY ("concernId") REFERENCES "Concern"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldCheck" ADD CONSTRAINT "FieldCheck_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldCheck" ADD CONSTRAINT "FieldCheck_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldCheck" ADD CONSTRAINT "FieldCheck_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
