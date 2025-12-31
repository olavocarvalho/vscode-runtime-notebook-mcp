import * as vscode from "vscode";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ListCellsInputSchema, ResponseFormat, ResponseFormatSchema, CellIndexSchema } from "../../schemas/index.js";
import { parseOutputs, formatOutputsAsMarkdown } from "../../utils/output.js";
import { insertCells, deleteCells, waitForCellExecution, generateCellId, editCellContent, moveCell, checkCanModifyNotebook, checkCanReadNotebook } from "../../utils/notebook.js";

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

const EditCellInputSchema = z.object({
  index: CellIndexSchema,
  content: z.string().describe("New content for the cell"),
  response_format: ResponseFormatSchema
}).strict();

const DeleteCellInputSchema = z.object({
  index: CellIndexSchema,
  response_format: ResponseFormatSchema
}).strict();

const GetOutlineInputSchema = z.object({
  response_format: ResponseFormatSchema
}).strict();

const SearchInputSchema = z.object({
  query: z.string().min(1).describe("Search term"),
  case_sensitive: z.boolean().default(false).describe("Case-sensitive search"),
  context_lines: z.number().int().min(0).max(3).default(1).describe("Lines of context around matches"),
  response_format: ResponseFormatSchema
}).strict();

const ClearOutputsInputSchema = z.object({
  index: CellIndexSchema,
  response_format: ResponseFormatSchema
}).strict();

const MoveCellInputSchema = z.object({
  from_index: CellIndexSchema.describe("Current cell index"),
  to_index: CellIndexSchema.describe("Target cell index"),
  response_format: ResponseFormatSchema
}).strict();

const BulkAddCellsInputSchema = z.object({
  cells: z.array(z.object({
    content: z.string(),
    type: z.enum(["code", "markdown"]).default("code"),
    language: z.string().default("python")
  })).min(1).describe("Array of cells to add"),
  index: z.number().int().min(0).optional().describe("Position to insert (default: end)"),
  response_format: ResponseFormatSchema
}).strict();

