"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { copy, type Locale } from "@/lib/i18n";

type RoleColumn = {
  key: string;
  name: string;
  description: string | null;
  userCount: number;
  code: string[];
  effective: string[];
  diff: { granted: string[]; revoked: string[]; redundant: string[] };
};

type CategoryGroup = {
  category: string;
  permissions: { key: string; category: string; description: string }[];
};

type MatrixResponse = {
  roles: RoleColumn[];
  categories: CategoryGroup[];
  bootstrapNeeded: boolean;
};

/**
 * Role/permission matrix with live overrides.
 *
 * A cell has three possible states, and the difference matters for audits:
 * the code default (matrix), an extra grant, or a revocation. Resetting a cell
 * deletes the override row, so the role falls back to what the code says.
 */
export function PermissionMatrix({ locale = "en" }: { locale?: Locale }) {
  const t = copy[locale].revamp.adminDesk;
  const { showToast } = useToast();
  const [data, setData] = useState<MatrixResponse | null>(null);
  const [busyCell, setBusyCell] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await apiRequest<MatrixResponse>("/api/v1/admin/roles");
    if (!result.success) {
      setError(result.error.message);
      return;
    }
    setError(null);
    setData(result.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(roleKey: string, permissionKey: string, currentlyAllowed: boolean) {
    const cell = `${roleKey}:${permissionKey}`;
    setBusyCell(cell);
    const result = await apiRequest("/api/v1/admin/permissions", {
      method: "PUT",
      body: JSON.stringify({ roleKey, permissionKey, allowed: !currentlyAllowed }),
    });
    setBusyCell(null);
    if (!result.success) {
      showToast("error", result.error.message);
      return;
    }
    showToast("success", copy[locale].revamp.common.saved);
    await load();
  }

  async function reset(roleKey: string, permissionKey: string) {
    const cell = `${roleKey}:${permissionKey}`;
    setBusyCell(cell);
    const result = await apiRequest(
      `/api/v1/admin/permissions?roleKey=${encodeURIComponent(roleKey)}&permissionKey=${encodeURIComponent(permissionKey)}`,
      { method: "DELETE" }
    );
    setBusyCell(null);
    if (!result.success) {
      showToast("error", result.error.message);
      return;
    }
    showToast("success", t.codeDefault);
    await load();
  }

  if (error) return <FormMessage tone="error">{error}</FormMessage>;
  if (!data) return <p className="text-sm text-slate-500">{t.saving}</p>;

  return (
    <div className="space-y-4">
      {data.bootstrapNeeded && (
        <FormMessage tone="error">{t.bootstrapWarning}</FormMessage>
      )}

      <div className="flex flex-wrap gap-3 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1">
          <Badge tone="green">{t.codeDefault}</Badge>
        </span>
        <span className="inline-flex items-center gap-1">
          <Badge tone="sky">{t.overrideGranted}</Badge>
        </span>
        <span className="inline-flex items-center gap-1">
          <Badge tone="red">{t.overrideRevoked}</Badge>
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white px-3 py-2 text-left font-semibold text-slate-700">
                {t.permission}
              </th>
              {data.roles.map((role) => (
                <th
                  key={role.key}
                  className="px-3 py-2 text-center font-semibold text-slate-700"
                  title={role.description ?? undefined}
                >
                  <span className="block">{role.name}</span>
                  <span className="block text-xs font-normal text-slate-500">
                    {role.userCount}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.categories.map((group) => (
              <>
                <tr key={group.category} className="bg-slate-50">
                  <td
                    colSpan={data.roles.length + 1}
                    className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"
                  >
                    {group.category}
                  </td>
                </tr>
                {group.permissions.map((permission) => (
                  <tr key={permission.key} className="border-t border-slate-100">
                    <td className="sticky left-0 max-w-[22rem] bg-white px-3 py-2 align-top">
                      <span className="block font-mono text-xs text-slate-700">
                        {permission.key}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {permission.description}
                      </span>
                    </td>
                    {data.roles.map((role) => {
                      const allowed = role.effective.includes(permission.key);
                      const codeAllows = role.code.includes(permission.key);
                      const granted = role.diff.granted.includes(permission.key);
                      const revoked = role.diff.revoked.includes(permission.key);
                      const cell = `${role.key}:${permission.key}`;
                      const busy = busyCell === cell;

                      return (
                        <td key={cell} className="px-2 py-2 text-center align-top">
                          <input
                            type="checkbox"
                            checked={allowed}
                            disabled={busy}
                            aria-label={`${role.name}: ${permission.key}`}
                            onChange={() =>
                              toggle(role.key, permission.key, allowed)
                            }
                            className="h-4 w-4 rounded border-slate-300"
                          />
                          <span className="mt-1 block">
                            {granted && <Badge tone="sky">{t.overrideGranted}</Badge>}
                            {revoked && <Badge tone="red">{t.overrideRevoked}</Badge>}
                            {!granted && !revoked && (
                              <span className="text-[10px] text-slate-400">
                                {codeAllows ? t.codeDefault : t.fixedByCode}
                              </span>
                            )}
                          </span>
                          {(granted || revoked) && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => reset(role.key, permission.key)}
                              className="mt-1 text-[10px]"
                            >
                              {t.codeDefault}
                            </Button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
