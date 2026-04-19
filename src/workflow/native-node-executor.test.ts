import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AdapterExecutionError } from "./adapter";
import { executeNativeNode } from "./native-node-executor";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-native-node-executor-test-"),
  );
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function writeReportCwdScript(
  workflowDirectory: string,
  relativeDirectory = "scripts",
  fileName = "report-cwd.sh",
): Promise<string> {
  const scriptDirectory = path.join(workflowDirectory, relativeDirectory);
  await mkdir(scriptDirectory, { recursive: true });
  const scriptPath = path.join(scriptDirectory, fileName);
  await writeFile(
    scriptPath,
    [
      "#!/bin/sh",
      'mkdir -p "$DIVEDRA_MAILBOX_DIR/outbox"',
      `printf '{"cwd":"%s"}\n' "$PWD" > "$DIVEDRA_MAILBOX_DIR/outbox/output.json"`,
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o755 },
  );
  return path.join(relativeDirectory, fileName);
}

function readPayloadCwd(payload: Readonly<Record<string, unknown>>): string {
  const cwd = payload["cwd"];
  if (typeof cwd !== "string") {
    throw new Error("native node test payload did not include a string cwd");
  }
  return cwd;
}

async function expectPayloadCwd(
  payload: Readonly<Record<string, unknown>>,
  expectedPath: string,
): Promise<void> {
  expect(await realpath(readPayloadCwd(payload))).toBe(
    await realpath(expectedPath),
  );
}

function makeExecutionMailbox() {
  return {
    meta: {
      protocolVersion: 1,
      mailboxDirEnvVar: "DIVEDRA_MAILBOX_DIR",
      node: {
        workflowId: "wf",
        workflowDescription: "demo workflow",
        nodeId: "node-1",
        nodeKind: "task",
      },
      objective: {
        reason: "Report cwd.",
        expectedReturn: "Return JSON.",
        instruction: "report cwd",
      },
      paths: {
        inputPath: "inbox/input.json",
        inputFilesDir: "inbox/files",
        outputPath: "outbox/output.json",
        outputFilesDir: "outbox/files",
      },
      input: {
        kind: "json",
        upstreamSources: [],
      },
      output: {
        kind: "json",
        required: true,
        path: "outbox/output.json",
        filesDirectory: "outbox/files",
      },
    },
    input: {
      arguments: {},
      upstream: [],
    },
  } as const;
}

