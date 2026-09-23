import { and, asc, eq } from "drizzle-orm";
import { notDeleted } from "@/db/schema/columns";
import { db } from "@/db/client";
import { leaveTypes } from "@/db/schema/leave";
import { employmentTypes } from "@/db/schema/org";
import { requirePermission } from "@/lib/session";
import { Badge, Card, CardHeader, PageHeader, StatTile, TableShell, Td, Th, Tr } from "@/components/ui";
import { entitlementMatrix, listLeaveGroups } from "@/modules/leave/policy";
import { formatDays } from "@/lib/utils";
import { NATURE_LABEL, NatureChip, PayChip } from "./parts";

export const metadata = { title: "Leave policy" };

export default async function LeavePolicyPage() {
  const viewer = await requirePermission("leave.type.manage");

  const [types, empTypes, groups] = await Promise.all([
    db
      .select()
      .from(leaveTypes)
      .where(eq(leaveTypes.orgId, viewer.orgId))
      .orderBy(asc(leaveTypes.leaveOrder), asc(leaveTypes.name)),
    db
      .select({ id: employmentTypes.id, name: employmentTypes.name })
      .from(employmentTypes)
      .where(and(eq(employmentTypes.orgId, viewer.orgId), notDeleted(employmentTypes)))
      .orderBy(asc(employmentTypes.name)),
    listLeaveGroups(viewer.orgId),
  ]);

  const matrix = await entitlementMatrix(
    viewer.orgId,
    types.map((t) => t.id),
  );
  const byPair = new Map(matrix.map((m) => [`${m.leaveTypeId}:${m.employmentTypeId}`, m]));

  const paidTypes = types.filter((t) => t.nature === "paid").length;
  const encashable = types.filter((t) => t.isEncashable).length;
  const carryForward = types.filter((t) => t.lapseType === "none").length;

  return (
    <>
      <PageHeader
        title="Leave policy"
        description="What each kind of leave means to attendance and to payroll, and who may approve how much of it."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Leave types" value={types.length} tone="accent" />
        <StatTile label="Fully paid" value={paidTypes} sub="at 100% of salary" tone="ok" />
        <StatTile label="Encashable" value={encashable} />
        <StatTile label="Never lapse" value={carryForward} sub="carried indefinitely" />
      </div>

      {/* ------------------------------------------------- meaning and money */}
      <Card className="mb-5">
        <CardHeader
          title="What a day of each leave means"
          description="Three columns decide what the rest of the product does with a leave day. Everything downstream reads these and nothing else."
        />
        <TableShell>
          <thead>
            <tr>
              <Th>Leave type</Th>
              <Th>Nature</Th>
              <Th>Attendance shows</Th>
              <Th className="text-right">Payroll pays</Th>
              <Th className="text-right">Entitlement</Th>
              <Th>Lapses</Th>
              <Th className="text-right">Order</Th>
            </tr>
          </thead>
          <tbody>
            {types.map((t) => (
              <Tr key={t.id}>
                <Td>
                  <span className="flex items-center gap-2">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: t.colour }}
                      aria-hidden
                    />
                    <span>
                      <span className="block font-medium text-ink">{t.name}</span>
                      <span className="font-mono text-[11px] text-ink-faint">{t.code}</span>
                    </span>
                  </span>
                </Td>
                <Td>
                  <NatureChip nature={t.nature} />
                </Td>
                <Td>
                  <span className="text-xs text-ink-soft">{NATURE_LABEL[t.nature].attendance}</span>
                </Td>
                <Td className="text-right">
                  <PayChip percent={Number(t.paidPercent)} />
                </Td>
                <Td className="tabular text-right text-ink-soft">
                  {formatDays(Number(t.daysPerYear))}
                </Td>
                <Td>
                  <span className="text-xs text-ink-soft">
                    {t.lapseType === "none"
                      ? "Never"
                      : t.lapseType === "service_period"
                        ? "End of service period"
                        : t.lapseType === "monthly"
                          ? "Month end"
                          : "Year end"}
                  </span>
                </Td>
                <Td className="tabular text-right text-ink-faint">{t.leaveOrder}</Td>
              </Tr>
            ))}
          </tbody>
        </TableShell>
      </Card>

      {/* ------------------------------------------------------ who approves */}
      <Card className="mb-5">
        <CardHeader
          title="Who may approve how much"
          description="A level can only sign off up to its ceiling; a longer request is routed above it from the outset, not forwarded by hand."
        />
        <TableShell>
          <thead>
            <tr>
              <Th>Leave type</Th>
              <Th className="text-right">Levels</Th>
              <Th className="text-right">Level 1 up to</Th>
              <Th className="text-right">Level 2 up to</Th>
              <Th className="text-right">Level 3 up to</Th>
              <Th className="text-right">Level 4</Th>
              <Th className="text-right">Notice</Th>
            </tr>
          </thead>
          <tbody>
            {types.map((t) => (
              <Tr key={t.id}>
                <Td className="font-medium text-ink">{t.name}</Td>
                <Td className="tabular text-right">{t.approvalLevels}</Td>
                {[t.level1LimitDays, t.level2LimitDays, t.level3LimitDays].map((limit, i) => (
                  <Td key={i} className="tabular text-right text-ink-soft">
                    {limit === null ? <span className="text-ink-faint">—</span> : `${limit} d`}
                  </Td>
                ))}
                <Td className="text-right text-xs text-ink-soft">
                  {t.level4LimitDays === null ? "final authority" : `${t.level4LimitDays} d`}
                </Td>
                <Td className="tabular text-right text-ink-soft">
                  {t.minNoticeDays > 0 ? `${t.minNoticeDays} d` : "—"}
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableShell>
      </Card>

      {/* --------------------------------------------- entitlement by contract */}
      <Card className="mb-5">
        <CardHeader
          title="Entitlement by employment type"
          description="A permanent employee and a contract employee rarely get the same days. Blank means the leave type's own figure applies."
        />
        {empTypes.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-faint">
            No employment types defined — add them under Organisation.
          </p>
        ) : (
          <TableShell>
            <thead>
              <tr>
                <Th>Leave type</Th>
                {empTypes.map((e) => (
                  <Th key={e.id} className="text-right">
                    {e.name}
                  </Th>
                ))}
                <Th className="text-right">Default</Th>
              </tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <Tr key={t.id}>
                  <Td className="font-medium text-ink">{t.name}</Td>
                  {empTypes.map((e) => {
                    const cell = byPair.get(`${t.id}:${e.id}`);
                    return (
                      <Td key={e.id} className="tabular text-right">
                        {cell ? (
                          <span className="text-ink">{formatDays(Number(cell.daysAllowed))}</span>
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
                      </Td>
                    );
                  })}
                  <Td className="tabular text-right text-ink-soft">
                    {formatDays(Number(t.daysPerYear))}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>

      {/* ------------------------------------------------------------ groups */}
      <Card>
        <CardHeader
          title="Leave groups"
          description="Reporting buckets several types share. Optional — a type without a group still works."
        />
        {groups.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-faint">No leave groups defined.</p>
        ) : (
          <div className="flex flex-wrap gap-2 p-4">
            {groups.map((g) => (
              <Badge key={g.id} tone={g.isActive ? "accent" : "neutral"}>
                {g.code} · {g.name}
              </Badge>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
