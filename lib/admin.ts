import { createHash } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db";
import {
  account as accountTable,
  adminMember,
  board as boardTable,
  funnelEvent,
  profile as profileTable,
} from "@/db/schema";
import { canPublish } from "@/lib/billing";
import {
  QUESTIONS,
  SKIP_QUESTION,
  parseFunnel,
  stepIndex,
  type Answer,
  type Funnel,
  type Question,
  type QuestionStep,
} from "@/lib/funnel-steps";
import { loadViewer } from "@/lib/viewer";

/**
 * The admin pipeline: every visitor, who registered, what they answered, and
 * how far they got towards paying. Read only. The page is app/admin.
 *
 * Gated two ways. ADMIN_EMAILS is the signed in member's LinkedIn email,
 * which LinkedIn verifies, kept as a constant because changing it should be a
 * reviewed commit. admin_member holds a SHA-256 of a member id, written by the
 * first member to claim the page on a deployment with no admin yet, so a fork
 * gets an admin by signing in and nobody's id or email is stored or committed.
 */
export const ADMIN_EMAILS = ["pavel.kucherbaev@gmail.com"];

/** One way, salted with the product name so the hash matches nothing else. */
export function adminHash(memberId: string): string {
  return createHash("sha256").update(`goodsocials-admin:${memberId}`).digest("hex");
}

async function hashIsAdmin(memberId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ h: adminMember.memberHash })
    .from(adminMember)
    .where(eq(adminMember.memberHash, adminHash(memberId)))
    .limit(1);
  return Boolean(row);
}

export async function isAdmin(): Promise<boolean> {
  const session = await auth();
  if (!session?.memberId) return false;
  if (await hashIsAdmin(session.memberId)) return true;
  const viewer = await loadViewer();
  const email = viewer?.email?.trim().toLowerCase();
  return Boolean(email && ADMIN_EMAILS.includes(email));
}

/**
 * Whether the signed in member may claim the admin pages: signed in, and no
 * admin_member row exists yet. Null when nobody is signed in.
 */
export async function canClaimAdmin(): Promise<boolean> {
  const session = await auth();
  if (!session?.memberId) return false;
  const [row] = await getDb().select({ h: adminMember.memberHash }).from(adminMember).limit(1);
  return !row;
}

/**
 * Makes the signed in member the admin, only while there is none. One
 * statement, so two members pressing Claim at once cannot both win on a
 * table that was empty when each looked.
 */
export async function claimAdmin(): Promise<boolean> {
  const session = await auth();
  if (!session?.memberId) return false;
  const rows = await getDb().execute(sql`
    insert into admin_member (member_hash)
    select ${adminHash(session.memberId)}
    where not exists (select 1 from admin_member)
    returning member_hash`);
  return rows.rows.length > 0;
}

/**
 * The door every /api/admin route uses: an admin session, or the old ?k= key
 * for a script or a database with no admin yet. Null means allowed.
 */
export async function adminDenied(url: URL): Promise<string | null> {
  const expected = process.env.LINKEDIN_DEBUG_SECRET;
  if (expected && url.searchParams.get("k") === expected) return null;
  try {
    if (await isAdmin()) return null;
  } catch {
    // No database yet. The key is the only door until there is one.
  }
  return "Sign in with an admin account, then open this page again. On a new deployment, open /admin signed in and press Claim.";
}

/** One browser, by its gs_aid cookie, folded to what the pipeline needs. */
type Visit = {
  anonId: string;
  memberId: string | null;
  firstSeen: Date;
  lastSeen: Date;
  events: string[];
  referrer: string | null;
  utmSource: string | null;
};

export type AnswerRow = { question: string; answer: string };

export type MemberRow = {
  email: string | null;
  name: string | null;
  registeredAt: Date;
  /** Earliest event from any browser this member used, landing page included. */
  firstSeen: Date | null;
  from: string | null;
  site: string | null;
  answers: AnswerRow[];
  /** The funnel step the owner's board is on, or null for a pre-funnel board. */
  step: string | null;
  sawFirstPost: boolean;
  finished: boolean;
  clickedSubscribe: boolean;
  /** Stripe's word for it, or null when there has never been a subscription. */
  subscription: string | null;
  paying: boolean;
  /**
   * Cancelled but not ended yet, trial or paid. Stripe keeps the status at
   * trialing or active until the period runs out, so the status alone does
   * not show it.
   */
  cancelled: boolean;
  /** The day a cancelled subscription stops. */
  endsAt: Date | null;
};

export type AnonRow = {
  firstSeen: Date;
  lastSeen: Date;
  from: string | null;
  furthest: string;
};

export type Pipeline = {
  counts: { label: string; value: number }[];
  members: MemberRow[];
  anonymous: AnonRow[];
  anonymousTotal: number;
  trackingSince: Date | null;
};

const ANON_SHOWN = 200;

