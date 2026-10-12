import { db } from "@/lib/db";
import { ok, withErrorBoundary } from "@/lib/api";
import { requireApiPermission } from "@/lib/auth/session";
import { listCrewJobs } from "@/lib/cases/crew";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/crew/jobs
 * A crew member's own open assignments — the crew portal's job list. Scoped to
 * the signed-in user; nobody can ask for somebody else's jobs.
 */
export const GET = withErrorBoundary(async () => {
  const user = await requireApiPermission("crew.job.view.own");

  const jobs = await listCrewJobs(db, user.id);

  return ok({
    jobs: jobs.map((job) => ({
      concernId: job.concern.id,
      caseNumber: job.concern.caseNumber,
      title: job.concern.title,
      status: job.concern.status,
      locationAddress: job.concern.locationAddress,
      purok: job.concern.locationPurok,
      lat: job.concern.locationLat,
      lng: job.concern.locationLng,
      officeName: job.concern.assignedOffice?.name ?? null,
      taskNote: job.taskNote,
      scheduledStartAt:
        job.scheduledStartAt?.toISOString() ??
        job.concern.caseAssessment?.scheduledStartAt?.toISOString() ??
        null,
      scheduledEndAt:
        job.scheduledEndAt?.toISOString() ??
        job.concern.caseAssessment?.scheduledEndAt?.toISOString() ??
        null,
      workersNeeded: job.concern.caseAssessment?.workersNeeded ?? null,
      estimatedDurationMinutes:
        job.concern.caseAssessment?.estimatedDurationMinutes ?? null,
      equipmentNotes: job.concern.caseAssessment?.equipmentNotes ?? null,
      assignedAt: job.assignedAt.toISOString(),
    })),
    total: jobs.length,
  });
});
