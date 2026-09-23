import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { employees } from "@/db/schema/hr";

/**
 * The reporting chain, and the one rule that protects it.
 *
 * Leave approval routing walks `supervisorId` — level one is the direct
 * supervisor, level two theirs — so a cycle is not a cosmetic problem. It is an
 * approval that can never be routed and a tree that cannot be rendered. The
 * legacy system allowed one to be created, and the chart screen then dropped
 * both people silently because neither had a reachable root.
 *
 * This lives in the module rather than in the page's action file for two
 * reasons: the rule is domain logic that any caller reassigning a supervisor
 * must obey, and a `"use server"` file can only export async functions, so a
 * rule left there cannot be asserted by anything except the UI.
 */

/**
 * Would making `supervisorId` the supervisor of `employeeId` close a loop?
 *
 * Walks upward from the proposed supervisor. If the walk reaches the employee,
 * then the employee is already somewhere above their proposed supervisor, and
 * adding this edge would join the two ends.
 *
 * The visited set guards against a cycle that *already* exists in the data —
 * imported, or created before this check existed — which would otherwise spin
 * this loop forever. A pre-existing loop is not caused by the edge being
 * proposed, so it does not by itself make the answer "yes".
 */
export async function wouldCreateCycle(
  employeeId: string,
  supervisorId: string,
): Promise<boolean> {
  if (employeeId === supervisorId) return true;

  let cursor: string | null = supervisorId;
  const seen = new Set<string>();

  while (cursor) {
    if (cursor === employeeId) return true;
    if (seen.has(cursor)) return false;
    seen.add(cursor);

    const rows: { supervisorId: string | null }[] = await db
      .select({ supervisorId: employees.supervisorId })
      .from(employees)
      .where(eq(employees.id, cursor))
      .limit(1);

    cursor = rows[0]?.supervisorId ?? null;
  }

  return false;
}
