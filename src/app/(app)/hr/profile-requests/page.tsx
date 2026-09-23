import Link from "next/link";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";
import { adToBs, formatBs } from "@/lib/bs";
import { Avatar } from "@/components/avatar";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { changeQueue } from "@/modules/people/changes";
import { displayValue, SECTION_BY_KEY, type SectionKey } from "@/modules/people/profile-fields";
import { Decision } from "./decision";

export const metadata = { title: "Profile Requests" };

const VIEWS = [
  { key: "pending", label: "Waiting" },
  { key: "approved", label: "Applied" },
  { key: "rejected", label: "Refused" },
  { key: "all", label: "All" },
] as const;

const ACTION_LABEL: Record<string, string> = { update: "Change", add: "Add", remove: "Remove" };

/**
 * Self-service corrections waiting on HR. Each card shows exactly what would
 * change — the value on file beside the value asked for, differences marked —
 * so the decision is made against the record, not against a description.
 */
export default async function ProfileRequestsPage({ searchParams }: PageProps<"/hr/profile-requests">) {
  const viewer = await requirePermission("hr.employee.update");
  const params = await searchParams;
  const view = VIEWS.find((v) => v.key === params.view)?.key ?? "pending";
  const rows = await changeQueue(viewer.orgId, view);

  return (
    <>
      <PageHeader
        title="Profile requests"
        description="Corrections employees asked for from My Profile. Applying writes the change to their record, with you as the author."
      />

      <nav className="mb-3 flex gap-1" aria-label="Filter requests">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={v.key === "pending" ? "/hr/profile-requests" : `/hr/profile-requests?view=${v.key}`}
            className={cn(
              "rounded px-2.5 py-1 text-sm",
              view === v.key ? "bg-accent-soft font-medium text-accent" : "text-ink-soft hover:bg-sunk hover:text-ink",
            )}
          >
            {v.label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <Card>
          <EmptyState title={view === "pending" ? "Nothing waiting" : "Nothing here"} hint={view === "pending" ? "New requests appear here and in your notifications." : undefined} />
        </Card>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {rows.map(({ r, employeeName, employeeCode, photoFileId, department }) => {
            const def = SECTION_BY_KEY.get(r.section as SectionKey);
            const fields = def?.fields ?? [];
            const current = r.current ?? {};
            return (
              <Card key={r.id} className="flex flex-col">
                <div className="flex items-start justify-between gap-3 border-b border-line-soft px-4 py-3">
                  <Link href={`/hr/employees/${r.employeeId}`} className="flex min-w-0 items-center gap-2 hover:text-accent">
                    <Avatar
                      photoId={photoFileId}
                      firstName={employeeName.split(" ")[0] ?? "?"}
                      lastName={employeeName.split(" ").slice(-1)[0] ?? ""}
                      seed={r.employeeId}
                      size="sm"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{employeeName}</span>
                      <span className="block text-[11px] text-ink-faint">
                        <span className="font-mono">{employeeCode}</span>
                        {department ? ` · ${department}` : ""}
                      </span>
                    </span>
                  </Link>
                  <div className="text-right">
                    <Badge tone={r.action === "remove" ? "danger" : r.action === "add" ? "info" : "accent"}>
                      {ACTION_LABEL[r.action] ?? r.action} · {def?.label ?? r.section}
                    </Badge>
                    <p className="mt-1 text-[11px] text-ink-faint">{formatBs(adToBs(r.createdAt.toISOString().slice(0, 10)))}</p>
                  </div>
                </div>

                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] tracking-wide text-ink-faint uppercase">
                      <th className="px-4 py-1.5 font-medium">Field</th>
                      {r.action !== "add" ? <th className="px-2 py-1.5 font-medium">On file</th> : null}
                      <th className="px-2 py-1.5 font-medium">{r.action === "remove" ? "" : "Asked for"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((f) => {
                      const before = displayValue(f, current[f.name]);
                      const after = displayValue(f, r.proposed[f.name]);
                      const changed = r.action === "update" && before !== after;
                      if (r.action === "update" && !changed && before === "—") return null;
                      return (
                        <tr key={f.name} className={changed ? "bg-warn-soft/40" : undefined}>
                          <td className="px-4 py-1 text-ink-faint">{f.label}</td>
                          {r.action !== "add" ? (
                            <td className={cn("px-2 py-1", changed ? "text-ink-soft line-through" : "text-ink-soft")}>{before}</td>
                          ) : null}
                          <td className={cn("px-2 py-1", changed || r.action === "add" ? "font-medium text-ink" : "text-ink-faint")}>
                            {r.action === "remove" ? "" : after}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {r.note ? <p className="border-t border-line-soft px-4 py-2 text-xs text-ink-soft">“{r.note}”</p> : null}

                <div className="mt-auto border-t border-line-soft px-4 py-3">
                  {r.status === "pending" ? (
                    <Decision id={r.id} />
                  ) : (
                    <p className="text-xs text-ink-soft">
                      <Badge tone={r.status === "approved" ? "ok" : r.status === "rejected" ? "danger" : "neutral"}>{r.status}</Badge>
                      {r.decidedByLabel ? ` by ${r.decidedByLabel}` : ""}
                      {r.decisionNote ? ` — ${r.decisionNote}` : ""}
                    </p>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
