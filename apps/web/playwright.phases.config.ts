import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests", fullyParallel: false, workers: 1, retries: 0,
  testMatch: /(?:phases-.*|profile-panels|navigation-background|navigation-metrics|navigation-gestures|mapkit-recovery|frontend-isolated|feed-recovery|following-actions|deferred-sales)\.spec\.ts/,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://localhost:3000", channel: "chrome", screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 375, height: 812 }, channel: "chrome" } },
  ],
});
