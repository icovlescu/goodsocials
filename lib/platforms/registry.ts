import { checkPost, type QualityIssue } from "@/lib/quality";

/**
 * Every social platform GoodSocials writes for, in one table.
 *
 * Each platform publishes in up to two modes, and the member approves the post
 * by hand in both:
 *
 * - `share`: GoodSocials opens the platform's own compose screen with the
 *   post already in it (a web intent link), and the member presses Post there.
 *   No API, no token, no app review, so it works on the free tier and on day
 *   one for every platform. Where a platform has no prefill link (Instagram,
 *   and Facebook, whose sharer takes a URL and not text), the fallback is copy
 *   the text, plus the phone's share sheet on the board.
 * - `api`: GoodSocials publishes through the platform's API at the scheduled
 *   time, after the member approved it. The paid route. Only LinkedIn has an
 *   adapter today (lib/publish.ts); the others are designed in here and say
 *   so until their API access exists.
 *
 * Adding Threads, Bluesky or TikTok properly is filling in their entry and
 * writing an API adapter. Nothing else in the repo names a platform.
 */

export const PLATFORM_IDS = [
  "linkedin",
  "x",
  "instagram",
  "facebook",
  "threads",
  "bluesky",
  "tiktok",
] as const;
export type PlatformId = (typeof PLATFORM_IDS)[number];

export function isPlatform(value: string): value is PlatformId {
  return (PLATFORM_IDS as readonly string[]).includes(value);
}

/**
 * `live`: an API adapter publishes it. `share`: share mode only, the API
 * adapter is designed but not built. `reserved`: a slot with limits written
 * down, share mode where a link exists, no API work yet.
 */
export type ApiStatus = "live" | "share" | "reserved";

export type Platform = {
  id: PlatformId;
  name: string;
  api: ApiStatus;
  /** What the API adapter needs before it can exist, said plainly. */
  apiNote: string;
  /** Hard limit. X counts a link as 23 characters; we count it as written. */
  maxChars: number;
  /** Where the feed cuts the text with "see more". */
  foldChars?: number;
  maxHashtags?: number;
  /** The platform will not post text alone. */
  needsMedia?: "image" | "video";
  /** Links in the text that do not click, or that the feed holds back. */
  links: "ok" | "not_clickable" | "penalised";
  /** How a post should read here, for the chat that adapts it. */
  style: string;
  /** The prefilled compose screen, or null when the platform has none for text. */
  shareUrl: ((text: string) => string) | null;
};

const enc = encodeURIComponent;

export const PLATFORMS: Record<PlatformId, Platform> = {
  linkedin: {
    id: "linkedin",
    name: "LinkedIn",
    api: "live",
    apiNote: "Live. Personal profiles through Share on LinkedIn. Company pages need the Community Management API, which LinkedIn gates.",
    maxChars: 3000,
    foldChars: 210,
    links: "penalised",
    style:
      "Professional, specific, one finding per post. The first two lines carry it, because the feed folds at about 210 characters. Short paragraphs, white space between them. Zero to three hashtags at the end.",
    shareUrl: (text) => `https://www.linkedin.com/feed/?shareActive=true&text=${enc(text)}`,
  },
  x: {
    id: "x",
    name: "X",
    api: "share",
    apiNote: "Designed. Needs an X API plan with write access (paid per month by X) and OAuth 2.0 with tweet.write.",
    maxChars: 280,
    maxHashtags: 2,
    links: "penalised",
    style:
      "One sharp line with the number in it. Under 280 characters including spaces. A thread only when the member asks for one. Two hashtags at most, often none.",
    shareUrl: (text) => `https://x.com/intent/post?text=${enc(text)}`,
  },
  instagram: {
    id: "instagram",
    name: "Instagram",
    api: "share",
    apiNote: "Designed. Needs a professional account linked to a Facebook Page and Meta app review for content publishing. Every post needs an image or video.",
    maxChars: 2200,
    foldChars: 125,
    maxHashtags: 30,
    needsMedia: "image",
    links: "not_clickable",
    style:
      "The picture carries the post; the caption explains it. First 125 characters before the fold. No links, they do not click: say \"link in bio\". Three to eight specific hashtags in a block at the end.",
    shareUrl: null,
  },
  facebook: {
    id: "facebook",
    name: "Facebook",
    api: "share",
    apiNote: "Designed. Pages only, through the Graph API with pages_manage_posts after Meta app review. Personal profiles have no publishing API.",
    maxChars: 63206,
    foldChars: 480,
    links: "ok",
    style:
      "Conversational and local. A question to the community works here. Links are fine and get a preview card. Hashtags rarely help.",
    // The sharer takes a URL, not text, so the board copies the text instead.
    shareUrl: null,
  },
  threads: {
    id: "threads",
    name: "Threads",
    api: "reserved",
    apiNote: "Reserved. Meta's Threads API publishes for professional accounts after app review.",
    maxChars: 500,
    maxHashtags: 1,
    links: "ok",
    style: "Casual, short, one idea. One topic tag at most.",
    shareUrl: (text) => `https://www.threads.net/intent/post?text=${enc(text)}`,
  },
  bluesky: {
    id: "bluesky",
    name: "Bluesky",
    api: "reserved",
    apiNote: "Reserved. The AT Protocol API is open and free, with an app password or OAuth. The cheapest API adapter to build next.",
    maxChars: 300,
    links: "ok",
    style: "Plain and direct, like early Twitter. Under 300 characters.",
    shareUrl: (text) => `https://bsky.app/intent/compose?text=${enc(text)}`,
  },
  tiktok: {
    id: "tiktok",
    name: "TikTok",
    api: "reserved",
    apiNote: "Reserved. The Content Posting API needs app review, and every post is a video.",
    maxChars: 2200,
    needsMedia: "video",
    links: "not_clickable",
    style: "A caption for a video: a hook in the first line, three to five hashtags.",
    shareUrl: null,
  },
};

