
# Notebook MCP Server
![Notebook MCP Server](images/header.png)

A VS Code / Cursor extension that exposes Jupyter notebook manipulation via MCP (Model Context Protocol). Works with Claude Code, Cursor Agent, Windsurf, and any MCP-compatible AI assistant.

> [!IMPORTANT]
> **This project is still pre-alpha** so it's very rough on the edge. Working in multiple windows is unstable.

## Why connect to VS Code Runtime API?

There are currently two main architectures to give AI agents access to Jupyter notebooks. This project was heavily inspired by both - kudos to these teams for pioneering the space:

### Architecture 1: File-based (e.g., [cursor-notebook-mcp](https://github.com/jbeno/cursor-notebook-mcp))

These servers read/write `.ipynb` files directly using libraries like `nbformat`.

**Pros:** No server dependencies, works out-of-the-box

**Cons:**
- **Cannot execute code** - agents can only edit cells, user must run them manually
- UI sync issues - VS Code may show stale content until you revert/reopen
- The `.ipynb` JSON format is verbose (~3x more tokens than raw code)
- Race conditions if you edit while agent writes

### Architecture 2: Jupyter Server API (e.g., [jupyter-mcp-server](https://github.com/datalayer/jupyter-mcp-server))

These servers connect to Jupyter's REST API and can execute code through the kernel.

**Pros:** Can execute code, **best choice for standalone remote JupyterLab/JupyterHub deployments**

**Cons:**
- Requires running JupyterLab separately (`jupyter lab --port 8888`)
- Auth setup: tokens, URLs, environment variables
- You end up running two UIs: one for notebook and another for AI
- If you open the notebook in VS Code you create another source of truth (Jupyter server state vs your editor)

### Architecture 3: VS Code / Cursor Runtime API (this extension)

We're introducing a third architecture - hooking directly into Cursor/VS Code's Notebook API, the same API the editor uses internally.

**Pros:**
- Zero config - just install, server starts automatically
- **Faster reads** (direct memory access, no serialization)
- Executes code in your existing kernel (the one VS Code already manages)
- Changes appear instantly in the editor with full undo/redo support
- Single source of truth: what you see is what the agent sees
- Works with remote kernels - if VS Code connects to a remote Jupyter server, so does the agent

**Cons:**
- Only works inside VS Code / Cursor (won't help if you use JupyterLab web UI)

### When to use what

| Use case | Recommended |
|----------|-------------|
| VS Code / Cursor + AI coding | **This extension** |
| Remote VS Code / Cursor (tunnels, containers, SSH) | **This extension** |
| Standalone JupyterLab/JupyterHub server | Datalayer |
| Just edit cells, no execution needed | File-based |

## Features

- **Execute code** in the active kernel and retrieve outputs
- **Full cell manipulation** - insert, edit, delete, move cells
- **Read cell contents and outputs** including images (base64)
- **Search and navigate** - find text, get notebook outline
- **Bulk operations** - add multiple cells, clear all outputs

## Tools (15)

### Navigation & Reading

| Tool | Description |
|------|-------------|
| `notebook_list_open` | List all open notebooks with URIs and cell counts |
| `notebook_list_cells` | List cells with type, language, preview, execution state |
| `notebook_get_cell_content` | Get full source code of a cell |
| `notebook_get_cell_output` | Get cell outputs (text, errors, images as base64) |
| `notebook_get_outline` | Get notebook structure (headings, functions, classes) |
| `notebook_search` | Search all cells for a keyword with context |
| `notebook_get_kernel_info` | Get kernel name, language, and state |

### Cell Manipulation

| Tool | Description |
|------|-------------|
| `notebook_insert_cell` | Insert a code or markdown cell at any position |
| `notebook_edit_cell` | Replace the content of an existing cell |
| `notebook_delete_cell` | Delete a cell by index |
| `notebook_move_cell` | Move a cell to a different position |
| `notebook_bulk_add_cells` | Add multiple cells in a single operation |

### Execution & Outputs

| Tool | Description |
|------|-------------|
| `notebook_execute_code` | Execute code and return outputs |
| `notebook_clear_outputs` | Clear outputs of a specific cell |
| `notebook_clear_all_outputs` | Clear outputs from all cells |

<details>
<summary><b>Tool Parameters</b></summary>

All tools support `response_format` parameter (`"markdown"` or `"json"`).

#### notebook_insert_cell
```json
{
  "content": "print('hello')",
  "type": "code",
  "index": 0,
  "language": "python",
  "execute": false
}
```

#### notebook_edit_cell
```json
{
  "index": 0,
  "content": "# New content"
}
```

#### notebook_search
```json
{
  "query": "import pandas",
  "case_sensitive": false,
  "context_lines": 1
}
```

#### notebook_move_cell
```json
{
  "from_index": 5,
  "to_index": 0
}
```

#### notebook_bulk_add_cells
```json
{
  "cells": [
    {"content": "# Header", "type": "markdown"},
    {"content": "x = 1", "type": "code", "language": "python"}
  ],
  "index": 0
}
```

</details>

## Setup

1. Install the extension in VS Code or Cursor
2. Add to your MCP client config:

```json
{
  "mcpServers": {
    "notebook": {
      "url": "http://127.0.0.1:49777/mcp"
    }
  }
}
```

> [!ATTENTION]
> The server starts automatically when VS Code / Cursor opens. Look for the `🪐 :49777` indicator in the status bar.

### Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `notebook-mcp.port` | `49777` | Port number for the MCP server |

## Performance

Tested with a 471-cell notebook (~2.8MB, 1MB outputs):

| Operation | Time |
|-----------|------|
| List/read cells | <1ms |
| Search all cells | <1ms |
| Generate outline | ~1ms |
| Insert/edit cell | ~7ms |

> [!NOTE]
> Read operations are sub-millisecond because they access in-memory data structures directly. Write operations (~7ms) go through VS Code's edit pipeline for undo/redo support.

## Requirements

- VS Code 1.85+ or Cursor 0.43+
- [Jupyter extension](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter)

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         VS Code / Cursor                                │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                    Jupyter Extension                              │  │
│  │                                                                   │  │
│  │   Notebook Document  ◄───►  Kernel (Python)  ───►  Outputs        │  │
│  │                                    ▲                              │  │
│  └────────────────────────────────────┼──────────────────────────────┘  │
│                                       │                                 │
│  ┌────────────────────────────────────┼──────────────────────────────┐  │
│  │              Notebook MCP Server Extension                        │  │
│  │                                    │                              │  │
│  │   ┌────────────────────────────────┴───────────────────────────┐  │  │
│  │   │                  HTTP Server (:49777)                      │  │  │
│  │   │                                                            │  │  │
│  │   │  execute_code  insert_cell  list_cells  get_output  ...    │  │  │
│  │   └────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTP (MCP Protocol)
                                    ▼
                    ┌───────────────────────────────┐
                    │           AI Agent            │
                    │   (Claude Code, Cursor, etc)  │
                    └───────────────────────────────┘
```

## How It Works

1. Extension embeds an HTTP-based MCP server (port 49777)
2. AI agent (Claude Code, Cursor Agent, etc.) sends tool calls via MCP protocol
3. Server uses VS Code / Cursor APIs to manipulate the active notebook
4. Changes appear instantly in the editor
5. Outputs are captured and returned to the agent

This enables true interactive notebook sessions with AI agents in VS Code and Cursor.
