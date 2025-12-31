# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Test Commands

```bash
npm run build         # Build extension (esbuild)
npm test              # Run unit tests (vitest)
npm run test:e2e      # Run E2E tests (requires VS Code instance)
npm run watch         # Build in watch mode
```

## Architecture

VS Code extension exposing MCP tools for Jupyter notebook manipulation via HTTP server (port 49777).

```
src/
├── extension.ts           # Entry point, activates on VS Code startup
├── mcp/
│   ├── server.ts          # HTTP server + MCP StreamableHTTPServerTransport
│   └── tools/
│       ├── index.ts       # Registers all tools with McpServer
│       ├── cells.ts       # 14 cell tools (insert, edit, run, delete, etc.)
│       └── kernel.ts      # Kernel tools (restart, interrupt, info)
├── utils/
│   ├── notebook.ts        # VS Code Notebook API wrappers
│   └── output.ts          # Parse cell outputs (text, images, errors)
└── schemas/               # Zod validation schemas
```

**Key flow**: MCP client → HTTP POST `/mcp` → `McpServer.tool()` handler → VS Code Notebook API → Response

## Core Design Principle

**"Agent execution in sync with human/UI"** - When an agent executes code, the result must be identical to human execution:
- Cell persists in notebook (never deleted after execution)
- Output visible in UI with execution number `[1]`, `[2]`
- Agent receives output to iterate

Reference implementation: Claude Code extension (`~/.cursor/extensions/anthropic.claude-code-*/extension.js`)

## Critical Implementation Details

### Cell Execution Wait Condition

The `waitForCellExecution` function in `src/utils/notebook.ts` must use:

```typescript
// CORRECT - waits for kernel to finish
if (typeof cell.executionSummary?.success === 'boolean') { ... }

// WRONG - returns immediately (executionSummary exists but success is undefined)
if (cell.executionSummary?.success !== undefined) { ... }
```

VS Code creates `executionSummary` when execution starts, but `.success` only becomes boolean when kernel finishes.

### Cell Tracking (Internal vs Agent-Facing)

**Agent-facing API uses indices** - More LLM-friendly. Agents see "Cell 0, Cell 1, Cell 2" when listing and naturally think "run cell 2". No opaque IDs to track.

**Internal implementation uses metadata IDs** - For async operations where indices can shift:

```typescript
// When inserting a cell and waiting for execution, use ID to find it after
const cellId = generateCellId();
cellData.metadata = { id: cellId };
// ... insert cell (index might shift if other cells added) ...
const cell = notebook.getCells().find(c => c.metadata.id === cellId);
```

This distinction matters: cell IDs are an implementation detail for reliable async tracking, not part of the agent API.

### Multi-Window Safety

Check `vscode.window.state.focused` before modifications - prevents executing in unfocused background windows.

## Tool Design

- `notebook_insert_cell` with `execute: true` → create and run new code
- `notebook_run_cell` → execute existing cell by index
- No redundant tools - check if existing tools cover the use case before adding new ones

## Release Process

1. Update `version` in package.json and add entry to CHANGELOG.md
2. Commit and tag:
   ```bash
   git add -A && git commit -m "Release vX.Y.Z: Description"
   git tag -a vX.Y.Z -m "Release vX.Y.Z"
   git push origin master --tags
   ```
3. CI automatically builds VSIX, creates GitHub Release, publishes to marketplaces
4. Verify: `gh run list --limit 3` and `gh release view vX.Y.Z`

**Do NOT publish from local** - CI handles it on tag push.
