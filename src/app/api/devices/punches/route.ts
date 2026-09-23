import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { attendanceDevices } from "@/db/schema/devices";
import { ingestPunches, type IncomingPunch } from "@/modules/attendance/devices";

/**
 * Where readers post their readings.
 *
 * This is the only way punches enter the system, and it is machine-to-machine:
 * a device that speaks HTTP posts here directly, and one that does not — a
 * fingerprint reader on a factory LAN, unreachable from this server — is polled
 * by a small agent on the site network which posts on its behalf.
 *
 * Authentication is a bearer token issued per device, matched against a stored
 * SHA-256. No cookie is read, so there is no session to confuse this with and
 * nothing for a browser to attach automatically.
 *
 * The contract is deliberately forgiving about *content* and strict about
 * *shape*. A reading whose enrolment number means nothing to us is stored
 * unmatched rather than refused, because the alternative is losing the only
 * record that somebody was at work; but a malformed timestamp is rejected
 * outright, because guessing what it meant would be worse.
 */

/** One request, one reasonable batch. A reader with more to say can post twice. */
const MAX_PUNCHES = 1000;

const punchSchema = z.object({
  /** The number the device knows the person by. Numeric on most readers, hex on card ones. */
  enrollNumber: z.union([z.string(), z.number()]).transform((v) => String(v).trim()),
  /**
   * Local wall clock at the reader, ISO 8601.
   *
   * Local, not UTC: a shift starts at 09:00 Nepal time and the whole
   * calculation is in local minutes-since-midnight. Accepting a zone here and
   * converting would introduce an offset bug on exactly one day a year in
   * countries with daylight saving, for no benefit in one that has none.
   */
  punchedAt: z.string().min(1),
  direction: z.enum(["in", "out", "unknown"]).optional(),
  payload: z.unknown().optional(),
});

const bodySchema = z.object({
  punches: z.array(punchSchema).min(1, "Send at least one punch").max(MAX_PUNCHES),
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** "2026-09-20T09:03:00" → a local Date, with no timezone reinterpretation. */
function parseLocal(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function POST(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

  if (!token) return json({ error: "Missing bearer token" }, 401);

  const [device] = await db
    .select()
    .from(attendanceDevices)
    .where(
      and(
        eq(attendanceDevices.apiKeyHash, createHash("sha256").update(token).digest("hex")),
        // A withdrawn device must not be able to post. Revoking the token is
        // the clean way, but taking it out of service has to work too.
        eq(attendanceDevices.status, "active"),
      ),
    )
    .limit(1);

  // Deliberately the same response as a bad token: whether a given token
  // belongs to a real but inactive device is not something a caller needs.
  if (!device) return json({ error: "Unknown or inactive device token" }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: "Invalid body", issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) },
      400,
    );
  }

  const incoming: IncomingPunch[] = [];
  const rejected: { index: number; reason: string }[] = [];

  parsed.data.punches.forEach((p, index) => {
    const punchedAt = parseLocal(p.punchedAt);
    if (!punchedAt) {
      rejected.push({ index, reason: "punchedAt must be ISO 8601 local time, e.g. 2026-09-20T09:03:00" });
      return;
    }
    if (!p.enrollNumber) {
      rejected.push({ index, reason: "enrollNumber is empty" });
      return;
    }
    incoming.push({
      enrollNumber: p.enrollNumber,
      punchedAt,
      direction: p.direction,
      payload: p.payload,
    });
  });

  const result = await ingestPunches(device, incoming);

  /*
   * 202, not 200. The readings are accepted and durable, but they are not yet
   * attendance — resolving and folding them happens in the sync step. Saying
   * "created" would imply a day has been written, which it has not.
   */
  return json(
    {
      device: device.code,
      received: result.received,
      stored: result.stored,
      duplicates: result.duplicates,
      unmatched: result.unmatched,
      rejected,
    },
    202,
  );
}

/** A reader checking it can reach us, and that its token is still good. */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return json({ error: "Missing bearer token" }, 401);

  const [device] = await db
    .select({ code: attendanceDevices.code, name: attendanceDevices.name })
    .from(attendanceDevices)
    .where(
      and(
        eq(attendanceDevices.apiKeyHash, createHash("sha256").update(token).digest("hex")),
        eq(attendanceDevices.status, "active"),
      ),
    )
    .limit(1);

  if (!device) return json({ error: "Unknown or inactive device token" }, 401);

  // Reaching this endpoint at all is a sign of life, so record it: a device
  // that can talk but has nobody punching is a different problem from one that
  // has stopped reporting, and the register should be able to tell them apart.
  await db
    .update(attendanceDevices)
    .set({ lastSeenAt: new Date(), lastError: null })
    .where(eq(attendanceDevices.code, device.code));

  return json({ ok: true, device: device.code, name: device.name }, 200);
}
