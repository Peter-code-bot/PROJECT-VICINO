import { defineConfig } from "@playwright/test";

// Real browser + production React/components, with a local router/data fixture.
// Never loads .env, storage-state, account seeds or a remote Supabase service.
export default defineConfig({
  testDir: "./tests",
  testMatch: ["navigation-gestures.spec.ts", "navigation-background.spec.ts", "profile-panels.spec.ts", "deferred-sales.spec.ts", "navigation-metrics.spec.ts", "following-actions.spec.ts", "fluency-final.spec.ts"],
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "../../../reports/fluidez-20260908/gestures",
  use: {
    channel: "chrome",
    headless: true,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  },
});
