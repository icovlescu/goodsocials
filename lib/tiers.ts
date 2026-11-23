import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { getDb } from "@/db";
import {
  account as accountTable,
  board as boardTable,
  card as cardTable,
  profile as profileTable,
  scheduledPost,
} from "@/db/schema";
import { isSubscribed } from "@/lib/billing";

/**
 * Free and paid, for posts written in the member's own AI chat.
 *
 * Free is the way in: the member's chat writes, so the text costs us nothing,
 * and the limits are what make it a taste rather than the product. Five posts
 * a month reach a feed, five drafts wait on the board at once, publishing is a
 * share link the member presses Post on, and the writing rules are checked in
 * code. Paid adds the editor pass in lib/agent/review.ts on every post, the
 * board's own agent, and publishing through each platform's API.
 *
 * Counted on `card.origin = 'connector'` only. The board's agent spends our
 * key and is a paid feature already gated by canPublish.
 */

export type Tier = "free" | "paid";

export const FREE_LIMITS = {
  /** Connector posts given a publish slot in one calendar month (UTC). */
  postsPerMonth: 5,
  /** Connector cards waiting on the board, in Idea, Draft or Image. */
  storedDrafts: 5,
} as const;

export function tierOf(account: Pick<typeof accountTable.$inferSelect, "subscriptionStatus">): Tier {
  return isSubscribed(account) ? "paid" : "free";
}

export type Usage = {
  tier: Tier;
  postsThisMonth: number;
  storedDrafts: number;
  /** Null on paid, which has no cap here. */
  postsLeft: number | null;
  draftsLeft: number | null;
};

function monthBounds(now: Date): [Date, Date] {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return [start, end];
}

/** Across every profile on the account, because the free tier is per account. */
export async function usageFor(accountId: string, now = new Date()): Promise<Usage> {
  const db = getDb();
  const [acct] = await db
    .select({ subscriptionStatus: accountTable.subscriptionStatus })
    .from(accountTable)
    .where(eq(accountTable.id, accountId))
    .limit(1);
  const tier = acct ? tierOf(acct) : "free";
  const [start, end] = monthBounds(now);

  const [posts, drafts] = await Promise.all([
    db
      .select({ id: scheduledPost.id })
      .from(scheduledPost)
      .innerJoin(cardTable, eq(scheduledPost.cardId, cardTable.id))
      .innerJoin(profileTable, eq(scheduledPost.profileId, profileTable.id))
      .where(
        and(
          eq(profileTable.accountId, accountId),
          eq(cardTable.origin, "connector"),
          gte(scheduledPost.publishAt, start),
          lt(scheduledPost.publishAt, end),
        ),
      ),
    db
      .select({ id: cardTable.id })
      .from(cardTable)
      .innerJoin(boardTable, eq(cardTable.boardId, boardTable.id))
      .innerJoin(profileTable, eq(boardTable.profileId, profileTable.id))
      .where(
        and(
          eq(profileTable.accountId, accountId),
          eq(cardTable.origin, "connector"),
          inArray(cardTable.state, ["idea", "draft", "image"]),
        ),
      ),
  ]);

  const free = tier === "free";
  return {
    tier,
    postsThisMonth: posts.length,
    storedDrafts: drafts.length,
    postsLeft: free ? Math.max(0, FREE_LIMITS.postsPerMonth - posts.length) : null,
    draftsLeft: free ? Math.max(0, FREE_LIMITS.storedDrafts - drafts.length) : null,
  };
}

export function usageLine(u: Usage): string {
  if (u.tier === "paid") return "Paid plan: no monthly post limit from the connector.";
  return `Free plan: ${u.postsLeft} of ${FREE_LIMITS.postsPerMonth} posts left this month, ${u.draftsLeft} of ${FREE_LIMITS.storedDrafts} draft slots free.`;
}

export const UPGRADE_LINE =
  "A plan lifts the limits, adds the editor review on every post and publishes through each platform's API at the time you pick.";
