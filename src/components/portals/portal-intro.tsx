import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
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
      <PageHeader title={title} description={lead} />

      <Card title={permissionsTitle} description={permissionsLead}>
        {permissions.length === 0 ? (
          <p className="text-sm text-ink-subtle">—</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {permissions.map((key) => {
              const definition = permissionDefinition(key);
              return (
                <li
                  key={key}
                  className="rounded-control border border-line bg-surface-muted px-3 py-2"
                >
                  <p className="font-mono text-xs text-ink-muted">{key}</p>
                  {definition && (
                    <p className="mt-0.5 text-xs leading-relaxed text-ink-subtle">
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
              className="rounded-control border border-line p-4"
            >
              <h3 className="text-sm font-semibold text-ink">
                {module.title}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                {module.body}
              </p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
