import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { PrintButton } from "@/components/ui/print-button";
import { formatDateTime } from "@/lib/format";
import { hasCoordinates } from "@/lib/maps";
import { statusLabel } from "@/lib/cases/workflow";

export const metadata: Metadata = {
  title: "Case printout",
};

export default async function OfficialCasePrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireRole(["OFFICIAL", "ADMIN"]);
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) notFound();

  const concern = await db.concern.findFirst({
    where:
      user.role.key === "ADMIN"
        ? { id: numericId }
        : { id: numericId, assignedOfficeId: user.officeId ?? -1 },
    include: {
      category: { select: { name: true } },
      assignedOffice: { select: { name: true } },
      user: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
      history: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          createdAt: true,
          remarks: true,
          toStatus: true,
          entryType: true,
        },
      },
      resolutions: {
        take: 1,
        orderBy: { createdAt: "desc" },
        select: { summary: true, actionsTaken: true, resolutionType: true },
      },
    },
  });

  if (!concern) notFound();

  const coordinates = { lat: concern.locationLat, lng: concern.locationLng };
  const resolution = concern.resolutions[0] ?? null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Button href={`/official/concerns/${concern.id}`} variant="ghost" size="sm">
          ← Back to case
        </Button>
        <PrintButton label="Print case sheet" />
      </div>

      <article className="rounded-xl border border-slate-200 bg-white p-6 print:border-0 print:p-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
          BarangayResolve · Official copy
        </p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Case sheet</h1>
        <p className="mt-6 font-mono text-3xl font-bold tracking-wide text-slate-950">
          {concern.caseNumber}
        </p>
        <h2 className="mt-2 text-lg font-semibold text-slate-900">
          {concern.title}
        </h2>

        <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
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
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Category
            </dt>
            <dd className="mt-0.5 text-slate-900">{concern.category.name}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Office
            </dt>
            <dd className="mt-0.5 text-slate-900">
              {concern.assignedOffice?.name ?? "Unassigned"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Resident
            </dt>
            <dd className="mt-0.5 text-slate-900">
              {concern.user.firstName} {concern.user.lastName}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Contact
            </dt>
            <dd className="mt-0.5 text-slate-900">
              {concern.user.phone || concern.user.email}
            </dd>
          </div>
          <div className="sm:col-span-2">
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
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Description
            </dt>
            <dd className="mt-0.5 whitespace-pre-wrap text-slate-800">
              {concern.description}
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
        </dl>

        {resolution ? (
          <div className="mt-6 border-t border-slate-200 pt-4">
            <h3 className="text-sm font-semibold text-slate-900">Resolution</h3>
            <p className="mt-1 text-sm text-slate-700">{resolution.summary}</p>
            <p className="mt-1 text-xs text-slate-500">
              {statusLabel(resolution.resolutionType)}
            </p>
          </div>
        ) : null}

        {concern.history.length > 0 ? (
          <div className="mt-6 border-t border-slate-200 pt-4">
            <h3 className="text-sm font-semibold text-slate-900">
              Recent history
            </h3>
            <ul className="mt-2 space-y-2 text-sm text-slate-700">
              {concern.history.map((entry, index) => (
                <li key={`${entry.createdAt.toISOString()}-${index}`}>
                  <span className="text-xs text-slate-500">
                    {formatDateTime(entry.createdAt)}
                    {entry.toStatus ? ` · ${statusLabel(entry.toStatus)}` : ""}
                  </span>
                  {entry.remarks ? (
                    <p className="mt-0.5">{entry.remarks}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="mt-8 border-t border-slate-200 pt-4 text-xs text-slate-500">
          Printed {formatDateTime(new Date())} for barangay hall use. Not for
          life-threatening emergencies — call 911.
        </p>
      </article>
    </div>
  );
}
