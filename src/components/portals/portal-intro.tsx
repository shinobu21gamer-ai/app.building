import { Card } from "@/components/ui/card";
import { permissionDefinition } from "@/lib/auth/rbac";

/**
 * Shared landing panel for the newer role portals (treasury, captain, crew).
 *
 * Until each portal's own screens land, this tells the signed-in user two
 * useful things: exactly what their role is allowed to do (so RBAC can be
 * tested in place), and which modules will appear here.
 */
export function PortalIntro({
  title,
  lead,
  permissions,
  permissionsTitle,
  permissionsLead,
  modulesTitle,
  modulesUnavailable,
  modules,
}: {
  title: string;
  lead: string;
  permissions: readonly string[];
  permissionsTitle: string;
  permissionsLead: string;
  modulesTitle: string;
  modulesUnavailable: string;
  modules: readonly { title: string; body: string }[];
}) {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
          {lead}
        </p>
      </header>

      <Card title={permissionsTitle} description={permissionsLead}>
        {permissions.length === 0 ? (
          <p className="text-sm text-slate-500">—</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {permissions.map((key) => {
              const definition = permissionDefinition(key);
              return (
                <li
                  key={key}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                >
                  <p className="font-mono text-xs text-slate-700">{key}</p>
                  {definition && (
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                      {definition.description}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title={modulesTitle} description={modulesUnavailable}>
        <div className="grid gap-4 sm:grid-cols-2">
          {modules.map((module) => (
            <div
              key={module.title}
              className="rounded-lg border border-slate-200 p-4"
            >
              <h3 className="text-sm font-semibold text-slate-900">
                {module.title}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                {module.body}
              </p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
