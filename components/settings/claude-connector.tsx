import { headers } from "next/headers";
import { disconnectClaude } from "@/app/settings/actions";
import { MCP_PATH } from "@/lib/oauth/metadata";
import { connectedApps } from "@/lib/oauth/server";
import { FREE_LIMITS } from "@/lib/tiers";

/**
 * The connector, in settings: the URL to paste into Claude and the apps
 * that hold a grant, each with a way to cut it off. The URL is built from the
 * request's own host, so a preview shows the preview's connector.
 */
export async function ClaudeConnector({ memberId }: { memberId: string }) {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "goodsocials.co";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const url = `${proto}://${host}${MCP_PATH}`;
  const apps = await connectedApps(memberId);

  return (
    <section id="claude" className="mt-8 max-w-[760px] scroll-mt-[calc(var(--nav-h)+24px)]">
      <h2 className="text-[13px] font-medium text-ink-2">Write in your AI chat</h2>
      <p className="mt-2 max-w-[560px] text-[13px] leading-[1.4] text-ink-2">
        Add GoodSocials as a connector in Claude, ChatGPT or another chat app
        that supports MCP connectors, and write posts in your own chat on your
        own plan. The chat reads your principles, themes and business data,
        saves drafts to this board, and schedules or shares what you approve.
        In Claude open Settings, then Connectors, then Add custom connector,
        and paste this address. The free plan includes {FREE_LIMITS.postsPerMonth}{" "}
        posts a month and {FREE_LIMITS.storedDrafts} drafts on the board at once.
      </p>
      <ul className="mt-2">
        <li className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-hairline py-[14px]">
          <span className="text-[13px] font-medium text-ink-2">Connector URL</span>
          <code className="num select-all break-all text-right text-[15px]">{url}</code>
        </li>
        {apps.length === 0 ? (
          <li className="flex items-baseline justify-between gap-6 border-b border-hairline py-[14px]">
            <span className="text-[13px] font-medium text-ink-2">Connected</span>
            <span className="text-right text-[15px]">Nothing yet</span>
          </li>
        ) : (
          apps.map((app) => (
            <li
              key={app.grantId}
              className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-hairline py-[14px]"
            >
              <span className="text-[13px] font-medium text-ink-2">{app.name}</span>
              <span className="flex items-baseline gap-4 text-right">
                <span className="num text-[15px]">
                  {app.lastUsedAt
                    ? `Last used ${app.lastUsedAt.toISOString().slice(0, 10)}`
                    : `Connected ${app.connectedAt.toISOString().slice(0, 10)}`}
                </span>
                <form action={disconnectClaude.bind(null, app.grantId)}>
                  <button
                    type="submit"
                    className="text-[13px] text-ink-2 underline underline-offset-2"
                  >
                    Disconnect
                  </button>
                </form>
              </span>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
