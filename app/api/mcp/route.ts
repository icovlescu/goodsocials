import { CORS, originOf } from "@/lib/oauth/metadata";
import { memberForToken } from "@/lib/oauth/server";
import { handleMessage, rpcError } from "@/lib/mcp/server";

/**
 * The connector. The URL a member pastes into Claude, ChatGPT or any other
 * chat that supports remote MCP servers is this route on goodsocials.co. Without a token it answers 401 and points at the discovery
 * document, which is how Claude finds the sign in.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** publish_now runs the LinkedIn upload and post inside the call. */
export const maxDuration = 60;

function unauthorized(request: Request, description: string) {
  const metadata = `${originOf(request)}/.well-known/oauth-protected-resource/api/mcp`;
  return Response.json(
    { error: "invalid_token", error_description: description },
    {
      status: 401,
      headers: {
        ...CORS,
        "WWW-Authenticate": `Bearer resource_metadata="${metadata}", error="invalid_token", error_description="${description}"`,
      },
    },
  );
}

export async function POST(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return unauthorized(request, "Sign in to GoodSocials to use this connector.");

  const memberId = await memberForToken(token);
  if (!memberId) return unauthorized(request, "The token is expired or was revoked.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(rpcError(null, -32700, "The body is not JSON."), {
      status: 400,
      headers: CORS,
    });
  }

  const messages = Array.isArray(body) ? body : [body];
  const answers = [];
  for (const message of messages) {
    const answer = await handleMessage({ memberId, origin: originOf(request) }, message);
    if (answer) answers.push(answer);
  }

  // Only notifications: accepted, nothing to say.
  if (answers.length === 0) return new Response(null, { status: 202, headers: CORS });
  return Response.json(Array.isArray(body) ? answers : answers[0], { headers: CORS });
}

/** No server initiated stream. The spec's answer for that is 405. */
export function GET() {
  return new Response(null, { status: 405, headers: { ...CORS, Allow: "POST" } });
}

export function DELETE() {
  return new Response(null, { status: 405, headers: { ...CORS, Allow: "POST" } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
