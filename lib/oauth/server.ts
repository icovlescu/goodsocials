import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { oauthClient, oauthGrant } from "@/db/schema";

/**
 * The authorization server behind the connector (Claude, ChatGPT or any MCP client). OAuth 2.1 the way the
 * MCP authorization spec asks for it: public clients, dynamic registration,
 * PKCE with S256 only, a short code, a short access token and a rotating
 * refresh token.
 *
 * This is a different OAuth from the one in auth.ts. That one is GoodSocials
 * signing in to LinkedIn; this one is Claude signing in to GoodSocials. The
 * member proves who they are with the LinkedIn sign in they already have, and
 * this file only ever sees the member id that sign in produced.
 *
 * Every secret is random, at least 32 bytes, and stored as a SHA-256 hash.
 * Nothing here is ever logged.
 */

export const ACCESS_TTL_SECONDS = 60 * 60;
const CODE_TTL_MS = 5 * 60 * 1000;
const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** The one scope. A connector either works the board or it does not. */
export const OAUTH_SCOPE = "board";

export type OAuthError = {
  ok: false;
  /** RFC 6749 error code, sent back as `error`. */
  error: string;
  description: string;
};

function fail(error: string, description: string): OAuthError {
  return { ok: false, error, description };
}

function secret(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Where a client may send a member back to. HTTPS anywhere, or plain HTTP to
 * the member's own machine, which is how Claude Code and Claude Desktop
 * receive a callback. Nothing else: a custom scheme or an http address on the
 * internet is where a stolen code goes.
 */
export function allowedRedirect(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol !== "http:") return false;
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

// ---------------------------------------------------------------------------
// Registration (RFC 7591)

export type RegisteredClient = {
  clientId: string;
  name: string;
  redirectUris: string[];
  createdAt: Date;
};

export async function registerClient(body: unknown): Promise<
  { ok: true; client: RegisteredClient } | OAuthError
> {
  if (!body || typeof body !== "object") {
    return fail("invalid_client_metadata", "The registration body must be a JSON object.");
  }
  const meta = body as Record<string, unknown>;

  const uris = meta.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10) {
    return fail("invalid_redirect_uri", "Send between one and ten redirect_uris.");
  }
  const redirectUris = uris.filter((u): u is string => typeof u === "string");
  if (redirectUris.length !== uris.length || !redirectUris.every(allowedRedirect)) {
    return fail(
      "invalid_redirect_uri",
      "Every redirect URI must be https, or http to localhost.",
    );
  }

  // Public clients only. A client that asks for a secret gets told no rather
  // than being handed one it would then keep in a desktop app.
  const method = meta.token_endpoint_auth_method;
  if (method !== undefined && method !== "none") {
    return fail(
      "invalid_client_metadata",
      "Only public clients are supported. Use token_endpoint_auth_method none with PKCE.",
    );
  }

  const name =
    typeof meta.client_name === "string" && meta.client_name.trim()
      ? meta.client_name.trim().slice(0, 80)
      : "An unnamed app";

  const clientId = secret("gsc");
  const [row] = await getDb()
    .insert(oauthClient)
    .values({ clientId, name, redirectUris })
    .returning();

  return {
    ok: true,
    client: { clientId, name, redirectUris, createdAt: row.createdAt },
  };
}

export async function findClient(clientId: string): Promise<RegisteredClient | null> {
  const [row] = await getDb()
    .select()
    .from(oauthClient)
    .where(eq(oauthClient.clientId, clientId))
    .limit(1);
  if (!row) return null;
  const redirectUris = Array.isArray(row.redirectUris)
    ? row.redirectUris.filter((u): u is string => typeof u === "string")
    : [];
  return { clientId: row.clientId, name: row.name, redirectUris, createdAt: row.createdAt };
}

// ---------------------------------------------------------------------------
// Authorization request

export type AuthorizeRequest = {
  client: RegisteredClient;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
};

