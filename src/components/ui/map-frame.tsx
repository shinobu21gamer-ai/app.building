import { ExternalLink, MapPin } from "lucide-react";

import {
  MAP_ZOOM,
  openStreetMapUrl,
  tileMosaic,
  type CoordinatesInput,
  hasCoordinates,
} from "@/lib/maps";
import { cn } from "@/lib/utils";

/**
 * A location preview built from OpenStreetMap tiles.
 *
 * An `<iframe>` embed would be prettier to write but needs `frame-src` in the
 * CSP for a third-party origin, runs their JavaScript, and silently shows a
 * blank box when either is blocked. Tiles are plain images: they fit the
 * existing policy (`img-src`), load lazily, and the pin is drawn by us, so the
 * exact point is visible even at a glance on a phone.
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
}) {
  const coords: CoordinatesInput = { lat, lng };

  if (!hasCoordinates(coords)) {
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

  const { tiles, marker } = tileMosaic(coords.lat, coords.lng, zoom, 3, 2);

  return (
    <figure className={cn("overflow-hidden rounded-card border border-line", className)}>
      <div
        className="relative h-52 w-full overflow-hidden bg-surface-sunken sm:h-64"
        role="img"
        aria-label={title}
      >
        <div className="absolute inset-0 grid grid-cols-3 grid-rows-2">
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
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover select-none"
            />
          ))}
        </div>

        <span
          aria-hidden="true"
          style={{
            left: `${marker.leftPercent}%`,
            top: `${marker.topPercent}%`,
          }}
          className="absolute -translate-x-1/2 -translate-y-full drop-shadow-[0_1px_2px_rgba(15,23,42,0.45)]"
        >
          <MapPin
            size={30}
            className="fill-danger-600 text-white"
            strokeWidth={1.5}
          />
        </span>

        <a
          href={attributionUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="absolute right-1 bottom-1 rounded bg-surface/85 px-1.5 py-0.5 text-[10px] text-ink-subtle"
        >
          {attribution}
        </a>
      </div>

      <figcaption className="flex items-center justify-between gap-2 border-t border-line bg-surface px-3 py-2">
        <span className="text-caption text-ink-subtle tabular-nums">
          {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
        </span>
        <a
          href={openStreetMapUrl(coords.lat, coords.lng)}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 text-caption font-semibold text-brand-700 hover:underline"
        >
          {openLabel}
          <ExternalLink size={13} aria-hidden="true" />
        </a>
      </figcaption>
    </figure>
  );
}
