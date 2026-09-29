import { RoleShell } from "@/components/role-shell";

const NAV_ITEMS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/officials", label: "Officials" },
  { href: "/admin/offices", label: "Offices" },
  { href: "/admin/categories", label: "Categories" },
  { href: "/admin/routing", label: "Routing rules" },
  { href: "/admin/priority", label: "Priority rules" },
  { href: "/admin/settings", label: "Settings" },
  { href: "/notifications", label: "Notifications" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RoleShell roles={["ADMIN"]} items={NAV_ITEMS}>
      {children}
    </RoleShell>
  );
}
