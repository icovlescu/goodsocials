import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import {
  board as boardTable,
  brandPrinciple,
  card as cardTable,
  profile as profileTable,
  theme as themeTable,
} from "@/db/schema";
import { THIRD_PERSON } from "@/lib/agent/person";
import {
  addWrittenDraft,
  moveCard,
  publishWrittenNow,
  rejectCard,
  replaceDraftText,
  scheduleWritten,
} from "@/lib/cards";
import { factsBrief, readFacts } from "@/lib/integrations/facts";
import { loadAccess, seatName, type Actor } from "@/lib/profiles";
import {
  BANNED_PHRASES,
  BANNED_WORDS,
  MAX_LENGTH,
  MIN_LENGTH,
  checkPost,
  heldIssues,
} from "@/lib/quality";
import { boardZone } from "@/lib/schedule";
import { formatDayAndTime, isDayKey, todayKey } from "@/lib/time";
import { connectionLine } from "@/lib/token-expiry";

/**
 * The tools the Claude connector offers. Every one of them is a thin call into
 * lib/cards.ts or a read of the same rows the board reads, so the connector
 * cannot do anything to a card that the board could not.
 *
 * None of them generate text. The member's own Claude writes in their own
 * chat, on their own plan, and these tools hand it the context it needs to
 * write well (the principles, the themes, the readings, the rules) and take the
 * finished post back. That is the whole point of the connector: the text cost
 * moves from our ANTHROPIC_API_KEY to the member's Claude subscription.
 */

export type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

type Tool<S extends z.ZodType> = {
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
  run: (memberId: string, args: z.infer<S>) => Promise<ToolResult>;
};

function tool<S extends z.ZodType>(t: Tool<S>): Tool<S> {
  return t;
}

function ok(text: string, data?: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text }], structuredContent: data };
}

