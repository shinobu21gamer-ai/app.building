"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
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
import { FieldError, FieldRequirement, FormMessage, Input, Label, RequiredLegend, Textarea } from "@/components/ui/field";
import { PhotoPicker } from "@/components/ui/photo-picker";
import { useToast } from "@/components/ui/toast";
import { apiRequest } from "@/lib/api-client";
import { createConcernSchema } from "@/lib/validations/concern";
import {
  MAX_AFFECTED_PEOPLE,
  affectedScoreFromCount,
} from "@/lib/priority/affected";
import { cn } from "@/lib/utils";
import { copy, type Locale } from "@/lib/i18n";
import { DraftControls } from "@/components/concern/draft-controls";
import { removeConcernDraft } from "@/lib/concerns/draft";
import { GeotagPicker } from "@/components/concern/geotag-picker";

type CategoryOption = { id: number; name: string };

type TypeOption = { id: number; name: string };

export type IdentityGateProps = {
  verified: boolean;
  status: string;
  benefitTypeIds: number[];
  benefitCategoryIds: number[];
};

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
  | "affectedPeople"
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
  "h-10 w-full rounded-control border bg-surface px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-600/30";

function selectStyles(invalid: boolean) {
  return cn(
    selectBaseStyles,
    invalid
      ? "border-red-500 focus:border-red-500"
      : "border-line-strong focus:border-brand-600"
  );
}

