import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  checkCodexBackendModelAvailability,
  checkCursorBackendModelAvailability,
} from "./readiness";

const tempDirs: string[] = [];

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
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("agent backend readiness adapters", () => {
  test("normalizes codex SDK validation exceptions into model availability failures", async () => {
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

  test("preserves codex model probe diagnostics beyond the first stderr line", async () => {
    const root = await makeTempDir();
    const binDir = path.join(root, "bin");
    await writeExecutable(
      path.join(binDir, "codex"),
      [
        "#!/usr/bin/env bash",
        'if [[ "$1 $2" == "login status" ]]; then',
        '  echo "Logged in using ChatGPT"',
        "  exit 0",
        "fi",
        'echo "Reading additional input from stdin..." >&2',
        `echo 'ERROR: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The gpt-5 model is not supported for this account."}}' >&2`,
        "exit 1",
      ].join("\n"),
    );

    const availability = await checkCodexBackendModelAvailability({
      model: "gpt-5",
      env: {
        PATH: `${binDir}:${process.env["PATH"] ?? ""}`,
      },
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
  });
});
