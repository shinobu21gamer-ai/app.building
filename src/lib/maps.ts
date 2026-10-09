/** Public OpenStreetMap pin URL. Used as a navigation, not an embed. */
export function openStreetMapUrl(lat: number, lng: number): string {
  const latitude = lat.toFixed(6);
  const longitude = lng.toFixed(6);
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`;
}

export function hasCoordinates(
  lat: number | null | undefined,
  lng: number | null | undefined
): lat is number {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  );
}
