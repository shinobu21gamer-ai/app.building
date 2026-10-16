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

/* ---------------------------------------------------------------------------
   Slippy-map tiles
   ---------------------------------------------------------------------------
   The case page needs a map, and the cheapest, most privacy-respecting way to
   show one is a handful of static tiles from OpenStreetMap: no third-party
   JavaScript, no cookies, no API key, and it keeps working when the embed
   iframe is blocked by the Content-Security-Policy (which it was — an iframe
   from another origin needs `frame-src`, and the production policy only
   allows `'self'`).
   --------------------------------------------------------------------------- */

/** Tile server. Attribution is required by the OSM tile usage policy. */
export const OSM_TILE_BASE = "https://tile.openstreetmap.org";
/**
 * The tile URL template used by the interactive map (Leaflet substitutes
 * `{s}`, `{z}`, `{x}`, `{y}`). Kept in one place with the static preview so a
 * change of tile provider only ever touches this module.
 */
export const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
/** Tile zoom ceiling for OpenStreetMap's raster tiles. */
export const OSM_MAX_ZOOM = 19;
export const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";
export const OSM_ATTRIBUTION = "© OpenStreetMap contributors";

/** Zoom used for a single case location: street level without street names. */
export const MAP_ZOOM = 16;

/**
 * Where the location picker opens before the resident has placed a pin:
 * Dasmariñas, Cavite (the area the case data uses), so "tap the map" starts
 * from the neighbourhood instead of an empty ocean view.
 */
export const MAP_DEFAULT_CENTER = { lat: 14.3294, lng: 120.9367 } as const;

/** Web-mercator limits; beyond these a tile coordinate stops being meaningful. */
const MAX_LATITUDE = 85.05112878;

export function clampLatitude(lat: number): number {
  if (!Number.isFinite(lat)) return 0;
  return Math.min(MAX_LATITUDE, Math.max(-MAX_LATITUDE, lat));
}

/** Wraps a longitude into [-180, 180). */
export function normalizeLongitude(lng: number): number {
  if (!Number.isFinite(lng)) return 0;
  const wrapped = ((lng + 180) % 360 + 360) % 360 - 180;
  return wrapped;
}

/**
 * Fractional tile coordinates: the integer part is the tile, the fraction is
 * where inside that tile the point falls. Fractional values are what let the
 * marker sit on the right spot of a mosaic instead of snapping to a corner.
 */
export function tilePoint(
  lat: number,
  lng: number,
  zoom: number
): { x: number; y: number } {
  // Sanitised here rather than at the call sites: a missing zoom (an
  // undefined prop, an empty query string) used to produce NaN coordinates.
  const z = Number.isFinite(zoom) ? Math.max(0, Math.min(22, Math.floor(zoom))) : 0;
  const size = 2 ** z;
  const latitude = clampLatitude(lat);
  const rad = (latitude * Math.PI) / 180;

  const x = ((normalizeLongitude(lng) + 180) / 360) * size;
  const y =
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * size;

  return {
    x: Math.min(size, Math.max(0, x)),
    y: Math.min(size, Math.max(0, y)),
  };
}

export function tileUrl(x: number, y: number, zoom: number): string {
  return `${OSM_TILE_BASE}/${zoom}/${x}/${y}.png`;
}

export type MapTile = {
  key: string;
  url: string;
  x: number;
  y: number;
  /** Grid slot inside the mosaic, 0-based. */
  column: number;
  row: number;
};

/**
 * A `columns × rows` mosaic of tiles centred on the point, plus the marker
 * position as a percentage of the mosaic. Tiles are clamped to the world so a
 * point near the edge still produces a full grid (the edge tiles repeat).
 */
export function tileMosaic(
  lat: number,
  lng: number,
  zoom: number,
  columns = 3,
  rows = 2
): {
  tiles: MapTile[];
  marker: { leftPercent: number; topPercent: number };
  attribution: string;
  attributionUrl: string;
} {
  const z = Number.isFinite(zoom) ? Math.max(0, Math.min(22, Math.floor(zoom))) : 0;
  const size = 2 ** z;
  const point = tilePoint(lat, lng, z);
  const anchorX = Math.min(size - 1, Math.floor(point.x));
  const anchorY = Math.min(size - 1, Math.floor(point.y));
  const startX = Math.max(0, Math.min(size - columns, anchorX - 1));
  const startY = Math.max(0, Math.min(size - rows, anchorY - 1));
  // Exported so a tap on the mosaic can be turned back into a lat/lng
  // with the same origin the tiles used.

  const tiles: MapTile[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = startX + column;
      const y = startY + row;
      tiles.push({ key: `${z}/${x}/${y}`, url: tileUrl(x, y, z), x, y, column, row });
    }
  }

  const leftPercent = ((point.x - startX) / columns) * 100;
  const topPercent = ((point.y - startY) / rows) * 100;

  return {
    tiles,
    marker: {
      leftPercent: Math.min(100, Math.max(0, leftPercent)),
      topPercent: Math.min(100, Math.max(0, topPercent)),
    },
    startX,
    startY,
    columns,
    rows,
    zoom: z,
    attribution: OSM_ATTRIBUTION,
    attributionUrl: OSM_COPYRIGHT_URL,
  };
}

/**
 * Inverse of `tilePoint`: fractional OSM tile x/y → WGS84. Used when the
 * resident taps the static mosaic to drop a pin (Leaflet is not required).
 */
export function latLngFromTilePoint(
  x: number,
  y: number,
  zoom: number
): { lat: number; lng: number } {
  const z = Number.isFinite(zoom) ? Math.max(0, Math.min(22, Math.floor(zoom))) : 0;
  const size = 2 ** z;
  const clampedX = Math.min(size, Math.max(0, x));
  const clampedY = Math.min(size, Math.max(0, y));
  const lng = (clampedX / size) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * clampedY) / size;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { lat: clampLatitude(lat), lng: normalizeLongitude(lng) };
}

/** Where a tap on the mosaic lands, in WGS84. Percents are 0–100 of the grid. */
export function pickOnMosaic(
  mosaic: { startX: number; startY: number; columns: number; rows: number; zoom: number },
  leftPercent: number,
  topPercent: number
): { lat: number; lng: number } {
  const tileX = mosaic.startX + (leftPercent / 100) * mosaic.columns;
  const tileY = mosaic.startY + (topPercent / 100) * mosaic.rows;
  return latLngFromTilePoint(tileX, tileY, mosaic.zoom);
}