export function SubmitConcernForm({
  userId,
  categories,
  factors,
  areas,
  types,
  locale = "en",
  anonymous = false,
  identityGate,
}: {
  userId: number;
  categories: CategoryOption[];
  factors: FactorOption[];
  areas: string[];
  types?: TypeOption[];
  locale?: Locale;
  anonymous?: boolean;
  identityGate?: IdentityGateProps;
}) {
  const t = copy[locale].submit;
  const verification = copy[locale].revamp.verification;
  const router = useRouter();
  const { showToast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  // "How many people are affected?" is answered with a number, not a 1–5 pick:
  // the band score the engine sums is derived from the headcount, so a problem
  // affecting 800 families is recorded with its real figure.
  const [affectedPeople, setAffectedPeople] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [typeId, setTypeId] = useState("");
  const identityBlocked = Boolean(
    identityGate &&
      !identityGate.verified &&
      ((typeId !== "" &&
        identityGate.benefitTypeIds.includes(Number(typeId))) ||
        (typeId === "" &&
          categoryId !== "" &&
          identityGate.benefitCategoryIds.includes(Number(categoryId))))
  );
  const identityBlockedMessage =
    identityGate?.status === "PENDING"
      ? verification.gatePending
      : identityGate?.status === "REJECTED"
        ? verification.gateRejected
        : verification.gateRequired;
  // The headcount field stands in for the affected-population factor, so it is
  // only asked for while that factor is switched on.
  const headcountFactor = factors.some(
    (factor) => factor.key === "AFFECTED_POPULATION"
  );
  // The band the typed headcount would score, shown under the field so the
  // resident sees what their number means before submitting.
  const typedCount = affectedPeople.trim();
  const typedValue = /^\d+$/.test(typedCount) ? Number(typedCount) : Number.NaN;
  const bandedScore =
    Number.isFinite(typedValue) &&
    typedValue >= 1 &&
    typedValue <= MAX_AFFECTED_PEOPLE
      ? affectedScoreFromCount(typedValue)
      : null;

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

  function handleFilePick(file: File | null) {
    setTouched((prev) => ({ ...prev, image: true }));

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
      return;
    }

    setFieldErrors((prev) => ({ ...prev, image: undefined }));
    setSelectedFile(file);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const data = new FormData(event.currentTarget);
    const selectedTypeId = String(data.get("typeId") ?? "").trim();
    const selectedCategoryId = String(data.get("categoryId") ?? "").trim();
    const blockedNow = Boolean(
      identityGate &&
        !identityGate.verified &&
        ((selectedTypeId !== "" &&
          identityGate.benefitTypeIds.includes(Number(selectedTypeId))) ||
          (selectedTypeId === "" &&
            selectedCategoryId !== "" &&
            identityGate.benefitCategoryIds.includes(
              Number(selectedCategoryId)
            )))
    );
    if (blockedNow) {
      setFormError(identityBlockedMessage);
      return;
    }

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
      affectedPeople: String(data.get("affectedPeople") ?? ""),
      safetyScore: String(data.get("safetyScore") ?? ""),
    };

    const nextErrors: FieldErrors = {};
    const count = values.affectedPeople.trim();
    const bandedScore = count === "" ? null : affectedScoreFromCount(Number(count));
    const parsed = createConcernSchema.safeParse({
      ...values,
      // The band score follows the headcount when one was given; the resident
      // never has to reconcile the two controls.
      affectedPopulationScore:
        bandedScore === null
          ? values.affectedPopulationScore
          : String(bandedScore),
      affectedPeople: count === "" ? undefined : count,
    });
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
    // The headcount is only on the form while the AFFECTED_POPULATION factor is
    // active, and then it is the answer to that factor — a blank one would leave
    // the priority score with nothing to sum.
    if (headcountFactor && count === "") {
      nextErrors.affectedPeople = t.affectedPeopleRequired;
    } else if (
      count !== "" &&
      (!/^\d+$/.test(count) ||
        Number(count) < 1 ||
        Number(count) > MAX_AFFECTED_PEOPLE)
    ) {
      nextErrors.affectedPeople = t.affectedPeopleError;
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
      document.getElementById(Object.keys(nextErrors)[0])?.focus();
      return;
    }

    const payload = new FormData();
    payload.set("title", values.title.trim());
    payload.set("description", values.description.trim());
    payload.set("locationAddress", combinedLocation);
    payload.set("categoryId", values.categoryId);
    // The geotag picker renders hidden inputs. The payload is rebuilt by hand,
    // so the pin has to be carried across explicitly or it is silently lost.
    for (const key of [
      "locationLat",
      "locationLng",
      "locationAccuracyM",
      "locationSource",
      "locationPurok",
    ]) {
      const value = String(data.get(key) ?? "").trim();
      if (value !== "") payload.set(key, value);
    }
    const typeId = String(data.get("typeId") ?? "").trim();
    if (typeId) payload.set("typeId", typeId);
    payload.set("urgencyScore", values.urgencyScore);
    payload.set("impactScore", values.impactScore);
    payload.set(
      "affectedPopulationScore",
      bandedScore === null ? values.affectedPopulationScore : String(bandedScore)
    );
    if (count !== "") payload.set("affectedPeople", count);
    payload.set("safetyScore", values.safetyScore);
    if (selectedFile) payload.set("image", selectedFile);

    setSubmitting(true);
    const result = await apiRequest<{ redirect: string }>(
      anonymous ? "/api/v1/concerns?anonymous=1" : "/api/v1/concerns",
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

    try { removeConcernDraft(sessionStorage, userId); } catch { /* optional storage */ }
    showToast("success", t.success);
    router.push(`${result.data.redirect}?created=1`);
    router.refresh();
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-5" noValidate>
      <DraftControls userId={userId} formRef={formRef} locale={locale} />
      {formError && <FormMessage tone="error">{formError}</FormMessage>}

      {Object.values(fieldErrors).some(Boolean) && (
        <div role="alert" className="rounded-control border border-danger-100 bg-danger-50 p-3 text-sm text-danger-700">
          <p className="font-semibold">{copy[locale].reportingExperience.errorSummary}</p>
          <ul className="mt-2 list-inside list-disc">
            {Object.entries(fieldErrors).filter(([, message]) => Boolean(message)).map(([field, message]) => (
              <li key={field}><a href={`#${field}`} className="underline" onClick={() => document.getElementById(field)?.focus()}>{message}</a></li>
            ))}
          </ul>
        </div>
      )}
      <RequiredLegend>{t.requiredLegend}</RequiredLegend>

      <div>
        <Label htmlFor="title" required>
          <span className="inline-flex items-center gap-1.5">
            <FileText size={14} className="text-ink-subtle" />
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
            aria-describedby={fieldErrors.title && touched.title ? "title-error" : undefined}
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
          <FieldError id="title-error">{fieldErrors.title}</FieldError>
        )}
      </div>

      <div>
        <Label htmlFor="categoryId" required>
          <span className="inline-flex items-center gap-1.5">
            <Tag size={14} className="text-ink-subtle" />
            {t.category}
          </span>
        </Label>
        <select
          id="categoryId"
          name="categoryId"
          defaultValue=""
          onChange={(event) => setCategoryId(event.target.value)}
          className={cn(selectStyles(Boolean(fieldErrors.categoryId)), "pr-9")}
          onBlur={() => handleBlur("categoryId")}
          aria-describedby={fieldErrors.categoryId ? "categoryId-error" : undefined}
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
          <FieldError id="categoryId-error">{fieldErrors.categoryId}</FieldError>
        )}
      </div>

      <div>
        <Label htmlFor="typeId" optional>
          {t.typeLabel}
        </Label>
        <p className="mb-1 text-xs text-ink-subtle">{t.typeHelp}</p>
        <select
          id="typeId"
          name="typeId"
          defaultValue=""
          onChange={(event) => setTypeId(event.target.value)}
          className={selectStyles(false)}
        >
          <option value="">{t.typeUnset}</option>
          {(types ?? []).map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>
        {identityBlocked && (
          <div className="mt-3 space-y-2 rounded-control border border-amber-200 bg-amber-50 px-3 py-2.5">
            <p className="text-sm leading-relaxed text-amber-900">
              {identityBlockedMessage}
            </p>
            <Button
              href={anonymous ? "/login" : "/resident/verification"}
              size="sm"
              variant="outline"
            >
              {anonymous ? t.identitySignIn : t.identityCta}
            </Button>
          </div>
        )}
      </div>

      <div>
        <Label htmlFor="description" required>
          <span className="inline-flex items-center gap-1.5">
            <FileText size={14} className="text-ink-subtle" />
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
          aria-describedby={fieldErrors.description && touched.description ? "description-error" : undefined}
        />
        {fieldErrors.description && touched.description && (
          <FieldError id="description-error">{fieldErrors.description}</FieldError>
        )}
      </div>

      <div>
        <Label htmlFor="locationArea" required>
          <span className="inline-flex items-center gap-1.5">
            <MapPin size={14} className="text-ink-subtle" />
            {t.area}
          </span>
        </Label>
        <select
          id="locationArea"
          name="locationArea"
          defaultValue=""
          className={cn(selectStyles(Boolean(fieldErrors.locationArea)), "pr-9")}
          onBlur={() => handleBlur("locationArea")}
          aria-describedby={fieldErrors.locationArea && touched.locationArea ? "locationArea-error" : undefined}
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
          <FieldError id="locationArea-error">{fieldErrors.locationArea}</FieldError>
        )}
      </div>

      <div>
        <Label htmlFor="locationAddress" required>
          <span className="inline-flex items-center gap-1.5">
            <MapPin size={14} className="text-ink-subtle" />
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
            aria-describedby={fieldErrors.locationAddress && touched.locationAddress ? "locationAddress-error" : undefined}
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
          <FieldError id="locationAddress-error">{fieldErrors.locationAddress}</FieldError>
        )}
      </div>

      <div className="rounded-control border border-dashed border-line-strong p-4">
        <p className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold text-ink">
          <span className="inline-flex items-center gap-1.5">
            <MapPin size={14} className="text-ink-subtle" />
            {t.pin}
          </span>
          <FieldRequirement optional />
        </p>
        <p className="mb-3 mt-1 text-xs text-ink-subtle">{t.pinHelp}</p>
        <GeotagPicker locale={locale} />
      </div>

      <fieldset className="rounded-control border border-line p-4">
        <legend className="inline-flex items-center gap-1.5 px-1 text-sm font-semibold text-ink-muted">
          <AlertTriangle size={14} className="text-ink-subtle" />
          {t.priority}
        </legend>
        <p className="mb-3 text-xs text-ink-subtle">{t.priorityHelp}</p>
        <div className="space-y-4">
          {factors.map((factor) => {
            const fieldKey = FACTOR_FIELD[factor.key];
            if (factor.key === "AFFECTED_POPULATION") {
              return (
                <div key={factor.key}>
                  <Label htmlFor="affectedPeople">
                    {t.affectedPeopleLabel}
                    <span className="ml-1">
                      <FieldRequirement required />
                    </span>
                  </Label>
                  {factor.description && (
                    <p className="mb-1 text-xs text-ink-subtle">
                      {factor.description}
                    </p>
                  )}
                  <Input
                    id="affectedPeople"
                    name="affectedPeople"
                    type="number"
                    min={1}
                    max={MAX_AFFECTED_PEOPLE}
                    step={1}
                    inputMode="numeric"
                    value={affectedPeople}
                    onChange={(event) => setAffectedPeople(event.target.value)}
                    onBlur={() => handleBlur("affectedPeople")}
                    invalid={Boolean(
                      fieldErrors.affectedPeople && touched.affectedPeople
                    )}
                    aria-describedby={
                      fieldErrors.affectedPeople && touched.affectedPeople
                        ? "affectedPeople-error"
                        : "affectedPeople-hint"
                    }
                  />
                  {fieldErrors.affectedPeople && touched.affectedPeople ? (
                    <FieldError id="affectedPeople-error">
                      {fieldErrors.affectedPeople}
                    </FieldError>
                  ) : (
                    <p
                      id="affectedPeople-hint"
                      className="mt-1 text-xs text-ink-subtle"
                    >
                      {bandedScore === null
                        ? t.affectedPeopleHint
                        : t.affectedPeopleBand
                            .replace("{score}", String(bandedScore))
                            .replace(
                              "{band}",
                              t.factors.AFFECTED_POPULATION[bandedScore - 1] ??
                                String(bandedScore)
                            )}
                    </p>
                  )}
                </div>
              );
            }
            const options: number[] = [];
            for (let v = factor.minScore; v <= factor.maxScore; v += 1) {
              options.push(v);
            }
            return (
              <div key={factor.key}>
                <Label htmlFor={fieldKey} required>
                  {factor.label}
                </Label>
                {factor.description && (
                  <p className="mb-1 text-xs text-ink-subtle">
                    {factor.description}
                  </p>
                )}
                <select
                  id={fieldKey}
                  name={fieldKey}
                  defaultValue=""
                  className={selectStyles(Boolean(fieldErrors[fieldKey]))}
                  onBlur={() => handleBlur(fieldKey)}
                  aria-describedby={
                    fieldErrors[fieldKey] && touched[fieldKey] ? `${fieldKey}-error` : undefined
                  }
                >
                  <option value="" disabled>
                    {t.selectRating}
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
                  <FieldError id={`${fieldKey}-error`}>{fieldErrors[fieldKey]}</FieldError>
                )}
              </div>
            );
          })}
        </div>
      </fieldset>

      <div>
        <Label htmlFor="image" required>
          <span className="inline-flex items-center gap-1.5">
            <ImageIcon size={14} className="text-ink-subtle" />
            {t.image}
          </span>
        </Label>
        <PhotoPicker
          id="image"
          name="image"
          label={t.image}
          hideLabel
          required
          hint={t.imageHelp}
          onChange={handleFilePick}
        />
        {selectedFile && (
          <div className="mt-2 flex items-start gap-3">
            {previewUrl ? (
              <Image
                src={previewUrl}
                alt={t.imageAlt}
                width={80}
                height={80}
                unoptimized
                className="h-20 w-20 rounded-control border border-line object-cover"
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
          <FieldError id="image-error">{fieldErrors.image}</FieldError>
        )}
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Button
          type="submit"
          disabled={submitting || identityBlocked}
          loading={submitting}
        >
          {submitting ? (
            t.sending
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
