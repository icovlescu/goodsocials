import { CORS } from "@/lib/oauth/metadata";
import { exchangeToken } from "@/lib/oauth/server";

/** The token endpoint. A code or a refresh token in, a bearer token out. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { ...CORS, "Cache-Control": "no-store", Pragma: "no-cache" };

export async function POST(request: Request) {
  // Form encoded is the standard. JSON is accepted too, because some clients
  // send it and a refusal over the content type helps nobody.
  let form: URLSearchParams;
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const body = (await request.json()) as Record<string, unknown>;
      form = new URLSearchParams(
        Object.entries(body).flatMap(([k, v]) =>
          typeof v === "string" ? [[k, v] as [string, string]] : [],
        ),
      );
    } else {
      form = new URLSearchParams(await request.text());
    }
  } catch {
    return Response.json(
      { error: "invalid_request", error_description: "The body could not be read." },
      { status: 400, headers: NO_STORE },
    );
  }

  const result = await exchangeToken(form);
  if (!result.ok) {
    return Response.json(
      { error: result.error, error_description: result.description },
      { status: result.error === "invalid_client" ? 401 : 400, headers: NO_STORE },
    );
  }
  return Response.json(result.tokens, { headers: NO_STORE });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
