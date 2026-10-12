import {
  AlertTriangle,
  BadgeCheck,
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  CheckSquare,
  ClipboardCheck,
  FilePlus2,
  FileText,
  Hash,
  Home,
  KeyRound,
  LayoutGrid,
  PiggyBank,
  Receipt,
  Route,
  Settings,
  Shield,
  ShieldCheck,
  Tags,
  Target,
  Timer,
  UserCog,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";

import { navIconKey } from "@/lib/nav";

/**
 * Glyphs for nav destinations, keyed by the last path segment (see
 * `navIconKey`). Portals do not declare icons: a new desk gets a sensible
 * default and a line here when its own glyph matters.
 */
const ICONS: Record<string, typeof Home> = {
  home: Home,
  reports: BarChart3,
  sla: Timer,
  escalations: Timer,
  audit: ShieldCheck,
  users: Users,
  officials: UserCog,
  offices: Building2,
  categories: Tags,
  routing: Route,
  priority: AlertTriangle,
  validation: ClipboardCheck,
  verification: BadgeCheck,
  privacy: Shield,
  roles: KeyRound,
  treasury: Wallet,
  settings: Settings,
  notifications: Bell,
  approvals: CheckSquare,
  budgets: PiggyBank,
  earmarks: Target,
  disbursements: Receipt,
  ledger: BookOpen,
  codes: Hash,
  concerns: FileText,
  new: FilePlus2,
  jobs: Wrench,
  alerts: Bell,
  profile: LayoutGrid,
};

export function iconFor(href: string) {
  return ICONS[navIconKey(href)] ?? LayoutGrid;
}
