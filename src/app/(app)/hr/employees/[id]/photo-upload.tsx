"use client";

import { useRef, useState, useTransition } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { removeEmployeePhoto, uploadEmployeePhoto } from "../actions";

/**
 * The photograph control on the employee profile.
 *
 * The image is resized **in the browser** before it is sent. A photograph taken
 * on a phone is three to six megabytes; the profile renders it at 96 pixels. The
 * alternative is a native image library on the server — `sharp` is a compiled
 * dependency that has to match the deployment architecture, and the one thing
 * this deployment should not need is a native build step on a small VPS.
 *
 * A canvas resize costs nothing, runs where the file already is, and turns a
 * 4 MB upload into roughly 40 KB. The server still validates size and sniffs
 * the bytes, because a request that did not come from this component is not
 * bound by anything decided here.
 */

/** Generous for a 96 px avatar, so the image survives a future larger layout. */
const MAX_EDGE = 512;
const JPEG_QUALITY = 0.85;

export async function downscale(file: File): Promise<File> {
  // A browser that cannot do this sends the original; the server limit still
  // applies, so the worst case is a rejected upload with a clear message.
  if (typeof createImageBitmap !== "function") return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;

  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  if (!blob) return file;

  // Only keep the re-encode if it actually helped. A small, already-optimised
  // PNG can come out larger as a JPEG.
  if (blob.size >= file.size && scale === 1) return file;

  return new File([blob], file.name.replace(/\.[^.]*$/, "") + ".jpg", { type: "image/jpeg" });
}

export function PhotoUpload({
  employeeId,
  photoId,
  photoUrl,
  firstName,
  lastName,
  canEdit,
}: {
  employeeId: string;
  photoId: string | null;
  photoUrl: string | null;
  firstName: string;
  lastName: string;
  canEdit: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /** Shown immediately so the new face appears before the round trip finishes. */
  const [preview, setPreview] = useState<string | null>(null);

  function pick(file: File | undefined) {
    if (!file) return;
    setError(null);

    start(async () => {
      const resized = await downscale(file);

      const objectUrl = URL.createObjectURL(resized);
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return objectUrl;
      });

      const body = new FormData();
      body.set("photo", resized);
      const result = await uploadEmployeePhoto(employeeId, { ok: true }, body);

      if (!result.ok) {
        setError(result.message ?? "That upload failed.");
        setPreview((old) => {
          if (old) URL.revokeObjectURL(old);
          return null;
        });
      }
    });
  }

  function remove() {
    setError(null);
    start(async () => {
      const result = await removeEmployeePhoto(employeeId);
      if (!result.ok) setError(result.message ?? "That did not work.");
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return null;
      });
    });
  }

  const hasPhoto = Boolean(preview ?? photoId ?? photoUrl);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt=""
            className="size-24 shrink-0 rounded-full object-cover ring-1 ring-line-soft"
          />
        ) : (
          <Avatar
            photoId={photoId}
            photoUrl={photoUrl}
            firstName={firstName}
            lastName={lastName}
            seed={employeeId}
            size="xl"
          />
        )}

        {pending ? (
          <span className="absolute inset-0 grid place-items-center rounded-full bg-ink/40">
            <Loader2 className="size-5 animate-spin text-white" />
          </span>
        ) : null}

        {canEdit ? (
          <>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={pending}
              title={hasPhoto ? "Replace photograph" : "Add a photograph"}
              className="absolute -right-0.5 -bottom-0.5 grid size-8 place-items-center rounded-full border border-line bg-surface text-ink-soft shadow-sm transition-colors hover:bg-sunk hover:text-ink disabled:opacity-50"
            >
              <Camera className="size-4" />
              <span className="sr-only">{hasPhoto ? "Replace photograph" : "Add a photograph"}</span>
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                pick(e.target.files?.[0]);
                // Reset so choosing the same file twice still fires a change.
                e.target.value = "";
              }}
            />
          </>
        ) : null}
      </div>

      {canEdit && hasPhoto ? (
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          className="inline-flex items-center gap-1 text-[11px] text-ink-faint hover:text-danger disabled:opacity-50"
        >
          <Trash2 className="size-3" />
          Remove
        </button>
      ) : null}

      {error ? <p className="max-w-40 text-center text-[11px] text-danger">{error}</p> : null}
    </div>
  );
}
