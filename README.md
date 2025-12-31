# Notebook MCP Server

A VS Code extension that exposes Jupyter notebook manipulation via MCP (Model Context Protocol).

> [!IMPORTANT]
> **Zero configuration required.** Install the extension, add the MCP endpoint to your client, done. No external servers, no tokens, no Python environments to manage.

## Why Runtime API?

Most Jupyter MCP servers read/write `.ipynb` files directly. This extension uses **VS Code's Runtime Notebook API** instead:

| File-based MCPs | Runtime API (this extension) |
|-----------------|------------------------------|
| Parse JSON, write to disk | Direct memory access |
| Manual refresh needed | Instant UI sync |
| Conflicts with open editors | Works with live notebooks |
| Separate kernel management | Uses your running kernel |
| Setup: server + tokens + URLs | Setup: just install |

When the AI modifies a cell, you see it immediately. When it executes code, it uses your running kernel.

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

1. Install the extension in VS Code
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

> [!TIP]
> The server starts automatically when VS Code opens. Look for the `🪐 :49777` indicator in the status bar.

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

- VS Code 1.85+
- [Jupyter extension](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter)

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              VS Code                                    │
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
2. AI agent sends tool calls via MCP protocol
3. Server uses VS Code APIs to manipulate the active notebook
4. Changes appear instantly in the editor
5. Outputs are captured and returned to the agent

This enables true interactive notebook sessions with AI agents.
