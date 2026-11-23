import { z } from "zod";
import { actorFor, ok, postArg, refuse, tool, type Tool } from "@/lib/mcp/tool";
import {
  PLATFORMS,
  PLATFORM_IDS,
  PUBLISH_DISCLAIMER,
  checkForPlatform,
  routeFor,
} from "@/lib/platforms/registry";
import { usageFor } from "@/lib/tiers";
import { listVariants, markShared, saveVariant } from "@/lib/variants";

/**
 * One post, several platforms. The card's own text is the LinkedIn version
 * and goes through schedule_post or publish_now; every other platform gets
 * its own text through adapt_post and goes out through share_post, which
 * hands the member a link that opens that platform with the post filled in.
 */

const platformArg = z.enum(PLATFORM_IDS);

async function isPaid(accountId: string): Promise<boolean> {
  return (await usageFor(accountId)).tier === "paid";
}

const listPlatforms = tool({
  name: "list_platforms",
  title: "List platforms",
  description:
    "Every platform GoodSocials writes for, with its character limit, style, and how a post reaches it on this account's plan: api (GoodSocials publishes it), share (a link opens the platform with the post filled in) or copy.",
  input: z.object({}),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run({ memberId }) {
    const who = await actorFor(memberId);
    const paid = who.ok ? await isPaid(who.actor.accountId) : false;
    const rows = PLATFORM_IDS.map((id) => {
      const p = PLATFORMS[id];
      return {
        id,
        name: p.name,
        max_chars: p.maxChars,
        route: routeFor(id, paid),
        api: p.api,
        api_note: p.apiNote,
        needs_media: p.needsMedia ?? null,
      };
    });
    return ok(
      [
        ...rows.map((r) => `- ${r.name} (${r.id}): ${r.max_chars} chars, goes out by ${r.route}. ${r.api_note}`),
        "",
        PUBLISH_DISCLAIMER,
      ].join("\n"),
      { platforms: rows },
    );
  },
});

const checkPostTool = tool({
  name: "check_post",
  title: "Check a post against the rules",
  description:
    "Checks text against the writing rules and one platform's limits before you show or save it. Returns each problem with its fix. Free and instant; nothing is saved.",
  input: z.object({
    text: z.string().min(1).max(70000),
    platform: platformArg.optional().describe("Default linkedin."),
  }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  async run(_ctx, args) {
    const platform = args.platform ?? "linkedin";
    const issues = checkForPlatform(platform, args.text);
    if (issues.length === 0) return ok(`Passes for ${PLATFORMS[platform].name}.`, { issues: [] });
    return ok(
      `${issues.length} to fix for ${PLATFORMS[platform].name}:\n${issues.map((i) => `- ${i.problem} Fix: ${i.fix}`).join("\n")}`,
      { issues: issues.map(({ rule, problem, fix }) => ({ rule, problem, fix })) },
    );
  },
});

const adaptPost = tool({
  name: "adapt_post",
  title: "Save a version for another platform",
  description:
    "Saves your rewrite of a board post for X, Instagram, Facebook, Threads, Bluesky or TikTok, following that platform's skill (read_skill with its name). The LinkedIn version is the post's own text; change it with update_draft. Nothing is published.",
  input: z.object({
    post_id: postArg,
    platform: platformArg,
    text: z.string().min(1).max(70000),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run({ memberId }, args) {
    const who = await actorFor(memberId);
    if (!who.ok) return refuse(who.error);
    const r = await saveVariant(who.actor, args.post_id, args.platform, args.text, await isPaid(who.actor.accountId));
    if (!r.ok) return refuse(r.error);
    const v = r.variant;
    return ok(
      v.issues.length
        ? `Saved the ${v.name} version, with ${v.issues.length} to fix before sharing:\n${v.issues.map((i) => `- ${i.problem} Fix: ${i.fix}`).join("\n")}`
        : `Saved the ${v.name} version. It passes.`,
      { platform: v.platform, route: v.route, issues: v.issues.map(({ rule, problem, fix }) => ({ rule, problem, fix })) },
    );
  },
});

const listVersions = tool({
  name: "list_post_versions",
  title: "List a post's platform versions",
  description: "Every platform version of one board post, with its text, status and whether it passes that platform's rules.",
  input: z.object({ post_id: postArg }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run({ memberId }, args) {
    const who = await actorFor(memberId);
    if (!who.ok) return refuse(who.error);
    const list = await listVariants(who.actor, args.post_id, await isPaid(who.actor.accountId));
    if (!list) return refuse("That post is not on your board.");
    if (list.length === 0) return ok("This card has no text yet.");
    return ok(
      list
        .map((v) => `## ${v.name} (${v.status}, ${v.route})\n${v.text}${v.issues.length ? `\nTo fix: ${v.issues.map((i) => i.problem).join(" ")}` : ""}`)
        .join("\n\n"),
      { versions: list.map((v) => ({ platform: v.platform, status: v.status, route: v.route, text: v.text })) },
    );
  },
});

const sharePost = tool({
  name: "share_post",
  title: "Share a post to other platforms",
  description:
    "For each platform named, returns a link that opens that platform's compose screen with the post filled in, or the text to copy where the platform has no such link. The member presses Post there themselves. Use the platform's saved version from adapt_post, or the LinkedIn text when it fits. Only call it when the member asks to post there.",
  input: z.object({
    post_id: postArg,
    platforms: z.array(platformArg).min(1).max(7),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  async run({ memberId }, args) {
    const who = await actorFor(memberId);
    if (!who.ok) return refuse(who.error);
    const paid = await isPaid(who.actor.accountId);
    const versions = await listVariants(who.actor, args.post_id, paid);
    if (!versions) return refuse("That post is not on your board.");
    const linkedin = versions.find((v) => v.platform === "linkedin");
    if (!linkedin) return refuse("That card is an idea with no text yet. Write the post first.");

    const lines: string[] = [];
    const out: Record<string, unknown>[] = [];
    for (const id of new Set(args.platforms)) {
      const p = PLATFORMS[id];
      const saved = versions.find((v) => v.platform === id);
      const text = saved?.text ?? linkedin.text;
      const issues = checkForPlatform(id, text);
      if (issues.length > 0) {
        lines.push(
          `- ${p.name}: not ready. ${issues[0].problem} ${saved ? "Fix the saved version" : "Write a version with adapt_post"} first.`,
        );
        out.push({ platform: id, ready: false, problems: issues.map((i) => i.problem) });
        continue;
      }
      await markShared(who.actor, args.post_id, id, text);
      const url = p.shareUrl ? p.shareUrl(text) : null;
      lines.push(
        url
          ? `- ${p.name}: [open ${p.name} with the post filled in](${url})`
          : `- ${p.name}: copy this and paste it in ${p.name}${p.needsMedia ? `, with ${p.needsMedia === "image" ? "an image" : "a video"}` : ""}:\n\n${text}\n`,
      );
      out.push({ platform: id, ready: true, share_url: url, text });
    }

    return ok(
      [
        ...lines,
        "",
        "Nothing has been posted yet: the member presses Post on each platform.",
        paid ? "" : "On a paid plan, LinkedIn already publishes through its API with schedule_post; the other platforms join as their API access arrives.",
      ]
        .filter((l) => l !== "")
        .join("\n"),
      { shares: out },
    );
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const PLATFORM_TOOLS: Tool<any>[] = [
  listPlatforms,
  checkPostTool,
  adaptPost,
  listVersions,
  sharePost,
];
