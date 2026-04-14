import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerWikiTools, type WikiToolDependencies } from "./tools";

export async function startMcpServer(deps: WikiToolDependencies): Promise<McpServer> {
  const server = new McpServer({
    name: "willipedia",
    version: "0.1.0",
  });

  registerWikiTools(server, deps);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Willipedia MCP server listening on stdio");
  return server;
}