describe("executeNativeNode", () => {
  test("defaults command cwd to the workflow execution working directory", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    await mkdir(workflowWorkingDirectory, { recursive: true });
    const scriptPath = await writeReportCwdScript(workflowDirectory);

    const output = await executeNativeNode(
      {
        workflowDirectory,
        workflowWorkingDirectory,
        artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
        workflowId: "wf",
        workflowDescription: "demo workflow",
        workflowExecutionId: "sess-1",
        nodeId: "node-1",
        nodeExecId: "exec-1",
        node: {
          id: "node-1",
          nodeType: "command",
          variables: {},
          command: {
            scriptPath,
          },
        },
        workflowDefaults: {
          maxLoopIterations: 3,
          nodeTimeoutMs: 120000,
        },
        runtimeVariables: {},
        mergedVariables: {},
        arguments: {},
        artifactDir: path.join(workflowDirectory, "artifacts", "node-1"),
        executionMailbox: makeExecutionMailbox(),
      },
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
    );

    await expectPayloadCwd(output.payload, workflowWorkingDirectory);
  });

  test("returns command stdout and stderr as process log attachments", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    await mkdir(workflowWorkingDirectory, { recursive: true });
    const scriptDirectory = path.join(workflowDirectory, "scripts");
    await mkdir(scriptDirectory, { recursive: true });
    await writeFile(
      path.join(scriptDirectory, "write-logs.sh"),
      [
        "#!/bin/sh",
        'echo "native stdout line"',
        'echo "native stderr line" >&2',
        'mkdir -p "$DIVEDRA_MAILBOX_DIR/outbox"',
        `printf '{"summary":"done"}\n' > "$DIVEDRA_MAILBOX_DIR/outbox/output.json"`,
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o755 },
    );

    const output = await executeNativeNode(
      {
        workflowDirectory,
        workflowWorkingDirectory,
        artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
        workflowId: "wf",
        workflowDescription: "demo workflow",
        workflowExecutionId: "sess-1",
        nodeId: "node-1",
        nodeExecId: "exec-1",
        node: {
          id: "node-1",
          nodeType: "command",
          variables: {},
          command: {
            scriptPath: "scripts/write-logs.sh",
          },
        },
        workflowDefaults: {
          maxLoopIterations: 3,
          nodeTimeoutMs: 120000,
        },
        runtimeVariables: {},
        mergedVariables: {},
        arguments: {},
        artifactDir: path.join(workflowDirectory, "artifacts", "node-1"),
        executionMailbox: makeExecutionMailbox(),
      },
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
    );

    expect(output.processLogs).toEqual([
      { stream: "stdout", text: "native stdout line\n" },
      { stream: "stderr", text: "native stderr line\n" },
    ]);
  });

  test("attaches command logs to invalid mailbox output failures", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    await mkdir(workflowWorkingDirectory, { recursive: true });
    const scriptDirectory = path.join(workflowDirectory, "scripts");
    await mkdir(scriptDirectory, { recursive: true });
    await writeFile(
      path.join(scriptDirectory, "missing-output.sh"),
      ["#!/bin/sh", 'echo "stdout before invalid output"', ""].join("\n"),
      { encoding: "utf8", mode: 0o755 },
    );

    await expect(
      executeNativeNode(
        {
          workflowDirectory,
          workflowWorkingDirectory,
          artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
          workflowId: "wf",
          workflowDescription: "demo workflow",
          workflowExecutionId: "sess-1",
          nodeId: "node-1",
          nodeExecId: "exec-1",
          node: {
            id: "node-1",
            nodeType: "command",
            variables: {},
            command: {
              scriptPath: "scripts/missing-output.sh",
            },
          },
          workflowDefaults: {
            maxLoopIterations: 3,
            nodeTimeoutMs: 120000,
          },
          runtimeVariables: {},
          mergedVariables: {},
          arguments: {},
          artifactDir: path.join(workflowDirectory, "artifacts", "node-1"),
          executionMailbox: makeExecutionMailbox(),
        },
        {
          timeoutMs: 5_000,
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toMatchObject({
      code: "invalid_output",
      processLogs: [
        { stream: "stdout", text: "stdout before invalid output\n" },
      ],
    } satisfies Partial<AdapterExecutionError>);
  });

  test("attaches and writes command logs for non-zero exits", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    const artifactDir = path.join(workflowDirectory, "artifacts", "node-1");
    await mkdir(workflowWorkingDirectory, { recursive: true });
    const scriptDirectory = path.join(workflowDirectory, "scripts");
    await mkdir(scriptDirectory, { recursive: true });
    await writeFile(
      path.join(scriptDirectory, "fail.sh"),
      [
        "#!/bin/sh",
        'echo "stdout before failure"',
        'echo "stderr before failure" >&2',
        "exit 2",
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o755 },
    );

    await expect(
      executeNativeNode(
        {
          workflowDirectory,
          workflowWorkingDirectory,
          artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
          workflowId: "wf",
          workflowDescription: "demo workflow",
          workflowExecutionId: "sess-1",
          nodeId: "node-1",
          nodeExecId: "exec-1",
          node: {
            id: "node-1",
            nodeType: "command",
            variables: {},
            command: {
              scriptPath: "scripts/fail.sh",
            },
          },
          workflowDefaults: {
            maxLoopIterations: 3,
            nodeTimeoutMs: 120000,
          },
          runtimeVariables: {},
          mergedVariables: {},
          arguments: {},
          artifactDir,
          executionMailbox: makeExecutionMailbox(),
        },
        {
          timeoutMs: 5_000,
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toMatchObject({
      code: "provider_error",
      processLogs: [
        { stream: "stdout", text: "stdout before failure\n" },
        { stream: "stderr", text: "stderr before failure\n" },
      ],
    } satisfies Partial<AdapterExecutionError>);

    await expect(
      readFile(path.join(artifactDir, "stdout.log"), "utf8"),
    ).resolves.toBe("stdout before failure\n");
    await expect(
      readFile(path.join(artifactDir, "stderr.log"), "utf8"),
    ).resolves.toBe("stderr before failure\n");
  });

  test("keeps successful container build logs when the later run fails", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    const artifactDir = path.join(workflowDirectory, "artifacts", "node-1");
    const runnerPath = path.join(workflowDirectory, "fake-runner.sh");
    await mkdir(workflowWorkingDirectory, { recursive: true });
    await mkdir(path.join(workflowDirectory, "container-context"), {
      recursive: true,
    });
    await writeFile(
      runnerPath,
      [
        "#!/bin/sh",
        "set -eu",
        'if [ "$1" = "build" ]; then',
        '  echo "build stdout"',
        '  echo "build stderr" >&2',
        "  exit 0",
        "fi",
        'if [ "$1" = "run" ]; then',
        '  echo "run stdout before failure"',
        '  echo "run stderr before failure" >&2',
        "  exit 2",
        "fi",
        "exit 64",
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o755 },
    );

    await expect(
      executeNativeNode(
        {
          workflowDirectory,
          workflowWorkingDirectory,
          artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
          workflowId: "wf",
          workflowDescription: "demo workflow",
          workflowExecutionId: "sess-1",
          nodeId: "node-1",
          nodeExecId: "exec-1",
          node: {
            id: "node-1",
            nodeType: "container",
            variables: {},
            container: {
              runnerKind: "docker",
              runnerPath,
              build: {
                contextPath: "container-context",
              },
            },
          },
          workflowDefaults: {
            maxLoopIterations: 3,
            nodeTimeoutMs: 120000,
          },
          runtimeVariables: {},
          mergedVariables: {},
          arguments: {},
          artifactDir,
          executionMailbox: makeExecutionMailbox(),
        },
        {
          timeoutMs: 5_000,
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toMatchObject({
      code: "provider_error",
      processLogs: [
        { stream: "stdout", text: "build stdout\n", label: "build" },
        { stream: "stderr", text: "build stderr\n", label: "build" },
        { stream: "stdout", text: "run stdout before failure\n" },
        { stream: "stderr", text: "run stderr before failure\n" },
      ],
    } satisfies Partial<AdapterExecutionError>);
  });

  test("resolves node-level relative working directory from the workflow working directory", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    const nodeWorkingDirectory = path.join(
      workflowWorkingDirectory,
      "packages",
      "worker",
    );
    await mkdir(nodeWorkingDirectory, { recursive: true });
    const scriptPath = await writeReportCwdScript(workflowDirectory);

    const output = await executeNativeNode(
      {
        workflowDirectory,
        workflowWorkingDirectory,
        artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
        workflowId: "wf",
        workflowDescription: "demo workflow",
        workflowExecutionId: "sess-1",
        nodeId: "node-1",
        nodeExecId: "exec-1",
        node: {
          id: "node-1",
          nodeType: "command",
          workingDirectory: "packages/worker",
          variables: {},
          command: {
            scriptPath,
          },
        },
        workflowDefaults: {
          maxLoopIterations: 3,
          nodeTimeoutMs: 120000,
        },
        runtimeVariables: {},
        mergedVariables: {},
        arguments: {},
        artifactDir: path.join(workflowDirectory, "artifacts", "node-1"),
        executionMailbox: makeExecutionMailbox(),
      },
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
    );

    await expectPayloadCwd(output.payload, nodeWorkingDirectory);
  });

  test("keeps command.workingDirectory as a compatibility override", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    const commandWorkingDirectory = path.join(
      workflowWorkingDirectory,
      "legacy-worker",
    );
    await mkdir(commandWorkingDirectory, { recursive: true });
    const scriptPath = await writeReportCwdScript(workflowDirectory);

    const output = await executeNativeNode(
      {
        workflowDirectory,
        workflowWorkingDirectory,
        artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
        workflowId: "wf",
        workflowDescription: "demo workflow",
        workflowExecutionId: "sess-1",
        nodeId: "node-1",
        nodeExecId: "exec-1",
        node: {
          id: "node-1",
          nodeType: "command",
          variables: {},
          command: {
            scriptPath,
            workingDirectory: "legacy-worker",
          },
        },
        workflowDefaults: {
          maxLoopIterations: 3,
          nodeTimeoutMs: 120000,
        },
        runtimeVariables: {},
        mergedVariables: {},
        arguments: {},
        artifactDir: path.join(workflowDirectory, "artifacts", "node-1"),
        executionMailbox: makeExecutionMailbox(),
      },
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
    );

    await expectPayloadCwd(output.payload, commandWorkingDirectory);
  });
});
