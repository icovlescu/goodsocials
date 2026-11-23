import { callTool, toolList } from "@/lib/mcp/registry";
import { findSkill, SKILLS } from "@/lib/mcp/skills";
import type { Ctx } from "@/lib/mcp/tool";

/**
 * The Model Context Protocol over Streamable HTTP, stateless, answered with
 * plain JSON. Every request carries its own bearer token, so there is no
 * session to keep between Vercel invocations, and no tool here streams, so
 * there is nothing for a server sent event stream to carry.
 *
 * Small enough to write rather than import: four methods and the error shape.
 * The SDK's transport is built around Node's request objects and a session
 * map, neither of which survives a serverless function.
 */

const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];
const LATEST = SUPPORTED[0];

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
};

/**
 * Sent at initialize. Written for any model in any client: Claude, ChatGPT,
 * Le Chat and the rest all read the same words.
 */
const INSTRUCTIONS = [
  "GoodSocials keeps this member's social media board: brand principles, themes, business data, a queue and a publisher for LinkedIn, with share links for X, Instagram, Facebook and more.",
  "You write the posts in this chat. Call read_skill first for the playbook, then get_brand_context and get_business_data.",
  "Show the member every post before saving, and never schedule, publish or share without their explicit yes.",
].join(" ");

const PROMPTS = [
  {
    name: "write_post",
    title: "Write a post with GoodSocials",
    description: "Write one post from the member's brand and business data, check it, and save it to the board.",
    arguments: [{ name: "topic", description: "What the post is about, if the member has an idea.", required: false }],
  },
];

function isRequest(value: unknown): value is JsonRpcRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { jsonrpc?: unknown }).jsonrpc === "2.0" &&
    typeof (value as { method?: unknown }).method === "string"
  );
}

export function rpcError(
  id: string | number | null,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** One message in, a response out, or null for a notification. */
export async function handleMessage(
  ctx: Ctx,
  message: unknown,
): Promise<JsonRpcResponse | null> {
  if (!isRequest(message)) return rpcError(null, -32600, "Not a JSON-RPC 2.0 request.");

  const { id, method, params } = message;
  // A notification has no id and gets no answer.
  if (id === undefined) return null;

  switch (method) {
    case "initialize": {
      const asked = typeof params?.protocolVersion === "string" ? params.protocolVersion : LATEST;
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: SUPPORTED.includes(asked) ? asked : LATEST,
          capabilities: {
            tools: { listChanged: false },
            resources: { listChanged: false },
            prompts: { listChanged: false },
          },
          serverInfo: { name: "goodsocials", title: "GoodSocials", version: "0.1.0" },
          instructions: INSTRUCTIONS,
        },
      };
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: toolList() } };
    case "tools/call": {
      const name = typeof params?.name === "string" ? params.name : "";
      return {
        jsonrpc: "2.0",
        id,
        result: await callTool(ctx, name, params?.arguments),
      };
    }
    // The skills again, for clients that read resources and prompts. Tools
    // are what every client supports; these are the same text.
    case "resources/list":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          resources: SKILLS.map((k) => ({
            uri: `goodsocials://skill/${k.name}`,
            name: k.name,
            title: k.title,
            description: k.description,
            mimeType: "text/markdown",
          })),
        },
      };
    case "resources/templates/list":
      return { jsonrpc: "2.0", id, result: { resourceTemplates: [] } };
    case "resources/read": {
      const uri = typeof params?.uri === "string" ? params.uri : "";
      const skill = findSkill(uri.replace(/^goodsocials:\/\/skill\//, ""));
      if (!skill || !uri.startsWith("goodsocials://skill/")) {
        return rpcError(id, -32002, `No resource at ${uri}.`);
      }
      return {
        jsonrpc: "2.0",
        id,
        result: { contents: [{ uri, mimeType: "text/markdown", text: skill.text() }] },
      };
    }
    case "prompts/list":
      return { jsonrpc: "2.0", id, result: { prompts: PROMPTS } };
    case "prompts/get": {
      if (params?.name !== "write_post") return rpcError(id, -32602, "Unknown prompt.");
      const args = (params?.arguments ?? {}) as Record<string, unknown>;
      const topic = typeof args.topic === "string" && args.topic.trim() ? args.topic.trim() : null;
      return {
        jsonrpc: "2.0",
        id,
        result: {
          description: PROMPTS[0].description,
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `Using GoodSocials, write one post${topic ? ` about ${topic}` : " from my business data"}. Read the playbook with read_skill, then get_brand_context and get_business_data. Check it with check_post, show it to me, and save it with create_draft once I say yes.`,
              },
            },
          ],
        },
      };
    }
    default:
      return rpcError(id, -32601, `Unknown method ${method}.`);
  }
}
