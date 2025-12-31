import * as assert from "assert";
import * as vscode from "vscode";

suite("Notebook MCP E2E Tests", () => {
  let notebook: vscode.NotebookDocument | undefined;

  suiteSetup(async function () {
    this.timeout(60000);

    // Wait for extension to activate
    const ext = vscode.extensions.getExtension("olavocarvalho.notebook-mcp-server");
    if (ext && !ext.isActive) {
      await ext.activate();
    }

    // Try to open the large notebook from test fixtures
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      const largeNotebookPath = vscode.Uri.joinPath(workspaceFolders[0].uri, "test/e2e/fixtures/large_notebook.ipynb");
      try {
        console.log(`Trying to open: ${largeNotebookPath.toString()}`);
        const doc = await vscode.workspace.openNotebookDocument(largeNotebookPath);
        await vscode.window.showNotebookDocument(doc);
        await new Promise((resolve) => setTimeout(resolve, 3000)); // Wait for notebook to fully load
        notebook = doc;
      } catch (e) {
        console.log(`Failed to open large notebook: ${e}`);
      }
    }

    // Fallback: Check if a notebook is already open
    if (!notebook) {
      notebook = vscode.workspace.notebookDocuments[0];
    }

    // Final fallback: create test notebook
    if (!notebook) {
      console.log("No notebook provided, creating test notebook...");
      await vscode.commands.executeCommand("ipynb.newUntitledIpynb");
      await new Promise((resolve) => setTimeout(resolve, 2000));
      notebook = vscode.workspace.notebookDocuments[0];
    }

    console.log(`Testing with notebook: ${notebook?.uri.toString()}`);
    console.log(`Cell count: ${notebook?.cellCount}`);
  });

  test("Extension should be active", async () => {
    const ext = vscode.extensions.getExtension("olavocarvalho.notebook-mcp-server");
    assert.ok(ext, "Extension should be present");
    assert.ok(ext.isActive, "Extension should be active");
  });

  test("Should have active notebook", () => {
    assert.ok(notebook, "Should have a notebook document");
  });

  suite("Cell Operations Performance", () => {
    test("List cells performance", async function () {
      if (!notebook) {
        this.skip();
        return;
      }

      const start = performance.now();
      const cells = notebook.getCells();
      const elapsed = performance.now() - start;

      console.log(`Listed ${cells.length} cells in ${elapsed.toFixed(2)}ms`);
      assert.ok(elapsed < 1000, `Should list cells in under 1s (took ${elapsed}ms)`);
    });

    test("Read cell content performance", async function () {
      if (!notebook || notebook.cellCount === 0) {
        this.skip();
        return;
      }

      const start = performance.now();
      const contents: string[] = [];

      for (const cell of notebook.getCells()) {
        contents.push(cell.document.getText());
      }

      const elapsed = performance.now() - start;
      const totalChars = contents.reduce((sum, c) => sum + c.length, 0);

      console.log(`Read ${notebook.cellCount} cells (${totalChars} chars) in ${elapsed.toFixed(2)}ms`);
      assert.ok(elapsed < 5000, `Should read all cells in under 5s (took ${elapsed}ms)`);
    });

    test("Read cell outputs performance", async function () {
      if (!notebook || notebook.cellCount === 0) {
        this.skip();
        return;
      }

      const start = performance.now();
      let outputCount = 0;
      let totalOutputSize = 0;

      for (const cell of notebook.getCells()) {
        for (const output of cell.outputs) {
          outputCount++;
          for (const item of output.items) {
            totalOutputSize += item.data.byteLength;
          }
        }
      }

      const elapsed = performance.now() - start;

      console.log(`Read ${outputCount} outputs (${(totalOutputSize / 1024).toFixed(2)}KB) in ${elapsed.toFixed(2)}ms`);
      assert.ok(elapsed < 10000, `Should read all outputs in under 10s (took ${elapsed}ms)`);
    });

    test("Insert cell performance", async function () {
      if (!notebook) {
        this.skip();
        return;
      }

      const initialCount = notebook.cellCount;
      const start = performance.now();

      // Insert a test cell
      const cellData = new vscode.NotebookCellData(
        vscode.NotebookCellKind.Code,
        "# E2E Test Cell\nprint('hello')",
        "python"
      );

      const edit = vscode.NotebookEdit.insertCells(notebook.cellCount, [cellData]);
      const workspaceEdit = new vscode.WorkspaceEdit();
      workspaceEdit.set(notebook.uri, [edit]);
      await vscode.workspace.applyEdit(workspaceEdit);

      const elapsed = performance.now() - start;

      console.log(`Inserted cell in ${elapsed.toFixed(2)}ms`);
      assert.strictEqual(notebook.cellCount, initialCount + 1, "Should have one more cell");
      assert.ok(elapsed < 2000, `Should insert cell in under 2s (took ${elapsed}ms)`);

      // Cleanup: delete the test cell
      const deleteEdit = vscode.NotebookEdit.deleteCells(
        new vscode.NotebookRange(notebook.cellCount - 1, notebook.cellCount)
      );
      const cleanupEdit = new vscode.WorkspaceEdit();
      cleanupEdit.set(notebook.uri, [deleteEdit]);
      await vscode.workspace.applyEdit(cleanupEdit);
    });

    test("Edit cell content performance", async function () {
      if (!notebook || notebook.cellCount === 0) {
        this.skip();
        return;
      }

      const cell = notebook.cellAt(0);
      const originalContent = cell.document.getText();
      const testContent = "# Modified by E2E test\n" + originalContent;

      const start = performance.now();

      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(0, 0, cell.document.lineCount, 0);
      edit.replace(cell.document.uri, fullRange, testContent);
      await vscode.workspace.applyEdit(edit);

      const elapsed = performance.now() - start;

      console.log(`Edited cell in ${elapsed.toFixed(2)}ms`);
      assert.ok(elapsed < 2000, `Should edit cell in under 2s (took ${elapsed}ms)`);

      // Restore original content
      const restoreEdit = new vscode.WorkspaceEdit();
      const newRange = new vscode.Range(0, 0, notebook.cellAt(0).document.lineCount, 0);
      restoreEdit.replace(cell.document.uri, newRange, originalContent);
      await vscode.workspace.applyEdit(restoreEdit);
    });
  });

  suite("Search Performance", () => {
    test("Search all cells performance", async function () {
      if (!notebook || notebook.cellCount === 0) {
        this.skip();
        return;
      }

      const searchTerm = "import"; // Common term in notebooks
      const start = performance.now();
      let matchCount = 0;

      for (const cell of notebook.getCells()) {
        const text = cell.document.getText().toLowerCase();
        if (text.includes(searchTerm.toLowerCase())) {
          matchCount++;
        }
      }

      const elapsed = performance.now() - start;

      console.log(`Searched ${notebook.cellCount} cells, found ${matchCount} matches in ${elapsed.toFixed(2)}ms`);
      assert.ok(elapsed < 5000, `Should search all cells in under 5s (took ${elapsed}ms)`);
    });
  });

  suite("Outline Generation Performance", () => {
    test("Extract headings and definitions performance", async function () {
      if (!notebook || notebook.cellCount === 0) {
        this.skip();
        return;
      }

      const start = performance.now();
      const outline: Array<{ cellIndex: number; items: string[] }> = [];

      for (let i = 0; i < notebook.cellCount; i++) {
        const cell = notebook.cellAt(i);
        const text = cell.document.getText();
        const lines = text.split("\n");
        const items: string[] = [];

        for (const line of lines) {
          // Markdown headings
          const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
          if (headingMatch) {
            items.push(`h${headingMatch[1].length}: ${headingMatch[2]}`);
          }
          // Python functions
          const funcMatch = line.match(/^(?:async\s+)?def\s+(\w+)\s*\(/);
          if (funcMatch) {
            items.push(`fn: ${funcMatch[1]}`);
          }
          // Python classes
          const classMatch = line.match(/^class\s+(\w+)/);
          if (classMatch) {
            items.push(`class: ${classMatch[1]}`);
          }
        }

        if (items.length > 0) {
          outline.push({ cellIndex: i, items });
        }
      }

      const elapsed = performance.now() - start;
      const totalItems = outline.reduce((sum, o) => sum + o.items.length, 0);

      console.log(`Generated outline with ${totalItems} items from ${notebook.cellCount} cells in ${elapsed.toFixed(2)}ms`);
      assert.ok(elapsed < 5000, `Should generate outline in under 5s (took ${elapsed}ms)`);
    });
  });
});
