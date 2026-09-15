/**
 * Appearance preferences.
 *
 * Personal, per-browser settings — theme, typeface, text size, density, accent.
 * They are applied as data-attributes on <html>, which the token layers in
 * globals.css key off; no component reads a preference directly.
 *
 * Kept out of the database on purpose: this is how one person likes to look at
 * the screen, not a fact about the organisation. It needs to apply before the
 * first paint, on every device, without a round trip.
 */

export const THEMES = ["system", "light", "dark"] as const;
export const FONTS = ["sans", "serif", "system"] as const;
export const SIZES = ["sm", "md", "lg", "xl"] as const;
export const DENSITIES = ["comfortable", "compact"] as const;
export const CONTRASTS = ["normal", "high"] as const;
export const ACCENTS = ["teal", "brand", "blue", "indigo", "amber", "rose"] as const;

export type Theme = (typeof THEMES)[number];
export type Font = (typeof FONTS)[number];
export type Size = (typeof SIZES)[number];
export type Density = (typeof DENSITIES)[number];
export type Contrast = (typeof CONTRASTS)[number];
export type Accent = (typeof ACCENTS)[number];

export type Appearance = {
  theme: Theme;
  font: Font;
  size: Size;
  density: Density;
  contrast: Contrast;
  accent: Accent;
};

export const DEFAULT_APPEARANCE: Appearance = {
  theme: "system",
  font: "sans",
  size: "md",
  density: "comfortable",
  contrast: "normal",
  accent: "teal",
};

export const APPEARANCE_KEY = "bela-hrms.appearance";

export const ACCENT_SWATCH: Record<Accent, string> = {
  teal: "#0f6e63",
  brand: "#e8722a",
  blue: "#1f5fa8",
  indigo: "#4b46a8",
  amber: "#9a6410",
  rose: "#a33b58",
};

export const ACCENT_LABEL: Record<Accent, string> = {
  teal: "Teal",
  brand: "Bela orange",
  blue: "Blue",
  indigo: "Indigo",
  amber: "Amber",
  rose: "Rose",
};

export const FONT_LABEL: Record<Font, string> = {
  sans: "IBM Plex Sans",
  serif: "IBM Plex Serif",
  system: "System default",
};

export const SIZE_LABEL: Record<Size, string> = {
  sm: "Small (13px)",
  md: "Default (14px)",
  lg: "Large (15px)",
  xl: "Largest (16px)",
};

export function parseAppearance(raw: string | null): Appearance {
  if (!raw) return DEFAULT_APPEARANCE;
  try {
    const parsed = JSON.parse(raw) as Partial<Appearance>;
    return {
      theme: THEMES.includes(parsed.theme as Theme) ? (parsed.theme as Theme) : DEFAULT_APPEARANCE.theme,
      font: FONTS.includes(parsed.font as Font) ? (parsed.font as Font) : DEFAULT_APPEARANCE.font,
      size: SIZES.includes(parsed.size as Size) ? (parsed.size as Size) : DEFAULT_APPEARANCE.size,
      density: DENSITIES.includes(parsed.density as Density)
        ? (parsed.density as Density)
        : DEFAULT_APPEARANCE.density,
      contrast: CONTRASTS.includes(parsed.contrast as Contrast)
        ? (parsed.contrast as Contrast)
        : DEFAULT_APPEARANCE.contrast,
      accent: ACCENTS.includes(parsed.accent as Accent)
        ? (parsed.accent as Accent)
        : DEFAULT_APPEARANCE.accent,
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

/** Writes the preferences onto <html>. Safe to call repeatedly. */
export function applyAppearance(a: Appearance, root: HTMLElement): void {
  if (a.theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", a.theme);

  root.setAttribute("data-font", a.font);
  root.setAttribute("data-size", a.size);
  root.setAttribute("data-density", a.density);
  root.setAttribute("data-contrast", a.contrast);
  root.setAttribute("data-accent", a.accent);
}

/**
 * Runs in <head> before the first paint, so nobody sees a light flash on the way
 * to a dark theme. Inlined as a string because it has to execute synchronously,
 * ahead of the bundle.
 */
export const APPEARANCE_BOOTSTRAP = `
(function () {
  try {
    var raw = localStorage.getItem(${JSON.stringify(APPEARANCE_KEY)});
    var a = raw ? JSON.parse(raw) : {};
    var r = document.documentElement;
    if (a.theme === "light" || a.theme === "dark") r.setAttribute("data-theme", a.theme);
    r.setAttribute("data-font", a.font || "sans");
    r.setAttribute("data-size", a.size || "md");
    r.setAttribute("data-density", a.density || "comfortable");
    r.setAttribute("data-contrast", a.contrast || "normal");
    r.setAttribute("data-accent", a.accent || "teal");
  } catch (e) {
    /* defaults in the stylesheet already cover this */
  }
})();
`.trim();
