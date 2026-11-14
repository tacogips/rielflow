import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  AdapterExecutionError,
  type AdapterExecutionInput,
  type NodeAdapter,
} from "./adapter";
import { callStepExecution } from "./call-step-impl";
import { createWorkflowTemplate } from "./create";
import { createSessionState } from "./session";
import { saveSession } from "./session-store";

const tempDirs: string[] = [];

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
    ) as { validationErrors: readonly unknown[] };
    const firstCandidate = JSON.parse(
      await readFile(path.join(firstAttemptDir, "candidate.json"), "utf8"),
    ) as { wrong: boolean };
    const firstValidation = JSON.parse(
      await readFile(path.join(firstAttemptDir, "validation.json"), "utf8"),
    ) as { valid: boolean; errors: readonly { path: string }[] };
    const secondRequest = JSON.parse(
      await readFile(path.join(secondAttemptDir, "request.json"), "utf8"),
    ) as { validationErrors: readonly { path: string }[] };
    const secondValidation = JSON.parse(
      await readFile(path.join(secondAttemptDir, "validation.json"), "utf8"),
    ) as { valid: boolean };

    expect(firstRequest.validationErrors).toEqual([]);
    expect(firstCandidate.wrong).toBe(true);
    expect(firstValidation.valid).toBe(false);
    expect(firstValidation.errors[0]?.path).toBe("$.summary");
    expect(secondRequest.validationErrors[0]?.path).toBe("$.summary");
    expect(secondValidation.valid).toBe(true);
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
});
