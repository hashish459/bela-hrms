import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { roles } from "@/db/schema/core";
import { branches, departments } from "@/db/schema/org";
import { requirePermission } from "@/lib/session";
import { Badge, Card, CardHeader, EmptyState, TableShell, Td, Th, Tr, type Tone } from "@/components/ui";
import { audienceUsers, recentAnnouncements } from "@/modules/notifications/service";
import { AnnouncementComposer } from "./composer";

export const metadata = { title: "Announcements" };

const TONE: Record<string, Tone> = { info: "info", success: "ok", warning: "warn", danger: "danger" };

export default async function AnnouncementsPage() {
  const viewer = await requirePermission("admin.notifications.manage");
  const [deptRows, branchRows, roleRows, everyone, recent] = await Promise.all([
    db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(and(eq(departments.orgId, viewer.orgId), eq(departments.isActive, true)))
      .orderBy(asc(departments.name)),
    db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(and(eq(branches.orgId, viewer.orgId), eq(branches.isActive, true)))
      .orderBy(asc(branches.name)),
    db.select({ id: roles.id, name: roles.name }).from(roles).where(eq(roles.orgId, viewer.orgId)).orderBy(asc(roles.name)),
    audienceUsers(viewer.orgId, { kind: "everyone" }),
    recentAnnouncements(viewer.orgId, 15),
  ]);

  const audienceText = (a: { kind: string; label?: string }) =>
    a.kind === "everyone" ? "Everyone" : `${a.kind[0].toUpperCase()}${a.kind.slice(1)}: ${a.label ?? "—"}`;

  return (
    <div className="flex flex-col gap-4">
      <AnnouncementComposer departments={deptRows} branches={branchRows} roles={roleRows} everyone={everyone.length} />

      <Card>
        <CardHeader title="Sent" description="The most recent announcements, newest first" />
        {recent.length === 0 ? (
          <EmptyState title="No announcements sent yet" />
        ) : (
          <TableShell className="rounded-none border-0">
            <thead>
              <tr>
                <Th>Announcement</Th>
                <Th>Audience</Th>
                <Th className="text-right">Reached</Th>
                <Th>Sent by</Th>
                <Th className="text-right">When</Th>
              </tr>
            </thead>
            <tbody>
              {recent.map((a) => (
                <Tr key={a.id}>
                  <Td className="max-w-md">
                    <p className="flex items-center gap-2 font-medium text-ink">
                      {a.title}
                      <Badge tone={TONE[a.severity] ?? "neutral"}>{a.severity}</Badge>
                      {a.alsoEmail ? <Badge tone="info">email</Badge> : null}
                    </p>
                    {a.body ? <p className="truncate text-xs text-ink-faint">{a.body}</p> : null}
                  </Td>
                  <Td className="text-xs text-ink-soft">{audienceText(a.audience)}</Td>
                  <Td className="tabular text-right">{a.recipientCount}</Td>
                  <Td className="text-xs text-ink-soft">{a.sentByLabel ?? "—"}</Td>
                  <Td className="tabular text-right text-xs text-ink-faint">
                    {a.createdAt.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>
    </div>
  );
}