export async function loadPipeline(): Promise<Pipeline> {
  const db = getDb();

  const [visits, rows, [since]] = await Promise.all([
    db
      .select({
        anonId: funnelEvent.anonId,
        memberId: sql<string | null>`max(${funnelEvent.memberId})`,
        firstSeen: sql<Date>`min(${funnelEvent.createdAt})`.mapWith(funnelEvent.createdAt),
        lastSeen: sql<Date>`max(${funnelEvent.createdAt})`.mapWith(funnelEvent.createdAt),
        events: sql<string[]>`array_agg(distinct ${funnelEvent.event})`,
        referrer: sql<string | null>`max(${funnelEvent.props}->>'referrer')`,
        utmSource: sql<string | null>`max(${funnelEvent.props}->>'utm_source')`,
      })
      .from(funnelEvent)
      .groupBy(funnelEvent.anonId),
    db
      .select({
        account: accountTable,
        name: profileTable.name,
        profileEmail: profileTable.email,
        funnel: boardTable.funnel,
        siteUrl: boardTable.siteUrl,
      })
      .from(accountTable)
      .leftJoin(profileTable, eq(profileTable.linkedinMemberId, accountTable.ownerMemberId))
      .leftJoin(boardTable, eq(boardTable.profileId, profileTable.id))
      .orderBy(desc(accountTable.createdAt)),
    db.select({ at: sql<Date>`min(${funnelEvent.createdAt})`.mapWith(funnelEvent.createdAt) }).from(funnelEvent),
  ]);

  // A member can arrive from more than one browser, and a browser with no
  // cookie is tracked under the member id itself. Both fold into one.
  const byMember = new Map<string, Visit[]>();
  const anonymous: Visit[] = [];
  for (const visit of visits) {
    if (!visit.memberId) {
      anonymous.push(visit);
      continue;
    }
    byMember.set(visit.memberId, [...(byMember.get(visit.memberId) ?? []), visit]);
  }

  const offerAt = stepIndex("offer");
  const members: MemberRow[] = rows.map((row) => {
    const own = byMember.get(row.account.ownerMemberId) ?? [];
    const events = new Set(own.flatMap((v) => v.events));
    const first = own.reduce<Visit | null>(
      (a, v) => (!a || v.firstSeen < a.firstSeen ? v : a),
      null,
    );
    const funnel = parseFunnel(row.funnel);
    const step = funnel?.step ?? null;

    return {
      email: row.account.email ?? row.profileEmail,
      name: row.name,
      registeredAt: row.account.createdAt,
      firstSeen: first?.firstSeen ?? null,
      from: first ? origin(first) : null,
      site: funnel?.site?.url ?? funnel?.site?.description?.slice(0, 120) ?? row.siteUrl,
      answers: funnel ? answers(funnel.answers) : [],
      step,
      sawFirstPost: events.has("sample_ready") || (step !== null && stepIndex(funnel!.step) >= offerAt),
      finished: step === "done" || events.has("onboarding_finished"),
      // Checkout creates the Stripe customer, so a customer id is the click
      // for accounts that signed up before events were stored.
      clickedSubscribe: events.has("checkout_started") || Boolean(row.account.stripeCustomerId),
      subscription:
        row.account.subscriptionStatus === "none" ? null : row.account.subscriptionStatus,
      paying: canPublish(row.account),
      cancelled: row.account.cancelAtPeriodEnd && canPublish(row.account),
      endsAt: row.account.cancelAtPeriodEnd
        ? (row.account.subscriptionStatus === "trialing" ? row.account.trialEndsAt : null) ??
          row.account.currentPeriodEnd
        : null,
    };
  });

  anonymous.sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());

  const reachedSignin = visits.filter(
    (v) => v.events.includes("signin_viewed") || v.events.includes("signin_started") || v.memberId,
  ).length;

  return {
    counts: [
      { label: "Visited", value: visits.length },
      { label: "Opened sign in", value: reachedSignin },
      { label: "Registered", value: members.length },
      { label: "Answered onboarding", value: members.filter((m) => m.answers.length > 0).length },
      { label: "Saw first post", value: members.filter((m) => m.sawFirstPost).length },
      { label: "Clicked subscribe", value: members.filter((m) => m.clickedSubscribe).length },
      { label: "Subscribed", value: members.filter((m) => m.subscription !== null).length },
      { label: "Paying or trialing now", value: members.filter((m) => m.paying).length },
      { label: "Cancelled, not ended yet", value: members.filter((m) => m.cancelled).length },
      { label: "Finished onboarding", value: members.filter((m) => m.finished).length },
    ],
    members,
    anonymous: anonymous.slice(0, ANON_SHOWN).map((v) => ({
      firstSeen: v.firstSeen,
      lastSeen: v.lastSeen,
      from: origin(v),
      furthest: v.events.includes("signin_started")
        ? "Clicked sign in"
        : v.events.includes("signin_viewed")
          ? "Opened sign in"
          : "Landing page",
    })),
    anonymousTotal: anonymous.length,
    trackingSince: since?.at ?? null,
  };
}

function origin(visit: Visit): string | null {
  return visit.utmSource ?? visit.referrer ?? null;
}

const QUESTION_NAMES: Record<QuestionStep, string> = {
  image: "Image",
  content: "Content",
  goal: "Goal",
  refine: "Refine",
};

function answers(given: Funnel["answers"]): AnswerRow[] {
  const rows = (Object.keys(QUESTION_NAMES) as QuestionStep[]).flatMap((step) => {
    const answer = given[step];
    return answer ? [{ question: QUESTION_NAMES[step], answer: label(QUESTIONS[step], answer) }] : [];
  });
  // Why they passed on the offer. Last, because it is the last thing they said.
  if (given.skip) rows.push({ question: "Not now", answer: label(SKIP_QUESTION, given.skip) });
  return rows;
}

function label(question: Question, answer: Answer): string {
  return answer.choice === "other"
    ? `"${answer.text ?? ""}"`
    : question.options.find((o) => o.id === answer.choice)?.label ?? answer.choice;
}