/**
 * Checks an authorization request before the consent screen shows anything.
 *
 * Two kinds of failure, and they go to different places. A bad client id or
 * redirect URI is shown on our own page, because redirecting to an address we
 * cannot vouch for is the open redirect the spec warns about. Everything else
 * goes back to the client's redirect URI with an error, which is where the
 * client is listening for it.
 */
export async function checkAuthorize(params: Record<string, string | undefined>): Promise<
  | { ok: true; request: AuthorizeRequest }
  | { ok: false; show: string }
  | { ok: false; redirect: string }
> {
  const clientId = params.client_id;
  if (!clientId) return { ok: false, show: "The app did not say who it is." };
  const client = await findClient(clientId);
  if (!client) {
    return {
      ok: false,
      show: "This app is not registered with GoodSocials. Remove the connector in Claude and add it again.",
    };
  }

  const redirectUri =
    params.redirect_uri ??
    (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
    return { ok: false, show: "The app asked to be sent somewhere it never registered." };
  }

  const back = (error: string, description: string) => {
    const url = new URL(redirectUri);
    url.searchParams.set("error", error);
    url.searchParams.set("error_description", description);
    if (params.state) url.searchParams.set("state", params.state);
    return { ok: false as const, redirect: url.toString() };
  };

  if (params.response_type !== "code") {
    return back("unsupported_response_type", "Only response_type=code is supported.");
  }
  if (!params.code_challenge || params.code_challenge_method !== "S256") {
    return back("invalid_request", "PKCE with code_challenge_method=S256 is required.");
  }
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(params.code_challenge)) {
    return back("invalid_request", "The code_challenge is not a base64url S256 hash.");
  }

  return {
    ok: true,
    request: {
      client,
      redirectUri,
      codeChallenge: params.code_challenge,
      state: params.state ?? null,
    },
  };
}

/** The member pressed Allow. Returns the URL to send them back to. */
export async function issueCode(
  request: AuthorizeRequest,
  memberId: string,
): Promise<string> {
  const code = secret("gsa");
  await getDb()
    .insert(oauthGrant)
    .values({
      clientId: request.client.clientId,
      memberId,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      codeHash: hash(code),
      codeExpiresAt: new Date(Date.now() + CODE_TTL_MS),
    });

  const url = new URL(request.redirectUri);
  url.searchParams.set("code", code);
  if (request.state) url.searchParams.set("state", request.state);
  return url.toString();
}

export function denyUrl(request: AuthorizeRequest): string {
  const url = new URL(request.redirectUri);
  url.searchParams.set("error", "access_denied");
  url.searchParams.set("error_description", "The member did not allow access.");
  if (request.state) url.searchParams.set("state", request.state);
  return url.toString();
}

// ---------------------------------------------------------------------------
// Token endpoint

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

function verifierMatches(verifier: string, challenge: string): boolean {
  const computed = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

async function mintTokens(grantId: string): Promise<TokenResponse> {
  const access = secret("gst");
  const refresh = secret("gsr");
  const now = Date.now();
  await getDb()
    .update(oauthGrant)
    .set({
      accessTokenHash: hash(access),
      accessExpiresAt: new Date(now + ACCESS_TTL_SECONDS * 1000),
      refreshTokenHash: hash(refresh),
      refreshExpiresAt: new Date(now + REFRESH_TTL_MS),
    })
    .where(eq(oauthGrant.id, grantId));
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_SECONDS,
    refresh_token: refresh,
    scope: OAUTH_SCOPE,
  };
}

