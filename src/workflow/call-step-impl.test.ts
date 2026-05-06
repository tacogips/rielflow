import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  AdapterExecutionError,
  DeterministicNodeAdapter,
  type AdapterExecutionInput,
  type NodeAdapter,
} from "./adapter";
import { callStepExecution } from "./call-step-impl";
import { createWorkflowTemplate } from "./create";
import { listRuntimeNodeLogs } from "./runtime-db";
import { createSessionState } from "./session";
import { loadSession, saveSession } from "./session-store";

const tempDirs: string[] = [];
const deterministicAdapter = new DeterministicNodeAdapter();

/** Shared workflow-load options for call-step test fixtures. */
const workflowLoadOpts = {} as const;

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-call-step-test-"),
  );
  tempDirs.push(directory);
  return directory;
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function createCallStepFixture(
  workflowRoot: string,
  workflowName: string,
): Promise<void> {
  const workflowDir = path.join(workflowRoot, workflowName);
  await mkdir(workflowDir, { recursive: true });

  await writeJson(path.join(workflowDir, "workflow.json"), {
    workflowId: workflowName,
    description: "call-step fixture",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    managerStepId: "divedra-manager",
    entryStepId: "divedra-manager",
    nodes: [
      {
        id: "divedra-manager",
        nodeFile: "node-divedra-manager.json",
      },
      {
        id: "writer",
        nodeFile: "node-writer.json",
      },
    ],
    steps: [
      {
        id: "divedra-manager",
        nodeId: "divedra-manager",
        role: "manager",
        transitions: [{ toStepId: "writer", label: "always" }],
      },
      {
        id: "writer",
        nodeId: "writer",
        role: "worker",
      },
    ],
  });

  await writeJson(path.join(workflowDir, "node-divedra-manager.json"), {
    id: "divedra-manager",
    executionBackend: "claude-code-agent",
    model: "claude-opus-4-1",
    promptTemplate: "manager",
    variables: {},
  });

  await writeJson(path.join(workflowDir, "node-writer.json"), {
    id: "writer",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "write a structured review",
    variables: {},
    output: {
      description: "writer output",
      maxValidationAttempts: 2,
      jsonSchema: {
        type: "object",
        required: ["summary"],
        properties: {
          summary: { type: "string" },
        },
      },
    },
  });
}

async function createRoleManagedCallStepFixture(
  workflowRoot: string,
  workflowName: string,
): Promise<void> {
  const workflowDir = path.join(workflowRoot, workflowName);
  await mkdir(workflowDir, { recursive: true });

  await writeJson(path.join(workflowDir, "workflow.json"), {
    workflowId: workflowName,
    description: "role-managed call-step fixture",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    managerStepId: "divedra-manager",
    entryStepId: "divedra-manager",
    nodes: [
      {
        id: "divedra-manager",
        nodeFile: "node-divedra-manager.json",
      },
      {
        id: "writer",
        nodeFile: "node-writer.json",
      },
    ],
    steps: [
      {
        id: "divedra-manager",
        nodeId: "divedra-manager",
        role: "manager",
        transitions: [{ toStepId: "writer", label: "always" }],
      },
      {
        id: "writer",
        nodeId: "writer",
        role: "worker",
      },
    ],
  });

  await writeJson(path.join(workflowDir, "node-divedra-manager.json"), {
    id: "divedra-manager",
    executionBackend: "claude-code-agent",
    model: "claude-opus-4-1",
    promptTemplate: "manager kind={{nodeKind}}",
    variables: {},
  });

  await writeJson(path.join(workflowDir, "node-writer.json"), {
    id: "writer",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "write a structured review",
    variables: {},
  });
}

async function createOptionalCallStepFixture(
  workflowRoot: string,
  workflowName: string,
): Promise<void> {
  await createCallStepFixture(workflowRoot, workflowName);
  const workflowDir = path.join(workflowRoot, workflowName);
  await writeJson(path.join(workflowDir, "workflow.json"), {
    workflowId: workflowName,
    description: "call-step fixture",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    managerStepId: "divedra-manager",
    entryStepId: "divedra-manager",
    nodes: [
      {
        id: "divedra-manager",
        nodeFile: "node-divedra-manager.json",
      },
      {
        id: "writer",
        nodeFile: "node-writer.json",
        execution: {
          mode: "optional",
          decisionBy: "owning-manager",
        },
      },
    ],
    steps: [
      {
        id: "divedra-manager",
        nodeId: "divedra-manager",
        role: "manager",
        transitions: [{ toStepId: "writer", label: "always" }],
      },
      {
        id: "writer",
        nodeId: "writer",
        role: "worker",
      },
    ],
  });
}

