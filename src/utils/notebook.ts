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

      // Check if execution completed (success is defined, not undefined)
      if (cell.executionSummary?.success !== undefined) {
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
