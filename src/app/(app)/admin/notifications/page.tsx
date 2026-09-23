import { requirePermission } from "@/lib/session";
import { SparkColumns } from "@/components/charts";
import { Badge, Card, CardHeader, StatTile } from "@/components/ui";
import { CATALOGUE, CATEGORIES } from "@/modules/notifications/catalogue";
import { emailTransport, TRANSPORT_LABEL } from "@/modules/notifications/email";
import { loadRules, stats } from "@/modules/notifications/service";
import { addDays, todayInNepal } from "@/lib/bs";
import { OpsButtons } from "./ops-buttons";
import { RulesEditor, type RuleView } from "./rules-editor";

export const metadata = { title: "Notifications" };

export default async function NotificationsAdminPage() {
  const viewer = await requirePermission("admin.notifications.manage");
  const [rules, s] = await Promise.all([loadRules(viewer.orgId), stats(viewer.orgId)]);
  const categoryLabel = new Map(CATEGORIES.map((c) => [c.key, c.label]));
  const transport = emailTransport();

  const views: RuleView[] = CATALOGUE.filter((e) => e.key !== "announcement").map((entry) => {
    const r = rules.get(entry.key)!;
    return {
      key: entry.key,
      label: entry.label,
      description: entry.description,
      category: entry.category,
      categoryLabel: categoryLabel.get(entry.category) ?? entry.category,
      severity: entry.severity,
      enabled: r.enabled,
      inApp: r.inApp,
      email: r.email,
      recipients: r.recipients,
      allowedRecipients: entry.allowedRecipients,
      hrPermission: entry.hrPermission ?? null,
      title: r.title,
      body: r.body,
      placeholders: entry.placeholders,
      threshold: entry.thresholdDays ? { value: r.thresholdDays, label: entry.thresholdDays.label } : null,
      isCustomised: r.isCustomised,
      sentLast30: s.byEvent[entry.key] ?? 0,
    };
  });

  // a fortnight of daily volume, with the empty days filled in
  const today = todayInNepal();
  const byDay = new Map(s.byDay.map((d) => [d.day, d.n]));
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const readRate = s.total ? Math.round((s.read / s.total) * 100) : null;
  const emailed = (s.deliveries.sent ?? 0) + (s.deliveries.logged ?? 0);
  const enabledCount = views.filter((v) => v.enabled).length;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Delivered · 30 days" value={s.total} sub="in-app notifications" tone="accent" />
        <StatTile label="Read" value={readRate === null ? "—" : `${readRate}%`} sub={`${s.unread} still unread`} tone="ok" />
        <StatTile label="Emails sent" value={emailed} sub={s.deliveries.logged ? `${s.deliveries.logged} to the log only` : "last 30 days"} tone="info" />
        <StatTile
          label="Emails failed"
          value={s.deliveries.failed ?? 0}
          sub={s.deliveries.skipped ? `${s.deliveries.skipped} skipped — no transport` : "retried with backoff"}
          tone={s.deliveries.failed ? "danger" : "neutral"}
        />
        <StatTile label="Queued" value={s.deliveries.queued ?? 0} sub="emails waiting to go" tone={s.deliveries.queued ? "warn" : "neutral"} />
        <StatTile label="Rules on" value={`${enabledCount} / ${views.length}`} sub="notifications enabled" tone="neutral" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader title="Volume" description="Notifications delivered per day, last 14 days" />
          <div className="p-4">
            <SparkColumns height={72} points={days.map((d) => ({ label: d, value: byDay.get(d) ?? 0, tone: "accent" }))} />
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
              {CATEGORIES.map((c) => (
                <span key={c.key}>
                  {c.label} <span className="tabular font-medium text-ink">{s.byCategory[c.key] ?? 0}</span>
                </span>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Email delivery" description="How messages leave the system" />
          <div className="flex flex-col gap-3 p-4 text-sm">
            <p className="flex items-center justify-between">
              Transport
              <Badge tone={transport === "webhook" ? "ok" : transport === "log" ? "warn" : "danger"}>{TRANSPORT_LABEL[transport]}</Badge>
            </p>
            <p className="text-xs text-ink-faint">
              {transport === "webhook"
                ? "Each email is posted to the configured relay as JSON."
                : transport === "log"
                  ? "Emails are written to the server log and marked “logged” — nothing is sent. Set NOTIFY_EMAIL_TRANSPORT=webhook and NOTIFY_EMAIL_WEBHOOK_URL to send."
                  : "No transport is configured, so emails are recorded as skipped. Set NOTIFY_EMAIL_TRANSPORT=webhook and NOTIFY_EMAIL_WEBHOOK_URL."}
            </p>
            <OpsButtons />
          </div>
        </Card>
      </div>

      <div className="mt-6 mb-3">
        <h2 className="text-base font-semibold text-ink">Rules</h2>
        <p className="text-sm text-ink-soft">
          Every notification the system can send. Switch one off, choose its channels and recipients, or reword it — and send
          yourself a test before saving.
        </p>
      </div>
      <RulesEditor rules={views} />
    </>
  );
}
