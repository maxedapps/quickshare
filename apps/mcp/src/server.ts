import { McpServer } from "@modelcontextprotocol/server";

export function createMcpServer(): McpServer {
  return new McpServer({
    name: "quickshare",
    version: "0.0.0",
  });
}
