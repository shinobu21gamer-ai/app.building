import Link from "next/link";
import { CopyCaseNumber } from "@/components/cases/copy-case-number";
import { Button } from "@/components/ui/button";

export function CaseReceipt({
  caseNumber,
  concernId,
}: {
  caseNumber: string;
  concernId?: number;
}) {
  return (
    <div
      role="status"
      className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"
    >
      <p className="text-sm font-semibold text-emerald-950">
        Concern submitted
      </p>
      <p className="mt-1 text-sm leading-relaxed text-emerald-900">
        Keep this case number. Family can also check status with it and the
        email on your account.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <p className="font-mono text-lg font-semibold text-emerald-950">
          {caseNumber}
        </p>
        <CopyCaseNumber caseNumber={caseNumber} />
        {concernId ? (
          <Button
            href={`/resident/concerns/${concernId}/print`}
            variant="outline"
            size="sm"
          >
            Print receipt
          </Button>
        ) : null}
      </div>
      <p className="mt-2 text-sm text-emerald-900">
        Track anytime at{" "}
        <Link
          href={`/track?case=${encodeURIComponent(caseNumber)}`}
          className="font-semibold underline decoration-emerald-300 underline-offset-2"
        >
          Track a case
        </Link>
        .
      </p>
    </div>
  );
}
