import { z } from "zod";
import { addNote, deleteNote, listNotes } from "@/lib/business-notes";
import { factsBrief, readFacts } from "@/lib/integrations/facts";
import { listSources } from "@/lib/integrations/sources";
import { findSkill, SKILLS } from "@/lib/mcp/skills";
import { actorFor, ok, profileArg, refuse, tool, type Tool } from "@/lib/mcp/tool";
import { usageFor, usageLine } from "@/lib/tiers";

/**
 * Business data and skills: what the chat reads to write a post worth
 * publishing. The numbers come from the member's own Stripe, PostHog,
 * Plausible, GitHub and Notion, read daily by lib/integrations; the notes are
 * what the member told the chat. Keys are connected on the website and never
 * pass through a chat.
 */

const readSkill = tool({
  name: "read_skill",
  title: "Read a GoodSocials skill",
  description:
    "Instructions for working the GoodSocials board. Call it with no name first: it returns the playbook (the loop, the plan limits, what never to do) and the list of other skills, one per platform.",
  input: z.object({
    name: z.string().optional().describe("playbook, linkedin, x, instagram, facebook, threads, bluesky or tiktok. Leave out for the playbook."),
  }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run({ memberId }, args) {
    const skill = findSkill(args.name ?? "playbook");
    if (!skill) return refuse(`No skill called ${args.name}. Skills: ${SKILLS.map((s) => s.name).join(", ")}.`);
    let text = skill.text();
    if (skill.name === "playbook") {
      const who = await actorFor(memberId);
      if (who.ok) text += `\n## This account\n${usageLine(await usageFor(who.actor.accountId))}\n`;
      text += `\n## Other skills\n${SKILLS.filter((s) => s.name !== "playbook").map((s) => `- ${s.name}: ${s.description}`).join("\n")}\n`;
    }
    return ok(text);
  },
});

const getBusinessData = tool({
  name: "get_business_data",
  title: "Get business data",
  description:
    "Real readings from the member's connected tools (revenue, customers, churn, signups, traffic, shipped work, notes from Notion) with the date each was read, plus notes the member saved in chat. The raw material for posts with a number in them. Use every value exactly as written.",
  input: z.object({ profile_id: profileArg }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run({ memberId, origin }, args) {
    const who = await actorFor(memberId, args.profile_id);
    if (!who.ok) return refuse(who.error);
    const { profileId } = who.actor;
    const [sources, facts, notes] = await Promise.all([
      listSources(profileId),
      readFacts(profileId),
      listNotes(profileId),
    ]);

    const connected = sources.filter((s) => s.connected);
    const status = sources.map((s) => {
      const c = s.connected;
      if (!c) return `- ${s.definition.name}: not connected. Reads ${s.definition.reads}`;
      if (c.status === "broken") return `- ${s.definition.name}: connected, last read refused: ${c.lastError ?? "unknown"}.`;
      return `- ${s.definition.name}: connected, ${s.facts.length} readings, last read ${c.lastSyncedAt ? c.lastSyncedAt.toISOString().slice(0, 10) : "not yet"}.`;
    });

    const text = [
      "## Sources",
      status.join("\n"),
      connected.length === 0
        ? `Nothing is connected yet. The member connects sources at ${origin}/integrations, which turns posts into receipts with real numbers.`
        : null,
      "## Readings",
      factsBrief(facts) || "No readings yet.",
      "## Notes the member saved",
      notes.length
        ? notes.map((n) => `- ${n.title} (note_id ${n.id}, ${n.createdAt.toISOString().slice(0, 10)}): ${n.body}`).join("\n")
        : "None yet. Save one with add_business_note when the member tells you something worth reusing.",
    ]
      .filter(Boolean)
      .join("\n\n");

    return ok(text, {
      sources: sources.map((s) => ({
        kind: s.definition.kind,
        name: s.definition.name,
        connected: Boolean(s.connected),
        status: s.connected?.status ?? null,
      })),
      facts: facts.map((f) => ({
        source: f.kind,
        label: f.label,
        value: f.value,
        detail: f.detail,
        period: f.period,
        observed_at: f.observedAt.toISOString(),
      })),
      notes: notes.map((n) => ({ id: n.id, title: n.title, body: n.body })),
    });
  },
});

const addBusinessNote = tool({
  name: "add_business_note",
  title: "Save a business note",
  description:
    "Saves something true about the business that the member told you and that no connected tool reports: a milestone, a price, a customer story they are allowed to tell. Future posts can use it. Only save what the member stated.",
  input: z.object({
    profile_id: profileArg,
    title: z.string().min(2).max(120).describe("A few words, for the list."),
    body: z.string().min(3).max(1000).describe("The fact, in the member's words."),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  async run({ memberId }, args) {
    const who = await actorFor(memberId, args.profile_id);
    if (!who.ok) return refuse(who.error);
    const r = await addNote(who.actor.profileId, args.title, args.body);
    if (!r.ok) return refuse(r.error);
    return ok(`Saved. Note id ${r.id}.`, { note_id: r.id });
  },
});

const deleteBusinessNote = tool({
  name: "delete_business_note",
  title: "Delete a business note",
  description: "Removes a saved note that is no longer true.",
  input: z.object({ profile_id: profileArg, note_id: z.string().uuid() }),
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  async run({ memberId }, args) {
    const who = await actorFor(memberId, args.profile_id);
    if (!who.ok) return refuse(who.error);
    return (await deleteNote(who.actor.profileId, args.note_id))
      ? ok("Deleted.")
      : refuse("No note with that id on this profile.");
  },
});

const connectDataSource = tool({
  name: "connect_data_source",
  title: "Connect a data source",
  description:
    "Gives the member the link to connect Stripe, GitHub, PostHog, Plausible or Notion on the GoodSocials website. Keys are pasted there, never in the chat. GoodSocials reads them daily, read-only.",
  input: z.object({ kind: z.enum(["stripe", "github", "posthog", "plausible", "notion"]).optional() }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run({ origin }, args) {
    return ok(
      `Open ${origin}/integrations to connect${args.kind ? ` ${args.kind}` : " a source"}. The key is pasted on that page, read-only, and never shared with the chat. Readings appear in get_business_data after the first sync.`,
    );
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const BUSINESS_TOOLS: Tool<any>[] = [
  readSkill,
  getBusinessData,
  addBusinessNote,
  deleteBusinessNote,
  connectDataSource,
];
