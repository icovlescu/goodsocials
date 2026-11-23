import { z } from "zod";
import { BOARD_TOOLS } from "@/lib/mcp/tools";
import { BUSINESS_TOOLS } from "@/lib/mcp/tools-business";
import { PLATFORM_TOOLS } from "@/lib/mcp/tools-platforms";
import { refuse, type Ctx, type ToolResult } from "@/lib/mcp/tool";

/** Every tool the connector offers, skills first so a client lists them first. */
export const TOOLS = [...BUSINESS_TOOLS, ...BOARD_TOOLS, ...PLATFORM_TOOLS];

export function toolList() {
  return TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: z.toJSONSchema(t.input, { target: "draft-7" }),
    annotations: { title: t.title, ...t.annotations },
  }));
}

export async function callTool(ctx: Ctx, name: string, rawArgs: unknown): Promise<ToolResult> {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) return refuse(`There is no tool called ${name}.`);
  const parsed = t.input.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return refuse(
      `The arguments did not fit: ${parsed.error.issues.map((i: z.core.$ZodIssue) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}`,
    );
  }
  try {
    return await t.run(ctx, parsed.data);
  } catch (cause) {
    console.error(`[mcp] ${name} failed:`, cause);
    return refuse("Something went wrong on the GoodSocials side. Try again in a minute.");
  }
}
