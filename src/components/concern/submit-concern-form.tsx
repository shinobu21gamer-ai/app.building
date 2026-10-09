"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Send,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Tag,
  MapPin,
  FileText,
  ImageIcon,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  FieldError,
  FormMessage,
  Input,
  Label,
  Textarea,
} from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { apiRequest } from "@/lib/api-client";
import { createConcernSchema } from "@/lib/validations/concern";
import { cn } from "@/lib/utils";
import { copy, type Locale } from "@/lib/i18n";
import { openStreetMapUrl } from "@/lib/maps";

type CategoryOption = { id: number; name: string };

export type FactorOption = {
  key: string;
  label: string;
  description: string | null;
  minScore: number;
  maxScore: number;
};

type FieldKey =
  | "title"
  | "description"
  | "locationArea"
  | "locationAddress"
  | "categoryId"
  | "image"
  | "urgencyScore"
  | "impactScore"
  | "affectedPopulationScore"
  | "safetyScore";

type FieldErrors = Partial<Record<FieldKey, string>>;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

const FACTOR_FIELD: Record<string, FieldKey> = {
  URGENCY: "urgencyScore",
  IMPACT: "impactScore",
  AFFECTED_POPULATION: "affectedPopulationScore",
  SAFETY: "safetyScore",
};

function factorOptionLabel(
  labels: Record<string, string[]>,
  factorKey: string,
  value: number,
  minScore: number,
  maxScore: number
): string {
  const options = labels[factorKey];
  if (options && maxScore - minScore + 1 === options.length) {
    return `${value} — ${options[value - minScore]}`;
  }
  if (value === minScore) return `${value} — lowest`;
  if (value === maxScore) return `${value} — highest`;
  return String(value);
}

const selectBaseStyles =
  "h-10 w-full rounded-lg border bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-600/30";

function selectStyles(invalid: boolean) {
  return cn(
    selectBaseStyles,
    invalid
      ? "border-red-500 focus:border-red-500"
      : "border-slate-300 focus:border-brand-600"
  );
}

