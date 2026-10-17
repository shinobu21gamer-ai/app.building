import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { VoucherForm } from "@/components/treasury/voucher-form";
import { CrewPaymentRequestDesk } from "@/components/treasury/crew-payment-request-desk";
import { PageHeader } from "@/components/ui/page-header";
import { formatPeso } from "@/lib/cases/manpower";
import { formatDateTime } from "@/lib/format";
import { db } from "@/lib/db";
import { requirePermission, userCan } from "@/lib/auth/session";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { listCrewAssignments } from "@/lib/cases/crew";
import { seesWholeBudget } from "@/lib/treasury/budget";
import { groupVouchersByPayee } from "@/lib/treasury/payee-groups";
import type { DisbursementRow } from "@/lib/treasury/query";
import {
  listAllocations,
  listDisbursements,
  listEarmarks,
} from "@/lib/treasury/query";

export const metadata: Metadata = {
  title: "Disbursement vouchers",
};

export const dynamic = "force-dynamic";

const TONES: Record<string, "sky" | "amber" | "green" | "gray" | "red"> = {
  DRAFT: "gray",
  SUBMITTED: "sky",
  CERTIFIED: "amber",
  APPROVED: "amber",
  RELEASED: "green",
  LIQUIDATED: "green",
  REJECTED: "red",
  CANCELLED: "red",
};

type PageProps = {
  searchParams: Promise<{
    status?: string;
    concernId?: string;
    pay?: string;
    earmarkId?: string;
  }>;
};

