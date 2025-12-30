// Mock VS Code API for testing
export const NotebookCellOutputItem = {
  error: (err: Error) => ({ mime: 'application/vnd.code.notebook.error' })
};

export const NotebookEdit = {
  insertCells: () => ({}),
  deleteCells: () => ({})
};

export class NotebookRange {
  constructor(public start: number, public end: number) {}
}

export class Uri {
  static file(path: string) {
    return { path, scheme: 'file' };
  }
}

export class WorkspaceEdit {
  set() {}
}

export const workspace = {
  applyEdit: async () => true
};

export const NotebookCellKind = {
  Code: 1,
  Markup: 2
};

