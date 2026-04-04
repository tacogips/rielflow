import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  AdapterExecutionError,
  DeterministicNodeAdapter,
  type MockNodeScenario,
  ScenarioNodeAdapter,
} from "./adapter";
import type { NodeAdapter } from "./adapter";
import { runWorkflow } from "./engine";
import { createManagerSessionStore } from "./manager-session-store";
import { getSessionStoreRoot, loadSession, saveSession } from "./session-store";

const tempDirs: string[] = [];
const deterministicAdapter = new DeterministicNodeAdapter();

class OptionalDecisionAdapter implements NodeAdapter {
  managerCalls = 0;

  async execute(
    input: Parameters<NodeAdapter["execute"]>[0],
  ): Promise<
    ReturnType<NodeAdapter["execute"]> extends Promise<infer T> ? T : never
  > {
    if (input.nodeId === "divedra-manager") {
      this.managerCalls += 1;
      return {
        provider: "optional-decision-adapter",
        model: input.node.model,
        promptText: input.promptText,
        completionPassed: true,
        when: { always: true },
        payload:
          this.managerCalls >= 2
            ? {
                managerControl: {
                  actions: [{ type: "skip-optional-node", nodeId: "step-1" }],
                },
              }
            : {},
      };
    }

    return {
      provider: "optional-decision-adapter",
      model: input.node.model,
      promptText: input.promptText,
      completionPassed: true,
      when: { always: true },
      payload: { nodeId: input.nodeId },
    };
  }
}

class OutputContractRetryAdapter implements NodeAdapter {
  readonly #mode: "retry-success" | "always-invalid";

  constructor(mode: "retry-success" | "always-invalid") {
    this.#mode = mode;
  }

  async execute(
    input: Parameters<NodeAdapter["execute"]>[0],
  ): Promise<
    ReturnType<NodeAdapter["execute"]> extends Promise<infer T> ? T : never
  > {
    if (input.nodeId !== "step-1") {
      return {
        provider: "test-adapter",
        model: input.node.model,
        promptText: input.promptText,
        completionPassed: true,
        when: { always: true },
        payload: { nodeId: input.nodeId },
      };
    }

    const attempt = input.output?.attempt ?? 1;
    if (this.#mode === "retry-success" && attempt > 1) {
      return {
        provider: "test-adapter",
        model: input.node.model,
        promptText: input.promptText,
        completionPassed: true,
        when: { always: true },
        payload: { summary: "valid output" },
      };
    }

    return {
      provider: "test-adapter",
      model: input.node.model,
      promptText: input.promptText,
      completionPassed: true,
      when: { always: true },
      payload: { wrong: true },
    };
  }
}

class OutputContractInvalidOutputAdapter implements NodeAdapter {
  readonly #mode: "retry-success" | "always-invalid";

  constructor(mode: "retry-success" | "always-invalid") {
    this.#mode = mode;
  }

  async execute(
    input: Parameters<NodeAdapter["execute"]>[0],
  ): Promise<
    ReturnType<NodeAdapter["execute"]> extends Promise<infer T> ? T : never
  > {
    if (input.nodeId !== "step-1") {
      return {
        provider: "test-adapter",
        model: input.node.model,
        promptText: input.promptText,
        completionPassed: true,
        when: { always: true },
        payload: { nodeId: input.nodeId },
      };
    }

    const attempt = input.output?.attempt ?? 1;
    if (this.#mode === "retry-success" && attempt > 1) {
      return {
        provider: "test-adapter",
        model: input.node.model,
        promptText: input.promptText,
        completionPassed: true,
        when: { always: true },
        payload: { summary: "valid after invalid-output retry" },
      };
    }

    throw new AdapterExecutionError(
      "invalid_output",
      "adapter response must be a top-level JSON object",
    );
  }
}

class OutputContractInvalidThenProviderErrorAdapter implements NodeAdapter {
  async execute(
    input: Parameters<NodeAdapter["execute"]>[0],
  ): Promise<
    ReturnType<NodeAdapter["execute"]> extends Promise<infer T> ? T : never
  > {
    if (input.nodeId !== "step-1") {
      return {
        provider: "test-adapter",
        model: input.node.model,
        promptText: input.promptText,
        completionPassed: true,
        when: { always: true },
        payload: { nodeId: input.nodeId },
      };
    }

    const attempt = input.output?.attempt ?? 1;
    if (attempt === 1) {
      return {
        provider: "test-adapter",
        model: input.node.model,
        promptText: input.promptText,
        completionPassed: true,
        when: { always: true },
        payload: { wrong: true },
      };
    }

    throw new Error("provider offline");
  }
}

class OutputContractFilePathAdapter implements NodeAdapter {
  readonly #mode: "reserved-path" | "unexpected-path";

  constructor(mode: "reserved-path" | "unexpected-path") {
    this.#mode = mode;
  }

  async execute(
    input: Parameters<NodeAdapter["execute"]>[0],
  ): Promise<
    ReturnType<NodeAdapter["execute"]> extends Promise<infer T> ? T : never
  > {
    const candidatePath = input.output?.candidatePath;
    if (input.nodeId !== "step-1" || candidatePath === undefined) {
      return {
        provider: "test-adapter",
        model: input.node.model,
        promptText: input.promptText,
        completionPassed: true,
        when: { always: true },
        payload: { nodeId: input.nodeId },
      };
    }

    const actualPath =
      this.#mode === "reserved-path"
        ? candidatePath
        : path.join(path.dirname(candidatePath), "unexpected.json");
    await mkdir(path.dirname(actualPath), { recursive: true });
    await writeJson(actualPath, { summary: "from file" });

    return {
      provider: "test-adapter",
      model: input.node.model,
      promptText: input.promptText,
      completionPassed: true,
      when: { always: true },
      payload: {},
      candidateFilePath: actualPath,
    };
  }
}

class OutputContractDirectFileWriteAdapter implements NodeAdapter {
  async execute(
    input: Parameters<NodeAdapter["execute"]>[0],
  ): Promise<
    ReturnType<NodeAdapter["execute"]> extends Promise<infer T> ? T : never
  > {
    const candidatePath = input.output?.candidatePath;
    if (input.nodeId !== "step-1" || candidatePath === undefined) {
      return {
        provider: "test-adapter",
        model: input.node.model,
        promptText: input.promptText,
        completionPassed: true,
        when: { always: true },
        payload: { nodeId: input.nodeId },
      };
    }

    await writeFile(
      candidatePath,
      `${JSON.stringify({ summary: "direct write" }, null, 2)}\n`,
      "utf8",
    );

    return {
      provider: "test-adapter",
      model: input.node.model,
      promptText: input.promptText,
      completionPassed: true,
      when: { always: true },
      payload: {},
      candidateFilePath: candidatePath,
    };
  }
}

class OutputContractMalformedCandidateFileAdapter implements NodeAdapter {
  async execute(
    input: Parameters<NodeAdapter["execute"]>[0],
  ): Promise<
    ReturnType<NodeAdapter["execute"]> extends Promise<infer T> ? T : never
  > {
    const candidatePath = input.output?.candidatePath;
    if (input.nodeId !== "step-1" || candidatePath === undefined) {
      return {
        provider: "test-adapter",
        model: input.node.model,
        promptText: input.promptText,
        completionPassed: true,
        when: { always: true },
        payload: { nodeId: input.nodeId },
      };
    }

    const attempt = input.output?.attempt ?? 1;
    if (attempt === 1) {
      await writeFile(candidatePath, '{"summary": ', "utf8");
    } else {
      await writeFile(
        candidatePath,
        `${JSON.stringify({ summary: "fixed from file" }, null, 2)}\n`,
        "utf8",
      );
    }

    return {
      provider: "test-adapter",
      model: input.node.model,
      promptText: input.promptText,
      completionPassed: true,
      when: { always: true },
      payload: {},
      candidateFilePath: candidatePath,
    };
  }
}

class NonContractMissingCandidateFileAdapter implements NodeAdapter {
  async execute(
    input: Parameters<NodeAdapter["execute"]>[0],
  ): Promise<
    ReturnType<NodeAdapter["execute"]> extends Promise<infer T> ? T : never
  > {
    if (input.nodeId !== "step-1") {
      return {
        provider: "test-adapter",
        model: input.node.model,
        promptText: input.promptText,
        completionPassed: true,
        when: { always: true },
        payload: { nodeId: input.nodeId },
      };
    }

    return {
      provider: "test-adapter",
      model: input.node.model,
      promptText: input.promptText,
      completionPassed: true,
      when: { always: true },
      payload: {},
      candidateFilePath: path.join(
        os.tmpdir(),
        "divedra-output-candidates",
        input.workflowId,
        input.workflowExecutionId,
        input.nodeId,
        input.nodeExecId,
        "attempt-000001",
        "candidate.json",
      ),
    };
  }
}

class OutputContractStaleCandidatePathAdapter implements NodeAdapter {
  readonly #mode: "write" | "reuse-without-write";

  constructor(mode: "write" | "reuse-without-write") {
    this.#mode = mode;
  }

  async execute(
    input: Parameters<NodeAdapter["execute"]>[0],
  ): Promise<
    ReturnType<NodeAdapter["execute"]> extends Promise<infer T> ? T : never
  > {
    const candidatePath = input.output?.candidatePath;
    if (input.nodeId !== "step-1" || candidatePath === undefined) {
      return {
        provider: "test-adapter",
        model: input.node.model,
        promptText: input.promptText,
        completionPassed: true,
        when: { always: true },
        payload: { nodeId: input.nodeId },
      };
    }

    if (this.#mode === "write") {
      await writeFile(
        candidatePath,
        `${JSON.stringify({ summary: "fresh candidate" }, null, 2)}\n`,
        "utf8",
      );
    }

    return {
      provider: "test-adapter",
      model: input.node.model,
      promptText: input.promptText,
      completionPassed: true,
      when: { always: true },
      payload: {},
      candidateFilePath: candidatePath,
    };
  }
}

class OutputContractPromptCaptureAdapter implements NodeAdapter {
  capturedPromptText: string | undefined;

  capturedOutputContract:
    | Parameters<NodeAdapter["execute"]>[0]["output"]
    | undefined;

  async execute(
    input: Parameters<NodeAdapter["execute"]>[0],
  ): Promise<
    ReturnType<NodeAdapter["execute"]> extends Promise<infer T> ? T : never
  > {
    if (input.nodeId === "step-1") {
      this.capturedPromptText = input.promptText;
      this.capturedOutputContract = input.output;
      return {
        provider: "test-adapter",
        model: input.node.model,
        promptText: input.promptText,
        completionPassed: true,
        when: { always: true },
        payload: { summary: "captured" },
      };
    }

    return {
      provider: "test-adapter",
      model: input.node.model,
      promptText: input.promptText,
      completionPassed: true,
      when: { always: true },
      payload: { nodeId: input.nodeId },
    };
  }
}

class OutputContractCandidatePathCaptureAdapter implements NodeAdapter {
  readonly #mode: "success" | "invalid-json";

  capturedCandidatePath: string | undefined;

  constructor(mode: "success" | "invalid-json") {
    this.#mode = mode;
  }

  async execute(
    input: Parameters<NodeAdapter["execute"]>[0],
  ): Promise<
    ReturnType<NodeAdapter["execute"]> extends Promise<infer T> ? T : never
  > {
    const candidatePath = input.output?.candidatePath;
    if (input.nodeId !== "step-1" || candidatePath === undefined) {
      return {
        provider: "test-adapter",
        model: input.node.model,
        promptText: input.promptText,
        completionPassed: true,
        when: { always: true },
        payload: { nodeId: input.nodeId },
      };
    }

    this.capturedCandidatePath = candidatePath;
    await mkdir(path.dirname(candidatePath), { recursive: true });
    if (this.#mode === "success") {
      await writeFile(
        candidatePath,
        `${JSON.stringify({ summary: "captured write" }, null, 2)}\n`,
        "utf8",
      );
    } else {
      await writeFile(candidatePath, '{"summary": ', "utf8");
    }

    return {
      provider: "test-adapter",
      model: input.node.model,
      promptText: input.promptText,
      completionPassed: true,
      when: { always: true },
      payload: {},
      candidateFilePath: candidatePath,
    };
  }
}

class OutputContractRetryPromptCaptureAdapter implements NodeAdapter {
  prompts: string[] = [];
  validationErrorsByAttempt: Array<
    readonly { path: string; message: string }[]
  > = [];

  async execute(
    input: Parameters<NodeAdapter["execute"]>[0],
  ): Promise<
    ReturnType<NodeAdapter["execute"]> extends Promise<infer T> ? T : never
  > {
    if (input.nodeId === "step-1") {
      this.prompts.push(input.promptText);
      this.validationErrorsByAttempt.push(input.output?.validationErrors ?? []);
      const attempt = input.output?.attempt ?? 1;
      return {
        provider: "test-adapter",
        model: input.node.model,
        promptText: input.promptText,
        completionPassed: true,
        when: { always: true },
        payload:
          attempt === 1
            ? {
                a: 1,
                b: 2,
                c: 3,
                d: 4,
                e: 5,
                f: 6,
                g: 7,
                h: 8,
                i: 9,
              }
            : { summary: "fixed" },
      };
    }

    return {
      provider: "test-adapter",
      model: input.node.model,
      promptText: input.promptText,
      completionPassed: true,
      when: { always: true },
      payload: { nodeId: input.nodeId },
    };
  }
}

class DescriptionOnlyRetryPromptCaptureAdapter implements NodeAdapter {
  prompts: string[] = [];

  async execute(
    input: Parameters<NodeAdapter["execute"]>[0],
  ): Promise<
    ReturnType<NodeAdapter["execute"]> extends Promise<infer T> ? T : never
  > {
    if (input.nodeId === "step-1") {
      this.prompts.push(input.promptText);
      const attempt = input.output?.attempt ?? 1;
      if (attempt === 1) {
        throw new AdapterExecutionError(
          "invalid_output",
          "adapter response must be a top-level JSON object",
        );
      }

      return {
        provider: "test-adapter",
        model: input.node.model,
        promptText: input.promptText,
        completionPassed: true,
        when: { always: true },
        payload: { summary: "fixed" },
      };
    }

    return {
      provider: "test-adapter",
      model: input.node.model,
      promptText: input.promptText,
      completionPassed: true,
      when: { always: true },
      payload: { nodeId: input.nodeId },
    };
  }
}

class ReusableSessionAdapter implements NodeAdapter {
  readonly calls: Array<{
    readonly nodeId: string;
    readonly backendSession?: {
      readonly mode: "new" | "reuse";
      readonly sessionId?: string;
    };
  }> = [];

  async execute(
    input: Parameters<NodeAdapter["execute"]>[0],
  ): Promise<
    ReturnType<NodeAdapter["execute"]> extends Promise<infer T> ? T : never
  > {
    this.calls.push({
      nodeId: input.nodeId,
      ...(input.backendSession === undefined
        ? {}
        : { backendSession: input.backendSession }),
    });

    if (input.nodeId === "step-b") {
      const sessionId = input.backendSession?.sessionId ?? "backend-b-1";
      const seen =
        input.backendSession?.mode === "reuse" &&
        input.backendSession.sessionId === "backend-b-1";
      return {
        provider: "test-adapter",
        model: input.node.model,
        promptText: input.promptText,
        completionPassed: true,
        when: { always: true, go_c: !seen },
        payload: {
          sum: seen ? 5 : 2,
          reused: seen,
          go_c: !seen,
        },
        backendSession: {
          sessionId,
        },
      };
    }

    return {
      provider: "test-adapter",
      model: input.node.model,
      promptText: input.promptText,
      completionPassed: true,
      when: { always: true },
      payload: { nodeId: input.nodeId },
    };
  }
}

class OutputContractReusableSessionAdapter implements NodeAdapter {
  readonly calls: Array<{
    readonly attempt: number;
    readonly backendSession?: {
      readonly mode: "new" | "reuse";
      readonly sessionId?: string;
    };
  }> = [];

  async execute(
    input: Parameters<NodeAdapter["execute"]>[0],
  ): Promise<
    ReturnType<NodeAdapter["execute"]> extends Promise<infer T> ? T : never
  > {
    if (input.nodeId !== "step-1") {
      return {
        provider: "test-adapter",
        model: input.node.model,
        promptText: input.promptText,
        completionPassed: true,
        when: { always: true },
        payload: { nodeId: input.nodeId },
      };
    }

    const attempt = input.output?.attempt ?? 1;
    this.calls.push({
      attempt,
      ...(input.backendSession === undefined
        ? {}
        : { backendSession: input.backendSession }),
    });

    return {
      provider: "test-adapter",
      model: input.node.model,
      promptText: input.promptText,
      completionPassed: true,
      when: { always: true },
      payload:
        attempt === 1
          ? { wrong: true }
          : { summary: "valid after backend session retry" },
      backendSession: {
        sessionId: "backend-step-1",
      },
    };
  }
}

class InvalidManagerControlReusableSessionAdapter implements NodeAdapter {
  async execute(
    input: Parameters<NodeAdapter["execute"]>[0],
  ): Promise<
    ReturnType<NodeAdapter["execute"]> extends Promise<infer T> ? T : never
  > {
    if (input.nodeId !== "divedra-manager") {
      return {
        provider: "test-adapter",
        model: input.node.model,
        promptText: input.promptText,
        completionPassed: true,
        when: { always: true },
        payload: { nodeId: input.nodeId },
      };
    }

    return {
      provider: "test-adapter",
      model: input.node.model,
      promptText: input.promptText,
      completionPassed: true,
      when: { always: true },
      payload: {
        managerControl: {
          actions: "invalid",
        },
      },
      backendSession: {
        sessionId: "backend-manager-1",
      },
    };
  }
}

class ExplicitNewSessionPolicyAdapter implements NodeAdapter {
  readonly calls: Array<{
    readonly nodeId: string;
    readonly backendSession?: {
      readonly mode: "new" | "reuse";
      readonly sessionId?: string;
    };
  }> = [];

  async execute(
    input: Parameters<NodeAdapter["execute"]>[0],
  ): Promise<
    ReturnType<NodeAdapter["execute"]> extends Promise<infer T> ? T : never
  > {
    this.calls.push({
      nodeId: input.nodeId,
      ...(input.backendSession === undefined
        ? {}
        : { backendSession: input.backendSession }),
    });

    return {
      provider: "test-adapter",
      model: input.node.model,
      promptText: input.promptText,
      completionPassed: true,
      when: { always: true },
      payload: { nodeId: input.nodeId },
      ...(input.nodeId === "step-1"
        ? { backendSession: { sessionId: "ephemeral-step-1-session" } }
        : {}),
    };
  }
}