async function createUserActionCallStepFixture(
  workflowRoot: string,
  workflowName: string,
): Promise<void> {
  await createCallStepFixture(workflowRoot, workflowName);
  const workflowDir = path.join(workflowRoot, workflowName);
  await writeJson(path.join(workflowDir, "node-writer.json"), {
    id: "writer",
    nodeType: "user-action",
    promptTemplate: "ask the reviewer for approval",
    variables: {},
    userAction: {
      messageToolIds: ["matrix-primary"],
      replyPolicy: "first-valid-reply-wins",
    },
  });
}

async function createCallStepSession(input: {
  readonly workflowName: string;
  readonly sessionId: string;
  readonly sessionStoreRoot: string;
  readonly initialNodeId?: string;
}): Promise<void> {
  const saved = await saveSession(
    createSessionState({
      sessionId: input.sessionId,
      workflowName: input.workflowName,
      workflowId: input.workflowName,
      initialNodeId: input.initialNodeId ?? "divedra-manager",
      runtimeVariables: {},
    }),
    {
      sessionStoreRoot: input.sessionStoreRoot,
    },
  );
  expect(saved.ok).toBe(true);
}

async function createStepIdMismatchContainerFixture(
  workflowRoot: string,
  workflowName: string,
): Promise<void> {
  const workflowDir = path.join(workflowRoot, workflowName);
  await mkdir(workflowDir, { recursive: true });

  await writeJson(path.join(workflowDir, "workflow.json"), {
    workflowId: workflowName,
    description: "call-step step/node mismatch fixture",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    managerStepId: "manager-step",
    entryStepId: "manager-step",
    nodes: [
      {
        id: "manager-node",
        nodeFile: "node-manager-node.json",
      },
      {
        id: "writer-node",
        nodeFile: "node-writer-node.json",
      },
    ],
    steps: [
      {
        id: "manager-step",
        nodeId: "manager-node",
        role: "manager",
        transitions: [{ toStepId: "writer-step", label: "always" }],
      },
      {
        id: "writer-step",
        nodeId: "writer-node",
        role: "worker",
      },
    ],
  });

  await writeJson(path.join(workflowDir, "node-manager-node.json"), {
    id: "manager-node",
    executionBackend: "claude-code-agent",
    model: "claude-opus-4-1",
    promptTemplate: "manager",
    variables: {},
  });

  await writeJson(path.join(workflowDir, "node-writer-node.json"), {
    id: "writer-node",
    nodeType: "container",
    variables: {},
    container: {
      runnerKind: "podman",
      runnerPath: "/definitely/missing/podman",
      build: {
        contextPath: "containers/writer",
        containerfilePath: "containers/writer/Containerfile",
      },
    },
  });
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

class PromptAndAmbientCaptureAdapter implements NodeAdapter {
  readonly calls: AdapterExecutionInput[] = [];

  async execute(
    input: AdapterExecutionInput,
  ): Promise<
    ReturnType<NodeAdapter["execute"]> extends Promise<infer T> ? T : never
  > {
    this.calls.push(input);
    return {
      provider: "capture-adapter",
      model: input.node.model,
      promptText: input.promptText,
      completionPassed: true,
      when: { always: true },
      payload: { nodeId: input.nodeId },
    };
  }
}

class OutputContractEnvelopeCallStepAdapter implements NodeAdapter {
  async execute(
    input: AdapterExecutionInput,
  ): Promise<
    ReturnType<NodeAdapter["execute"]> extends Promise<infer T> ? T : never
  > {
    return {
      provider: "envelope-call-step-adapter",
      model: input.node.model,
      promptText: input.promptText,
      completionPassed: true,
      when: { always: true },
      payload: {
        when: { needs_revision: true },
        payload: { summary: "review requested", needs_revision: true },
        completionPassed: false,
      },
    };
  }
}

class OutputContractEnvelopeCandidateFileCallStepAdapter
  implements NodeAdapter
{
  async execute(
    input: AdapterExecutionInput,
  ): Promise<
    ReturnType<NodeAdapter["execute"]> extends Promise<infer T> ? T : never
  > {
    const candidatePath = input.output?.candidatePath;
    if (candidatePath === undefined) {
      throw new Error(
        "candidate path should be defined for output-contract tests",
      );
    }
    await mkdir(path.dirname(candidatePath), { recursive: true });
    await writeFile(
      candidatePath,
      `${JSON.stringify(
        {
          when: { needs_revision: true },
          payload: {
            summary: "review requested from file",
            needs_revision: true,
          },
          completionPassed: false,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    return {
      provider: "envelope-call-step-file-adapter",
      model: input.node.model,
      promptText: input.promptText,
      completionPassed: true,
      when: { always: true },
      payload: {},
      candidateFilePath: candidatePath,
    };
  }
}

class InvalidEnvelopeThenFixedCallStepAdapter implements NodeAdapter {
  calls = 0;

  async execute(
    input: AdapterExecutionInput,
  ): Promise<
    ReturnType<NodeAdapter["execute"]> extends Promise<infer T> ? T : never
  > {
    this.calls += 1;
    if (this.calls === 1) {
      return {
        provider: "invalid-envelope-call-step-adapter",
        model: input.node.model,
        promptText: input.promptText,
        completionPassed: true,
        when: { always: true },
        payload: {
          when: { needs_revision: "yes" },
          payload: { summary: "bad envelope" },
        } as unknown as Readonly<Record<string, unknown>>,
      };
    }

    return {
      provider: "invalid-envelope-call-step-adapter",
      model: input.node.model,
      promptText: input.promptText,
      completionPassed: true,
      when: { always: true },
      payload: { summary: "fixed after envelope retry" },
    };
  }
}

describe("callStepExecution", () => {
  test("treats manager-role steps as manager context for prompt assembly and ambient manager context", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const workflowName = "call-step-role-manager";
    const sessionId = "sess-call-step-role-manager";

    await createRoleManagedCallStepFixture(root, workflowName);
    await createCallStepSession({
      workflowName,
      sessionId,
      sessionStoreRoot,
    });

    const adapter = new PromptAndAmbientCaptureAdapter();
    const result = await callStepExecution(
      {
        ...workflowLoadOpts,
        workflowRoot: root,
        artifactRoot: artifactsRoot,
        rootDataDir: path.join(root, "data"),
        sessionStoreRoot,
        workflowId: workflowName,
        workflowRunId: sessionId,
        stepId: "divedra-manager",
        message: { instruction: "plan the work" },
      },
      adapter,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0]?.promptText).toContain("Node kind: manager");
    expect(adapter.calls[0]?.ambientManagerContext?.environment).toMatchObject({
      DIVEDRA_MANAGER_SESSION_ID: "mgrsess-exec-000001",
      DIVEDRA_WORKFLOW_ID: workflowName,
      DIVEDRA_WORKFLOW_EXECUTION_ID: sessionId,
      DIVEDRA_MANAGER_STEP_ID: "divedra-manager",
      DIVEDRA_MANAGER_NODE_EXEC_ID: "exec-000001",
    });
  });

  test("supports mock-scenario fallback for scaffolded code-manager nodes without explicit manager scenario entries", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const workflowName = "call-step-template-manager";
    const sessionId = "sess-call-step-template-manager";

    const created = await createWorkflowTemplate(workflowName, {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    await createCallStepSession({
      workflowName,
      sessionId,
      sessionStoreRoot,
    });

    const result = await callStepExecution({
      ...workflowLoadOpts,
      workflowRoot: root,
      artifactRoot: artifactsRoot,
      rootDataDir: path.join(root, "data"),
      sessionStoreRoot,
      workflowId: workflowName,
      workflowRunId: sessionId,
      stepId: "divedra-manager",
      mockScenario: {},
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.nodeExecution.nodeId).toBe("divedra-manager");
    expect(result.value.output["provider"]).toBe("deterministic-local");
  });

  test("retries invalid output in the same node session and publishes accepted output", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const workflowName = "call-step-demo";
    const sessionId = "sess-call-step-demo";

    await createCallStepFixture(root, workflowName);
    await createCallStepSession({
      workflowName,
      sessionId,
      sessionStoreRoot,
    });

    class RepairingAdapter implements NodeAdapter {
      readonly calls: AdapterExecutionInput[] = [];

      async execute(input: AdapterExecutionInput) {
        this.calls.push(input);
        const attempt = this.calls.length;
        return {
          provider: "repairing-adapter",
          model: input.node.model,
          promptText: input.promptText,
          completionPassed: true,
          when: { always: true },
          payload:
            attempt === 1 ? { wrong: true } : { summary: "fixed on retry" },
          ...(attempt === 1
            ? { backendSession: { sessionId: "node-session-1" } }
            : {}),
        };
      }
    }

    const adapter = new RepairingAdapter();
    const result = await callStepExecution(
      {
        ...workflowLoadOpts,
        workflowRoot: root,
        artifactRoot: artifactsRoot,
        sessionStoreRoot,
        workflowId: workflowName,
        workflowRunId: sessionId,
        stepId: "writer",
        message: { instruction: "produce review json" },
      },
      adapter,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(adapter.calls).toHaveLength(2);
    expect(adapter.calls[1]?.backendSession).toEqual({
      mode: "reuse",
      sessionId: "node-session-1",
    });
    expect(
      adapter.calls[0]?.divedraHookContext?.environment.DIVEDRA_MAILBOX_DIR,
    ).toBe(path.join(result.value.outputRef.artifactDir, "mailbox"));
    expect(adapter.calls[0]?.promptText).toContain("Runtime mailbox:");
    expect(adapter.calls[0]?.promptText).toContain("DIVEDRA_MAILBOX_DIR");
    expect(result.value.output["payload"]).toEqual({
      summary: "fixed on retry",
    });
    expect(result.value.nodeExecution.outputAttemptCount).toBe(2);

    const outputJson = JSON.parse(
      await readFile(
        path.join(result.value.outputRef.artifactDir, "output.json"),
        "utf8",
      ),
    ) as { payload: { summary: string } };
    expect(outputJson.payload.summary).toBe("fixed on retry");

    const inputJson = JSON.parse(
      await readFile(
        path.join(result.value.outputRef.artifactDir, "input.json"),
        "utf8",
      ),
    ) as {
      promptText?: string;
      managerMessage?: { instruction?: string };
      executionMailbox?: {
        readonly meta: {
          readonly mailboxDirEnvVar: string;
          readonly paths: {
            readonly inputPath: string;
            readonly outputPath: string;
          };
        };
      };
    };
    expect(inputJson.promptText).toContain("Runtime mailbox:");
    expect(inputJson.promptText).toContain("DIVEDRA_MAILBOX_DIR");
    expect(inputJson.promptText).toContain(
      "$DIVEDRA_MAILBOX_DIR/inbox/input.json",
    );
    expect(inputJson.managerMessage?.instruction).toBe("produce review json");
    expect(inputJson.executionMailbox).toMatchObject({
      meta: {
        mailboxDirEnvVar: "DIVEDRA_MAILBOX_DIR",
        paths: {
          inputPath: "inbox/input.json",
          outputPath: "outbox/output.json",
        },
      },
    });

    const mailboxMeta = JSON.parse(
      await readFile(
        path.join(
          result.value.outputRef.artifactDir,
          "mailbox",
          "inbox",
          "meta.json",
        ),
        "utf8",
      ),
    ) as {
      readonly objective: { readonly instruction: string };
      readonly paths: { readonly outputPath: string };
    };
    const mailboxInput = JSON.parse(
      await readFile(
        path.join(
          result.value.outputRef.artifactDir,
          "mailbox",
          "inbox",
          "input.json",
        ),
        "utf8",
      ),
    ) as {
      readonly managerMessage?: { readonly instruction?: string };
    };
    expect(mailboxMeta.objective.instruction).toBe("write a structured review");
    expect(mailboxMeta.paths.outputPath).toBe("outbox/output.json");
    expect(mailboxInput.managerMessage?.instruction).toBe(
      "produce review json",
    );

    const firstAttemptDir = path.join(
      result.value.outputRef.artifactDir,
      "output-attempts",
      "attempt-000001",
    );
    const secondAttemptDir = path.join(
      result.value.outputRef.artifactDir,
      "output-attempts",
      "attempt-000002",
    );
    const firstRequest = JSON.parse(
      await readFile(path.join(firstAttemptDir, "request.json"), "utf8"),
    ) as {
      executionBackend: string;
      model: string;
      promptText: string;
      validationErrors: readonly unknown[];
    };
    const firstCandidate = JSON.parse(
      await readFile(path.join(firstAttemptDir, "candidate.json"), "utf8"),
    ) as { wrong: boolean };
    const firstValidation = JSON.parse(
      await readFile(path.join(firstAttemptDir, "validation.json"), "utf8"),
    ) as { valid: boolean; errors: readonly { path: string }[] };
    const secondRequest = JSON.parse(
      await readFile(path.join(secondAttemptDir, "request.json"), "utf8"),
    ) as {
      promptText: string;
      validationErrors: readonly { path: string }[];
    };
    const secondValidation = JSON.parse(
      await readFile(path.join(secondAttemptDir, "validation.json"), "utf8"),
    ) as { valid: boolean };

    expect(firstRequest.validationErrors).toEqual([]);
    expect(firstRequest.executionBackend).toBe("codex-agent");
    expect(firstRequest.model).toBe("gpt-5-nano");
    expect(firstRequest.promptText).toContain("Runtime mailbox:");
    expect(firstRequest.promptText).toContain("DIVEDRA_MAILBOX_DIR");
    expect(firstRequest.promptText).toContain(
      "$DIVEDRA_MAILBOX_DIR/inbox/input.json",
    );
    expect(firstCandidate.wrong).toBe(true);
    expect(firstValidation.valid).toBe(false);
    expect(firstValidation.errors[0]?.path).toBe("$.summary");
    expect(secondRequest.validationErrors[0]?.path).toBe("$.summary");
    expect(secondValidation.valid).toBe(true);
    expect(secondRequest.promptText).toContain("Runtime mailbox:");
    expect(secondRequest.promptText).toContain("DIVEDRA_MAILBOX_DIR");
  });

  test("retries adapter invalid_output failures for structured-output nodes", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const workflowName = "call-step-retry-invalid-output";
    const sessionId = "sess-call-step-retry-invalid-output";

    await createCallStepFixture(root, workflowName);
    await createCallStepSession({
      workflowName,
      sessionId,
      sessionStoreRoot,
    });

    class InvalidThenFixedAdapter implements NodeAdapter {
      calls = 0;

      async execute(input: AdapterExecutionInput) {
        this.calls += 1;
        if (this.calls === 1) {
          throw new AdapterExecutionError(
            "invalid_output",
            "writer must return a JSON object",
          );
        }
        return {
          provider: "repairing-adapter",
          model: input.node.model,
          promptText: input.promptText,
          completionPassed: true,
          when: { always: true },
          payload: { summary: "fixed after invalid output" },
          backendSession: { sessionId: "node-session-2" },
        };
      }
    }

    const adapter = new InvalidThenFixedAdapter();
    const result = await callStepExecution(
      {
        ...workflowLoadOpts,
        workflowRoot: root,
        artifactRoot: artifactsRoot,
        sessionStoreRoot,
        workflowId: workflowName,
        workflowRunId: sessionId,
        stepId: "writer",
      },
      adapter,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(adapter.calls).toBe(2);
    expect(result.value.nodeExecution.outputAttemptCount).toBe(2);
    expect(result.value.output["payload"]).toEqual({
      summary: "fixed after invalid output",
    });

    const firstValidation = JSON.parse(
      await readFile(
        path.join(
          result.value.outputRef.artifactDir,
          "output-attempts",
          "attempt-000001",
          "validation.json",
        ),
        "utf8",
      ),
    ) as { valid: boolean; errors: readonly { message: string }[] };
    expect(firstValidation.valid).toBe(false);
    expect(firstValidation.errors[0]?.message).toContain(
      "writer must return a JSON object",
    );
  });

  test("publishes normalized inline output-contract envelopes for direct step calls", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const workflowName = "call-step-envelope-inline";
    const sessionId = "sess-call-step-envelope-inline";

    await createCallStepFixture(root, workflowName);
    await createCallStepSession({
      workflowName,
      sessionId,
      sessionStoreRoot,
    });

    const result = await callStepExecution(
      {
        ...workflowLoadOpts,
        workflowRoot: root,
        artifactRoot: artifactsRoot,
        sessionStoreRoot,
        workflowId: workflowName,
        workflowRunId: sessionId,
        stepId: "writer",
      },
      new OutputContractEnvelopeCallStepAdapter(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.output["completionPassed"]).toBe(false);
    expect(result.value.output["when"]).toEqual({ needs_revision: true });
    expect(result.value.output["payload"]).toEqual({
      summary: "review requested",
      needs_revision: true,
    });
    const candidate = JSON.parse(
      await readFile(
        path.join(
          result.value.outputRef.artifactDir,
          "output-attempts",
          "attempt-000001",
          "candidate.json",
        ),
        "utf8",
      ),
    ) as { summary: string; needs_revision: boolean };
    expect(candidate).toEqual({
      summary: "review requested",
      needs_revision: true,
    });
  });

  test("normalizes reserved candidate-file envelopes for direct step calls", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const workflowName = "call-step-envelope-file";
    const sessionId = "sess-call-step-envelope-file";

    await createCallStepFixture(root, workflowName);
    await createCallStepSession({
      workflowName,
      sessionId,
      sessionStoreRoot,
    });

    const result = await callStepExecution(
      {
        ...workflowLoadOpts,
        workflowRoot: root,
        artifactRoot: artifactsRoot,
        sessionStoreRoot,
        workflowId: workflowName,
        workflowRunId: sessionId,
        stepId: "writer",
      },
      new OutputContractEnvelopeCandidateFileCallStepAdapter(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.output["completionPassed"]).toBe(false);
    expect(result.value.output["when"]).toEqual({ needs_revision: true });
    expect(result.value.output["payload"]).toEqual({
      summary: "review requested from file",
      needs_revision: true,
    });
    const candidate = JSON.parse(
      await readFile(
        path.join(
          result.value.outputRef.artifactDir,
          "output-attempts",
          "attempt-000001",
          "candidate.json",
        ),
        "utf8",
      ),
    ) as { summary: string; needs_revision: boolean };
    expect(candidate).toEqual({
      summary: "review requested from file",
      needs_revision: true,
    });
  });

  test("retries invalid output-contract envelopes for direct step calls", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const workflowName = "call-step-envelope-retry";
    const sessionId = "sess-call-step-envelope-retry";

    await createCallStepFixture(root, workflowName);
    await createCallStepSession({
      workflowName,
      sessionId,
      sessionStoreRoot,
    });

    const adapter = new InvalidEnvelopeThenFixedCallStepAdapter();
    const result = await callStepExecution(
      {
        ...workflowLoadOpts,
        workflowRoot: root,
        artifactRoot: artifactsRoot,
        sessionStoreRoot,
        workflowId: workflowName,
        workflowRunId: sessionId,
        stepId: "writer",
      },
      adapter,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(adapter.calls).toBe(2);
    expect(result.value.nodeExecution.outputAttemptCount).toBe(2);
    expect(result.value.output["payload"]).toEqual({
      summary: "fixed after envelope retry",
    });
    const firstValidation = JSON.parse(
      await readFile(
        path.join(
          result.value.outputRef.artifactDir,
          "output-attempts",
          "attempt-000001",
          "validation.json",
        ),
        "utf8",
      ),
    ) as { valid: boolean; errors: readonly { message: string }[] };
    expect(firstValidation.valid).toBe(false);
    expect(firstValidation.errors[0]?.message).toContain(
      "node output candidate.when must be an object<boolean>",
    );
  });

  test("rejects direct step calls for completed sessions", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const workflowName = "call-step-terminal-session";
    const sessionId = "sess-call-step-terminal-session";

    await createCallStepFixture(root, workflowName);
    const saved = await saveSession(
      {
        ...createSessionState({
          sessionId,
          workflowName,
          workflowId: workflowName,
          initialNodeId: "divedra-manager",
          runtimeVariables: {},
        }),
        status: "completed",
        endedAt: "2026-03-16T00:00:00.000Z",
      },
      {
        sessionStoreRoot,
      },
    );
    expect(saved.ok).toBe(true);

    const result = await callStepExecution({
      ...workflowLoadOpts,
      workflowRoot: root,
      artifactRoot: artifactsRoot,
      sessionStoreRoot,
      workflowId: workflowName,
      workflowRunId: sessionId,
      stepId: "writer",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toContain("terminal session");
    expect(result.error.message).toContain("completed");
  });

  test("rejects direct step calls for optional workflow nodes", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const workflowName = "call-step-optional";
    const sessionId = "sess-call-step-optional";

    await createOptionalCallStepFixture(root, workflowName);
    await createCallStepSession({
      workflowName,
      sessionId,
      sessionStoreRoot,
    });

    const result = await callStepExecution({
      ...workflowLoadOpts,
      workflowRoot: root,
      artifactRoot: artifactsRoot,
      sessionStoreRoot,
      workflowId: workflowName,
      workflowRunId: sessionId,
      stepId: "writer",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toContain("is optional");
    expect(result.error.message).toContain("workflow scheduler");
  });

  test("rejects direct step calls for user-action nodes", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const workflowName = "call-step-user-action";
    const sessionId = "sess-call-step-user-action";

    await createUserActionCallStepFixture(root, workflowName);
    await createCallStepSession({
      workflowName,
      sessionId,
      sessionStoreRoot,
    });

    const result = await callStepExecution({
      ...workflowLoadOpts,
      workflowRoot: root,
      artifactRoot: artifactsRoot,
      sessionStoreRoot,
      workflowId: workflowName,
      workflowRunId: sessionId,
      stepId: "writer",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toContain("nodeType='user-action'");
    expect(result.error.message).toContain(
      "direct step execution is not supported",
    );
  });

  test("persists native command process logs for direct step calls", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const rootDataDir = path.join(root, "data");
    const workflowName = "call-step-command-logs";
    const sessionId = "sess-call-step-command-logs";

    await createCallStepFixture(root, workflowName);
    const scriptsDir = path.join(root, workflowName, "scripts");
    await mkdir(scriptsDir, { recursive: true });
    await writeFile(
      path.join(scriptsDir, "write-output.sh"),
      [
        "#!/bin/sh",
        'echo "call-step command stdout"',
        'mkdir -p "$DIVEDRA_MAILBOX_DIR/outbox"',
        `printf '{"summary":"done"}\n' > "$DIVEDRA_MAILBOX_DIR/outbox/output.json"`,
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o755 },
    );
    await writeJson(path.join(root, workflowName, "node-writer.json"), {
      id: "writer",
      nodeType: "command",
      variables: {},
      command: {
        scriptPath: "scripts/write-output.sh",
      },
    });
    await createCallStepSession({
      workflowName,
      sessionId,
      sessionStoreRoot,
    });

    const result = await callStepExecution({
      ...workflowLoadOpts,
      workflowRoot: root,
      artifactRoot: artifactsRoot,
      rootDataDir,
      sessionStoreRoot,
      workflowId: workflowName,
      workflowRunId: sessionId,
      stepId: "writer",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const logs = await listRuntimeNodeLogs(sessionId, {
      workflowRoot: root,
      artifactRoot: artifactsRoot,
      rootDataDir,
    });
    expect(
      logs.some(
        (entry) =>
          entry.nodeId === "writer" &&
          entry.message.includes("stdout") &&
          entry.message.includes("call-step command stdout"),
      ),
    ).toBe(true);
  });

  test("fails deterministically when execution mailbox artifacts cannot be persisted", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const workflowName = "call-step-mailbox-write-failure";
    const sessionId = "sess-call-step-mailbox-write-failure";

    await createCallStepFixture(root, workflowName);
    await createCallStepSession({
      workflowName,
      sessionId,
      sessionStoreRoot,
    });

    const blockedMailboxPath = path.join(
      artifactsRoot,
      workflowName,
      "executions",
      sessionId,
      "nodes",
      "writer",
      "exec-000001",
      "mailbox",
    );
    await mkdir(path.dirname(blockedMailboxPath), { recursive: true });
    await writeFile(blockedMailboxPath, "blocked", "utf8");

    const result = await callStepExecution(
      {
        ...workflowLoadOpts,
        workflowRoot: root,
        artifactRoot: artifactsRoot,
        sessionStoreRoot,
        workflowId: workflowName,
        workflowRunId: sessionId,
        stepId: "writer",
      },
      deterministicAdapter,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.exitCode).toBe(1);
    expect(result.error.message).toContain(
      "failed to persist execution mailbox",
    );

    const persisted = await loadSession(sessionId, { sessionStoreRoot });
    expect(persisted.ok).toBe(true);
    if (!persisted.ok) {
      return;
    }
    expect(persisted.value.status).toBe("failed");
    expect(persisted.value.lastError).toContain(
      "failed to persist execution mailbox",
    );
  });

  test("fails container node execution when the configured runner is unavailable", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const workflowName = "call-step-podman";
    const sessionId = "sess-call-step-podman";

    await createCallStepFixture(root, workflowName);
    await writeJson(path.join(root, workflowName, "node-writer.json"), {
      id: "writer",
      nodeType: "container",
      variables: {},
      container: {
        runnerKind: "podman",
        runnerPath: "/definitely/missing/podman",
        build: {
          contextPath: "containers/writer",
          containerfilePath: "containers/writer/Containerfile",
        },
      },
      output: {
        description: "writer output",
        maxValidationAttempts: 2,
        jsonSchema: {
          type: "object",
          required: ["summary"],
          properties: {
            summary: { type: "string" },
          },
        },
      },
    });
    await createCallStepSession({
      workflowName,
      sessionId,
      sessionStoreRoot,
    });

    const result = await callStepExecution({
      ...workflowLoadOpts,
      workflowRoot: root,
      artifactRoot: artifactsRoot,
      sessionStoreRoot,
      workflowId: workflowName,
      workflowRunId: sessionId,
      stepId: "writer",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toContain("workflow runtime readiness failed");
  });

  test("fails readiness for a direct step when the step id differs from its node registry id", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const workflowName = "call-step-step-node-mismatch";
    const sessionId = "sess-call-step-step-node-mismatch";

    await createStepIdMismatchContainerFixture(root, workflowName);
    await createCallStepSession({
      workflowName,
      sessionId,
      sessionStoreRoot,
      initialNodeId: "manager-step",
    });

    const result = await callStepExecution({
      ...workflowLoadOpts,
      workflowRoot: root,
      artifactRoot: artifactsRoot,
      sessionStoreRoot,
      workflowId: workflowName,
      workflowRunId: sessionId,
      stepId: "writer-step",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toContain("workflow runtime readiness failed");
  });

  test("normalizes plain-text manager messages in mailbox input artifacts", async () => {
    const root = await makeTempDir();
    const artifactsRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    const workflowName = "call-step-plain-message";
    const sessionId = "sess-call-step-plain-message";

    await createCallStepFixture(root, workflowName);
    await createCallStepSession({
      workflowName,
      sessionId,
      sessionStoreRoot,
    });

    class PlainMessageAdapter implements NodeAdapter {
      async execute(input: AdapterExecutionInput) {
        return {
          provider: "plain-message-adapter",
          model: input.node.model,
          promptText: input.promptText,
          completionPassed: true,
          when: { always: true },
          payload: { summary: "ok" },
        };
      }
    }

    const result = await callStepExecution(
      {
        ...workflowLoadOpts,
        workflowRoot: root,
        artifactRoot: artifactsRoot,
        sessionStoreRoot,
        workflowId: workflowName,
        workflowRunId: sessionId,
        stepId: "writer",
        message: "review this change",
      },
      new PlainMessageAdapter(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const mailboxInput = JSON.parse(
      await readFile(
        path.join(
          result.value.outputRef.artifactDir,
          "mailbox",
          "inbox",
          "input.json",
        ),
        "utf8",
      ),
    ) as {
      readonly managerMessage?: {
        readonly payload?: { readonly text?: string };
      };
    };
    expect(mailboxInput.managerMessage?.payload).toEqual({
      text: "review this change",
    });
  });
});
