import { createMcpHandler } from "@modelcontextprotocol/server";
import { createMcpServer } from "@quickshare/mcp";

import type { ApiEnv } from "./env.ts";
import { mcpOperations } from "./mcp-adapter.ts";

export async function handleMcp(
  request: Request,
  env: ApiEnv,
  requestId: string,
): Promise<Response> {
  const handler = createMcpHandler(() => createMcpServer(mcpOperations(env)), {
    legacy: "reject",
    responseMode: "json",
  });
  void requestId;
  return handler.fetch(request);
}
