"use client";

/**
 * A script that must run while the HTML is still parsing — before React, before
 * first paint — such as the appearance bootstrap that stops a flash of the
 * wrong theme.
 *
 * A plain `<script>` in a component makes React warn on every client render
 * ("scripts inside React components are never executed"). The server renders
 * it as `text/javascript`, so the browser runs it during the initial parse; the
 * client renders it as `text/plain`, so React has nothing to warn about and
 * nothing re-executes on a soft navigation. `suppressHydrationWarning` absorbs
 * the difference in `type`. This is the pattern Next documents in
 * "Preventing flash before hydration".
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
