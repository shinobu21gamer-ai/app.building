"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Label, Textarea } from "@/components/ui/field";
import { ConfirmActionButton } from "@/components/ui/confirm-action-button";
import { apiRequest } from "@/lib/api-client";
import { extractApiError } from "@/lib/utils";

export type AdminOfficeItem = {
  id: number;
  name: string;
  code: string;
  description: string | null;
  headOfficer: string | null;
  contact: string | null;
  isActive: boolean;
  references: {
    concerns: number;
    assignments: number;
    routingRules: number;
    users: number;
    total: number;
  };
};

export function OfficeManager({ offices }: { offices: AdminOfficeItem[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [headOfficer, setHeadOfficer] = useState("");
  const [contact, setContact] = useState("");
  const [isActive, setIsActive] = useState(true);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function resetForm() {
    setEditingId(null);
    setName("");
    setCode("");
    setDescription("");
    setHeadOfficer("");
    setContact("");
    setIsActive(true);
  }

  function startEdit(office: AdminOfficeItem) {
    setEditingId(office.id);
    setName(office.name);
    setCode(office.code);
    setDescription(office.description ?? "");
    setHeadOfficer(office.headOfficer ?? "");
    setContact(office.contact ?? "");
    setIsActive(office.isActive);
    setError(null);
    setSuccess(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const payload = {
      name,
      code,
      description,
      headOfficer,
      contact,
      isActive,
    };

    setBusy(true);
    const result = editingId
      ? await apiRequest<{ office: AdminOfficeItem }>(
          `/api/v1/admin/offices/${editingId}`,
          { method: "PATCH", body: JSON.stringify(payload) }
        )
      : await apiRequest<{ office: AdminOfficeItem }>(
          "/api/v1/admin/offices",
          { method: "POST", body: JSON.stringify(payload) }
        );
    setBusy(false);

    if (!result.success) {
      setError(extractApiError(result.error));
      return;
    }
    setSuccess(editingId ? "Office updated." : "Office created.");
    resetForm();
    router.refresh();
  }

  async function toggleActive(office: AdminOfficeItem) {
    setError(null);
    setSuccess(null);
    setBusy(true);
    const result = await apiRequest<{ office: AdminOfficeItem }>(
      `/api/v1/admin/offices/${office.id}`,
      { method: "PATCH", body: JSON.stringify({ isActive: !office.isActive }) }
    );
    setBusy(false);
    if (!result.success) {
      setError(extractApiError(result.error));
      return;
    }
    setSuccess(`${office.name} ${office.isActive ? "disabled" : "enabled"}.`);
    router.refresh();
  }

  async function deleteOffice(office: AdminOfficeItem): Promise<string | null> {
    setError(null);
    setSuccess(null);
    const result = await apiRequest<{ deleted: boolean }>(
      `/api/v1/admin/offices/${office.id}`,
      { method: "DELETE" }
    );
    if (!result.success) return extractApiError(result.error);
    setSuccess(`Deleted unused office ${office.code}.`);
    router.refresh();
    return null;
  }

  return (
    <div className="space-y-8">
      {success && <FormMessage tone="success">{success}</FormMessage>}
      {error && <FormMessage tone="error">{error}</FormMessage>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <h2 className="text-base font-semibold text-slate-900">
          {editingId ? "Edit office" : "Add office"}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="office-name">Name</Label>
            <Input
              id="office-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="office-code">Code</Label>
            <Input
              id="office-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="e.g. INFRA"
              required
            />
          </div>
          <div>
            <Label htmlFor="office-head">Head officer</Label>
            <Input
              id="office-head"
              value={headOfficer}
              onChange={(event) => setHeadOfficer(event.target.value)}
              placeholder="Optional"
            />
          </div>
          <div>
            <Label htmlFor="office-contact">Contact</Label>
            <Input
              id="office-contact"
              value={contact}
              onChange={(event) => setContact(event.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="office-description">Description</Label>
            <Textarea
              id="office-description"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Accepting new concerns
        </label>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Saving..." : editingId ? "Save changes" : "Create office"}
          </Button>
          {editingId && (
            <Button type="button" variant="outline" onClick={resetForm}>
              Cancel edit
            </Button>
          )}
        </div>
      </form>

      <div>
        <h2 className="mb-3 text-base font-semibold text-slate-900">
          Offices ({offices.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <caption className="sr-only">Barangay offices</caption>
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Name
                </th>
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Code
                </th>
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Head
                </th>
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Records
                </th>
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Status
                </th>
                <th scope="col" className="py-2 font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {offices.map((office) => (
                <tr key={office.id} className="hover:bg-slate-50">
                  <td className="py-3 pr-4 font-medium text-slate-900">
                    {office.name}
                  </td>
                  <td className="py-3 pr-4 text-slate-600">{office.code}</td>
                  <td className="py-3 pr-4 text-slate-600">
                    {office.headOfficer ?? "—"}
                  </td>
                  <td className="py-3 pr-4 text-slate-600">
                    {office.references.total}
                  </td>
                  <td className="py-3 pr-4">
                    {office.isActive ? (
                      <Badge tone="green">Active</Badge>
                    ) : (
                      <Badge tone="gray">Disabled</Badge>
                    )}
                  </td>
                  <td className="py-3">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => startEdit(office)}
                        className="text-sm font-semibold text-brand-700 hover:text-brand-800"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleActive(office)}
                        disabled={busy}
                        className="text-sm font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-40"
                      >
                        {office.isActive ? "Disable" : "Enable"}
                      </button>
                      <ConfirmActionButton
                        label="Delete"
                        title={`Delete ${office.name}?`}
                        description={
                          office.references.total > 0
                            ? `This office is referenced by ${office.references.total} record(s). Deletion will be refused to preserve routing and case history — deactivate it instead.`
                            : "This office has no linked records and will be permanently removed."
                        }
                        confirmLabel="Delete office"
                        tone="danger"
                        onConfirm={() => deleteOffice(office)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
