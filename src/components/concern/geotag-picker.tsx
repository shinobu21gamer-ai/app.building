"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Label } from "@/components/ui/field";
import { copy, type Locale } from "@/lib/i18n";

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

/**
 * Captures where the concern is. The device's own location is preferred (it is
 * the only source with a real accuracy figure); typing coordinates stays
 * available for when the resident is not on site. The values are submitted as
 * hidden inputs alongside the rest of the concern form.
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

  function capture() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("failed");
      setNote(t.geotagFailed);
      return;
    }
    setStatus("locating");
    setNote(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setValue((prev) => ({
          ...prev,
          lat: position.coords.latitude.toFixed(6),
          lng: position.coords.longitude.toFixed(6),
          accuracyM: Math.round(position.coords.accuracy).toString(),
          source: "GPS_PINNED",
        }));
        setStatus("captured");
        setNote(
          t.geotagAccuracy.replace(
            "{meters}",
            String(Math.round(position.coords.accuracy))
          )
        );
      },
      () => {
        setStatus("failed");
        setNote(t.geotagFailed);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  }

  return (
    <fieldset className="space-y-3 rounded-lg border border-slate-200 px-4 py-3">
      <legend className="px-1 text-sm font-semibold text-slate-800">
        {t.geotagTitle}
      </legend>
      <p className="text-xs text-slate-500">{t.geotagDesc}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={status === "locating"}
          onClick={capture}
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
                source: prev.source || "MANUAL",
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
                source: prev.source || "MANUAL",
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
            className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30"
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

      <p className="text-xs text-slate-500">{t.geotagMapHint}</p>

      <input type="hidden" name="locationLat" value={value.lat} />
      <input type="hidden" name="locationLng" value={value.lng} />
      <input type="hidden" name="locationAccuracyM" value={value.accuracyM} />
      <input type="hidden" name="locationSource" value={value.source} />
      <input type="hidden" name="locationPurok" value={value.purok} />
    </fieldset>
  );
}
