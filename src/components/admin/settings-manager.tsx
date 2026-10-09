"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Label } from "@/components/ui/field";
import { ConfirmActionButton } from "@/components/ui/confirm-action-button";
import { apiRequest } from "@/lib/api-client";
import { extractApiError } from "@/lib/utils";
import { copy, type Locale } from "@/lib/i18n";

export type AdminSettingItem = {
  key: string;
  value: string;
  updatedAt: string;
};

export function SettingsManager({
  settings,
  locale = "en",
}: {
  settings: AdminSettingItem[];
  locale?: Locale;
}) {
  const t = copy[locale].admin.mgr;
  const router = useRouter();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function resetForm() {
    setEditingKey(null);
    setKey("");
    setValue("");
  }

  function startEdit(setting: AdminSettingItem) {
    setEditingKey(setting.key);
    setKey(setting.key);
    setValue(setting.value);
    setError(null);
    setSuccess(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    setBusy(true);
    const result = await apiRequest<{ setting: AdminSettingItem }>(
      "/api/v1/admin/settings",
      {
        method: editingKey ? "PUT" : "POST",
        body: JSON.stringify({ key, value }),
      }
    );
    setBusy(false);

    if (!result.success) {
      setError(extractApiError(result.error));
      return;
    }
    setSuccess(editingKey ? t.settingUpdated : t.settingCreated);
    resetForm();
    router.refresh();
  }

  async function deleteSetting(setting: AdminSettingItem): Promise<string | null> {
    setError(null);
    setSuccess(null);
    const result = await apiRequest<{ deleted: boolean }>(
      `/api/v1/admin/settings?key=${encodeURIComponent(setting.key)}`,
      { method: "DELETE" }
    );
    if (!result.success) return extractApiError(result.error);
    setSuccess(t.deletedSetting.replace("{key}", setting.key));
    router.refresh();
    return null;
  }

  return (
    <div className="space-y-8">
      {success && <FormMessage tone="success">{success}</FormMessage>}
      {error && <FormMessage tone="error">{error}</FormMessage>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <h2 className="text-base font-semibold text-slate-900">
          {editingKey ? t.editSetting : t.addSetting}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="setting-key">{t.settingKey}</Label>
            <Input
              id="setting-key"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder={t.settingKeyPlaceholder}
              disabled={editingKey !== null}
              required
            />
          </div>
          <div>
            <Label htmlFor="setting-value">{t.settingValue}</Label>
            <Input
              id="setting-value"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={t.settingValuePlaceholder}
              required
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? t.saving : editingKey ? t.saveSetting : t.createSetting}
          </Button>
          {editingKey && (
            <Button type="button" variant="outline" onClick={resetForm}>
              {t.cancelEdit}
            </Button>
          )}
        </div>
      </form>

      <div>
        <h2 className="mb-3 text-base font-semibold text-slate-900">
          {t.settingsList.replace("{count}", String(settings.length))}
        </h2>
        {settings.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-600">
            {t.noSettings}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <caption className="sr-only">{t.settingsCaption}</caption>
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.settingKey}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    {t.settingValue}
                  </th>
                  <th scope="col" className="py-2 font-semibold">
                    <span className="sr-only">{t.edit}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {settings.map((setting) => (
                  <tr key={setting.key} className="hover:bg-slate-50">
                    <td className="py-3 pr-4 font-mono text-xs text-slate-900">
                      {setting.key}
                    </td>
                    <td className="py-3 pr-4 text-slate-600">
                      {setting.value}
                    </td>
                    <td className="py-3">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => startEdit(setting)}
                          className="text-sm font-semibold text-brand-700 hover:text-brand-800"
                        >
                          {t.edit}
                        </button>
                        <ConfirmActionButton
                          label={t.delete}
                          title={t.deleteSettingTitle.replace("{key}", setting.key)}
                          description={t.deleteSettingDesc}
                          confirmLabel={t.deleteSetting}
                          tone="danger"
                          onConfirm={() => deleteSetting(setting)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
