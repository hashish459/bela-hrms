import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * Email: an outbox, and a transport that empties it.
 *
 * A notification's in-app row is written in the same breath as the event is
 * handled; its email is queued beside it and sent afterwards. Email servers
 * are slow and fail, and neither must ever hold up — or lose — the in-app copy.
 *
 * The transport is chosen by environment:
 *
 *   NOTIFY_EMAIL_TRANSPORT=webhook   POST each message as JSON to
 *                                    NOTIFY_EMAIL_WEBHOOK_URL (with
 *                                    NOTIFY_EMAIL_WEBHOOK_TOKEN as a bearer
 *                                    token) — a relay, a mail API adapter, an
 *                                    automation platform.
 *   NOTIFY_EMAIL_TRANSPORT=log       write each message to the server log and
 *                                    mark it "logged". The development default.
 *   anything else, in production     mark it "skipped: no transport configured",
 *                                    so the delivery log says plainly that no
 *                                    email left the building.
 *
 * A failed send is retried with backoff up to five attempts, then left
 * "failed" with its error for an administrator to see.
 */

export type Transport = "webhook" | "log" | "none";

export function emailTransport(): Transport {
  const configured = process.env.NOTIFY_EMAIL_TRANSPORT;
  if (configured === "webhook" && process.env.NOTIFY_EMAIL_WEBHOOK_URL) return "webhook";
  if (configured === "log") return "log";
  if (configured === "none") return "none";
  return process.env.NODE_ENV === "production" ? "none" : "log";
}

export const TRANSPORT_LABEL: Record<Transport, string> = {
  webhook: "Webhook relay",
  log: "Server log (development)",
  none: "Not configured",
};

const MAX_ATTEMPTS = 5;

type Queued = { id: string; to_address: string; subject: string; body: string; attempts: number };

async function send(message: Queued): Promise<void> {
  const transport = emailTransport();
  if (transport === "log") {
    console.info(`[notifications] email to ${message.to_address}: ${message.subject}`);
    return;
  }
  if (transport === "webhook") {
    const response = await fetch(process.env.NOTIFY_EMAIL_WEBHOOK_URL!, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.NOTIFY_EMAIL_WEBHOOK_TOKEN
          ? { Authorization: `Bearer ${process.env.NOTIFY_EMAIL_WEBHOOK_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        to: message.to_address,
        from: process.env.NOTIFY_EMAIL_FROM || null,
        subject: message.subject,
        text: message.body,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Relay answered ${response.status}`);
  }
}

/**
 * Sends what is queued. Rows are claimed with `FOR UPDATE SKIP LOCKED`, so two
 * workers never send the same message; a failure is retried after 2ⁿ minutes.
 */
export async function flushEmail(limit = 25): Promise<{ sent: number; failed: number; skipped: number }> {
  const transport = emailTransport();
  const claimed = await db.execute(sql`
    UPDATE notification_delivery
       SET attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM notification_delivery
        WHERE status = 'queued'
           OR (status = 'failed' AND attempts < ${MAX_ATTEMPTS}
               AND created_at < now() - (interval '1 minute' * power(2, attempts)))
        ORDER BY created_at
        LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
     )
    RETURNING id, to_address, subject, body, attempts
  `);

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of claimed.rows as unknown as Queued[]) {
    if (transport === "none") {
      skipped++;
      await db.execute(sql`
        UPDATE notification_delivery
           SET status = 'skipped', last_error = 'No email transport is configured (NOTIFY_EMAIL_TRANSPORT).'
         WHERE id = ${row.id}::uuid
      `);
      continue;
    }
    try {
      await send(row);
      sent++;
      await db.execute(sql`
        UPDATE notification_delivery
           SET status = ${transport === "log" ? "logged" : "sent"}, sent_at = now(), last_error = NULL
         WHERE id = ${row.id}::uuid
      `);
    } catch (error) {
      failed++;
      await db.execute(sql`
        UPDATE notification_delivery
           SET status = 'failed', last_error = ${error instanceof Error ? error.message : String(error)}
         WHERE id = ${row.id}::uuid
      `);
    }
  }
  return { sent, failed, skipped };
}

export function flushEmailInBackground(): void {
  void flushEmail().catch((error) => console.error("[notifications] email flush failed:", error));
}
