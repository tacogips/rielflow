import { describe, expect, test } from "vitest";
import { assembleNodeInput } from "./input-assembly";
import type { NodePayload } from "./types";

function makeNode(overrides: Partial<NodePayload> = {}): NodePayload {
  return {
    id: "step-1",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    promptTemplate: "hello {{topic}}",
    variables: { topic: "default-topic" },
    ...overrides,
  };
}

describe("assembleNodeInput", () => {
  test("renders prompt with merged variables and returns null arguments when no template/bindings", () => {
    const assembled = assembleNodeInput({
      runtimeVariables: { topic: "runtime-topic" },
      node: makeNode(),
      workflowId: "wf",
      workflowDescription: "Ship a release safely.",
      nodeKind: "task",
      upstream: [],
      transcript: [],
    });

    expect(assembled.promptText).toBe("hello runtime-topic");
    expect(assembled.arguments).toBeNull();
  });

  test("materializes bindings from variables and node output", () => {
    const assembled = assembleNodeInput({
      runtimeVariables: { topic: "runtime-topic" },
      node: makeNode({
        argumentsTemplate: { task: { topic: "", upstreamNode: "" } },
        argumentBindings: [
          {
            targetPath: "task.topic",
            source: "variables",
            sourcePath: "topic",
            required: true,
          },
          {
            targetPath: "task.upstreamNode",
            source: "node-output",
            sourceRef: "divedra-manager",
            sourcePath: "output.payload.nodeId",
            required: true,
          },
        ],
      }),
      workflowId: "wf",
      workflowDescription: "Ship a release safely.",
      nodeKind: "task",
      upstream: [
        {
          fromNodeId: "divedra-manager",
          output: {
            payload: { nodeId: "divedra-manager" },
          },
        },
      ],
      transcript: [],
    });

    expect(assembled.arguments).toEqual({
      task: {
        topic: "runtime-topic",
        upstreamNode: "divedra-manager",
      },
    });
  });

  test("supports transcript binding source", () => {
    const assembled = assembleNodeInput({
      runtimeVariables: {},
      node: makeNode({
        argumentsTemplate: {},
        argumentBindings: [
          {
            targetPath: "history.turns",
            source: "conversation-transcript",
            required: true,
          },
        ],
      }),
      workflowId: "wf",
      workflowDescription: "Ship a release safely.",
      nodeKind: "task",
      upstream: [],
      transcript: [{ turn: 1 }, { turn: 2 }],
    });

    expect(assembled.arguments).toEqual({
      history: { turns: [{ turn: 1 }, { turn: 2 }] },
    });
  });

  test("throws deterministic error for missing required binding", () => {
    expect(() =>
      assembleNodeInput({
        runtimeVariables: {},
        node: makeNode({
          argumentsTemplate: {},
          argumentBindings: [
            {
              targetPath: "task.requiredInput",
              source: "human-input",
              sourcePath: "response",
              required: true,
            },
          ],
        }),
        workflowId: "wf",
        workflowDescription: "Ship a release safely.",
        nodeKind: "task",
        upstream: [],
        transcript: [],
      }),
    ).toThrow(/required binding resolution failed/);
  });

  test("renders node prompt templates with inbox variables", () => {
    const assembled = assembleNodeInput({
      runtimeVariables: {},
      node: makeNode({
        promptTemplate:
          "latest={{inbox.latest.output.payload.request}} count={{inbox.count}} sender={{inbox.latest.fromNodeId}}",
      }),
      workflowId: "wf",
      workflowDescription: "Ship a release safely.",
      nodeKind: "input",
      upstream: [
        {
          fromNodeId: "divedra-manager",
          communicationId: "comm-000001",
          transitionWhen: "always",
          output: {
            payload: {
              request: "implement release flow",
            },
          },
          outputRaw:
            '{"provider":"mock","payload":{"request":"implement release flow"}}\n',
        },
      ],
      transcript: [],
    });

    expect(assembled.promptText).toBe(
      "latest=implement release flow count=1 sender=divedra-manager",
    );
  });

  test("defaults template nodeKind to task when workflow metadata omits it", () => {
    const assembled = assembleNodeInput({
      runtimeVariables: {},
      node: makeNode({
        promptTemplate: "kind={{nodeKind}}",
      }),
      workflowId: "wf",
      workflowDescription: "Ship a release safely.",
      upstream: [],
      transcript: [],
    });

    expect(assembled.promptText).toBe("kind=task");
  });

  test("supports role-authored manager nodeKind values", () => {
    const assembled = assembleNodeInput({
      runtimeVariables: {},
      node: makeNode({
        promptTemplate: "kind={{nodeKind}}",
      }),
      workflowId: "wf",
      workflowDescription: "Ship a release safely.",
      nodeKind: "manager",
      upstream: [],
      transcript: [],
    });

    expect(assembled.promptText).toBe("kind=manager");
  });

  test("supports role-authored worker nodeKind values", () => {
    const assembled = assembleNodeInput({
      runtimeVariables: {},
      node: makeNode({
        promptTemplate: "kind={{nodeKind}}",
      }),
      workflowId: "wf",
      workflowDescription: "Ship a release safely.",
      nodeKind: "worker",
      upstream: [],
      transcript: [],
    });

    expect(assembled.promptText).toBe("kind=worker");
  });
});