/**
 * Where this deployment lives under its host: "" for goodsocials.co itself,
 * "/v2" for the pivot product served at goodsocials.co/v2.
 *
 * One variable, NEXT_PUBLIC_BASE_PATH, read here and in next.config.ts. Next
 * prefixes <Link>, redirect(), the router and its own assets by itself; this
 * file is for everything it does not touch: plain anchors, fetch calls from
 * the browser, absolute URLs handed to LinkedIn, Stripe and OAuth clients,
 * and the canonical links in metadata.
 *
 * NEXT_PUBLIC_ so a client component reads the same value. It is a path, not
 * a secret.
 */

function normalize(raw: string | undefined): string {
  const value = (raw ?? "").trim().replace(/\/+$/, "");
  if (!value) return "";
  if (!/^\/[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/i.test(value)) {
    throw new Error(`NEXT_PUBLIC_BASE_PATH must look like /v2, not ${raw}`);
  }
  return value;
}

export const BASE_PATH = normalize(process.env.NEXT_PUBLIC_BASE_PATH);

/** A site path with the base in front: withBase("/signin") is "/v2/signin" on v2. */
export function withBase(path: string): string {
  if (!BASE_PATH) return path;
  if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`) || path.startsWith(`${BASE_PATH}?`)) {
    return path;
  }
  return `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * The pivot product: the member's own AI chat writes, the free tier is the
 * way in, and the landing page says so. On for the /v2 deployment, or for any
 * deployment with NEXT_PUBLIC_EDITION=v2.
 */
export function isPivot(): boolean {
  return BASE_PATH === "/v2" || process.env.NEXT_PUBLIC_EDITION === "v2";
}

/**
 * The absolute address of this app, for URLs that leave it: OAuth metadata,
 * LinkedIn and Stripe return addresses, the connector URL. From the request
 * by default, so a preview answers for itself.
 *
 * PUBLIC_ORIGIN overrides the host for a zone reached through another
 * domain's rewrite. When goodsocials.co/v2 rewrites to the v2 project, the
 * request arrives addressed to the v2 project's own host, and a return
 * address built from that would send a member's browser off goodsocials.co
 * and away from their cookies. Set PUBLIC_ORIGIN=https://goodsocials.co there.
 */
export function siteUrl(requestOrigin: string): string {
  const host = (process.env.PUBLIC_ORIGIN ?? "").trim().replace(/\/+$/, "") || requestOrigin;
  return `${host}${BASE_PATH}`;
}
