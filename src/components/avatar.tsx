import { cn } from "@/lib/utils";

/**
 * An employee's face, or a legible stand-in for it.
 *
 * Every list that shows people uses this, so a record without a photograph
 * never leaves a hole in the layout. The initials are tinted from a hash of the
 * employee's own id: stable across renders and across pages, so the same person
 * is the same colour everywhere, which is what makes a long list scannable
 * before anybody has read a name.
 */

const SIZES = {
  xs: "size-6 text-[10px]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-16 text-lg",
  xl: "size-24 text-2xl",
} as const;

export type AvatarSize = keyof typeof SIZES;

/**
 * Six tints drawn from the palette already in `globals.css`, so a directory
 * page cannot introduce a colour the rest of the product does not use.
 */
const TINTS = [
  "bg-accent-soft text-accent",
  "bg-info-soft text-info",
  "bg-ok-soft text-ok",
  "bg-warn-soft text-warn",
  "bg-danger-soft text-danger",
  "bg-sunk text-ink-soft",
] as const;

function tintOf(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return TINTS[hash % TINTS.length];
}

export function initialsOf(first: string, last: string) {
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase() || "?";
}

export function Avatar({
  photoId,
  photoUrl,
  firstName,
  lastName,
  seed,
  size = "md",
  className,
}: {
  /** An uploaded file id; takes precedence over a legacy hosted URL. */
  photoId?: string | null;
  photoUrl?: string | null;
  firstName: string;
  lastName: string;
  /** Usually the employee id, so the tint follows the person, not the name. */
  seed?: string;
  size?: AvatarSize;
  className?: string;
}) {
  const src = photoId ? `/api/files/${photoId}` : (photoUrl ?? null);
  const base = cn(
    "shrink-0 overflow-hidden rounded-full ring-1 ring-line-soft",
    SIZES[size],
    className,
  );

  if (src) {
    return (
      /*
       * A plain <img>, not next/image. These are private files behind a session
       * check on /api/files — the optimiser would have to fetch them itself,
       * unauthenticated, and would then cache a personnel photograph in a shared
       * on-disk cache. Photographs are downscaled in the browser before upload,
       * so there is nothing left for the optimiser to do.
       */
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={`${firstName} ${lastName}`}
        className={cn(base, "bg-sunk object-cover")}
        loading="lazy"
        decoding="async"
      />
    );
  }

  return (
    <span
      className={cn(base, "grid place-items-center font-semibold", tintOf(seed ?? firstName + lastName))}
      aria-hidden
    >
      {initialsOf(firstName, lastName)}
    </span>
  );
}
