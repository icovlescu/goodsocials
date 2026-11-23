import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { board as boardTable, brandPrinciple, theme as themeTable } from "@/db/schema";
import { updateFunnel } from "@/lib/funnel";

/**
 * Onboarding written by the member's AI chat instead of by our model: the
 * three principles, the themes, the site, the goal and the cadence, in one
 * write, and the funnel marked done so the board opens. The same rows
 * lib/brand-intake.ts writes, so a board set up this way is the same board.
 */

export type BrandSetup = {
  siteUrl?: string | null;
  principles: { voice: string; format: string; visual: string };
  themes: { title: string; description: string }[];
  goal?: "interesting" | "followers" | "traffic" | "leads" | "engagement";
  postsPerWeek?: number;
};

export async function setUpBrand(
  profileId: string,
  input: BrandSetup,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const themes = input.themes
    .map((t) => ({ title: t.title.trim().slice(0, 60), description: t.description.trim().slice(0, 400) }))
    .filter((t) => t.title && t.description);
  if (themes.length < 2 || themes.length > 6) {
    return { ok: false, error: "Give between two and six themes, four is the usual number." };
  }
  for (const kind of ["voice", "format", "visual"] as const) {
    const text = input.principles[kind].trim();
    if (text.length < 20) return { ok: false, error: `Write the ${kind} principle in at least a sentence.` };
    if (text.length > 2000) return { ok: false, error: `Keep the ${kind} principle under 2,000 characters.` };
  }

  const db = getDb();
  await Promise.all(
    (["voice", "visual", "format"] as const).map((kind) =>
      db
        .insert(brandPrinciple)
        .values({ profileId, kind, text: input.principles[kind].trim() })
        .onConflictDoUpdate({
          target: [brandPrinciple.profileId, brandPrinciple.kind],
          set: { text: input.principles[kind].trim(), updatedAt: new Date() },
        }),
    ),
  );

  await db.delete(themeTable).where(eq(themeTable.profileId, profileId));
  await db
    .insert(themeTable)
    .values(themes.map((t, position) => ({ profileId, ...t, position })));

  const cadence = input.postsPerWeek
    ? Math.min(7, Math.max(1, Math.round(input.postsPerWeek)))
    : undefined;
  await db
    .update(boardTable)
    .set({
      ...(input.siteUrl !== undefined ? { siteUrl: input.siteUrl } : {}),
      ...(input.goal ? { goal: input.goal } : {}),
      ...(cadence ? { targetCadence: cadence } : {}),
    })
    .where(eq(boardTable.profileId, profileId));

  await updateFunnel(profileId, (f) => ({ ...f, step: "done" }));
  return { ok: true };
}
