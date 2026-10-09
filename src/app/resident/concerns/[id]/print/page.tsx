import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { PrintButton } from "@/components/ui/print-button";
import { CopyCaseNumber } from "@/components/cases/copy-case-number";
import { describeJournalEntry } from "@/components/concern/case-timeline";
import { sortJournal } from "@/lib/cases/journal";
import { formatDate, formatDateTime } from "@/lib/format";
import { hasCoordinates } from "@/lib/maps";
import { copy } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Case receipt",
};

export default async function CasePrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireRole(["RESIDENT"]);
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) notFound();

  const concern = await db.concern.findFirst({
    where: { id: numericId, userId: user.id },
    include: {
      category: { select: { name: true } },
      assignedOffice: { select: { name: true } },
      history: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          createdAt: true,
          occurredOn: true,
          remarks: true,
          fromStatus: true,
          toStatus: true,
          entryType: true,
          attachmentUrl: true,
        },
      },
    },
  });

  if (!concern) notFound();

  const coordinates = { lat: concern.locationLat, lng: concern.locationLng };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Button href={`/resident/concerns/${concern.id}`} variant="ghost" size="sm">
          ← Back to case
        </Button>
        <PrintButton label="Print receipt" />
      </div>

      <article className="rounded-xl border border-slate-200 bg-white p-6 print:border-0 print:p-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
          BarangayResolve
        </p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Case receipt</h1>
        <p className="mt-1 text-sm text-slate-600">
          Present this number at the barangay hall, or use Track a case with
          this number and your account email.
        </p>

        <p className="mt-6 font-mono text-3xl font-bold tracking-wide text-slate-950">
          {concern.caseNumber}
        </p>
        <div className="no-print mt-3">
          <CopyCaseNumber caseNumber={concern.caseNumber} />
        </div>

        <dl className="mt-6 grid gap-3 text-sm">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Title
            </dt>
            <dd className="mt-0.5 font-medium text-slate-900">{concern.title}</dd>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Status
              </dt>
              <dd className="mt-1">
                <StatusBadge status={concern.status} />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Priority
              </dt>
              <dd className="mt-1">
                {concern.priorityLevel ? (
                  <PriorityBadge level={concern.priorityLevel} />
                ) : (
                  "Pending"
                )}
              </dd>
            </div>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Category
            </dt>
            <dd className="mt-0.5 text-slate-900">{concern.category.name}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Location
            </dt>
            <dd className="mt-0.5 text-slate-900">
              {concern.locationAddress}
              {hasCoordinates(coordinates)
                ? ` (${coordinates.lat.toFixed(5)}, ${coordinates.lng.toFixed(5)})`
                : ""}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Assigned office
            </dt>
            <dd className="mt-0.5 text-slate-900">
              {concern.assignedOffice?.name ?? "Not yet routed"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Submitted
            </dt>
            <dd className="mt-0.5 text-slate-900">
              {formatDateTime(concern.submittedAt)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Filed by
            </dt>
            <dd className="mt-0.5 text-slate-900">
              {user.firstName} {user.lastName}
            </dd>
          </div>
        </dl>

        {concern.history.length > 0 ? (
          <section className="mt-8 border-t border-slate-200 pt-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Progress so far
            </h2>
            <ol className="mt-3 space-y-3 text-sm text-slate-700">
              {sortJournal(concern.history).map((entry) => (
                <li key={entry.id} className="break-inside-avoid">
                  <p className="font-medium text-slate-900">
                    {describeJournalEntry(entry, copy.en.desk)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {entry.occurredOn
                      ? `Action date ${formatDate(entry.occurredOn)} · recorded ${formatDateTime(entry.createdAt)}`
                      : `Recorded ${formatDateTime(entry.createdAt)}`}
                  </p>
                  {entry.remarks ? (
                    <p className="mt-0.5">{entry.remarks}</p>
                  ) : null}
                  {entry.attachmentUrl ? (
                    <Image
                      src={entry.attachmentUrl}
                      alt={`Proof photo for case ${concern.caseNumber}`}
                      width={800}
                      height={600}
                      unoptimized
                      className="mt-2 h-auto w-48 max-w-full rounded border border-slate-200"
                    />
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        <p className="mt-8 border-t border-slate-200 pt-4 text-xs text-slate-500">
          Not for life-threatening emergencies. Call 911. This receipt is not
          proof that the issue is already fixed.
        </p>
      </article>
    </div>
  );
}
