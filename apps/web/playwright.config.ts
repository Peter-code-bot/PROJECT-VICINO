import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import path from "path";

// Load apps/web/.env.local so VICINO_TEST_EMAIL/PASSWORD reach the test runner.
// Next.js loads .env.local automatically for the dev server (server-side only),
// but the Playwright process itself runs outside that pipeline.
dotenv.config({ path: path.resolve(__dirname, ".env.local") });

const STORAGE_STATE = "tests/storage-state.json";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  // The setup project runs the seed (login) WITHOUT a storageState and writes
  // tests/storage-state.json. The chromium project depends on it and reuses
  // the stored session for every other test. This is the canonical Playwright
  // pattern for auth setup.
  projects: [
    {
      name: "setup",
      testMatch: /seed\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      testIgnore: /seed\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: STORAGE_STATE,
      },
      dependencies: ["setup"],
    },
    // El viewport movil que exige la regla de CLAUDE.md y que llevaba varios
    // pushes sin correrse. Nace de que ProductDetailDesktop fue un stub TODO
    // que llego a produccion porque la fase que flipeo el flag solo valido
    // movil: la regla pide los DOS, y hasta hoy la suite solo tenia uno.
    //
    // Pixel 7 y no iPhone 13 a proposito: los descriptores de iPhone traen
    // defaultBrowserType "webkit", y aqui solo se instala chromium
    // (`test:e2e:setup` es `playwright install chromium`). Con iPhone 13 esto
    // no probaria mas, fallaria por binario ausente.
    {
      name: "mobile",
      testIgnore: /seed\.spec\.ts/,
      use: {
        ...devices["Pixel 7"],
        // Pixel 7 trae 412x915; la regla pide exactamente 375x812.
        viewport: { width: 375, height: 812 },
        storageState: STORAGE_STATE,
      },
      dependencies: ["setup"],
    },
  ],

  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
