import * as vscode from "vscode";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ResponseFormat, ResponseFormatSchema } from "../../schemas/index.js";
import { insertCells, deleteCells, waitForCellExecution, generateCellId } from "../../utils/notebook.js";
import { parseOutputs, formatOutputsAsMarkdown } from "../../utils/output.js";

const ExecuteCodeInputSchema = z.object({
  code: z.string().min(1, "Code cannot be empty").describe("The code to execute"),
  index: z.number().int().min(0).optional().describe("Cell index to insert at (default: append at end)"),
  language: z.string().default("python").describe("Language for the cell"),
  silent: z.boolean().default(false).describe("If true, delete the cell after execution"),
  response_format: ResponseFormatSchema
}).strict();

export function registerExecuteTools(server: McpServer) {
  server.tool(
    "notebook_execute_code",
    `Execute code in a new cell and return the output.

Creates a new cell, executes it, and returns all outputs including text, errors, and images (as base64).

Args:
  - code (string): The code to execute
  - index (number, optional): Position to insert (default: append at end)
  - language (string): Cell language (default: 'python')
  - silent (boolean): Delete cell after execution (default: false)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')`,
    ExecuteCodeInputSchema.shape,
    async (params) => {
      const editor = vscode.window.activeNotebookEditor;

      if (!editor) {
        return {
          content: [{ type: "text" as const, text: "Error: No active notebook. Open a .ipynb file first." }],
          isError: true
        };
      }

      const parsed = ExecuteCodeInputSchema.parse(params);
      const notebook = editor.notebook;

      // Create cell with tracking ID (Claude Code pattern)
      const cellId = generateCellId();
      const cellData = new vscode.NotebookCellData(
        vscode.NotebookCellKind.Code,
        parsed.code,
        parsed.language
      );
      cellData.metadata = { id: cellId };

      // Insert cell at specified index or at the end
      const insertIndex = parsed.index !== undefined ? Math.min(parsed.index, notebook.cellCount) : notebook.cellCount;
      await insertCells(notebook.uri, insertIndex, [cellData]);

      // Find the cell by metadata ID (not index, as indices can shift)
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

      // Execute the cell
      await vscode.commands.executeCommand("notebook.cell.execute", {
        ranges: [{ start: cellIndex, end: cellIndex + 1 }],
        document: notebook.uri
      });

      // Wait for execution to complete
      let executedCell: vscode.NotebookCell;
      try {
        executedCell = await waitForCellExecution(notebook, cellId);
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true
        };
      }

      // Parse outputs
      const outputs = parseOutputs(executedCell.outputs);

      // Delete cell if silent mode
      if (parsed.silent) {
        await deleteCells(notebook.uri, cellIndex, 1);
      }

      const result = {
        success: executedCell.executionSummary?.success ?? false,
        cellIndex: parsed.silent ? null : cellIndex,
        executionOrder: executedCell.executionSummary?.executionOrder ?? null,
        outputs
      };

      if (parsed.response_format === ResponseFormat.JSON) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }]
        };
      }

      // Markdown format
      const lines = [`# Execution Result`, ""];
      if (result.success) {
        lines.push(`**Status**: Success (execution #${result.executionOrder})`);
      } else {
        lines.push(`**Status**: Failed`);
      }
      if (!parsed.silent && result.cellIndex !== null) {
        lines.push(`**Cell Index**: ${result.cellIndex}`);
      }
      lines.push("");
      lines.push("## Output");
      lines.push(formatOutputsAsMarkdown(outputs));

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }]
      };
    }
  );
}
