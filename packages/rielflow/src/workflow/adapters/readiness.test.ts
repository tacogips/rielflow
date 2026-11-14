import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  checkCodexBackendModelAvailability,
  checkCursorBackendModelAvailability,
  type CodexBackendModelAvailability,
  getClaudeBackendCliAuthStatus,
  setCodexBackendSdkOperationsForTest,
} from "./readiness";

const tempDirs: string[] = [];
let codexModelAvailabilityCalls: unknown[] = [];
let codexModelAvailabilityResult: CodexBackendModelAvailability | undefined;

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "rielflow-readiness-test-"),
  );
  tempDirs.push(directory);
  return directory;
}

async function writeExecutable(filePath: string, body: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${body}\n`, { mode: 0o755 });
}

afterEach(async () => {
  setCodexBackendSdkOperationsForTest(undefined);
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

beforeEach(() => {
  codexModelAvailabilityCalls = [];
  codexModelAvailabilityResult = undefined;
  setCodexBackendSdkOperationsForTest({
    checkCodexModelAvailability: async (input) => {
      codexModelAvailabilityCalls.push(input);
      if (codexModelAvailabilityResult === undefined) {
        throw new Error("codex model availability mock result is not set");
      }
      return codexModelAvailabilityResult;
    },
  });
});

describe("agent backend readiness adapters", () => {
  test("normalizes blank codex models into availability failures", async () => {
    const availability = await checkCodexBackendModelAvailability({
      model: " ",
    });

    expect(availability).toMatchObject({
      ok: false,
      model: " ",
      auth: {
        ok: false,
        error: "model is required",
      },
      probe: {
        ok: false,
        error: "model is required",
      },
    });
    expect(codexModelAvailabilityCalls).toHaveLength(0);
  });

  test("normalizes cursor SDK validation exceptions into model availability failures", async () => {
    const availability = await checkCursorBackendModelAvailability({
      model: " ",
    });

    expect(availability).toMatchObject({
      model: " ",
      binary: {
        name: "cursor-agent",
        status: "unavailable",
        error: "model is required",
      },
      modelReachability: {
        status: "unavailable",
        error: "model is required",
      },
    });
  });

  test("delegates codex model availability to the codex-agent SDK", async () => {
    codexModelAvailabilityResult = {
      ok: false,
      model: "gpt-5",
      auth: {
        ok: true,
        status: "Logged in using ChatGPT",
        error: null,
        exitCode: 0,
      },
      probe: {
        ok: false,
        model: "gpt-5",
        output: null,
        error: "The gpt-5 model is not supported for this account.",
        exitCode: 1,
      },
    };

    const availability = await checkCodexBackendModelAvailability({
      model: "gpt-5",
      codexBinary: "/tmp/fake-codex",
      cwd: "/tmp/workflow",
      env: {
        CODEX_HOME: "/tmp/codex-home",
      },
      timeoutMs: 1234,
      prompt: "Reply with ok.",
    });

    expect(availability).toMatchObject({
      ok: false,
      auth: {
        ok: true,
      },
      probe: {
        ok: false,
      },
    });
    expect(availability.probe.error).toContain(
      "The gpt-5 model is not supported for this account.",
    );
    expect(codexModelAvailabilityCalls).toHaveLength(1);
    expect(codexModelAvailabilityCalls[0]).toEqual({
      model: "gpt-5",
      codexBinary: "/tmp/fake-codex",
      cwd: "/tmp/workflow",
      env: {
        CODEX_HOME: "/tmp/codex-home",
      },
      timeoutMs: 1234,
      prompt: "Reply with ok.",
    });
  });

  test("reads Claude CLI auth status JSON", async () => {
    const root = await makeTempDir();
    const binDir = path.join(root, "bin");
    await writeExecutable(
      path.join(binDir, "claude"),
      [
        "#!/usr/bin/env bash",
        'if [[ "$1 $2" == "auth status" ]]; then',
        "  echo '{\"loggedIn\":true}'",
        "  exit 0",
        "fi",
        "exit 1",
      ].join("\n"),
    );

    await expect(
      getClaudeBackendCliAuthStatus({
        env: {
          PATH: `${binDir}:${process.env["PATH"] ?? ""}`,
        },
      }),
    ).resolves.toEqual({
      available: true,
      verified: true,
    });
  });

  test("reports Claude CLI logged-out auth status", async () => {
    const root = await makeTempDir();
    const binDir = path.join(root, "bin");
    await writeExecutable(
      path.join(binDir, "claude"),
      [
        "#!/usr/bin/env bash",
        'if [[ "$1 $2" == "auth status" ]]; then',
        "  echo '{\"loggedIn\":false}'",
        "  exit 0",
        "fi",
        "exit 1",
      ].join("\n"),
    );

    await expect(
      getClaudeBackendCliAuthStatus({
        env: {
          PATH: `${binDir}:${process.env["PATH"] ?? ""}`,
        },
      }),
    ).resolves.toEqual({
      available: false,
      verified: true,
      message: "Claude Code CLI reports loggedIn=false",
    });
  });

  test("reports Claude CLI auth status command failures", async () => {
    const root = await makeTempDir();
    const binDir = path.join(root, "bin");
    await writeExecutable(
      path.join(binDir, "claude"),
      ["#!/usr/bin/env bash", 'echo "login required" >&2', "exit 1"].join("\n"),
    );

    const status = await getClaudeBackendCliAuthStatus({
      env: {
        PATH: `${binDir}:${process.env["PATH"] ?? ""}`,
      },
    });

    expect(status).toMatchObject({
      available: false,
      verified: true,
    });
    expect(status.message).toContain("login required");
  });
});
