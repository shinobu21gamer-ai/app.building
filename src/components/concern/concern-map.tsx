import { MapPin } from "lucide-react";

import { LeafletMap } from "@/components/ui/leaflet-map";
import { hasCoordinates, type CoordinatesInput } from "@/lib/maps";

/**
 * Where a case is, on an interactive OpenStreetMap view.
 *
 * Used on the staff and resident case pages, where panning and zooming the
 * location is worth ~40 kB of map script. The public transparency page keeps
 * the static `MapFrame` preview instead: it is a rounded, coarse location and
 * there is no reason to load a map library for every anonymous visitor.
 */
export function ConcernMap({
  lat,
  lng,
  label,
  purok,
  title,
  hint,
}: {
  lat: number | null;
  lng: number | null;
  label?: string | null;
  purok?: string | null;
  title: string;
  hint?: string;
}) {
  // Narrowing works on the argument, not on the outer `lat`/`lng`, so the pair
  // is narrowed first and used through `coords`.
  const coords: CoordinatesInput = { lat, lng };

  return (
    <div className="space-y-2">
      {hasCoordinates(coords) ? (
        <LeafletMap
          lat={coords.lat}
          lng={coords.lng}
          title={title}
          openLabel={label ?? title}
        />
      ) : (
        <div className="flex flex-col items-center gap-1.5 rounded-card border border-dashed border-line-strong bg-surface-muted px-4 py-8 text-center">
          <MapPin size={20} className="text-ink-subtle" aria-hidden="true" />
          <p className="text-sm text-ink-subtle">{label ?? title}</p>
        </div>
      )}
      {purok ? <p className="text-caption text-ink-subtle">{purok}</p> : null}
      {hint ? <p className="text-caption text-ink-subtle">{hint}</p> : null}
    </div>
  );
}
