import { CORS } from "@/lib/oauth/metadata";
import { registerClient } from "@/lib/oauth/server";

/**
 * Dynamic client registration, RFC 7591. Claude calls this the first time a
 * member adds the connector. Registering grants nothing on its own.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const result = await registerClient(body);
  if (!result.ok) {
    return Response.json(
      { error: result.error, error_description: result.description },
      { status: 400, headers: CORS },
    );
  }

  const { client } = result;
  return Response.json(
    {
      client_id: client.clientId,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    { status: 201, headers: CORS },
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
