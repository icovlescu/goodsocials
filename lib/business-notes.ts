import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { businessNote } from "@/db/schema";

/**
 * What the member told their AI chat about the business, saved for the next
 * post: the things no connected source reports. Capped so a chat that saves
 * everything cannot turn the brand context into a novel.
 */

export const NOTE_LIMIT = 50;
export const NOTE_MAX = 1000;

export type Note = { id: string; title: string; body: string; createdAt: Date };

export async function listNotes(profileId: string): Promise<Note[]> {
  return getDb()
    .select({
      id: businessNote.id,
      title: businessNote.title,
      body: businessNote.body,
      createdAt: businessNote.createdAt,
    })
    .from(businessNote)
    .where(eq(businessNote.profileId, profileId))
    .orderBy(desc(businessNote.createdAt))
    .limit(NOTE_LIMIT);
}

export async function addNote(
  profileId: string,
  title: string,
  body: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const t = title.trim().slice(0, 120);
  const b = body.trim();
  if (!t || b.length < 3) return { ok: false, error: "Give the note a title and a sentence." };
  if (b.length > NOTE_MAX) return { ok: false, error: `Keep a note under ${NOTE_MAX} characters.` };

  const existing = await listNotes(profileId);
  if (existing.length >= NOTE_LIMIT) {
    return {
      ok: false,
      error: `This profile holds ${NOTE_LIMIT} notes. Delete an old one with delete_business_note first.`,
    };
  }
  const [row] = await getDb()
    .insert(businessNote)
    .values({ profileId, title: t, body: b })
    .returning({ id: businessNote.id });
  return { ok: true, id: row.id };
}

export async function deleteNote(profileId: string, id: string): Promise<boolean> {
  const gone = await getDb()
    .delete(businessNote)
    .where(and(eq(businessNote.id, id), eq(businessNote.profileId, profileId)))
    .returning({ id: businessNote.id });
  return gone.length > 0;
}

export function notesBrief(notes: Note[]): string {
  if (notes.length === 0) return "";
  return [
    "Notes the member saved about the business. True as the member stated them; use them as written.",
    ...notes.map((n) => `- ${n.title}: ${n.body}`),
  ].join("\n");
}
