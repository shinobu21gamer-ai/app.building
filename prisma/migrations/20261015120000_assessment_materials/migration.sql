-- CreateTable
CREATE TABLE "AssessmentMaterial" (
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

    CONSTRAINT "AssessmentMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssessmentMaterial_assessmentId_idx" ON "AssessmentMaterial"("assessmentId");

-- AddForeignKey
ALTER TABLE "AssessmentMaterial" ADD CONSTRAINT "AssessmentMaterial_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "CaseAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
