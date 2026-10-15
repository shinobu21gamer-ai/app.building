import Link from "next/link";
import { CopyCaseNumber } from "@/components/cases/copy-case-number";
import {
  CaseContactCard,
  type CaseOffice,
  type CaseOfficial,
} from "@/components/cases/case-owner";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n";
import { copy } from "@/lib/i18n";

export function CaseReceipt({
  caseNumber,
  concernId,
  official,
  office,
  locale = "en",
}: {
  caseNumber: string;
  concernId?: number;
  official?: CaseOfficial;
  office?: CaseOffice;
  locale?: Locale;
}) {
  const t = copy[locale].resident;

  return (
    <div className="space-y-3">
      <div
        role="status"
        className="rounded-card border border-emerald-200 bg-emerald-50 p-4"
      >
        <p className="text-sm font-semibold text-emerald-950">{t.receiptTitle}</p>
        <p className="mt-1 text-sm leading-relaxed text-emerald-900">
          {t.receiptLead}
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
              {t.print}
            </Button>
          ) : null}
        </div>
        <p className="mt-2 text-sm text-emerald-900">
          {t.receiptTrack}{" "}
          <Link
            href={`/track?case=${encodeURIComponent(caseNumber)}`}
            className="font-semibold underline decoration-emerald-300 underline-offset-2"
          >
            {copy[locale].header.track}
          </Link>
          .
        </p>
      </div>
      <CaseContactCard
        official={official}
        office={office}
        title={t.contactTitle}
        lead={t.contactLead}
        officialLabel={t.official}
        officeLabel={t.contactOffice}
        headLabel={t.contactHead}
        empty={t.officialEmpty}
      />
    </div>
  );
}
