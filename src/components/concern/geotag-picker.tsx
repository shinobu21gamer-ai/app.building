"use client";

import { useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Label } from "@/components/ui/field";
import { LeafletMap } from "@/components/ui/leaflet-map";
import { copy, type Locale } from "@/lib/i18n";
import { MAP_DEFAULT_CENTER } from "@/lib/maps";

export type GeotagValue = {
  lat: string;
  lng: string;
  accuracyM: string;
  source: string;
  purok: string;
};

const SOURCES = [
  { value: "GPS_PINNED", label: "GPS" },
  { value: "MAP_PINNED", label: "Map" },
  { value: "ADDRESS_GEOCODED", label: "Address" },
  { value: "MANUAL", label: "Manual" },
];

type FailureKind = "denied" | "unavailable" | "timeout" | "unsupported" | "failed";

/**
 * Captures where the concern is. The device's own location is preferred (it is
 * the only source with a real accuracy figure); tapping/dragging the pin on
 * the map and typing coordinates stay available for when the resident is not
 * on site or the device will not share its location. The values are submitted
 * as hidden inputs alongside the rest of the concern form.
 *
 * Two capture paths, because they fail differently:
 * - In the Android app the native `@capacitor/geolocation` plugin is used.
 *   The WebView's `navigator.geolocation` cannot prompt for the runtime
 *   permission itself, so without the plugin (and the ACCESS_*_LOCATION
 *   manifest entries) every capture silently landed in the error callback —
 *   the "could not read your location" residents kept seeing.
 * - In a browser, `navigator.geolocation` is used, but the failure is now
 *   classified (denied / GPS off / timeout / unsupported) instead of one
 *   generic message, and a high-accuracy timeout is retried once with a
 *   coarse, longer fix before giving up.
 */
