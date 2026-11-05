import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: { baseURL: "http://127.0.0.1:8001", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "phone",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command: "../.venv/bin/python ../scripts/e2e_server.py",
    url: "http://127.0.0.1:8001/healthz",
    reuseExistingServer: false,
  },
});