const HASHTAG = /(^|\s)#[\p{L}\p{N}_]+/gu;
const URL = /https?:\/\/\S+/;

/**
 * The writing rules for one platform. LinkedIn gets every rule in
 * lib/quality.ts, which is what its queue enforces. The others get the same
 * voice rules (dashes, banned words, third person, brackets) with their own
 * length, hashtag and link limits in place of LinkedIn's.
 */
export function checkForPlatform(id: PlatformId, text: string): QualityIssue[] {
  if (id === "linkedin") return checkPost(text);

  const p = PLATFORMS[id];
  const body = text.trim();
  const issues = checkPost(body).filter(
    (i) => i.rule !== "too_short" && i.rule !== "cut_off" && i.rule !== "repeat",
  );

  if (body.length === 0) {
    issues.push({ rule: "too_short", problem: "The post is empty.", fix: "Write the post first." });
  }
  if (body.length > p.maxChars) {
    issues.push({
      rule: "cut_off",
      problem: `${p.name} allows ${p.maxChars.toLocaleString("en")} characters and this is ${body.length.toLocaleString("en")}.`,
      fix: `Cut it to under ${p.maxChars} characters. Keep the opening finding.`,
    });
  }
  const tags = body.match(HASHTAG)?.length ?? 0;
  if (p.maxHashtags !== undefined && tags > p.maxHashtags) {
    issues.push({
      rule: "hashtags",
      problem: `${tags} hashtags, and ${p.name} reads more than ${p.maxHashtags} as spam.`,
      fix: `Keep the ${p.maxHashtags} most specific hashtags.`,
    });
  }
  if (p.links === "not_clickable" && URL.test(body)) {
    issues.push({
      rule: "link",
      problem: `Links do not click on ${p.name}.`,
      fix: 'Remove the link and say "link in bio".',
    });
  }
  return issues;
}

/** How a post reaches this platform today, for this tier. */
export function routeFor(id: PlatformId, paid: boolean): "api" | "share" | "copy" {
  const p = PLATFORMS[id];
  if (p.api === "live" && (paid || id === "linkedin")) return "api";
  return p.shareUrl ? "share" : "copy";
}

/**
 * Shown wherever a member picks how a post goes out: on the board's share
 * panel, in settings, and in what the connector tells the chat.
 */
export const PUBLISH_DISCLAIMER =
  "You approve every post by hand. Share opens the platform with your post filled in, and you press Post there yourself. Automatic publishing, on paid plans, sends the post you approved through that platform's own API at the time you picked, under the permissions you granted it.";
