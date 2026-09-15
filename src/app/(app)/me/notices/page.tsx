import { Megaphone, Paperclip, Pin } from "lucide-react";
import { noticeBoard } from "@/modules/selfservice/desk";
import { requireSelf } from "@/modules/selfservice/guard";
import { Badge, Card, PageHeader, StatTile } from "@/components/ui";
import { PanelEmpty } from "../parts";
import { MarkRead } from "./forms";

export const metadata = { title: "Notices" };

/**
 * The notice board.
 *
 * Audience filtering happens in the service, in SQL — a notice addressed to one
 * branch never reaches this page for anybody else, rather than being fetched and
 * hidden. Hiding in the client is how a "confidential to Head Office" notice
 * ends up in a page payload that anybody can read.
 *
 * Read state is per employee and explicit. An auto-marking board — read when
 * rendered — cannot answer the only question HR asks of a safety notice: who
 * has genuinely acknowledged it.
 */
export default async function NoticesPage() {
  const ctx = await requireSelf("self.notice.read");
  const notices = await noticeBoard(ctx);

  const unread = notices.filter((n) => !n.readAt);
  const pinned = notices.filter((n) => n.isPinned);

  return (
    <>
      <PageHeader
        title="Notices"
        description="Announcements addressed to you, your branch or your department."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatTile label="On the board" value={notices.length} tone="accent" />
        <StatTile
          label="Unread"
          value={unread.length}
          tone={unread.length > 0 ? "warn" : "ok"}
          sub={unread.length === 0 ? "You are up to date" : "Mark them once read"}
        />
        <StatTile label="Pinned" value={pinned.length} />
      </div>

      {notices.length === 0 ? (
        <Card>
          <PanelEmpty>Nothing on the board right now.</PanelEmpty>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {notices.map((n) => {
            const tone =
              n.priority === "urgent" ? "danger" : n.priority === "important" ? "warn" : "accent";

            return (
              <li key={n.id} id={n.id} className="scroll-mt-16">
                <Card
                  className={`overflow-hidden ${
                    n.readAt ? "" : "border-l-2 border-l-accent"
                  }`}
                >
                  <div className="flex gap-3 p-4">
                    <span
                      className={`grid size-9 shrink-0 place-items-center rounded-full ${
                        n.priority === "urgent"
                          ? "bg-danger-soft text-danger"
                          : n.priority === "important"
                            ? "bg-warn-soft text-warn"
                            : "bg-accent-soft text-accent"
                      }`}
                    >
                      {n.isPinned ? (
                        <Pin className="size-4" aria-hidden />
                      ) : (
                        <Megaphone className="size-4" aria-hidden />
                      )}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-semibold text-ink">{n.title}</h2>
                        {n.priority !== "normal" ? <Badge tone={tone}>{n.priority}</Badge> : null}
                        {n.isPinned ? <Badge tone="neutral">pinned</Badge> : null}
                        {!n.readAt ? <Badge tone="accent">new</Badge> : null}
                      </div>

                      <p className="mt-2 max-w-[74ch] text-[13px] whitespace-pre-line text-ink-soft">
                        {n.body}
                      </p>

                      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-ink-faint">
                        <span className="tabular">
                          {new Date(n.publishFrom).toLocaleDateString("en-GB", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </span>
                        {n.postedBy ? (
                          <>
                            <span aria-hidden>·</span>
                            <span>{n.postedBy}</span>
                          </>
                        ) : null}
                        <span aria-hidden>·</span>
                        <span className="capitalize">
                          {n.audience === "everyone" ? "All staff" : `Your ${n.audience}`}
                        </span>

                        {n.attachmentUrl ? (
                          <a
                            href={n.attachmentUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 text-accent hover:underline"
                          >
                            <Paperclip className="size-3" aria-hidden />
                            Attachment
                          </a>
                        ) : null}

                        <span className="ml-auto">
                          {n.readAt ? (
                            <span className="text-ok">
                              Read{" "}
                              {new Date(n.readAt).toLocaleDateString("en-GB", {
                                day: "2-digit",
                                month: "short",
                              })}
                            </span>
                          ) : (
                            <MarkRead noticeId={n.id} />
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
