import type { NextRequest } from "next/server";
import { can, getViewer } from "@/lib/session";
import { CATEGORY_BY_KEY, type CategoryKey } from "@/modules/workbook/catalogue";
import { exportRows } from "@/modules/workbook/service";
import { readFilter } from "../../filters";

/** One CSV line per task, with its day's context — what analysis in a spreadsheet wants. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer || !can(viewer, "workbook.record.viewAll")) return new Response("Not found", { status: 404 });

  const { month, filter } = readFilter(Object.fromEntries(request.nextUrl.searchParams));
  const rows = await exportRows(viewer.orgId, filter);

  const lines = [
    ["date_bs", "date_ad", "employee_code", "employee", "department", "day_status", "self_rating", "day_summary", "task", "category", "project", "minutes", "task_status", "outcome", "details"].join(","),
    ...rows.map((r) =>
      [
        r.dateBs, r.date, r.employeeCode, r.employeeName, r.department, r.status, r.selfRating, r.summary,
        r.title, r.category ? (CATEGORY_BY_KEY.get(r.category as CategoryKey)?.label ?? r.category) : null,
        r.project, r.minutes, r.taskStatus, r.outcome, r.details,
      ]
        .map(cell)
        .join(","),
    ),
  ];
  return new Response("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="workbook-${month.year}-${String(month.month).padStart(2, "0")}.csv"`,
      "cache-control": "no-store",
    },
  });
}
