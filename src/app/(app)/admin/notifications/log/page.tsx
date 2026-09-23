import Link from "next/link";
import { requirePermission } from "@/lib/session";
import { OffsetPagination } from "@/components/pagination";
import { Badge, Card, CardHeader, EmptyState, TableShell, Td, Th, Tr, type Tone } from "@/components/ui";
import { cn } from "@/lib/utils";
import { CATALOGUE_BY_KEY } from "@/modules/notifications/catalogue";
import { recentDeliveries, recentNotifications } from "@/modules/notifications/service";

export const metadata = { title: "Notification log" };

const STATUS_TONE: Record<string, Tone> = { queued: "warn", sent: "ok", logged: "info", failed: "danger", skipped: "neutral" };
const STATUSES = ["", "queued", "sent", "logged", "failed", "skipped"];

const when = (d: Date | null) =>
  d ? d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export default async function NotificationLogPage({ searchParams }: PageProps<"/admin/notifications/log">) {
  const viewer = await requirePermission("admin.notifications.manage");
  const params = await searchParams;
  const status = STATUSES.includes(String(params.status ?? "")) ? String(params.status ?? "") : "";
  const tab = params.tab === "email" ? "email" : "inbox";

  const [notes, mail] = await Promise.all([
    tab === "inbox" ? recentNotifications(viewer.orgId, typeof params.page === "string" ? params.page : null) : null,
    tab === "email" ? recentDeliveries(viewer.orgId, status || null, typeof params.page === "string" ? params.page : null) : null,
  ]);

  const tabLink = (t: string, extra: Record<string, string> = {}) => {
    const q = new URLSearchParams({ ...(t === "email" ? { tab: "email" } : {}), ...extra });
    const s = q.toString();
    return s ? `/admin/notifications/log?${s}` : "/admin/notifications/log";
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {[
          { key: "inbox", label: "In-app notifications" },
          { key: "email", label: "Email outbox" },
        ].map((t) => (
          <Link
            key={t.key}
            href={tabLink(t.key)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs",
              tab === t.key ? "border-accent bg-accent-soft font-medium text-accent" : "border-line text-ink-soft hover:bg-sunk",
            )}
          >
            {t.label}
          </Link>
        ))}
        {tab === "email" ? (
          <span className="ml-2 flex flex-wrap items-center gap-1">
            {STATUSES.map((s) => (
              <Link
                key={s || "all"}
                href={tabLink("email", s ? { status: s } : {})}
                className={cn(
                  "rounded px-2 py-0.5 text-[11px] capitalize",
                  status === s ? "bg-sunk font-medium text-ink" : "text-ink-faint hover:text-ink",
                )}
              >
                {s || "all"}
              </Link>
            ))}
          </span>
        ) : null}
      </div>

      {notes ? (
        <Card>
          <CardHeader title="Delivered in app" description="Every notification written to somebody's inbox, newest first" />
          {notes.rows.length === 0 ? (
            <EmptyState title="Nothing delivered yet" hint="Notifications appear here as leave and attendance requests move." />
          ) : (
            <TableShell className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>Notification</Th>
                  <Th>Rule</Th>
                  <Th>Recipient</Th>
                  <Th>State</Th>
                  <Th className="text-right">Delivered</Th>
                </tr>
              </thead>
              <tbody>
                {notes.rows.map((n) => (
                  <Tr key={n.id}>
                    <Td className="max-w-md truncate font-medium text-ink" title={n.title}>
                      {n.title}
                    </Td>
                    <Td className="text-xs text-ink-soft">{CATALOGUE_BY_KEY.get(n.eventKey)?.label ?? n.eventKey}</Td>
                    <Td className="text-xs">{n.recipient}</Td>
                    <Td>
                      {n.archivedAt ? <Badge>archived</Badge> : n.readAt ? <Badge tone="ok">read</Badge> : <Badge tone="warn">unread</Badge>}
                    </Td>
                    <Td className="tabular text-right text-xs text-ink-faint">{when(n.createdAt)}</Td>
                  </Tr>
                ))}
              </tbody>
            </TableShell>
          )}
          <OffsetPagination page={notes.page} params={params} label="notifications" />
        </Card>
      ) : null}

      {mail ? (
        <Card>
          <CardHeader title="Email outbox" description="Each email, its status and — when it failed — why" />
          {mail.rows.length === 0 ? (
            <EmptyState title="No emails match" />
          ) : (
            <TableShell className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>Subject</Th>
                  <Th>To</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Attempts</Th>
                  <Th className="text-right">Queued</Th>
                  <Th className="text-right">Sent</Th>
                </tr>
              </thead>
              <tbody>
                {mail.rows.map((m) => (
                  <Tr key={m.id}>
                    <Td className="max-w-sm">
                      <p className="truncate text-ink" title={m.subject}>
                        {m.subject}
                      </p>
                      {m.lastError ? <p className="truncate text-[11px] text-danger" title={m.lastError}>{m.lastError}</p> : null}
                    </Td>
                    <Td className="text-xs text-ink-soft">{m.toAddress}</Td>
                    <Td>
                      <Badge tone={STATUS_TONE[m.status] ?? "neutral"}>{m.status}</Badge>
                    </Td>
                    <Td className="tabular text-right text-xs">{m.attempts}</Td>
                    <Td className="tabular text-right text-xs text-ink-faint">{when(m.createdAt)}</Td>
                    <Td className="tabular text-right text-xs text-ink-faint">{when(m.sentAt)}</Td>
                  </Tr>
                ))}
              </tbody>
            </TableShell>
          )}
          <OffsetPagination page={mail.page} params={params} label="emails" />
        </Card>
      ) : null}
    </div>
  );
}
