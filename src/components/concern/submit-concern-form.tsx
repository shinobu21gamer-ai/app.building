"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  FieldError,
  FormMessage,
  Input,
  Label,
  Textarea,
} from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { createConcernSchema } from "@/lib/validations/concern";

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
const BARANGAY_AREAS = [
  "Purok 1",
  "Purok 2",
  "Purok 3",
  "Purok 4",
  "Purok 5",
  "Purok 6",
  "Purok 7",
  "Barangay Hall",
  "Public Market",
  "Health Center",
  "School Zone",
  "Other area",
];

const FACTOR_FIELD: Record<string, FieldKey> = {
  URGENCY: "urgencyScore",
  IMPACT: "impactScore",
  AFFECTED_POPULATION: "affectedPopulationScore",
  SAFETY: "safetyScore",
};

const selectStyles =
  "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";

export function SubmitConcernForm({
  categories,
  factors,
}: {
  categories: CategoryOption[];
  factors: FactorOption[];
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

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
      nextErrors.locationArea = "Select the barangay area.";
    }
    const combinedLocation = values.locationArea
      ? `${values.locationArea} - ${values.locationAddress.trim()}`
      : values.locationAddress.trim();
    if (combinedLocation.length > 255) {
      nextErrors.locationAddress = "Exact location is too long.";
    }
    if (fieldErrors.image) nextErrors.image = fieldErrors.image;
    if (!selectedFile) nextErrors.image = "A proof image is required.";

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
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
      return;
    }

    router.push(`${result.data.redirect}?created=1`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {formError && <FormMessage tone="error">{formError}</FormMessage>}

      <div>
        <Label htmlFor="title">Concern title</Label>
        <Input
          id="title"
          name="title"
          placeholder="e.g. Broken street light on Mabini Street"
          maxLength={150}
          invalid={Boolean(fieldErrors.title)}
        />
        {fieldErrors.title && <FieldError>{fieldErrors.title}</FieldError>}
      </div>

      <div>
        <Label htmlFor="categoryId">Category</Label>
        <select
          id="categoryId"
          name="categoryId"
          defaultValue=""
          className={selectStyles}
        >
          <option value="" disabled>
            Select a category
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
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          name="description"
          rows={5}
          placeholder="Describe the problem, how long it has been occurring, and who it affects."
          maxLength={2000}
          invalid={Boolean(fieldErrors.description)}
        />
        {fieldErrors.description && (
          <FieldError>{fieldErrors.description}</FieldError>
        )}
      </div>

      <div>
        <Label htmlFor="locationArea">Barangay area</Label>
        <select
          id="locationArea"
          name="locationArea"
          defaultValue=""
          className={selectStyles}
        >
          <option value="" disabled>
            Select the barangay area
          </option>
          {BARANGAY_AREAS.map((area) => (
            <option key={area} value={area}>
              {area}
            </option>
          ))}
        </select>
        {fieldErrors.locationArea && (
          <FieldError>{fieldErrors.locationArea}</FieldError>
        )}
      </div>

      <div>
        <Label htmlFor="locationAddress">Exact location</Label>
        <Input
          id="locationAddress"
          name="locationAddress"
          placeholder="e.g. beside the covered court, house number 12"
          maxLength={220}
          invalid={Boolean(fieldErrors.locationAddress)}
        />
        {fieldErrors.locationAddress && (
          <FieldError>{fieldErrors.locationAddress}</FieldError>
        )}
      </div>

      <fieldset className="rounded-lg border border-slate-200 p-4">
        <legend className="px-1 text-sm font-semibold text-slate-700">
          Priority assessment
        </legend>
        <p className="mb-3 text-xs text-slate-500">
          Rate each factor from {factors[0]?.minScore ?? 1} to{" "}
          {factors[0]?.maxScore ?? 5}. The system computes a recommended
          priority level from your answers.
        </p>
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
                  className={selectStyles}
                >
                  <option value="" disabled>
                    Select a rating
                  </option>
                  {options.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
                {fieldErrors[fieldKey] && (
                  <FieldError>{fieldErrors[fieldKey]}</FieldError>
                )}
              </div>
            );
          })}
        </div>
      </fieldset>

      <div>
        <Label htmlFor="image">Proof image</Label>
        <input
          ref={fileInputRef}
          id="image"
          name="image"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          required
          onChange={handleFileChange}
          className="block w-full cursor-pointer rounded-lg border border-slate-300 bg-white text-sm text-slate-600 file:mr-3 file:rounded-l-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
        />
        <p className="mt-1 text-xs text-slate-500">
          Required proof image. JPEG, PNG, or WebP. Maximum 5 MB.
        </p>
        {selectedFile && (
          <p className="mt-1 text-xs text-slate-600">
            Selected: {selectedFile.name} (
            {Math.ceil(selectedFile.size / 1024)} KB)
          </p>
        )}
        {fieldErrors.image && <FieldError>{fieldErrors.image}</FieldError>}
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Submitting..." : "Submit concern"}
        </Button>
        <Button href="/resident/concerns" variant="outline">
          Cancel
        </Button>
      </div>
    </form>
  );
}
