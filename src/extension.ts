import * as vscode from "vscode";
import { startMCPServer, stopMCPServer, getPort, ServerStartResult, requestServerRelease, setOnReleaseCallback, isServerRunning } from "./mcp/server.js";

let statusBarItem: vscode.StatusBarItem | undefined;
let currentServerResult: ServerStartResult | undefined;
let takeoverDebounce: ReturnType<typeof setTimeout> | undefined;

export async function activate(context: vscode.ExtensionContext) {
  console.log("Notebook MCP Server: Activating...");

  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = "notebook-mcp.startServer";
  context.subscriptions.push(statusBarItem);

  // Set up callback for when another window takes over our server
  const configuredPort = vscode.workspace.getConfiguration("notebook-mcp").get<number>("port", 49777);
  setOnReleaseCallback(() => {
    console.log("Notebook MCP Server: Released to another window");
    currentServerResult = { port: configuredPort, isExistingServer: true };
    updateStatusBar(currentServerResult);
  });

  // Start MCP server with configured port
  try {
    currentServerResult = await startMCPServer(configuredPort);
    updateStatusBar(currentServerResult);
    if (currentServerResult.isExistingServer) {
      vscode.window.showWarningMessage(
        `Notebook MCP: Server active in another window. Click "Activate" in status bar to use this window.`
      );
    } else {
      vscode.window.showInformationMessage(`Notebook MCP Server running at http://127.0.0.1:${currentServerResult.port}/mcp`);
    }
  } catch (error) {
    console.error("Notebook MCP Server: Failed to start MCP server", error);
    updateStatusBarError(error instanceof Error ? error.message : String(error));
  }

  // Listen for window focus changes to automatically take over server
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState(async (state) => {
      if (state.focused) {
        // Debounce to avoid rapid switching between windows
        clearTimeout(takeoverDebounce);
        takeoverDebounce = setTimeout(async () => {
          await takeOverServer();
        }, 500);
      }
    })
  );

  // Register restart command (force takeover)
  const restartCommand = vscode.commands.registerCommand(
    "notebook-mcp.startServer",
    async () => {
      try {
        await stopMCPServer();
        const port = vscode.workspace.getConfiguration("notebook-mcp").get<number>("port", 49777);

        // Request release from any existing server
        await requestServerRelease(port);

        // Poll until server is actually stopped (max 3 seconds)
        const maxWait = 3000;
        const pollInterval = 100;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWait) {
          const stillRunning = await isServerRunning(port);
          if (!stillRunning) {
            break;
          }
          await new Promise(resolve => setTimeout(resolve, pollInterval));
        }

        currentServerResult = await startMCPServer(port);
        updateStatusBar(currentServerResult);
        if (currentServerResult.isExistingServer) {
          vscode.window.showWarningMessage(`Notebook MCP Server: Could not take over. Server still running in another window.`);
        } else {
          vscode.window.showInformationMessage(`Notebook MCP Server activated at http://127.0.0.1:${currentServerResult.port}/mcp`);
        }
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

function updateStatusBar(result: ServerStartResult) {
  if (statusBarItem) {
    const { port, isExistingServer } = result;
    if (isExistingServer) {
      statusBarItem.text = `$(arrow-right) 🪐 Activate`;
      statusBarItem.tooltip = `Notebook MCP Server\n\nServer is running in another window.\nMCP tools will NOT work in this window.\n\n$(arrow-right) Click to bring server here`;
      statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    } else {
      statusBarItem.text = `🪐 :${port}`;
      statusBarItem.tooltip = `Notebook MCP Server\n\nEndpoint: http://127.0.0.1:${port}/mcp\nStatus: Running (active)\n\nClick to restart`;
      statusBarItem.backgroundColor = undefined;
    }
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

/**
 * Attempt to take over the MCP server when this window gains focus.
 * If we're already the server owner, do nothing.
 * If another server is running, request it to release and start our own.
 */
async function takeOverServer(): Promise<void> {
  const port = vscode.workspace.getConfiguration("notebook-mcp").get<number>("port", 49777);

  // If we already own the server, nothing to do
  if (currentServerResult && !currentServerResult.isExistingServer) {
    return;
  }

  console.log("Notebook MCP Server: Window focused, attempting to take over server");

  // Request existing server to release
  const released = await requestServerRelease(port);
  if (released) {
    console.log("Notebook MCP Server: Existing server released, waiting for it to stop");

    // Poll until server is actually stopped (max 2 seconds for auto-takeover)
    const maxWait = 2000;
    const pollInterval = 100;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      const stillRunning = await isServerRunning(port);
      if (!stillRunning) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }

  // Try to start our server
  try {
    currentServerResult = await startMCPServer(port);
    updateStatusBar(currentServerResult);

    if (!currentServerResult.isExistingServer) {
      console.log("Notebook MCP Server: Took over server on focus");
    }
  } catch (error) {
    console.error("Notebook MCP Server: Failed to take over server", error);
    updateStatusBarError(error instanceof Error ? error.message : String(error));
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
    // First verify we have an active notebook editor for this URI
    const editor = vscode.window.activeNotebookEditor;
    if (!editor || editor.notebook.uri.toString() !== uriString) {
      // No active editor for this notebook - skip kernel check
      return;
    }

    const ext = vscode.extensions.getExtension("ms-toolsai.jupyter");
    if (!ext) return;

    // Ensure extension is activated
    if (!ext.isActive) {
      await ext.activate();
    }

    const jupyter = ext.exports;
    if (!jupyter?.kernels?.getKernel) {
      // Jupyter API not available
      return;
    }

    // Pass the notebook document instead of URI for better compatibility
    const kernel = await jupyter.kernels.getKernel(editor.notebook);

    // No kernel connected - show picker
    if (!kernel) {
      promptedNotebooks.add(uriString);
      await vscode.commands.executeCommand("notebook.selectKernel");
    }
  } catch {
    // Silently ignore kernel check errors - this is a non-critical feature
    // The user can always manually select a kernel if needed
  }
}

export async function deactivate() {
  console.log("Notebook MCP Server: Deactivating...");
  await stopMCPServer();
  console.log("Notebook MCP Server: Deactivated");
}
