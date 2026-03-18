const fs = require("node:fs");
const { defineConfig, devices } = require("@playwright/test");

const isCi = process.env["CI"] === "true";
const baseURL =
  process.env["DIVEDRA_E2E_BASE_URL"] ?? "http://127.0.0.1:43173";
const chromiumExecutablePath = [
  process.env["DIVEDRA_CHROMIUM_EXECUTABLE"],
  "/etc/profiles/per-user/taco/bin/chromium-browser",
  "/run/current-system/sw/bin/chromium-browser",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
].find(
  (candidate) =>
    typeof candidate === "string" &&
    candidate.length > 0 &&
    fs.existsSync(candidate),
);

module.exports = defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.pw\.(cjs|mjs|js|ts)$/,
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 2 : 0,
  reporter: isCi ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(chromiumExecutablePath === undefined
          ? {}
          : {
              launchOptions: {
                executablePath: chromiumExecutablePath,
              },
            }),
      },
    },
  ],
});
