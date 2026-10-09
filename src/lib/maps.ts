/** Public OpenStreetMap pin URL. Used as a navigation, not an embed. */
export function openStreetMapUrl(lat: number, lng: number): string {
  const latitude = lat.toFixed(6);
  const longitude = lng.toFixed(6);
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`;
}

/** A coordinate pair that may be missing, e.g. straight from a database row. */
export interface CoordinatesInput {
  lat: number | null | undefined;
  lng: number | null | undefined;
}

/**
 * Narrows a possibly-missing coordinate pair to one where both values are
 * finite numbers. A predicate on the pair itself is required so that BOTH
 * `lat` and `lng` are narrowed at the call site.
 */
export function hasCoordinates(
  coords: CoordinatesInput
): coords is { lat: number; lng: number } {
  return (
    typeof coords.lat === "number" &&
    typeof coords.lng === "number" &&
    Number.isFinite(coords.lat) &&
    Number.isFinite(coords.lng)
  );
}
