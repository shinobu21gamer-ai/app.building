import { describe, expect, it } from "vitest";

import {
  clampLatitude,
  hasCoordinates,
  normalizeLongitude,
  openStreetMapUrl,
  OSM_TILE_URL,
  tileMosaic,
  tilePoint,
  tileUrl,
} from "@/lib/maps";

describe("tilePoint", () => {
  it("puts the null island in the middle of the world at zoom 0", () => {
    expect(tilePoint(0, 0, 0)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("splits the world into four tiles at zoom 2", () => {
    // Greenwich/equator sits exactly on the corner of the four tiles, which
    // means tile (2, 2) starts there.
    expect(tilePoint(0, 0, 2)).toEqual({ x: 2, y: 2 });
    expect(tilePoint(0.1, -0.1, 2).x).toBeLessThan(2);
    // A point north of the equator sits above the corner, and tile y grows
    // southwards.
    expect(tilePoint(0.1, -0.1, 2).y).toBeLessThan(2);
    expect(tilePoint(-0.1, -0.1, 2).y).toBeGreaterThan(2);
  });

  it("moves east with longitude and north (up) with latitude", () => {
    const west = tilePoint(14.3, 120.9, 16);
    const east = tilePoint(14.3, 121.1, 16);
    expect(east.x).toBeGreaterThan(west.x);

    const north = tilePoint(14.5, 121, 16);
    const south = tilePoint(14.1, 121, 16);
    expect(north.y).toBeLessThan(south.y);
  });

  it("stays inside the grid when the point is given in another hemisphere", () => {
    const point = tilePoint(-89, 179.9, 3);
    expect(point.x).toBeLessThanOrEqual(8);
    expect(point.y).toBeLessThanOrEqual(8);
    expect(point.x).toBeGreaterThanOrEqual(0);
    expect(point.y).toBeGreaterThanOrEqual(0);
  });

  it("survives nonsense input instead of rendering NaN", () => {
    // A missing zoom falls back to the whole-world tile, and nonsense
    // coordinates to the centre of it: a map that is wrong is still better
    // than a map of NaN.
    expect(tilePoint(Number.NaN, Number.NaN, Number.NaN)).toEqual({
      x: 0.5,
      y: 0.5,
    });
    expect(clampLatitude(120)).toBeLessThan(86);
  });
});

describe("normalizeLongitude", () => {
  it("wraps past the antimeridian", () => {
    expect(normalizeLongitude(181)).toBeCloseTo(-179, 6);
    expect(normalizeLongitude(-181)).toBeCloseTo(179, 6);
    expect(normalizeLongitude(120.98)).toBeCloseTo(120.98, 6);
  });
});

describe("tileUrl", () => {
  it("builds an OSM tile URL", () => {
    expect(tileUrl(53_000, 27_000, 16)).toBe(
      "https://tile.openstreetmap.org/16/53000/27000.png"
    );
  });

  it("uses the policy-compliant OSM host, not the legacy {s} subdomains", () => {
    // {s}.tile.openstreetmap.org is how maps go blank on demo day: OSM now
    // serves https://tile.openstreetmap.org/{z}/{x}/{y}.png and may block the rest.
    expect(OSM_TILE_URL).toBe(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
    );
    expect(OSM_TILE_URL).not.toContain("{s}");
  });
});

describe("tileMosaic", () => {
  const dasmarinas = { lat: 14.3294, lng: 120.9367 };

  it("returns the requested grid", () => {
    const { tiles } = tileMosaic(dasmarinas.lat, dasmarinas.lng, 16);
    expect(tiles).toHaveLength(6);
    expect(new Set(tiles.map((tile) => tile.key)).size).toBe(6);
    expect(tiles[0]).toMatchObject({ column: 0, row: 0 });
    expect(tiles[5]).toMatchObject({ column: 2, row: 1 });
  });

  it("keeps the marker inside the mosaic", () => {
    const { marker } = tileMosaic(dasmarinas.lat, dasmarinas.lng, 16);
    expect(marker.leftPercent).toBeGreaterThanOrEqual(0);
    expect(marker.leftPercent).toBeLessThanOrEqual(100);
    expect(marker.topPercent).toBeGreaterThanOrEqual(0);
    expect(marker.topPercent).toBeLessThanOrEqual(100);
    // The point is not exactly on a tile corner, so it must not sit dead centre
    // of the mosaic either — that is what makes the marker useful.
    expect(marker.leftPercent).toBeGreaterThan(30);
  });

  it("clamps at the edges of the world instead of asking for tile -1", () => {
    const { tiles, marker } = tileMosaic(84.9, -179.9, 3, 3, 2);
    expect(tiles.every((tile) => tile.x >= 0 && tile.y >= 0)).toBe(true);
    expect(marker.leftPercent).toBeGreaterThanOrEqual(0);
  });

  it("carries the attribution the tile usage policy requires", () => {
    const { attribution, attributionUrl } = tileMosaic(14.33, 120.94, 16);
    expect(attribution).toContain("OpenStreetMap");
    expect(attributionUrl).toContain("openstreetmap.org");
  });
});

describe("existing helpers still behave", () => {
  it("narrows a coordinate pair", () => {
    expect(hasCoordinates({ lat: 14.3, lng: 120.9 })).toBe(true);
    expect(hasCoordinates({ lat: null, lng: 120.9 })).toBe(false);
    expect(hasCoordinates({ lat: Number.NaN, lng: 120.9 })).toBe(false);
  });

  it("builds the external pin URL", () => {
    expect(openStreetMapUrl(14.3294, 120.9367)).toBe(
      "https://www.openstreetmap.org/?mlat=14.329400&mlon=120.936700#map=17/14.329400/120.936700"
    );
  });
});
