import { defineConfig } from "@vscode/test-cli";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  files: "out-e2e/test/e2e/**/*.e2e.test.js",
  version: "stable",
  mocha: {
    ui: "tdd",
    timeout: 120000, // 2min for large notebook operations
  },
  // Install Jupyter extension for notebook support
  installExtensions: ["ms-toolsai.jupyter"],
  // Open workspace folder so tests can access large_notebook.ipynb
  workspaceFolder: __dirname,
});
