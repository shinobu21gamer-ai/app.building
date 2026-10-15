import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { priorityEvaluationFrom } from "@/lib/priority/engine";
import { describeAffectedPeople } from "@/lib/priority/affected";
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
      assignedOffice: {
        select: { name: true, contact: true, headOfficer: true },
      },
      assignedOfficial: {
        select: { firstName: true, lastName: true, email: true },
      },
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
      assessments: {
        orderBy: { createdAt: "desc" },
        select: { calculationJson: true },
        take: 5,
      },
    },
  });

  if (!concern) notFound();

  const coordinates = { lat: concern.locationLat, lng: concern.locationLng };
  const affectedLine = describeAffectedPeople(
    concern.assessments
      .map((assessment: { calculationJson: string | null }) =>
        priorityEvaluationFrom(assessment.calculationJson)?.affectedPeople
      )
      .find(
        (value: number | null | undefined) =>
          value !== null && value !== undefined
      ) ?? null
  );

  return (
    <div className="print-sheet mx-auto max-w-xl space-y-6">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Button href={`/resident/concerns/${concern.id}`} variant="ghost" size="sm">
          ← Back to case
        </Button>
        <PrintButton label="Print receipt" />
      </div>

      <article className="rounded-card border border-line bg-surface p-6 print:border-0 print:p-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
          BarangayResolve
        </p>
        <h1 className="mt-1 text-ink text-title sm:text-display">Case receipt</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Present this number at the barangay hall, or use Track a case with
          this number and your account email.
        </p>

        <p className="mt-6 font-mono text-3xl font-bold tracking-wide text-ink">
          {concern.caseNumber}
        </p>
        <div className="no-print mt-3">
          <CopyCaseNumber caseNumber={concern.caseNumber} />
        </div>

        <dl className="mt-6 grid gap-3 text-sm">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
              Title
            </dt>
            <dd className="mt-0.5 font-medium text-ink">{concern.title}</dd>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                Status
              </dt>
              <dd className="mt-1">
                <StatusBadge status={concern.status} />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
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
          {affectedLine && (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                People affected
              </dt>
              <dd className="mt-0.5 text-ink">{affectedLine}</dd>
            </div>
          )}
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
              Category
            </dt>
            <dd className="mt-0.5 text-ink">{concern.category.name}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
              Location
            </dt>
            <dd className="mt-0.5 text-ink">
              {concern.locationAddress}
              {hasCoordinates(coordinates)
                ? ` (${coordinates.lat.toFixed(5)}, ${coordinates.lng.toFixed(5)})`
                : ""}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
              Assigned office
            </dt>
            <dd className="mt-0.5 text-ink">
              {concern.assignedOffice?.name ?? "Not yet routed"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
              Assigned official
            </dt>
            <dd className="mt-0.5 text-ink">
              {concern.assignedOfficial
                ? `${concern.assignedOfficial.firstName} ${concern.assignedOfficial.lastName} · ${concern.assignedOfficial.email}`
                : concern.assignedOffice?.contact
                  ? `${concern.assignedOffice.name} · ${concern.assignedOffice.contact}`
                  : "No named official yet (office queue)"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
              Submitted
            </dt>
            <dd className="mt-0.5 text-ink">
              {formatDateTime(concern.submittedAt)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
              Filed by
            </dt>
            <dd className="mt-0.5 text-ink">
              {user.firstName} {user.lastName}
            </dd>
          </div>
        </dl>

        {concern.history.length > 0 ? (
          <section className="mt-8 border-t border-line pt-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
              Progress so far
            </h2>
            <ol className="mt-3 space-y-3 text-sm text-ink-muted">
              {sortJournal(concern.history).map((entry) => (
                <li key={entry.id} className="break-inside-avoid">
                  <p className="font-medium text-ink">
                    {describeJournalEntry(entry, copy.en.desk)}
                  </p>
                  <p className="text-xs text-ink-subtle">
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
                      className="mt-2 h-auto w-48 max-w-full rounded border border-line"
                    />
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        <p className="mt-8 border-t border-line pt-4 text-xs text-ink-subtle">
          Not for life-threatening emergencies. Call 911. This receipt is not
          proof that the issue is already fixed.
        </p>
      </article>
    </div>
  );
}
