// Pure geolocation helpers for the public transparency projection: coarse
// coordinates, a geohash for the map, and title scrubbing. No database, no
// framework — unit tested on its own.

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/** Standard geohash encoding. */
export function encodeGeohash(lat: number, lng: number, precision = 5): string {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let hash = "";
  let bit = 0;
  let ch = 0;
  let even = true;

  while (hash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        ch = (ch << 1) | 1;
        lngMin = mid;
      } else {
        ch = ch << 1;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        ch = (ch << 1) | 1;
        latMin = mid;
      } else {
        ch = ch << 1;
        latMax = mid;
      }
    }
    even = !even;
    if (bit < 4) {
      bit++;
    } else {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }

  return hash;
}

/** Two decimals ≈ 1.1 km — close enough for a map dot, useless for a doorstep. */
export function coarsenCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const URL_RE = /https?:\/\/\S+/gi;
const PHONE_RE = /(?:\+?63|0)9\d{2}[\s.-]?\d{3}[\s.-]?\d{4}/g;
const LONG_DIGITS_RE = /\d[\d\s.-]{4,}\d/g;
const DIGITS_RE = /\d+/g;

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Scrubs a case title for publication: removes contact details, house numbers
 * and anything matching the resident's own names, then collapses whitespace.
 * Returns null when too little survives to be meaningful.
 */
export function scrubPublicTitle(
  rawTitle: string,
  privateTokens: string[] = []
): string | null {
  let text = ` ${rawTitle} `
    .replace(EMAIL_RE, " ")
    .replace(URL_RE, " ")
    .replace(PHONE_RE, " ")
    .replace(LONG_DIGITS_RE, " ")
    .replace(DIGITS_RE, " ");

  for (const token of privateTokens) {
    const trimmed = token.trim();
    if (trimmed.length < 2) continue;
    text = text.replace(
      new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, "gi"),
      " "
    );
  }

  const cleaned = text
    .replace(/\s+/g, " ")
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "");
  if (cleaned.length < 3) return null;
  return cleaned.slice(0, 90);
}

/** Anonymous public reference. Never derived from the case number. */
export function buildPublicRef(concernId: number, suffix: string): string {
  return `BR-PUB-${concernId.toString(36).toUpperCase()}${suffix
    .toUpperCase()
    .slice(0, 4)}`;
}
