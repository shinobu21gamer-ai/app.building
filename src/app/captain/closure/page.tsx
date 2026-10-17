import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { isCloseableVerification } from "@/lib/cases/workflow";
import { formatDateTime } from "@/lib/format";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "Cases to close",
};

export const dynamic = "force-dynamic";

/**
 * Step 8 of the case flow, on the desk the flow names.
 *
 * Closing a resolved case is the approving official's call (`case.status.close`
 * holders: the Captain and administrators), and it may only happen once the
 * proof of completion has been verified as fully fixed. Both actions live on
 * the case sheet itself — this page is the Captain's worklist of resolved
 * cases, showing at a glance which ones are ready to close and which still
 * need the proof read, so the last step of the flow has a place to work from.
 */
export default async function CaptainClosurePage() {
  await requirePermission("case.status.close");
  const locale = await getLocale();
  const t = copy[locale].revamp.captain;

  const cases = await db.concern.findMany({
    where: { status: "RESOLVED" },
    // Longest-waiting first: a resolved case sitting unclosed is the thing this
    // desk exists to notice.
    orderBy: [{ resolvedAt: "asc" }],
    take: 50,
    select: {
      id: true,
      caseNumber: true,
      title: true,
      resolvedAt: true,
      assignedOffice: { select: { name: true } },
      resolutions: { select: { verificationStatus: true, verifiedAt: true } },
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader title={t.closeQueueTitle} description={t.closeQueueLead} />

      {cases.length === 0 ? (
        <Card>
          <EmptyState title={t.closeQueueEmpty} />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {cases.map((item) => {
              const resolution = item.resolutions[0] ?? null;
              // "Verified" here means closable now: fully fixed and checked.
              // Anything else (partial, failed, still unverified) stays amber.
              const verified =
                resolution?.verifiedAt !== null &&
                resolution?.verifiedAt !== undefined &&
                isCloseableVerification(resolution.verificationStatus);
              return (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">
                      <span className="font-mono text-xs text-ink-muted">
                        {item.caseNumber}
                      </span>{" "}
                      · {item.title}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-subtle">
                      {t.closeQueueOffice}: {item.assignedOffice?.name ?? "—"} ·{" "}
                      {t.closeQueueResolvedOn}:{" "}
                      {item.resolvedAt ? formatDateTime(item.resolvedAt) : "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone={verified ? "green" : "amber"}>
                      {t.closeQueueState}:{" "}
                      {verified ? t.closeQueueVerified : t.closeQueueUnverified}
                    </Badge>
                    <Button
                      href={`/official/concerns/${item.id}?returnTo=${encodeURIComponent("/captain/closure")}`}
                      variant="ghost"
                      size="sm"
                    >
                      {t.closeQueueOpen}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <p className="text-sm text-ink-subtle">
        <Link href="/captain" className="text-brand underline">
          {t.title}
        </Link>
      </p>
    </div>
  );
}
