# The Claude connector

GoodSocials as a remote MCP server. The member adds it to Claude once, signs
in with their GoodSocials account, and from then on writes LinkedIn posts in
their own Claude chat. Claude does the writing on the member's Claude plan.
GoodSocials keeps the board, the brand principles, the themes, the schedule,
the LinkedIn connection and the publisher.

That moves the text cost off our `ANTHROPIC_API_KEY`. A post written through
the connector costs us a few database rows and, when it publishes, the LinkedIn
calls. No text model and no image model runs on our side.

## How it fits together

```
Claude (member's plan)                    GoodSocials (Vercel)
───────────────────────                   ─────────────────────────────────────
1. POST /api/mcp, no token      ───────▶  401 + WWW-Authenticate: resource_metadata=…
2. GET /.well-known/oauth-protected-resource/api/mcp
3. GET /.well-known/oauth-authorization-server
4. POST /api/oauth/register     ───────▶  client_id (dynamic registration)
5. Browser: /oauth/authorize    ───────▶  member signs in with LinkedIn, presses Allow
6. POST /api/oauth/token (PKCE) ───────▶  access token (1 hour) + refresh token (90 days)
7. POST /api/mcp, Bearer token  ───────▶  tools/list, tools/call
                                            └─ lib/mcp/tools.ts → lib/cards.ts → same rows as the board
```

| Piece | File |
|---|---|
| MCP endpoint, stateless JSON over Streamable HTTP | `app/api/mcp/route.ts`, `lib/mcp/server.ts` |
| Tools | `lib/mcp/tools.ts` |
| Card operations the tools call | `addWrittenDraft`, `replaceDraftText`, `scheduleWritten`, `publishWrittenNow` in `lib/cards.ts` |
| OAuth 2.1 server: registration, codes, tokens, revocation | `lib/oauth/server.ts` |
| Discovery documents | `app/.well-known/…`, `lib/oauth/metadata.ts` |
| Consent screen | `app/oauth/authorize/page.tsx` |
| Connector URL and Disconnect in settings | `components/settings/claude-connector.tsx` |
| Tables | `oauth_client`, `oauth_grant` in `db/schema.ts`, migration `0014_claude_connector.sql` |

Design decisions:

- **Public clients, PKCE S256 only, no client secrets.** That is what the MCP
  authorization spec expects and what Claude does. Redirect URIs must be
  `https`, or `http` to localhost for Claude Code and Claude Desktop.
- **Every secret is stored as a SHA-256 hash.** A code, an access token and a
  refresh token are 32 random bytes. A leaked table opens nothing.
- **A grant is scoped to the account**, the same boundary every card action
  uses, so an agency's Claude can work across all its profiles. Tools take an
  optional `profile_id`; without it they act on the owner's own profile.
- **The quality rules still decide.** `schedule_post` and `publish_now` run the
  rules in `lib/quality.ts` (third person, banned words, length, brackets,
  repeats). The editor pass in `lib/agent/review.ts` is skipped on this path,
  because it would put a model call back on our key. A rules pass from the
  connector is not cached as a pass, so pressing Approve on the board for the
  same text still runs the editor.
- **Posts from Claude go out as text only.** A picture is the one cost left on
  our side. Approving the card on the board still adds one.
- **`publish_now` does not wait for the cron.** It puts the card at the front
  of the queue and runs the publish loop for that one card, with every check
  the cron makes: billing, the LinkedIn connection, the call budget.

## Tools

| Tool | What it does | Changes anything |
|---|---|---|
| `get_brand_context` | Principles, themes with ids, goal, cadence, time zone, readings from connected sources, openings of recent posts, the writing rules | No |
| `list_profiles` | Profiles on the account and their LinkedIn connection status | No |
| `list_posts` | Cards on the board, optionally one column | No |
| `get_post` | One card's full text, state and anything the quality check holds it for | No |
| `create_draft` | Saves a finished post to Draft. Says if it would be held | Board only |
| `update_draft` | Replaces a draft's text, logs the member's note as a revise | Board only |
| `update_brand_principle` | Rewrites voice, format or visual so a correction holds for every future post | Board only |
| `schedule_post` | Next free 09:00 slot, or a given `YYYY-MM-DD` | Queue |
| `unschedule_post` | Takes a scheduled post back to the board | Queue |
| `reject_post` | Takes a card off the board | Board only |
| `publish_now` | Publishes to LinkedIn immediately | **LinkedIn feed** |

## Turning it on for a deployment

1. Deploy the branch. Nothing new in the environment: the connector uses
   `DATABASE_URL`, `AUTH_SECRET` and the LinkedIn sign in that already exist.
2. Open `/api/admin/migrate?k=<LINKEDIN_DEBUG_SECRET>` once, which applies
   `0014_claude_connector.sql`.
