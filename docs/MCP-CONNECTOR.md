# The GoodSocials connector (MCP)

GoodSocials as a remote MCP server. A member adds it to the AI chat they
already pay for (Claude, ChatGPT, or any client that supports remote MCP
servers with OAuth), signs in with their GoodSocials account, and writes posts
in that chat. The chat does the writing on the member's own plan. GoodSocials
keeps the brand principles, themes, business data, the board, the schedule,
the LinkedIn connection and the share links for every other platform.

That moves the text cost off our `ANTHROPIC_API_KEY`, which is what makes a free
tier possible.

## The product in one picture

```
 Business data ───────▶ GoodSocials ───────▶ MCP server ───────▶ Member's AI chat
 Stripe, PostHog,       principles, themes,  /api/mcp            (Claude, ChatGPT, …)
 Plausible, GitHub,     facts, notes,        read_skill,         writes, revises,
 Notion, notes          board, queue         get_brand_context,  checks, asks to
                                             get_business_data   publish
        ▲                                                              │
        │  update_brand_principle, add_business_note                   │
        └──────────────────────────────────────────────────────────────┘
                 create_draft, adapt_post ──▶ board (free: 5 drafts held)
                 schedule_post / publish_now ──▶ LinkedIn API (free: 5 a month)
                 share_post ──▶ X, Instagram, Facebook, Threads, Bluesky share links
```

## Free and paid

| | Free | Paid |
|---|---|---|
| Who writes | The member's AI chat, on their plan | The chat, plus the board's own agent on our key |
| Posts that reach a feed from the connector | 5 a month (UTC calendar month, all profiles) | No connector limit |
| Connector drafts waiting on the board | 5 at once | No limit |
| Quality check before a slot | The rules in code (`lib/quality.ts`) | Rules plus the editor pass (`lib/agent/review.ts`) |
| LinkedIn | API publishing, inside the 5 | API publishing |
| X, Instagram, Facebook, Threads, Bluesky, TikTok | Share link or copy, by hand | API publishing as each adapter lands; share link until then |
| Business data | Connect any source, read daily | Same |

Rules in code:

- Tier is `tierOf(account)` in `lib/tiers.ts`: paid while Stripe reports a running
  subscription (`isSubscribed`), free otherwise. It ignores
  `NEXT_PUBLIC_PAYMENTS_HIDDEN` on purpose, so hiding prices does not make every
  account paid. `npx tsx scripts/set-plan.ts <email> pro --paid` makes a test
  account paid.
- Connector posts are cards with `origin = 'connector'`. Only those count
  against the free limits, and only those publish for an account with no
  subscription: `canPublishCard` in `lib/billing.ts`, which the cron asks per
  row. Everything the board's agent wrote still needs a plan.
- The monthly allowance is counted when a post takes a slot, by the month of
  its slot, so the cron never counts twice.

## Publishing modes, and the disclaimer

Every platform has up to two modes, and the member approves every post by hand
in both. The words below are `PUBLISH_DISCLAIMER` in
`lib/platforms/registry.ts`, shown on the board's share panel, in the docs and
in the playbook every chat reads:

> You approve every post by hand. Share opens the platform with your post
> filled in, and you press Post there yourself. Automatic publishing, on paid
> plans, sends the post you approved through that platform's own API at the
> time you picked, under the permissions you granted it.

| Platform | Limit | Share mode | API mode |
|---|---|---|---|
| LinkedIn | 3,000 | `linkedin.com/feed/?shareActive=true&text=` | **Live** (`lib/publish.ts`) |
| X | 280 | `x.com/intent/post?text=` | Designed. Needs an X API plan with write access |
| Instagram | 2,200, image required | Copy, plus the phone's share sheet | Designed. Professional account + Meta app review |
| Facebook | 63,206 | Copy (the sharer takes a URL, not text) | Designed. Pages only, Graph API + Meta app review |
| Threads | 500 | `threads.net/intent/post?text=` | Reserved |
| Bluesky | 300 | `bsky.app/intent/compose?text=` | Reserved. Open, free API: the cheapest next adapter |
| TikTok | 2,200, video required | Copy | Reserved. Content Posting API + review |

