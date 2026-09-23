import "@/kernel/boot";

import { timingSafeEqual } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { session, verification } from "@/db/schema/auth";
import { organizations } from "@/db/schema/core";
import { domainEvents } from "@/db/schema/kernel";
import { drain } from "@/kernel/events";
import { applyDueMovements } from "@/modules/people/movements";
import { flushEmail } from "@/modules/notifications/email";
import { sweepReminders } from "@/modules/notifications/service";

/**
 * The scheduler's entry point: apply transfers and promotions whose date has
 * come, drain the event queue, send due reminders for every organisation,
 * empty the email outbox, and keep the housekeeping tables small.
 *
 * Point a cron job (or any scheduler) at it every few minutes:
 *
 *   curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://hrms.example.np/api/cron/notifications
 *
 * Without CRON_SECRET set it answers 404, so an unconfigured deployment does
 * not expose a job anybody can trigger. Pages still sweep opportunistically,
 * so reminders work without a scheduler — this makes them punctual.
 */

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function run(request: Request) {
  if (!process.env.CRON_SECRET) return new Response("Not found", { status: 404 });
  if (!authorised(request)) return new Response("Unauthorised", { status: 401 });

  const orgs = await db.select({ id: organizations.id }).from(organizations);
  let movements = 0;
  for (const org of orgs) movements += await applyDueMovements(org.id);

  const events = await drain({ limit: 200 });
  let reminders = 0;
  for (const org of orgs) reminders += await sweepReminders(org.id, { force: true });
  const email = await flushEmail(200);
  const housekeeping = await tidy();

  return Response.json({ movements, events, reminders, email, housekeeping });
}

/**
 * Deletes what nothing will read again: expired sessions and verification
 * tokens, and domain events delivered long enough ago that no replay could
 * still need their dedupe key. Bounded per run so one call never holds a long
 * lock on a busy table.
 */
async function tidy() {
  const sessions = await db
    .delete(session)
    .where(sql`${session.id} in (select id from ${session} where ${session.expiresAt} < now() limit 5000)`)
    .returning({ id: session.id });
  const tokens = await db
    .delete(verification)
    .where(lt(verification.expiresAt, sql`now()`))
    .returning({ id: verification.id });
  const oldEvents = await db
    .delete(domainEvents)
    .where(
      sql`${domainEvents.id} in (select id from ${domainEvents} where ${and(
        eq(domainEvents.status, "done"),
        lt(domainEvents.occurredAt, sql`now() - interval '90 days'`),
      )} limit 5000)`,
    )
    .returning({ id: domainEvents.id });
  return { sessions: sessions.length, tokens: tokens.length, events: oldEvents.length };
}

export const GET = run;
export const POST = run;
