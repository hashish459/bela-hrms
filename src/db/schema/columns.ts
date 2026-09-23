/**
 * Column groups shared by several tables.
 *
 * Not re-exported from the schema index: these are fragments spread into table
 * definitions, not tables, and the schema object handed to Drizzle should hold
 * only the things it can query.
 */
import { isNull } from "drizzle-orm";
import { timestamp, text, type AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * Soft delete.
 *
 * A row with `deleted_at` set is in the recycle bin: every list, picker and
 * report leaves it out, and it can be restored until somebody purges it. The
 * rows that point at it keep working, because nothing was removed — which is
 * the point for a personnel system, where a record deleted by mistake takes
 * leave history, attendance and payroll references with it if the delete is
 * real.
 *
 * `deleted_by` is a label rather than a foreign key so the bin can say who
 * deleted a row after that login itself is gone.
 */
export const softDelete = {
  deletedAt: timestamp("deleted_at"),
  deletedBy: text("deleted_by"),
};

/** `deleted_at is null` for any table carrying `softDelete`. */
export const notDeleted = (table: { deletedAt: AnyPgColumn }) => isNull(table.deletedAt);
