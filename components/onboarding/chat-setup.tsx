import Link from "next/link";
import { headers } from "next/headers";
import { siteUrl } from "@/lib/base-path";
import { MCP_PATH } from "@/lib/oauth/metadata";
import { FREE_LIMITS } from "@/lib/tiers";

/**
 * Onboarding on a deployment that does not write with our own model, which
 * is the free tier as it is being tested. Instead of the funnel's questions,
 * one screen: add the connector to your AI chat, paste one message, and the
 * chat reads your site and sets up the board with set_up_brand. The board
 * opens as soon as it has.
 */
export async function ChatSetup({ name }: { name: string | null }) {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "goodsocials.co";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const url = `${siteUrl(`${proto}://${host}`)}${MCP_PATH}`;
  const message =
    "Set up my GoodSocials board. Read my website at <your site>, then use the GoodSocials connector: read_skill first, then set_up_brand with my voice, format and visual principles and four themes. Show me what you wrote before saving.";

  return (
    <main className="mx-auto max-w-[640px] px-6 py-16">
      <div className="card-lift rounded-[var(--r-xl)] p-8 sm:p-10">
        <h1 className="text-[32px] font-semibold leading-[1.1] tracking-[-0.03em]">
          {name ? `${name.split(" ")[0]}, set up your board in your AI chat.` : "Set up your board in your AI chat."}
        </h1>
        <p className="mt-3 text-ink-2">
          On the free plan your own AI chat does the writing, starting with your
          brand. It takes about two minutes.
        </p>
        <ol className="mt-8 space-y-6 text-[15px] leading-[1.5]">
          <li>
            <span className="font-medium">1. Add the connector.</span> In Claude open
            Settings, then Connectors, then Add custom connector. In ChatGPT turn on
            developer mode and add a connector. Use this address:
            <code className="num mt-2 block select-all break-all rounded-[10px] border border-hairline bg-surface px-4 py-3 text-[15px]">
              {url}
            </code>
          </li>
          <li>
            <span className="font-medium">2. Press Connect and Allow.</span> You are
            already signed in here, so it is one click.
          </li>
          <li>
            <span className="font-medium">3. Paste this in a new chat,</span> with your
            website in it:
            <code className="mt-2 block select-all whitespace-pre-wrap rounded-[10px] border border-hairline bg-surface px-4 py-3 text-[14px]">
              {message}
            </code>
          </li>
          <li>
            <span className="font-medium">4. Open your board.</span> It opens once the
            chat has saved your brand.
          </li>
        </ol>
        <Link
          href="/board"
          className="pill btn-ink mt-10 block bg-ink px-6 py-[14px] text-center text-[17px] text-paper"
        >
          Open my board
        </Link>
        <p className="mt-4 text-center text-[13px] text-ink-3">
          Free: {FREE_LIMITS.postsPerMonth} posts a month, {FREE_LIMITS.storedDrafts} drafts
          on the board at once.
        </p>
      </div>
    </main>
  );
}
