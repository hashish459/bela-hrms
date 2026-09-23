import "server-only";

import { and, asc, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { employees } from "@/db/schema/hr";
import { employeeDocuments } from "@/db/schema/selfservice";
import { addDays, daysUntil, todayInNepal } from "@/lib/bs";

/**
 * Document expiry — the reminder rule, stated once.
 *
 * A personnel document that has quietly expired is a compliance problem, not a
 * cosmetic one: an expired work permit or an expired contract means somebody is
 * working on paperwork that is no longer valid. The legacy system stored an
 * expiry date on `EmpDocumentInfo` and never read it, so the date was accurate
 * and useless.
 *
 * The rule lives here rather than in the page so the register, the employee
 * profile and the employee's own desk cannot disagree about what "expiring
 * soon" means.
 */

/** Documents are flagged this far ahead. Long enough to renew a passport. */
export const EXPIRY_WINDOW_DAYS = 60;

export type ExpiryState =
  /** Past its expiry date. */
  | "expired"
  /** Expires within the reminder window. */
  | "expiring"
  /** Valid, and not due for a while. */
  | "valid"
  /** No expiry recorded — a birth certificate does not expire. */
  | "none";

export function expiryState(expiresOn: string | null, today = todayInNepal()): ExpiryState {
  if (!expiresOn) return "none";
  const days = daysUntil(today, expiresOn);
  if (days < 0) return "expired";
  if (days <= EXPIRY_WINDOW_DAYS) return "expiring";
  return "valid";
}

/** Days until expiry; negative once it has passed. */
export function daysUntilExpiry(expiresOn: string | null, today = todayInNepal()): number | null {
  return expiresOn ? daysUntil(today, expiresOn) : null;
}

export const EXPIRY_TONE: Record<ExpiryState, "danger" | "warn" | "ok" | "neutral"> = {
  expired: "danger",
  expiring: "warn",
  valid: "ok",
  none: "neutral",
};

export function expiryLabel(state: ExpiryState, days: number | null) {
  if (state === "none") return "No expiry";
  if (days === null) return "No expiry";
  if (state === "expired") return `Expired ${Math.abs(days)}d ago`;
  if (days === 0) return "Expires today";
  return `${days}d left`;
}

/**
 * Counts for the register tiles.
 *
 * One query with filtered aggregates rather than four round trips. These are
 * organisation-wide by design: a count that changed as you paged through the
 * table would describe nothing.
 */
export async function documentDigest(orgId: string, today = todayInNepal()) {
  const horizon = addDays(today, EXPIRY_WINDOW_DAYS);

  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      expired: sql<number>`count(*) FILTER (WHERE ${employeeDocuments.expiresOn} < ${today})::int`,
      expiring: sql<number>`count(*) FILTER (WHERE ${employeeDocuments.expiresOn} >= ${today} AND ${employeeDocuments.expiresOn} <= ${horizon})::int`,
      pending: sql<number>`count(*) FILTER (WHERE ${employeeDocuments.status} = 'pending')::int`,
      missingFile: sql<number>`count(*) FILTER (WHERE ${employeeDocuments.fileId} IS NULL AND ${employeeDocuments.fileUrl} IS NULL)::int`,
    })
    .from(employeeDocuments)
    .where(and(eq(employeeDocuments.orgId, orgId), isNull(employeeDocuments.deletedAt)));

  return row ?? { total: 0, expired: 0, expiring: 0, pending: 0, missingFile: 0 };
}

/**
 * Everything expiring inside the window, plus everything already expired,
 * soonest first. Drives the reminder card.
 */
export async function expiringDocuments(orgId: string, limit = 8, today = todayInNepal()) {
  const horizon = addDays(today, EXPIRY_WINDOW_DAYS);

  return db
    .select({
      id: employeeDocuments.id,
      title: employeeDocuments.title,
      kind: employeeDocuments.kind,
      expiresOn: employeeDocuments.expiresOn,
      employeeId: employeeDocuments.employeeId,
      employeeName: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
      employeeCode: employees.employeeCode,
    })
    .from(employeeDocuments)
    .innerJoin(employees, eq(employees.id, employeeDocuments.employeeId))
    .where(
      and(
        eq(employeeDocuments.orgId, orgId),
        isNull(employeeDocuments.deletedAt),
        isNull(employees.deletedAt),
        isNotNull(employeeDocuments.expiresOn),
        lte(employeeDocuments.expiresOn, horizon),
      ),
    )
    .orderBy(asc(employeeDocuments.expiresOn))
    .limit(limit);
}
