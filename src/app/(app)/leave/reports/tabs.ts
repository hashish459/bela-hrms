import type { ReportTab } from "@/components/reports/report-tabs";

export const BASE = "/leave/reports";

/** The leave reports, in the order a reader usually needs them. */
export const LEAVE_REPORT_TABS: ReportTab[] = [
  { href: BASE, label: "Overview", icon: "LayoutDashboard" },
  { href: `${BASE}/balances`, label: "Balances", icon: "Scale" },
  { href: `${BASE}/types`, label: "By leave type", icon: "Tags" },
  { href: `${BASE}/history`, label: "Leave history", icon: "History" },
  { href: `${BASE}/approvals`, label: "Approvals", icon: "Stamp" },
  { href: `${BASE}/departments`, label: "Departments", icon: "Building2" },
];
