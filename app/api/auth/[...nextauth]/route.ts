import { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { BASE_PATH } from "@/lib/base-path";

/**
 * Under a base path a route handler's request URL arrives without it, while
 * Auth.js parses the action against `${BASE_PATH}/api/auth` and builds the
 * LinkedIn redirect_uri from the same URL. The base goes back in front here,
 * so /v2 signs in at /v2/api/auth/callback/linkedin. With no base path these
 * are the handlers as they were.
 */
function withBaseUrl(handler: (req: NextRequest) => Promise<Response>) {
  return (req: NextRequest) => {
    if (!BASE_PATH) return handler(req);
    const url = new URL(req.url);
    if (!url.pathname.startsWith(`${BASE_PATH}/`)) url.pathname = `${BASE_PATH}${url.pathname}`;
    // Built without the incoming request's Next config, which would strip
    // the base path straight back off the URL.
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : req.body;
    return handler(
      new NextRequest(url.toString(), {
        method: req.method,
        headers: req.headers,
        body,
        ...(body ? { duplex: "half" } : {}),
      } as ConstructorParameters<typeof NextRequest>[1]),
    );
  };
}

export const GET = withBaseUrl(handlers.GET);
export const POST = withBaseUrl(handlers.POST);
