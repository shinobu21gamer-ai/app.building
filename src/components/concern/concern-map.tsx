import { hasCoordinates, openStreetMapUrl } from "@/lib/maps";

/**
 * A location preview. The embedded map is optional: when the browser cannot
 * load the external tiles the component still shows the coordinates and a link,
 * so a case page never depends on a third party being reachable.
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
  const coords = { lat, lng };
  if (!hasCoordinates(coords)) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
        {label ?? "—"}
      </div>
    );
  }

  const delta = 0.004;
  const bbox = [
    (coords.lng - delta).toFixed(5),
    (coords.lat - delta).toFixed(5),
    (coords.lng + delta).toFixed(5),
    (coords.lat + delta).toFixed(5),
  ].join("%2C");

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <iframe
          title={title}
          src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${coords.lat.toFixed(5)}%2C${coords.lng.toFixed(5)}`}
          className="h-56 w-full"
          loading="lazy"
        />
      </div>
      <p className="text-xs text-slate-500">
        {purok ? `${purok} · ` : ""}
        {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
      </p>
      <a
        href={openStreetMapUrl(coords.lat, coords.lng)}
        target="_blank"
        rel="noreferrer"
        className="text-xs font-medium text-brand-700 underline"
      >
        {label ?? title}
      </a>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
