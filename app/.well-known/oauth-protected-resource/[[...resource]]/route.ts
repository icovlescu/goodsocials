import { CORS, originOf, protectedResourceMetadata } from "@/lib/oauth/metadata";

/**
 * RFC 9728. Served at the bare path and at the path suffixed with the
 * resource (`/.well-known/oauth-protected-resource/api/mcp`), because clients
 * try both and there is only one resource to describe.
 */
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return Response.json(protectedResourceMetadata(originOf(request)), {
    headers: CORS,
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
