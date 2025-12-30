import * as vscode from "vscode";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ListCellsInputSchema, ResponseFormat, ResponseFormatSchema, CellIndexSchema } from "../../schemas/index.js";
import { parseOutputs, formatOutputsAsMarkdown } from "../../utils/output.js";
import { insertCells, waitForCellExecution, generateCellId } from "../../utils/notebook.js";

const GetCellContentInputSchema = z.object({
  index: CellIndexSchema,
  response_format: ResponseFormatSchema
}).strict();

const GetCellOutputInputSchema = z.object({
  index: CellIndexSchema,
  response_format: ResponseFormatSchema
}).strict();

const InsertCellInputSchema = z.object({
  content: z.string().describe("Cell content (code or markdown)"),
  type: z.enum(["code", "markdown"]).default("code").describe("Cell type"),
  index: z.number().int().min(0).optional().describe("Position to insert (default: append at end)"),
  language: z.string().default("python").describe("Language for code cells"),
  execute: z.boolean().default(false).describe("Execute the cell after insertion (code cells only)"),
  response_format: ResponseFormatSchema
}).strict();

export function registerCellTools(server: McpServer) {
  // notebook_list_open
  server.tool(
    "notebook_list_open",
    "List all open notebooks with their URIs, filenames, cell counts, and which one is currently active (focused).",
    { response_format: ResponseFormatSchema },
    async (params) => {
      const notebooks = vscode.workspace.notebookDocuments;
      const activeUri = vscode.window.activeNotebookEditor?.notebook.uri.toString();

      const result = notebooks.map((nb) => ({
        uri: nb.uri.toString(),
        fileName: nb.uri.path.split("/").pop() || "unknown",
        cellCount: nb.cellCount,
        isActive: nb.uri.toString() === activeUri
      }));

      const parsed = ListCellsInputSchema.parse(params);

      if (parsed.response_format === ResponseFormat.JSON) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ notebooks: result }, null, 2) }]
        };
      }

      if (result.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No notebooks open. Open a .ipynb file first." }]
        };
      }

      const lines = [`# Open Notebooks (${result.length})`, ""];
      for (const nb of result) {
        const active = nb.isActive ? " ← active" : "";
        lines.push(`- **${nb.fileName}** (${nb.cellCount} cells)${active}`);
        lines.push(`  \`${nb.uri}\``);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }]
      };
    }
  );

  // notebook_list_cells
  server.tool(
    "notebook_list_cells",
    "List all cells in the active notebook with metadata including type, language, content preview, and execution state.",
    ListCellsInputSchema.shape,
    async (params) => {
      const editor = vscode.window.activeNotebookEditor;

      if (!editor) {
        return {
          content: [{ type: "text" as const, text: "Error: No active notebook. Open a .ipynb file first." }],
          isError: true
        };
      }

      const cells = editor.notebook.getCells().map((cell, index) => ({
        index,
        kind: cell.kind === vscode.NotebookCellKind.Code ? "code" : "markdown",
        language: cell.document.languageId,
        lineCount: cell.document.lineCount,
        preview: cell.document.getText().substring(0, 100).replace(/\n/g, "↵"),
        hasOutput: cell.outputs.length > 0,
        executionOrder: cell.executionSummary?.executionOrder ?? null
      }));

      const output = { total: cells.length, cells };
      const { response_format } = ListCellsInputSchema.parse(params);

      if (response_format === ResponseFormat.JSON) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }]
        };
      }

      const lines = [`# Notebook Cells (${cells.length} total)`, ""];
      for (const cell of cells) {
        const exec = cell.executionOrder ? ` [${cell.executionOrder}]` : "";
        const out = cell.hasOutput ? " 📊" : "";
        lines.push(`## Cell ${cell.index}${exec}${out} (${cell.kind}/${cell.language})`);
        lines.push("```");
        lines.push(cell.preview + (cell.lineCount > 3 ? "..." : ""));
        lines.push("```");
        lines.push("");
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }]
      };
    }
  );

  // notebook_get_cell_content
  server.tool(
    "notebook_get_cell_content",
    `Get the full source code of a specific cell.

Args:
  - index (number): Cell index (0-based)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')`,
    GetCellContentInputSchema.shape,
    async (params) => {
      const editor = vscode.window.activeNotebookEditor;

      if (!editor) {
        return {
          content: [{ type: "text" as const, text: "Error: No active notebook. Open a .ipynb file first." }],
          isError: true
        };
      }

      const parsed = GetCellContentInputSchema.parse(params);
      const notebook = editor.notebook;

      if (parsed.index >= notebook.cellCount) {
        return {
          content: [{ type: "text" as const, text: `Error: Cell index ${parsed.index} out of range (0-${notebook.cellCount - 1}).` }],
          isError: true
        };
      }

      const cell = notebook.cellAt(parsed.index);
      const output = {
        index: parsed.index,
        kind: cell.kind === vscode.NotebookCellKind.Code ? "code" : "markdown",
        language: cell.document.languageId,
        content: cell.document.getText()
      };

      if (parsed.response_format === ResponseFormat.JSON) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }]
        };
      }

      const lines = [
        `# Cell ${parsed.index} (${output.kind}/${output.language})`,
        "",
        "```" + output.language,
        output.content,
        "```"
      ];

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }]
      };
    }
  );

  // notebook_get_cell_output
  server.tool(
    "notebook_get_cell_output",
    `Get the outputs of a specific cell (text, errors, images).

Args:
  - index (number): Cell index (0-based)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')`,
    GetCellOutputInputSchema.shape,
    async (params) => {
      const editor = vscode.window.activeNotebookEditor;

      if (!editor) {
        return {
          content: [{ type: "text" as const, text: "Error: No active notebook. Open a .ipynb file first." }],
          isError: true
        };
      }

      const parsed = GetCellOutputInputSchema.parse(params);
      const notebook = editor.notebook;

      if (parsed.index >= notebook.cellCount) {
        return {
          content: [{ type: "text" as const, text: `Error: Cell index ${parsed.index} out of range (0-${notebook.cellCount - 1}).` }],
          isError: true
        };
      }

      const cell = notebook.cellAt(parsed.index);
      const outputs = parseOutputs(cell.outputs);

      const output = {
        index: parsed.index,
        hasOutput: outputs.length > 0,
        executionOrder: cell.executionSummary?.executionOrder ?? null,
        outputs
      };

      if (parsed.response_format === ResponseFormat.JSON) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }]
        };
      }

      if (outputs.length === 0) {
        return {
          content: [{ type: "text" as const, text: `# Cell ${parsed.index} Output\n\nNo output available.` }]
        };
      }

      const lines = [
        `# Cell ${parsed.index} Output`,
        output.executionOrder ? `Execution #${output.executionOrder}` : "",
        "",
        formatOutputsAsMarkdown(outputs)
      ];

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }]
      };
    }
  );

  // notebook_insert_cell
  server.tool(
    "notebook_insert_cell",
    `Insert a new cell (code or markdown) into the notebook.

Args:
  - content (string): Cell content
  - type ('code' | 'markdown'): Cell type (default: 'code')
  - index (number, optional): Position to insert (default: append at end)
  - language (string): Language for code cells (default: 'python')
  - execute (boolean): Execute after insertion, code cells only (default: false)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')`,
    InsertCellInputSchema.shape,
    async (params) => {
      const editor = vscode.window.activeNotebookEditor;

      if (!editor) {
        return {
          content: [{ type: "text" as const, text: "Error: No active notebook. Open a .ipynb file first." }],
          isError: true
        };
      }

      const parsed = InsertCellInputSchema.parse(params);
      const notebook = editor.notebook;

      // Create cell with tracking ID
      const cellId = generateCellId();
      const cellKind = parsed.type === "code" ? vscode.NotebookCellKind.Code : vscode.NotebookCellKind.Markup;
      const cellData = new vscode.NotebookCellData(
        cellKind,
        parsed.content,
        parsed.type === "code" ? parsed.language : "markdown"
      );
      cellData.metadata = { id: cellId };

      // Insert at specified index or at the end
      const insertIndex = parsed.index !== undefined ? Math.min(parsed.index, notebook.cellCount) : notebook.cellCount;
      await insertCells(notebook.uri, insertIndex, [cellData]);

      // Find the cell by metadata ID
      const cell = notebook.getCells().find((c) => c.metadata.id === cellId);
      if (!cell) {
        return {
          content: [{ type: "text" as const, text: "Error: Failed to create cell." }],
          isError: true
        };
      }

      const cellIndex = notebook.getCells().indexOf(cell);

      // Reveal the cell
      editor.revealRange(
        new vscode.NotebookRange(cellIndex, cellIndex + 1),
        vscode.NotebookEditorRevealType.InCenter
      );

      let executionResult = null;

      // Execute if requested and cell is code
      if (parsed.execute && parsed.type === "code") {
        await vscode.commands.executeCommand("notebook.cell.execute", {
          ranges: [{ start: cellIndex, end: cellIndex + 1 }],
          document: notebook.uri
        });

        try {
          const executedCell = await waitForCellExecution(notebook, cellId);
          const outputs = parseOutputs(executedCell.outputs);
          executionResult = {
            success: executedCell.executionSummary?.success ?? false,
            executionOrder: executedCell.executionSummary?.executionOrder ?? null,
            outputs
          };
        } catch (error) {
          executionResult = {
            success: false,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      }

      const result = {
        cellIndex,
        type: parsed.type,
        language: parsed.type === "code" ? parsed.language : "markdown",
        executed: parsed.execute && parsed.type === "code",
        execution: executionResult
      };

      if (parsed.response_format === ResponseFormat.JSON) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }]
        };
      }

      // Markdown format
      const lines = [`# Cell Inserted`, ""];
      lines.push(`**Index**: ${result.cellIndex}`);
      lines.push(`**Type**: ${result.type}/${result.language}`);

      if (result.executed && executionResult) {
        lines.push("");
        if ("error" in executionResult) {
          lines.push(`**Execution**: Failed - ${executionResult.error}`);
        } else {
          lines.push(`**Execution**: ${executionResult.success ? "Success" : "Failed"} (#${executionResult.executionOrder})`);
          if (executionResult.outputs && executionResult.outputs.length > 0) {
            lines.push("");
            lines.push("## Output");
            lines.push(formatOutputsAsMarkdown(executionResult.outputs));
          }
        }
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }]
      };
    }
  );
}