Adding a platform is one entry in `PLATFORMS` (limits, style, share link) and,
for API mode, an adapter. Nothing else in the repo names a platform. Worth a
slot later: Mastodon (open API, share link at `/share?text=`), Google Business
Profile (local businesses, NGOs), YouTube community posts, Reddit, and
newsletters (Substack, Beehiiv) for the long version of a post.

The card's own text is the LinkedIn version and the only one the queue
publishes. Every other platform's text is a `post_variant` row with its own
status: `draft`, `manual` (handed over by share link or copy; we cannot see if
the member pressed Post, so we do not claim they did), `queued`, `published`,
`failed`.

## Architecture

| Piece | File |
|---|---|
| MCP endpoint, stateless JSON over Streamable HTTP | `app/api/mcp/route.ts`, `lib/mcp/server.ts` |
| Tool registry and dispatch | `lib/mcp/registry.ts`, `lib/mcp/tool.ts` |
| Skills, business data tools | `lib/mcp/skills.ts`, `lib/mcp/tools-business.ts` |
| Board tools | `lib/mcp/tools.ts` → `lib/cards.ts` |
| Platform tools | `lib/mcp/tools-platforms.ts` → `lib/variants.ts`, `lib/platforms/registry.ts` |
| Tiers | `lib/tiers.ts`, `canPublishCard` and `isSubscribed` in `lib/billing.ts` |
| Business notes | `lib/business-notes.ts` |
| OAuth 2.1 server | `lib/oauth/server.ts`, `app/oauth/authorize`, `app/api/oauth/*`, `app/.well-known/*` |
| Board share panel | `components/board/share-elsewhere.tsx` |
| Settings section and Disconnect | `components/settings/claude-connector.tsx` |
| Tables | `oauth_client`, `oauth_grant` (0014); `post_variant`, `business_note`, `card.origin` (0015) |

Client agnostic by construction: standard MCP methods, standard OAuth
(dynamic registration, PKCE S256, public clients), tool descriptions and the
playbook written for any model. Skills are served three ways because clients
differ in what they read: the `read_skill` tool (every client), MCP resources
at `goodsocials://skill/<name>`, and the `write_post` prompt.

Security: codes and tokens are 32 random bytes stored as SHA-256 hashes;
access tokens last an hour, refresh tokens 90 days and rotate; a grant is
scoped to the account the way every card action is; closing the account
deletes its grants; data source keys are pasted on the website only, never in
a chat (`connect_data_source` gives the link).

## Tools

| Tool | What it does | Writes |
|---|---|---|
| `read_skill` | The playbook (loop, plan limits, never-dos) or one platform's guide | No |
| `get_brand_context` | Principles, themes, goal, cadence, zone, readings, notes, recent openings, rules, plan usage | No |
| `get_business_data` | Sources and their status, every reading with its date, saved notes | No |
| `add_business_note` / `delete_business_note` | A fact the member told the chat, for future posts (50 per profile) | Notes |
| `connect_data_source` | Link to connect Stripe, GitHub, PostHog, Plausible or Notion on the site | No |
| `list_profiles` | Profiles on the account and their LinkedIn connection | No |
| `list_posts` / `get_post` | The board | No |
| `create_draft` / `update_draft` | Save or replace the LinkedIn text | Board |
| `update_brand_principle` | Make a correction hold for every future post | Board |
| `schedule_post` / `unschedule_post` / `reject_post` | The LinkedIn queue | Queue |
| `publish_now` | Publish to LinkedIn immediately | **Feed** |
| `list_platforms` / `check_post` | Limits, routes, and the rules for one platform | No |
| `adapt_post` / `list_post_versions` | Per-platform versions of a post | Board |
| `share_post` | Share links or copy text for the platforms named | Marks handed over |

## Turning it on for a deployment

1. Deploy. No new environment variables.
2. Open `/api/admin/migrate?k=<LINKEDIN_DEBUG_SECRET>` once: applies 0014 and 0015.
3. `https://<host>/.well-known/oauth-authorization-server` returns JSON, and
   `curl -i -X POST https://<host>/api/mcp` returns 401 with `WWW-Authenticate`.

The connector URL is `https://<host>/api/mcp`. Settings shows the right one
under **Write in your AI chat**. A member needs a finished board before
connecting; onboarding still writes the first principles and themes on our key.

## Tutorial: from zero to a post on three platforms

