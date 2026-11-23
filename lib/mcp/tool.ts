import { z } from "zod";
import { loadAccess, type Actor } from "@/lib/profiles";
import { MAX_LENGTH, MIN_LENGTH } from "@/lib/quality";

/**
 * The shape every connector tool shares, and the one rule for who is acting.
 * Nothing here names a chat app: the server speaks standard MCP, so Claude,
 * ChatGPT and any other client that supports remote MCP with OAuth see the
 * same tools.
 */

/** Who is calling and from which deployment, for links back to the site. */
export type Ctx = { memberId: string; origin: string };

export type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export type Tool<S extends z.ZodType> = {
  name: string;
  title: string;
  description: string;
  input: S;
  annotations: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  run: (ctx: Ctx, args: z.infer<S>) => Promise<ToolResult>;
};

export function tool<S extends z.ZodType>(t: Tool<S>): Tool<S> {
  return t;
}

export function ok(text: string, data?: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text }], structuredContent: data };
}

export function refuse(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

// ---------------------------------------------------------------------------
// Who is acting

/**
 * The connector's version of resolveActor. No cookie says which profile the
 * member is looking at, so the tool names it, and the owner's own profile is
 * the default because it is the one seat every account has.
 */
export async function actorFor(
  memberId: string,
  profileId?: string,
): Promise<{ ok: true; actor: Actor } | { ok: false; error: string }> {
  const access = await loadAccess(memberId);
  if (!access) {
    return { ok: false, error: "This GoodSocials login has no account yet. Sign in at goodsocials.co and finish setting up the board." };
  }
  const seat = profileId
    ? access.seats.find((s) => s.profile.id === profileId)
    : (access.seats.find((s) => s.profile.linkedinMemberId === access.account.ownerMemberId) ??
      access.seats[0]);
  if (!seat) {
    return {
      ok: false,
      error: profileId
        ? "That profile is not on this account. Call list_profiles for the ids."
        : "This account has no profile yet. Finish onboarding at goodsocials.co first.",
    };
  }
  return {
    ok: true,
    actor: { memberId, accountId: access.account.id, profileId: seat.profile.id },
  };
}

export const profileArg = z
  .string()
  .uuid()
  .optional()
  .describe("Which profile, from list_profiles. Leave out for the account owner's own profile.");

export const postArg = z.string().uuid().describe("The post id, from list_posts or create_draft.");

export const postText = z
  .string()
  .min(20)
  .max(3000)
  .describe(
    `The full post as it should appear on LinkedIn, plain text with line breaks. ${MIN_LENGTH} to ${MAX_LENGTH - 1} characters. **double asterisks** turn into bold.`,
  );

