"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Label } from "@/components/ui/field";
import { ConfirmActionButton } from "@/components/ui/confirm-action-button";
import { apiRequest } from "@/lib/api-client";
import { extractApiError } from "@/lib/utils";

export type AdminSettingItem = {
  key: string;
  value: string;
  updatedAt: string;
};

export function SettingsManager({
  settings,
}: {
  settings: AdminSettingItem[];
}) {
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
    setSuccess(editingKey ? "Setting updated." : "Setting created.");
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
    setSuccess(`Deleted setting ${setting.key}.`);
    router.refresh();
    return null;
  }

  return (
    <div className="space-y-8">
      {success && <FormMessage tone="success">{success}</FormMessage>}
      {error && <FormMessage tone="error">{error}</FormMessage>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <h2 className="text-base font-semibold text-slate-900">
          {editingKey ? "Edit setting" : "Add setting"}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="setting-key">Key</Label>
            <Input
              id="setting-key"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="e.g. feedback.resubmission_allowed"
              disabled={editingKey !== null}
              required
            />
          </div>
          <div>
            <Label htmlFor="setting-value">Value</Label>
            <Input
              id="setting-value"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="e.g. true"
              required
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Saving..." : editingKey ? "Save setting" : "Create setting"}
          </Button>
          {editingKey && (
            <Button type="button" variant="outline" onClick={resetForm}>
              Cancel edit
            </Button>
          )}
        </div>
      </form>

      <div>
        <h2 className="mb-3 text-base font-semibold text-slate-900">
          Stored settings ({settings.length})
        </h2>
        {settings.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-600">
            No settings stored yet. Built-in behavior uses defaults.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <caption className="sr-only">System settings</caption>
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Key
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Value
                  </th>
                  <th scope="col" className="py-2 font-semibold">
                    <span className="sr-only">Actions</span>
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
                          Edit
                        </button>
                        <ConfirmActionButton
                          label="Delete"
                          title={`Delete ${setting.key}?`}
                          description="The application will fall back to this setting's built-in default."
                          confirmLabel="Delete setting"
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