### 1. Add the connector

**Claude (web or desktop).** Settings → Connectors → **Add custom connector**.
Name `GoodSocials`, URL `https://goodsocials.co/api/mcp`. Press **Connect**,
sign in with LinkedIn, press **Allow**. In a chat, check that GoodSocials is
switched on in the tools menu.

**Claude Code.** `claude mcp add --transport http goodsocials https://goodsocials.co/api/mcp`,
then `/mcp`, pick `goodsocials`, authenticate.

**ChatGPT.** Connectors with your own MCP server sit behind developer mode
(Settings → Apps and connectors → Advanced). Add a connector with the same URL
and OAuth, then enable it in a chat. The menu names move between releases;
OpenAI's help center has the current path.

**Any other client** that supports remote MCP over Streamable HTTP with OAuth
uses the same URL. Nothing on the server is specific to one chat.

### 2. Feed it the business

> **You:** Connect my Stripe to GoodSocials.

The chat calls `connect_data_source` and gives you the link. You paste a
restricted, read-only key on the GoodSocials integrations page, never in the
chat. The next daily sync reads revenue, new customers and cancellations.

> **You:** Remember that we signed three universities in October, and that the
> NGO plan costs 20 EUR a month.

The chat calls `add_business_note` twice. Both facts are now available to every
future post, in any chat you connect.

### 3. Draft from real numbers

> **You:** Write a LinkedIn post from this month's numbers.

The chat calls `read_skill`, `get_brand_context` and `get_business_data`, picks
one finding ("Stripe shows 4,210 EUR of new revenue in October, from 31 new
customers"), writes in your voice principle, runs `check_post`, shows you the
text, and on your yes calls `create_draft`. The card appears in Draft on your
board. On free, the reply also says how many of your 5 drafts and 5 monthly
posts are left.

### 4. Revise, and make it stick

> **You:** Shorter. And never open with a question, for any post.

`update_draft` rewrites this post; `update_brand_principle` adds "never open with
a question" to your format principle, so the board and every chat follow it.

### 5. Schedule on LinkedIn

> **You:** Schedule it for Thursday.

`schedule_post` with `day: "2026-11-26"`: "Publishing Thursday 26 November at
09:00." If a rule fails (a long dash, the first person, a bracket still waiting
for a number), the tool says why and how to fix it, and the chat tries again.
On paid, the editor review runs here too.

### 6. Same post on X and Instagram

> **You:** Make versions for X and Instagram and give me the links.

The chat reads `read_skill` for `x` and `instagram`, rewrites to 280 characters
and to an Instagram caption with "link in bio", runs `check_post` for each,
saves them with `adapt_post`, then calls `share_post`:

> **Chat:** X: [open X with the post filled in](https://x.com/intent/post?text=…).
> Instagram: copy this caption and post it with an image in the app. Nothing has
> been posted yet: you press Post on each platform.

The same versions show on the card in GoodSocials under **Share to other
platforms**, with Open, Copy and, on a phone, the share sheet.

### 7. Hitting the free limit

On the sixth post of the month `schedule_post` answers: "The free plan publishes
5 posts a month and that month is full. Pick a day next month, or start a
plan." The chat passes that on; it does not work around it.

### Disconnecting

Settings → **Write in your AI chat** → **Disconnect** stops that chat's tokens.
Or remove the connector in the chat app.

## Limits worth knowing

- On the fork's Vercel Hobby plan the publish cron runs once a day at 08:00 UTC,
  so a 09:00 slot waits for the next run. `publish_now` does not wait.
- Posts from the connector publish as text. Approve the card on the board for a
  picture (paid).
- No platform tells us whether a share link ended in a post, so a handed-over
  version is marked `manual`, not `published`.
- LinkedIn still needs a sign in every 60 days, connector or not.
- Engagement support for paid needs post analytics, and LinkedIn closed
  `r_member_social` to new apps. It has to come from each platform that allows
  it, or from the member's own export.

## Next steps

- Onboarding through the chat (tools to write the themes and the first three
  principles), so a free member never spends our key.
- Bluesky API adapter (open and free), then X once an API plan is bought.
- Turn the board's own agent off for free accounts so top-ups stop spending the key.
- An `attach_image` tool for an image the member's chat made, so connector posts
  can carry one without our image bill.
