import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 45_000 },
  // One CPU inference engine behind the API: parallel workers just queue on its lock.
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:7860", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `${process.env.PYTHON ?? "python"} -m uvicorn backend.app.main:app --host 127.0.0.1 --port 7860`,
    cwd: "..",
    url: "http://127.0.0.1:7860/api/health",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
