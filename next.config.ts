import type { NextConfig } from "next";

/**
 * NEXT_PUBLIC_BASE_PATH puts the whole app under a path, so the pivot product
 * runs as its own Vercel project at /v2 and goodsocials.co/v2 is a rewrite to
 * it (Next's multi-zones). lib/base-path.ts validates the same value.
 *
 * V2_ORIGIN, set on the root project only, is that rewrite: every /v2 request
 * goes to the v2 deployment, plus the two OAuth discovery paths that RFC 8414
 * and RFC 9728 put at the root of the host rather than under the base.
 * Nothing else is needed on the root project, because these rules ship in
 * this repo: deploying main there with V2_ORIGIN set is the whole step.
 */
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").trim().replace(/\/+$/, "");
const v2Origin = (process.env.V2_ORIGIN ?? "").trim().replace(/\/+$/, "");

const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),
  // The headline font is read from disk at runtime by lib/agent/headline.ts,
  // which any route that generates an image can reach.
  outputFileTracingIncludes: {
    "/**": ["./assets/fonts/*.ttf"],
  },
  async rewrites() {
    const rules = [];
    // On the v2 project's own host the root is not this app, so the
    // path-inserted discovery URLs (RFC 8414 section 3) cannot be answered
    // there. Clients fall back to {issuer}/.well-known/openid-configuration,
    // which app/.well-known/openid-configuration serves under the base. On the
    // root project the rules below send the path-inserted ones across.
    if (v2Origin && !basePath) {
      rules.push(
        { source: "/v2", destination: `${v2Origin}/v2` },
        { source: "/v2/:path*", destination: `${v2Origin}/v2/:path*` },
        {
          source: "/.well-known/oauth-authorization-server/v2",
          destination: `${v2Origin}/v2/.well-known/oauth-authorization-server`,
        },
        {
          source: "/.well-known/oauth-protected-resource/v2/:path*",
          destination: `${v2Origin}/v2/.well-known/oauth-protected-resource/:path*`,
        },
      );
    }
    return { beforeFiles: rules, afterFiles: [], fallback: [] };
  },
};

export default nextConfig;
