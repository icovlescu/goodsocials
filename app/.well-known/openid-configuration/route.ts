import { CORS, authorizationServerMetadata, originOf } from "@/lib/oauth/metadata";

/**
 * The same document as oauth-authorization-server, at the name MCP clients
 * try last: {issuer}/.well-known/openid-configuration. It is the one discovery
 * URL that stays under the base path, so a deployment at /v2 is found even
 * where nothing answers at the root of the host. No ID tokens are issued;
 * clients read only the endpoints.
 */
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return Response.json(authorizationServerMetadata(originOf(request)), { headers: CORS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
