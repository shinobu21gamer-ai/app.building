import { RoleShell } from "@/components/role-shell";

const NAV_ITEMS = [
  { href: "/official", label: "Dashboard" },
  { href: "/official/concerns", label: "Concerns" },
  { href: "/notifications", label: "Notifications" },
];

export default async function OfficialLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RoleShell roles={["OFFICIAL", "ADMIN"]} items={NAV_ITEMS}>
      {children}
    </RoleShell>
  );
}
