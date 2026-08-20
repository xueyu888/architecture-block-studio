import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/desktop",
  fullyParallel: false,
  timeout: 90_000,
  retries: 0,
  reporter: "list",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
