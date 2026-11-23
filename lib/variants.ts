import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  board as boardTable,
  card as cardTable,
  postVariant,
  profile as profileTable,
} from "@/db/schema";
import type { Actor } from "@/lib/profiles";
import { PLATFORMS, checkForPlatform, routeFor, type PlatformId } from "@/lib/platforms/registry";
import type { QualityIssue } from "@/lib/quality";

/**
 * One post on several platforms. The card's text is the LinkedIn version and
 * goes through the queue; each other platform is a `post_variant` row with its
 * own text, written by the member's chat to that platform's limits.
 *
 * Every read and write is scoped through the card's board to the actor's
 * account, the same boundary lib/cards.ts uses.
 */

export type Variant = {
  platform: PlatformId;
  name: string;
  text: string;
  status: string;
  route: "api" | "share" | "copy";
  shareUrl: string | null;
  issues: QualityIssue[];
  pushedAt: Date | null;
};

async function ownedCard(actor: Pick<Actor, "accountId">, cardId: string) {
  const [row] = await getDb()
    .select({ card: cardTable })
    .from(cardTable)
    .innerJoin(boardTable, eq(cardTable.boardId, boardTable.id))
    .innerJoin(profileTable, eq(boardTable.profileId, profileTable.id))
    .where(and(eq(cardTable.id, cardId), eq(profileTable.accountId, actor.accountId)))
    .limit(1);
  return row?.card ?? null;
}

function shape(
  platform: PlatformId,
  text: string,
  status: string,
  pushedAt: Date | null,
  paid: boolean,
): Variant {
  const p = PLATFORMS[platform];
  return {
    platform,
    name: p.name,
    text,
    status,
    route: routeFor(platform, paid),
    shareUrl: p.shareUrl ? p.shareUrl(text) : null,
    issues: checkForPlatform(platform, text),
    pushedAt,
  };
}

export async function saveVariant(
  actor: Pick<Actor, "accountId">,
  cardId: string,
  platform: PlatformId,
  text: string,
  paid: boolean,
): Promise<{ ok: true; variant: Variant } | { ok: false; error: string }> {
  if (platform === "linkedin") {
    return { ok: false, error: "The LinkedIn version is the post's own text. Use update_draft for it." };
  }
  const body = text.trim();
  if (!body) return { ok: false, error: "The text is empty." };
  if (body.length > PLATFORMS[platform].maxChars * 2) {
    return { ok: false, error: `That is far past ${PLATFORMS[platform].name}'s limit. Cut it first.` };
  }
  const card = await ownedCard(actor, cardId);
  if (!card) return { ok: false, error: "That post is not on your board." };
  if (card.state === "rejected") return { ok: false, error: "That card was rejected." };

  await getDb()
    .insert(postVariant)
    .values({ cardId, platform, text: body })
    .onConflictDoUpdate({
      target: [postVariant.cardId, postVariant.platform],
      set: { text: body, status: "draft", updatedAt: new Date() },
    });

  return { ok: true, variant: shape(platform, body, "draft", null, paid) };
}

/** Every platform version of a card, LinkedIn first from the card itself. */
export async function listVariants(
  actor: Pick<Actor, "accountId">,
  cardId: string,
  paid: boolean,
): Promise<Variant[] | null> {
  const card = await ownedCard(actor, cardId);
  if (!card) return null;
  const rows = await getDb()
    .select()
    .from(postVariant)
    .where(eq(postVariant.cardId, cardId))
    .orderBy(asc(postVariant.createdAt));

  const out: Variant[] = [];
  if (card.draftText) {
    out.push(
      shape("linkedin", card.draftText, card.state === "posted" ? "published" : card.state, null, paid),
    );
  }
  for (const r of rows) {
    if (r.platform in PLATFORMS && r.platform !== "linkedin") {
      out.push(shape(r.platform as PlatformId, r.text, r.status, r.pushedAt, paid));
    }
  }
  return out;
}

/**
 * The member was handed the share link or the text for this platform. We
 * cannot see whether they pressed Post, so this records the hand off and
 * nothing more, and says so.
 */
export async function markShared(
  actor: Pick<Actor, "accountId">,
  cardId: string,
  platform: PlatformId,
  text: string,
): Promise<boolean> {
  const card = await ownedCard(actor, cardId);
  if (!card) return false;
  const now = new Date();
  await getDb()
    .insert(postVariant)
    .values({ cardId, platform, text, status: "manual", pushedAt: now })
    .onConflictDoUpdate({
      target: [postVariant.cardId, postVariant.platform],
      set: { status: "manual", pushedAt: now, updatedAt: now },
    });
  return true;
}

/**
 * What the board's share panel shows: every platform, with its saved version
 * or the card's own text when nobody wrote one, whether that text fits, and
 * the link or copy route. Plain data, so a client component can render it.
 */
export type ShareOption = {
  platform: PlatformId;
  name: string;
  text: string;
  adapted: boolean;
  shareUrl: string | null;
  needsMedia: "image" | "video" | null;
  problems: string[];
  status: string | null;
};

export async function shareOptions(
  actor: Pick<Actor, "accountId">,
  cardId: string,
): Promise<ShareOption[] | null> {
  const list = await listVariants(actor, cardId, false);
  if (!list) return null;
  const base = list.find((v) => v.platform === "linkedin");
  if (!base) return [];
  return (Object.keys(PLATFORMS) as PlatformId[]).map((id) => {
    const saved = list.find((v) => v.platform === id && id !== "linkedin");
    const text = id === "linkedin" ? base.text : (saved?.text ?? base.text);
    const p = PLATFORMS[id];
    return {
      platform: id,
      name: p.name,
      text,
      adapted: id === "linkedin" || Boolean(saved),
      shareUrl: p.shareUrl ? p.shareUrl(text) : null,
      needsMedia: p.needsMedia ?? null,
      problems: checkForPlatform(id, text).map((i) => i.problem),
      status: saved?.status ?? null,
    };
  });
}