class ManagerAmbientContextCaptureAdapter implements NodeAdapter {
  readonly calls: Array<{
    readonly nodeId: string;
    readonly ambientManagerContext?: Parameters<
      NodeAdapter["execute"]
    >[0]["ambientManagerContext"];
  }> = [];

  async execute(
    input: Parameters<NodeAdapter["execute"]>[0],
  ): Promise<
    ReturnType<NodeAdapter["execute"]> extends Promise<infer T> ? T : never
  > {
    this.calls.push({
      nodeId: input.nodeId,
      ...(input.ambientManagerContext === undefined
        ? {}
        : { ambientManagerContext: input.ambientManagerContext }),
    });

    return {
      provider: "test-adapter",
      model: input.node.model,
      promptText: input.promptText,
      completionPassed: true,
      when: { always: true },
      payload: { nodeId: input.nodeId },
    };
  }
}

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-engine-test-"),
  );
  tempDirs.push(directory);
  return directory;
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createWorkflowFixture(
  root: string,
  workflowName: string,
  withLoop: boolean,
): Promise<void> {
  const workflowDir = path.join(root, workflowName);
  await mkdir(workflowDir, { recursive: true });

  const nodes = withLoop
    ? [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "node-divedra-manager.json",
          completion: { type: "none" },
        },
        {
          id: "step-1",
          kind: "loop-judge",
          nodeFile: "node-step-1.json",
          completion: { type: "none" },
        },
        {
          id: "done",
          kind: "output",
          nodeFile: "node-done.json",
          completion: { type: "none" },
        },
      ]
    : [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "node-divedra-manager.json",
          completion: { type: "none" },
        },
        {
          id: "step-1",
          kind: "task",
          nodeFile: "node-step-1.json",
          completion: { type: "none" },
        },
      ];

  const edges = withLoop
    ? [
        { from: "divedra-manager", to: "step-1", when: "always" },
        { from: "step-1", to: "step-1", when: "continue_round" },
        { from: "step-1", to: "done", when: "loop_exit" },
      ]
    : [{ from: "divedra-manager", to: "step-1", when: "always" }];

  await writeJson(path.join(workflowDir, "workflow.json"), {
    workflowId: workflowName,
    description: "fixture",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    managerNodeId: "divedra-manager",
    subWorkflows: [],
    nodes,
    edges,
    loops: withLoop
      ? [
          {
            id: "main-loop",
            judgeNodeId: "step-1",
            continueWhen: "continue_round",
            exitWhen: "loop_exit",
          },
        ]
      : [],
    branching: { mode: "fan-out" },
  });

  await writeJson(path.join(workflowDir, "node-divedra-manager.json"), {
    id: "divedra-manager",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "manager {{topic}}",
    variables: { topic: "A" },
  });

  await writeJson(path.join(workflowDir, "node-step-1.json"), {
    id: "step-1",
    executionBackend: "claude-code-agent",
    model: "claude-opus-4-1",
    promptTemplate: "step {{topic}}",
    variables: {},
  });

  if (withLoop) {
    await writeJson(path.join(workflowDir, "node-done.json"), {
      id: "done",
      executionBackend: "claude-code-agent",
      model: "claude-opus-4-1",
      promptTemplate: "done",
      variables: {},
    });
  }
}

async function createOptionalExecutionFixture(
  root: string,
  workflowName: string,
): Promise<void> {
  const workflowDir = path.join(root, workflowName);
  await mkdir(workflowDir, { recursive: true });

  await writeJson(path.join(workflowDir, "workflow.json"), {
    workflowId: workflowName,
    description: "optional fixture",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    managerNodeId: "divedra-manager",
    subWorkflows: [],
    nodes: [
      {
        id: "divedra-manager",
        kind: "root-manager",
        nodeFile: "node-divedra-manager.json",
        completion: { type: "none" },
      },
      {
        id: "step-1",
        kind: "task",
        nodeFile: "node-step-1.json",
        completion: { type: "none" },
        execution: {
          mode: "optional",
          decisionBy: "owning-manager",
        },
      },
      {
        id: "done",
        kind: "output",
        nodeFile: "node-done.json",
        completion: { type: "none" },
      },
    ],
    edges: [
      { from: "divedra-manager", to: "step-1", when: "always" },
      { from: "step-1", to: "done", when: "always" },
    ],
    loops: [],
    branching: { mode: "fan-out" },
  });

  await writeJson(path.join(workflowDir, "node-divedra-manager.json"), {
    id: "divedra-manager",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "manager",
    variables: {},
  });
  await writeJson(path.join(workflowDir, "node-step-1.json"), {
    id: "step-1",
    executionBackend: "claude-code-agent",
    model: "claude-opus-4-1",
    promptTemplate: "optional task",
    variables: {},
  });
  await writeJson(path.join(workflowDir, "node-done.json"), {
    id: "done",
    executionBackend: "claude-code-agent",
    model: "claude-opus-4-1",
    promptTemplate: "done",
    variables: {},
  });
}

async function createUserActionFixture(
  root: string,
  workflowName: string,
): Promise<void> {
  const workflowDir = path.join(root, workflowName);
  await mkdir(workflowDir, { recursive: true });

  await writeJson(path.join(workflowDir, "workflow.json"), {
    workflowId: workflowName,
    description: "user action fixture",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    managerNodeId: "divedra-manager",
    subWorkflows: [],
    nodes: [
      {
        id: "divedra-manager",
        kind: "root-manager",
        nodeFile: "node-divedra-manager.json",
        completion: { type: "none" },
      },
      {
        id: "approval",
        kind: "task",
        nodeFile: "node-approval.json",
        completion: { type: "none" },
      },
    ],
    edges: [{ from: "divedra-manager", to: "approval", when: "always" }],
    loops: [],
    branching: { mode: "fan-out" },
  });

  await writeJson(path.join(workflowDir, "node-divedra-manager.json"), {
    id: "divedra-manager",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "manager",
    variables: {},
  });
  await writeJson(path.join(workflowDir, "node-approval.json"), {
    id: "approval",
    nodeType: "user-action",
    promptTemplate: "Please approve the release.",
    variables: {},
    userAction: {
      messageToolIds: ["matrix-primary"],
      notificationToolIds: ["desktop-notify"],
      replyPolicy: "first-valid-reply-wins",
    },
  });
}

async function createNodeSessionReuseFixture(
  root: string,
  workflowName: string,
): Promise<void> {
  const workflowDir = path.join(root, workflowName);
  await mkdir(workflowDir, { recursive: true });

  await writeJson(path.join(workflowDir, "workflow.json"), {
    workflowId: workflowName,
    description: "node session reuse fixture",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    managerNodeId: "divedra-manager",
    subWorkflows: [],
    nodes: [
      {
        id: "divedra-manager",
        kind: "root-manager",
        nodeFile: "node-divedra-manager.json",
        completion: { type: "none" },
      },
      {
        id: "step-a",
        kind: "task",
        nodeFile: "node-step-a.json",
        completion: { type: "none" },
      },
      {
        id: "step-b",
        kind: "task",
        nodeFile: "node-step-b.json",
        completion: { type: "none" },
      },
      {
        id: "step-c",
        kind: "task",
        nodeFile: "node-step-c.json",
        completion: { type: "none" },
      },
    ],
    edges: [
      { from: "divedra-manager", to: "step-a", when: "always" },
      { from: "step-a", to: "step-b", when: "always" },
      { from: "step-b", to: "step-c", when: "go_c" },
      { from: "step-c", to: "step-b", when: "always" },
    ],
    loops: [],
    branching: { mode: "fan-out" },
  });

  await writeJson(path.join(workflowDir, "node-divedra-manager.json"), {
    id: "divedra-manager",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "manager",
    variables: {},
  });
  await writeJson(path.join(workflowDir, "node-step-a.json"), {
    id: "step-a",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "return 2",
    variables: {},
  });
  await writeJson(path.join(workflowDir, "node-step-b.json"), {
    id: "step-b",
    executionBackend: "claude-code-agent",
    model: "claude-opus-4-1",
    sessionPolicy: {
      mode: "reuse",
    },
    promptTemplate: "accumulate",
    variables: {},
  });
  await writeJson(path.join(workflowDir, "node-step-c.json"), {
    id: "step-c",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "return 3",
    variables: {},
  });
}

async function createSubWorkflowRuntimeFixture(
  root: string,
  workflowName: string,
): Promise<void> {
  const workflowDir = path.join(root, workflowName);
  await mkdir(workflowDir, { recursive: true });

  await writeJson(path.join(workflowDir, "workflow.json"), {
    workflowId: workflowName,
    description: "sub-workflow fixture",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    managerNodeId: "divedra-manager",
    subWorkflows: [
      {
        id: "sw-a",
        description: "A",
        managerNodeId: "a-manager",
        inputNodeId: "a-input",
        outputNodeId: "a-output",
        nodeIds: ["a-manager", "a-input", "a-output"],
        inputSources: [{ type: "human-input" }],
      },
      {
        id: "sw-b",
        description: "B",
        managerNodeId: "b-manager",
        inputNodeId: "b-input",
        outputNodeId: "b-output",
        nodeIds: ["b-manager", "b-input", "b-output"],
        inputSources: [{ type: "sub-workflow-output", subWorkflowId: "sw-a" }],
      },
    ],
    subWorkflowConversations: [
      {
        id: "conv-1",
        participants: ["sw-a", "sw-b"],
        maxTurns: 3,
        stopWhen: "done",
      },
    ],
    nodes: [
      {
        id: "divedra-manager",
        kind: "root-manager",
        nodeFile: "node-divedra-manager.json",
        completion: { type: "none" },
      },
      {
        id: "a-manager",
        kind: "subworkflow-manager",
        nodeFile: "node-a-manager.json",
        completion: { type: "none" },
      },
      {
        id: "a-input",
        kind: "input",
        nodeFile: "node-a-input.json",
        completion: { type: "none" },
      },
      {
        id: "a-output",
        kind: "output",
        nodeFile: "node-a-output.json",
        completion: { type: "none" },
      },
      {
        id: "b-manager",
        kind: "subworkflow-manager",
        nodeFile: "node-b-manager.json",
        completion: { type: "none" },
      },
      {
        id: "b-input",
        kind: "input",
        nodeFile: "node-b-input.json",
        completion: { type: "none" },
      },
      {
        id: "b-output",
        kind: "output",
        nodeFile: "node-b-output.json",
        completion: { type: "none" },
      },
    ],
    edges: [
      { from: "a-input", to: "a-output", when: "always" },
      { from: "a-output", to: "divedra-manager", when: "always" },
      { from: "b-input", to: "b-output", when: "always" },
      { from: "b-output", to: "divedra-manager", when: "always" },
    ],
    loops: [],
    branching: { mode: "fan-out" },
  });

  await writeJson(path.join(workflowDir, "node-divedra-manager.json"), {
    id: "divedra-manager",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "manager",
    variables: {},
  });
  await writeJson(path.join(workflowDir, "node-a-manager.json"), {
    id: "a-manager",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "a-manager",
    variables: {},
  });
  await writeJson(path.join(workflowDir, "node-a-input.json"), {
    id: "a-input",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "a-input",
    variables: {},
  });
  await writeJson(path.join(workflowDir, "node-a-output.json"), {
    id: "a-output",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "a-output",
    variables: {},
  });
  await writeJson(path.join(workflowDir, "node-b-manager.json"), {
    id: "b-manager",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "b-manager",
    variables: {},
  });
  await writeJson(path.join(workflowDir, "node-b-input.json"), {
    id: "b-input",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "b-input",
    variables: {},
  });
  await writeJson(path.join(workflowDir, "node-b-output.json"), {
    id: "b-output",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "b-output",
    variables: {},
  });
}

async function createManagerAfterOutputFixture(
  root: string,
  workflowName: string,
): Promise<void> {
  const workflowDir = path.join(root, workflowName);
  await mkdir(workflowDir, { recursive: true });

  await writeJson(path.join(workflowDir, "workflow.json"), {
    workflowId: workflowName,
    description: "manager-after-output fixture",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    managerNodeId: "divedra-manager",
    subWorkflows: [],
    nodes: [
      {
        id: "divedra-manager",
        kind: "root-manager",
        nodeFile: "node-divedra-manager.json",
        completion: { type: "none" },
      },
      {
        id: "workflow-output",
        kind: "output",
        nodeFile: "node-workflow-output.json",
        completion: { type: "none" },
      },
    ],
    edges: [
      { from: "divedra-manager", to: "workflow-output", when: "needs_output" },
      { from: "workflow-output", to: "divedra-manager", when: "always" },
    ],
    loops: [],
    branching: { mode: "fan-out" },
  });

  await writeJson(path.join(workflowDir, "node-divedra-manager.json"), {
    id: "divedra-manager",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "manager",
    variables: {},
  });
  await writeJson(path.join(workflowDir, "node-workflow-output.json"), {
    id: "workflow-output",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "workflow-output",
    variables: {},
  });
}

async function createSingleRootOutputFixture(
  root: string,
  workflowName: string,
): Promise<void> {
  const workflowDir = path.join(root, workflowName);
  await mkdir(workflowDir, { recursive: true });

  await writeJson(path.join(workflowDir, "workflow.json"), {
    workflowId: workflowName,
    description: "single-root-output fixture",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    managerNodeId: "divedra-manager",
    subWorkflows: [],
    nodes: [
      {
        id: "divedra-manager",
        kind: "root-manager",
        nodeFile: "node-divedra-manager.json",
        completion: { type: "none" },
      },
      {
        id: "workflow-output",
        kind: "output",
        nodeFile: "node-workflow-output.json",
        completion: { type: "none" },
      },
    ],
    edges: [{ from: "divedra-manager", to: "workflow-output", when: "always" }],
    loops: [],
    branching: { mode: "fan-out" },
  });

  for (const nodeId of ["divedra-manager", "workflow-output"]) {
    await writeJson(path.join(workflowDir, `node-${nodeId}.json`), {
      id: nodeId,
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: nodeId,
      variables: {},
    });
  }
}

async function createMultipleRootOutputsFixture(
  root: string,
  workflowName: string,
): Promise<void> {
  const workflowDir = path.join(root, workflowName);
  await mkdir(workflowDir, { recursive: true });

  await writeJson(path.join(workflowDir, "workflow.json"), {
    workflowId: workflowName,
    description: "multiple-root-outputs fixture",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    managerNodeId: "divedra-manager",
    subWorkflows: [],
    nodes: [
      {
        id: "divedra-manager",
        kind: "root-manager",
        nodeFile: "node-divedra-manager.json",
        completion: { type: "none" },
      },
      {
        id: "first-output",
        kind: "output",
        nodeFile: "node-first-output.json",
        completion: { type: "none" },
      },
      {
        id: "second-output",
        kind: "output",
        nodeFile: "node-second-output.json",
        completion: { type: "none" },
      },
    ],
    edges: [
      { from: "divedra-manager", to: "first-output", when: "always" },
      { from: "first-output", to: "second-output", when: "always" },
    ],
    loops: [],
    branching: { mode: "fan-out" },
  });

  for (const nodeId of ["divedra-manager", "first-output", "second-output"]) {
    await writeJson(path.join(workflowDir, `node-${nodeId}.json`), {
      id: nodeId,
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: nodeId,
      variables: {},
    });
  }
}

async function createRootOutputThenTaskFixture(
  root: string,
  workflowName: string,
): Promise<void> {
  const workflowDir = path.join(root, workflowName);
  await mkdir(workflowDir, { recursive: true });

  await writeJson(path.join(workflowDir, "workflow.json"), {
    workflowId: workflowName,
    description: "root-output-then-task fixture",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    managerNodeId: "divedra-manager",
    subWorkflows: [],
    nodes: [
      {
        id: "divedra-manager",
        kind: "root-manager",
        nodeFile: "node-divedra-manager.json",
        completion: { type: "none" },
      },
      {
        id: "workflow-output",
        kind: "output",
        nodeFile: "node-workflow-output.json",
        completion: { type: "none" },
      },
      {
        id: "final-task",
        kind: "task",
        nodeFile: "node-final-task.json",
        completion: { type: "none" },
      },
    ],
    edges: [
      { from: "divedra-manager", to: "workflow-output", when: "always" },
      { from: "workflow-output", to: "final-task", when: "always" },
    ],
    loops: [],
    branching: { mode: "fan-out" },
  });

  for (const nodeId of ["divedra-manager", "workflow-output", "final-task"]) {
    await writeJson(path.join(workflowDir, `node-${nodeId}.json`), {
      id: nodeId,
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: nodeId,
      variables: {},
    });
  }
}

async function createWorkflowOutputDrivenSubWorkflowFixture(
  root: string,
  workflowName: string,
): Promise<void> {
  const workflowDir = path.join(root, workflowName);
  await mkdir(workflowDir, { recursive: true });

  await writeJson(path.join(workflowDir, "workflow.json"), {
    workflowId: workflowName,
    description: "workflow-output source fixture",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    managerNodeId: "divedra-manager",
    subWorkflows: [
      {
        id: "review-sw",
        description: "Review after root output",
        managerNodeId: "review-manager",
        inputNodeId: "review-input",
        outputNodeId: "review-output",
        nodeIds: ["review-manager", "review-input", "review-output"],
        inputSources: [{ type: "workflow-output", workflowId: workflowName }],
      },
    ],
    nodes: [
      {
        id: "divedra-manager",
        kind: "root-manager",
        nodeFile: "node-divedra-manager.json",
        completion: { type: "none" },
      },
      {
        id: "workflow-output",
        kind: "output",
        nodeFile: "node-workflow-output.json",
        completion: { type: "none" },
      },
      {
        id: "review-manager",
        kind: "subworkflow-manager",
        nodeFile: "node-review-manager.json",
        completion: { type: "none" },
      },
      {
        id: "review-input",
        kind: "input",
        nodeFile: "node-review-input.json",
        completion: { type: "none" },
      },
      {
        id: "review-output",
        kind: "output",
        nodeFile: "node-review-output.json",
        completion: { type: "none" },
      },
    ],
    edges: [
      { from: "divedra-manager", to: "workflow-output", when: "needs_output" },
      { from: "workflow-output", to: "divedra-manager", when: "always" },
      { from: "review-input", to: "review-output", when: "always" },
    ],
    loops: [],
    branching: { mode: "fan-out" },
  });

  for (const nodeId of [
    "divedra-manager",
    "workflow-output",
    "review-manager",
    "review-input",
    "review-output",
  ]) {
    await writeJson(path.join(workflowDir, `node-${nodeId}.json`), {
      id: nodeId,
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: nodeId,
      variables: {},
    });
  }
}