export function SubmitConcernForm({
  categories,
  factors,
  areas,
  locale = "en",
}: {
  categories: CategoryOption[];
  factors: FactorOption[];
  areas: string[];
  locale?: Locale;
}) {
  const t = copy[locale].submit;
  const router = useRouter();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(selectedFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedFile]);

  function handleBlur(field: FieldKey) {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;

    if (!file) {
      setSelectedFile(null);
      setFieldErrors((prev) => ({
        ...prev,
        image: "A proof image is required.",
      }));
      return;
    }

    let error: string | null = null;
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      error = "Only JPEG, PNG, or WebP images are allowed.";
    } else if (file.size > MAX_IMAGE_BYTES) {
      error = "The image must be 5 MB or smaller.";
    }

    if (error) {
      setFieldErrors((prev) => ({ ...prev, image: error }));
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setFieldErrors((prev) => ({ ...prev, image: undefined }));
    setSelectedFile(file);
  }

  function pinLocation() {
    if (!navigator.geolocation) {
      setGeoError(t.geoUnsupported);
      return;
    }
    setGeoLoading(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setGeoLoading(false);
      },
      (error) => {
        setGeoError(error.code === 1 ? t.geoDenied : t.geoFailed);
        setGeoLoading(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60_000 }
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const data = new FormData(event.currentTarget);
    const values = {
      title: String(data.get("title") ?? ""),
      description: String(data.get("description") ?? ""),
      locationArea: String(data.get("locationArea") ?? ""),
      locationAddress: String(data.get("locationAddress") ?? ""),
      categoryId: String(data.get("categoryId") ?? ""),
      urgencyScore: String(data.get("urgencyScore") ?? ""),
      impactScore: String(data.get("impactScore") ?? ""),
      affectedPopulationScore: String(
        data.get("affectedPopulationScore") ?? ""
      ),
      safetyScore: String(data.get("safetyScore") ?? ""),
    };

    const nextErrors: FieldErrors = {};
    const parsed = createConcernSchema.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (
          typeof key === "string" &&
          key in values &&
          !nextErrors[key as FieldKey]
        ) {
          nextErrors[key as FieldKey] = issue.message;
        }
      }
    }
    if (!values.locationArea) {
      nextErrors.locationArea = t.areaRequired;
    }
    const combinedLocation = values.locationArea
      ? `${values.locationArea} - ${values.locationAddress.trim()}`
      : values.locationAddress.trim();
    if (combinedLocation.length > 255) {
      nextErrors.locationAddress = t.tooLong;
    }
    if (fieldErrors.image) nextErrors.image = fieldErrors.image;
    if (!selectedFile) nextErrors.image = "A proof image is required.";

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      // Mark all fields with errors as touched
      const allTouched: Partial<Record<FieldKey, boolean>> = {};
      for (const key of Object.keys(nextErrors)) {
        allTouched[key as FieldKey] = true;
      }
      setTouched((prev) => ({ ...prev, ...allTouched }));
      showToast("error", t.fix);
      return;
    }

    const payload = new FormData();
    payload.set("title", values.title.trim());
    payload.set("description", values.description.trim());
    payload.set("locationAddress", combinedLocation);
    payload.set("categoryId", values.categoryId);
    payload.set("urgencyScore", values.urgencyScore);
    payload.set("impactScore", values.impactScore);
    payload.set("affectedPopulationScore", values.affectedPopulationScore);
    payload.set("safetyScore", values.safetyScore);
    if (coords) {
      payload.set("locationLat", String(coords.lat));
      payload.set("locationLng", String(coords.lng));
    }
    if (selectedFile) payload.set("image", selectedFile);

    setSubmitting(true);
    const result = await apiRequest<{ redirect: string }>(
      "/api/v1/concerns",
      { method: "POST", body: payload }
    );
    setSubmitting(false);

    if (!result.success) {
      if (
        result.error.code === "VALIDATION_ERROR" &&
        Array.isArray(result.error.details)
      ) {
        const serverErrors: FieldErrors = {};
        for (const issue of result.error.details as {
          path: (string | number)[];
          message: string;
        }[]) {
          const key = issue.path?.[0];
          if (typeof key === "string" && key in values) {
            serverErrors[key as FieldKey] = issue.message;
          }
        }
        if (Object.keys(serverErrors).length > 0) setFieldErrors(serverErrors);
      }
      setFormError(result.error.message);
      showToast("error", result.error.message || t.fail);
      return;
    }

    showToast("success", t.success);
    router.push(`${result.data.redirect}?created=1`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {formError && <FormMessage tone="error">{formError}</FormMessage>}

      <div>
        <Label htmlFor="title">
          <span className="inline-flex items-center gap-1.5">
            <FileText size={14} className="text-slate-500" />
            {t.concernTitle}
          </span>
        </Label>
        <div className="relative">
          <Input
            id="title"
            name="title"
            placeholder={t.titlePlaceholder}
            maxLength={150}
            invalid={Boolean(fieldErrors.title)}
            onBlur={() => handleBlur("title")}
            className={cn(
              "pr-9",
              fieldErrors.title && touched.title && "border-red-500"
            )}
          />
          {touched.title && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2">
              {fieldErrors.title ? (
                <AlertCircle size={16} className="text-red-500" />
              ) : (
                <CheckCircle2 size={16} className="text-emerald-500" />
              )}
            </span>
          )}
        </div>
        {fieldErrors.title && touched.title && (
          <FieldError>{fieldErrors.title}</FieldError>
        )}
      </div>

      <div>
        <Label htmlFor="categoryId">
          <span className="inline-flex items-center gap-1.5">
            <Tag size={14} className="text-slate-500" />
            {t.category}
          </span>
        </Label>
        <select
          id="categoryId"
          name="categoryId"
          defaultValue=""
          className={cn(selectStyles(Boolean(fieldErrors.categoryId)), "pr-9")}
          onBlur={() => handleBlur("categoryId")}
        >
          <option value="" disabled>
            {t.categoryPlaceholder}
          </option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        {fieldErrors.categoryId && (
          <FieldError>{fieldErrors.categoryId}</FieldError>
        )}
      </div>

      <div>
        <Label htmlFor="description">
          <span className="inline-flex items-center gap-1.5">
            <FileText size={14} className="text-slate-500" />
            {t.description}
          </span>
        </Label>
        <Textarea
          id="description"
          name="description"
          rows={5}
          placeholder={t.descriptionPlaceholder}
          maxLength={2000}
          invalid={Boolean(fieldErrors.description)}
          onBlur={() => handleBlur("description")}
        />
        {fieldErrors.description && touched.description && (
          <FieldError>{fieldErrors.description}</FieldError>
        )}
      </div>

      <div>
        <Label htmlFor="locationArea">
          <span className="inline-flex items-center gap-1.5">
            <MapPin size={14} className="text-slate-500" />
            {t.area}
          </span>
        </Label>
        <select
          id="locationArea"
          name="locationArea"
          defaultValue=""
          className={cn(selectStyles(Boolean(fieldErrors.locationArea)), "pr-9")}
          onBlur={() => handleBlur("locationArea")}
        >
          <option value="" disabled>
            {t.areaPlaceholder}
          </option>
          {areas.map((area) => (
            <option key={area} value={area}>
              {area}
            </option>
          ))}
        </select>
        {fieldErrors.locationArea && touched.locationArea && (
          <FieldError>{fieldErrors.locationArea}</FieldError>
        )}
      </div>

      <div>
        <Label htmlFor="locationAddress">
          <span className="inline-flex items-center gap-1.5">
            <MapPin size={14} className="text-slate-500" />
            {t.exact}
          </span>
        </Label>
        <div className="relative">
          <Input
            id="locationAddress"
            name="locationAddress"
            placeholder={t.exactPlaceholder}
            maxLength={220}
            invalid={Boolean(fieldErrors.locationAddress)}
            onBlur={() => handleBlur("locationAddress")}
            className={cn("pr-9")}
          />
          {touched.locationAddress && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2">
              {fieldErrors.locationAddress ? (
                <AlertCircle size={16} className="text-red-500" />
              ) : (
                <CheckCircle2 size={16} className="text-emerald-500" />
              )}
            </span>
          )}
        </div>
        {fieldErrors.locationAddress && touched.locationAddress && (
          <FieldError>{fieldErrors.locationAddress}</FieldError>
        )}
      </div>

      <div className="rounded-lg border border-dashed border-slate-300 p-4">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
          <MapPin size={14} className="text-slate-500" />
          {t.pin}
        </p>
        <p className="mt-1 text-xs text-slate-500">{t.pinHelp}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={pinLocation}
            disabled={geoLoading}
          >
            {geoLoading ? t.locating : t.useLocation}
          </Button>
          {coords ? (
            <>
              <a
                href={openStreetMapUrl(coords.lat, coords.lng)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold text-brand-700 hover:text-brand-800"
              >
                {t.openMap}
              </a>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setCoords(null)}
              >
                {t.clearPin}
              </Button>
            </>
          ) : null}
        </div>
        {coords ? (
          <p className="mt-2 text-xs text-emerald-700">
            {t.pinned}: {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
          </p>
        ) : null}
        {geoError ? <FieldError>{geoError}</FieldError> : null}
      </div>

      <fieldset className="rounded-lg border border-slate-200 p-4">
        <legend className="inline-flex items-center gap-1.5 px-1 text-sm font-semibold text-slate-700">
          <AlertTriangle size={14} className="text-slate-500" />
          {t.priority}
        </legend>
        <p className="mb-3 text-xs text-slate-500">{t.priorityHelp}</p>
        <div className="space-y-4">
          {factors.map((factor) => {
            const fieldKey = FACTOR_FIELD[factor.key];
            const options: number[] = [];
            for (let v = factor.minScore; v <= factor.maxScore; v += 1) {
              options.push(v);
            }
            return (
              <div key={factor.key}>
                <Label htmlFor={fieldKey}>{factor.label}</Label>
                {factor.description && (
                  <p className="mb-1 text-xs text-slate-500">
                    {factor.description}
                  </p>
                )}
                <select
                  id={fieldKey}
                  name={fieldKey}
                  defaultValue=""
                  className={selectStyles(Boolean(fieldErrors[fieldKey]))}
                  onBlur={() => handleBlur(fieldKey)}
                >
                  <option value="" disabled>
                    Select a rating
                  </option>
                  {options.map((value) => (
                    <option key={value} value={value}>
                      {factorOptionLabel(
                        t.factors,
                        factor.key,
                        value,
                        factor.minScore,
                        factor.maxScore
                      )}
                    </option>
                  ))}
                </select>
                {fieldErrors[fieldKey] && touched[fieldKey] && (
                  <FieldError>{fieldErrors[fieldKey]}</FieldError>
                )}
              </div>
            );
          })}
        </div>
      </fieldset>

      <div>
        <Label htmlFor="image">
          <span className="inline-flex items-center gap-1.5">
            <ImageIcon size={14} className="text-slate-500" />
            {t.image}
          </span>
        </Label>
        <input
          ref={fileInputRef}
          id="image"
          name="image"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          required
          onChange={handleFileChange}
          onBlur={() => handleBlur("image")}
          className={cn(
            "block w-full cursor-pointer rounded-lg border bg-white text-sm text-slate-600 file:mr-3 file:rounded-l-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200",
            fieldErrors.image && !selectedFile
              ? "border-red-500"
              : "border-slate-300"
          )}
        />
        <p className="mt-1 text-xs text-slate-500">
          {t.imageHelp}
        </p>
        {selectedFile && (
          <div className="mt-2 flex items-start gap-3">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Selected proof"
                className="h-20 w-20 rounded-lg border border-slate-200 object-cover"
              />
            ) : null}
            <p className="inline-flex items-center gap-1 text-xs text-emerald-600">
              <CheckCircle2 size={12} />
              {t.selected}: {selectedFile.name} (
              {Math.ceil(selectedFile.size / 1024)} KB)
            </p>
          </div>
        )}
        {fieldErrors.image && touched.image && (
          <FieldError>{fieldErrors.image}</FieldError>
        )}
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" disabled={submitting}>
          {submitting ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              {t.sending}
            </>
          ) : (
            <>
              <Send size={16} />
              {t.send}
            </>
          )}
        </Button>
        <Button href="/resident/concerns" variant="outline">
          <ArrowLeft size={16} />
          {t.cancel}
        </Button>
      </div>
    </form>
  );
}
