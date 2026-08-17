import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  webServer: {
    command: "pnpm dev --host 127.0.0.1",
    port: 4321,
    reuseExistingServer: true,
    env: {
      PUBLIC_API_BASE: "http://127.0.0.1:4321",
    },
  },
  use: {
    baseURL: "http://127.0.0.1:4321",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
    { name: "mobile-webkit", use: { ...devices["iPhone 15"] } },
  ],
});
