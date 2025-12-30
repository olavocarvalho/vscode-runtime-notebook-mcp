import * as http from "http";
import * as crypto from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAllTools } from "./tools/index.js";

const DEFAULT_PORT = 49777;

let server: McpServer | undefined;
let httpServer: http.Server | undefined;
const transports = new Map<string, StreamableHTTPServerTransport>();

export function createMCPServer(): McpServer {
  server = new McpServer({
    name: "notebook-mcp-server",
    version: "0.1.0"
  });

  // Register all MCP tools
  registerAllTools(server);
  console.log("MCP Server: Created with tools registered");

  return server;
}

export async function startMCPServer(port: number = DEFAULT_PORT): Promise<number> {
  if (!server) {
    createMCPServer();
  }

  return new Promise((resolve, reject) => {
    httpServer = http.createServer(async (req, res) => {
      // Handle CORS for local development
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id");
      res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // Handle MCP requests
      if (req.url === "/mcp" || req.url?.startsWith("/mcp?")) {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;

        try {
          // Existing session
          if (sessionId && transports.has(sessionId)) {
            const transport = transports.get(sessionId)!;
            await transport.handleRequest(req, res);
            return;
          }

          // New session (POST without session ID)
          if (req.method === "POST") {
            const newSessionId = crypto.randomUUID();
            const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => newSessionId,
              enableJsonResponse: true
            });

            transports.set(newSessionId, transport);

            // Clean up on close
            transport.onclose = () => {
              transports.delete(newSessionId);
            };

            await server!.connect(transport);
            await transport.handleRequest(req, res);
            return;
          }

          // GET/DELETE without session - not valid
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing session ID" }));
        } catch (error) {
          console.error("MCP request error:", error);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Internal server error" }));
          }
        }
      } else if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", server: "notebook-mcp-server" }));
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    httpServer.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.log(`Port ${port} in use, trying ${port + 1}`);
        httpServer?.close();
        startMCPServer(port + 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });

    httpServer.listen(port, "127.0.0.1", () => {
      console.log(`MCP Server: Listening on http://127.0.0.1:${port}/mcp`);
      resolve(port);
    });
  });
}

export async function stopMCPServer(): Promise<void> {
  return new Promise((resolve) => {
    // Close all transports
    for (const transport of transports.values()) {
      transport.close();
    }
    transports.clear();

    if (httpServer) {
      httpServer.close(() => {
        httpServer = undefined;
        server = undefined;
        console.log("MCP Server: Stopped");
        resolve();
      });
    } else {
      resolve();
    }
  });
}

export function getServer(): McpServer | undefined {
  return server;
}

export function getPort(): number | undefined {
  const addr = httpServer?.address();
  if (addr && typeof addr === "object") {
    return addr.port;
  }
  return undefined;
}
