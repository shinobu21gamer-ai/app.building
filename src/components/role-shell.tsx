import { Container } from "@/components/ui/container";
import { RoleNav, type RoleNavItem } from "@/components/ui/role-nav";
import { requireRole } from "@/lib/auth/session";

/**
 * Shared shell for the three role areas (resident / official / admin): guards
 * the route tree with the allowed roles and renders the same nav container, so
 * each role layout only declares its own items and allowed roles.
 */
export async function RoleShell({
  roles,
  items,
  children,
}: {
  roles: string[];
  items: RoleNavItem[];
  children: React.ReactNode;
}) {
  await requireRole(roles);

  return (
    <Container className="py-8">
      <RoleNav items={items} />
      {children}
    </Container>
  );
}