function refuse(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

// ---------------------------------------------------------------------------
// Who is acting

/**
 * The connector's version of resolveActor. No cookie says which profile the
 * member is looking at, so the tool names it, and the owner's own profile is
 * the default because it is the one seat every account has.
 */
async function actorFor(
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

const profileArg = z
  .string()
  .uuid()
  .optional()
  .describe("Which profile, from list_profiles. Leave out for the account owner's own profile.");

const postArg = z.string().uuid().describe("The post id, from list_posts or create_draft.");

const postText = z
  .string()
  .min(20)
  .max(3000)
  .describe(
    `The full post as it should appear on LinkedIn, plain text with line breaks. ${MIN_LENGTH} to ${MAX_LENGTH - 1} characters. **double asterisks** turn into bold.`,
  );

// ---------------------------------------------------------------------------
// Reading

const WRITING_RULES = [
  THIRD_PERSON,
  "No long dashes (— or –). Use a full stop or a comma.",
  `Never use these words: ${BANNED_WORDS.join(", ")}.`,
  `Never use these phrases: ${BANNED_PHRASES.join("; ")}.`,
  'Never the "this is not X, this is Y" construction.',
  `Between ${MIN_LENGTH} and ${MAX_LENGTH - 1} characters.`,
  "Do not refer to a chart, image or screenshot. Most posts publish as text only.",
  "Never invent a number, a customer or a result. Use the readings below exactly as written. If the post needs a number only the author has, put it in [square brackets] and ask the member for it; a post with a bracket cannot be scheduled.",
  "Sentence case, plain words.",
].map((r) => `- ${r}`);

const listProfiles = tool({
  name: "list_profiles",
  title: "List LinkedIn profiles",
  description:
    "The LinkedIn profiles this GoodSocials account posts as, with their ids and whether each LinkedIn connection is still alive. One profile for most people, up to 12 for an agency.",
  input: z.object({}),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(memberId) {
    const access = await loadAccess(memberId);
    if (!access) return refuse("This login has no GoodSocials account yet.");
    const profiles = access.seats.map((s) => ({
      id: s.profile.id,
      name: seatName(s),
      owner: s.profile.linkedinMemberId === access.account.ownerMemberId,
      linkedin: connectionLine(s.connection),
    }));
    return ok(
      profiles
        .map((p) => `- ${p.name}${p.owner ? " (you)" : ""}: id ${p.id}. LinkedIn: ${p.linkedin}`)
        .join("\n"),
      { profiles },
    );
  },
});

const getBrandContext = tool({
  name: "get_brand_context",
  title: "Get brand context",
  description:
    "Everything needed to write a post for this profile: the three brand principles (voice, visual, format), the themes the profile is known for, the goal, the cadence, real numbers read from connected tools, the openings of recent posts so nothing repeats, and the writing rules every post must pass before it can be scheduled. Call this before writing.",
  input: z.object({ profile_id: profileArg }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(memberId, args) {
    const who = await actorFor(memberId, args.profile_id);
    if (!who.ok) return refuse(who.error);
    const { profileId } = who.actor;
    const db = getDb();

    const [row] = await db
      .select({ profile: profileTable, board: boardTable })
      .from(profileTable)
      .innerJoin(boardTable, eq(boardTable.profileId, profileTable.id))
      .where(eq(profileTable.id, profileId))
      .limit(1);
    if (!row) return refuse("This profile has no board yet. Finish onboarding at goodsocials.co first.");

    const [principles, themes, facts, recent] = await Promise.all([
      db.select().from(brandPrinciple).where(eq(brandPrinciple.profileId, profileId)),
      db
        .select()
        .from(themeTable)
        .where(eq(themeTable.profileId, profileId))
        .orderBy(themeTable.position),
      readFacts(profileId),
      db
        .select({
          state: cardTable.state,
          text: cardTable.draftText,
          scheduledAt: cardTable.scheduledAt,
        })
        .from(cardTable)
        .where(
          and(
            eq(cardTable.boardId, row.board.id),
            inArray(cardTable.state, ["scheduled", "posted"]),
          ),
        )
        .orderBy(desc(cardTable.updatedAt))
        .limit(10),
    ]);

    const zone = boardZone(row.board.timezone);
    const principle = (kind: string) =>
      principles.find((p) => p.kind === kind)?.text ?? "(not written yet)";

    const sections = [
      `# ${row.profile.name ?? "This profile"}`,
      `Profile id ${profileId}. Site: ${row.board.siteUrl ?? "none"}. Goal: ${row.board.goal}. Cadence: ${row.board.targetCadence} posts a week, each at 09:00 ${zone}. Today there is ${todayKey(zone)}.`,
      "## Brand principles",
      `Voice: ${principle("voice")}`,
      `Format: ${principle("format")}`,
      `Visual: ${principle("visual")}`,
      "When the member corrects how a post sounds or looks, and the correction should hold for every future post, update the matching principle with update_brand_principle.",
      "## Themes",
      themes.length
        ? themes.map((t) => `- ${t.title} (theme_id ${t.id}): ${t.description}`).join("\n")
        : "No themes yet.",
      "## Readings from connected tools",
      factsBrief(facts) || "Nothing connected. Do not invent numbers.",
      "## Recent and scheduled posts (do not repeat their openings)",
      recent.length
        ? recent
            .map(
              (c) =>
                `- ${c.state}${c.scheduledAt ? ` ${formatDayAndTime(c.scheduledAt, zone)}` : ""}: ${(c.text ?? "").slice(0, 120).replace(/\s+/g, " ")}`,
            )
            .join("\n")
        : "None yet.",
      "## Writing rules, checked before a post can be scheduled",
      WRITING_RULES.join("\n"),
    ];

    return ok(sections.join("\n\n"));
  },
});

const STATES = ["idea", "draft", "image", "scheduled", "posted", "rejected"] as const;

const listPosts = tool({
  name: "list_posts",
  title: "List posts on the board",
  description:
    "Cards on the GoodSocials board for one profile, newest first. Each has an id, a state (idea, draft, image, scheduled, posted), the idea, the start of the text, the scheduled time, and anything the quality check is holding it for.",
  input: z.object({
    profile_id: profileArg,
    state: z.enum(STATES).optional().describe("Only cards in this column. Leave out for everything except rejected."),
    limit: z.number().int().min(1).max(50).optional().describe("At most this many. Default 20."),
  }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(memberId, args) {
    const who = await actorFor(memberId, args.profile_id);
    if (!who.ok) return refuse(who.error);
    const db = getDb();

    const [b] = await db
      .select()
      .from(boardTable)
      .where(eq(boardTable.profileId, who.actor.profileId))
      .limit(1);
    if (!b) return refuse("This profile has no board yet.");
    const zone = boardZone(b.timezone);

    const rows = await db
      .select()
      .from(cardTable)
      .where(
        and(
          eq(cardTable.boardId, b.id),
          args.state
            ? eq(cardTable.state, args.state)
            : inArray(cardTable.state, ["idea", "draft", "image", "scheduled", "posted"]),
        ),
      )
      .orderBy(desc(cardTable.updatedAt))
      .limit(args.limit ?? 20);

    const posts = rows.map((c) => summary(c, zone));
    if (posts.length === 0) return ok("Nothing on the board in that column.", { posts });
    return ok(
      posts
        .map(
          (p) =>
            `- ${p.id} [${p.state}]${p.scheduled_for ? ` ${p.scheduled_for}` : ""}: ${p.title}${p.held ? ` HELD: ${p.held.join(" ")}` : ""}`,
        )
        .join("\n"),
      { posts },
    );
  },
});

function summary(c: typeof cardTable.$inferSelect, zone: string) {
  const issues = heldIssues(c.quality);
  return {
    id: c.id,
    state: c.state,
    kind: c.kind,
    title: c.title ?? c.idea.slice(0, 100),
    preview: c.draftText ? c.draftText.slice(0, 200) : null,
    needs: c.needs,
    scheduled_for: c.scheduledAt ? formatDayAndTime(c.scheduledAt, zone) : null,
    has_image: Boolean(c.imageUrl),
    post_urn: c.postUrn,
    held: issues ? issues.map((i) => `${i.problem} Fix: ${i.fix}`) : null,
  };
}

const getPost = tool({
  name: "get_post",
  title: "Read one post",
  description: "The full text and state of one card on the board.",
  input: z.object({ post_id: postArg }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(memberId, args) {
    const who = await actorFor(memberId);
    if (!who.ok) return refuse(who.error);
    const [row] = await getDb()
      .select({ card: cardTable, board: boardTable })
      .from(cardTable)
      .innerJoin(boardTable, eq(cardTable.boardId, boardTable.id))
      .innerJoin(profileTable, eq(boardTable.profileId, profileTable.id))
      .where(and(eq(cardTable.id, args.post_id), eq(profileTable.accountId, who.actor.accountId)))
      .limit(1);
    if (!row) return refuse("That post is not on your board.");
    const s = summary(row.card, boardZone(row.board.timezone));
    return ok(
      [
        `State: ${s.state}${s.scheduled_for ? `, publishing ${s.scheduled_for}` : ""}`,
        `Idea: ${row.card.idea}`,
        s.needs ? `Waiting on: ${s.needs}` : null,
        s.held ? `Held by the quality check:\n${s.held.map((h) => `- ${h}`).join("\n")}` : null,
        "",
        row.card.draftText ?? "(no text yet, this is an idea)",
      ]
        .filter((l) => l !== null)
        .join("\n"),
      { ...s, text: row.card.draftText, idea: row.card.idea },
    );
  },
});

// ---------------------------------------------------------------------------
// Writing

/** What the rules would say, so Claude can fix a post before asking to schedule it. */
function rulesNote(text: string): { text: string; issues: { problem: string; fix: string }[] } {
  const issues = checkPost(text).map(({ problem, fix }) => ({ problem, fix }));
  if (issues.length === 0) return { text: "It passes the writing rules.", issues };
  return {
    text: `It will be held at scheduling until fixed:\n${issues.map((i) => `- ${i.problem} Fix: ${i.fix}`).join("\n")}`,
    issues,
  };
}

const createDraft = tool({
  name: "create_draft",
  title: "Save a draft to the board",
  description:
    "Saves a finished post you wrote to the GoodSocials board, in the Draft column. Nothing is published. Returns the post id and whether it passes the writing rules.",
  input: z.object({
    profile_id: profileArg,
    text: postText,
    idea: z.string().max(1000).optional().describe("One line on what the post is about. Shown on the card."),
    theme_id: z.string().uuid().optional().describe("The theme it sits under, from get_brand_context."),
    kind: z
      .enum(["framework", "data", "receipt", "finding"])
      .optional()
      .describe("framework: a method; data: a breakdown of numbers; receipt: a result with the author's own number; finding: anything else."),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  async run(memberId, args) {
    const who = await actorFor(memberId, args.profile_id);
    if (!who.ok) return refuse(who.error);
    const result = await addWrittenDraft(who.actor, {
      text: args.text,
      idea: args.idea,
      themeId: args.theme_id,
      kind: args.kind,
    });
    if (!result.ok) return refuse(result.error);
    const note = rulesNote(args.text);
    return ok(`${result.message} Post id ${result.cardId}. ${note.text}`, {
      post_id: result.cardId,
      issues: note.issues,
    });
  },
});

const updateDraft = tool({
  name: "update_draft",
  title: "Replace a draft's text",
  description:
    "Replaces the text of a post that is not scheduled yet. Use it after the member asks for a change. If the change should apply to every future post, also call update_brand_principle.",
  input: z.object({
    post_id: postArg,
    text: postText,
    note: z.string().max(2000).optional().describe("What the member asked to change, in their words. Kept in the card's history."),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(memberId, args) {
    const who = await actorFor(memberId);
    if (!who.ok) return refuse(who.error);
    const result = await replaceDraftText(who.actor, args.post_id, args.text, args.note);
    if (!result.ok) return refuse(result.error);
    const note = rulesNote(args.text);
    return ok(`${result.message} ${note.text}`, { post_id: result.cardId, issues: note.issues });
  },
});

const updatePrinciple = tool({
  name: "update_brand_principle",
  title: "Update a brand principle",
  description:
    "Rewrites one of the profile's three brand principles so a correction holds for every future post, on the board and in Claude. voice is how posts sound, format is how they are laid out, visual is what the pictures look like. Send the whole new principle, keeping what still holds from the old one.",
  input: z.object({
    profile_id: profileArg,
    kind: z.enum(["voice", "format", "visual"]),
    text: z.string().min(10).max(2000).describe("The complete new principle."),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(memberId, args) {
    const who = await actorFor(memberId, args.profile_id);
    if (!who.ok) return refuse(who.error);
    const updated = await getDb()
      .update(brandPrinciple)
      .set({ text: args.text.trim(), updatedAt: new Date() })
      .where(
        and(
          eq(brandPrinciple.profileId, who.actor.profileId),
          eq(brandPrinciple.kind, args.kind),
        ),
      )
      .returning({ id: brandPrinciple.id });
    if (updated.length === 0) return refuse("This profile has no principles yet. Finish onboarding first.");
    return ok(`The ${args.kind} principle is updated. Every future post on the board follows it too.`);
  },
});

// ---------------------------------------------------------------------------
// Scheduling and publishing

const schedulePost = tool({
  name: "schedule_post",
  title: "Schedule a post",
  description:
    "Approves a draft and puts it in the publish queue at 09:00 in the profile's time zone, on the day given or on the next free day. One post per day per profile. Only call this after the member has read the final text and said to schedule it.",
  input: z.object({
    post_id: postArg,
    day: z
      .string()
      .optional()
      .describe("YYYY-MM-DD in the profile's time zone. Leave out for the next free slot."),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  async run(memberId, args) {
    if (args.day && !isDayKey(args.day)) return refuse("Give the day as YYYY-MM-DD.");
    const who = await actorFor(memberId);
    if (!who.ok) return refuse(who.error);
    const result = await scheduleWritten(who.actor, args.post_id, args.day);
    if (!result.ok) return refuse(result.error);
    return ok(result.message, { post_id: result.cardId, publish_at: result.publishAt });
  },
});

const publishNow = tool({
  name: "publish_now",
  title: "Publish a post to LinkedIn now",
  description:
    "Publishes a post to the profile's LinkedIn feed immediately. This is public and cannot be undone from here. Only call it when the member has explicitly asked to post it now, after reading the final text.",
  input: z.object({ post_id: postArg }),
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  async run(memberId, args) {
    const who = await actorFor(memberId);
    if (!who.ok) return refuse(who.error);
    const result = await publishWrittenNow(who.actor, args.post_id);
    if (!result.ok) return refuse(result.error);
    const o = result.outcome;
    switch (o.result) {
      case "published":
        return ok(`Published. ${o.permalink}`, { post_id: o.cardId, permalink: o.permalink, post_urn: o.postUrn });
      case "failed":
        return refuse(`LinkedIn did not take it: ${o.error} It stays queued and the next publish run tries again.`);
      default:
        return refuse(`Not published: ${o.error}`);
    }
  },
});

const unschedulePost = tool({
  name: "unschedule_post",
  title: "Take a post out of the queue",
  description: "Takes a scheduled post out of the publish queue and back to the board, keeping its text.",
  input: z.object({ post_id: postArg }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(memberId, args) {
    const who = await actorFor(memberId);
    if (!who.ok) return refuse(who.error);
    const [c] = await getDb()
      .select({ imageUrl: cardTable.imageUrl, state: cardTable.state })
      .from(cardTable)
      .innerJoin(boardTable, eq(cardTable.boardId, boardTable.id))
      .innerJoin(profileTable, eq(boardTable.profileId, profileTable.id))
      .where(and(eq(cardTable.id, args.post_id), eq(profileTable.accountId, who.actor.accountId)))
      .limit(1);
    if (!c) return refuse("That post is not on your board.");
    if (c.state !== "scheduled") return refuse("That post is not scheduled.");
    const result = await moveCard(who.actor, args.post_id, c.imageUrl ? "image" : "draft");
    if (!result.ok) return refuse(result.error);
    return ok(result.message ?? "Taken out of the queue.");
  },
});

const rejectPost = tool({
  name: "reject_post",
  title: "Reject a post",
  description: "Takes a card off the board. It stays in the history, but never publishes.",
  input: z.object({ post_id: postArg }),
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  async run(memberId, args) {
    const who = await actorFor(memberId);
    if (!who.ok) return refuse(who.error);
    const result = await rejectCard(who.actor, args.post_id);
    if (!result.ok) return refuse(result.error);
    return ok("Rejected. It is off the board.");
  },
});

// Typed loosely here so the list can hold tools with different inputs. Each
// tool's own input schema is still what parses its arguments.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TOOLS: Tool<any>[] = [
  getBrandContext,
  listProfiles,
  listPosts,
  getPost,
  createDraft,
  updateDraft,
  updatePrinciple,
  schedulePost,
  publishNow,
  unschedulePost,
  rejectPost,
];

export function toolList() {
  return TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: z.toJSONSchema(t.input, { target: "draft-7" }),
    annotations: { title: t.title, ...t.annotations },
  }));
}

export async function callTool(
  memberId: string,
  name: string,
  rawArgs: unknown,
): Promise<ToolResult> {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) return refuse(`There is no tool called ${name}.`);
  const parsed = t.input.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return refuse(
      `The arguments did not fit: ${parsed.error.issues.map((i: z.core.$ZodIssue) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}`,
    );
  }
  try {
    return await t.run(memberId, parsed.data);
  } catch (cause) {
    console.error(`[mcp] ${name} failed:`, cause);
    return refuse("Something went wrong on the GoodSocials side. Try again in a minute.");
  }
}
