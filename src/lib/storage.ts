import "server-only";

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { files } from "@/db/schema/files";

/**
 * Uploads: validate, sniff, deduplicate, store.
 *
 * Everything that writes a file goes through `putFile`, so the rules below are
 * stated once rather than re-implemented per upload form — which is how one
 * form ends up accepting the thing every other form rejects.
 */

/** Photographs. Small, because the client downscales before sending. */
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
/** Scanned documents. A colour A4 scan at 300 dpi lands well inside this. */
export const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Accepted types, keyed by what the *bytes* say.
 *
 * Deliberately narrow: images and PDFs. Those are what a scanned personnel
 * document is, they render in a browser, and they cannot carry a macro.
 *
 * Office formats are excluded on purpose. A .docx is a ZIP archive, so it
 * sniffs identically to a .jar or an .apk — accepting it means either trusting
 * the extension (which is trusting the uploader) or parsing the archive. The
 * signed contract that matters is the scan, not the editable draft.
 */
const SIGNATURES: { type: string; ext: string; match: (b: Buffer) => boolean }[] = [
  { type: "image/jpeg", ext: "jpg", match: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    type: "image/png",
    ext: "png",
    match: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    type: "image/webp",
    ext: "webp",
    match: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  },
  { type: "application/pdf", ext: "pdf", match: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
];

export const ACCEPT_IMAGES = "image/jpeg,image/png,image/webp";
export const ACCEPT_DOCUMENTS = "image/jpeg,image/png,image/webp,application/pdf";

export type StoredFile = {
  id: string;
  fileName: string;
  contentType: string;
  byteSize: number;
};

export type UploadResult = { ok: true; file: StoredFile } | { ok: false; error: string };

/**
 * Detect the type from the leading bytes.
 *
 * The browser's `File.type` is not consulted. It is attacker-controlled on any
 * request that did not come from our own form, and echoing it back from the
 * download route is precisely how an uploaded `.html` becomes a stored
 * cross-site scripting payload served from our own origin.
 */
function sniff(bytes: Buffer) {
  return SIGNATURES.find((s) => s.match(bytes)) ?? null;
}

/** Strip anything that could escape a filename when it is echoed in a header. */
function safeName(name: string, ext: string) {
  const base = (name.split(/[\/]/).pop() ?? "file")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const stem = base.replace(/\.[^.]*$/, "") || "file";
  return `${stem}.${ext}`;
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Store an upload and return its id.
 *
 * Identical bytes already held by the same organisation are reused rather than
 * stored twice — the same scanned citizenship certificate is routinely attached
 * as both "citizenship" and as proof of date of birth.
 *
 * The scope is the organisation, never the whole table: a global dedupe would
 * let one tenant discover that another holds a particular file by watching
 * whether their own upload created a row.
 */
export async function putFile(opts: {
  orgId: string;
  uploadedBy: string | null;
  file: File;
  maxBytes: number;
  /** Restrict further than the global list — photographs may not be PDFs. */
  allow?: readonly string[];
}): Promise<UploadResult> {
  const { orgId, file, maxBytes } = opts;

  if (!file || file.size === 0) return { ok: false, error: "Choose a file to upload." };
  if (file.size > maxBytes) {
    return { ok: false, error: `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(maxBytes)}.` };
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // Re-check after reading: `File.size` is a claim until the bytes are counted.
  if (bytes.byteLength > maxBytes) {
    return { ok: false, error: `That file is larger than ${formatBytes(maxBytes)}.` };
  }

  const kind = sniff(bytes);
  if (!kind) {
    return { ok: false, error: "Only JPEG, PNG, WebP and PDF files can be uploaded." };
  }
  if (opts.allow && !opts.allow.includes(kind.type)) {
    return { ok: false, error: "That file type is not accepted here." };
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const [existing] = await db
    .select({
      id: files.id,
      fileName: files.fileName,
      contentType: files.contentType,
      byteSize: files.byteSize,
    })
    .from(files)
    .where(and(eq(files.orgId, orgId), eq(files.sha256, sha256)))
    .limit(1);

  if (existing) return { ok: true, file: existing };

  const [row] = await db
    .insert(files)
    .values({
      orgId,
      fileName: safeName(file.name, kind.ext),
      contentType: kind.type,
      byteSize: bytes.byteLength,
      sha256,
      content: bytes,
      uploadedBy: opts.uploadedBy,
    })
    .returning({
      id: files.id,
      fileName: files.fileName,
      contentType: files.contentType,
      byteSize: files.byteSize,
    });

  return { ok: true, file: row };
}

/** Read a file back. Authorisation is the caller's job — see the download route. */
export async function getFile(orgId: string, id: string) {
  const [row] = await db
    .select()
    .from(files)
    .where(and(eq(files.id, id), eq(files.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

/** The URL the browser fetches a stored file from. */
export function fileHref(id: string) {
  return `/api/files/${id}`;
}

/**
 * Delete a file, but only once nothing points at it.
 *
 * Replacing a photograph or a document scan leaves the old bytes behind, and
 * without this the table only ever grows. The reference check is not optional:
 * `putFile` deduplicates, so the row being replaced on one record may be the
 * very same row still in use by another.
 *
 * Imported here rather than at the top of the file to keep the storage layer
 * free of a compile-time dependency on the tables that happen to use it — a new
 * consumer adds a clause here and nothing else changes.
 */
export async function dropIfUnreferenced(fileId: string | null | undefined) {
  if (!fileId) return;

  const { employees } = await import("@/db/schema/hr");
  const { employeeDocuments } = await import("@/db/schema/selfservice");

  const [photo] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(eq(employees.photoFileId, fileId))
    .limit(1);
  if (photo) return;

  const [doc] = await db
    .select({ id: employeeDocuments.id })
    .from(employeeDocuments)
    .where(eq(employeeDocuments.fileId, fileId))
    .limit(1);
  if (doc) return;

  await db.delete(files).where(eq(files.id, fileId));
}
