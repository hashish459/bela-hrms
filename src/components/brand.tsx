import Image from "next/image";
import { APP } from "@/lib/branding";
import { cn } from "@/lib/utils";

import logo from "../../public/brand/bela-logo.png";

/**
 * The company mark.
 *
 * Imported as a static asset so Next can serve a correctly sized, optimised
 * image — the source file is 2241×1725, far larger than any place it is shown.
 * `priority` on the large variants keeps it out of the lazy-loading queue, since
 * it is the first thing on the login screen.
 */
export function BrandMark({
  size = "sm",
  className,
}: {
  size?: "xs" | "sm" | "lg";
  className?: string;
}) {
  const box = { xs: 24, sm: 30, lg: 84 }[size];
  return (
    <Image
      src={logo}
      alt={`${APP.company} logo`}
      width={box}
      height={Math.round((box * 1725) / 2241)}
      priority={size === "lg"}
      className={cn("h-auto w-auto object-contain", className)}
      style={{ maxHeight: box }}
      sizes={`${box}px`}
    />
  );
}

/** Logo plus wordmark, for the header and the mobile drawer. */
export function BrandLockup({
  size = "sm",
  subtitle,
  className,
}: {
  size?: "sm" | "lg";
  subtitle?: string;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <BrandMark size={size === "lg" ? "lg" : "sm"} />
      <span className="flex flex-col leading-none">
        <span
          className={cn(
            "font-semibold tracking-tight text-ink",
            size === "lg" ? "text-base" : "text-sm",
          )}
        >
          {APP.name}
        </span>
        {subtitle ? (
          <span className="mt-0.5 text-[11px] text-ink-faint">{subtitle}</span>
        ) : null}
      </span>
    </span>
  );
}
