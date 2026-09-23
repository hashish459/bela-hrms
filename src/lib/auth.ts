import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db/client";
import { account, session, user, verification } from "@/db/schema/auth";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  emailAndPassword: {
    enabled: true,
    // Left on for the library, because Administration › Users creates logins
    // through `auth.api.signUpEmail` on the server. The public HTTP route is
    // closed below — this is an internal system, and a login nobody created is
    // a login nobody audits.
    disableSignUp: false,
    minPasswordLength: 8,
    requireEmailVerification: false,
  },
  session: {
    expiresIn: 60 * 60 * 8, // a working day
    updateAge: 60 * 60,
    cookieCache: { enabled: true, maxAge: 60 },
  },
  /*
   * The router refuses these paths outright (404) while the server-side API
   * keeps them. Without it anybody on the network could POST to
   * /api/auth/sign-up/email and mint themselves an auth user.
   */
  disabledPaths: ["/sign-up/email"],
  /*
   * Brute-force protection on sign-in, always on — the library default only
   * enables it in production, and a staging box on the office network is just
   * as reachable. Per client IP; behind Caddy the address comes from
   * X-Forwarded-For, which Caddy sets and overwrites.
   */
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/change-password": { window: 60, max: 5 },
      "/get-session": false,
    },
  },
  advanced: {
    ipAddress: { ipAddressHeaders: ["x-forwarded-for", "x-real-ip"] },
  },
  plugins: [nextCookies()],
});

export type Auth = typeof auth;