export function GeotagPicker({ locale = "en" }: { locale?: Locale }) {
  const t = copy[locale].revamp.workflow;
  const [value, setValue] = useState<GeotagValue>({
    lat: "",
    lng: "",
    accuracyM: "",
    source: "",
    purok: "",
  });
  const [status, setStatus] = useState<"idle" | "locating" | "captured" | "failed">(
    "idle"
  );
  const [note, setNote] = useState<string | null>(null);

  const latNum = Number(value.lat);
  const lngNum = Number(value.lng);
  const hasPin =
    value.lat.trim() !== "" &&
    value.lng.trim() !== "" &&
    Number.isFinite(latNum) &&
    Number.isFinite(lngNum) &&
    Math.abs(latNum) <= 90 &&
    Math.abs(lngNum) <= 180;
  // Before any pin exists the map opens over the barangay so "tap the map"
  // starts from the neighbourhood — without drawing a pin there, which would
  // claim a location the resident never chose.
  const centre = hasPin
    ? { lat: latNum, lng: lngNum }
    : { lat: MAP_DEFAULT_CENTER.lat, lng: MAP_DEFAULT_CENTER.lng };

  function fail(kind: FailureKind) {
    setStatus("failed");
    setNote(
      kind === "denied"
        ? t.geotagDenied
        : kind === "unavailable"
          ? t.geotagUnavailable
          : kind === "timeout"
            ? t.geotagTimeout
            : kind === "unsupported"
              ? t.geotagUnsupported
              : t.geotagFailed
    );
  }

  function applyFix(lat: number, lng: number, accuracy: number, source: string) {
    setValue((prev) => ({
      ...prev,
      lat: lat.toFixed(6),
      lng: lng.toFixed(6),
      accuracyM: Math.round(accuracy).toString(),
      source,
    }));
    setStatus("captured");
    setNote(t.geotagAccuracy.replace("{meters}", String(Math.round(accuracy))));
  }

  /** Native-app capture via the Capacitor plugin. Returns false to fall back to the web path. */
  async function captureNative(): Promise<boolean> {
    let Geolocation: typeof import("@capacitor/geolocation").Geolocation;
    try {
      Geolocation = (await import("@capacitor/geolocation")).Geolocation;
    } catch {
      return false;
    }

    let permission;
    try {
      permission = await Geolocation.checkPermissions();
      if (permission.location !== "granted" && permission.coarseLocation !== "granted") {
        permission = await Geolocation.requestPermissions({
          permissions: ["location", "coarseLocation"],
        });
      }
    } catch {
      // The plugin throws when the device's Location switch itself is off.
      fail("unavailable");
      return true;
    }
    if (permission.location !== "granted" && permission.coarseLocation !== "granted") {
      fail("denied");
      return true;
    }

    try {
      const position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 30000,
      });
      applyFix(
        position.coords.latitude,
        position.coords.longitude,
        position.coords.accuracy,
        "GPS_PINNED"
      );
    } catch {
      // A high-accuracy fix commonly times out indoors; one coarse retry
      // before telling the resident it failed.
      try {
        const position = await Geolocation.getCurrentPosition({
          enableHighAccuracy: false,
          timeout: 20000,
          maximumAge: 60000,
        });
        applyFix(
          position.coords.latitude,
          position.coords.longitude,
          position.coords.accuracy,
          "GPS_PINNED"
        );
      } catch (error) {
        fail(error instanceof Error && /timeout/i.test(error.message) ? "timeout" : "unavailable");
      }
    }
    return true;
  }

  function captureWeb() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      // Also the insecure-context case: browsers withhold the API entirely
      // off HTTPS, so there is nothing to prompt for.
      fail("unsupported");
      return;
    }

    const attempt = (highAccuracy: boolean, isRetry: boolean) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          applyFix(
            position.coords.latitude,
            position.coords.longitude,
            position.coords.accuracy,
            "GPS_PINNED"
          );
        },
        (error) => {
          // error.code: 1 PERMISSION_DENIED, 2 POSITION_UNAVAILABLE, 3 TIMEOUT.
          if (error.code === error.TIMEOUT && !isRetry) {
            attempt(false, true);
            return;
          }
          fail(
            error.code === error.PERMISSION_DENIED
              ? "denied"
              : error.code === error.TIMEOUT
                ? "timeout"
                : "unavailable"
          );
        },
        highAccuracy
          ? { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
          : { enableHighAccuracy: false, timeout: 20000, maximumAge: 60000 }
      );
    };

    // If permission was already denied, the browser will not show a prompt
    // again — say so (and how to fix it) instead of spinning first.
    if (typeof navigator.permissions?.query === "function") {
      navigator.permissions
        .query({ name: "geolocation" })
        .then((result) => {
          if (result.state === "denied") {
            fail("denied");
          } else {
            attempt(true, false);
          }
        })
        .catch(() => attempt(true, false));
      return;
    }
    attempt(true, false);
  }

  async function capture() {
    setStatus("locating");
    setNote(null);
    if (Capacitor.isNativePlatform()) {
      try {
        if (await captureNative()) {
          return;
        }
      } catch {
        fail("failed");
        return;
      }
    }
    captureWeb();
  }

  function pickOnMap(lat: number, lng: number) {
    setValue((prev) => ({
      ...prev,
      lat: lat.toFixed(6),
      lng: lng.toFixed(6),
      // A map tap has no device accuracy figure to claim.
      accuracyM: "",
      source: "MAP_PINNED",
    }));
    setStatus("captured");
    setNote(t.geotagCaptured);
  }

  return (
    <fieldset className="space-y-3 rounded-control border border-line px-4 py-3">
      <legend className="px-1 text-sm font-semibold text-ink">
        {t.geotagTitle}
      </legend>
      <p className="text-xs text-ink-subtle">{t.geotagDesc}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={status === "locating"}
          onClick={() => void capture()}
        >
          {status === "locating" ? t.geotagLocating : t.geotagUse}
        </Button>
        {value.lat && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setValue({
                lat: "",
                lng: "",
                accuracyM: "",
                source: "",
                purok: value.purok,
              });
              setStatus("idle");
              setNote(null);
            }}
          >
            {t.geotagClear}
          </Button>
        )}
      </div>

      {note && (
        <FormMessage tone={status === "failed" ? "error" : "success"}>
          {note}
        </FormMessage>
      )}

      <div className="space-y-1.5">
        <LeafletMap
          lat={centre.lat}
          lng={centre.lng}
          zoom={14}
          title={t.geotagTitle}
          openLabel={t.geotagOpenMap}
          onPick={pickOnMap}
          showPin={hasPin}
          emptyPinLabel={t.geotagNoPin}
        />
        <p className="text-xs text-ink-subtle">{t.geotagTapMap}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="geotag-lat">{t.geotagLat}</Label>
          <Input
            id="geotag-lat"
            type="number"
            step="0.000001"
            min={-90}
            max={90}
            value={value.lat}
            onChange={(event) =>
              setValue((prev) => ({
                ...prev,
                lat: event.target.value,
                // Hand-typed coordinates are no longer a GPS/map fix.
                accuracyM: "",
                source: prev.source === "GPS_PINNED" || prev.source === "MAP_PINNED" ? "MANUAL" : prev.source || "MANUAL",
              }))
            }
          />
        </div>
        <div>
          <Label htmlFor="geotag-lng">{t.geotagLng}</Label>
          <Input
            id="geotag-lng"
            type="number"
            step="0.000001"
            min={-180}
            max={180}
            value={value.lng}
            onChange={(event) =>
              setValue((prev) => ({
                ...prev,
                lng: event.target.value,
                accuracyM: "",
                source: prev.source === "GPS_PINNED" || prev.source === "MAP_PINNED" ? "MANUAL" : prev.source || "MANUAL",
              }))
            }
          />
        </div>
        <div>
          <Label htmlFor="geotag-purok">{t.geotagPurok}</Label>
          <Input
            id="geotag-purok"
            maxLength={100}
            value={value.purok}
            placeholder={t.geotagPurokPlaceholder}
            onChange={(event) =>
              setValue((prev) => ({ ...prev, purok: event.target.value }))
            }
          />
        </div>
        <div>
          <Label htmlFor="geotag-source">{t.geotagSource}</Label>
          <select
            id="geotag-source"
            value={value.source}
            onChange={(event) =>
              setValue((prev) => ({ ...prev, source: event.target.value }))
            }
            className="h-10 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30"
          >
            <option value="">—</option>
            {SOURCES.map((source) => (
              <option key={source.value} value={source.value}>
                {source.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-xs text-ink-subtle">{t.geotagMapHint}</p>

      <input type="hidden" name="locationLat" value={value.lat} />
      <input type="hidden" name="locationLng" value={value.lng} />
      <input type="hidden" name="locationAccuracyM" value={value.accuracyM} />
      <input type="hidden" name="locationSource" value={value.source} />
      <input type="hidden" name="locationPurok" value={value.purok} />
    </fieldset>
  );
}
