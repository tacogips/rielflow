#!/usr/bin/env node

import fs from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";
import {
  assertWorkspacePackage,
  resolvePackageOptionsFromModuleUrl,
  resolvePackageBinary,
} from "./ui-framework.mjs";

const packageOptions = resolvePackageOptionsFromModuleUrl(import.meta.url);

function resolveChromiumExecutablePath() {
  const candidates = [
    process.env["DIVEDRA_CHROMIUM_EXECUTABLE"],
    "/etc/profiles/per-user/taco/bin/chromium-browser",
    "/run/current-system/sw/bin/chromium-browser",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
  ];

  return candidates.find(
    (candidate) =>
      typeof candidate === "string" &&
      candidate.length > 0 &&
      fs.existsSync(candidate),
  );
}

function isSkippableBrowserLaunchFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Executable doesn't exist") ||
    message.includes("Target page, context or browser has been closed") ||
    message.includes("Operation not permitted")
  );
}

async function verifyBrowserLaunchPrerequisite() {
  assertWorkspacePackage("@playwright/test", "run UI E2E", packageOptions);
  const { chromium } = await import("@playwright/test");
  const executablePath = resolveChromiumExecutablePath();
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath === undefined ? {} : { executablePath }),
  });
  await browser.close();
}

try {
  await verifyBrowserLaunchPrerequisite();
} catch (error) {
  if (!isSkippableBrowserLaunchFailure(error)) {
    throw error;
  }

  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `Skipping UI E2E: browser launch is unavailable in this environment: ${message}\n`,
  );
  process.exit(0);
}

const result = spawnSync(
  resolvePackageBinary("@playwright/test", "playwright", packageOptions),
  ["test", "-c", "playwright.config.cjs"],
  {
    cwd: packageOptions.packageRoot,
    stdio: "inherit",
  },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
