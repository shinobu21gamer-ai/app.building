import { MapFrame } from "@/components/ui/map-frame";
import { OSM_ATTRIBUTION, OSM_COPYRIGHT_URL } from "@/lib/maps";

/**
 * A location preview for a case. The map is built from OpenStreetMap tiles
 * (`MapFrame`) rather than an embedded iframe, so it keeps working under the
 * production Content-Security-Policy and does not run a third party's
 * JavaScript; the coordinates and the external link are always shown, so a
 * case page never depends on the tiles being reachable either.
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
  return (
    <div className="space-y-2">
      <MapFrame
        lat={lat}
        lng={lng}
        title={title}
        emptyLabel={label ?? title}
        openLabel={label ?? title}
        attribution={OSM_ATTRIBUTION}
        attributionUrl={OSM_COPYRIGHT_URL}
      />
      {purok ? <p className="text-caption text-ink-subtle">{purok}</p> : null}
      {hint ? <p className="text-caption text-ink-subtle">{hint}</p> : null}
    </div>
  );
}
