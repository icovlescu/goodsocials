import { callTool, toolList } from "@/lib/mcp/tools";

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

const INSTRUCTIONS = [
  "GoodSocials keeps a LinkedIn posting board for this member: brand principles, themes, a queue and a publisher.",
  "You write the posts. Start with get_brand_context, write in that voice and within its rules, and save with create_draft.",
  "Show the member the final text before schedule_post, and only call publish_now when they ask for it to go out now.",
  "When the member corrects something that should hold for every post, update the matching brand principle too.",
].join(" ");

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
  memberId: string,
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
          capabilities: { tools: { listChanged: false } },
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
        result: await callTool(memberId, name, params?.arguments),
      };
    }
    // Asked for by some clients whatever the capabilities say. Empty is honest.
    case "resources/list":
      return { jsonrpc: "2.0", id, result: { resources: [] } };
    case "prompts/list":
      return { jsonrpc: "2.0", id, result: { prompts: [] } };
    default:
      return rpcError(id, -32601, `Unknown method ${method}.`);
  }
}
