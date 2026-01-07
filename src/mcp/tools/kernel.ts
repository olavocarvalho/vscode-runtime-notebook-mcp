import * as vscode from "vscode";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ResponseFormat, ResponseFormatSchema } from "../../schemas/index.js";
import { parseOutputs, formatOutputsAsMarkdown } from "../../utils/output.js";
import { checkCanReadNotebook } from "../../utils/notebook.js";

const GetKernelInfoInputSchema = z.object({
  response_format: ResponseFormatSchema
}).strict();

const NotebookUriSchema = z.string().optional().describe("Optional notebook URI to target. If not provided, uses the active notebook.");

const GetKernelContextInputSchema = z.object({
  include_variables: z.boolean().default(true).describe("Include current kernel variables"),
  include_history: z.boolean().default(true).describe("Include recent cell execution history"),
  max_value_length: z.number().int().min(50).max(500).default(100).describe("Max characters for variable value representation"),
  notebook_uri: NotebookUriSchema,
  response_format: ResponseFormatSchema
}).strict();

// Python code to introspect kernel state
const INTROSPECTION_CODE = `
import json
import sys

def _get_kernel_context(max_value_length=100):
    """Get kernel context including variables and imports."""
    result = {
        "variables": [],
        "imports": [],
        "python_version": sys.version.split()[0]
    }

    # Get user-defined variables (exclude internal/private ones)
    user_ns = get_ipython().user_ns if 'get_ipython' in dir() else globals()

    # Common internal names to skip
    skip_names = {
        'In', 'Out', 'get_ipython', 'exit', 'quit', 'open', 'input',
        '_', '__', '___', '_i', '_ii', '_iii', '_oh', '_dh', '_sh',
        '__name__', '__doc__', '__package__', '__loader__', '__spec__',
        '__builtins__', '__file__', '__cached__', '_get_kernel_context'
    }

    for name, value in user_ns.items():
        # Skip private/internal variables
        if name.startswith('_') and not name.startswith('__'):
            continue
        if name in skip_names:
            continue
        if callable(value) and hasattr(value, '__module__'):
            # Skip imported functions/classes
            if value.__module__ != '__main__':
                continue

        try:
            type_name = type(value).__name__

            # Get a truncated representation
            try:
                repr_val = repr(value)
                if len(repr_val) > max_value_length:
                    repr_val = repr_val[:max_value_length] + "..."
            except:
                repr_val = f"<{type_name}>"

            # Get shape/length info for common data types
            shape_info = None
            if hasattr(value, 'shape'):
                shape_info = str(value.shape)
            elif hasattr(value, '__len__') and not isinstance(value, str):
                try:
                    shape_info = f"len={len(value)}"
                except:
                    pass

            result["variables"].append({
                "name": name,
                "type": type_name,
                "value": repr_val,
                "shape": shape_info
            })
        except Exception as e:
            result["variables"].append({
                "name": name,
                "type": "unknown",
                "value": f"<error: {str(e)}>",
                "shape": None
            })

    # Get imported modules
    for name, value in user_ns.items():
        if name.startswith('_'):
            continue
        if isinstance(value, type(sys)):  # It's a module
            result["imports"].append(name)

    # Sort variables by name
    result["variables"].sort(key=lambda x: x["name"])
    result["imports"].sort()

    print(json.dumps(result))

_get_kernel_context(max_value_length={max_value_length})
del _get_kernel_context
`;

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

  // notebook_get_kernel_context
  server.tool(
    "notebook_get_kernel_context",
    `Get the current kernel context including variables, imports, and recent execution history.

This tool provides Claude with awareness of the notebook's runtime state, enabling more informed code generation.

Args:
  - include_variables (boolean): Include current kernel variables (default: true)
  - include_history (boolean): Include recent cell execution history (default: true)
  - max_value_length (number): Max characters for variable value representation (50-500, default: 100)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')`,
    GetKernelContextInputSchema.shape,
    async (params) => {
      const parsed = GetKernelContextInputSchema.parse(params);

      const accessCheck = await checkCanReadNotebook(parsed.notebook_uri);
      if (!accessCheck.allowed) {
        return {
          content: [{ type: "text" as const, text: `Error: ${accessCheck.error}` }],
          isError: true
        };
      }

      const notebook = accessCheck.notebook!;

      let kernel: any;
      try {
        const jupyter = await getJupyterAPI();
        kernel = await jupyter.kernels.getKernel(notebook.uri);
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: Unable to access Jupyter extension. ${error instanceof Error ? error.message : String(error)}` }],
          isError: true
        };
      }

      if (!kernel) {
        return {
          content: [{ type: "text" as const, text: "Error: No kernel connected. Start a kernel first by running a cell." }],
          isError: true
        };
      }

      // Build the result object
      const result: {
        variables?: Array<{ name: string; type: string; value: string; shape: string | null }>;
        imports?: string[];
        python_version?: string;
        recent_cells?: Array<{
          index: number;
          executionOrder: number | null;
          code: string;
          hasOutput: boolean;
          outputPreview?: string;
        }>;
        error?: string;
      } = {};

      // Get variables via kernel execution
      if (parsed.include_variables) {
        try {
          const code = INTROSPECTION_CODE.replace('{max_value_length}', String(parsed.max_value_length));
          const tokenSource = new vscode.CancellationTokenSource();

          // Set a timeout for the introspection
          const timeoutId = setTimeout(() => tokenSource.cancel(), 10000);

          let outputText = '';
          try {
            for await (const output of kernel.executeCode(code, tokenSource.token)) {
              if (output.items) {
                for (const item of output.items) {
                  if (item.mime === 'text/plain' || item.mime === 'application/vnd.code.notebook.stdout') {
                    const decoder = new TextDecoder();
                    outputText += decoder.decode(item.data);
                  }
                }
              }
            }
          } finally {
            clearTimeout(timeoutId);
            tokenSource.dispose();
          }

          // Parse the JSON output
          if (outputText.trim()) {
            const contextData = JSON.parse(outputText.trim());
            result.variables = contextData.variables;
            result.imports = contextData.imports;
            result.python_version = contextData.python_version;
          }
        } catch (error) {
          result.error = `Failed to get variables: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      // Get recent cell execution history from the notebook itself
      if (parsed.include_history) {
        const recentCells: Array<{
          index: number;
          executionOrder: number | null;
          code: string;
          hasOutput: boolean;
          outputPreview?: string;
        }> = [];

        // Get cells with execution order, sorted by execution order
        const executedCells = notebook.getCells()
          .filter(cell => cell.kind === vscode.NotebookCellKind.Code && cell.executionSummary?.executionOrder)
          .sort((a, b) => (a.executionSummary?.executionOrder ?? 0) - (b.executionSummary?.executionOrder ?? 0))
          .slice(-10); // Last 10 executed cells

        for (const cell of executedCells) {
          const code = cell.document.getText();
          const outputs = parseOutputs(cell.outputs);
          let outputPreview: string | undefined;

          if (outputs.length > 0) {
            const firstOutput = outputs[0];
            if (firstOutput.type === 'text') {
              outputPreview = firstOutput.text.substring(0, 200);
              if (firstOutput.text.length > 200) outputPreview += '...';
            } else if (firstOutput.type === 'error') {
              outputPreview = `Error: ${firstOutput.name}: ${firstOutput.message}`;
            } else if (firstOutput.type === 'image') {
              outputPreview = `[Image: ${firstOutput.mimeType}]`;
            }
          }

          recentCells.push({
            index: cell.index,
            executionOrder: cell.executionSummary?.executionOrder ?? null,
            code: code.substring(0, 500) + (code.length > 500 ? '...' : ''),
            hasOutput: outputs.length > 0,
            outputPreview
          });
        }

        result.recent_cells = recentCells;
      }

      // Format output
      if (parsed.response_format === ResponseFormat.JSON) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }]
        };
      }

      // Markdown format
      const lines: string[] = ['# Kernel Context', ''];

      if (result.python_version) {
        lines.push(`**Python Version**: ${result.python_version}`);
        lines.push('');
      }

      if (result.error) {
        lines.push(`⚠️ **Warning**: ${result.error}`);
        lines.push('');
      }

      if (result.imports && result.imports.length > 0) {
        lines.push('## Imported Modules');
        lines.push('```');
        lines.push(result.imports.join(', '));
        lines.push('```');
        lines.push('');
      }

      if (result.variables && result.variables.length > 0) {
        lines.push(`## Variables (${result.variables.length})`);
        lines.push('');
        lines.push('| Name | Type | Shape | Value |');
        lines.push('|------|------|-------|-------|');
        for (const v of result.variables) {
          const shape = v.shape || '-';
          const value = v.value.replace(/\|/g, '\\|').replace(/\n/g, '↵');
          lines.push(`| \`${v.name}\` | ${v.type} | ${shape} | \`${value}\` |`);
        }
        lines.push('');
      } else if (parsed.include_variables) {
        lines.push('## Variables');
        lines.push('_No user-defined variables found._');
        lines.push('');
      }

      if (result.recent_cells && result.recent_cells.length > 0) {
        lines.push(`## Recent Execution History (${result.recent_cells.length} cells)`);
        lines.push('');
        for (const cell of result.recent_cells) {
          lines.push(`### Cell ${cell.index} [${cell.executionOrder}]`);
          lines.push('```python');
          lines.push(cell.code);
          lines.push('```');
          if (cell.outputPreview) {
            lines.push('**Output:**');
            lines.push('```');
            lines.push(cell.outputPreview);
            lines.push('```');
          }
          lines.push('');
        }
      } else if (parsed.include_history) {
        lines.push('## Recent Execution History');
        lines.push('_No cells have been executed yet._');
        lines.push('');
      }

      return {
        content: [{ type: "text" as const, text: lines.join('\n') }]
      };
    }
  );
}
