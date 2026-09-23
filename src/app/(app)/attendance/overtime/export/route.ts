import type { NextRequest } from "next/server";
import { bsMonthBounds } from "@/components/bs-month-nav";
import { can, getViewer } from "@/lib/session";
import { register } from "@/lib/attendance/overtime";

/** The overtime register for one BS month, as CSV for payroll. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer || !can(viewer, "attendance.record.viewAll")) return new Response("Not found", { status: 404 });

  const [y, m] = (request.nextUrl.searchParams.get("month") ?? "").split("-").map(Number);
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12)) return new Response("Choose a month", { status: 400 });
  const status = request.nextUrl.searchParams.get("status");
  const { from, to } = bsMonthBounds({ year: y, month: m });
  const rows = await register(viewer.orgId, from, to, status && ["pending", "approved", "rejected", "withdrawn"].includes(status) ? status : null);

  const lines = [
    ["reference", "employee_code", "employee", "department", "date_bs", "date_ad", "day_kind", "on_record_min", "claimed_min", "approved_min", "multiplier", "payable_min", "status", "decided_by", "reason"].join(","),
    ...rows.map((r) =>
      [r.reference, r.employeeCode, r.employeeName, r.department, r.dateBs, r.date, r.dayKind, r.computedMinutes, r.claimedMinutes, r.approvedMinutes, r.multiplier, r.payableMinutes, r.status, r.decidedByLabel, r.reason]
        .map(cell)
        .join(","),
    ),
  ];
  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="overtime-${y}-${String(m).padStart(2, "0")}.csv"`,
      "cache-control": "no-store",
    },
  });
}
