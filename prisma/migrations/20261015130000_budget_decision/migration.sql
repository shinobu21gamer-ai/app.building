-- CreateTable
CREATE TABLE "BudgetDecision" (
    "id" SERIAL NOT NULL,
    "concernId" INTEGER NOT NULL,
    "decision" TEXT NOT NULL DEFAULT 'NOT_FUNDED',
    "reason" TEXT NOT NULL,
    "decidedById" INTEGER,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BudgetDecision_concernId_key" ON "BudgetDecision"("concernId");

-- AddForeignKey
ALTER TABLE "BudgetDecision" ADD CONSTRAINT "BudgetDecision_concernId_fkey" FOREIGN KEY ("concernId") REFERENCES "Concern"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetDecision" ADD CONSTRAINT "BudgetDecision_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
