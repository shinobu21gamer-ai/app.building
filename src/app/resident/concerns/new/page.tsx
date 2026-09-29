import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SubmitConcernForm } from "@/components/concern/submit-concern-form";

export const metadata: Metadata = {
  title: "Submit Concern",
};

export default async function NewConcernPage() {
  await requireRole(["RESIDENT"]);

  const [categories, factors] = await Promise.all([
    db.concernCategory.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.priorityFactorConfig.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: "asc" },
      select: {
        key: true,
        label: true,
        description: true,
        minScore: true,
        maxScore: true,
      },
    }),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Submit a Concern</h1>
        <p className="mt-1 text-sm text-slate-600">
          Describe the community concern. A case number will be generated and
          you can track its status from My Concerns.
        </p>
      </div>

      <Card>
        {categories.length === 0 || factors.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-slate-600">
              Concern submission is temporarily unavailable because the
              category or priority configuration is incomplete. Please try
              again later.
            </p>
            <Button
              href="/resident/concerns"
              variant="outline"
              className="mt-3"
              size="sm"
            >
              Back to my concerns
            </Button>
          </div>
        ) : (
          <SubmitConcernForm categories={categories} factors={factors} />
        )}
      </Card>
    </div>
  );
}
