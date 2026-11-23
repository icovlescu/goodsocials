import Link from "next/link";
import { SiteNav } from "@/components/marketing/site-nav";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SectionHead } from "@/components/marketing/section-head";
import { Streak } from "@/components/marketing/streak";
import { TrackLanding } from "@/components/marketing/track-landing";
import { PLANS } from "@/lib/plans";
import { paymentsHidden } from "@/lib/flags";
import { ORIGIN } from "@/lib/share";
import { FREE_LIMITS } from "@/lib/tiers";
import {
  PLATFORMS,
  PLATFORM_IDS,
  PUBLISH_DISCLAIMER,
} from "@/lib/platforms/registry";
import { SUPPORT } from "@/lib/legal";

/**
 * The landing page of the pivot product at /v2. One claim: the member's own
 * AI chat writes, GoodSocials keeps the brand, the business data and the
 * publishing, and the free plan is the way in. Rendered by app/page.tsx when
 * isPivot() is true, so the v1 page stays exactly what it was.
 *
 * Every number on it comes from the constant the product runs on.
 */

const wrap = "mx-auto w-full max-w-[1160px] px-6";
const band = "py-[96px]";

const LOOP = [
  {
    title: "Connect your business",
    body: "Sign in with LinkedIn, paste your website, and connect Stripe, PostHog, Plausible, GitHub or Notion with a read-only key. GoodSocials reads them every day.",
  },
  {
    title: "Write in your own AI chat",
    body: "Add GoodSocials as a connector in Claude, ChatGPT or any chat that supports MCP. The chat reads your voice, your themes and your real numbers, and writes on your own plan.",
  },
  {
    title: "Approve, then publish",
    body: "Drafts land on your GoodSocials board. You approve each one. LinkedIn publishes at 09:00 on the day you pick, and every other platform opens with your post filled in.",
  },
];