/** The voucher register: every step from draft to liquidation, newest first. */
export default async function TreasuryDisbursementsPage({
  searchParams,
}: PageProps) {
  const user = await requirePermission("treasury.balance.view");
  const {
    status,
    concernId: presetConcernParam,
    pay,
    earmarkId: presetEarmarkParam,
  } = await searchParams;
  const locale = await getLocale();
  const t = copy[locale].revamp.treasuryDesk;
  const actor = {
    id: user.id,
    roleKey: user.role.key,
    officeId: user.officeId ?? null,
  };

  // Arriving from a case's "Pay crew" door, the form opens aimed at that case
  // with the crew payee type (and, when the plan says how much each worker
  // costs, the per-worker figure) already in place.
  const presetConcernId = Number(presetConcernParam);
  const presetConcern =
    Number.isInteger(presetConcernId) && presetConcernId > 0
      ? await db.concern.findUnique({
          where: { id: presetConcernId },
          select: {
            id: true,
            caseNumber: true,
            title: true,
            caseAssessment: {
              select: { laborCost: true, workersNeeded: true },
            },
          },
        })
      : null;
  const payCrew = pay === "CREW" && presetConcern !== null;
  const perWorkerAmount =
    payCrew &&
    presetConcern?.caseAssessment !== null &&
    presetConcern.caseAssessment.laborCost !== null &&
    (presetConcern.caseAssessment.workersNeeded ?? 0) > 0
      ? Math.round(
          (Number(presetConcern.caseAssessment.laborCost) /
            (presetConcern.caseAssessment.workersNeeded as number)) *
            100
        ) / 100
      : null;

  const [vouchers, allocations, approvedEarmarks, openCases, canPrepare] =
    await Promise.all([
      listDisbursements(db, {
        actor,
        status: status && status !== "ALL" ? status : null,
      }),
      listAllocations(db, { actor, status: "APPROVED" }),
      listEarmarks(db, { actor, status: "APPROVED" }),
      db.concern.findMany({
        where: { status: { notIn: ["CLOSED"] } },
        orderBy: { id: "desc" },
        take: 50,
        select: { id: true, caseNumber: true, title: true },
      }),
      userCan(user.role.key, "treasury.disbursement.prepare"),
    ]);

  type CrewMemberRow = {
    id: number;
    firstName: string;
    lastName: string;
    crewProfile: { trade: string | null } | null;
  };
  const crewMembers: CrewMemberRow[] = canPrepare
    ? await db.user.findMany({
        where: { isActive: true, crewProfile: { isNot: null } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          crewProfile: { select: { trade: true } },
        },
        orderBy: { firstName: "asc" },
        take: 200,
      })
    : [];

  const paymentRequestRows = canPrepare
    ? await db.crewPaymentRequest.findMany({
        where: {
          ...(seesWholeBudget(actor)
            ? {}
            : { concern: { assignedOfficeId: actor.officeId ?? -1 } }),
          OR: [
            { status: "OPEN" },
            {
              lines: {
                some: {
                  disbursement: {
                    is: { status: { in: ["REJECTED", "CANCELLED"] } },
                  },
                },
              },
            },
          ],
        },
        orderBy: { createdAt: "asc" },
        include: {
          concern: {
            select: { id: true, caseNumber: true, title: true, assignedOfficeId: true },
          },
          lines: {
            orderBy: { id: "asc" },
            include: {
              crew: { select: { id: true, firstName: true, lastName: true } },
              disbursement: { select: { voucherNumber: true, status: true } },
            },
          },
        },
      })
    : [];

  const crewPaymentRequests = paymentRequestRows.map((request) => ({
    id: request.id,
    concernId: request.concern.id,
    caseNumber: request.concern.caseNumber,
    caseTitle: request.concern.title,
    createdAt: request.createdAt.toISOString(),
    status: request.status,
    lines: request.lines.map((line) => ({
      id: line.id,
      crewId: line.crew.id,
      crewName: `${line.crew.firstName} ${line.crew.lastName}`.trim(),
      status: line.status,
      holdReason: line.holdReason,
      voucherNumber: line.disbursement?.voucherNumber ?? null,
      voucherStatus: line.disbursement?.status ?? null,
    })),
  }));

  const voucherGroups = groupVouchersByPayee<DisbursementRow>(vouchers);

  const requestedEarmarkId =
    Number.isInteger(Number(presetEarmarkParam)) &&
    Number(presetEarmarkParam) > 0
      ? Number(presetEarmarkParam)
      : null;
  const linkedEarmark =
    approvedEarmarks.find((row) => row.id === requestedEarmarkId) ??
    approvedEarmarks.find((row) => row.concernId === presetConcern?.id) ??
    null;

  const assignedCrew =
    canPrepare && presetConcern
      ? await listCrewAssignments(db, presetConcern.id)
      : [];
  const presetCrewLines = assignedCrew
    .filter((row) => row.isActive)
    .map((row) => ({
      userId: row.crew.id,
      name: `${row.crew.firstName} ${row.crew.lastName}`.trim(),
      amount: perWorkerAmount,
    }));

  const caseOptions = [
    ...(presetConcern &&
    !openCases.some((row) => row.id === presetConcern.id)
      ? [
          {
            id: presetConcern.id,
            caseNumber: presetConcern.caseNumber,
            title: presetConcern.title,
          },
        ]
      : []),
    ...openCases,
  ];

  const filters = [
    "ALL",
    "DRAFT",
    "SUBMITTED",
    "CERTIFIED",
    "APPROVED",
    "RELEASED",
    "LIQUIDATED",
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t.disbursementsTitle} description={t.disbursementsLead} />

      {canPrepare && (
        <CrewPaymentRequestDesk
          requests={crewPaymentRequests}
          earmarks={approvedEarmarks.map((earmark) => ({
            id: earmark.id,
            code: earmark.code,
            purpose: earmark.purpose,
            amount: earmark.amount,
            committed: earmark.committed,
            concernId: earmark.concernId,
            allocationId: earmark.allocationId,
          }))}
          locale={locale}
        />
      )}

      {canPrepare && allocations.length > 0 && (
        <Card title={t.newVoucher}>
          <VoucherForm
            allocations={allocations.map((allocation) => ({
              id: allocation.id,
              label: allocation.label,
              coaCode: allocation.coaCode,
              available: allocation.available,
            }))}
            crewMembers={crewMembers.map((member) => ({
              id: member.id,
              name: `${member.firstName} ${member.lastName}`.trim(),
              trade: member.crewProfile?.trade ?? null,
            }))}
            presetConcernId={presetConcern?.id ?? null}
            presetPayeeType={payCrew ? "CREW" : "SUPPLIER"}
            presetAmount={perWorkerAmount}
            presetEarmarkId={linkedEarmark?.id ?? null}
            presetAllocationId={linkedEarmark?.allocationId ?? null}
            presetCrewLines={presetCrewLines}
            defaultOpen={
              payCrew || presetConcern !== null || linkedEarmark !== null
            }
            earmarks={approvedEarmarks.map((earmark) => ({
              id: earmark.id,
              code: earmark.code,
              purpose: earmark.purpose,
              amount: earmark.amount,
              committed: earmark.committed,
              concernId: earmark.concernId,
              allocationId: earmark.allocationId,
            }))}
            caseOptions={caseOptions}
            locale={locale}
          />
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {filters.map((filter) => (
          <Button
            key={filter}
            href={
              filter === "ALL"
                ? "/treasury/disbursements"
                : `/treasury/disbursements?status=${filter}`
            }
            size="sm"
            variant={
              (status ?? "ALL") === filter ? "primary" : "outline"
            }
          >
            {filter}
          </Button>
        ))}
      </div>

      {vouchers.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-subtle">{t.noEntries}</p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {voucherGroups.map((group) => (
            <li key={group.key}>
              <Card className="space-y-3">
                <div>
                  <p className="font-semibold text-ink">{group.payee}</p>
                  {group.payeeType === "CREW" && group.vouchers.length > 1 && (
                    <p className="text-xs text-ink-subtle">
                      {t.crewPayeeGrouped
                        .replace("{count}", String(group.vouchers.length))
                        .replace("{total}", formatPeso(group.total))}
                    </p>
                  )}
                </div>
                {group.vouchers.map((voucher) => (
                  <div key={voucher.id} className="space-y-1 border-t border-line pt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-ink-subtle">
                        {voucher.voucherNumber ?? `#${voucher.id}`}
                      </span>
                      <Badge tone={TONES[voucher.status] ?? "neutral"}>
                        {voucher.statusLabel}
                      </Badge>
                      <span className="text-sm font-semibold text-ink">
                        {formatPeso(voucher.amount)}
                      </span>
                      {voucher.liquidationState !== "NOT_DUE" &&
                        voucher.status === "RELEASED" && (
                          <Badge tone="amber">{voucher.liquidationState}</Badge>
                        )}
                    </div>
                    <p className="text-xs text-ink-subtle">{voucher.particulars}</p>
                    <p className="text-xs text-ink-subtle">
                      {voucher.coaCode} · {voucher.fundSourceCode}
                      {voucher.earmarkCode ? ` · ${voucher.earmarkCode}` : ""}
                      {voucher.caseNumber ? ` · ${voucher.caseNumber}` : ""} ·{" "}
                      {formatDateTime(voucher.preparedAt)}
                    </p>
                    <Button
                      href={`/treasury/disbursements/${voucher.id}`}
                      size="sm"
                      variant="outline"
                    >
                      {t.open}
                    </Button>
                  </div>
                ))}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
