"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Camera, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { downscale } from "./[id]/photo-upload";

/**
 * The photograph for a new employee, chosen before the record exists.
 *
 * The image is downscaled in the browser exactly as on the profile, then put
 * back into the form's own file input — so it travels with the rest of the
 * form in one submit and the save action stores it alongside the record.
 */
export function PhotoPicker({ error }: { error?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  function pick(file: File | undefined) {
    if (!file || !input.current) return;
    setProblem(null);
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setProblem("Choose a JPEG, PNG or WebP image.");
      input.current.value = "";
      return;
    }
    start(async () => {
      const resized = await downscale(file);
      const dt = new DataTransfer();
      dt.items.add(resized);
      if (input.current) input.current.files = dt.files;
      setPreview(URL.createObjectURL(resized));
    });
  }

  function clear() {
    if (input.current) input.current.value = "";
    setPreview(null);
    setProblem(null);
  }

  const message = problem ?? error;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="group relative grid size-24 place-items-center overflow-hidden rounded-full border-2 border-dashed border-line bg-sunk text-ink-faint transition-colors hover:border-accent hover:text-accent"
        aria-label={preview ? "Replace photograph" : "Add a photograph"}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="size-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-1 text-[10px]">
            <ImagePlus className="size-6" aria-hidden />
            Add photo
          </span>
        )}
        {pending ? (
          <span className="absolute inset-0 grid place-items-center bg-ink/40">
            <Loader2 className="size-5 animate-spin text-white" />
          </span>
        ) : preview ? (
          <span className="absolute inset-x-0 bottom-0 grid place-items-center bg-ink/50 py-1 opacity-0 transition-opacity group-hover:opacity-100">
            <Camera className="size-3.5 text-white" aria-hidden />
          </span>
        ) : null}
      </button>
      <input
        ref={input}
        type="file"
        name="photo"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => pick(e.target.files?.[0])}
      />
      {preview ? (
        <button type="button" onClick={clear} className="inline-flex items-center gap-1 text-[11px] text-ink-faint hover:text-danger">
          <Trash2 className="size-3" aria-hidden />
          Remove
        </button>
      ) : (
        <span className="text-[10px] text-ink-faint">JPEG, PNG or WebP</span>
      )}
      {message ? <p className="max-w-40 text-center text-[11px] text-danger">{message}</p> : null}
    </div>
  );
}
