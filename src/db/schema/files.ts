/**
 * Binary storage for employee photographs and documents.
 *
 * The bytes live in Postgres, and that is a deliberate trade rather than an
 * oversight.
 *
 * This deploys as three containers on one VPS. Object storage would mean an S3
 * account or a MinIO container, a second set of credentials, a second backup
 * job, a second thing to get wrong in the firewall, and a lifecycle where a
 * `pg_restore` brings back rows pointing at files that are no longer there.
 * Keeping the bytes in the database means `deploy/backup.sh` already captures
 * them and a restore is consistent by construction.
 *
 * The arithmetic that makes it safe: 459 employees (the real headcount from the
 * recovered production database), a photograph and perhaps six documents each,
 * capped at 5 MB per file — realistically well under 1 GB in total, against a
 * database that is currently 15 MB. `EmpDocumentInfo` in production held 1,000
 * rows after ten years of use.
 *
 * **When to move this out:** if the store passes a few GB, if files start being
 * served to anonymous users, or if a CDN becomes necessary. At that point the
 * `fileId` foreign keys stay and only `storage.ts` changes — which is why the
 * bytes are isolated in their own table behind a small module rather than as a
 * column on `employees`.
 *
 * Large objects (`lo_*`) are deliberately not used: they need explicit cleanup,
 * are awkward to back up selectively, and 5 MB is far below the 1 GB `bytea`
 * limit.
 */
import { relations } from "drizzle-orm";
import {
  bigint,
  index,
  pgTable,
  customType,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "./core";

/**
 * `bytea`, typed as a Node Buffer.
 *
 * Drizzle has no first-class bytea, and the alternative — base64 in a text
 * column — is a third larger on disk and forces an encode/decode on every read.
 */
const bytea = customType<{ data: Buffer; notNull: true; default: false }>({
  dataType() {
    return "bytea";
  },
});

/**
 * One uploaded file.
 *
 * Content-addressed by `sha256` so the same scanned citizenship certificate
 * attached twice is stored once, and so an upload can be verified as intact.
 */
export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    /** As uploaded. Shown to the user; never used to build a path. */
    fileName: text("file_name").notNull(),
    /**
     * Sniffed from the bytes, not taken from the browser. A client-supplied
     * content type is a suggestion, and serving it back verbatim is how an
     * uploaded .html becomes a stored cross-site scripting payload.
     */
    contentType: text("content_type").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),

    content: bytea("content").notNull(),

    uploadedBy: text("uploaded_by"),
    uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  },
  (t) => [
    index("files_org_idx").on(t.orgId),
    // Not unique: two organisations may legitimately hold identical bytes, and
    // tenancy must not be inferable from an upload colliding.
    index("files_sha_idx").on(t.orgId, t.sha256),
  ],
);

export const filesRelations = relations(files, ({ one }) => ({
  organization: one(organizations, { fields: [files.orgId], references: [organizations.id] }),
}));
