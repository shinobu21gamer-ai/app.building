-- CreateTable
CREATE TABLE "AssessmentEquipment" (
    "id" SERIAL NOT NULL,
    "assessmentId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(14,2),
    "unit" TEXT,
    "unitPrice" DECIMAL(14,2),
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentEquipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssessmentEquipment_assessmentId_idx" ON "AssessmentEquipment"("assessmentId");

-- AddForeignKey
ALTER TABLE "AssessmentEquipment" ADD CONSTRAINT "AssessmentEquipment_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "CaseAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
