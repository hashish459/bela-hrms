import type { Metadata } from "next";
import {
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  IBM_Plex_Serif,
  Inter,
  Lato,
  Merriweather,
  Mukta,
  Noto_Sans,
  Noto_Sans_Devanagari,
  Nunito,
  Open_Sans,
  Poppins,
  Roboto,
  Source_Sans_3,
} from "next/font/google";
import "./globals.css";
import { APP } from "@/lib/branding";
import { APPEARANCE_BOOTSTRAP } from "@/lib/appearance";
import { InlineScript } from "@/components/inline-script";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const plexSerif = IBM_Plex_Serif({
  variable: "--font-plex-serif",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

/*
  The optional typefaces from Administration › Appearance. `preload: false`
  keeps them off the critical path: the browser fetches a face only once the
  person has chosen it and text actually uses it. (next/font needs each
  options object written out literally — it is compiled, not evaluated.)
*/
const inter = Inter({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-inter" });
const roboto = Roboto({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-roboto", weight: ["400", "500", "700"] });
const openSans = Open_Sans({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-open-sans" });
const sourceSans = Source_Sans_3({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-source-sans" });
const lato = Lato({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-lato", weight: ["400", "700"] });
const nunito = Nunito({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-nunito" });
const poppins = Poppins({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-poppins", weight: ["400", "500", "600"] });
const mukta = Mukta({ display: "swap", preload: false, subsets: ["latin", "devanagari"], variable: "--font-mukta", weight: ["400", "500", "600"] });
const notoSans = Noto_Sans({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-noto-sans" });
const notoDevanagari = Noto_Sans_Devanagari({ display: "swap", preload: false, subsets: ["devanagari"], variable: "--font-noto-devanagari" });
const merriweather = Merriweather({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-merriweather", weight: ["400", "700"] });

const optionalFonts = [inter, roboto, openSans, sourceSans, lato, nunito, poppins, mukta, notoSans, notoDevanagari, merriweather]
  .map((f) => f.variable)
  .join(" ");

export const metadata: Metadata = {
  title: {
    default: APP.name,
    template: `%s · ${APP.name}`,
  },
  description: APP.tagline,
  applicationName: APP.name,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${plexSerif.variable} ${plexMono.variable} ${optionalFonts} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* applies saved appearance before first paint — no flash of the wrong theme */}
        <InlineScript html={APPEARANCE_BOOTSTRAP} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
