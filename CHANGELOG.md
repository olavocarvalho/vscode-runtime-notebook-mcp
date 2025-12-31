# Changelog

All notable changes to this project will be documented in this file.

## [0.2.2] - 2025-12-31

### Added

- `notebook_run_cell` - Execute an existing cell by index without creating duplicates

### Changed

- Removed `notebook_execute_code` tool (redundant with `notebook_insert_cell` + `execute: true`)
- Cell execution now always persists in notebook UI (matches Claude Code behavior)
- Simplified tool set from 16 to 15 tools

### Fixed

- Fixed cell outputs not showing after MCP execution (wait condition bug in `waitForCellExecution`)
- Fixed cell duplication when agent asked to run existing cells

## [0.2.0] - 2025-12-31

### Added

- **8 new tools** (15 total):
  - `notebook_edit_cell` - Replace content of an existing cell
  - `notebook_delete_cell` - Delete a cell by index
  - `notebook_move_cell` - Move a cell to a different position
  - `notebook_get_outline` - Get notebook structure (headings, functions, classes)
  - `notebook_search` - Search all cells for a keyword with context
  - `notebook_clear_outputs` - Clear outputs of a specific cell
  - `notebook_clear_all_outputs` - Clear outputs from all cells
  - `notebook_bulk_add_cells` - Add multiple cells in a single operation
- E2E testing infrastructure using `@vscode/test-cli`
- Unit tests for utility functions
- CI workflow for automated testing

### Fixed

- Kernel check now fails gracefully instead of throwing errors

## [0.1.0] - 2024-12-30

### Added

- Initial release with 7 tools:
  - `notebook_list_open` - List all open notebooks
  - `notebook_list_cells` - List cells with metadata
  - `notebook_get_cell_content` - Get full source code of a cell
  - `notebook_get_cell_output` - Get cell outputs (text, errors, images)
  - `notebook_insert_cell` - Insert a code or markdown cell
  - `notebook_execute_code` - Execute code and return outputs
  - `notebook_get_kernel_info` - Get kernel name, language, and state
- HTTP-based MCP server on port 49777
- Status bar indicator
- Automatic kernel selection prompt
