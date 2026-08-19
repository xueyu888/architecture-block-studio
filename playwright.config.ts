import { defineConfig, devices } from "@playwright/test";

const port = 4317;
const desktopViewport = { width: 1680, height: 1050 };
const chromiumPerformanceGrep = /loads and operates a deterministic large or stress design/;

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  timeout: 90_000,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: desktopViewport,
  },
  webServer: {
    command: `pnpm dev --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: desktopViewport },
    },
    {
      name: "firefox-core",
      grepInvert: chromiumPerformanceGrep,
      use: { ...devices["Desktop Firefox"], viewport: desktopViewport },
    },
  ],
});
