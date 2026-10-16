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

// A drawn pin rather than Leaflet's default marker, whose icon is resolved
// from a relative image path that no bundler rewrites.
const PIN_ICON_HTML =
  '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="34" viewBox="0 0 24 24" fill="#dc2626" stroke="#ffffff" stroke-width="1.4" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3" fill="#ffffff"/></svg>';

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
 *
 * Read-only by default (the case pages). When `onPick` is given the map also
 * becomes a picker — tapping the map drops/moves the pin and the pin can be
 * dragged — which is how the concern form lets a resident place the pin by
 * hand when device geolocation is unavailable or denied.
 */
export function LeafletMap({
  lat,
  lng,
  title,
  openLabel,
  zoom = MAP_ZOOM,
  className,
  onPick,
  showPin = true,
  emptyPinLabel,
}: {
  lat: number;
  lng: number;
  /** Accessible name for the map region. */
  title: string;
  /** Label for the "open the full map" link (localised by the caller). */
  openLabel: string;
  /** Initial zoom only; the map is not re-created when props change. */
  zoom?: number;
  className?: string;
  /**
   * Picker callback. When set (fixed at mount), tapping the map or dragging
   * the pin reports the new position. Omit for a read-only map.
   */
  onPick?: (lat: number, lng: number) => void;
  /**
   * Hide the pin until the caller has a real location (a picker that has not
   * been placed yet centres on `lat`/`lng` without claiming a pin there).
   */
  showPin?: boolean;
  /** Footer text shown instead of coordinates while `showPin` is false. */
  emptyPinLabel?: string;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markerRef = useRef<import("leaflet").Marker | null>(null);
  const pickRef = useRef(onPick);
  // Where the last pick happened, so the prop-sync below can tell "parent is
  // echoing our own pick back" (do not recenter) from "parent moved the pin"
  // (typed coordinates, a GPS fix — do recenter).
  const lastPickRef = useRef<{ lat: number; lng: number } | null>(null);
  const initialRef = useRef({ lat, lng, zoom, showPin });
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    pickRef.current = onPick;
  }, [onPick]);

  // Create the map once. Later coordinate changes are applied by the sync
  // effect below instead of rebuilding the map, so typing coordinates (or a
  // GPS fix arriving) does not tear down the resident's pan/zoom.
  useEffect(() => {
    const element = holder.current;
    if (!element) {
      return;
    }

    let cancelled = false;

    const start = async () => {
      try {
        const L = (await import("leaflet")).default;
        if (cancelled) {
          return;
        }

        const initial = initialRef.current;
        const picking = Boolean(pickRef.current);

        const map = L.map(element, {
          center: [initial.lat, initial.lng],
          zoom: initial.zoom,
          // Scroll zoom hijacks the page on a phone; the zoom control, pinch
          // and the keyboard all still work.
          scrollWheelZoom: false,
        });
        mapRef.current = map;

        L.tileLayer(OSM_TILE_URL, {
          maxZoom: OSM_MAX_ZOOM,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(map);

        const marker = L.marker([initial.lat, initial.lng], {
          icon: L.divIcon({
            className: "br-map-pin",
            html: PIN_ICON_HTML,
            iconSize: [28, 34],
            iconAnchor: [14, 34],
          }),
          draggable: picking,
          autoPan: picking,
        });
        markerRef.current = marker;
        if (initial.showPin) {
          marker.addTo(map);
        }

        if (picking) {
          const reportPick = (picked: { lat: number; lng: number }) => {
            lastPickRef.current = picked;
            pickRef.current?.(picked.lat, picked.lng);
          };
          marker.on("dragend", () => {
            const point = marker.getLatLng();
            reportPick({ lat: point.lat, lng: point.lng });
          });
          map.on("click", (event) => {
            marker.setLatLng(event.latlng);
            if (!map.hasLayer(marker)) {
              marker.addTo(map);
            }
            reportPick({ lat: event.latlng.lat, lng: event.latlng.lng });
          });
        }

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
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  // Keep the pin (and, for outside changes, the centre) in step with props.
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (state !== "ready" || !map || !marker) {
      return;
    }

    if (!showPin) {
      if (map.hasLayer(marker)) {
        marker.remove();
      }
      return;
    }
    if (!map.hasLayer(marker)) {
      marker.addTo(map);
    }

    const current = marker.getLatLng();
    if (Math.abs(current.lat - lat) > 1e-9 || Math.abs(current.lng - lng) > 1e-9) {
      marker.setLatLng([lat, lng]);
    }

    // The parent rounds picks to 6 dp when it stores them, hence the looser
    // epsilon here: an echo of our own pick must not yank the view around
    // while the resident is panning, but a genuinely new position must.
    const picked = lastPickRef.current;
    const fromMap =
      picked !== null &&
      Math.abs(picked.lat - lat) < 1e-6 &&
      Math.abs(picked.lng - lng) < 1e-6;
    if (!fromMap) {
      const centre = map.getCenter();
      if (Math.abs(centre.lat - lat) > 1e-9 || Math.abs(centre.lng - lng) > 1e-9) {
        map.setView([lat, lng]);
      }
    }
  }, [lat, lng, showPin, state]);

  if (state === "failed") {
    return (
      <MapFrame
        lat={showPin ? lat : null}
        lng={showPin ? lng : null}
        zoom={zoom}
        title={title}
        emptyLabel={emptyPinLabel ?? title}
        openLabel={openLabel}
        attribution="© OpenStreetMap contributors"
        attributionUrl="https://www.openstreetmap.org/copyright"
        className={className}
        onPick={onPick}
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
          {showPin ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : (emptyPinLabel ?? title)}
        </span>
        {showPin ? (
          <a
            href={openStreetMapUrl(lat, lng)}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-caption font-semibold text-brand-700 hover:underline"
          >
            {openLabel}
          </a>
        ) : null}
      </figcaption>
    </figure>
  );
}