3. Check discovery: `https://<host>/.well-known/oauth-authorization-server`
   returns JSON, and `curl -i -X POST https://<host>/api/mcp` returns 401 with a
   `WWW-Authenticate` header.

The connector URL is `https://<host>/api/mcp`. In production that is
`https://goodsocials.co/api/mcp`. On the fork's Vercel project it is
`https://goodsocials.vercel.app/api/mcp`. Settings shows the right one for the
deployment you are on, under **Write in Claude**.

The member needs a board first, so they sign up and finish onboarding at
GoodSocials before connecting. Onboarding still writes the first principles and
themes with our key; see "Next steps".

## Tutorial: from zero to a scheduled LinkedIn post

### 1. Add the connector

**Claude on the web or desktop app**

1. Open **Settings → Connectors** and press **Add custom connector**.
2. Name: `GoodSocials`. URL: `https://goodsocials.co/api/mcp`. Press **Add**.
3. Press **Connect**. A GoodSocials window opens.
4. Press **Continue with LinkedIn** if you are not signed in, then **Allow**.
5. Back in Claude the connector shows as connected. In a chat, open the tools
   menu and make sure GoodSocials is switched on.

Custom connectors depend on your Claude plan and, on Team and Enterprise, on
what an owner allows. Claude's help center has the current rules.

**Claude Code**

```
claude mcp add --transport http goodsocials https://goodsocials.co/api/mcp
```

Then run `/mcp` inside Claude Code, pick `goodsocials` and authenticate. A
browser opens on the same Allow screen.

### 2. Draft a post

> **You:** Write a LinkedIn post for my GoodSocials profile about why posting
> four times a week beats one long post a month. Use my brand context.

Claude calls `get_brand_context`, reads the voice and format principles, picks
the theme that fits, and checks the openings of recent posts so it does not
repeat one. It writes the post in the chat and calls `create_draft`:

> **Claude:** Here is the draft, saved to Draft on your board (post id
> `5f0c…`). It passes the writing rules.
>
> *Most founders treat LinkedIn like a blog. One long essay a month, then
> silence. The feed rewards the opposite…*

Open the board in GoodSocials and the card is there, in Draft.

### 3. Revise it, and make the correction stick

> **You:** Too formal. Shorter sentences. And never open with a question,
> for any post.

Claude rewrites the post and calls `update_draft` with your note. Because "never
open with a question" is about every post, it also calls
`update_brand_principle` for `format`, so the board's own drafts follow it from
now on too.

> **Claude:** Updated the draft, and added "never open with a question" to your
> format principle so it holds for future posts.

### 4. Schedule it

> **You:** Good. Schedule it for Thursday.

Claude converts Thursday to a date and calls `schedule_post` with
`day: "2026-11-26"`:

> **Claude:** Scheduled. Publishing Thursday 26 November at 09:00
> (Europe/Bucharest).

If the post breaks a rule, the tool refuses with the reason and the fix, for
example "The post uses a long dash", and Claude rewrites it and tries again. If
the day already has a post, it says so and Claude offers the next free day.

### 5. Or post it right now

> **You:** Actually, post it now.

Claude calls `publish_now`, which publishes straight to your LinkedIn feed and
returns the link:

> **Claude:** Published. https://www.linkedin.com/feed/update/urn:li:share:…

### 6. Week two

> **You:** Plan next week. Five posts, one per theme, schedule them on the
> free days.

Claude reads the context once, writes five posts, saves each with
`create_draft`, shows you all five, and schedules the ones you approve with
`schedule_post`. Your board in GoodSocials shows the same week.

### Disconnecting

Settings → **Write in Claude** → **Disconnect** stops both tokens at once. Or
remove the connector in Claude.

## Limits worth knowing

- **Scheduled posts publish when the cron runs.** On the fork's Vercel Hobby
  plan the publish cron runs once a day at 08:00 UTC, so a 09:00 slot waits for
  the next run. `publish_now` is not affected. Production on Pro runs every 15
  minutes.
- **No pictures from the connector.** Approve the card on the board for one.
- **The editor pass does not run.** The rules in code still do.
- **LinkedIn still needs a sign in every 60 days.** `list_profiles` shows how
  long the connection has left; a dead connection pauses publishing exactly as
  it does from the board.
- **Billing is unchanged.** `publish_now` and the cron both ask `canPublish`.

## Next steps

- Let Claude do onboarding too: tools to write themes and the first three
  principles from the site, so a free tier never spends our key.
- An `add_image` tool that takes an image URL Claude made or found, so a post
  from the connector can carry a picture without our image bill.
- A free plan in `lib/plans.ts` that allows publishing only through the
  connector, if that becomes the offer.
