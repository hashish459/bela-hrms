import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { employees } from "@/db/schema/hr";
import { employeeDocuments } from "@/db/schema/selfservice";
import { getFile } from "@/lib/storage";
import { can, getViewer } from "@/lib/session";

/**
 * Serving stored files.
 *
 * Every byte in the file table belongs to somebody's personnel record, so this
 * route answers one question before it answers anything else: may *this* viewer
 * see *this* file? The id being unguessable is not an answer — a document link
 * pasted into a group chat would then be a permanent, unauthenticated leak.
 *
 * Permission is derived from what the file is *used for*, not from the file
 * itself, because the same bytes can be a photograph on the directory and an
 * attachment on a confidential document at the same time. Each use grants
 * access independently and the most permissive one wins, which is the only
 * consistent reading: a face already visible in the staff directory does not
 * become secret because the same image was also filed as a document.
 */

/** Photographs are visible to anybody who can already see the staff directory. */
async function isOrgPhoto(orgId: string, fileId: string) {
  const [row] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.orgId, orgId), eq(employees.photoFileId, fileId)))
    .limit(1);
  return Boolean(row);
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!viewer) return new Response("Not found", { status: 404 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });

  // Scoped to the viewer's organisation, so a file belonging to another tenant
  // is indistinguishable from one that does not exist.
  const file = await getFile(viewer.orgId, id);
  if (!file) return new Response("Not found", { status: 404 });

  let allowed = await isOrgPhoto(viewer.orgId, id);

  if (!allowed) {
    const attachments = await db
      .select({
        employeeId: employeeDocuments.employeeId,
        isVisibleToEmployee: employeeDocuments.isVisibleToEmployee,
      })
      .from(employeeDocuments)
      .where(and(eq(employeeDocuments.orgId, viewer.orgId), eq(employeeDocuments.fileId, id)));

    if (attachments.length > 0) {
      const manages = can(viewer, "hr.document.manage");
      allowed = attachments.some(
        (a) =>
          manages ||
          // The employee's own file, and filed as visible to them. An HR-only
          // note on somebody's record stays HR-only even for its subject.
          (viewer.employeeId !== null &&
            a.employeeId === viewer.employeeId &&
            a.isVisibleToEmployee),
      );
    } else if (file.uploadedBy === viewer.userId) {
      // Uploaded but not yet attached — the form that created it is still open.
      allowed = true;
    }
  }

  if (!allowed) return new Response("Not found", { status: 404 });

  /*
   * The stored content type came from sniffing the bytes on upload, never from
   * the browser, and `nosniff` stops the browser second-guessing it. The CSP is
   * belt and braces for PDFs, which can carry script: it applies to the
   * document only when it is opened directly at this URL.
   */
  const etag = `"${file.sha256}"`;

  const headers = new Headers({
    "Content-Type": file.contentType,
    "Content-Disposition": `inline; filename="${file.fileName}"`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    /*
     * `no-cache` means "you may store this, but revalidate before every reuse".
     * It is not `no-store`, and the distinction is the whole point.
     *
     * The bytes are immutable for a given id — the row is content-addressed by
     * sha256 and never rewritten — but the *permission* to see them is not, and
     * an HTTP cache is keyed by URL alone. With `max-age=3600` the browser would
     * reuse this response without asking, so on a shared computer the next
     * person to sign in could read the previous person's personnel documents out
     * of the cache for an hour, and a revoked grant would not bite until it
     * expired. Both were reproduced here before this was changed.
     *
     * Revalidation is cheap: the conditional request below returns a 304 with no
     * body whenever the file is unchanged, which it always is.
     */
    "Cache-Control": "private, no-cache, must-revalidate",
    // Two users must not share a cache entry even if an intermediary ignores
    // `private` — this response varies by who is asking.
    Vary: "Cookie",
    ETag: etag,
  });

  /*
   * Answered only after the permission check above, never before it. A 304 is a
   * statement that the requester may have this file and their copy is current;
   * returning one straight off the `If-None-Match` would leak existence to
   * anybody who guessed an id and a hash.
   */
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }

  headers.set("Content-Length", String(file.byteSize));
  return new Response(new Uint8Array(file.content), { status: 200, headers });
}
