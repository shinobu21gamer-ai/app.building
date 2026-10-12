"use client";

import { useEffect, useRef, useState } from "react";

import "leaflet/dist/leaflet.css";

import { MapFrame } from "@/components/ui/map-frame";
import {
  MAP_ZOOM,
  OSM_MAX_ZOOM,
  OSM_TILE_URL,
  openStreetMapUrl,
} from "@/lib/maps";
import { cn } from "@/lib/utils";

/**
 * An interactive OpenStreetMap view for a case location.
 *
 * Leaflet is imported inside the effect rather than at module scope for two
 * reasons: it touches `window`/`document` as soon as it loads (so it cannot be
 * rendered on the server), and it is a sizeable script that staff only need on
 * the handful of pages that show a map. Until it is ready — and if it never
 * arrives — the static tile preview (`MapFrame`) stands in, so the location is
 * visible even on a slow or blocked connection.
 *
 * Tiles come from the same host as the static preview, so the production CSP
 * needs nothing beyond the `img-src` entries it already has: Leaflet draws
 * tiles as `<img>` elements and is configured here without plugins, workers or
 * remote stylesheets.
 */
export function LeafletMap({
  lat,
  lng,
  title,
  openLabel,
  zoom = MAP_ZOOM,
  className,
}: {
  lat: number;
  lng: number;
  /** Accessible name for the map region. */
  title: string;
  /** Label for the "open the full map" link (localised by the caller). */
  openLabel: string;
  zoom?: number;
  className?: string;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    const element = holder.current;
    if (!element) {
      return;
    }

    let cancelled = false;
    let map: import("leaflet").Map | null = null;

    const start = async () => {
      try {
        const L = (await import("leaflet")).default;
        if (cancelled) {
          return;
        }

        map = L.map(element, {
          center: [lat, lng],
          zoom,
          // Scroll zoom hijacks the page on a phone; the zoom control, pinch
          // and the keyboard all still work.
          scrollWheelZoom: false,
        });

        L.tileLayer(OSM_TILE_URL, {
          maxZoom: OSM_MAX_ZOOM,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(map);

        // A drawn pin rather than Leaflet's default marker, whose icon is
        // resolved from a relative image path that no bundler rewrites.
        L.marker([lat, lng], {
          icon: L.divIcon({
            className: "br-map-pin",
            html:
              '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="34" viewBox="0 0 24 24" fill="#dc2626" stroke="#ffffff" stroke-width="1.4" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3" fill="#ffffff"/></svg>',
            iconSize: [28, 34],
            iconAnchor: [14, 34],
          }),
        }).addTo(map);

        setState("ready");
      } catch {
        if (!cancelled) {
          setState("failed");
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [lat, lng, zoom]);

  if (state === "failed") {
    return (
      <MapFrame
        lat={lat}
        lng={lng}
        zoom={zoom}
        title={title}
        emptyLabel={title}
        openLabel={openLabel}
        attribution="© OpenStreetMap contributors"
        attributionUrl="https://www.openstreetmap.org/copyright"
        className={className}
      />
    );
  }

  return (
    <figure className={cn("overflow-hidden rounded-card border border-line", className)}>
      <div className="relative h-52 w-full bg-surface-sunken sm:h-64">
        {/* `z-0` gives the map its own stacking context, so Leaflet's internal
            panes (z-index 400+) stay below the sticky header and tab bar. */}
        <div
          ref={holder}
          role="region"
          aria-label={title}
          className="absolute inset-0 z-0"
        />
        {state === "loading" ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 animate-pulse bg-surface-sunken"
          />
        ) : null}
      </div>
      <figcaption className="flex items-center justify-between gap-2 border-t border-line bg-surface px-3 py-2">
        <span className="text-caption text-ink-subtle tabular-nums">
          {lat.toFixed(5)}, {lng.toFixed(5)}
        </span>
        <a
          href={openStreetMapUrl(lat, lng)}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 text-caption font-semibold text-brand-700 hover:underline"
        >
          {openLabel}
        </a>
      </figcaption>
    </figure>
  );
}