const RunCellInputSchema = z.object({
  index: CellIndexSchema,
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
      const accessCheck = checkCanModifyNotebook();
      if (!accessCheck.allowed) {
        return {
          content: [{ type: "text" as const, text: `Error: ${accessCheck.error}` }],
          isError: true
        };
      }

      const parsed = InsertCellInputSchema.parse(params);
      const notebook = accessCheck.notebook!;

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
      accessCheck.editor!.revealRange(
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

  // notebook_edit_cell
  server.tool(
    "notebook_edit_cell",
    `Replace the content of an existing cell.

Args:
  - index (number): Cell index (0-based)
  - content (string): New content for the cell
  - response_format ('markdown' | 'json'): Output format`,
    EditCellInputSchema.shape,
    async (params) => {
      const accessCheck = checkCanModifyNotebook();
      if (!accessCheck.allowed) {
        return { content: [{ type: "text" as const, text: `Error: ${accessCheck.error}` }], isError: true };
      }

      const parsed = EditCellInputSchema.parse(params);
      const notebook = accessCheck.notebook!;

      if (parsed.index >= notebook.cellCount) {
        return { content: [{ type: "text" as const, text: `Error: Cell index ${parsed.index} out of range.` }], isError: true };
      }

      const cell = notebook.cellAt(parsed.index);
      await editCellContent(cell, parsed.content);

      const result = { index: parsed.index, updated: true };

      if (parsed.response_format === ResponseFormat.JSON) {
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      }
      return { content: [{ type: "text" as const, text: `Updated cell ${parsed.index}` }] };
    }
  );

  // notebook_delete_cell
  server.tool(
    "notebook_delete_cell",
    `Delete a cell from the notebook.

Args:
  - index (number): Cell index to delete (0-based)
  - response_format ('markdown' | 'json'): Output format`,
    DeleteCellInputSchema.shape,
    async (params) => {
      const accessCheck = checkCanModifyNotebook();
      if (!accessCheck.allowed) {
        return { content: [{ type: "text" as const, text: `Error: ${accessCheck.error}` }], isError: true };
      }

      const parsed = DeleteCellInputSchema.parse(params);
      const notebook = accessCheck.notebook!;

      if (parsed.index >= notebook.cellCount) {
        return { content: [{ type: "text" as const, text: `Error: Cell index ${parsed.index} out of range.` }], isError: true };
      }

      await deleteCells(notebook.uri, parsed.index, 1);

      const result = { deletedIndex: parsed.index, newCellCount: notebook.cellCount };

      if (parsed.response_format === ResponseFormat.JSON) {
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      }
      return { content: [{ type: "text" as const, text: `Deleted cell ${parsed.index}. New cell count: ${notebook.cellCount}` }] };
    }
  );

  // notebook_get_outline
  server.tool(
    "notebook_get_outline",
    `Get a structured outline of the notebook showing markdown headings, function definitions, and class definitions.

Useful for navigating large notebooks without reading all cell contents.`,
    GetOutlineInputSchema.shape,
    async (params) => {
      const editor = vscode.window.activeNotebookEditor;
      if (!editor) {
        return { content: [{ type: "text" as const, text: "Error: No active notebook." }], isError: true };
      }

      const { response_format } = GetOutlineInputSchema.parse(params);
      const outline: Array<{
        cellIndex: number;
        cellType: string;
        lineCount: number;
        items: Array<{ type: string; level?: number; name: string; line: number }>;
      }> = [];

      for (const cell of editor.notebook.getCells()) {
        const text = cell.document.getText();
        const lines = text.split("\n");
        const items: Array<{ type: string; level?: number; name: string; line: number }> = [];

        if (cell.kind === vscode.NotebookCellKind.Markup) {
          // Extract markdown headings
          lines.forEach((line, lineNum) => {
            const match = line.match(/^(#{1,6})\s+(.+)$/);
            if (match) {
              items.push({ type: "heading", level: match[1].length, name: match[2].trim(), line: lineNum });
            }
          });
        } else {
          // Extract Python functions and classes
          lines.forEach((line, lineNum) => {
            const funcMatch = line.match(/^(?:async\s+)?def\s+(\w+)\s*\(/);
            const classMatch = line.match(/^class\s+(\w+)/);
            if (funcMatch) {
              items.push({ type: "function", name: funcMatch[1], line: lineNum });
            } else if (classMatch) {
              items.push({ type: "class", name: classMatch[1], line: lineNum });
            }
          });
        }

        outline.push({
          cellIndex: cell.index,
          cellType: cell.kind === vscode.NotebookCellKind.Code ? "code" : "markdown",
          lineCount: lines.length,
          items
        });
      }

      if (response_format === ResponseFormat.JSON) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ outline }, null, 2) }] };
      }

      // Markdown format
      const output = ["# Notebook Outline", ""];
      for (const entry of outline) {
        if (entry.items.length > 0) {
          for (const item of entry.items) {
            const icon = item.type === "heading" ? "#".repeat(item.level || 1)
                       : item.type === "class" ? "📦" : "🔧";
            output.push(`${icon} **${item.name}** (cell ${entry.cellIndex}:${item.line})`);
          }
        }
      }
      if (output.length === 2) output.push("_No headings, functions, or classes found._");

      return { content: [{ type: "text" as const, text: output.join("\n") }] };
    }
  );

  // notebook_search
  server.tool(
    "notebook_search",
    `Search all cells for a keyword and return matches with context.

Args:
  - query (string): Search term
  - case_sensitive (boolean): Case-sensitive search (default: false)
  - context_lines (number): Lines of context around matches (0-3, default: 1)
  - response_format ('markdown' | 'json'): Output format`,
    SearchInputSchema.shape,
    async (params) => {
      const editor = vscode.window.activeNotebookEditor;
      if (!editor) {
        return { content: [{ type: "text" as const, text: "Error: No active notebook." }], isError: true };
      }

      const { query, case_sensitive, context_lines, response_format } = SearchInputSchema.parse(params);
      const results: Array<{
        cellIndex: number;
        cellType: string;
        matches: Array<{ line: number; text: string; context?: string[] }>;
      }> = [];

      for (const cell of editor.notebook.getCells()) {
        const text = cell.document.getText();
        const lines = text.split("\n");
        const searchQuery = case_sensitive ? query : query.toLowerCase();
        const cellMatches: Array<{ line: number; text: string; context?: string[] }> = [];

        lines.forEach((line, lineNum) => {
          const lineToSearch = case_sensitive ? line : line.toLowerCase();
          if (lineToSearch.includes(searchQuery)) {
            const match: { line: number; text: string; context?: string[] } = {
              line: lineNum,
              text: line.trim().substring(0, 100)
            };
            if (context_lines > 0) {
              const start = Math.max(0, lineNum - context_lines);
              const end = Math.min(lines.length, lineNum + context_lines + 1);
              match.context = lines.slice(start, end);
            }
            cellMatches.push(match);
          }
        });

        if (cellMatches.length > 0) {
          results.push({
            cellIndex: cell.index,
            cellType: cell.kind === vscode.NotebookCellKind.Code ? "code" : "markdown",
            matches: cellMatches
          });
        }
      }

      const totalMatches = results.reduce((sum, r) => sum + r.matches.length, 0);

      if (response_format === ResponseFormat.JSON) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ query, totalMatches, results }, null, 2) }] };
      }

      // Markdown format
      const output = [`# Search: "${query}"`, "", `**${totalMatches}** matches in **${results.length}** cells`, ""];
      for (const r of results) {
        output.push(`## Cell ${r.cellIndex} (${r.cellType})`);
        for (const m of r.matches) {
          output.push(`- Line ${m.line}: \`${m.text}\``);
          if (m.context) {
            output.push("```", ...m.context, "```");
          }
        }
      }
      if (results.length === 0) output.push("_No matches found._");

      return { content: [{ type: "text" as const, text: output.join("\n") }] };
    }
  );

  // notebook_clear_outputs
  server.tool(
    "notebook_clear_outputs",
    `Clear the outputs of a specific cell.

Args:
  - index (number): Cell index (0-based)`,
    ClearOutputsInputSchema.shape,
    async (params) => {
      const accessCheck = checkCanModifyNotebook();
      if (!accessCheck.allowed) {
        return { content: [{ type: "text" as const, text: `Error: ${accessCheck.error}` }], isError: true };
      }

      const { index, response_format } = ClearOutputsInputSchema.parse(params);
      if (index >= accessCheck.notebook!.cellCount) {
        return { content: [{ type: "text" as const, text: `Error: Cell index ${index} out of range.` }], isError: true };
      }

      // Select the cell and clear its outputs
      accessCheck.editor!.selection = new vscode.NotebookRange(index, index + 1);
      await vscode.commands.executeCommand("notebook.cell.clearOutputs");

      if (response_format === ResponseFormat.JSON) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ index, cleared: true }, null, 2) }] };
      }
      return { content: [{ type: "text" as const, text: `Cleared outputs for cell ${index}` }] };
    }
  );

  // notebook_clear_all_outputs
  server.tool(
    "notebook_clear_all_outputs",
    `Clear outputs from all cells in the notebook.`,
    { response_format: ResponseFormatSchema },
    async (params) => {
      const accessCheck = checkCanModifyNotebook();
      if (!accessCheck.allowed) {
        return { content: [{ type: "text" as const, text: `Error: ${accessCheck.error}` }], isError: true };
      }

      await vscode.commands.executeCommand("notebook.clearAllCellsOutputs");

      const { response_format } = ListCellsInputSchema.parse(params);
      if (response_format === ResponseFormat.JSON) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ cleared: true, cellCount: accessCheck.notebook!.cellCount }, null, 2) }] };
      }
      return { content: [{ type: "text" as const, text: `Cleared outputs from all ${accessCheck.notebook!.cellCount} cells` }] };
    }
  );

  // notebook_move_cell
  server.tool(
    "notebook_move_cell",
    `Move a cell to a different position in the notebook.

Args:
  - from_index (number): Current cell index
  - to_index (number): Target position`,
    MoveCellInputSchema.shape,
    async (params) => {
      const accessCheck = checkCanModifyNotebook();
      if (!accessCheck.allowed) {
        return { content: [{ type: "text" as const, text: `Error: ${accessCheck.error}` }], isError: true };
      }

      const { from_index, to_index, response_format } = MoveCellInputSchema.parse(params);
      const notebook = accessCheck.notebook!;

      if (from_index >= notebook.cellCount || to_index >= notebook.cellCount) {
        return { content: [{ type: "text" as const, text: "Error: Cell index out of range." }], isError: true };
      }

      if (from_index === to_index) {
        return { content: [{ type: "text" as const, text: "Cell already at target position." }] };
      }

      await moveCell(notebook, from_index, to_index);

      if (response_format === ResponseFormat.JSON) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ from: from_index, to: to_index, moved: true }, null, 2) }] };
      }
      return { content: [{ type: "text" as const, text: `Moved cell from ${from_index} to ${to_index}` }] };
    }
  );

  // notebook_bulk_add_cells
  server.tool(
    "notebook_bulk_add_cells",
    `Add multiple cells to the notebook in a single operation.

Args:
  - cells (array): Array of {content, type, language} objects
  - index (number, optional): Position to insert (default: append at end)`,
    BulkAddCellsInputSchema.shape,
    async (params) => {
      const accessCheck = checkCanModifyNotebook();
      if (!accessCheck.allowed) {
        return { content: [{ type: "text" as const, text: `Error: ${accessCheck.error}` }], isError: true };
      }

      const { cells, index, response_format } = BulkAddCellsInputSchema.parse(params);
      const notebook = accessCheck.notebook!;
      const insertIndex = index !== undefined ? Math.min(index, notebook.cellCount) : notebook.cellCount;

      const cellDataArray = cells.map(c => {
        const kind = c.type === "code" ? vscode.NotebookCellKind.Code : vscode.NotebookCellKind.Markup;
        const lang = c.type === "code" ? c.language : "markdown";
        return new vscode.NotebookCellData(kind, c.content, lang);
      });

      await insertCells(notebook.uri, insertIndex, cellDataArray);

      if (response_format === ResponseFormat.JSON) {
        return { content: [{ type: "text" as const, text: JSON.stringify({
          inserted: cells.length,
          startIndex: insertIndex,
          newCellCount: notebook.cellCount
        }, null, 2) }] };
      }
      return { content: [{ type: "text" as const, text: `Added ${cells.length} cells at index ${insertIndex}` }] };
    }
  );

  // notebook_run_cell
  server.tool(
    "notebook_run_cell",
    `Execute an existing cell in the notebook and return its output.

Use this to run a cell that already exists in the notebook. The cell and its output will persist in the notebook UI.

Args:
  - index (number): Cell index to execute (0-based)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')`,
    RunCellInputSchema.shape,
    async (params) => {
      const accessCheck = checkCanModifyNotebook();
      if (!accessCheck.allowed) {
        return {
          content: [{ type: "text" as const, text: `Error: ${accessCheck.error}` }],
          isError: true
        };
      }

      const parsed = RunCellInputSchema.parse(params);
      const notebook = accessCheck.notebook!;
      const editor = accessCheck.editor!;

      if (parsed.index >= notebook.cellCount) {
        return {
          content: [{ type: "text" as const, text: `Error: Cell index ${parsed.index} out of range (0-${notebook.cellCount - 1}).` }],
          isError: true
        };
      }

      const cell = notebook.cellAt(parsed.index);

      // Only code cells can be executed
      if (cell.kind !== vscode.NotebookCellKind.Code) {
        return {
          content: [{ type: "text" as const, text: `Error: Cell ${parsed.index} is a markdown cell. Only code cells can be executed.` }],
          isError: true
        };
      }

      // Add tracking ID to the cell metadata if not present
      const cellId = cell.metadata?.id || generateCellId();
      if (!cell.metadata?.id) {
        // Note: We can't easily update metadata on existing cells, so we use the index as fallback
      }

      // Reveal and select the cell
      editor.revealRange(
        new vscode.NotebookRange(parsed.index, parsed.index + 1),
        vscode.NotebookEditorRevealType.InCenter
      );

      // Execute the cell
      await vscode.commands.executeCommand("notebook.cell.execute", {
        ranges: [{ start: parsed.index, end: parsed.index + 1 }],
        document: notebook.uri
      });

      // Wait for execution to complete by polling executionSummary
      const timeout = 60000;
      const startTime = Date.now();
      let executedCell = cell;

      while (Date.now() - startTime < timeout) {
        // Re-fetch the cell to get updated execution state
        executedCell = notebook.cellAt(parsed.index);
        if (typeof executedCell.executionSummary?.success === 'boolean') {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (typeof executedCell.executionSummary?.success !== 'boolean') {
        return {
          content: [{ type: "text" as const, text: "Error: Cell execution timed out." }],
          isError: true
        };
      }

      // Parse outputs
      const outputs = parseOutputs(executedCell.outputs);

      const result = {
        success: executedCell.executionSummary?.success ?? false,
        cellIndex: parsed.index,
        executionOrder: executedCell.executionSummary?.executionOrder ?? null,
        outputs
      };

      if (parsed.response_format === ResponseFormat.JSON) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }]
        };
      }

      // Markdown format
      const lines = [`# Cell ${parsed.index} Execution Result`, ""];
      if (result.success) {
        lines.push(`**Status**: Success (execution #${result.executionOrder})`);
      } else {
        lines.push(`**Status**: Failed`);
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
