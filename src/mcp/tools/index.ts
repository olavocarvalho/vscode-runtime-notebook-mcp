import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCellTools } from "./cells.js";
import { registerExecuteTools } from "./execute.js";
import { registerKernelTools } from "./kernel.js";

export function registerAllTools(server: McpServer) {
  registerKernelTools(server);
  registerCellTools(server);
  registerExecuteTools(server);
}
