import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4317);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PLAYWRIGHT_PORT must be an integer between 1 and 65535.");
}
const desktopViewport = { width: 1680, height: 1050 };
const chromiumPerformanceGrep = /loads and operates a deterministic large or stress design/;
const reuseExistingServer = !process.env.CI && process.env.PLAYWRIGHT_REUSE_SERVER === "1";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  testIgnore: "desktop/**/*.spec.ts",
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
    command: `pnpm dev --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer,
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
