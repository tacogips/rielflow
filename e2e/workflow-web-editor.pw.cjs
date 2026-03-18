const { mkdtemp, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
const { expect, test } = require("@playwright/test");

const host = "127.0.0.1";
const STARTUP_ATTEMPTS = 20;

let tempRoot = "";
let currentBaseUrl = "";
let serverProcess;
let serverExited = false;
let serverLogs = "";
let startupSkipReason = "";

function isLoopbackListenBlocked(detail) {
  return (
    detail.includes("Failed to listen at 127.0.0.1") ||
    detail.includes("listen EPERM") ||
    detail.includes("operation not permitted")
  );
}

function isSkippableStartupFailure(detail) {
  return (
    isLoopbackListenBlocked(detail) ||
    detail.includes("server did not emit its bound URL") ||
    detail.includes("server did not become healthy")
  );
}

async function waitForHealthy(url) {
  for (let attempt = 0; attempt < STARTUP_ATTEMPTS; attempt += 1) {
    if (serverExited) {
      const detail =
        serverLogs.trim().length > 0
          ? serverLogs.trim()
          : "server exited before /healthz became ready";
      throw new Error(detail);
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }
    await delay(250);
  }
  throw new Error(`server did not become healthy: ${url}`);
}

async function waitForServeUrl() {
  for (let attempt = 0; attempt < STARTUP_ATTEMPTS; attempt += 1) {
    if (serverExited) {
      const detail =
        serverLogs.trim().length > 0
          ? serverLogs.trim()
          : "server exited before emitting its bound URL";
      throw new Error(detail);
    }

    const stdoutLines = serverLogs
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    for (const line of stdoutLines) {
      try {
        const parsed = JSON.parse(line);
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          typeof parsed.host === "string" &&
          typeof parsed.port === "number"
        ) {
          return `http://${parsed.host}:${String(parsed.port)}`;
        }
      } catch {
        // Non-JSON log lines are expected; keep scanning.
      }
    }

    await delay(250);
  }

  throw new Error(`server did not emit its bound URL: ${serverLogs.trim()}`);
}

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(10_000);
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "divedra-e2e-"));
  const workflowRoot = path.join(tempRoot, "workflows");
  const artifactRoot = path.join(tempRoot, "artifacts");
  const sessionStoreRoot = path.join(tempRoot, "sessions");
  serverExited = false;
  serverLogs = "";

  serverProcess = spawn(
    "bun",
    [
      "run",
      "src/main.ts",
      "serve",
      "--workflow-root",
      workflowRoot,
      "--artifact-root",
      artifactRoot,
      "--session-store",
      sessionStoreRoot,
      "--host",
      host,
      "--port",
      String(process.env.DIVEDRA_E2E_PORT ?? "0"),
      "--output",
      "json",
    ],
    {
      cwd: process.cwd(),
      stdio: "pipe",
    },
  );

  serverProcess.once("exit", (code, signal) => {
    serverExited = true;
    serverLogs += `\nserver exited with ${signal === null ? `code ${String(code)}` : `signal ${signal}`}`;
  });

  serverProcess.stdout.on("data", (chunk) => {
    serverLogs += chunk.toString("utf8");
  });

  serverProcess.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    serverLogs += text;
    if (text.trim().length > 0) {
      process.stderr.write(text);
    }
  });

  try {
    currentBaseUrl = await waitForServeUrl();
    await waitForHealthy(`${currentBaseUrl}/healthz`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (!isSkippableStartupFailure(detail)) {
      throw error;
    }

    startupSkipReason = `live serve verification is unavailable in this environment: ${detail}`;
  }
});

test.afterAll(async () => {
  if (serverProcess !== undefined && serverProcess.killed === false) {
    serverProcess.kill("SIGTERM");
    await new Promise((resolve) => {
      serverProcess?.once("exit", () => resolve(undefined));
      setTimeout(() => resolve(undefined), 2_000);
    });
  }

  if (tempRoot.length > 0) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("creates, edits, and executes a workflow from the browser", async ({
  page,
}) => {
  test.skip(startupSkipReason.length > 0, startupSkipReason);

  await page.goto(`${currentBaseUrl}/`);

  await expect(
    page.getByRole("heading", { name: "divedra Workflow Editor" }),
  ).toBeVisible();

  await page.getByLabel("Create Workflow").fill("browser-demo");
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page.getByLabel("Select Workflow")).toHaveValue("browser-demo");
  await expect(page.locator(".message.info")).toContainText(
    "Created workflow 'browser-demo'.",
  );
  await expect(page.locator(".session-detail")).toContainText(
    "Select a session to inspect status, queue, and node execution history.",
  );

  await page
    .getByLabel("Workflow Description")
    .fill("Workflow created through browser E2E");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".message.info")).toContainText(
    "Saved workflow 'browser-demo' at revision",
    { timeout: 15_000 },
  );

  await page
    .getByLabel("Mock Scenario JSON")
    .fill(
      '{"divedra-manager":{"provider":"scenario-mock","when":{"always":true},"payload":{"stage":"design"}}}',
    );
  await page.getByLabel("Max Steps").fill("1");
  await page.getByRole("button", { name: "Run Workflow" }).click();

  await expect(page.locator(".message.info")).toContainText(
    "Execution accepted for 'browser-demo' as execution sess-",
    {
      timeout: 15_000,
    },
  );
  await expect(page.locator(".sessions")).toContainText("sess-", {
    timeout: 15_000,
  });
  await expect(page.locator(".session-detail")).toContainText("Execution ID", {
    timeout: 15_000,
  });
  await expect(page.locator(".session-detail")).toContainText("Session ID", {
    timeout: 15_000,
  });
  await expect(page.locator(".session-detail")).toContainText("paused", {
    timeout: 15_000,
  });
  await expect(page.locator(".session-detail")).toContainText(
    '"workflowName": "browser-demo"',
  );
  await expect(page.locator(".execution-history")).toContainText(
    "divedra-manager",
  );

  await expect(
    page.getByRole("button", { name: "Cancel Selected" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Cancel Selected" }).click();
  await expect(page.locator(".message.info")).toContainText(
    "Cancelled execution sess-",
    { timeout: 15_000 },
  );
  await expect(page.locator(".session-detail")).toContainText("cancelled", {
    timeout: 15_000,
  });

  await page.getByLabel("Create Workflow").fill("browser-demo-2");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByLabel("Select Workflow")).toHaveValue(
    "browser-demo-2",
  );
  await expect(page.locator(".message.info")).toContainText(
    "Created workflow 'browser-demo-2'.",
  );
  await expect(page.locator(".session-detail")).toContainText(
    "Select a session to inspect status, queue, and node execution history.",
  );
});
