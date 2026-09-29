import { RoleShell } from "@/components/role-shell";

const NAV_ITEMS = [
  { href: "/resident", label: "Dashboard" },
  { href: "/resident/concerns", label: "My Concerns" },
  { href: "/resident/concerns/new", label: "Submit Concern" },
  { href: "/notifications", label: "Notifications" },
];

export default async function ResidentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RoleShell roles={["RESIDENT"]} items={NAV_ITEMS}>
      {children}
    </RoleShell>
  );
}
