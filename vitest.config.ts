import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    globals: true,
    alias: {
      vscode: path.resolve(__dirname, 'src/__mocks__/vscode.ts')
    }
  },
});

