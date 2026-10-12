// The PII-free public projection behind the transparency page.
//
// Nothing written here may be traced back to a resident: no case number, no
// name, no street address, no exact coordinates. What goes out is a coarse
// geohash, the purok-level area label, the service type, a scrubbed title and
// the timings. Publication also requires the resident's transparency consent —
// a case is never published just because it exists.

import type { Prisma } from "@prisma/client";
import {
  buildPublicRef,
  coarsenCoordinate,
  encodeGeohash,
  scrubPublicTitle,
} from "@/lib/cases/geo";
import type { ConsentPurpose } from "@/lib/privacy/catalog";
import { hasConsent } from "@/lib/privacy/consent";

type Tx = Prisma.TransactionClient;

/** Publishing a case publicly is an explicit, withdrawable consent. */
export const TRANSPARENCY_CONSENT_PURPOSE: ConsentPurpose =
  "TRANSPARENCY_PUBLICATION";

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

function hoursBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 3_600_000));
}

export type PublicRecordSync = {
  publicRef: string | null;
  published: boolean;
  reason: PublicationReason;
};

export type PublicationReason = "consent_missing" | "no_safe_title" | "published";

/**
 * The publication decision, in one place: a case is published only when the
 * resident consented **and** the title still says something after scrubbing the
 * resident's name out of it. Exported so the historical backfill script
 * (`scripts/public-record-backfill.ts`) can report what it would do without
 * writing anything, using the same rule the live path uses.
 */
export function publicationDecision(
  consented: boolean,
  publicTitle: string | null
): PublicationReason {
  if (!consented) return "consent_missing";
  return publicTitle === null ? "no_safe_title" : "published";
}

/**
 * Creates or refreshes the public projection for a case. Safe to call on every
 * status change: it is idempotent, keeps the existing public reference, and
 * flips `published` off when the resident withdraws the consent.
 */
export async function syncPublicRecord(
  tx: Tx,
  concernId: number
): Promise<PublicRecordSync> {
  const concern = await tx.concern.findUnique({
    where: { id: concernId },
    select: {
      id: true,
      title: true,
      status: true,
      locationAddress: true,
      locationLat: true,
      locationLng: true,
      locationPurok: true,
      submittedAt: true,
      resolvedAt: true,
      closedAt: true,
      userId: true,
      user: { select: { firstName: true, lastName: true } },
      category: { select: { name: true } },
      type: { select: { key: true } },
      resolutions: {
        select: { resolutionType: true, verificationStatus: true },
        take: 1,
        orderBy: { resolvedAt: "desc" },
      },
      publicRecord: { select: { publicRef: true } },
    },
  });
  if (!concern) return { publicRef: null, published: false, reason: "no_safe_title" };

  const consented = await hasConsent(
    concern.userId,
    TRANSPARENCY_CONSENT_PURPOSE,
    tx
  );

  const publicTitle = scrubPublicTitle(concern.title, [
    concern.user.firstName,
    concern.user.lastName,
  ]);

  const lat = concern.locationLat;
  const lng = concern.locationLng;
  const hasPoint = typeof lat === "number" && typeof lng === "number";

  const areaLabel = concern.locationPurok?.trim() || "Barangay";

  const resolvedAt = concern.resolvedAt ?? null;
  const closedAt = concern.closedAt ?? null;
  const resolution = concern.resolutions[0] ?? null;

  const published = consented && publicTitle !== null;
  const data = {
    typeKey: concern.type?.key ?? null,
    categoryName: concern.category.name,
    publicTitle,
    status: concern.status,
    areaLabel,
    geohash: hasPoint ? encodeGeohash(lat, lng, 5) : null,
    lat: hasPoint ? coarsenCoordinate(lat) : null,
    lng: hasPoint ? coarsenCoordinate(lng) : null,
    submittedAt: concern.submittedAt,
    resolvedAt,
    closedAt,
    responseHours: resolvedAt ? hoursBetween(concern.submittedAt, resolvedAt) : null,
    resolutionType: resolution?.resolutionType ?? null,
    published,
    anonymizedAt: new Date(),
  };

  const existingRef = concern.publicRecord?.publicRef ?? null;
  const publicRef = existingRef ?? buildPublicRef(concern.id, randomSuffix());

  await tx.publicCaseRecord.upsert({
    where: { concernId: concern.id },
    update: data,
    create: { concernId: concern.id, publicRef, ...data },
  });

  return {
    publicRef,
    published,
    reason: publicationDecision(consented, publicTitle),
  };
}

/** The public, PII-free list used by the transparency page and the map. */
export async function listPublicRecords(
  tx: Tx,
  options: { status?: string | null; limit?: number } = {}
) {
  const take = Math.min(Math.max(options.limit ?? 200, 1), 500);
  return tx.publicCaseRecord.findMany({
    where: {
      published: true,
      ...(options.status ? { status: options.status } : {}),
    },
    orderBy: { submittedAt: "desc" },
    take,
    select: {
      publicRef: true,
      typeKey: true,
      categoryName: true,
      publicTitle: true,
      status: true,
      areaLabel: true,
      geohash: true,
      lat: true,
      lng: true,
      submittedAt: true,
      resolvedAt: true,
      closedAt: true,
      responseHours: true,
      resolutionType: true,
    },
  });
}
