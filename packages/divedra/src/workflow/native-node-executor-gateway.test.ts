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
import type { AdapterExecutionError } from "./adapter";
import { executeNativeNode } from "./native-node-executor";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-native-node-executor-gateway-test-"),
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
  test("runs x-gateway read add-on with mapped container env names", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    const artifactDir = path.join(workflowDirectory, "artifacts", "x-read");
    const runnerPath = path.join(workflowDirectory, "fake-runner.sh");
    const capturedArgsPath = path.join(workflowDirectory, "runner-args.txt");
    const capturedEnvPath = path.join(workflowDirectory, "runner-env.txt");
    await mkdir(workflowWorkingDirectory, { recursive: true });
    await writeFile(
      runnerPath,
      [
        "#!/bin/sh",
        "set -eu",
        'printf "%s\\n" "$@" > "$CAPTURED_ARGS_PATH"',
        'printf "X_GW_TOKEN=%s\\n" "$X_GW_TOKEN" > "$CAPTURED_ENV_PATH"',
        `printf '{"ok":true,"data":{"post":{"id":"123","text":"done"}}}\n'`,
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
        nodeId: "x-read",
        nodeExecId: "exec-1",
        node: {
          id: "x-read",
          nodeType: "addon",
          variables: {
            postId: "123",
          },
          addon: {
            name: "divedra/x-gateway-read",
            version: "1",
            env: {
              X_GW_TOKEN: {
                fromEnv: "ACCOUNT_A_X_GW_TOKEN",
              },
              X_GW_CONFIG_MODE: {
                fromEnv: "OPTIONAL_CONFIG_MODE",
                required: false,
              },
            },
            config: {
              queryTemplate: '{ post(id: "{{postId}}") { id text } }',
              image: "example/x-gateway:latest",
              runnerKind: "docker",
              runnerPath,
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
        env: {
          ACCOUNT_A_X_GW_TOKEN: "account-a-secret",
          CAPTURED_ARGS_PATH: capturedArgsPath,
          CAPTURED_ENV_PATH: capturedEnvPath,
          SHOULD_NOT_ENTER_CONTAINER: "host-secret",
        },
      },
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
    );

    expect(output.provider).toBe("native-addon:x-gateway-read:docker");
    expect(output.payload).toEqual({
      xGateway: {
        ok: true,
        data: {
          post: {
            id: "123",
            text: "done",
          },
        },
      },
    });
    const capturedArgs = await readFile(capturedArgsPath, "utf8");
    expect(capturedArgs).toContain("run\n--rm\n");
    expect(capturedArgs).toContain("-e\nX_GW_TOKEN\n");
    expect(capturedArgs).toContain("example/x-gateway:latest\n");
    expect(capturedArgs).toContain('query\n{ post(id: "123") { id text } }\n');
    expect(capturedArgs).not.toContain("account-a-secret");
    expect(capturedArgs).not.toContain("SHOULD_NOT_ENTER_CONTAINER");
    const capturedEnv = await readFile(capturedEnvPath, "utf8");
    expect(capturedEnv).toBe("X_GW_TOKEN=account-a-secret\n");
  });

  test("runs x-gateway add-on with full client binary for post mutations", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    const artifactDir = path.join(workflowDirectory, "artifacts", "x-post");
    const runnerPath = path.join(workflowDirectory, "fake-runner.sh");
    const capturedArgsPath = path.join(workflowDirectory, "runner-args.txt");
    const capturedEnvPath = path.join(workflowDirectory, "runner-env.txt");
    await mkdir(workflowWorkingDirectory, { recursive: true });
    await writeFile(
      runnerPath,
      [
        "#!/bin/sh",
        "set -eu",
        'printf "%s\\n" "$@" > "$CAPTURED_ARGS_PATH"',
        'printf "X_GW_ACCESS_TOKEN=%s\\n" "$X_GW_ACCESS_TOKEN" > "$CAPTURED_ENV_PATH"',
        `printf '{"ok":true,"data":{"createPost":{"id":"post-1","text":"hello"}}}\n'`,
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
        nodeId: "x-post",
        nodeExecId: "exec-1",
        node: {
          id: "x-post",
          nodeType: "addon",
          variables: {
            postText: "hello",
          },
          addon: {
            name: "divedra/x-gateway",
            version: "1",
            env: {
              X_GW_ACCESS_TOKEN: {
                fromEnv: "ACCOUNT_A_X_GW_ACCESS_TOKEN",
              },
            },
            config: {
              documentTemplate:
                'mutation { createPost(text: "{{postText}}") { id text } }',
              image: "example/x-gateway:latest",
              runnerKind: "docker",
              runnerPath,
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
        env: {
          ACCOUNT_A_X_GW_ACCESS_TOKEN: "access-secret",
          CAPTURED_ARGS_PATH: capturedArgsPath,
          CAPTURED_ENV_PATH: capturedEnvPath,
          SHOULD_NOT_ENTER_CONTAINER: "host-secret",
        },
      },
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
    );

    expect(output.provider).toBe("native-addon:x-gateway:docker");
    expect(output.payload).toEqual({
      xGateway: {
        ok: true,
        data: {
          createPost: {
            id: "post-1",
            text: "hello",
          },
        },
      },
    });
    const capturedArgs = await readFile(capturedArgsPath, "utf8");
    expect(capturedArgs).toContain("example/x-gateway:latest\nx-gateway\n");
    expect(capturedArgs).toContain(
      'query\nmutation { createPost(text: "hello") { id text } }\n',
    );
    expect(capturedArgs).not.toContain("x-gateway-reader");
    expect(capturedArgs).not.toContain("access-secret");
    expect(capturedArgs).not.toContain("SHOULD_NOT_ENTER_CONTAINER");
    const capturedEnv = await readFile(capturedEnvPath, "utf8");
    expect(capturedEnv).toBe("X_GW_ACCESS_TOKEN=access-secret\n");
  });

  test("runs mail-gateway read add-on with mapped container env names", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    const artifactDir = path.join(workflowDirectory, "artifacts", "mail-read");
    const runnerPath = path.join(workflowDirectory, "fake-runner.sh");
    const capturedArgsPath = path.join(workflowDirectory, "runner-args.txt");
    const capturedEnvPath = path.join(workflowDirectory, "runner-env.txt");
    await mkdir(workflowWorkingDirectory, { recursive: true });
    await writeFile(
      runnerPath,
      [
        "#!/bin/sh",
        "set -eu",
        'printf "%s\\n" "$@" > "$CAPTURED_ARGS_PATH"',
        'printf "MAIL_GATEWAY_CONFIG=%s\\n" "$MAIL_GATEWAY_CONFIG" > "$CAPTURED_ENV_PATH"',
        `printf '{"data":{"message":{"id":"msg-1","subject":"hello"}}}\n'`,
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
        nodeId: "mail-read",
        nodeExecId: "exec-1",
        node: {
          id: "mail-read",
          nodeType: "addon",
          variables: {
            accountId: "work",
            messageId: "msg-1",
          },
          addon: {
            name: "divedra/mail-gateway-read",
            version: "1",
            env: {
              MAIL_GATEWAY_CONFIG: {
                fromEnv: "ACCOUNT_A_MAIL_GATEWAY_CONFIG",
              },
              MAIL_GATEWAY_LOG: {
                fromEnv: "OPTIONAL_MAIL_GATEWAY_LOG",
                required: false,
              },
            },
            config: {
              queryTemplate:
                '{ message(accountId: "{{accountId}}", messageId: "{{messageId}}") { id subject } }',
              image: "example/mail-gateway:latest",
              runnerKind: "docker",
              runnerPath,
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
        env: {
          ACCOUNT_A_MAIL_GATEWAY_CONFIG: "/configs/account-a.toml",
          CAPTURED_ARGS_PATH: capturedArgsPath,
          CAPTURED_ENV_PATH: capturedEnvPath,
          SHOULD_NOT_ENTER_CONTAINER: "host-secret",
        },
      },
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
    );

    expect(output.provider).toBe("native-addon:mail-gateway-read:docker");
    expect(output.payload).toEqual({
      mailGateway: {
        data: {
          message: {
            id: "msg-1",
            subject: "hello",
          },
        },
      },
    });
    const capturedArgs = await readFile(capturedArgsPath, "utf8");
    expect(capturedArgs).toContain("run\n--rm\n");
    expect(capturedArgs).toContain("-e\nMAIL_GATEWAY_CONFIG\n");
    expect(capturedArgs).toContain("example/mail-gateway:latest\n");
    expect(capturedArgs).toContain("mail-gateway-reader\ngraphql\n--query\n");
    expect(capturedArgs).toContain(
      '{ message(accountId: "work", messageId: "msg-1") { id subject } }\n',
    );
    expect(capturedArgs).not.toContain("/configs/account-a.toml");
    expect(capturedArgs).not.toContain("SHOULD_NOT_ENTER_CONTAINER");
    const capturedEnv = await readFile(capturedEnvPath, "utf8");
    expect(capturedEnv).toBe("MAIL_GATEWAY_CONFIG=/configs/account-a.toml\n");
  });

  test("runs mail-gateway add-on with full client binary for send mutations", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    const artifactDir = path.join(workflowDirectory, "artifacts", "mail-send");
    const runnerPath = path.join(workflowDirectory, "fake-runner.sh");
    const capturedArgsPath = path.join(workflowDirectory, "runner-args.txt");
    const capturedEnvPath = path.join(workflowDirectory, "runner-env.txt");
    await mkdir(workflowWorkingDirectory, { recursive: true });
    await writeFile(
      runnerPath,
      [
        "#!/bin/sh",
        "set -eu",
        'printf "%s\\n" "$@" > "$CAPTURED_ARGS_PATH"',
        'printf "MAIL_GATEWAY_CONFIG=%s\\n" "$MAIL_GATEWAY_CONFIG" > "$CAPTURED_ENV_PATH"',
        `printf '{"data":{"sendMessage":{"message":{"id":"sent-1","subject":"hello"}}}}\n'`,
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
        nodeId: "mail-send",
        nodeExecId: "exec-1",
        node: {
          id: "mail-send",
          nodeType: "addon",
          variables: {
            accountId: "work",
            to: "person@example.test",
            subject: "hello",
            body: "body",
          },
          addon: {
            name: "divedra/mail-gateway",
            version: "1",
            env: {
              MAIL_GATEWAY_CONFIG: {
                fromEnv: "ACCOUNT_A_MAIL_GATEWAY_CONFIG",
              },
            },
            config: {
              documentTemplate:
                'mutation { sendMessage(input: { accountId: "{{accountId}}", to: ["{{to}}"], subject: "{{subject}}", textBody: "{{body}}" }) { message { id subject } } }',
              image: "example/mail-gateway:latest",
              runnerKind: "docker",
              runnerPath,
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
        env: {
          ACCOUNT_A_MAIL_GATEWAY_CONFIG: "/configs/account-a.toml",
          CAPTURED_ARGS_PATH: capturedArgsPath,
          CAPTURED_ENV_PATH: capturedEnvPath,
          SHOULD_NOT_ENTER_CONTAINER: "host-secret",
        },
      },
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
    );

    expect(output.provider).toBe("native-addon:mail-gateway:docker");
    expect(output.payload).toEqual({
      mailGateway: {
        data: {
          sendMessage: {
            message: {
              id: "sent-1",
              subject: "hello",
            },
          },
        },
      },
    });
    const capturedArgs = await readFile(capturedArgsPath, "utf8");
    expect(capturedArgs).toContain(
      "example/mail-gateway:latest\nmail-gateway\ngraphql\n--query\n",
    );
    expect(capturedArgs).toContain(
      'mutation { sendMessage(input: { accountId: "work", to: ["person@example.test"], subject: "hello", textBody: "body" }) { message { id subject } } }\n',
    );
    expect(capturedArgs).not.toContain("mail-gateway-reader");
    expect(capturedArgs).not.toContain("/configs/account-a.toml");
    expect(capturedArgs).not.toContain("SHOULD_NOT_ENTER_CONTAINER");
    const capturedEnv = await readFile(capturedEnvPath, "utf8");
    expect(capturedEnv).toBe("MAIL_GATEWAY_CONFIG=/configs/account-a.toml\n");
  });

  test("fails x-gateway read add-on before container execution when required mapped env is missing", async () => {
    const workflowDirectory = await makeTempDir();
    await expect(
      executeNativeNode(
        {
          workflowDirectory,
          workflowWorkingDirectory: workflowDirectory,
          artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
          workflowId: "wf",
          workflowDescription: "demo workflow",
          workflowExecutionId: "sess-1",
          nodeId: "x-read",
          nodeExecId: "exec-1",
          node: {
            id: "x-read",
            nodeType: "addon",
            variables: {},
            addon: {
              name: "divedra/x-gateway-read",
              version: "1",
              env: {
                X_GW_TOKEN: {
                  fromEnv: "MISSING_X_GW_TOKEN",
                },
              },
              config: {
                queryTemplate: "{ accountMe { id } }",
                runnerPath: "/definitely/missing/docker",
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
          artifactDir: path.join(workflowDirectory, "artifacts", "x-read"),
          executionMailbox: makeExecutionMailbox(),
          env: {},
        },
        {
          timeoutMs: 5_000,
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toMatchObject({
      code: "provider_error",
      message: expect.stringContaining("MISSING_X_GW_TOKEN"),
    } satisfies Partial<AdapterExecutionError>);
  });

  test("fails x-gateway read add-on before container execution when required mapped env is empty", async () => {
    const workflowDirectory = await makeTempDir();
    await expect(
      executeNativeNode(
        {
          workflowDirectory,
          workflowWorkingDirectory: workflowDirectory,
          artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
          workflowId: "wf",
          workflowDescription: "demo workflow",
          workflowExecutionId: "sess-1",
          nodeId: "x-read",
          nodeExecId: "exec-1",
          node: {
            id: "x-read",
            nodeType: "addon",
            variables: {},
            addon: {
              name: "divedra/x-gateway-read",
              version: "1",
              env: {
                X_GW_TOKEN: {
                  fromEnv: "EMPTY_X_GW_TOKEN",
                },
              },
              config: {
                queryTemplate: "{ accountMe { id } }",
                runnerPath: "/definitely/missing/docker",
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
          artifactDir: path.join(workflowDirectory, "artifacts", "x-read"),
          executionMailbox: makeExecutionMailbox(),
          env: {
            EMPTY_X_GW_TOKEN: "",
          },
        },
        {
          timeoutMs: 5_000,
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toMatchObject({
      code: "provider_error",
      message: expect.stringContaining("EMPTY_X_GW_TOKEN"),
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

  test("honors command.workingDirectory when set on the native command", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    const commandWorkingDirectory = path.join(
      workflowWorkingDirectory,
      "cmd-working-dir",
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
            workingDirectory: "cmd-working-dir",
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
