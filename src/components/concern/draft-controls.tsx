"use client";
import { useEffect, useState, type RefObject } from "react";
import { Save, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import { readConcernDraft, removeConcernDraft, saveConcernDraft, type ConcernDraft } from "@/lib/concerns/draft";
import { copy, type Locale } from "@/lib/i18n";

export function DraftControls({ userId, formRef, locale }: {
  userId: number; formRef: RefObject<HTMLFormElement | null>; locale: Locale;
}) {
  const t = copy[locale].reportingExperience;
  const [draft, setDraft] = useState<ConcernDraft | null>(null);
  const [offline, setOffline] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    try { setDraft(readConcernDraft(sessionStorage, userId)); } catch { /* storage blocked */ }
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, [userId]);
  function save() {
    if (!formRef.current) return;
    try {
      setDraft(saveConcernDraft(sessionStorage, userId, new FormData(formRef.current)));
      setMessage(t.draftSaved);
    } catch { setMessage(t.draftUnavailable); }
  }
  function restore() {
    if (!draft || !formRef.current) return;
    for (const [name, value] of Object.entries(draft.fields)) {
      const control = formRef.current.elements.namedItem(name);
      if (control instanceof HTMLSelectElement) {
        // Ignore categories/areas/factor values that admins have removed.
        if ([...control.options].some((option) => option.value === value)) control.value = value;
      } else if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) control.value = value;
    }
    setMessage(t.draftRestored);
    formRef.current.querySelector<HTMLInputElement>('[name="title"]')?.focus();
  }
  return <section aria-label={t.draftTitle} className="space-y-3 rounded-xl border border-line bg-surface-sunken p-4">
    <p className="text-sm font-semibold text-ink">{t.draftTitle}</p>
    <p className="text-xs leading-5 text-ink-muted">{t.draftHint}</p>
    {offline && <p role="status" className="flex items-center gap-2 text-sm text-amber-800"><WifiOff size={16} aria-hidden="true" />{t.offline}</p>}
    {message && <FormMessage tone={message === t.draftUnavailable ? "error" : "success"}>{message}</FormMessage>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" onClick={save}><Save size={15} aria-hidden="true" />{t.saveDraft}</Button>
      {draft && <>
        <Button type="button" variant="secondary" size="sm" onClick={restore}>{t.restoreDraft}</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => {
          try { removeConcernDraft(sessionStorage, userId); setDraft(null); setMessage(null); }
          catch { setMessage(t.draftUnavailable); }
        }}>{t.discardDraft}</Button>
      </>}
    </div>
  </section>;
}
