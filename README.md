# Notebook MCP Server

A VS Code extension that exposes Jupyter notebook manipulation via MCP (Model Context Protocol). Unlike file-based notebook MCPs, this extension integrates directly with VS Code's runtime.

## Why This Approach?

Most Jupyter MCP servers work by reading and writing `.ipynb` files directly. This has limitations:

| File-based MCPs | This Extension |
|-----------------|----------------|
| Changes require manual refresh | Instant UI sync |
| Cannot execute code | Full kernel access |
| No output retrieval | Real-time outputs (text, errors, images) |
| Conflicts with open editors | Works with live notebooks |

**This extension operates inside VS Code**, using the native Notebook API and Jupyter extension. When the AI modifies a cell, you see it immediately. When it executes code, it uses your running kernel.

## Features

- **Execute code** in the active kernel and retrieve outputs
- **Insert cells** (code or markdown) at any position
- **Read cell contents and outputs** including images (base64)
- **List open notebooks** and see which is active
- **Get kernel info** (name, language, state)

## Tools

| Tool | Description |
|------|-------------|
| `notebook_list_open` | List all open notebooks |
| `notebook_list_cells` | List cells with metadata |
| `notebook_get_cell_content` | Get full cell source |
| `notebook_get_cell_output` | Get cell outputs |
| `notebook_get_kernel_info` | Get kernel status |
| `notebook_execute_code` | Run code, return output |
| `notebook_insert_cell` | Insert code/markdown cell |

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

3. The MCP server starts automatically with VS Code

### Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `notebook-mcp.port` | `49777` | Port number for the MCP server |

To change the port, add to your VS Code `settings.json`:
```json
{
  "notebook-mcp.port": 49777
}
```

## Requirements

- VS Code 1.85+
- [Jupyter extension](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter)

## Architecture

```
┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                            VS Code                                                │
│                                                                                                   │
│   ┌───────────────────────────────────────────────────────────────────────────────────────────┐   │
│   │                             Jupyter Extension (ms-toolsai.jupyter)                        │   │
│   │                                                                                           │   │
│   │      ┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐           │   │
│   │      │                  │       │                  │       │                  │           │   │
│   │      │     Notebook     │◄─────►│      Kernel      │──────►│     Outputs      │           │   │
│   │      │    Document      │       │     (Python)     │       │  (stdout, imgs)  │           │   │
│   │      │    (.ipynb)      │       │                  │       │                  │           │   │
│   │      │                  │       │                  │       │                  │           │   │
│   │      └──────────────────┘       └──────────────────┘       └──────────────────┘           │   │
│   │                                          ▲                                                │   │
│   └──────────────────────────────────────────┼────────────────────────────────────────────────┘   │
│                                              │                                                    │
│   ┌──────────────────────────────────────────┴────────────────────────────────────────────────┐   │
│   │                              Notebook MCP Server Extension                                │   │
│   │                                                                                           │   │
│   │   ┌───────────────────────────────────────────────────────────────────────────────────┐   │   │
│   │   │                             HTTP Server (:49777)                                  │   │   │
│   │   │                                                                                   │   │   │
│   │   │    ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐          │   │   │
│   │   │    │   execute   │   │   insert    │   │    list     │   │  get_cell   │   ...    │   │   │
│   │   │    │    _code    │   │    _cell    │   │   _cells    │   │  _content   │          │   │   │
│   │   │    └─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘          │   │   │
│   │   │                                                                                   │   │   │
│   │   └───────────────────────────────────────────────────────────────────────────────────┘   │   │
│   │                                          ▲                                                │   │
│   └──────────────────────────────────────────┼────────────────────────────────────────────────┘   │
│                                              │                                                    │
└──────────────────────────────────────────────┼────────────────────────────────────────────────────┘
                                               │
                                               │  HTTP (MCP Protocol)
                                               │
                        ┌──────────────────────┴──────────────────────┐
                        │                                             │
                        │                  AI Agent                   │
                        │          (Cursor, Claude Code, Etc)         │
                        │                                             │
                        └─────────────────────────────────────────────┘
```

## How It Works

The extension embeds an HTTP-based MCP server that exposes VS Code's Notebook API. When an AI agent calls a tool:

1. The request hits the embedded server (port 49777)
2. The server uses VS Code APIs to manipulate the active notebook
3. Changes appear instantly in the editor
4. Outputs are captured and returned to the agent

This architecture enables true interactive notebook sessions with AI agents.
