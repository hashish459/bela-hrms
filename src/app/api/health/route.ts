import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * Liveness and readiness in one endpoint.
 *
 * A health check that only proves the process is listening is worthless: Next
 * answers requests long before it can serve a page, and an application whose
 * database is unreachable is not healthy in any sense a load balancer should
 * act on. So this actually queries.
 *
 * `SELECT 1` and nothing more. A check that runs a real query against real
 * tables becomes a load generator every few seconds, and one that touches
 * business logic starts failing for reasons that have nothing to do with health.
 *
 * Deliberately unauthenticated — the proxy and the container runtime call it
 * before anybody has a session — and deliberately mute: it reports up or down
 * and the database round-trip time, never a version, a hostname or an error
 * message that describes the inside of the system to whoever asked.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();

  try {
    await db.execute(sql`SELECT 1`);
    return Response.json(
      { status: "ok", database: "up", latencyMs: Date.now() - started },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    // Logged in full for the operator; the response says only that it is down.
    console.error("[health] database unreachable:", error);
    return Response.json(
      { status: "degraded", database: "down", latencyMs: Date.now() - started },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
