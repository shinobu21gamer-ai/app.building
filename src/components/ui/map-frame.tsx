"use client";

import { useState } from "react";
import { ExternalLink, MapPin, Minus, Plus } from "lucide-react";

import {
  MAP_DEFAULT_CENTER,
  MAP_ZOOM,
  OSM_MAX_ZOOM,
  openStreetMapUrl,
  pickOnMosaic,
  tileMosaic,
  type CoordinatesInput,
  hasCoordinates,
} from "@/lib/maps";
import { cn } from "@/lib/utils";

/**
 * A location preview built from OpenStreetMap tiles.
 *
 * Tiles are plain images (no third-party script, no iframe). When `onPick` is
 * set the mosaic is a pin dropper: tap to place, +/− to zoom. That path does
 * not depend on Leaflet, which is what left residents unable to pin when the
 * interactive map failed to start.
 */
export function MapFrame({
  lat,
  lng,
  title,
  emptyLabel,
  openLabel,
  attribution,
  attributionUrl,
  zoom = MAP_ZOOM,
  className,
  onPick,
}: {
  lat: number | null | undefined;
  lng: number | null | undefined;
  title: string;
  /** Shown when the case has no coordinates yet. */
  emptyLabel: string;
  openLabel: string;
  attribution: string;
  attributionUrl: string;
  zoom?: number;
  className?: string;
  /** Tap the mosaic to drop or move the pin. */
  onPick?: (lat: number, lng: number) => void;
}) {
  const coords: CoordinatesInput = { lat, lng };
  const picking = typeof onPick === "function";
  const [level, setLevel] = useState(() =>
    Math.max(2, Math.min(OSM_MAX_ZOOM, Math.floor(zoom)))
  );

  if (!hasCoordinates(coords) && !picking) {
    return (
      <div
        className={cn(
          "flex flex-col items-center gap-1.5 rounded-card border border-dashed border-line-strong bg-surface-muted px-4 py-8 text-center",
          className
        )}
      >
        <MapPin size={20} className="text-ink-subtle" aria-hidden="true" />
        <p className="text-sm text-ink-subtle">{emptyLabel}</p>
      </div>
    );
  }

  const centre = hasCoordinates(coords) ? coords : MAP_DEFAULT_CENTER;
  const mosaic = tileMosaic(centre.lat, centre.lng, level, 3, 2);
  const { tiles, marker } = mosaic;
  const showPin = hasCoordinates(coords);

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!onPick) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const leftPercent = ((event.clientX - rect.left) / rect.width) * 100;
    const topPercent = ((event.clientY - rect.top) / rect.height) * 100;
    const picked = pickOnMosaic(mosaic, leftPercent, topPercent);
    onPick(picked.lat, picked.lng);
  }

  return (
    <figure className={cn("overflow-hidden rounded-card border border-line", className)}>
      <div
        className={cn(
          "relative h-52 w-full overflow-hidden bg-surface-sunken sm:h-64",
          picking ? "cursor-crosshair" : ""
        )}
        role={picking ? "application" : "img"}
        aria-label={title}
        onClick={picking ? handleClick : undefined}
      >
        <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-2">
          {tiles.map((tile) => (
            /* eslint-disable-next-line @next/next/no-img-element -- map tiles are
               already-optimised raster images from a tile server, not assets that
               next/image can resize (and the app runs with images.unoptimized). */
            <img
              key={tile.key}
              src={tile.url}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              className="h-full w-full object-cover select-none"
            />
          ))}
        </div>

        {showPin ? (
          <span
            aria-hidden="true"
            style={{
              left: `${marker.leftPercent}%`,
              top: `${marker.topPercent}%`,
            }}
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-full drop-shadow-[0_1px_2px_rgba(15,23,42,0.45)]"
          >
            <MapPin
              size={30}
              className="fill-danger-600 text-white"
              strokeWidth={1.5}
            />
          </span>
        ) : null}

        {picking ? (
          <div className="absolute top-2 right-2 z-10 flex flex-col overflow-hidden rounded-control border border-line bg-surface shadow-card">
            <button
              type="button"
              aria-label="Zoom in"
              className="tap-target flex h-9 w-9 items-center justify-center text-ink hover:bg-surface-muted disabled:text-ink-faint"
              disabled={level >= OSM_MAX_ZOOM}
              onClick={(event) => {
                event.stopPropagation();
                setLevel((value) => Math.min(OSM_MAX_ZOOM, value + 1));
              }}
            >
              <Plus size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Zoom out"
              className="tap-target flex h-9 w-9 items-center justify-center border-t border-line text-ink hover:bg-surface-muted disabled:text-ink-faint"
              disabled={level <= 2}
              onClick={(event) => {
                event.stopPropagation();
                setLevel((value) => Math.max(2, value - 1));
              }}
            >
              <Minus size={16} aria-hidden="true" />
            </button>
          </div>
        ) : null}

        <a
          href={attributionUrl}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(event) => event.stopPropagation()}
          className="absolute right-1 bottom-1 rounded bg-surface/85 px-1.5 py-0.5 text-[10px] text-ink-subtle"
        >
          {attribution}
        </a>
      </div>

      <figcaption className="flex items-center justify-between gap-2 border-t border-line bg-surface px-3 py-2">
        <span className="text-caption text-ink-subtle tabular-nums">
          {showPin
            ? `${centre.lat.toFixed(5)}, ${centre.lng.toFixed(5)}`
            : emptyLabel}
        </span>
        {showPin ? (
          <a
            href={openStreetMapUrl(centre.lat, centre.lng)}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-caption font-semibold text-brand-700 hover:underline"
          >
            {openLabel}
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        ) : null}
      </figcaption>
    </figure>
  );
}
