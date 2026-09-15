"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLog, userAccounts } from "@/db/schema/core";
import { getViewer } from "@/lib/session";

/**
 * Stamps the sign-in.
 *
 * Called by the login page once Better Auth has issued a session, rather than on
 * every request: `getViewer` runs on every page load and must stay read-only.
 * The viewer is resolved server-side from the new session cookie, so the client
 * cannot claim to be somebody else.
 */
export async function recordSignIn(): Promise<void> {
  const viewer = await getViewer();
  if (!viewer) return;

  await db
    .update(userAccounts)
    .set({ lastLoginAt: new Date() })
    .where(eq(userAccounts.userId, viewer.userId));

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "login",
    entityType: "session",
    summary: `${viewer.name} signed in`,
  });
}