describe("runWorkflow", () => {
  test("executes linear workflow and writes artifacts", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "linear", false);

    const result = await runWorkflow(
      "linear",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        runtimeVariables: { topic: "B" },
      },
      deterministicAdapter,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.exitCode).toBe(0);
    expect(result.value.session.status).toBe("completed");
    expect(result.value.session.nodeExecutions.length).toBe(2);

    const step1Exec = result.value.session.nodeExecutions.find(
      (entry) => entry.nodeId === "step-1",
    );
    expect(step1Exec).toBeDefined();
    if (step1Exec === undefined) {
      return;
    }
    const inputRaw = await readFile(
      path.join(step1Exec.artifactDir, "input.json"),
      "utf8",
    );
    const inputJson = JSON.parse(inputRaw) as {
      sessionId: string;
      workflowExecutionId: string;
      promptText: string;
      executionMailbox?: {
        readonly meta: {
          readonly mailboxDirEnvVar: string;
          readonly paths: {
            readonly inputPath: string;
            readonly outputPath: string;
          };
        };
      };
      upstreamOutputRefs: readonly {
        fromNodeId: string;
        workflowId: string;
        workflowExecutionId: string;
      }[];
      upstreamCommunications: readonly string[];
    };
    expect(inputJson.sessionId).toBe(result.value.session.sessionId);
    expect(inputJson.workflowExecutionId).toBe(result.value.session.sessionId);
    expect(inputJson.promptText).toContain("B");
    expect(inputJson.executionMailbox).toMatchObject({
      meta: {
        mailboxDirEnvVar: "DIVEDRA_MAILBOX_DIR",
        paths: {
          inputPath: "inbox/input.json",
          outputPath: "outbox/output.json",
        },
      },
    });
    expect(inputJson.upstreamOutputRefs.length).toBe(1);
    expect(inputJson.upstreamOutputRefs[0]?.fromNodeId).toBe("divedra-manager");
    expect(inputJson.upstreamOutputRefs[0]?.workflowId).toBe("linear");
    expect(inputJson.upstreamOutputRefs[0]?.workflowExecutionId).toBe(
      result.value.session.sessionId,
    );
    expect(inputJson.upstreamCommunications).toEqual(["comm-000001"]);

    const mailboxMetaRaw = await readFile(
      path.join(step1Exec.artifactDir, "mailbox", "inbox", "meta.json"),
      "utf8",
    );
    const mailboxInputRaw = await readFile(
      path.join(step1Exec.artifactDir, "mailbox", "inbox", "input.json"),
      "utf8",
    );
    const mailboxMeta = JSON.parse(mailboxMetaRaw) as {
      readonly mailboxDirEnvVar: string;
      readonly paths: {
        readonly inputPath: string;
        readonly outputPath: string;
      };
    };
    const mailboxInput = JSON.parse(mailboxInputRaw) as {
      readonly upstream: readonly { communicationId: string }[];
    };
    expect(mailboxMeta.mailboxDirEnvVar).toBe("DIVEDRA_MAILBOX_DIR");
    expect(mailboxMeta.paths.inputPath).toBe("inbox/input.json");
    expect(mailboxMeta.paths.outputPath).toBe("outbox/output.json");
    expect(mailboxInput.upstream[0]?.communicationId).toBe("comm-000001");

    const communicationMessageRaw = await readFile(
      path.join(
        root,
        "artifacts",
        "linear",
        "executions",
        result.value.session.sessionId,
        "communications",
        "comm-000001",
        "message.json",
      ),
      "utf8",
    );
    const communicationMessageJson = JSON.parse(communicationMessageRaw) as {
      workflowExecutionId: string;
      communicationId: string;
      fromNodeId: string;
      toNodeId: string;
    };
    expect(communicationMessageJson.workflowExecutionId).toBe(
      result.value.session.sessionId,
    );
    expect(communicationMessageJson.communicationId).toBe("comm-000001");
    expect(communicationMessageJson.fromNodeId).toBe("divedra-manager");
    expect(communicationMessageJson.toNodeId).toBe("step-1");

    const receiptRaw = await readFile(
      path.join(
        root,
        "artifacts",
        "linear",
        "executions",
        result.value.session.sessionId,
        "communications",
        "comm-000001",
        "attempts",
        "attempt-000001",
        "receipt.json",
      ),
      "utf8",
    );
    const receiptJson = JSON.parse(receiptRaw) as { deliveredByNodeId: string };
    expect(receiptJson.deliveredByNodeId).toBe("divedra-manager");

    const managerOutputRaw = await readFile(
      path.join(
        root,
        "artifacts",
        "linear",
        "executions",
        result.value.session.sessionId,
        "nodes",
        "divedra-manager",
        "exec-000001",
        "output.json",
      ),
      "utf8",
    );
    const mailboxOutputRaw = await readFile(
      path.join(
        root,
        "artifacts",
        "linear",
        "executions",
        result.value.session.sessionId,
        "communications",
        "comm-000001",
        "outbox",
        "divedra-manager",
        "output.json",
      ),
      "utf8",
    );
    expect(mailboxOutputRaw).toBe(managerOutputRaw);

    const handoffRaw = await readFile(
      path.join(step1Exec.artifactDir, "handoff.json"),
      "utf8",
    );
    const handoffJson = JSON.parse(handoffRaw) as {
      inputHash: string;
      outputHash: string;
      nextNodes: readonly string[];
      outputRef: { outputNodeId: string; nodeExecId: string };
    };
    expect(handoffJson.inputHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(handoffJson.outputHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(handoffJson.outputRef.outputNodeId).toBe("step-1");
    expect(handoffJson.outputRef.nodeExecId).toBe(step1Exec.nodeExecId);
    expect(handoffJson.nextNodes).toEqual([]);

    const commitMessage = await readFile(
      path.join(step1Exec.artifactDir, "commit-message.txt"),
      "utf8",
    );
    expect(commitMessage).toContain("Node-ID: step-1");
    expect(commitMessage).toContain(
      `Run-ID: ${result.value.session.sessionId}`,
    );
  });

  test("holds optional nodes until the manager explicitly executes them", async () => {
    const root = await makeTempDir();
    const workflowName = "optional-execute";
    await createOptionalExecutionFixture(root, workflowName);

    const result = await runWorkflow(
      workflowName,
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        sessionId: "sess-optional-execute",
      },
      new ScenarioNodeAdapter({
        "divedra-manager": [
          { payload: {} },
          {
            payload: {
              managerControl: {
                actions: [
                  { type: "execute-optional-node", nodeId: "step-1" },
                ],
              },
            },
          },
        ],
        "step-1": {
          payload: { summary: "optional executed" },
        },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.exitCode).toBe(0);
    expect(result.value.session.status).toBe("completed");
    expect(result.value.session.pendingOptionalNodeDecisions).toEqual([]);

    const managerExecutions = result.value.session.nodeExecutions.filter(
      (entry) => entry.nodeId === "divedra-manager",
    );
    expect(managerExecutions).toHaveLength(2);

    const stepExecution = result.value.session.nodeExecutions.find(
      (entry) => entry.nodeId === "step-1",
    );
    expect(stepExecution?.status).toBe("succeeded");
    if (stepExecution === undefined) {
      return;
    }

    const stepOutput = JSON.parse(
      await readFile(path.join(stepExecution.artifactDir, "output.json"), "utf8"),
    ) as { payload: { summary: string } };
    expect(stepOutput.payload.summary).toBe("optional executed");
  });

  test("records explicit skipped status when the manager skips an optional node", async () => {
    const root = await makeTempDir();
    const workflowName = "optional-skip";
    await createOptionalExecutionFixture(root, workflowName);

    const result = await runWorkflow(
      workflowName,
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        sessionId: "sess-optional-skip",
      },
      new OptionalDecisionAdapter(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.exitCode).toBe(0);
    expect(result.value.session.status).toBe("completed");
    expect(result.value.session.pendingOptionalNodeDecisions).toEqual([]);

    const managerExecutions = result.value.session.nodeExecutions.filter(
      (entry) => entry.nodeId === "divedra-manager",
    );
    expect(managerExecutions).toHaveLength(2);

    const stepExecution = result.value.session.nodeExecutions.find(
      (entry) => entry.nodeId === "step-1",
    );
    expect(stepExecution?.status).toBe("skipped");
    if (stepExecution === undefined) {
      return;
    }

    const outputJson = JSON.parse(
      await readFile(path.join(stepExecution.artifactDir, "output.json"), "utf8"),
    ) as { payload: { optionalNodeSkipped: boolean; reason: string } };
    expect(outputJson.payload.optionalNodeSkipped).toBe(true);
    expect(outputJson.payload.reason).toBe("manager judged unnecessary");

    const metaJson = JSON.parse(
      await readFile(path.join(stepExecution.artifactDir, "meta.json"), "utf8"),
    ) as { status: string; optionalDecision: string };
    expect(metaJson.status).toBe("skipped");
    expect(metaJson.optionalDecision).toBe("skip");
  });

  test("preserves the manager-provided reason when skipping an optional node", async () => {
    const root = await makeTempDir();
    const workflowName = "optional-skip-reason";
    await createOptionalExecutionFixture(root, workflowName);

    const result = await runWorkflow(
      workflowName,
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        sessionId: "sess-optional-skip-reason",
      },
      new ScenarioNodeAdapter({
        "divedra-manager": [
          { payload: {} },
          {
            payload: {
              managerControl: {
                actions: [
                  {
                    type: "skip-optional-node",
                    nodeId: "step-1",
                    reason: "already satisfied by upstream evidence",
                  },
                ],
              },
            },
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const stepExecution = result.value.session.nodeExecutions.find(
      (entry) => entry.nodeId === "step-1",
    );
    expect(stepExecution?.status).toBe("skipped");
    if (stepExecution === undefined) {
      return;
    }

    const outputJson = JSON.parse(
      await readFile(path.join(stepExecution.artifactDir, "output.json"), "utf8"),
    ) as { payload: { optionalNodeSkipped: boolean; reason: string } };
    expect(outputJson.payload.optionalNodeSkipped).toBe(true);
    expect(outputJson.payload.reason).toBe(
      "already satisfied by upstream evidence",
    );
  });

  test("pauses on user-action nodes and remains paused on resume until resolved", async () => {
    const root = await makeTempDir();
    const workflowName = "user-action-pause";
    await createUserActionFixture(root, workflowName);

    const first = await runWorkflow(
      workflowName,
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        sessionId: "sess-user-action-pause",
      },
      deterministicAdapter,
    );

    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }

    expect(first.value.exitCode).toBe(4);
    expect(first.value.session.status).toBe("paused");
    expect(first.value.session.currentNodeId).toBe("approval");
    expect(first.value.session.nodeExecutionCounter).toBe(2);
    expect(first.value.session.nodeExecutions).toHaveLength(1);
    expect(first.value.session.activeUserActions).toHaveLength(1);

    const activeUserAction = first.value.session.activeUserActions?.[0];
    expect(activeUserAction?.nodeId).toBe("approval");
    expect(activeUserAction?.status).toBe("waiting-for-reply");
    if (activeUserAction === undefined) {
      return;
    }

    const approvalArtifactDir = path.dirname(activeUserAction.artifactDir);
    const approvalInput = JSON.parse(
      await readFile(path.join(approvalArtifactDir, "input.json"), "utf8"),
    ) as { nodeType: string; promptText: string };
    expect(approvalInput.nodeType).toBe("user-action");
    expect(approvalInput.promptText).toContain("Please approve the release.");

    const requestJson = JSON.parse(
      await readFile(path.join(activeUserAction.artifactDir, "request.json"), "utf8"),
    ) as { status: string; userAction: { messageToolIds: readonly string[] } };
    const resolutionJson = JSON.parse(
      await readFile(
        path.join(activeUserAction.artifactDir, "resolution.json"),
        "utf8",
      ),
    ) as { status: string };
    expect(requestJson.status).toBe("waiting-for-reply");
    expect(requestJson.userAction.messageToolIds).toEqual(["matrix-primary"]);
    expect(resolutionJson.status).toBe("waiting-for-reply");

    const resumed = await runWorkflow(
      workflowName,
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        resumeSessionId: first.value.session.sessionId,
      },
      deterministicAdapter,
    );

    expect(resumed.ok).toBe(true);
    if (!resumed.ok) {
      return;
    }

    expect(resumed.value.exitCode).toBe(4);
    expect(resumed.value.session.status).toBe("paused");
    expect(resumed.value.session.activeUserActions).toHaveLength(1);
    expect(resumed.value.session.nodeExecutionCounter).toBe(2);
    expect(resumed.value.session.nodeExecutions).toHaveLength(1);
  });

  test("fails container node execution when the configured runner is unavailable", async () => {
    const root = await makeTempDir();
    const workflowName = "podman-isolation-unsupported";
    await createWorkflowFixture(root, workflowName, false);
    await writeJson(path.join(root, workflowName, "node-step-1.json"), {
      id: "step-1",
      nodeType: "container",
      variables: {},
      container: {
        runnerKind: "podman",
        runnerPath: "/definitely/missing/podman",
        image: "ghcr.io/example/step-1:latest",
      },
    });

    const result = await runWorkflow(
      workflowName,
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
      },
      deterministicAdapter,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toContain("adapter failure at 'step-1'");
  });

  test("reuses a node-local backend session across repeated executions in one workflow run", async () => {
    const root = await makeTempDir();
    await createNodeSessionReuseFixture(root, "node-session-reuse");
    const adapter = new ReusableSessionAdapter();

    const result = await runWorkflow(
      "node-session-reuse",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
      },
      adapter,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const bCalls = adapter.calls.filter((entry) => entry.nodeId === "step-b");
    expect(bCalls).toHaveLength(2);
    expect(bCalls[0]?.backendSession).toEqual({ mode: "new" });
    expect(bCalls[1]?.backendSession).toEqual({
      mode: "reuse",
      sessionId: "backend-b-1",
    });
    expect(
      result.value.session.nodeBackendSessions?.["step-b"]?.sessionId,
    ).toBe("backend-b-1");

    const bExecutions = result.value.session.nodeExecutions.filter(
      (entry) => entry.nodeId === "step-b",
    );
    expect(bExecutions).toHaveLength(2);
    expect(bExecutions[0]?.backendSessionMode).toBe("new");
    expect(bExecutions[0]?.backendSessionId).toBe("backend-b-1");
    expect(bExecutions[1]?.backendSessionMode).toBe("reuse");
    expect(bExecutions[1]?.backendSessionId).toBe("backend-b-1");
  });

  test("preserves reusable node backend sessions across workflow resume", async () => {
    const root = await makeTempDir();
    await createNodeSessionReuseFixture(root, "node-session-resume");
    const firstAdapter = new ReusableSessionAdapter();

    const first = await runWorkflow(
      "node-session-resume",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        maxSteps: 3,
      },
      firstAdapter,
    );

    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.value.session.status).toBe("paused");
    expect(first.value.session.nodeBackendSessions?.["step-b"]?.sessionId).toBe(
      "backend-b-1",
    );

    const resumedAdapter = new ReusableSessionAdapter();
    const resumed = await runWorkflow(
      "node-session-resume",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        resumeSessionId: first.value.session.sessionId,
      },
      resumedAdapter,
    );

    expect(resumed.ok).toBe(true);
    if (!resumed.ok) {
      return;
    }

    const resumedBCalls = resumedAdapter.calls.filter(
      (entry) => entry.nodeId === "step-b",
    );
    expect(resumedBCalls).toHaveLength(1);
    expect(resumedBCalls[0]?.backendSession).toEqual({
      mode: "reuse",
      sessionId: "backend-b-1",
    });
    expect(resumed.value.session.status).toBe("completed");
    expect(
      resumed.value.session.nodeBackendSessions?.["step-b"]?.sessionId,
    ).toBe("backend-b-1");
  });

  test("forwards explicit new session policy without persisting a reusable backend session", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "explicit-new-session-policy", false);

    await writeJson(
      path.join(root, "explicit-new-session-policy", "node-step-1.json"),
      {
        id: "step-1",
        executionBackend: "claude-code-agent",
        model: "claude-opus-4-1",
        sessionPolicy: {
          mode: "new",
        },
        promptTemplate: "step {{topic}}",
        variables: {},
      },
    );

    const adapter = new ExplicitNewSessionPolicyAdapter();
    const result = await runWorkflow(
      "explicit-new-session-policy",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        runtimeVariables: { topic: "B" },
      },
      adapter,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const step1Calls = adapter.calls.filter(
      (entry) => entry.nodeId === "step-1",
    );
    expect(step1Calls).toEqual([
      { nodeId: "step-1", backendSession: { mode: "new" } },
    ]);

    const step1Exec = result.value.session.nodeExecutions.find(
      (entry) => entry.nodeId === "step-1",
    );
    expect(step1Exec?.backendSessionMode).toBe("new");
    expect(step1Exec?.backendSessionId).toBe("ephemeral-step-1-session");
    expect(
      result.value.session.nodeBackendSessions?.["step-1"],
    ).toBeUndefined();
  });

  test("preserves reusable backend sessions even when post-execution manager-control parsing fails", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "manager-session-failure", false);

    await writeJson(
      path.join(root, "manager-session-failure", "node-divedra-manager.json"),
      {
        id: "divedra-manager",
        executionBackend: "claude-code-agent",
        model: "claude-opus-4-1",
        sessionPolicy: {
          mode: "reuse",
        },
        promptTemplate: "manager",
        variables: {},
      },
    );

    const adapter = new InvalidManagerControlReusableSessionAdapter();
    const result = await runWorkflow(
      "manager-session-failure",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        sessionId: "sess-manager-session-failure",
      },
      adapter,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    const saved = await loadSession("sess-manager-session-failure", {
      sessionStoreRoot: path.join(root, "sessions"),
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) {
      return;
    }
    expect(saved.value.status).toBe("failed");
    expect(saved.value.nodeExecutions).toHaveLength(1);
    expect(saved.value.nodeExecutions[0]).toMatchObject({
      nodeId: "divedra-manager",
      nodeExecId: "exec-000001",
      status: "failed",
      backendSessionMode: "new",
      backendSessionId: "backend-manager-1",
    });
    expect(saved.value.nodeBackendSessions?.["divedra-manager"]).toMatchObject({
      nodeId: "divedra-manager",
      sessionId: "backend-manager-1",
      lastNodeExecId: "exec-000001",
    });
  });

  test("mints and expires manager GraphQL context only for manager-node executions", async () => {
    const root = await makeTempDir();
    const workflowName = "manager-session-runtime";
    await createWorkflowFixture(root, workflowName, false);

    const adapter = new ManagerAmbientContextCaptureAdapter();
    const result = await runWorkflow(
      workflowName,
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        rootDataDir: path.join(root, "data"),
        cwd: root,
      },
      adapter,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(adapter.calls).toHaveLength(2);
    expect(adapter.calls[0]?.nodeId).toBe("divedra-manager");
    expect(adapter.calls[0]?.ambientManagerContext?.environment).toMatchObject({
      DIVEDRA_GRAPHQL_ENDPOINT: "http://127.0.0.1:43173/graphql",
      DIVEDRA_MANAGER_SESSION_ID: "mgrsess-exec-000001",
      DIVEDRA_WORKFLOW_ID: workflowName,
      DIVEDRA_WORKFLOW_EXECUTION_ID: result.value.session.sessionId,
      DIVEDRA_MANAGER_NODE_ID: "divedra-manager",
      DIVEDRA_MANAGER_NODE_EXEC_ID: "exec-000001",
    });
    expect(adapter.calls[1]?.nodeId).toBe("step-1");
    expect(adapter.calls[1]?.ambientManagerContext).toBeUndefined();

    const managerAuthToken =
      adapter.calls[0]?.ambientManagerContext?.environment
        .DIVEDRA_MANAGER_AUTH_TOKEN;
    expect(managerAuthToken).toBeDefined();
    if (managerAuthToken === undefined) {
      throw new Error("manager auth token was not captured");
    }

    const store = createManagerSessionStore({
      cwd: root,
      rootDataDir: path.join(root, "data"),
    });
    const persisted = await store.loadSession("mgrsess-exec-000001");
    expect(persisted).not.toBeNull();
    expect(persisted?.status).toBe("completed");
    expect(persisted?.authTokenHash).not.toBe(managerAuthToken);
    expect(
      await store.validateAuthToken({
        managerSessionId: "mgrsess-exec-000001",
        authToken: managerAuthToken,
        ...(persisted?.authTokenExpiresAt === undefined
          ? {}
          : { now: persisted.authTokenExpiresAt }),
      }),
    ).toBeNull();
  });

  test("fails a manager step that mixes GraphQL manager messages with payload managerControl", async () => {
    const root = await makeTempDir();
    const workflowName = "manager-mixed-control-mode";
    await createWorkflowFixture(root, workflowName, false);

    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
      sessionId: "sess-manager-mixed-control-mode",
    };
    const store = createManagerSessionStore({
      cwd: root,
      rootDataDir: path.join(root, "data"),
    });
    await store.createOrResumeSession({
      managerSessionId: "mgrsess-exec-000001",
      workflowId: workflowName,
      workflowExecutionId: "sess-manager-mixed-control-mode",
      managerNodeId: "divedra-manager",
      managerNodeExecId: "exec-000001",
      status: "active",
      createdAt: "2026-03-15T00:00:00.000Z",
      updatedAt: "2026-03-15T00:00:00.000Z",
      controlMode: "graphql-manager-message",
      authTokenHash: "preexisting-hash",
      authTokenExpiresAt: "2026-03-16T00:00:00.000Z",
    });

    const result = await runWorkflow(
      workflowName,
      options,
      new ScenarioNodeAdapter({
        "divedra-manager": {
          payload: {
            managerControl: {
              actions: [{ type: "retry-node", nodeId: "step-1" }],
            },
          },
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.exitCode).toBe(5);
    expect(result.error.message).toContain(
      "cannot mix GraphQL manager messages with payload managerControl",
    );

    const persisted = await store.loadSession("mgrsess-exec-000001");
    expect(persisted?.status).toBe("failed");
    expect(persisted?.controlMode).toBe("graphql-manager-message");
  });

  test("delivers root human input through an external mailbox communication", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "root-mailbox-input", false);

    const result = await runWorkflow(
      "root-mailbox-input",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        runtimeVariables: {
          topic: "B",
          humanInput: {
            request: "ship release B",
            constraints: ["tests", "review"],
          },
        },
      },
      deterministicAdapter,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const bootstrapCommunication = result.value.session.communications.find(
      (entry) =>
        entry.fromNodeId === "__workflow-input-mailbox__" &&
        entry.toNodeId === "divedra-manager" &&
        entry.deliveryKind === "external-input",
    );
    expect(bootstrapCommunication).toBeDefined();
    if (bootstrapCommunication === undefined) {
      return;
    }

    const managerExec = result.value.session.nodeExecutions.find(
      (entry) => entry.nodeId === "divedra-manager",
    );
    expect(managerExec).toBeDefined();
    if (managerExec === undefined) {
      return;
    }

    const managerInputRaw = await readFile(
      path.join(managerExec.artifactDir, "input.json"),
      "utf8",
    );
    const managerInput = JSON.parse(managerInputRaw) as {
      upstreamOutputRefs: readonly { fromNodeId: string }[];
      upstreamCommunications: readonly string[];
      promptText: string;
    };
    expect(
      managerInput.upstreamOutputRefs.some(
        (entry) => entry.fromNodeId === "__workflow-input-mailbox__",
      ),
    ).toBe(true);
    expect(managerInput.upstreamCommunications).toContain(
      bootstrapCommunication.communicationId,
    );
    expect(managerInput.promptText).toContain('"request":"ship release B"');

    const receiptRaw = await readFile(
      path.join(
        bootstrapCommunication.artifactDir,
        "attempts",
        bootstrapCommunication.activeDeliveryAttemptId ?? "attempt-000001",
        "receipt.json",
      ),
      "utf8",
    );
    const receiptJson = JSON.parse(receiptRaw) as { deliveredByNodeId: string };
    expect(receiptJson.deliveredByNodeId).toBe("divedra-manager");

    const sourceOutputRaw = await readFile(
      path.join(
        root,
        "artifacts",
        "root-mailbox-input",
        "executions",
        result.value.session.sessionId,
        "external-mailbox",
        "input",
        "output.json",
      ),
      "utf8",
    );
    const mailboxOutputRaw = await readFile(
      path.join(
        bootstrapCommunication.artifactDir,
        "outbox",
        "__workflow-input-mailbox__",
        "output.json",
      ),
      "utf8",
    );
    expect(mailboxOutputRaw).toBe(sourceOutputRaw);
  });

  test("normalizes plain-text human input to canonical text objects", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "root-human-input-text", false);

    const result = await runWorkflow(
      "root-human-input-text",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        runtimeVariables: {
          topic: "B",
          humanInput: "ship release B",
        },
      },
      deterministicAdapter,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const managerExec = result.value.session.nodeExecutions.find(
      (entry) => entry.nodeId === "divedra-manager",
    );
    expect(managerExec).toBeDefined();
    if (managerExec === undefined) {
      return;
    }

    const mailboxInput = JSON.parse(
      await readFile(
        path.join(managerExec.artifactDir, "mailbox", "inbox", "input.json"),
        "utf8",
      ),
    ) as {
      readonly humanInput?: { readonly text?: string };
    };
    expect(mailboxInput.humanInput).toEqual({ text: "ship release B" });

    const externalOutput = JSON.parse(
      await readFile(
        path.join(
          root,
          "artifacts",
          "root-human-input-text",
          "executions",
          result.value.session.sessionId,
          "external-mailbox",
          "input",
          "output.json",
        ),
        "utf8",
      ),
    ) as { payload: { text?: string } };
    expect(externalOutput.payload).toEqual({ text: "ship release B" });
  });

  test("publishes the completed workflow result to an external mailbox", async () => {
    const root = await makeTempDir();
    await createSingleRootOutputFixture(root, "root-mailbox-output");

    const result = await runWorkflow(
      "root-mailbox-output",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        runtimeVariables: { topic: "B" },
      },
      deterministicAdapter,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const outputCommunication = result.value.session.communications.find(
      (entry) =>
        entry.toNodeId === "__workflow-output-mailbox__" &&
        entry.deliveryKind === "external-output" &&
        entry.fromNodeId === "workflow-output",
    );
    expect(outputCommunication).toBeDefined();
    if (outputCommunication === undefined) {
      return;
    }

    const outputRaw = await readFile(
      path.join(
        outputCommunication.artifactDir,
        "outbox",
        "workflow-output",
        "output.json",
      ),
      "utf8",
    );
    const outputJson = JSON.parse(outputRaw) as { payload: { nodeId: string } };
    expect(outputJson.payload.nodeId).toBe("workflow-output");

    const receiptRaw = await readFile(
      path.join(
        outputCommunication.artifactDir,
        "attempts",
        outputCommunication.activeDeliveryAttemptId ?? "attempt-000001",
        "receipt.json",
      ),
      "utf8",
    );
    const receiptJson = JSON.parse(receiptRaw) as { deliveredByNodeId: string };
    expect(receiptJson.deliveredByNodeId).toBe("divedra-manager");

    const publishedExec = result.value.session.nodeExecutions.find(
      (entry) => entry.nodeId === "workflow-output",
    );
    expect(publishedExec).toBeDefined();
    if (publishedExec === undefined) {
      return;
    }
    const sourceOutputRaw = await readFile(
      path.join(publishedExec.artifactDir, "output.json"),
      "utf8",
    );
    expect(outputRaw).toBe(sourceOutputRaw);
  });

  test("publishes the latest root output node result when a manager runs again afterward", async () => {
    const root = await makeTempDir();
    await createManagerAfterOutputFixture(root, "root-output-publication");

    const result = await runWorkflow(
      "root-output-publication",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
      },
      new ScenarioNodeAdapter({
        "divedra-manager": [
          {
            provider: "scenario-mock",
            when: { needs_output: true },
            payload: { phase: "plan" },
          },
          { provider: "scenario-mock", when: {}, payload: { phase: "assess" } },
        ],
        "workflow-output": {
          provider: "scenario-mock",
          when: { always: true },
          payload: { final: "published-result" },
        },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const outputCommunication = result.value.session.communications.find(
      (entry) =>
        entry.toNodeId === "__workflow-output-mailbox__" &&
        entry.deliveryKind === "external-output",
    );
    expect(outputCommunication).toBeDefined();
    if (outputCommunication === undefined) {
      return;
    }

    expect(outputCommunication.fromNodeId).toBe("workflow-output");
    const outputRaw = await readFile(
      path.join(
        outputCommunication.artifactDir,
        "outbox",
        "workflow-output",
        "output.json",
      ),
      "utf8",
    );
    const outputJson = JSON.parse(outputRaw) as { payload: { final: string } };
    expect(outputJson.payload.final).toBe("published-result");
  });

  test("publishes the later root output node result when multiple root output executions succeed", async () => {
    const root = await makeTempDir();
    await createMultipleRootOutputsFixture(root, "multiple-root-outputs");

    const result = await runWorkflow(
      "multiple-root-outputs",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
      },
      new ScenarioNodeAdapter({
        "divedra-manager": {
          provider: "scenario-mock",
          when: { always: true },
          payload: { stage: "dispatch" },
        },
        "first-output": {
          provider: "scenario-mock",
          when: { always: true },
          payload: { final: "first" },
        },
        "second-output": {
          provider: "scenario-mock",
          when: { always: true },
          payload: { final: "second" },
        },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const outputCommunication = result.value.session.communications.find(
      (entry) =>
        entry.toNodeId === "__workflow-output-mailbox__" &&
        entry.deliveryKind === "external-output",
    );
    expect(outputCommunication).toBeDefined();
    if (outputCommunication === undefined) {
      return;
    }

    expect(outputCommunication.fromNodeId).toBe("second-output");
    const outputRaw = await readFile(
      path.join(
        outputCommunication.artifactDir,
        "outbox",
        "second-output",
        "output.json",
      ),
      "utf8",
    );
    const outputJson = JSON.parse(outputRaw) as { payload: { final: string } };
    expect(outputJson.payload.final).toBe("second");
    expect(result.value.session.runtimeVariables["workflowOutput"]).toEqual({
      final: "second",
    });
  });

  test("keeps the latest root output publication source when a later non-output worker runs", async () => {
    const root = await makeTempDir();
    await createRootOutputThenTaskFixture(root, "root-output-then-task");

    const result = await runWorkflow(
      "root-output-then-task",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
      },
      new ScenarioNodeAdapter({
        "divedra-manager": {
          provider: "scenario-mock",
          when: { always: true },
          payload: { stage: "dispatch" },
        },
        "workflow-output": {
          provider: "scenario-mock",
          when: { always: true },
          payload: { final: "published" },
        },
        "final-task": {
          provider: "scenario-mock",
          when: { always: true },
          payload: { final: "not-publishable" },
        },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.session.nodeExecutions.at(-1)?.nodeId).toBe(
      "final-task",
    );
    const outputCommunication = result.value.session.communications.find(
      (entry) =>
        entry.toNodeId === "__workflow-output-mailbox__" &&
        entry.deliveryKind === "external-output",
    );
    expect(outputCommunication).toBeDefined();
    if (outputCommunication === undefined) {
      return;
    }

    expect(outputCommunication.fromNodeId).toBe("workflow-output");
    const outputRaw = await readFile(
      path.join(
        outputCommunication.artifactDir,
        "outbox",
        "workflow-output",
        "output.json",
      ),
      "utf8",
    );
    const outputJson = JSON.parse(outputRaw) as { payload: { final: string } };
    expect(outputJson.payload.final).toBe("published");
    expect(result.value.session.runtimeVariables["workflowOutput"]).toEqual({
      final: "published",
    });
  });

  test("does not publish an external output when no root output execution succeeds", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "no-root-output-publication", false);

    const result = await runWorkflow(
      "no-root-output-publication",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
      },
      deterministicAdapter,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.session.status).toBe("completed");
    expect(
      result.value.session.communications.some(
        (entry) =>
          entry.toNodeId === "__workflow-output-mailbox__" &&
          entry.deliveryKind === "external-output",
      ),
    ).toBe(false);
    expect(
      result.value.session.runtimeVariables["workflowOutput"],
    ).toBeUndefined();
  });

  test("enables workflow-output input sources after a root output node succeeds", async () => {
    const root = await makeTempDir();
    await createWorkflowOutputDrivenSubWorkflowFixture(
      root,
      "workflow-output-source",
    );

    const result = await runWorkflow(
      "workflow-output-source",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
      },
      new ScenarioNodeAdapter({
        "divedra-manager": [
          {
            provider: "scenario-mock",
            when: { needs_output: true },
            payload: { phase: "plan" },
          },
          { provider: "scenario-mock", when: {}, payload: { phase: "assess" } },
        ],
        "workflow-output": {
          provider: "scenario-mock",
          when: { always: true },
          payload: { final: "root-output" },
        },
        "review-manager": {
          provider: "scenario-mock",
          when: { always: true },
          payload: { stage: "review-dispatch" },
        },
        "review-input": {
          provider: "scenario-mock",
          when: { always: true },
          payload: { stage: "review-input" },
        },
        "review-output": {
          provider: "scenario-mock",
          when: { always: true },
          payload: { stage: "review-output" },
        },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.session.runtimeVariables["workflowOutput"]).toEqual({
      final: "root-output",
    });
    expect(
      result.value.session.nodeExecutions.some(
        (entry) => entry.nodeId === "review-manager",
      ),
    ).toBe(true);
    expect(
      result.value.session.nodeExecutions.some(
        (entry) => entry.nodeId === "review-input",
      ),
    ).toBe(true);
    expect(
      result.value.session.nodeExecutions.some(
        (entry) => entry.nodeId === "review-output",
      ),
    ).toBe(true);
  });

  test("composes manager and worker prompts with workflow-level orchestration context", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "prompt-composition", false);

    const workflowPath = path.join(root, "prompt-composition", "workflow.json");
    const workflowJson = JSON.parse(
      await readFile(workflowPath, "utf8"),
    ) as Record<string, unknown>;
    workflowJson["prompts"] = {
      divedraPromptTemplate: "Plan and audit work for {{topic}}.",
      workerSystemPromptTemplate:
        "Complete the assigned worker step for {{topic}}.",
    };
    await writeJson(workflowPath, workflowJson);

    const result = await runWorkflow(
      "prompt-composition",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        runtimeVariables: { topic: "B" },
      },
      deterministicAdapter,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const managerExec = result.value.session.nodeExecutions.find(
      (entry) => entry.nodeId === "divedra-manager",
    );
    const workerExec = result.value.session.nodeExecutions.find(
      (entry) => entry.nodeId === "step-1",
    );
    expect(managerExec).toBeDefined();
    expect(workerExec).toBeDefined();
    if (managerExec === undefined || workerExec === undefined) {
      return;
    }

    const managerInputRaw = await readFile(
      path.join(managerExec.artifactDir, "input.json"),
      "utf8",
    );
    const workerInputRaw = await readFile(
      path.join(workerExec.artifactDir, "input.json"),
      "utf8",
    );
    const managerInput = JSON.parse(managerInputRaw) as {
      promptText: string;
      systemPromptText?: string;
    };
    const workerInput = JSON.parse(workerInputRaw) as {
      promptText: string;
      systemPromptText?: string;
    };

    expect(managerInput.systemPromptText).toContain(
      "You are `divedra`, the orchestration manager",
    );
    expect(managerInput.systemPromptText).toContain("Plan and audit work for B.");
    expect(managerInput.promptText).toContain("Execution context:");
    expect(managerInput.promptText).toContain("Given data:");
    expect(managerInput.promptText).toContain("Manager control payload:");
    expect(managerInput.promptText).toContain('"type":"start-sub-workflow"');
    expect(managerInput.promptText).toContain("Node-specific instruction:");
    expect(managerInput.promptText).toContain("manager B");

    expect(workerInput.systemPromptText).toContain(
      "Complete the assigned worker step for B.",
    );
    expect(workerInput.promptText).toContain("Given data:");
    expect(workerInput.promptText).toContain("Reason this node is running:");
    expect(workerInput.promptText).toContain("Expected return:");
    expect(workerInput.promptText).toContain("step B");
  });

  test("assembles node arguments from runtime variables and upstream outputs", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "assembled-input", false);

    await writeJson(path.join(root, "assembled-input", "node-step-1.json"), {
      id: "step-1",
      executionBackend: "claude-code-agent",
      model: "claude-opus-4-1",
      promptTemplate: "step {{topic}}",
      variables: {},
      argumentsTemplate: { task: { topic: "", managerNode: "" } },
      argumentBindings: [
        {
          targetPath: "task.topic",
          source: "variables",
          sourcePath: "topic",
          required: true,
        },
        {
          targetPath: "task.managerNode",
          source: "node-output",
          sourceRef: "divedra-manager",
          sourcePath: "output.payload.nodeId",
          required: true,
        },
      ],
    });

    const result = await runWorkflow(
      "assembled-input",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        runtimeVariables: { topic: "B" },
      },
      deterministicAdapter,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const step1Exec = result.value.session.nodeExecutions.find(
      (entry) => entry.nodeId === "step-1",
    );
    expect(step1Exec).toBeDefined();
    if (step1Exec === undefined) {
      return;
    }

    const inputRaw = await readFile(
      path.join(step1Exec.artifactDir, "input.json"),
      "utf8",
    );
    const inputJson = JSON.parse(inputRaw) as {
      arguments: { task: { topic: string; managerNode: string } } | null;
    };
    expect(inputJson.arguments).toEqual({
      task: {
        topic: "B",
        managerNode: "divedra-manager",
      },
    });
  });

  test("retries invalid node payloads until output schema validation succeeds", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "output-contract-retry", false);

    await writeJson(
      path.join(root, "output-contract-retry", "node-step-1.json"),
      {
        id: "step-1",
        executionBackend: "claude-code-agent",
        model: "claude-opus-4-1",
        promptTemplate: "step {{topic}}",
        variables: {},
        output: {
          description: "Return a structured summary object.",
          maxValidationAttempts: 2,
          jsonSchema: {
            type: "object",
            required: ["summary"],
            additionalProperties: false,
            properties: {
              summary: { type: "string", minLength: 1 },
            },
          },
        },
      },
    );

    const result = await runWorkflow(
      "output-contract-retry",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        runtimeVariables: { topic: "B" },
      },
      new OutputContractRetryAdapter("retry-success"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const step1Exec = result.value.session.nodeExecutions.find(
      (entry) => entry.nodeId === "step-1",
    );
    expect(step1Exec).toBeDefined();
    if (step1Exec === undefined) {
      return;
    }
    expect(step1Exec.outputAttemptCount).toBe(2);
    expect(step1Exec.outputValidationErrors).toBeUndefined();

    const outputRaw = await readFile(
      path.join(step1Exec.artifactDir, "output.json"),
      "utf8",
    );
    const outputJson = JSON.parse(outputRaw) as {
      payload: { summary: string };
    };
    expect(outputJson.payload.summary).toBe("valid output");

    const firstValidationRaw = await readFile(
      path.join(
        step1Exec.artifactDir,
        "output-attempts",
        "attempt-000001",
        "validation.json",
      ),
      "utf8",
    );
    const firstValidationJson = JSON.parse(firstValidationRaw) as {
      valid: boolean;
      errors: readonly { path: string }[];
    };
    expect(firstValidationJson.valid).toBe(false);
    expect(firstValidationJson.errors[0]?.path).toBe("$.summary");

    const secondValidationRaw = await readFile(
      path.join(
        step1Exec.artifactDir,
        "output-attempts",
        "attempt-000002",
        "validation.json",
      ),
      "utf8",
    );
    const secondValidationJson = JSON.parse(secondValidationRaw) as {
      valid: boolean;
    };
    expect(secondValidationJson.valid).toBe(true);
  });

  test("reuses the latest backend session across output-contract retries", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "output-contract-session-retry", false);

    await writeJson(
      path.join(root, "output-contract-session-retry", "node-step-1.json"),
      {
        id: "step-1",
        executionBackend: "claude-code-agent",
        model: "claude-opus-4-1",
        sessionPolicy: {
          mode: "reuse",
        },
        promptTemplate: "step {{topic}}",
        variables: {},
        output: {
          description: "Return a structured summary object.",
          maxValidationAttempts: 2,
          jsonSchema: {
            type: "object",
            required: ["summary"],
            additionalProperties: false,
            properties: {
              summary: { type: "string", minLength: 1 },
            },
          },
        },
      },
    );

    const adapter = new OutputContractReusableSessionAdapter();
    const result = await runWorkflow(
      "output-contract-session-retry",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        runtimeVariables: { topic: "B" },
      },
      adapter,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(adapter.calls).toEqual([
      {
        attempt: 1,
        backendSession: { mode: "new" },
      },
      {
        attempt: 2,
        backendSession: { mode: "reuse", sessionId: "backend-step-1" },
      },
    ]);

    const step1Exec = result.value.session.nodeExecutions.find(
      (entry) => entry.nodeId === "step-1",
    );
    expect(step1Exec?.outputAttemptCount).toBe(2);
    expect(step1Exec?.backendSessionMode).toBe("new");
    expect(step1Exec?.backendSessionId).toBe("backend-step-1");
    expect(
      result.value.session.nodeBackendSessions?.["step-1"]?.sessionId,
    ).toBe("backend-step-1");
  });

  test("supports output-validation retry flows with scenario-mock sequences", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "output-contract-scenario-retry", false);

    await writeJson(
      path.join(root, "output-contract-scenario-retry", "node-step-1.json"),
      {
        id: "step-1",
        executionBackend: "claude-code-agent",
        model: "claude-opus-4-1",
        promptTemplate: "step {{topic}}",
        variables: {},
        output: {
          maxValidationAttempts: 2,
          jsonSchema: {
            type: "object",
            required: ["summary"],
            additionalProperties: false,
            properties: {
              summary: { type: "string", minLength: 1 },
            },
          },
        },
      },
    );

    const result = await runWorkflow(
      "output-contract-scenario-retry",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
      },
      new ScenarioNodeAdapter({
        "step-1": [
          {
            provider: "scenario-mock",
            when: { always: true },
            payload: { wrong: true },
          },
          {
            provider: "scenario-mock",
            when: { always: true },
            payload: { summary: "valid via scenario" },
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const step1Exec = result.value.session.nodeExecutions.find(
      (entry) => entry.nodeId === "step-1",
    );
    expect(step1Exec?.outputAttemptCount).toBe(2);

    const outputRaw = await readFile(
      path.join(step1Exec?.artifactDir ?? "", "output.json"),
      "utf8",
    );
    const outputJson = JSON.parse(outputRaw) as {
      payload: { summary: string };
    };
    expect(outputJson.payload.summary).toBe("valid via scenario");
  });

  test("retries malformed reserved candidate files before publishing output", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "output-contract-file-retry", false);

    await writeJson(
      path.join(root, "output-contract-file-retry", "node-step-1.json"),
      {
        id: "step-1",
        executionBackend: "claude-code-agent",
        model: "claude-opus-4-1",
        promptTemplate: "step {{topic}}",
        variables: {},
        output: {
          description: "Return a structured summary object.",
          maxValidationAttempts: 2,
          jsonSchema: {
            type: "object",
            required: ["summary"],
            additionalProperties: false,
            properties: {
              summary: { type: "string", minLength: 1 },
            },
          },
        },
      },
    );

    const result = await runWorkflow(
      "output-contract-file-retry",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        runtimeVariables: { topic: "B" },
      },
      new OutputContractMalformedCandidateFileAdapter(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const step1Exec = result.value.session.nodeExecutions.find(
      (entry) => entry.nodeId === "step-1",
    );
    expect(step1Exec?.outputAttemptCount).toBe(2);
    expect(step1Exec?.outputValidationErrors).toBeUndefined();
    if (step1Exec === undefined) {
      return;
    }

    const firstValidationRaw = await readFile(
      path.join(
        step1Exec.artifactDir,
        "output-attempts",
        "attempt-000001",
        "validation.json",
      ),
      "utf8",
    );
    const firstValidationJson = JSON.parse(firstValidationRaw) as {
      valid: boolean;
      errors: readonly { path: string; message: string }[];
    };
    expect(firstValidationJson.valid).toBe(false);
    expect(firstValidationJson.errors[0]?.path).toBe("$");
    expect(firstValidationJson.errors[0]?.message).toContain(
      "unable to read candidate file",
    );

    const outputRaw = await readFile(
      path.join(step1Exec.artifactDir, "output.json"),
      "utf8",
    );
    const outputJson = JSON.parse(outputRaw) as {
      payload: { summary: string };
    };
    expect(outputJson.payload.summary).toBe("fixed from file");
  });

  test("clears stale reserved candidate files before each attempt", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "output-contract-stale-candidate", false);
    await writeJson(
      path.join(root, "output-contract-stale-candidate", "node-step-1.json"),
      {
        id: "step-1",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "step stale file",
        variables: {},
        output: {
          description: "return a summary object",
          jsonSchema: {
            type: "object",
            required: ["summary"],
            additionalProperties: false,
            properties: {
              summary: { type: "string", minLength: 1 },
            },
          },
        },
      },
    );

    const sessionId = "sess-output-contract-stale-candidate";
    const firstRun = await runWorkflow(
      "output-contract-stale-candidate",
      {
        cwd: root,
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionId,
      },
      new OutputContractStaleCandidatePathAdapter("write"),
    );
    expect(firstRun.ok).toBe(true);

    const secondRun = await runWorkflow(
      "output-contract-stale-candidate",
      {
        cwd: root,
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionId,
      },
      new OutputContractStaleCandidatePathAdapter("reuse-without-write"),
    );
    expect(secondRun.ok).toBe(false);
    if (secondRun.ok) {
      return;
    }

    expect(secondRun.error.message).toContain("output validation failed");
    const sessionRaw = await readFile(
      path.join(getSessionStoreRoot({ cwd: root }), `${sessionId}.json`),
      "utf8",
    );
    const sessionJson = JSON.parse(sessionRaw) as {
      nodeExecutions: readonly { nodeId: string; artifactDir: string }[];
    };
    const stepExecution = sessionJson.nodeExecutions.find(
      (entry) => entry.nodeId === "step-1",
    );
    expect(stepExecution).toBeDefined();
    if (stepExecution === undefined) {
      return;
    }
    const outputRaw = await readFile(
      path.join(stepExecution.artifactDir, "output.json"),
      "utf8",
    );
    const outputJson = JSON.parse(outputRaw) as {
      error: string;
      validationErrors: readonly { message: string }[];
    };
    expect(outputJson.error).toBe("output_validation_failed");
    expect(outputJson.validationErrors[0]?.message).toContain(
      "unable to read candidate file",
    );
  });

  test("retries malformed structured outputs for description-only contracts", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(
      root,
      "output-contract-description-retry",
      false,
    );

    await writeJson(
      path.join(root, "output-contract-description-retry", "node-step-1.json"),
      {
        id: "step-1",
        executionBackend: "claude-code-agent",
        model: "claude-opus-4-1",
        promptTemplate: "step {{topic}}",
        variables: {},
        output: {
          description: "Return only the summary payload as a JSON object.",
          maxValidationAttempts: 2,
        },
      },
    );

    const result = await runWorkflow(
      "output-contract-description-retry",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        runtimeVariables: { topic: "B" },
      },
      new OutputContractInvalidOutputAdapter("retry-success"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const step1Exec = result.value.session.nodeExecutions.find(
      (entry) => entry.nodeId === "step-1",
    );
    expect(step1Exec?.outputAttemptCount).toBe(2);
    if (step1Exec === undefined) {
      return;
    }

    const firstValidationRaw = await readFile(
      path.join(
        step1Exec.artifactDir,
        "output-attempts",
        "attempt-000001",
        "validation.json",
      ),
      "utf8",
    );
    const firstValidationJson = JSON.parse(firstValidationRaw) as {
      valid: boolean;
      errors: readonly { path: string; message: string }[];
    };
    expect(firstValidationJson.valid).toBe(false);
    expect(firstValidationJson.errors[0]?.message).toContain(
      "top-level JSON object",
    );

    const outputRaw = await readFile(
      path.join(step1Exec.artifactDir, "output.json"),
      "utf8",
    );
    const outputJson = JSON.parse(outputRaw) as {
      payload: { summary: string };
    };
    expect(outputJson.payload.summary).toBe("valid after invalid-output retry");
  });

  test("uses non-schema retry wording for description-only output contracts", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(
      root,
      "output-contract-description-retry-text",
      false,
    );

    await writeJson(
      path.join(
        root,
        "output-contract-description-retry-text",
        "node-step-1.json",
      ),
      {
        id: "step-1",
        executionBackend: "claude-code-agent",
        model: "claude-opus-4-1",
        promptTemplate: "step {{topic}}",
        variables: {},
        output: {
          description: "Return only a structured JSON object.",
          maxValidationAttempts: 2,
        },
      },
    );

    const captureAdapter = new DescriptionOnlyRetryPromptCaptureAdapter();
    const result = await runWorkflow(
      "output-contract-description-retry-text",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
      },
      captureAdapter,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(captureAdapter.prompts).toHaveLength(2);
    const retryPrompt = captureAdapter.prompts[1] ?? "";
    expect(retryPrompt).toContain("Previous output was rejected:");
    expect(retryPrompt).toContain("Return a corrected JSON object.");
    expect(retryPrompt).not.toContain("satisfies the schema");
  });

  test("fails the node when output schema validation never succeeds", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "output-contract-fail", false);

    await writeJson(
      path.join(root, "output-contract-fail", "node-step-1.json"),
      {
        id: "step-1",
        executionBackend: "claude-code-agent",
        model: "claude-opus-4-1",
        promptTemplate: "step {{topic}}",
        variables: {},
        output: {
          maxValidationAttempts: 2,
          jsonSchema: {
            type: "object",
            required: ["summary"],
            additionalProperties: false,
            properties: {
              summary: { type: "string", minLength: 1 },
            },
          },
        },
      },
    );

    const result = await runWorkflow(
      "output-contract-fail",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        sessionId: "sess-output-contract-fail",
      },
      new OutputContractRetryAdapter("always-invalid"),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toContain("output validation failed");
    const outputRaw = await readFile(
      path.join(
        root,
        "artifacts",
        "output-contract-fail",
        "executions",
        "sess-output-contract-fail",
        "nodes",
        "step-1",
        "exec-000002",
        "output.json",
      ),
      "utf8",
    );
    const outputJson = JSON.parse(outputRaw) as {
      error: string;
      validationErrors: readonly { path: string }[];
    };
    expect(outputJson.error).toBe("output_validation_failed");
    expect(outputJson.validationErrors[0]?.path).toBe("$.summary");

    const failedSessionRaw = await readFile(
      path.join(root, "sessions", "sess-output-contract-fail.json"),
      "utf8",
    );
    const failedSessionJson = JSON.parse(failedSessionRaw) as {
      nodeExecutions: Array<{
        nodeId: string;
        outputAttemptCount?: number;
        outputValidationErrors?: readonly { path: string }[];
      }>;
    };
    const step1Exec = failedSessionJson.nodeExecutions.find(
      (entry) => entry.nodeId === "step-1",
    );
    expect(step1Exec?.outputAttemptCount).toBe(2);
    expect(step1Exec?.outputValidationErrors?.[0]?.path).toBe("$.summary");
  });

  test("retries invalid adapter output as contract feedback until a valid payload is submitted", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(
      root,
      "output-contract-invalid-output-retry",
      false,
    );

    await writeJson(
      path.join(
        root,
        "output-contract-invalid-output-retry",
        "node-step-1.json",
      ),
      {
        id: "step-1",
        executionBackend: "claude-code-agent",
        model: "claude-opus-4-1",
        promptTemplate: "step {{topic}}",
        variables: {},
        output: {
          description: "Return a structured summary object.",
          maxValidationAttempts: 2,
          jsonSchema: {
            type: "object",
            required: ["summary"],
            additionalProperties: false,
            properties: {
              summary: { type: "string", minLength: 1 },
            },
          },
        },
      },
    );

    const result = await runWorkflow(
      "output-contract-invalid-output-retry",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
      },
      new OutputContractInvalidOutputAdapter("retry-success"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const step1Exec = result.value.session.nodeExecutions.find(
      (entry) => entry.nodeId === "step-1",
    );
    expect(step1Exec?.outputAttemptCount).toBe(2);
    expect(step1Exec?.outputValidationErrors).toBeUndefined();

    const outputRaw = await readFile(
      path.join(step1Exec?.artifactDir ?? "", "output.json"),
      "utf8",
    );
    const outputJson = JSON.parse(outputRaw) as {
      payload: { summary: string };
    };
    expect(outputJson.payload.summary).toBe("valid after invalid-output retry");

    const firstValidationRaw = await readFile(
      path.join(
        step1Exec?.artifactDir ?? "",
        "output-attempts",
        "attempt-000001",
        "validation.json",
      ),
      "utf8",
    );
    const firstValidationJson = JSON.parse(firstValidationRaw) as {
      valid: boolean;
      errors: readonly { message: string }[];
    };
    expect(firstValidationJson.valid).toBe(false);
    expect(firstValidationJson.errors[0]?.message).toContain(
      "top-level JSON object",
    );
  });

  test("fails with output_validation_failed when invalid adapter output exhausts contract retries", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(
      root,
      "output-contract-invalid-output-fail",
      false,
    );

    await writeJson(
      path.join(
        root,
        "output-contract-invalid-output-fail",
        "node-step-1.json",
      ),
      {
        id: "step-1",
        executionBackend: "claude-code-agent",
        model: "claude-opus-4-1",
        promptTemplate: "step {{topic}}",
        variables: {},
        output: {
          description: "Return a structured summary object.",
          maxValidationAttempts: 2,
          jsonSchema: {
            type: "object",
            required: ["summary"],
            additionalProperties: false,
            properties: {
              summary: { type: "string", minLength: 1 },
            },
          },
        },
      },
    );

    const result = await runWorkflow(
      "output-contract-invalid-output-fail",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        sessionId: "sess-output-contract-invalid-output-fail",
      },
      new OutputContractInvalidOutputAdapter("always-invalid"),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toContain("output validation failed");

    const outputRaw = await readFile(
      path.join(
        root,
        "artifacts",
        "output-contract-invalid-output-fail",
        "executions",
        "sess-output-contract-invalid-output-fail",
        "nodes",
        "step-1",
        "exec-000002",
        "output.json",
      ),
      "utf8",
    );
    const outputJson = JSON.parse(outputRaw) as {
      error: string;
      validationErrors: readonly { message: string }[];
    };
    expect(outputJson.error).toBe("output_validation_failed");
    expect(outputJson.validationErrors[0]?.message).toContain(
      "top-level JSON object",
    );
  });

  test("does not report output validation failure after a later provider failure", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(
      root,
      "output-contract-provider-fail-after-retry",
      false,
    );

    await writeJson(
      path.join(
        root,
        "output-contract-provider-fail-after-retry",
        "node-step-1.json",
      ),
      {
        id: "step-1",
        executionBackend: "claude-code-agent",
        model: "claude-opus-4-1",
        promptTemplate: "step {{topic}}",
        variables: {},
        output: {
          maxValidationAttempts: 2,
          jsonSchema: {
            type: "object",
            required: ["summary"],
            additionalProperties: false,
            properties: {
              summary: { type: "string", minLength: 1 },
            },
          },
        },
      },
    );

    const result = await runWorkflow(
      "output-contract-provider-fail-after-retry",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        sessionId: "sess-output-contract-provider-fail-after-retry",
      },
      new OutputContractInvalidThenProviderErrorAdapter(),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.message).toContain("adapter failure");

    const outputRaw = await readFile(
      path.join(
        root,
        "artifacts",
        "output-contract-provider-fail-after-retry",
        "executions",
        "sess-output-contract-provider-fail-after-retry",
        "nodes",
        "step-1",
        "exec-000002",
        "output.json",
      ),
      "utf8",
    );
    const outputJson = JSON.parse(outputRaw) as {
      error: string;
      promptText: string;
      validationErrors?: readonly { path: string }[];
    };
    expect(outputJson.error).toBe("provider_error");
    expect(outputJson.promptText).toContain("Execution context:");
    expect(outputJson.promptText).toContain("Node-specific instruction:\nstep");
    expect(outputJson.validationErrors).toBeUndefined();

    const failedSessionRaw = await readFile(
      path.join(
        root,
        "sessions",
        "sess-output-contract-provider-fail-after-retry.json",
      ),
      "utf8",
    );
    const failedSessionJson = JSON.parse(failedSessionRaw) as {
      nodeExecutions: Array<{
        nodeId: string;
        outputAttemptCount?: number;
        outputValidationErrors?: readonly { path: string }[];
      }>;
    };
    const step1Exec = failedSessionJson.nodeExecutions.find(
      (entry) => entry.nodeId === "step-1",
    );
    expect(step1Exec?.outputAttemptCount).toBe(2);
    expect(step1Exec?.outputValidationErrors).toBeUndefined();
  });

  test("keeps output-contract execution metadata out of published output artifacts", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "output-contract-prompt", false);

    await writeJson(
      path.join(root, "output-contract-prompt", "node-step-1.json"),
      {
        id: "step-1",
        executionBackend: "claude-code-agent",
        model: "claude-opus-4-1",
        promptTemplate: "step {{topic}}",
        variables: {},
        output: {
          description: "Return a structured summary object.",
          jsonSchema: {
            type: "object",
            required: ["summary"],
            additionalProperties: false,
            properties: {
              summary: { type: "string", minLength: 1 },
            },
          },
        },
      },
    );

    const result = await runWorkflow(
      "output-contract-prompt",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
      },
      new OutputContractRetryAdapter("retry-success"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const step1Exec = result.value.session.nodeExecutions.find(
      (entry) => entry.nodeId === "step-1",
    );
    expect(step1Exec).toBeDefined();
    if (step1Exec === undefined) {
      return;
    }

    const inputRaw = await readFile(
      path.join(step1Exec.artifactDir, "input.json"),
      "utf8",
    );
    const inputJson = JSON.parse(inputRaw) as {
      promptText: string;
      outputContract?: Record<string, unknown>;
    };
    expect(inputJson.outputContract).toEqual({
      description: "Return a structured summary object.",
      jsonSchema: {
        type: "object",
        required: ["summary"],
        additionalProperties: false,
        properties: {
          summary: { type: "string", minLength: 1 },
        },
      },
      maxValidationAttempts: 3,
      publication: {
        owner: "runtime",
        finalArtifactWrite: "runtime-only",
        mailboxWrite: "runtime-only-after-validation",
        candidateSubmission: "inline-json-or-reserved-candidate-file",
        futureCommunicationIdsExposed: false,
      },
    });

    const outputRaw = await readFile(
      path.join(step1Exec.artifactDir, "output.json"),
      "utf8",
    );
    const outputJson = JSON.parse(outputRaw) as { promptText: string };
    expect(outputJson.promptText).toContain("Execution context:");
    expect(outputJson.promptText).toContain("Node-specific instruction:\nstep");
    expect(outputJson.promptText).not.toContain("Candidate-Path:");
    expect(outputJson.promptText).not.toContain("Publish-Path:");
  });

  test("persists per-attempt contract request artifacts for retry auditability", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(
      root,
      "output-contract-request-artifacts",
      false,
    );

    await writeJson(
      path.join(root, "output-contract-request-artifacts", "node-step-1.json"),
      {
        id: "step-1",
        executionBackend: "claude-code-agent",
        model: "claude-opus-4-1",
        promptTemplate: "step {{topic}}",
        variables: { topic: "audit" },
        output: {
          description: "Return a structured summary object.",
          maxValidationAttempts: 2,
          jsonSchema: {
            type: "object",
            required: ["summary"],
            additionalProperties: false,
            properties: {
              summary: { type: "string", minLength: 1 },
            },
          },
        },
      },
    );

    const result = await runWorkflow(
      "output-contract-request-artifacts",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
      },
      new OutputContractRetryAdapter("retry-success"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const step1Exec = result.value.session.nodeExecutions.find(
      (entry) => entry.nodeId === "step-1",
    );
    expect(step1Exec?.outputAttemptCount).toBe(2);
    if (step1Exec === undefined) {
      return;
    }

    const firstRequestRaw = await readFile(
      path.join(
        step1Exec.artifactDir,
        "output-attempts",
        "attempt-000001",
        "request.json",
      ),
      "utf8",
    );
    const firstRequestJson = JSON.parse(firstRequestRaw) as {
      attempt: number;
      promptText: string;
      candidatePath: string;
      validationErrors: readonly { path: string; message: string }[];
    };
    expect(firstRequestJson.attempt).toBe(1);
    expect(firstRequestJson.promptText).toContain("Candidate-Path:");
    expect(firstRequestJson.promptText).not.toContain(
      "Previous output was rejected:",
    );
    expect(firstRequestJson.validationErrors).toEqual([]);
    expect(firstRequestJson.candidatePath).toContain(
      "/divedra-output-candidates/",
    );
    expect(firstRequestJson.candidatePath).toContain(
      "/attempt-000001/candidate.json",
    );

    const secondRequestRaw = await readFile(
      path.join(
        step1Exec.artifactDir,
        "output-attempts",
        "attempt-000002",
        "request.json",
      ),
      "utf8",
    );
    const secondRequestJson = JSON.parse(secondRequestRaw) as {
      attempt: number;
      promptText: string;
      candidatePath: string;
      validationErrors: readonly { path: string; message: string }[];
    };
    expect(secondRequestJson.attempt).toBe(2);
    expect(secondRequestJson.promptText).toContain(
      "Previous output was rejected:",
    );
    expect(secondRequestJson.validationErrors[0]?.path).toBe("$.summary");
    expect(secondRequestJson.candidatePath).toContain(
      "/divedra-output-candidates/",
    );
    expect(secondRequestJson.candidatePath).toContain(
      "/attempt-000002/candidate.json",
    );

    const outputRaw = await readFile(
      path.join(step1Exec.artifactDir, "output.json"),
      "utf8",
    );
    const outputJson = JSON.parse(outputRaw) as { promptText: string };
    expect(outputJson.promptText).toContain("Execution context:");
    expect(outputJson.promptText).toContain(
      "Node-specific instruction:\nstep audit",
    );
    expect(outputJson.promptText).not.toContain(
      "Previous output was rejected:",
    );
  });

  test("makes runtime-owned publication rules explicit to contract-enabled adapters", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "output-contract-boundary", false);

    await writeJson(
      path.join(root, "output-contract-boundary", "node-step-1.json"),
      {
        id: "step-1",
        executionBackend: "claude-code-agent",
        model: "claude-opus-4-1",
        promptTemplate: "step {{topic}}",
        variables: {},
        output: {
          description: "Return a structured summary object.",
          jsonSchema: {
            type: "object",
            required: ["summary"],
            additionalProperties: false,
            properties: {
              summary: { type: "string", minLength: 1 },
            },
          },
        },
      },
    );

    const captureAdapter = new OutputContractPromptCaptureAdapter();
    const result = await runWorkflow(
      "output-contract-boundary",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
      },
      captureAdapter,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(captureAdapter.capturedPromptText).toContain(
      "Final output.json publication and mailbox delivery are runtime-owned.",
    );
    expect(captureAdapter.capturedPromptText).toContain(
      "Do not write mailbox files, output.json, or invent communication ids.",
    );
    expect(captureAdapter.capturedPromptText).toContain("Candidate-Path:");
    expect(captureAdapter.capturedOutputContract).toMatchObject({
      publication: {
        owner: "runtime",
        finalArtifactWrite: "runtime-only",
        mailboxWrite: "runtime-only-after-validation",
        candidateSubmission: "inline-json-or-reserved-candidate-file",
        futureCommunicationIdsExposed: false,
      },
    });
  });

  test("keeps retry validation feedback compact in follow-up prompts", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(
      root,
      "output-contract-compact-feedback",
      false,
    );

    await writeJson(
      path.join(root, "output-contract-compact-feedback", "node-step-1.json"),
      {
        id: "step-1",
        executionBackend: "claude-code-agent",
        model: "claude-opus-4-1",
        promptTemplate: "step {{topic}}",
        variables: {},
        output: {
          jsonSchema: {
            type: "object",
            required: ["summary"],
            additionalProperties: false,
            properties: {
              summary: { type: "string", minLength: 1 },
            },
          },
          maxValidationAttempts: 2,
        },
      },
    );

    const captureAdapter = new OutputContractRetryPromptCaptureAdapter();
    const result = await runWorkflow(
      "output-contract-compact-feedback",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
      },
      captureAdapter,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(captureAdapter.prompts).toHaveLength(2);
    expect(captureAdapter.validationErrorsByAttempt).toHaveLength(2);
    expect(captureAdapter.validationErrorsByAttempt[0]).toEqual([]);
    expect(
      captureAdapter.validationErrorsByAttempt[1]?.length,
    ).toBeLessThanOrEqual(8);
    const retryPrompt = captureAdapter.prompts[1] ?? "";
    expect(retryPrompt).toContain("Previous output was rejected:");
    expect(retryPrompt).toContain("additional validation errors omitted");
    const feedbackLines = retryPrompt
      .split("\n")
      .filter((line) => line.startsWith("- $.") || line.startsWith("- $:"));
    expect(feedbackLines.length).toBeLessThanOrEqual(9);
  });

  test("rejects adapter candidate files that do not use the reserved runtime candidate path", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "output-contract-file-path", false);

    await writeJson(
      path.join(root, "output-contract-file-path", "node-step-1.json"),
      {
        id: "step-1",
        executionBackend: "claude-code-agent",
        model: "claude-opus-4-1",
        promptTemplate: "step {{topic}}",
        variables: {},
        output: {
          jsonSchema: {
            type: "object",
            required: ["summary"],
            additionalProperties: false,
            properties: {
              summary: { type: "string", minLength: 1 },
            },
          },
        },
      },
    );

    const result = await runWorkflow(
      "output-contract-file-path",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        sessionId: "sess-output-contract-file-path",
      },
      new OutputContractFilePathAdapter("unexpected-path"),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.message).toContain("invalid adapter output");
    const outputRaw = await readFile(
      path.join(
        root,
        "artifacts",
        "output-contract-file-path",
        "executions",
        "sess-output-contract-file-path",
        "nodes",
        "step-1",
        "exec-000002",
        "output.json",
      ),
      "utf8",
    );
    const outputJson = JSON.parse(outputRaw) as {
      error: string;
      validationErrors: readonly { message: string }[];
    };
    expect(outputJson.error).toBe("invalid_output");
    expect(outputJson.validationErrors[0]?.message).toContain(
      "reserved candidate path",
    );
  });

  test("classifies non-contract candidate-file failures as invalid adapter output", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(
      root,
      "non-contract-candidate-file-failure",
      false,
    );

    const result = await runWorkflow(
      "non-contract-candidate-file-failure",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        sessionId: "sess-non-contract-candidate-file-failure",
      },
      new NonContractMissingCandidateFileAdapter(),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.message).toContain("invalid adapter output");
    const outputRaw = await readFile(
      path.join(
        root,
        "artifacts",
        "non-contract-candidate-file-failure",
        "executions",
        "sess-non-contract-candidate-file-failure",
        "nodes",
        "step-1",
        "exec-000002",
        "output.json",
      ),
      "utf8",
    );
    const outputJson = JSON.parse(outputRaw) as {
      error: string;
      validationErrors: readonly { message: string }[];
    };
    expect(outputJson.error).toBe("invalid_output");
    expect(outputJson.validationErrors[0]?.message).toContain(
      "candidateFilePath is only supported",
    );
  });

  test("does not persist output-attempt artifacts for nodes without output contracts", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(
      root,
      "non-contract-no-output-attempt-artifacts",
      false,
    );

    const result = await runWorkflow(
      "non-contract-no-output-attempt-artifacts",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        sessionId: "sess-non-contract-no-output-attempt-artifacts",
      },
      deterministicAdapter,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const stepExecution = result.value.session.nodeExecutions.find(
      (entry) => entry.nodeId === "step-1",
    );
    expect(stepExecution).toBeDefined();
    if (stepExecution === undefined) {
      return;
    }

    await expect(
      readFile(
        path.join(
          stepExecution.artifactDir,
          "output-attempts",
          "attempt-000001",
          "request.json",
        ),
        "utf8",
      ),
    ).rejects.toThrow();
  });

  test("pre-creates the reserved candidate attempt directory for file-based output submission", async () => {
    const workflowRoot = await makeTempDir();
    const artifactRoot = await makeTempDir();
    await createWorkflowFixture(workflowRoot, "file-output-ready", false);

    const nodeFile = path.join(
      workflowRoot,
      "file-output-ready",
      "node-step-1.json",
    );
    await writeJson(nodeFile, {
      id: "step-1",
      executionBackend: "claude-code-agent",
      model: "claude-opus-4-1",
      promptTemplate: "step",
      variables: {},
      output: {
        jsonSchema: {
          type: "object",
          required: ["summary"],
          additionalProperties: false,
          properties: {
            summary: { type: "string" },
          },
        },
      },
    });

    const result = await runWorkflow(
      "file-output-ready",
      {
        workflowRoot,
        artifactRoot,
      },
      new OutputContractDirectFileWriteAdapter(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const stepExecution = result.value.session.nodeExecutions.find(
      (entry) => entry.nodeId === "step-1",
    );
    expect(stepExecution).toBeDefined();
    const candidateRaw = await readFile(
      path.join(
        stepExecution!.artifactDir,
        "output-attempts",
        "attempt-000001",
        "candidate.json",
      ),
      "utf8",
    );
    expect(JSON.parse(candidateRaw)).toEqual({ summary: "direct write" });
  });

  test("uses a temp staging path for reserved candidate-file submission instead of the final artifact directory", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "output-contract-staging-path", false);

    await writeJson(
      path.join(root, "output-contract-staging-path", "node-step-1.json"),
      {
        id: "step-1",
        executionBackend: "claude-code-agent",
        model: "claude-opus-4-1",
        promptTemplate: "step {{topic}}",
        variables: {},
        output: {
          description: "Return a structured summary object.",
          jsonSchema: {
            type: "object",
            required: ["summary"],
            additionalProperties: false,
            properties: {
              summary: { type: "string", minLength: 1 },
            },
          },
        },
      },
    );

    const captureAdapter = new OutputContractPromptCaptureAdapter();
    const result = await runWorkflow(
      "output-contract-staging-path",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
      },
      captureAdapter,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const stepExecution = result.value.session.nodeExecutions.find(
      (entry) => entry.nodeId === "step-1",
    );
    expect(stepExecution).toBeDefined();
    expect(captureAdapter.capturedOutputContract?.candidatePath).toContain(
      "/divedra-output-candidates/",
    );
    expect(captureAdapter.capturedOutputContract?.candidatePath).not.toContain(
      stepExecution?.artifactDir ?? "",
    );
  });

  test("cleans up reserved candidate staging files after publication and after terminal failure", async () => {
    const successRoot = await makeTempDir();
    await createWorkflowFixture(
      successRoot,
      "output-contract-cleanup-success",
      false,
    );

    await writeJson(
      path.join(
        successRoot,
        "output-contract-cleanup-success",
        "node-step-1.json",
      ),
      {
        id: "step-1",
        executionBackend: "claude-code-agent",
        model: "claude-opus-4-1",
        promptTemplate: "step",
        variables: {},
        output: {
          jsonSchema: {
            type: "object",
            required: ["summary"],
            additionalProperties: false,
            properties: {
              summary: { type: "string", minLength: 1 },
            },
          },
        },
      },
    );

    const successCaptureAdapter = new OutputContractCandidatePathCaptureAdapter(
      "success",
    );
    const successResult = await runWorkflow(
      "output-contract-cleanup-success",
      {
        workflowRoot: successRoot,
        artifactRoot: path.join(successRoot, "artifacts"),
        sessionStoreRoot: path.join(successRoot, "sessions"),
      },
      successCaptureAdapter,
    );

    expect(successResult.ok).toBe(true);
    const successCandidatePath = successCaptureAdapter.capturedCandidatePath;
    expect(successCandidatePath).toBeDefined();
    await expect(readFile(successCandidatePath!, "utf8")).rejects.toThrow();

    const failureRoot = await makeTempDir();
    await createWorkflowFixture(
      failureRoot,
      "output-contract-cleanup-failure",
      false,
    );

    await writeJson(
      path.join(
        failureRoot,
        "output-contract-cleanup-failure",
        "node-step-1.json",
      ),
      {
        id: "step-1",
        executionBackend: "claude-code-agent",
        model: "claude-opus-4-1",
        promptTemplate: "step",
        variables: {},
        output: {
          jsonSchema: {
            type: "object",
            required: ["summary"],
            additionalProperties: false,
            properties: {
              summary: { type: "string", minLength: 1 },
            },
          },
        },
      },
    );

    const failureCaptureAdapter = new OutputContractCandidatePathCaptureAdapter(
      "invalid-json",
    );
    const failureResult = await runWorkflow(
      "output-contract-cleanup-failure",
      {
        workflowRoot: failureRoot,
        artifactRoot: path.join(failureRoot, "artifacts"),
        sessionStoreRoot: path.join(failureRoot, "sessions"),
      },
      failureCaptureAdapter,
    );

    expect(failureResult.ok).toBe(false);
    const failureCandidatePath = failureCaptureAdapter.capturedCandidatePath;
    expect(failureCandidatePath).toBeDefined();
    await expect(readFile(failureCandidatePath!, "utf8")).rejects.toThrow();
  });

  test("fails deterministically when required argument binding source is missing", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "missing-required-binding", false);

    await writeJson(
      path.join(root, "missing-required-binding", "node-step-1.json"),
      {
        id: "step-1",
        executionBackend: "claude-code-agent",
        model: "claude-opus-4-1",
        promptTemplate: "step {{topic}}",
        variables: {},
        argumentsTemplate: {},
        argumentBindings: [
          {
            targetPath: "task.userInput",
            source: "human-input",
            sourcePath: "response",
            required: true,
          },
        ],
      },
    );

    const result = await runWorkflow(
      "missing-required-binding",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        runtimeVariables: { topic: "B" },
      },
      deterministicAdapter,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.exitCode).toBe(3);
      expect(result.error.message).toContain("input assembly failed");
    }
  });

  test("fails deterministically when an upstream communication output artifact is corrupted", async () => {
    const root = await makeTempDir();
    const workflowName = "corrupt-upstream-output";
    await createWorkflowFixture(root, workflowName, false);

    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
    };

    const paused = await runWorkflow(
      workflowName,
      {
        ...options,
        sessionId: "sess-corrupt-upstream",
        maxSteps: 1,
      },
      deterministicAdapter,
    );
    expect(paused.ok).toBe(true);
    if (!paused.ok) {
      return;
    }
    expect(paused.value.session.status).toBe("paused");

    const managerExec = paused.value.session.nodeExecutions.find(
      (entry) => entry.nodeId === "divedra-manager",
    );
    expect(managerExec).toBeDefined();
    if (managerExec === undefined) {
      return;
    }
    await writeFile(
      path.join(managerExec.artifactDir, "output.json"),
      '"corrupted"\n',
      "utf8",
    );

    const resumed = await runWorkflow(
      workflowName,
      {
        ...options,
        resumeSessionId: paused.value.session.sessionId,
      },
      deterministicAdapter,
    );

    expect(resumed.ok).toBe(false);
    if (!resumed.ok) {
      expect(resumed.error.exitCode).toBe(1);
      expect(resumed.error.message).toContain(
        "failed to resolve upstream communication",
      );
      expect(resumed.error.message).toContain("comm-000001");
    }
  });

  test("fails deterministically when the selected external output artifact is corrupted", async () => {
    const root = await makeTempDir();
    const workflowName = "corrupt-selected-external-output";
    await createSingleRootOutputFixture(root, workflowName);

    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
    };

    const completed = await runWorkflow(
      workflowName,
      {
        ...options,
        sessionId: "sess-corrupt-selected-output",
      },
      deterministicAdapter,
    );
    expect(completed.ok).toBe(true);
    if (!completed.ok) {
      return;
    }
    expect(completed.value.session.status).toBe("completed");

    const outputExec = completed.value.session.nodeExecutions.find(
      (entry) => entry.nodeId === "workflow-output",
    );
    expect(outputExec).toBeDefined();
    if (outputExec === undefined) {
      return;
    }

    await writeFile(
      path.join(outputExec.artifactDir, "output.json"),
      "[]\n",
      "utf8",
    );

    const resumableCommunications =
      completed.value.session.communications.filter(
        (entry) => entry.deliveryKind !== "external-output",
      );
    const {
      endedAt: _endedAt,
      lastError: _lastError,
      ...completedWithoutTerminalFields
    } = completed.value.session;
    const resumableSession = {
      ...completedWithoutTerminalFields,
      status: "paused" as const,
      communications: resumableCommunications,
      communicationCounter: resumableCommunications.length,
    };
    const saved = await saveSession(resumableSession, options);
    expect(saved.ok).toBe(true);

    const resumed = await runWorkflow(
      workflowName,
      {
        ...options,
        resumeSessionId: completed.value.session.sessionId,
      },
      deterministicAdapter,
    );

    expect(resumed.ok).toBe(false);
    if (!resumed.ok) {
      expect(resumed.error.exitCode).toBe(1);
      expect(resumed.error.message).toContain(
        "failed to publish selected external output",
      );
      expect(resumed.error.message).toContain("workflow-output");
      expect(resumed.error.message).toContain(outputExec.nodeExecId);
      expect(resumed.error.message).toContain("output artifact");
      expect(resumed.error.message).toContain(
        path.join(outputExec.artifactDir, "output.json"),
      );
      expect(resumed.error.message).toContain("must contain a JSON object");
    }

    const failedSession = await loadSession(
      completed.value.session.sessionId,
      options,
    );
    expect(failedSession.ok).toBe(true);
    if (!failedSession.ok) {
      return;
    }

    expect(failedSession.value.status).toBe("failed");
    expect(failedSession.value.lastError).toContain(
      "failed to publish selected external output",
    );
    expect(failedSession.value.lastError).toContain("workflow-output");
    expect(failedSession.value.lastError).toContain(outputExec.nodeExecId);
    expect(failedSession.value.lastError).toContain(
      path.join(outputExec.artifactDir, "output.json"),
    );
  });

  test("preserves selected external output artifact bytes when publication resumes", async () => {
    const root = await makeTempDir();
    const workflowName = "resume-external-output-byte-preservation";
    const sessionId = "sess-resume-external-output-byte-preservation";
    await createSingleRootOutputFixture(root, workflowName);

    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
    };

    const completed = await runWorkflow(
      workflowName,
      {
        ...options,
        sessionId,
      },
      deterministicAdapter,
    );
    expect(completed.ok).toBe(true);
    if (!completed.ok) {
      return;
    }

    const outputExec = completed.value.session.nodeExecutions.find(
      (entry) => entry.nodeId === "workflow-output",
    );
    expect(outputExec).toBeDefined();
    if (outputExec === undefined) {
      return;
    }

    const outputPath = path.join(outputExec.artifactDir, "output.json");
    const originalOutputJson = JSON.parse(
      await readFile(outputPath, "utf8"),
    ) as unknown;
    const reformattedOutputRaw = `${JSON.stringify(originalOutputJson, null, 4)}\n`;
    await writeFile(outputPath, reformattedOutputRaw, "utf8");

    const resumableCommunications =
      completed.value.session.communications.filter(
        (entry) => entry.deliveryKind !== "external-output",
      );
    const {
      endedAt: _endedAt,
      lastError: _lastError,
      ...completedWithoutTerminalFields
    } = completed.value.session;
    const resumableSession = {
      ...completedWithoutTerminalFields,
      status: "paused" as const,
      communications: resumableCommunications,
      communicationCounter: resumableCommunications.length,
    };
    const saved = await saveSession(resumableSession, options);
    expect(saved.ok).toBe(true);

    const resumed = await runWorkflow(
      workflowName,
      {
        ...options,
        resumeSessionId: sessionId,
      },
      deterministicAdapter,
    );
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) {
      return;
    }

    const outputCommunication = resumed.value.session.communications.find(
      (entry) =>
        entry.toNodeId === "__workflow-output-mailbox__" &&
        entry.deliveryKind === "external-output" &&
        entry.fromNodeId === "workflow-output",
    );
    expect(outputCommunication).toBeDefined();
    if (outputCommunication === undefined) {
      return;
    }

    const mailboxOutputRaw = await readFile(
      path.join(
        outputCommunication.artifactDir,
        "outbox",
        "workflow-output",
        "output.json",
      ),
      "utf8",
    );
    expect(mailboxOutputRaw).toBe(reformattedOutputRaw);
  });

  test("fails deterministically when external output publication cannot persist its mailbox artifacts", async () => {
    const root = await makeTempDir();
    const workflowName = "external-output-publication-write-failure";
    const sessionId = "sess-publication-write-failure";
    await createSingleRootOutputFixture(root, workflowName);

    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
    };

    const communicationsRoot = path.join(
      options.artifactRoot,
      workflowName,
      "executions",
      sessionId,
      "communications",
    );
    await mkdir(communicationsRoot, { recursive: true });
    await writeFile(
      path.join(communicationsRoot, "comm-000002"),
      "block external communication directory creation\n",
      "utf8",
    );

    const result = await runWorkflow(
      workflowName,
      {
        ...options,
        sessionId,
      },
      deterministicAdapter,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.exitCode).toBe(1);
      expect(result.error.message).toContain(
        "failed to persist external output publication",
      );
      expect(result.error.message).toContain("workflow-output");
      expect(result.error.message).toContain("exec-000002");
    }

    const failedSession = await loadSession(sessionId, options);
    expect(failedSession.ok).toBe(true);
    if (!failedSession.ok) {
      return;
    }

    expect(failedSession.value.status).toBe("failed");
    expect(failedSession.value.lastError).toContain(
      "failed to persist external output publication",
    );
    expect(failedSession.value.lastError).toContain("exec-000002");
    expect(
      failedSession.value.communications.some(
        (entry) => entry.deliveryKind === "external-output",
      ),
    ).toBe(false);
  });

  test("reports completed-session persistence failure when the session file target path is invalid", async () => {
    const root = await makeTempDir();
    const workflowName = "completed-session-save-failure";
    const sessionId = "sess-completed-save-failure";
    await createSingleRootOutputFixture(root, workflowName);

    const sessionFilePath = path.join(
      getSessionStoreRoot({
        sessionStoreRoot: path.join(root, "sessions"),
      }),
      `${sessionId}.json`,
    );
    await mkdir(path.dirname(sessionFilePath), { recursive: true });
    await mkdir(sessionFilePath, { recursive: true });

    const result = await runWorkflow(
      workflowName,
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        sessionId,
      },
      deterministicAdapter,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.exitCode).toBe(1);
      expect(result.error.message).toContain(
        "failed to persist completed workflow session state",
      );
      expect(result.error.message).toContain("failed writing session file");
    }
  });

  test("fails deterministically when execution mailbox artifacts cannot be persisted", async () => {
    const root = await makeTempDir();
    const workflowName = "mailbox-write-failure";
    const sessionId = "sess-mailbox-write-failure";
    const artifactRoot = path.join(root, "artifacts");
    const sessionStoreRoot = path.join(root, "sessions");
    await createWorkflowFixture(root, workflowName, false);

    const blockedMailboxPath = path.join(
      artifactRoot,
      workflowName,
      "executions",
      sessionId,
      "nodes",
      "divedra-manager",
      "exec-000001",
      "mailbox",
    );
    await mkdir(path.dirname(blockedMailboxPath), { recursive: true });
    await writeFile(blockedMailboxPath, "blocked", "utf8");

    const result = await runWorkflow(
      workflowName,
      {
        workflowRoot: root,
        artifactRoot,
        sessionStoreRoot,
        sessionId,
        runtimeVariables: { topic: "B" },
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

  test("uses loop semantics to force exit when max loop iterations are reached", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "looped", true);

    const result = await runWorkflow("looped", {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      maxLoopIterations: 2,
      mockScenario: {
        "step-1": {
          when: { continue_round: true, loop_exit: false },
          payload: {},
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.session.status).toBe("completed");
    expect(result.value.session.loopIterationCounts?.["main-loop"]).toBe(2);
    const stepExecutions = result.value.session.nodeExecutions.filter(
      (entry) => entry.nodeId === "step-1",
    );
    expect(stepExecutions).toHaveLength(3);
    const upstreamCommunications = await Promise.all(
      stepExecutions.map(async (execution) => {
        const inputRaw = await readFile(
          path.join(execution.artifactDir, "input.json"),
          "utf8",
        );
        const inputJson = JSON.parse(inputRaw) as {
          upstreamCommunications: readonly string[];
        };
        return inputJson.upstreamCommunications;
      }),
    );
    expect(upstreamCommunications).toEqual([
      ["comm-000001"],
      ["comm-000002"],
      ["comm-000003"],
    ]);
  });

  test("supports dry-run without adapter execution", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "dry-run", false);

    const result = await runWorkflow("dry-run", {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      dryRun: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.session.status).toBe("completed");
    const managerExec = result.value.session.nodeExecutions.find(
      (entry) => entry.nodeId === "divedra-manager",
    );
    expect(managerExec).toBeDefined();
    const outputRaw = await readFile(
      path.join(managerExec!.artifactDir, "output.json"),
      "utf8",
    );
    const outputJson = JSON.parse(outputRaw) as { provider: string };
    expect(outputJson.provider).toBe("dry-run");
  });

  test("restarts stuck node and completes when retry succeeds", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "restart-success", false);

    let firstStepAttempt = true;
    const flakyAdapter: NodeAdapter = {
      async execute(input) {
        if (input.nodeId === "step-1" && firstStepAttempt) {
          firstStepAttempt = false;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return {
          provider: "test-adapter",
          model: input.node.model,
          promptText: "ok",
          completionPassed: true,
          when: { always: true },
          payload: { nodeId: input.nodeId },
        };
      },
    };

    const result = await runWorkflow(
      "restart-success",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        defaultTimeoutMs: 10,
        maxStuckRestarts: 1,
        stuckRestartBackoffMs: 0,
      },
      flakyAdapter,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.session.status).toBe("completed");
    expect((result.value.session.restartEvents ?? []).length).toBe(1);
    expect((result.value.session.restartCounts ?? {})["step-1"]).toBe(1);
    const stepExecutions = result.value.session.nodeExecutions.filter(
      (entry) => entry.nodeId === "step-1",
    );
    expect(stepExecutions).toHaveLength(2);
    expect(stepExecutions[0]?.status).toBe("timed_out");
    expect(stepExecutions[1]?.status).toBe("succeeded");
  });

  test("fails with timeout when stuck restart budget is exhausted", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "restart-fail", false);
    const sessionId = "sess-restart-fail";

    const stuckAdapter: NodeAdapter = {
      async execute(input) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          provider: "test-adapter",
          model: input.node.model,
          promptText: "late",
          completionPassed: true,
          when: { always: true },
          payload: {},
        };
      },
    };

    const result = await runWorkflow(
      "restart-fail",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        sessionId,
        defaultTimeoutMs: 10,
        maxStuckRestarts: 0,
      },
      stuckAdapter,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.exitCode).toBe(6);
      const timedOutSessionRaw = await readFile(
        path.join(root, "sessions", `${sessionId}.json`),
        "utf8",
      );
      const timedOutSession = JSON.parse(timedOutSessionRaw) as {
        communications: readonly {
          status: string;
          fromNodeId: string;
          toNodeId: string;
        }[];
      };
      const timedOutNodeOutgoing = timedOutSession.communications.filter(
        (entry) => entry.fromNodeId === "step-1",
      );
      expect(timedOutNodeOutgoing).toEqual([]);
    }
  });

  test("treats policy-blocked adapter failure as failed execution", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "policy-blocked", false);

    const blockedAdapter: NodeAdapter = {
      async execute(_input) {
        throw new AdapterExecutionError(
          "policy_blocked",
          "blocked by provider policy",
        );
      },
    };

    const result = await runWorkflow(
      "policy-blocked",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
      },
      blockedAdapter,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.exitCode).toBe(5);
    }
  });

  test("supports scenario mocks for deterministic branching outputs", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "scenario", false);

    const result = await runWorkflow("scenario", {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      mockScenario: {
        "divedra-manager": {
          provider: "scenario-mock",
          when: { always: true },
          payload: { stage: "design" },
        },
        "step-1": {
          provider: "scenario-mock",
          when: { always: true },
          payload: { stage: "test-review" },
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.session.status).toBe("completed");
    const stepExec = result.value.session.nodeExecutions.find(
      (entry) => entry.nodeId === "step-1",
    );
    expect(stepExec).toBeDefined();
    if (stepExec === undefined) {
      return;
    }
    const outputRaw = await readFile(
      path.join(stepExec.artifactDir, "output.json"),
      "utf8",
    );
    const outputJson = JSON.parse(outputRaw) as {
      provider: string;
      payload: { stage: string };
    };
    expect(outputJson.provider).toBe("scenario-mock");
    expect(outputJson.payload.stage).toBe("test-review");
  });

  test("supports mock-scenario execution for command and container nodes", async () => {
    const root = await makeTempDir();
    const exampleWorkflowRoot = path.join(process.cwd(), "examples");
    const scenarioRaw = await readFile(
      path.join(
        exampleWorkflowRoot,
        "first-four-arithmetic-pipeline",
        "mock-scenario.json",
      ),
      "utf8",
    );
    const scenario = JSON.parse(scenarioRaw) as MockNodeScenario;

    const result = await runWorkflow("first-four-arithmetic-pipeline", {
      workflowRoot: exampleWorkflowRoot,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      mockScenario: scenario,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.session.status).toBe("completed");
    const outputExec = result.value.session.nodeExecutions.find(
      (entry) => entry.nodeId === "divide-output",
    );
    expect(outputExec).toBeDefined();
    if (outputExec === undefined) {
      return;
    }
    const outputRaw = await readFile(
      path.join(outputExec.artifactDir, "output.json"),
      "utf8",
    );
    const outputJson = JSON.parse(outputRaw) as {
      payload: { finalResult: number; summary: string };
      provider: string;
    };
    expect(outputJson.provider).toBe("scenario-mock");
    expect(outputJson.payload.finalResult).toBe(45);
    expect(outputJson.payload.summary).toContain("45");
  });

  test("can rerun from a specific node based on a prior session", async () => {
    const root = await makeTempDir();
    await createWorkflowFixture(root, "rerun", false);
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
    };

    const first = await runWorkflow("rerun", options, deterministicAdapter);
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }

    const rerun = await runWorkflow(
      "rerun",
      {
        ...options,
        rerunFromSessionId: first.value.session.sessionId,
        rerunFromNodeId: "step-1",
      },
      deterministicAdapter,
    );
    expect(rerun.ok).toBe(true);
    if (!rerun.ok) {
      return;
    }

    expect(rerun.value.session.sessionId).not.toBe(
      first.value.session.sessionId,
    );
    expect(rerun.value.session.nodeExecutions).toHaveLength(1);
    expect(rerun.value.session.nodeExecutions[0]?.nodeId).toBe("step-1");
    expect(rerun.value.session.startedAt.length).toBeGreaterThan(0);
  });

  test("does not inherit reusable node backend sessions into a rerun session", async () => {
    const root = await makeTempDir();
    await createNodeSessionReuseFixture(root, "rerun-node-session-reuse");
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
    };

    const firstAdapter = new ReusableSessionAdapter();
    const first = await runWorkflow(
      "rerun-node-session-reuse",
      options,
      firstAdapter,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.value.session.nodeBackendSessions?.["step-b"]?.sessionId).toBe(
      "backend-b-1",
    );

    const rerunAdapter = new ReusableSessionAdapter();
    const rerun = await runWorkflow(
      "rerun-node-session-reuse",
      {
        ...options,
        rerunFromSessionId: first.value.session.sessionId,
        rerunFromNodeId: "step-b",
      },
      rerunAdapter,
    );
    expect(rerun.ok).toBe(true);
    if (!rerun.ok) {
      return;
    }

    const stepBCalls = rerunAdapter.calls.filter(
      (entry) => entry.nodeId === "step-b",
    );
    expect(stepBCalls).toHaveLength(2);
    expect(stepBCalls[0]?.backendSession).toEqual({ mode: "new" });
    expect(stepBCalls[1]?.backendSession).toEqual({
      mode: "reuse",
      sessionId: "backend-b-1",
    });
    expect(rerun.value.session.sessionId).not.toBe(
      first.value.session.sessionId,
    );
    expect(rerun.value.session.nodeExecutions[0]?.nodeId).toBe("step-b");
  });

  test("manager schedules sub-workflow inputs based on inputSources dependencies", async () => {
    const root = await makeTempDir();
    await createSubWorkflowRuntimeFixture(root, "subworkflow-runtime");

    const result = await runWorkflow(
      "subworkflow-runtime",
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        runtimeVariables: {
          humanInput: { topic: "demo" },
        },
      },
      deterministicAdapter,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.session.status).toBe("completed");

    const executionOrder = result.value.session.nodeExecutions.map(
      (entry) => entry.nodeId,
    );
    expect(executionOrder.indexOf("a-manager")).toBeGreaterThan(
      executionOrder.indexOf("divedra-manager"),
    );
    expect(executionOrder.indexOf("a-input")).toBeGreaterThan(
      executionOrder.indexOf("a-manager"),
    );
    expect(executionOrder.indexOf("a-output")).toBeGreaterThan(
      executionOrder.indexOf("a-input"),
    );
    expect(executionOrder.indexOf("b-manager")).toBeGreaterThan(
      executionOrder.indexOf("a-output"),
    );
    expect(executionOrder.indexOf("b-input")).toBeGreaterThan(
      executionOrder.indexOf("a-output"),
    );
    expect(executionOrder.indexOf("b-input")).toBeGreaterThan(
      executionOrder.indexOf("b-manager"),
    );
    expect(executionOrder.indexOf("b-output")).toBeGreaterThan(
      executionOrder.indexOf("b-input"),
    );
    expect(
      (result.value.session.conversationTurns ?? []).length,
    ).toBeGreaterThan(0);
    expect(result.value.session.conversationTurns?.[0]?.fromSubWorkflowId).toBe(
      "sw-a",
    );
    expect(result.value.session.conversationTurns?.[0]?.toSubWorkflowId).toBe(
      "sw-b",
    );
    expect(
      result.value.session.conversationTurns?.[0]?.communicationId,
    ).toMatch(/^comm-\d{6}$/);

    const bInputExec = result.value.session.nodeExecutions.find(
      (entry) => entry.nodeId === "b-input",
    );
    expect(bInputExec).toBeDefined();
    if (bInputExec === undefined) {
      return;
    }
    const bInputRaw = await readFile(
      path.join(bInputExec.artifactDir, "input.json"),
      "utf8",
    );
    const bInputJson = JSON.parse(bInputRaw) as {
      upstreamOutputRefs: readonly {
        subWorkflowId?: string;
        outputNodeId: string;
      }[];
      upstreamCommunications: readonly string[];
    };
    expect(
      bInputJson.upstreamOutputRefs.some(
        (entry) => entry.subWorkflowId === "sw-b",
      ),
    ).toBe(true);
    expect(
      bInputJson.upstreamOutputRefs.some(
        (entry) => entry.outputNodeId === "b-manager",
      ),
    ).toBe(true);
    expect(bInputJson.upstreamCommunications.length).toBeGreaterThan(0);

    const aOutputExec = result.value.session.nodeExecutions.find(
      (entry) => entry.nodeId === "a-output",
    );
    expect(aOutputExec).toBeDefined();
    if (aOutputExec === undefined) {
      return;
    }
    const aOutputHandoffRaw = await readFile(
      path.join(aOutputExec.artifactDir, "handoff.json"),
      "utf8",
    );
    const aOutputHandoffJson = JSON.parse(aOutputHandoffRaw) as {
      outputRef: { subWorkflowId?: string };
    };
    expect(aOutputHandoffJson.outputRef.subWorkflowId).toBe("sw-a");

    const aOutputCommitMessage = await readFile(
      path.join(aOutputExec.artifactDir, "commit-message.txt"),
      "utf8",
    );
    expect(aOutputCommitMessage).toContain("Subworkflow-ID: sw-a");

    const conversationCommunication = result.value.session.communications.find(
      (entry) => entry.deliveryKind === "conversation-turn",
    );
    expect(conversationCommunication).toBeDefined();
    expect(conversationCommunication?.fromSubWorkflowId).toBe("sw-a");
    expect(conversationCommunication?.toSubWorkflowId).toBe("sw-b");
    expect(conversationCommunication?.payloadRef.outputNodeId).toBe("a-output");

    const parentToSubWorkflowCommunication =
      result.value.session.communications.find(
        (entry) =>
          entry.routingScope === "parent-to-sub-workflow" &&
          entry.toNodeId === "a-manager",
      );
    expect(parentToSubWorkflowCommunication).toBeDefined();
    if (parentToSubWorkflowCommunication === undefined) {
      return;
    }

    const childEdgeCommunication = result.value.session.communications.find(
      (entry) =>
        entry.fromNodeId === "a-input" && entry.toNodeId === "a-output",
    );
    expect(childEdgeCommunication).toBeDefined();
    if (childEdgeCommunication === undefined) {
      return;
    }

    const childReceiptRaw = await readFile(
      path.join(
        childEdgeCommunication.artifactDir,
        "attempts",
        childEdgeCommunication.activeDeliveryAttemptId ?? "attempt-000001",
        "receipt.json",
      ),
      "utf8",
    );
    const childReceiptJson = JSON.parse(childReceiptRaw) as {
      deliveredByNodeId: string;
    };
    expect(childReceiptJson.deliveredByNodeId).toBe("a-manager");

    const rootReceiptRaw = await readFile(
      path.join(
        parentToSubWorkflowCommunication.artifactDir,
        "attempts",
        parentToSubWorkflowCommunication.activeDeliveryAttemptId ??
          "attempt-000001",
        "receipt.json",
      ),
      "utf8",
    );
    const rootReceiptJson = JSON.parse(rootReceiptRaw) as {
      deliveredByNodeId: string;
    };
    expect(rootReceiptJson.deliveredByNodeId).toBe("divedra-manager");

    const childToRootCommunication = result.value.session.communications.find(
      (entry) =>
        entry.fromNodeId === "a-output" && entry.toNodeId === "divedra-manager",
    );
    expect(childToRootCommunication).toBeDefined();
    expect(childToRootCommunication?.routingScope).toBe("cross-sub-workflow");
    expect(childToRootCommunication?.fromSubWorkflowId).toBe("sw-a");
  });

  test("does not duplicate a sub-workflow manager handoff when a normal edge already targets that manager", async () => {
    const root = await makeTempDir();
    const workflowName = "subworkflow-dedup-manager-handoff";
    await createSubWorkflowRuntimeFixture(root, workflowName);

    const workflowPath = path.join(root, workflowName, "workflow.json");
    const workflowRaw = await readFile(workflowPath, "utf8");
    const workflowJson = JSON.parse(workflowRaw) as {
      edges: Array<{ from: string; to: string; when: string }>;
    };
    workflowJson.edges.unshift({
      from: "divedra-manager",
      to: "a-manager",
      when: "always",
    });
    await writeJson(workflowPath, workflowJson);

    const result = await runWorkflow(
      workflowName,
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        maxSteps: 1,
        runtimeVariables: {
          humanInput: { topic: "demo" },
        },
      },
      deterministicAdapter,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.session.status).toBe("paused");

    const rootToAManagerCommunications =
      result.value.session.communications.filter(
        (entry) =>
          entry.fromNodeId === "divedra-manager" &&
          entry.toNodeId === "a-manager",
      );

    expect(rootToAManagerCommunications).toHaveLength(1);
    expect(rootToAManagerCommunications[0]?.routingScope).toBe(
      "parent-to-sub-workflow",
    );
    expect(rootToAManagerCommunications[0]?.toSubWorkflowId).toBe("sw-a");
  });

  test("fails deterministically when a conversation sender output artifact is corrupted", async () => {
    const root = await makeTempDir();
    const workflowName = "subworkflow-corrupt-conversation";
    await createSubWorkflowRuntimeFixture(root, workflowName);

    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
    };

    const paused = await runWorkflow(
      workflowName,
      {
        ...options,
        sessionId: "sess-corrupt-conversation",
        runtimeVariables: {
          humanInput: { topic: "demo" },
        },
        maxSteps: 4,
      },
      deterministicAdapter,
    );
    expect(paused.ok).toBe(true);
    if (!paused.ok) {
      return;
    }
    expect(paused.value.session.status).toBe("paused");

    const senderExec = paused.value.session.nodeExecutions.find(
      (entry) => entry.nodeId === "a-output",
    );
    expect(senderExec).toBeDefined();
    if (senderExec === undefined) {
      return;
    }
    await writeFile(
      path.join(senderExec.artifactDir, "output.json"),
      '"corrupted"\n',
      "utf8",
    );

    const resumed = await runWorkflow(
      workflowName,
      {
        ...options,
        resumeSessionId: paused.value.session.sessionId,
      },
      deterministicAdapter,
    );

    expect(resumed.ok).toBe(false);
    if (!resumed.ok) {
      expect(resumed.error.exitCode).toBe(1);
      expect(resumed.error.message).toContain(
        "failed to resolve upstream communication",
      );
      expect(resumed.error.message).toContain("comm-");
      expect(resumed.error.message).toContain("divedra-manager");
      expect(resumed.error.message).toContain("a-output");
    }
  });

  test("replays multi-turn sub-workflow conversations through manager mailboxes", async () => {
    const root = await makeTempDir();
    const workflowName = "subworkflow-multi-turn-conversation";
    await createSubWorkflowRuntimeFixture(root, workflowName);

    const result = await runWorkflow(
      workflowName,
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        sessionId: "sess-multi-turn-conversation",
        runtimeVariables: { humanInput: { topic: "ping-pong" } },
      },
      deterministicAdapter,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const conversationTurns = result.value.session.conversationTurns ?? [];
    expect(conversationTurns).toHaveLength(3);
    expect(
      conversationTurns.map(
        (entry) => `${entry.fromSubWorkflowId}->${entry.toSubWorkflowId}`,
      ),
    ).toEqual(["sw-a->sw-b", "sw-b->sw-a", "sw-a->sw-b"]);

    const aInputExecutions = result.value.session.nodeExecutions.filter(
      (entry) => entry.nodeId === "a-input",
    );
    const bInputExecutions = result.value.session.nodeExecutions.filter(
      (entry) => entry.nodeId === "b-input",
    );
    expect(aInputExecutions).toHaveLength(2);
    expect(bInputExecutions).toHaveLength(2);
  });

  test("subworkflow-manager forwards its own output to the child input", async () => {
    const root = await makeTempDir();
    const workflowName = "subworkflow-manager-forwarding";
    await createSubWorkflowRuntimeFixture(root, workflowName);
    await writeJson(path.join(root, workflowName, "node-b-input.json"), {
      id: "b-input",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: "b-input",
      variables: {},
      argumentsTemplate: { routed: { marker: "" } },
      argumentBindings: [
        {
          targetPath: "routed.marker",
          source: "node-output",
          sourceRef: "b-manager",
          sourcePath: "output.payload.marker",
          required: true,
        },
      ],
    });

    const result = await runWorkflow(
      workflowName,
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        sessionId: "sess-manager-forwarding",
        runtimeVariables: { humanInput: { topic: "ping-pong" } },
      },
      new ScenarioNodeAdapter({
        "a-output": { payload: { marker: "from-a-output" } },
        "b-manager": {
          payload: {
            marker: "from-b-manager",
            managerControl: {
              actions: [
                { type: "deliver-to-child-input", inputNodeId: "b-input" },
              ],
            },
          },
        },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const bInputExecutions = result.value.session.nodeExecutions.filter(
      (entry) => entry.nodeId === "b-input",
    );
    expect(bInputExecutions.length).toBeGreaterThan(0);
    const firstBInputExecution = bInputExecutions[0];
    expect(firstBInputExecution).toBeDefined();
    if (firstBInputExecution === undefined) {
      return;
    }

    const inputRaw = await readFile(
      path.join(firstBInputExecution.artifactDir, "input.json"),
      "utf8",
    );
    const inputJson = JSON.parse(inputRaw) as {
      arguments: { routed: { marker: string } };
    };
    expect(inputJson.arguments.routed.marker).toBe("from-b-manager");
  });

  test("subworkflow-manager can suppress default child-input forwarding with explicit empty managerControl actions", async () => {
    const root = await makeTempDir();
    const workflowName = "subworkflow-manager-no-forward";
    await createSubWorkflowRuntimeFixture(root, workflowName);

    const result = await runWorkflow(
      workflowName,
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        sessionId: "sess-manager-no-forward",
        runtimeVariables: { humanInput: { topic: "ping-pong" } },
      },
      new ScenarioNodeAdapter({
        "b-manager": {
          payload: {
            managerControl: {
              actions: [],
            },
          },
        },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const bInputExecutions = result.value.session.nodeExecutions.filter(
      (entry) => entry.nodeId === "b-input",
    );
    expect(bInputExecutions).toHaveLength(0);
  });

  test("root manager can explicitly start a sub-workflow through managerControl", async () => {
    const root = await makeTempDir();
    const workflowName = "root-manager-explicit-start";
    await createSubWorkflowRuntimeFixture(root, workflowName);

    const result = await runWorkflow(
      workflowName,
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        sessionId: "sess-root-manager-explicit-start",
      },
      new ScenarioNodeAdapter({
        "divedra-manager": [
          {
            payload: {
              managerControl: {
                actions: [
                  { type: "start-sub-workflow", subWorkflowId: "sw-a" },
                ],
              },
            },
          },
          { payload: {} },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const aManagerExecution = result.value.session.nodeExecutions.find(
      (entry) => entry.nodeId === "a-manager",
    );
    expect(aManagerExecution).toBeDefined();

    const startCommunication = result.value.session.communications.find(
      (entry) =>
        entry.fromNodeId === "divedra-manager" &&
        entry.toNodeId === "a-manager" &&
        entry.transitionWhen === "sub-workflow-start:sw-a",
    );
    expect(startCommunication).toBeDefined();
  });

  test("root manager can re-invoke the same sub-workflow through repeated explicit start actions", async () => {
    const root = await makeTempDir();
    const workflowName = "root-manager-explicit-rerun";
    await createSubWorkflowRuntimeFixture(root, workflowName);

    const result = await runWorkflow(
      workflowName,
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        sessionId: "sess-root-manager-explicit-rerun",
      },
      new ScenarioNodeAdapter({
        "divedra-manager": [
          {
            payload: {
              managerControl: {
                actions: [
                  { type: "start-sub-workflow", subWorkflowId: "sw-a" },
                ],
              },
            },
          },
          {
            payload: {
              managerControl: {
                actions: [
                  { type: "start-sub-workflow", subWorkflowId: "sw-a" },
                ],
              },
            },
          },
          {
            payload: {
              managerControl: {
                actions: [],
              },
            },
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const aManagerExecutions = result.value.session.nodeExecutions.filter(
      (entry) => entry.nodeId === "a-manager",
    );
    expect(aManagerExecutions.length).toBeGreaterThanOrEqual(2);

    const repeatedStartCommunications =
      result.value.session.communications.filter(
        (entry) =>
          entry.fromNodeId === "divedra-manager" &&
          entry.toNodeId === "a-manager" &&
          entry.transitionWhen === "sub-workflow-start:sw-a",
      );
    expect(repeatedStartCommunications).toHaveLength(2);
  });

  test("rejects root-manager retry-node actions that target internal sub-workflow nodes", async () => {
    const root = await makeTempDir();
    const workflowName = "root-manager-invalid-internal-retry";
    await createSubWorkflowRuntimeFixture(root, workflowName);

    const result = await runWorkflow(
      workflowName,
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        sessionId: "sess-root-manager-invalid-internal-retry",
      },
      new ScenarioNodeAdapter({
        "divedra-manager": {
          payload: {
            managerControl: {
              actions: [{ type: "retry-node", nodeId: "a-input" }],
            },
          },
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.exitCode).toBe(5);
    expect(result.error.message).toContain(
      "must re-invoke that sub-workflow with start-sub-workflow instead",
    );
  });

  test("exposes conversation routing metadata in transcript bindings", async () => {
    const root = await makeTempDir();
    const workflowName = "subworkflow-transcript-metadata";
    await createSubWorkflowRuntimeFixture(root, workflowName);
    await writeJson(path.join(root, workflowName, "node-b-manager.json"), {
      id: "b-manager",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      promptTemplate: "b-manager",
      variables: {},
      argumentsTemplate: {},
      argumentBindings: [
        {
          targetPath: "transcript",
          source: "conversation-transcript",
        },
      ],
    });

    const result = await runWorkflow(
      workflowName,
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        sessionId: "sess-transcript-metadata",
        runtimeVariables: { humanInput: { topic: "ping-pong" } },
      },
      deterministicAdapter,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const bManagerExecutions = result.value.session.nodeExecutions.filter(
      (entry) => entry.nodeId === "b-manager",
    );
    expect(bManagerExecutions.length).toBeGreaterThan(0);
    const bManagerExec = bManagerExecutions[0];
    expect(bManagerExec).toBeDefined();
    if (bManagerExec === undefined) {
      return;
    }

    const inputRaw = await readFile(
      path.join(bManagerExec.artifactDir, "input.json"),
      "utf8",
    );
    const inputJson = JSON.parse(inputRaw) as {
      arguments: {
        transcript: readonly {
          fromManagerNodeId: string;
          toManagerNodeId: string;
          communicationId: string;
        }[];
      };
    };

    expect(inputJson.arguments.transcript.length).toBeGreaterThan(0);
    expect(inputJson.arguments.transcript[0]?.fromManagerNodeId).toBe(
      "a-manager",
    );
    expect(inputJson.arguments.transcript[0]?.toManagerNodeId).toBe(
      "b-manager",
    );
    expect(inputJson.arguments.transcript[0]?.communicationId).toMatch(
      /^comm-\d{6}$/,
    );
  });

  test("rejects a sub-workflow that attempts to reuse the root manager", async () => {
    const root = await makeTempDir();
    const workflowName = "subworkflow-root-manager-conversation";
    await createSubWorkflowRuntimeFixture(root, workflowName);

    const workflowPath = path.join(root, workflowName, "workflow.json");
    const workflowJson = JSON.parse(await readFile(workflowPath, "utf8")) as {
      subWorkflows: Array<Record<string, unknown>>;
      nodes: Array<{ id: string }>;
    };
    workflowJson.subWorkflows[1] = {
      ...workflowJson.subWorkflows[1],
      managerNodeId: undefined,
      nodeIds: ["b-input", "b-output"],
    };
    workflowJson.nodes = workflowJson.nodes.filter(
      (node) => node.id !== "b-manager",
    );
    await writeJson(workflowPath, workflowJson);

    const result = await runWorkflow(
      workflowName,
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        sessionId: "sess-root-manager-conversation",
        runtimeVariables: { humanInput: { topic: "ping-pong" } },
      },
      deterministicAdapter,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.exitCode).toBe(2);
    expect(result.error.message).toContain("workflow validation failed");
  });
});
