import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import {
  FieldCheckDesk,
  type FieldCheckCaseOption,
  type FieldCheckDeskItem,
  type FieldCheckDeskReply,
  type FieldCheckStaffOption,
} from "@/components/admin/field-check-desk";
import { PageHeader } from "@/components/ui/page-header";
import { hasCoordinates, openStreetMapUrl } from "@/lib/maps";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { fieldCheckIdFromMetadata } from "@/lib/cases/field-check-reply-meta";

export const metadata: Metadata = {
  title: "Field checks",
};

export const dynamic = "force-dynamic";

const OPEN_CHECK_STATUSES = ["PENDING", "SUBMITTED"] as const;

function mapUrl(lat: number | null, lng: number | null): string | null {
  // Narrow the pair itself, so both values are numbers at the call.
  const coords = { lat, lng };
  return hasCoordinates(coords)
    ? openStreetMapUrl(coords.lat, coords.lng)
    : null;
}

/**
 * The admin field-check desk.
 *
 * One place for the whole loop the workflow describes: send somebody to the
 * location the resident gave, read the finding they send back (real, not real,
 * or impossible to tell), and answer it. This is step 1 of every case: the list
 * starts with the reports that just arrived, and the check is the gate that
 * stops a report that is not real from ever reaching the assessment queue.
 */
export default async function AdminFieldChecksPage() {
  await requirePermission("case.fieldcheck.review");
  const locale = await getLocale();
  const t = copy[locale].admin.fieldCheck;

  const checks = await db.fieldCheck.findMany({
    orderBy: { createdAt: "desc" },
    take: 150,
    include: {
      concern: {
        select: {
          id: true,
          caseNumber: true,
          title: true,
          status: true,
          locationAddress: true,
          locationPurok: true,
          locationLat: true,
          locationLng: true,
          assignedOffice: { select: { name: true } },
        },
      },
      assignee: { select: { firstName: true, lastName: true } },
      requestedBy: { select: { firstName: true, lastName: true } },
    },
  });

  const residentReplyEntries = checks.length
    ? await db.caseStatusHistory.findMany({
        where: {
          concernId: { in: [...new Set(checks.map((check) => check.concernId))] },
          entryType: "RESIDENT_REPLY",
          actorRole: "RESIDENT",
          visibility: "RESIDENT_VISIBLE",
        },
        include: { actor: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const concernIdByFieldCheck = new Map(
    checks.map((check) => [check.id, check.concern.id])
  );
  const repliesByCheck = new Map<number, FieldCheckDeskReply[]>();
  for (const entry of residentReplyEntries) {
    const fieldCheckId = fieldCheckIdFromMetadata(entry.metadataJson);
    if (
      fieldCheckId === null ||
      concernIdByFieldCheck.get(fieldCheckId) !== entry.concernId
    ) {
      continue;
    }
    const replies = repliesByCheck.get(fieldCheckId) ?? [];
    replies.push({
      id: entry.id,
      message: entry.remarks ?? "",
      authorName: entry.actor
        ? `${entry.actor.firstName} ${entry.actor.lastName}`
        : copy[locale].desk.residentActor,
      createdAt: entry.createdAt.toISOString(),
    });
    repliesByCheck.set(fieldCheckId, replies);
  }

  const view = (check: (typeof checks)[number]): FieldCheckDeskItem => ({
    id: check.id,
    residentReplies: repliesByCheck.get(check.id) ?? [],
    status: check.status,
    instructions: check.instructions,
    finding: check.finding,
    findingNotes: check.findingNotes,
    findingPhotoUrl: check.findingPhotoUrl,
    reviewNote: check.reviewNote,
    createdAt: check.createdAt.toISOString(),
    caseId: check.concern.id,
    caseNumber: check.concern.caseNumber,
    caseTitle: check.concern.title,
    caseStatus: check.concern.status,
    officeName: check.concern.assignedOffice?.name ?? null,
    locationAddress: check.concern.locationAddress,
    locationPurok: check.concern.locationPurok,
    mapUrl: mapUrl(check.concern.locationLat, check.concern.locationLng),
    assigneeName: `${check.assignee.firstName} ${check.assignee.lastName}`,
    requestedByName: `${check.requestedBy.firstName} ${check.requestedBy.lastName}`,
  });

  const [cases, staff] = await Promise.all([
    db.concern.findMany({
      where: {
        // Straight from the inbox or waiting for assessment: a check is step 1,
        // so a report nobody has looked at yet belongs on this list too.
        status: { in: ["SUBMITTED", "ASSIGNED"] },
        fieldChecks: { none: { status: { in: [...OPEN_CHECK_STATUSES] } } },
      },
      orderBy: { submittedAt: "asc" },
      take: 50,
      select: {
        id: true,
        caseNumber: true,
        title: true,
        assignedOfficeId: true,
        status: true,
        locationAddress: true,
        locationPurok: true,
        locationLat: true,
        locationLng: true,
        assignedOffice: { select: { name: true } },
      },
    }),
    db.user.findMany({
      where: { isActive: true, role: { key: { in: ["OFFICIAL", "CREW"] } } },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      take: 200,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        officeId: true,
        role: { select: { key: true } },
        office: { select: { name: true } },
      },
    }),
  ]);

  const caseOptions: FieldCheckCaseOption[] = cases.map((row) => ({
    id: row.id,
    caseNumber: row.caseNumber,
    title: row.title,
    caseStatus: row.status,
    assignedOfficeId: row.assignedOfficeId,
    officeName: row.assignedOffice?.name ?? null,
    locationAddress: row.locationAddress,
    locationPurok: row.locationPurok,
    mapUrl: mapUrl(row.locationLat, row.locationLng),
  }));

  const staffOptions: FieldCheckStaffOption[] = staff.map((person) => ({
    id: person.id,
    name: `${person.firstName} ${person.lastName}`,
    roleLabel: person.role.key === "CREW" ? "Crew" : "Official",
    officeId: person.officeId,
    officeName: person.office?.name ?? null,
  }));

  const items = checks.map(view);

  return (
    <div className="space-y-6">
      <PageHeader title={t.title} description={t.lead} />

      <Card>
        <FieldCheckDesk
          locale={locale}
          toReview={items.filter((item) => item.status === "SUBMITTED")}
          waiting={items.filter((item) => item.status === "PENDING")}
          decided={items.filter((item) => item.status === "APPROVED").slice(0, 12)}
          cases={caseOptions}
          staff={staffOptions}
        />
      </Card>
    </div>
  );
}
