import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: "reviews-ui-isolated.spec.ts", workers: 1, retries: 0,
  reporter: "list", outputDir: "../test-results/reviews-ui",
  use: { channel: "chrome", headless: true, screenshot: "only-on-failure" },
  projects: [{name:"desktop",use:{viewport:{width:1280,height:800}}},{name:"mobile",use:{viewport:{width:375,height:812}}}],
});
