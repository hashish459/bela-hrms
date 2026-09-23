import "@/kernel/boot";

import { timingSafeEqual } from "node:crypto";
import { db } from "@/db/client";
import { organizations } from "@/db/schema/core";
import { drain } from "@/kernel/events";
import { flushEmail } from "@/modules/notifications/email";
import { sweepReminders } from "@/modules/notifications/service";

/**
 * The scheduler's entry point: drain the event queue, send due reminders for
 * every organisation, and empty the email outbox.
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

  const events = await drain({ limit: 200 });
  const orgs = await db.select({ id: organizations.id }).from(organizations);
  let reminders = 0;
  for (const org of orgs) reminders += await sweepReminders(org.id, { force: true });
  const email = await flushEmail(200);

  return Response.json({ events, reminders, email });
}

export const GET = run;
export const POST = run;
