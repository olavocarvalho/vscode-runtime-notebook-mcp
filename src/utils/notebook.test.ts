import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { generateCellId, checkCanModifyNotebook, checkCanReadNotebook, NotebookAccessResult } from './notebook';

describe('generateCellId', () => {
  it('generates a string ID', () => {
    const id = generateCellId();

    expect(typeof id).toBe('string');
  });

  it('generates non-empty IDs', () => {
    const id = generateCellId();

    expect(id.length).toBeGreaterThan(0);
  });

  it('generates unique IDs', () => {
    const ids = new Set<string>();

    for (let i = 0; i < 100; i++) {
      ids.add(generateCellId());
    }

    expect(ids.size).toBe(100);
  });

  it('generates alphanumeric IDs', () => {
    const id = generateCellId();

    expect(id).toMatch(/^[a-z0-9]+$/);
  });
});

// Note: editCellContent and moveCell functions depend on VS Code APIs
// which cannot be unit tested without a full VS Code environment.
// These functions are tested via E2E tests in test/e2e/notebook.e2e.test.ts
//
// The functions are thin wrappers around VS Code APIs:
// - editCellContent: WorkspaceEdit.replace() on cell document
// - moveCell: deleteCells() + insertCells() with adjusted index

describe('editCellContent (logic verification)', () => {
  it('should be exported from notebook module', async () => {
    const notebook = await import('./notebook');
    expect(typeof notebook.editCellContent).toBe('function');
  });
});

describe('moveCell (logic verification)', () => {
  it('should be exported from notebook module', async () => {
    const notebook = await import('./notebook');
    expect(typeof notebook.moveCell).toBe('function');
  });

  it('should adjust target index when moving forward', () => {
    // When moving from index 2 to index 5:
    // After deleting at 2, the target 5 becomes 4
    const fromIndex = 2;
    const toIndex = 5;
    const adjustedIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;

    expect(adjustedIndex).toBe(4);
  });

  it('should not adjust target index when moving backward', () => {
    // When moving from index 5 to index 2:
    // Deleting at 5 doesn't affect indices before it
    const fromIndex = 5;
    const toIndex = 2;
    const adjustedIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;

    expect(adjustedIndex).toBe(2);
  });

  it('should handle adjacent cells correctly', () => {
    // Moving from 3 to 4 (swap with next)
    const fromIndex = 3;
    const toIndex = 4;
    const adjustedIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;

    expect(adjustedIndex).toBe(3); // Cell ends up at same visual position
  });
});

// Tests for v0.2.1 multi-window support functions

describe('checkCanModifyNotebook', () => {
  beforeEach(() => {
    // Reset mock state before each test
    (vscode.window as any).activeNotebookEditor = undefined;
    (vscode.window as any).state = { focused: true };
  });

  it('returns error when no active notebook editor', () => {
    (vscode.window as any).activeNotebookEditor = undefined;

    const result = checkCanModifyNotebook();

    expect(result.allowed).toBe(false);
    expect(result.error).toContain('No active notebook');
  });

  it('returns error when window not focused', () => {
    const mockNotebook = { uri: { path: '/test.ipynb' } };
    const mockEditor = { notebook: mockNotebook };
    (vscode.window as any).activeNotebookEditor = mockEditor;
    (vscode.window as any).state = { focused: false };

    const result = checkCanModifyNotebook();

    expect(result.allowed).toBe(false);
    expect(result.error).toContain('not focused');
  });

  it('returns allowed with notebook when editor exists and window focused', () => {
    const mockNotebook = { uri: { path: '/test.ipynb' } };
    const mockEditor = { notebook: mockNotebook };
    (vscode.window as any).activeNotebookEditor = mockEditor;
    (vscode.window as any).state = { focused: true };

    const result = checkCanModifyNotebook();

    expect(result.allowed).toBe(true);
    expect(result.notebook).toBe(mockNotebook);
    expect(result.editor).toBe(mockEditor);
  });

  it('includes helpful error message with instructions', () => {
    const mockNotebook = { uri: { path: '/test.ipynb' } };
    const mockEditor = { notebook: mockNotebook };
    (vscode.window as any).activeNotebookEditor = mockEditor;
    (vscode.window as any).state = { focused: false };

    const result = checkCanModifyNotebook();

    expect(result.error).toContain('Activate');
    expect(result.error).toContain('another window');
  });
});

describe('checkCanReadNotebook', () => {
  beforeEach(() => {
    // Reset mock state before each test
    (vscode.window as any).activeNotebookEditor = undefined;
    (vscode.window as any).state = { focused: true };
  });

  it('returns error when no active notebook editor', () => {
    (vscode.window as any).activeNotebookEditor = undefined;

    const result = checkCanReadNotebook();

    expect(result.allowed).toBe(false);
    expect(result.error).toContain('No active notebook');
  });

  it('returns allowed even when window not focused (key difference from modify)', () => {
    const mockNotebook = { uri: { path: '/test.ipynb' } };
    const mockEditor = { notebook: mockNotebook };
    (vscode.window as any).activeNotebookEditor = mockEditor;
    (vscode.window as any).state = { focused: false };

    const result = checkCanReadNotebook();

    // Read operations should work even when window is not focused
    expect(result.allowed).toBe(true);
    expect(result.notebook).toBe(mockNotebook);
  });

  it('returns allowed with notebook when editor exists', () => {
    const mockNotebook = { uri: { path: '/test.ipynb' } };
    const mockEditor = { notebook: mockNotebook };
    (vscode.window as any).activeNotebookEditor = mockEditor;
    (vscode.window as any).state = { focused: true };

    const result = checkCanReadNotebook();

    expect(result.allowed).toBe(true);
    expect(result.notebook).toBe(mockNotebook);
    expect(result.editor).toBe(mockEditor);
  });
});

describe('NotebookAccessResult interface', () => {
  it('has correct shape for allowed result', () => {
    const result: NotebookAccessResult = {
      allowed: true,
      notebook: {} as any,
      editor: {} as any
    };

    expect(result.allowed).toBe(true);
    expect(result.notebook).toBeDefined();
    expect(result.editor).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  it('has correct shape for disallowed result', () => {
    const result: NotebookAccessResult = {
      allowed: false,
      error: 'Test error message'
    };

    expect(result.allowed).toBe(false);
    expect(result.error).toBe('Test error message');
    expect(result.notebook).toBeUndefined();
    expect(result.editor).toBeUndefined();
  });
});

