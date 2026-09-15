import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Emits `.next/standalone`: a self-contained server with only the modules the
   * build actually reached, so the runtime image carries neither `node_modules`
   * nor the toolchain. It takes the deployed image from roughly 1.2 GB to under
   * 200 MB, which on a private VPS is the difference between a deploy that
   * finishes and one that fills the disk.
   */
  output: "standalone",

  experimental: {
    // lets requirePermission() answer a real 403 with forbidden.tsx instead of
    // surfacing an authorization failure as a 500
    authInterrupts: true,
  },

  /**
   * The reverse proxy in front of this terminates TLS and is the only thing that
   * should be describing the server. Next's own header leaks the framework and
   * its version to anybody running a scanner.
   */
  poweredByHeader: false,

  /**
   * Security headers applied at the edge of the application rather than only in
   * the proxy, so they survive a proxy being replaced or bypassed.
   *
   * No CSP here on purpose: Next injects inline bootstrap scripts, so a useful
   * policy needs nonces threaded through the document, and a policy that has to
   * allow 'unsafe-inline' to work is a policy that provides nothing while
   * implying protection. It belongs in a change of its own.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          // Told to the browser only over HTTPS; harmless on plain HTTP.
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
