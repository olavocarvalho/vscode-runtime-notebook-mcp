import * as vscode from "vscode";

/**
 * Insert cells into a notebook at a specific index
 */
export async function insertCells(
  uri: vscode.Uri,
  index: number,
  cells: vscode.NotebookCellData[]
): Promise<void> {
  const edit = vscode.NotebookEdit.insertCells(index, cells);
  const workspaceEdit = new vscode.WorkspaceEdit();
  workspaceEdit.set(uri, [edit]);
  await vscode.workspace.applyEdit(workspaceEdit);
}

/**
 * Delete cells from a notebook
 */
export async function deleteCells(
  uri: vscode.Uri,
  index: number,
  count: number
): Promise<void> {
  const edit = vscode.NotebookEdit.deleteCells(
    new vscode.NotebookRange(index, index + count)
  );
  const workspaceEdit = new vscode.WorkspaceEdit();
  workspaceEdit.set(uri, [edit]);
  await vscode.workspace.applyEdit(workspaceEdit);
}

/**
 * Wait for cell execution to complete by polling executionSummary
 * Uses cell metadata ID for reliable tracking (Claude Code pattern)
 */
export async function waitForCellExecution(
  notebook: vscode.NotebookDocument,
  cellId: string,
  timeout: number = 60000
): Promise<vscode.NotebookCell> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const interval = setInterval(() => {
      const cell = notebook.getCells().find((c) => c.metadata.id === cellId);

      if (!cell) {
        clearInterval(interval);
        reject(new Error("Cell not found"));
        return;
      }

      // Check if execution completed (success is a boolean, not undefined)
      if (typeof cell.executionSummary?.success === 'boolean') {
        clearInterval(interval);
        resolve(cell);
        return;
      }

      if (Date.now() - startTime > timeout) {
        clearInterval(interval);
        reject(new Error("Cell execution timed out"));
      }
    }, 100);
  });
}

/**
 * Generate a random cell ID for tracking
 */
export function generateCellId(): string {
  return Math.random().toString(36).substring(2, 15);
}

/**
 * Edit the content of an existing cell
 */
export async function editCellContent(
  cell: vscode.NotebookCell,
  newContent: string
): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  const fullRange = new vscode.Range(
    0,
    0,
    cell.document.lineCount,
    0
  );
  edit.replace(cell.document.uri, fullRange, newContent);
  await vscode.workspace.applyEdit(edit);
}

/**
 * Move a cell from one position to another
 */
export async function moveCell(
  notebook: vscode.NotebookDocument,
  fromIndex: number,
  toIndex: number
): Promise<void> {
  const cell = notebook.cellAt(fromIndex);

  // Copy cell data
  const cellData = new vscode.NotebookCellData(
    cell.kind,
    cell.document.getText(),
    cell.document.languageId
  );
  cellData.metadata = { ...cell.metadata };

  // Delete from source
  await deleteCells(notebook.uri, fromIndex, 1);

  // Adjust target index if source was before target
  const adjustedIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;

  // Insert at target
  await insertCells(notebook.uri, adjustedIndex, [cellData]);
}

export interface NotebookAccessResult {
  allowed: boolean;
  notebook?: vscode.NotebookDocument;
  editor?: vscode.NotebookEditor;
  error?: string;
}

/**
 * Get a notebook document by URI.
 * This is more robust than relying on activeNotebookEditor because it works
 * even if the user switches tabs during an operation.
 */
export async function getNotebookByUri(uri: vscode.Uri): Promise<vscode.NotebookDocument | undefined> {
  // First check if it's already open
  const existing = vscode.workspace.notebookDocuments.find(
    doc => doc.uri.toString() === uri.toString()
  );
  if (existing) {
    return existing;
  }

  // Try to open it
  try {
    return await vscode.workspace.openNotebookDocument(uri);
  } catch {
    return undefined;
  }
}

/**
 * Get the editor for a notebook if it's visible.
 * Returns undefined if the notebook is not currently visible in any editor.
 */
export function getNotebookEditor(notebook: vscode.NotebookDocument): vscode.NotebookEditor | undefined {
  return vscode.window.visibleNotebookEditors.find(
    editor => editor.notebook.uri.toString() === notebook.uri.toString()
  );
}

/**
 * Resolve which notebook to use for an operation.
 * Priority: 1) Explicit URI parameter, 2) Active notebook editor
 *
 * This allows operations to continue even if user switches tabs,
 * as long as the notebook document is still open.
 */
export async function resolveNotebook(notebookUri?: string): Promise<NotebookAccessResult> {
  // If explicit URI provided, use it
  if (notebookUri) {
    const uri = vscode.Uri.parse(notebookUri);
    const notebook = await getNotebookByUri(uri);
    if (!notebook) {
      return {
        allowed: false,
        error: `Notebook not found: ${notebookUri}`
      };
    }
    const editor = getNotebookEditor(notebook);
    return {
      allowed: true,
      notebook,
      editor // May be undefined if notebook is open but not visible
    };
  }

  // Fall back to active notebook editor
  const editor = vscode.window.activeNotebookEditor;
  if (!editor) {
    return {
      allowed: false,
      error: "No active notebook. Open a .ipynb file first, or specify notebook_uri parameter."
    };
  }

  return {
    allowed: true,
    notebook: editor.notebook,
    editor
  };
}

/**
 * Check if notebook modifications are safe.
 * Returns error if:
 * - No active notebook (and no URI provided)
 * - Window is not focused (modifications would happen in background)
 *
 * @param notebookUri Optional URI to target a specific notebook
 */
export async function checkCanModifyNotebook(notebookUri?: string): Promise<NotebookAccessResult> {
  const result = await resolveNotebook(notebookUri);
  if (!result.allowed) {
    return result;
  }

  // Check if this window is focused (only for implicit active notebook)
  // If explicit URI was provided, we trust the caller knows what they're doing
  if (!notebookUri && !vscode.window.state.focused) {
    return {
      allowed: false,
      error: "Cannot modify notebook: This VS Code window is not focused.\n\nThe MCP server is running here but you appear to be working in another window.\n\nTo fix this:\n1. Switch to this VS Code window, OR\n2. Click '→ Activate' in the other window's status bar to move the server there"
    };
  }

  return result;
}

/**
 * Check if notebook can be read (no focus requirement).
 *
 * @param notebookUri Optional URI to target a specific notebook
 */
export async function checkCanReadNotebook(notebookUri?: string): Promise<NotebookAccessResult> {
  return await resolveNotebook(notebookUri);
}
