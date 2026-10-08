"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import { MapPin, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const DEFAULT_CENTER: [number, number] = [12.8797, 121.774];
const DEFAULT_ZOOM = 5;

type OfficeLocationPickerProps = {
  latitude: number | null;
  longitude: number | null;
  onChange: (latitude: number, longitude: number) => void;
  onClear: () => void;
};

export function OfficeLocationPicker({
  latitude,
  longitude,
  onChange,
  onClear,
}: OfficeLocationPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<LeafletMarker | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const onChangeRef = useRef(onChange);
  const coordinatesRef = useRef({ latitude, longitude });
  const hasCenteredOnPinRef = useRef(false);

  onChangeRef.current = onChange;
  coordinatesRef.current = { latitude, longitude };

  useEffect(() => {
    let disposed = false;

    void import("leaflet").then((L) => {
      const container = containerRef.current;
      if (disposed || !container) return;

      const currentCoordinates = coordinatesRef.current;
      const hasInitialPin =
        currentCoordinates.latitude !== null && currentCoordinates.longitude !== null;
      const initialCenter: [number, number] = hasInitialPin
        ? [currentCoordinates.latitude!, currentCoordinates.longitude!]
        : DEFAULT_CENTER;
      const map = L.map(container, {
        scrollWheelZoom: true,
        zoomControl: true,
      }).setView(initialCenter, hasInitialPin ? 16 : DEFAULT_ZOOM);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      const markerIcon = L.divIcon({
        className: "office-map-pin",
        html: '<span class="office-map-pin__dot" aria-hidden="true"></span>',
        iconSize: [26, 30],
        iconAnchor: [13, 28],
      });

      mapRef.current = map;
      leafletRef.current = L;
      hasCenteredOnPinRef.current = hasInitialPin;

      const placeMarker = (lat: number, lng: number) => {
        if (!markerRef.current) {
          const marker = L.marker([lat, lng], {
            icon: markerIcon,
            draggable: true,
            title: "Office location",
            alt: "Office location pin. Drag to adjust.",
          }).addTo(map);
          marker.on("dragend", () => {
            const point = marker.getLatLng();
            const nextLatitude = Number(point.lat.toFixed(6));
            const nextLongitude = Number(point.lng.toFixed(6));
            onChangeRef.current(nextLatitude, nextLongitude);
          });
          markerRef.current = marker;
        } else {
          markerRef.current.setLatLng([lat, lng]);
        }
      };

      if (hasInitialPin) {
        placeMarker(currentCoordinates.latitude!, currentCoordinates.longitude!);
      }

      map.on("click", (event) => {
        const nextLatitude = Number(event.latlng.lat.toFixed(6));
        const nextLongitude = Number(event.latlng.lng.toFixed(6));
        placeMarker(nextLatitude, nextLongitude);
        hasCenteredOnPinRef.current = true;
        onChangeRef.current(nextLatitude, nextLongitude);
      });

      window.setTimeout(() => map.invalidateSize(), 0);
    }).catch(() => {
      // The address field remains usable if the map bundle or tile service fails.
    });

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
      leafletRef.current = null;
      hasCenteredOnPinRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;

    if (latitude === null || longitude === null) {
      markerRef.current?.remove();
      markerRef.current = null;
      hasCenteredOnPinRef.current = false;
      return;
    }

    if (!markerRef.current) {
      const markerIcon = L.divIcon({
        className: "office-map-pin",
        html: '<span class="office-map-pin__dot" aria-hidden="true"></span>',
        iconSize: [26, 30],
        iconAnchor: [13, 28],
      });
      const marker = L.marker([latitude, longitude], {
        icon: markerIcon,
        draggable: true,
        title: "Office location",
        alt: "Office location pin. Drag to adjust.",
      }).addTo(map);
      marker.on("dragend", () => {
        const point = marker.getLatLng();
        onChangeRef.current(Number(point.lat.toFixed(6)), Number(point.lng.toFixed(6)));
      });
      markerRef.current = marker;
    } else {
      markerRef.current.setLatLng([latitude, longitude]);
    }

    if (!hasCenteredOnPinRef.current) {
      map.setView([latitude, longitude], Math.max(map.getZoom(), 16));
      hasCenteredOnPinRef.current = true;
    }
  }, [latitude, longitude]);

  return (
    <section aria-labelledby="office-map-heading" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="office-map-heading" className="text-sm font-semibold text-slate-900">
            Pin the office on the map
          </h3>
          <p className="mt-0.5 text-sm leading-5 text-slate-600">
            Click the map to place a pin, then drag it to adjust the exact position.
          </p>
        </div>
        {latitude !== null && longitude !== null && (
          <Button type="button" variant="outline" size="sm" onClick={onClear}>
            <X size={14} aria-hidden="true" />
            Clear pin
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-300 bg-slate-100">
        <div
          ref={containerRef}
          className="office-location-map h-72 w-full sm:h-80"
          role="application"
          aria-label="Office location map. Click to place or move an office pin."
        />
      </div>

      {latitude !== null && longitude !== null ? (
        <p className="flex items-center gap-1.5 text-sm font-medium text-slate-700" aria-live="polite">
          <MapPin size={15} className="shrink-0 text-brand-700" aria-hidden="true" />
          Selected coordinates: {latitude.toFixed(6)}, {longitude.toFixed(6)}
        </p>
      ) : (
        <p className="text-sm text-slate-600">No map pin selected. You can still use the written office address.</p>
      )}
    </section>
  );
}
