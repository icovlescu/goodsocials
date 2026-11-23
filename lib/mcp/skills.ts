import { FREE_LIMITS } from "@/lib/tiers";
import {
  PLATFORMS,
  PLATFORM_IDS,
  PUBLISH_DISCLAIMER,
  type PlatformId,
} from "@/lib/platforms/registry";

/**
 * The skills a chat reads before it works the board. Plain markdown, served
 * three ways so every MCP client finds them: the `read_skill` tool (works
 * everywhere), MCP resources (`goodsocials://skill/<name>`), and the
 * `write_post` prompt. The text is the same in all three.
 *
 * Written for any model in any chat. Nothing here assumes Claude.
 */

const PLAYBOOK = `# GoodSocials playbook

GoodSocials keeps the member's social media board: brand principles, themes, business data, a queue and a publisher. You write the posts, in this chat. The member approves every one by hand.

## The loop
1. **Read.** Call get_brand_context (voice, themes, rules, recent posts, plan limits) and get_business_data (real numbers from Stripe, PostHog and the rest, plus notes the member saved).
2. **Find the post.** The best posts come from the business data: a number that moved, a milestone, a pattern customers show. One finding per post. If the post needs a number that is not in the data, ask the member for it. Never invent one.
3. **Write** for LinkedIn first, in the voice principle, within the writing rules. Call check_post before showing it.
4. **Show** the member the full text. Revise in the chat until they are happy.
5. **Save** with create_draft. It lands on the GoodSocials board.
6. **Other platforms.** If the member wants the post on X, Instagram, Facebook or elsewhere, rewrite it for each one's limits and style (read_skill with the platform name), call check_post with that platform, and save each version with adapt_post.
7. **Publish**, only when the member says so:
   - LinkedIn: schedule_post (next free 09:00, or a day they pick), or publish_now.
   - Any platform: share_post gives a link that opens the platform with the post filled in. The member presses Post there.
8. **Learn.** When the member corrects something that should hold for every future post, call update_brand_principle. When they tell you a fact about the business worth reusing, call add_business_note.

## Plans
- Free: ${FREE_LIMITS.postsPerMonth} posts a month reach a feed, ${FREE_LIMITS.storedDrafts} drafts wait on the board at once, publishing to other platforms is by share link, and the writing rules are checked in code.
- Paid: no monthly limit, an editor review of every post before it takes a slot, the board's own agent writing ideas and drafts, and publishing through each platform's API at the scheduled time.
- When a limit is reached, the tool says so. Tell the member plainly; do not work around it.

## Publishing
${PUBLISH_DISCLAIMER}

## Never
- Publish or schedule without the member's explicit yes in this chat.
- Ask the member to paste an API key in the chat. Data sources connect on the GoodSocials website (connect_data_source gives the link).
- Invent customers, numbers, quotes or results.
`;

function platformSkill(id: PlatformId): string {
  const p = PLATFORMS[id];
  return [
    `# Writing for ${p.name}`,
    p.style,
    "",
    `- Limit: ${p.maxChars.toLocaleString("en")} characters.${p.foldChars ? ` The feed folds at about ${p.foldChars}.` : ""}`,
    p.maxHashtags !== undefined ? `- Hashtags: at most ${p.maxHashtags}.` : null,
    p.needsMedia ? `- Needs ${p.needsMedia === "image" ? "an image" : "a video"} to post. The member adds it when they press Post.` : null,
    p.links === "not_clickable" ? "- Links do not click. Say \"link in bio\"." : null,
    p.links === "penalised" ? "- Links in the text get less reach. Put the link in the last line, or leave it out." : null,
    `- Publishing: ${p.shareUrl ? "share link that opens the compose screen with the text in it" : "copy the text and paste it in the app"}. API: ${p.apiNote}`,
    "- The voice rules still hold: third person, no long dashes, no banned words.",
  ]
    .filter(Boolean)
    .join("\n");
}

export type Skill = { name: string; title: string; description: string; text: () => string };

export const SKILLS: Skill[] = [
  {
    name: "playbook",
    title: "GoodSocials playbook",
    description: "How to work the board: read, write, check, save, adapt, publish, learn. Read first.",
    text: () => PLAYBOOK,
  },
  ...PLATFORM_IDS.map((id) => ({
    name: id,
    title: `Writing for ${PLATFORMS[id].name}`,
    description: `Limits, style and publishing route for ${PLATFORMS[id].name}.`,
    text: () => platformSkill(id),
  })),
];

export function findSkill(name: string): Skill | undefined {
  return SKILLS.find((s) => s.name === name.toLowerCase());
}
