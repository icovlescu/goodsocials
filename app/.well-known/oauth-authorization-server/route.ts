import { CORS, authorizationServerMetadata, originOf } from "@/lib/oauth/metadata";

/** Where Claude learns how to sign in to GoodSocials. RFC 8414. */
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return Response.json(authorizationServerMetadata(originOf(request)), {
    headers: CORS,
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
