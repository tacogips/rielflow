import { describe, expect, test } from "vitest";
import { remapNodePayloadsForValidation } from "./api-workflow-bundle";

describe("remapNodePayloadsForValidation", () => {
  test("remaps id-keyed payloads onto explicit nodeFile paths", () => {
    const remapped = remapNodePayloadsForValidation({
      workflow: {
        workflowId: "demo",
        nodes: [
          {
            id: "worker",
            kind: "task",
            nodeFile: "nodes/node-worker.json",
            completion: { type: "none" },
          },
        ],
      },
      workflowVis: {
        nodes: [{ id: "worker", order: 0 }],
      },
      nodePayloads: {
        worker: {
          id: "worker",
          model: "gpt-5-nano",
          executionBackend: "codex-agent",
          promptTemplate: "work",
          variables: {},
        },
      },
    });

    expect(remapped["nodes/node-worker.json"]).toEqual(remapped["worker"]);
  });

  test("keeps inline-authored node payloads authoritative", () => {
    const remapped = remapNodePayloadsForValidation({
      workflow: {
        workflowId: "demo",
        nodes: [
          {
            id: "manager",
            kind: "root-manager",
            completion: { type: "none" },
            node: {
              id: "manager",
              model: "gpt-5-nano",
              executionBackend: "codex-agent",
              promptTemplate: "inline manager",
              variables: {},
            },
          },
        ],
      },
      workflowVis: {
        nodes: [{ id: "manager", order: 0 }],
      },
      nodePayloads: {
        manager: {
          id: "manager",
          model: "gpt-5-mini",
          executionBackend: "codex-agent",
          promptTemplate: "stale manager payload",
          sessionStartPromptTemplate: "stale first-turn prompt",
          variables: {},
        },
      },
    });

    expect(remapped["nodes/node-manager.json"]).toMatchObject({
      promptTemplate: "inline manager",
    });
    expect(
      remapped["nodes/node-manager.json"],
    ).not.toHaveProperty("sessionStartPromptTemplate");
  });
});