export async function PivotLanding({ signedIn }: { signedIn: boolean }) {
  const hidePayments = paymentsHidden();
  const pro = PLANS[0];
  const start = signedIn ? "/board" : "/signin";

  return (
    <>
      <SiteNav signedIn={signedIn} />
      {signedIn ? null : <TrackLanding />}
      <main className="bg-paper">
        <section className={`${wrap} pb-[80px] pt-[56px] text-center`}>
          <div className="mx-auto mb-8 w-fit">
            <Streak posted={18} size={56} />
          </div>
          <h1 className="mx-auto max-w-[820px] text-[44px] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-[60px]">
            Your AI chat writes the posts. GoodSocials keeps them coming.
          </h1>
          <p className="mx-auto mt-6 max-w-[640px] text-[19px] leading-[1.45] text-ink-2">
            Connect your business data once. Write LinkedIn posts in Claude,
            ChatGPT or any chat that supports connectors, on the plan you
            already pay for. Approve them on a board and post close to daily.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              href={start}
              className="pill btn-ink bg-ink px-7 py-[14px] text-[17px] text-paper"
            >
              {signedIn ? "Open your board" : `Start free, ${FREE_LIMITS.postsPerMonth} posts a month`}
            </Link>
            <Link href="/docs#claude" className="text-[15px] text-ink-2 underline">
              How the connector works
            </Link>
          </div>
          <p className="mt-4 text-[13px] text-ink-3">No card for the free plan.</p>
        </section>

        <section className={`${wrap} ${band} border-t border-hairline`}>
          <SectionHead eyebrow="How it works" title="Three steps, and you approve every post.">
            The chat does the writing. GoodSocials holds what makes it yours:
            your principles, your themes, your numbers and your calendar.
          </SectionHead>
          <ol className="mt-12 grid gap-6 md:grid-cols-3">
            {LOOP.map((step, i) => (
              <li key={step.title} className="card-lift rounded-[var(--r-xl)] p-7">
                <p className="num font-mono text-[13px] text-ink-3">{i + 1}</p>
                <h3 className="mt-3 text-[20px] font-semibold tracking-[-0.02em]">{step.title}</h3>
                <p className="mt-3 text-[15px] leading-[1.5] text-ink-2">{step.body}</p>
              </li>
            ))}
          </ol>
          <div className="card-lift mx-auto mt-12 max-w-[720px] rounded-[var(--r-xl)] p-6 text-left">
            <p className="text-[13px] font-medium text-ink-2">Connector URL</p>
            <code className="num mt-2 block select-all break-all text-[17px]">{ORIGIN}/api/mcp</code>
            <p className="mt-3 text-[13px] text-ink-3">
              In Claude: Settings, Connectors, Add custom connector. In ChatGPT:
              developer mode, then add a connector with the same address.
            </p>
          </div>
        </section>

        <section className={`${wrap} ${band} border-t border-hairline`}>
          <SectionHead eyebrow="Platforms" title="One post, written for each feed.">
            LinkedIn publishes automatically today. The chat rewrites the same
            post for the others, each checked against its own limits.
          </SectionHead>
          <ul className="mx-auto mt-12 max-w-[760px]">
            {PLATFORM_IDS.map((id) => {
              const p = PLATFORMS[id];
              const how =
                p.api === "live"
                  ? "Publishes automatically"
                  : p.shareUrl
                    ? "Opens with your post filled in"
                    : "Copy and post in the app";
              return (
                <li
                  key={id}
                  className="flex items-baseline justify-between gap-6 border-b border-hairline py-[14px]"
                >
                  <span className="text-[17px]">{p.name}</span>
                  <span className="text-right text-[15px] text-ink-2">
                    {how}
                    {p.api === "share" ? ", API coming" : ""}
                    {p.api === "reserved" ? ", later" : ""}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mx-auto mt-6 max-w-[760px] text-[13px] leading-[1.5] text-ink-3">
            {PUBLISH_DISCLAIMER}
          </p>
        </section>

        <section id="plans" className={`${wrap} ${band} border-t border-hairline`}>
          <SectionHead eyebrow="Plans" title="Free to start. Paid when it is working.">
            The free plan is the whole loop with limits. The paid plan removes
            them and adds the parts that run without you.
          </SectionHead>
          <div className="mx-auto mt-12 grid max-w-[900px] gap-6 md:grid-cols-2">
            <div className="card-lift rounded-[var(--r-xl)] p-8">
              <h3 className="text-[22px] font-semibold">Free</h3>
              <p className="num mt-1 text-[15px] text-ink-2">0 USD</p>
              <ul className="mt-6 space-y-3 text-[15px] leading-[1.45]">
                <li>{FREE_LIMITS.postsPerMonth} posts a month published to LinkedIn</li>
                <li>{FREE_LIMITS.storedDrafts} drafts kept on your board at once</li>
                <li>Writing in your own AI chat, on your own plan</li>
                <li>Business data from Stripe, PostHog and three more</li>
                <li>Share links for X, Instagram, Facebook, Threads and Bluesky</li>
                <li>Writing rules checked before every post</li>
              </ul>
              <Link
                href={start}
                className="pill btn-ink mt-8 block bg-ink px-6 py-[12px] text-center text-[15px] text-paper"
              >
                Start free
              </Link>
            </div>
            <div className="card-lift rounded-[var(--r-xl)] p-8">
              <h3 className="text-[22px] font-semibold">{pro.name}</h3>
              <p className="num mt-1 text-[15px] text-ink-2">
                {hidePayments ? "Pricing soon" : `${pro.price} a month`}
              </p>
              <ul className="mt-6 space-y-3 text-[15px] leading-[1.45]">
                <li>No monthly post limit</li>
                <li>An editor review of every post before it is scheduled</li>
                <li>The board writes ideas and drafts on its own, with images</li>
                <li>Automatic publishing through each platform&apos;s API</li>
                <li>Agency seats for up to 12 profiles</li>
              </ul>
              <Link
                href={hidePayments ? start : "/pricing"}
                className="pill btn-outline mt-8 block border border-hairline bg-surface px-6 py-[12px] text-center text-[15px]"
              >
                {hidePayments ? "Start free" : `See plans from ${pro.price}`}
              </Link>
            </div>
          </div>
          <p className="mx-auto mt-8 max-w-[640px] text-center text-[15px] text-ink-2">
            NGOs and universities get extended use at a reduced price. Write to{" "}
            <a className="underline" href={`mailto:${SUPPORT}`}>
              {SUPPORT}
            </a>
            .
          </p>
        </section>
      </main>
      <SiteFooter signedIn={signedIn} />
    </>
  );
}
