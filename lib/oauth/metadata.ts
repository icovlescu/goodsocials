import { OAUTH_SCOPE } from "@/lib/oauth/server";

/**
 * The two discovery documents the MCP authorization spec asks for, built from
 * the request's own origin. No file hardcodes a host (CLAUDE.md, Domains), so
 * a preview deployment is its own authorization server and production is
 * goodsocials.co.
 */

export const MCP_PATH = "/api/mcp";

export function originOf(request: Request): string {
  return new URL(request.url).origin;
}

/** RFC 8414. */
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [OAUTH_SCOPE],
    service_documentation: `${origin}/docs#claude`,
  };
}

/** RFC 9728. */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}${MCP_PATH}`,
    authorization_servers: [origin],
    scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "GoodSocials",
    resource_documentation: `${origin}/docs#claude`,
  };
}

/** Discovery is read by apps from any origin, so it is open to all of them. */
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
};
