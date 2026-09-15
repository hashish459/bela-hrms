import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { leaveTypes } from "@/db/schema/leave";
import { requirePermission } from "@/lib/session";
import { Badge, PageHeader } from "@/components/ui";
import { formatDays } from "@/lib/utils";
import { ActiveBadge, MasterTable } from "../../setup/page-parts";

export const metadata = { title: "Leave types" };

export default async function LeaveTypesPage() {
  const viewer = await requirePermission("leave.type.manage");
  const rows = await db
    .select()
    .from(leaveTypes)
    .where(eq(leaveTypes.orgId, viewer.orgId))
    .orderBy(asc(leaveTypes.name));

  return (
    <>
      <PageHeader
        title="Leave types"
        description="The policy the approval engine enforces: entitlement, notice, carry forward, and how many levels must sign off."
      />
      <MasterTable
        rows={rows}
        empty="No leave types defined"
        columns={[
          {
            header: "Type",
            cell: (r) => (
              <span className="flex items-center gap-2">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: r.colour }}
                  aria-hidden
                />
                <span>
                  <span className="block font-medium text-ink">{r.name}</span>
                  {r.nameNepali ? (
                    <span className="block text-xs text-ink-faint">{r.nameNepali}</span>
                  ) : null}
                </span>
              </span>
            ),
          },
          {
            header: "Code",
            cell: (r) => <span className="font-mono text-xs text-ink-soft">{r.code}</span>,
          },
          {
            header: "Days / year",
            align: "right",
            cell: (r) =>
              r.deductsBalance ? (
                <span className="tabular">{formatDays(r.daysPerYear)}</span>
              ) : (
                <span className="text-ink-faint">unlimited</span>
              ),
          },
          {
            header: "Carry forward",
            cell: (r) =>
              r.allowCarryForward ? (
                <span className="tabular text-ink-soft">
                  up to {formatDays(r.maxCarryForwardDays ?? 0)}
                </span>
              ) : (
                <span className="text-ink-faint">No</span>
              ),
          },
          {
            header: "Notice",
            align: "right",
            cell: (r) => (
              <span className="tabular text-ink-soft">
                {r.minNoticeDays > 0 ? `${r.minNoticeDays} d` : "—"}
              </span>
            ),
          },
          {
            header: "Approvals",
            align: "right",
            cell: (r) => <span className="tabular text-ink-soft">{r.approvalLevels}</span>,
          },
          {
            header: "Applies to",
            cell: (r) => (
              <span className="flex flex-wrap gap-1">
                {r.appliesTo !== "all" ? (
                  <Badge tone="info" className="capitalize">
                    {r.appliesTo}
                  </Badge>
                ) : (
                  <span className="text-ink-faint">Everyone</span>
                )}
                {!r.isPaid ? <Badge tone="warn">Unpaid</Badge> : null}
              </span>
            ),
          },
          { header: "Status", cell: (r) => <ActiveBadge active={r.isActive} /> },
        ]}
      />
    </>
  );
}
