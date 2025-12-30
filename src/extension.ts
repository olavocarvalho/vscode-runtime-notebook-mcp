import * as vscode from "vscode";
import { startMCPServer, stopMCPServer, getPort } from "./mcp/server.js";

let statusBarItem: vscode.StatusBarItem | undefined;

export async function activate(context: vscode.ExtensionContext) {
  console.log("Notebook MCP Server: Activating...");

  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = "notebook-mcp.startServer";
  context.subscriptions.push(statusBarItem);

  // Start MCP server with configured port
  const configuredPort = vscode.workspace.getConfiguration("notebook-mcp").get<number>("port", 49777);
  try {
    const port = await startMCPServer(configuredPort);
    updateStatusBar(port);
    vscode.window.showInformationMessage(`Notebook MCP Server running at http://127.0.0.1:${port}/mcp`);
  } catch (error) {
    console.error("Notebook MCP Server: Failed to start MCP server", error);
    updateStatusBarError(error instanceof Error ? error.message : String(error));
  }

  // Register restart command
  const restartCommand = vscode.commands.registerCommand(
    "notebook-mcp.startServer",
    async () => {
      try {
        await stopMCPServer();
        const configuredPort = vscode.workspace.getConfiguration("notebook-mcp").get<number>("port", 49777);
        const port = await startMCPServer(configuredPort);
        updateStatusBar(port);
        vscode.window.showInformationMessage(`Notebook MCP Server restarted at http://127.0.0.1:${port}/mcp`);
      } catch (error) {
        updateStatusBarError(error instanceof Error ? error.message : String(error));
        vscode.window.showErrorMessage(`Notebook MCP Server: Failed to restart - ${error}`);
      }
    }
  );

  context.subscriptions.push(restartCommand);

  // Listen for notebook open - prompt kernel selection
  context.subscriptions.push(
    vscode.workspace.onDidOpenNotebookDocument(async (notebook) => {
      // Small delay to let VS Code finish opening the notebook
      setTimeout(() => promptKernelIfNeeded(notebook.uri), 500);
    })
  );

  // Listen for active notebook change (tab switch)
  context.subscriptions.push(
    vscode.window.onDidChangeActiveNotebookEditor(async (editor) => {
      if (editor) {
        await promptKernelIfNeeded(editor.notebook.uri);
      }
    })
  );

  console.log("Notebook MCP Server: Activated successfully");
}

function updateStatusBar(port: number) {
  if (statusBarItem) {
    statusBarItem.text = `🪐 :${port}`;
    statusBarItem.tooltip = `Notebook MCP Server\n\nEndpoint: http://127.0.0.1:${port}/mcp\nStatus: Running\n\nClick to restart`;
    statusBarItem.backgroundColor = undefined;
    statusBarItem.show();
  }
}

function updateStatusBarError(message: string) {
  if (statusBarItem) {
    statusBarItem.text = `🪐 ✗`;
    statusBarItem.tooltip = `Notebook MCP Server\n\nStatus: Error\n${message}\n\nClick to retry`;
    statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
    statusBarItem.show();
  }
}

// Track which notebooks we've already prompted for (avoid repeated prompts)
const promptedNotebooks = new Set<string>();

async function promptKernelIfNeeded(notebookUri: vscode.Uri): Promise<void> {
  const uriString = notebookUri.toString();

  // Skip if already prompted for this notebook
  if (promptedNotebooks.has(uriString)) {
    return;
  }

  try {
    const ext = vscode.extensions.getExtension("ms-toolsai.jupyter");
    if (!ext) return;

    const jupyter = await ext.activate();
    const kernel = await jupyter.kernels.getKernel(notebookUri);

    // No kernel connected - show picker
    if (!kernel) {
      promptedNotebooks.add(uriString);
      await vscode.commands.executeCommand("notebook.selectKernel");
    }
  } catch (error) {
    console.log("Notebook MCP Server: Kernel check failed:", error);
  }
}

export async function deactivate() {
  console.log("Notebook MCP Server: Deactivating...");
  await stopMCPServer();
  console.log("Notebook MCP Server: Deactivated");
}
