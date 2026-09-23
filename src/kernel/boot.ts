import "server-only";

/**
 * Wiring. The one file that knows every module exists.
 *
 * Importing a module's `module.ts` runs its `register()` call. That is the whole
 * of installation: no container, no manifest scan, no lifecycle framework.
 * Removing a module from this list removes it from the product — the menu, the
 * ports, the event subscriptions — without editing anything else.
 *
 * Order does not matter. Registration only builds a port; nothing resolves
 * another module during boot, which is what allows a cycle-free graph even when
 * two modules reference each other's contracts.
 *
 * Import this once, from the authenticated layout. `boot()` is idempotent.
 */

import "@/modules/people/module";
import "@/modules/calendar/module";
import "@/modules/org/module";
import "@/modules/attendance/module";
import "@/modules/leave/module";
import "@/modules/payroll/module";
import "@/modules/notifications/module";

import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { moduleStates } from "@/db/schema/kernel";
import { cached, cacheTags, invalidate } from "./cache";
import { applyOrgModuleStates } from "./registry";

const globalForBoot = globalThis as unknown as { __erpBooted?: boolean };

/** Marks the registry as loaded. The imports above have already done the work. */
export function boot(): void {
  globalForBoot.__erpBooted = true;
}

boot();

/**
 * Loads an organisation's module switches into the registry.
 *
 * Called once per request from the session layer. A failure here must not fail
 * the request: if the table cannot be read, every module stays enabled, which is
 * the safe direction — a missing switch should not hide payroll.
 */
export async function loadModuleStates(orgId: string): Promise<void> {
  try {
    // Read on every request, switched a few times a year: cached, and dropped
    // the moment `setModuleEnabled` writes.
    const rows = await cached(
      `modules:${orgId}`,
      () =>
        db
          .select({ moduleId: moduleStates.moduleId, isEnabled: moduleStates.isEnabled })
          .from(moduleStates)
          .where(eq(moduleStates.orgId, orgId)),
      { ttl: 60, tags: [cacheTags.moduleStates(orgId), cacheTags.org(orgId)] },
    );
    applyOrgModuleStates(orgId, rows);
  } catch (error) {
    console.error("[kernel] could not load module states:", error);
  }
}

/** Switches a module on or off for one organisation. */
export async function setModuleEnabled(input: {
  orgId: string;
  moduleId: string;
  isEnabled: boolean;
  reason?: string | null;
  updatedBy?: string | null;
}): Promise<void> {
  await db
    .insert(moduleStates)
    .values({
      orgId: input.orgId,
      moduleId: input.moduleId,
      isEnabled: input.isEnabled,
      disabledReason: input.isEnabled ? null : (input.reason ?? null),
      updatedBy: input.updatedBy ?? null,
    })
    .onConflictDoUpdate({
      target: [moduleStates.orgId, moduleStates.moduleId],
      set: {
        isEnabled: input.isEnabled,
        disabledReason: input.isEnabled ? null : (input.reason ?? null),
        updatedBy: input.updatedBy ?? null,
        updatedAt: new Date(),
      },
    });

  invalidate(cacheTags.moduleStates(input.orgId));
  await loadModuleStates(input.orgId);
}

/** Reads the switches without touching the registry — for the settings screen. */
export async function moduleStateRows(orgId: string) {
  return db
    .select()
    .from(moduleStates)
    .where(and(eq(moduleStates.orgId, orgId)))
    .orderBy(moduleStates.moduleId);
}
