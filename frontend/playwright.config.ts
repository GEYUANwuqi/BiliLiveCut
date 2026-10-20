import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:5199",
    trace: "retain-on-failure",
    launchOptions: { executablePath: process.env.BLC_CHROMIUM_PATH },
  },
  webServer: [
    {
      command: "node e2e/backend.mjs",
      url: "http://127.0.0.1:5196/auth/status",
      reuseExistingServer: false,
    },
    {
      command:
        "npm run build && npm run preview -- --host 127.0.0.1 --port 5199 --strictPort",
      env: { BLC_API_PROXY: "http://127.0.0.1:5196" },
      url: "http://127.0.0.1:5199",
      reuseExistingServer: false,
    },
  ],
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: "mobile",
      use: { viewport: { width: 390, height: 844 }, isMobile: true },
    },
  ],
});
