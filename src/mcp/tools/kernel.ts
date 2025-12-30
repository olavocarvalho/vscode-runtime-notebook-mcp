import * as vscode from "vscode";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ResponseFormat, ResponseFormatSchema } from "../../schemas/index.js";

const GetKernelInfoInputSchema = z.object({
  response_format: ResponseFormatSchema
}).strict();

// Cache for Jupyter API
let jupyterApiPromise: Promise<any> | undefined;

async function getJupyterAPI(): Promise<any> {
  if (!jupyterApiPromise) {
    const ext = vscode.extensions.getExtension("ms-toolsai.jupyter");
    if (!ext) {
      throw new Error("Jupyter extension not installed");
    }
    jupyterApiPromise = ext.activate();
  }
  return jupyterApiPromise;
}

export function registerKernelTools(server: McpServer) {
  server.tool(
    "notebook_get_kernel_info",
    `Get information about the active notebook's kernel.

Returns kernel status, language, and notebook URI.

Args:
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')`,
    GetKernelInfoInputSchema.shape,
    async (params) => {
      const editor = vscode.window.activeNotebookEditor;

      if (!editor) {
        return {
          content: [{ type: "text" as const, text: "Error: No active notebook. Open a .ipynb file first." }],
          isError: true
        };
      }

      const parsed = GetKernelInfoInputSchema.parse(params);

      let kernel: any;
      try {
        const jupyter = await getJupyterAPI();
        kernel = await jupyter.kernels.getKernel(editor.notebook.uri);
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: Unable to access Jupyter extension. ${error instanceof Error ? error.message : String(error)}` }],
          isError: true
        };
      }

      if (!kernel) {
        return {
          content: [{ type: "text" as const, text: "Error: No kernel connected. Start a kernel first." }],
          isError: true
        };
      }

      const output = {
        language: kernel.language || "unknown",
        status: kernel.status || "unknown",
        notebookUri: editor.notebook.uri.toString()
      };

      if (parsed.response_format === ResponseFormat.JSON) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }]
        };
      }

      const markdown = `# Kernel Info
- **Language**: ${output.language}
- **Status**: ${output.status}
- **Notebook**: ${output.notebookUri}`;

      return {
        content: [{ type: "text" as const, text: markdown }]
      };
    }
  );
}
