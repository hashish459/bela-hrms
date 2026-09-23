import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ReportActions } from "@/components/reports/report-actions";
import { requirePermission } from "@/lib/session";
import { adToBs, daysBetween, formatBs, todayInNepal } from "@/lib/bs";
import { Avatar } from "@/components/avatar";
import { Badge, Card, CardHeader } from "@/components/ui";
import { separationDetail, SEPARATION_LABEL } from "@/modules/people/separations";
import { CaseForm, Checklist, CloseCase } from "./case-panels";

export const metadata = { title: "Separation" };

export default async function SeparationCasePage({ params }: PageProps<"/hr/separations/[id]">) {
  const viewer = await requirePermission("hr.employee.separate");
  const { id } = await params;
  const detail = await separationDetail(viewer.orgId, id);
  if (!detail) notFound();

  const s = detail.s;
  const open = s.status === "in_progress";
  const bs = (d: string) => formatBs(adToBs(d));
  const noticeDays = daysBetween(s.noticeDate, s.lastWorkingDate);
  const pendingLines = detail.clearance.filter((c) => c.status === "pending").length;
  const today = todayInNepal();
  const serviceDays = daysBetween(detail.dateOfJoin, s.lastWorkingDate);
  const years = Math.floor(serviceDays / 365.25);
  const months = Math.floor((serviceDays - years * 365.25) / 30.44);

  return (
    <>
      <Link href="/hr/separations" className="mb-3 inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink print:hidden">
        <ArrowLeft className="size-3.5" />
        Separations
      </Link>

      <Card className="mb-4 flex flex-wrap items-center gap-4 p-4">
        <Avatar
          photoId={detail.photoFileId}
          firstName={detail.employeeName.split(" ")[0] ?? "?"}
          lastName={detail.employeeName.split(" ").slice(-1)[0] ?? ""}
          seed={s.employeeId}
          size="lg"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold text-ink">{detail.employeeName}</h1>
            <Badge tone={open ? "warn" : s.status === "completed" ? "neutral" : "info"}>{s.status.replace(/_/g, " ")}</Badge>
          </div>
          <p className="mt-0.5 text-sm text-ink-soft">
            <span className="font-mono text-xs">{detail.employeeCode}</span> · {detail.designation ?? "—"} · {detail.department ?? "—"}
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            {SEPARATION_LABEL[s.kind]} <span className="font-mono">{s.reference}</span> · opened by {s.createdByLabel ?? "—"}
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Link
            href={`/hr/employees/${s.employeeId}`}
            className="rounded border border-line px-3 py-1.5 text-sm text-ink-soft hover:bg-sunk hover:text-ink"
          >
            Employee record
          </Link>
          <ReportActions />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title="No-dues clearance"
              description={`${detail.clearance.length - pendingLines} of ${detail.clearance.length} lines settled`}
            />
            <Checklist
              caseId={s.id}
              open={open}
              lines={detail.clearance.map((c) => ({
                id: c.id,
                owner: c.owner,
                item: c.item,
                status: c.status,
                note: c.note,
                clearedByLabel: c.clearedByLabel,
              }))}
            />
          </Card>

          <Card>
            <CardHeader title="Exit interview & settlement" />
            <CaseForm
              id={s.id}
              open={open}
              values={{
                lastWorkingDate: s.lastWorkingDate,
                exitInterview: s.exitInterview,
                eligibleForRehire: s.eligibleForRehire,
                settlementStatus: s.settlementStatus,
                settlementNote: s.settlementNote,
              }}
            />
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Timeline" />
            <dl className="grid grid-cols-2 gap-4 p-4 text-sm">
              <div>
                <dt className="text-[11px] tracking-wide text-ink-faint uppercase">Joined</dt>
                <dd className="tabular text-ink">{bs(detail.dateOfJoin)}</dd>
              </div>
              <div>
                <dt className="text-[11px] tracking-wide text-ink-faint uppercase">Service</dt>
                <dd className="text-ink">
                  {years}y {months}m
                </dd>
              </div>
              <div>
                <dt className="text-[11px] tracking-wide text-ink-faint uppercase">Notice given</dt>
                <dd className="tabular text-ink">{bs(s.noticeDate)}</dd>
              </div>
              <div>
                <dt className="text-[11px] tracking-wide text-ink-faint uppercase">Last working day</dt>
                <dd className="tabular text-ink">{bs(s.lastWorkingDate)}</dd>
              </div>
              <div>
                <dt className="text-[11px] tracking-wide text-ink-faint uppercase">Notice served</dt>
                <dd className="text-ink">
                  {noticeDays} days
                  {detail.noticePeriodDays && noticeDays < detail.noticePeriodDays ? (
                    <span className="block text-[11px] text-warn">short of the {detail.noticePeriodDays}-day notice period</span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] tracking-wide text-ink-faint uppercase">Rehire</dt>
                <dd className="text-ink">{s.eligibleForRehire ? "Eligible" : "Not eligible"}</dd>
              </div>
            </dl>
            {s.reason ? <p className="border-t border-line-soft px-4 py-3 text-sm text-ink-soft">“{s.reason}”</p> : null}
            {s.completedAt ? (
              <p className="border-t border-line-soft px-4 py-3 text-xs text-ink-faint">
                Completed by {s.completedByLabel ?? "—"}
              </p>
            ) : null}
            {open && s.lastWorkingDate < today ? (
              <p className="border-t border-line-soft px-4 py-3 text-xs text-danger">
                The last working day has passed and the case is still open.
              </p>
            ) : null}
          </Card>

          {open ? (
            <Card className="print:hidden">
              <CardHeader title="Close the case" />
              <CloseCase id={s.id} pendingLines={pendingLines} servingNotice={s.lastWorkingDate > today} />
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
