"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormMessage, Label, Textarea } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { BARANGAY_AREAS_KEY } from "@/lib/cases/settings";
import { copy, type Locale } from "@/lib/i18n";

export function AreasSettingsForm({
  initialValue,
  locale = "en",
}: {
  initialValue: string;
  locale?: Locale;
}) {
  const t = copy[locale].admin.mgr;
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{
    tone: "error" | "success";
    text: string;
  } | null>(null);

  async function save() {
    setMessage(null);
    setSubmitting(true);
    const result = await apiRequest<{ setting: { key: string; value: string } }>(
      "/api/v1/admin/settings",
      {
        method: "PUT",
        body: JSON.stringify({
          key: BARANGAY_AREAS_KEY,
          value,
        }),
      }
    );
    setSubmitting(false);

    if (!result.success) {
      setMessage({ tone: "error", text: result.error.message });
      return;
    }
    setMessage({
      tone: "success",
      text: t.areasSaved,
    });
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <Label htmlFor="barangay-areas">{t.areasLabel}</Label>
      <Textarea
        id="barangay-areas"
        rows={8}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <p className="text-xs text-slate-500">{t.areasHint}</p>
      {message && <FormMessage tone={message.tone}>{message.text}</FormMessage>}
      <Button type="button" size="sm" disabled={submitting} onClick={save}>
        {submitting ? t.saving : t.saveAreas}
      </Button>
    </div>
  );
}
