import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrackCaseForm } from "@/components/cases/track-case-form";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "Track a case",
  description:
    "Check the status of a barangay concern with the case number and the email used to submit it.",
};

export default async function TrackPage({
  searchParams,
}: {
  searchParams: Promise<{ case?: string }>;
}) {
  const { case: caseNumber } = await searchParams;
  const initialCaseNumber =
    caseNumber && caseNumber.startsWith("BR-") ? caseNumber : "";
  const locale = await getLocale();
  const t = copy[locale].track;

  return (
    <Container className="flex justify-center py-12">
      <div className="w-full max-w-lg">
        <Card title={t.title} description={t.description}>
          <TrackCaseForm
            initialCaseNumber={initialCaseNumber}
            locale={locale}
          />
          <div className="mt-6 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            <Button href="/login" variant="outline" size="sm">
              {t.signIn}
            </Button>
            <Button href="/help" variant="ghost" size="sm">
              {t.help}
            </Button>
          </div>
        </Card>
      </div>
    </Container>
  );
}
