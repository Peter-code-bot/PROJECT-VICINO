import { defineConfig } from "@playwright/test";

// Aislado: sin .env, setup de cuentas, storageState ni servidor de produccion.
export default defineConfig({
  testDir: "./tests", testMatch: "frontend-isolated.spec.ts", workers: 1,
  retries: 0, reporter: "list", outputDir: "../../../../reports/frontend-playwright",
  use: { channel: "chrome", headless: true, screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { viewport: { width: 375, height: 812 } } },
  ],
});