export async function exchangeToken(
  form: URLSearchParams,
): Promise<{ ok: true; tokens: TokenResponse } | OAuthError> {
  const grantType = form.get("grant_type");
  const clientId = form.get("client_id");
  if (!clientId) return fail("invalid_client", "Send client_id.");

  const db = getDb();

  if (grantType === "authorization_code") {
    const code = form.get("code");
    const verifier = form.get("code_verifier");
    if (!code || !verifier) {
      return fail("invalid_request", "Send code and code_verifier.");
    }

    // Spent on read: the code column is cleared in the same statement that
    // finds it, so two exchanges of one code cannot both succeed.
    const [grant] = await db
      .update(oauthGrant)
      .set({ codeHash: null })
      .where(
        and(
          eq(oauthGrant.codeHash, hash(code)),
          gt(oauthGrant.codeExpiresAt, new Date()),
          isNull(oauthGrant.revokedAt),
        ),
      )
      .returning();
    if (!grant) return fail("invalid_grant", "That code is unknown, used or expired.");

    if (grant.clientId !== clientId) {
      return fail("invalid_grant", "That code was issued to another app.");
    }
    const redirectUri = form.get("redirect_uri");
    if (redirectUri && redirectUri !== grant.redirectUri) {
      return fail("invalid_grant", "redirect_uri does not match the one the code was issued for.");
    }
    if (!verifierMatches(verifier, grant.codeChallenge)) {
      return fail("invalid_grant", "The code_verifier does not match the challenge.");
    }

    return { ok: true, tokens: await mintTokens(grant.id) };
  }

  if (grantType === "refresh_token") {
    const refresh = form.get("refresh_token");
    if (!refresh) return fail("invalid_request", "Send refresh_token.");

    const [grant] = await db
      .select()
      .from(oauthGrant)
      .where(
        and(
          eq(oauthGrant.refreshTokenHash, hash(refresh)),
          gt(oauthGrant.refreshExpiresAt, new Date()),
          isNull(oauthGrant.revokedAt),
        ),
      )
      .limit(1);
    if (!grant || grant.clientId !== clientId) {
      return fail("invalid_grant", "That refresh token is unknown, revoked or expired.");
    }
    return { ok: true, tokens: await mintTokens(grant.id) };
  }

  return fail(
    "unsupported_grant_type",
    "Use grant_type authorization_code or refresh_token.",
  );
}

// ---------------------------------------------------------------------------
// Resource side

/** The member a bearer token speaks for, or null for anything else. */
export async function memberForToken(token: string): Promise<string | null> {
  const db = getDb();
  const [grant] = await db
    .select({ id: oauthGrant.id, memberId: oauthGrant.memberId })
    .from(oauthGrant)
    .where(
      and(
        eq(oauthGrant.accessTokenHash, hash(token)),
        gt(oauthGrant.accessExpiresAt, new Date()),
        isNull(oauthGrant.revokedAt),
      ),
    )
    .limit(1);
  if (!grant) return null;

  // Best effort, so settings can say when Claude last used the board.
  await db
    .update(oauthGrant)
    .set({ lastUsedAt: new Date() })
    .where(eq(oauthGrant.id, grant.id))
    .catch(() => undefined);

  return grant.memberId;
}

export type ConnectedApp = {
  grantId: string;
  name: string;
  connectedAt: Date;
  lastUsedAt: Date | null;
};

/** Every live connector grant a member holds, for the settings row. */
export async function connectedApps(memberId: string): Promise<ConnectedApp[]> {
  const rows = await getDb()
    .select({
      grantId: oauthGrant.id,
      name: oauthClient.name,
      connectedAt: oauthGrant.createdAt,
      lastUsedAt: oauthGrant.lastUsedAt,
      refreshExpiresAt: oauthGrant.refreshExpiresAt,
    })
    .from(oauthGrant)
    .innerJoin(oauthClient, eq(oauthGrant.clientId, oauthClient.clientId))
    .where(and(eq(oauthGrant.memberId, memberId), isNull(oauthGrant.revokedAt)));
  const now = new Date();
  return rows
    .filter((r) => r.refreshExpiresAt && r.refreshExpiresAt > now)
    .map(({ grantId, name, connectedAt, lastUsedAt }) => ({
      grantId,
      name,
      connectedAt,
      lastUsedAt,
    }));
}

/** Disconnects one app. Scoped by member, so a grant id alone opens nothing. */
export async function revokeGrant(memberId: string, grantId: string): Promise<void> {
  await getDb()
    .update(oauthGrant)
    .set({ revokedAt: new Date() })
    .where(and(eq(oauthGrant.id, grantId), eq(oauthGrant.memberId, memberId)));
}
