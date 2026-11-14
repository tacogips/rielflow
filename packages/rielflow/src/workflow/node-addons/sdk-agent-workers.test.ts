import { describe, expect, test } from "vitest";
import { resolveBuiltinNodeAddonPayload } from "./addon-payload-resolution";

describe("SDK-backed built-in worker add-ons", () => {
  test.each([
    {
      addonName: "rielflow/codex-sdk-worker",
      backend: "official/openai-sdk",
      model: "gpt-5-codex",
    },
    {
      addonName: "rielflow/claude-sdk-worker",
      backend: "official/anthropic-sdk",
      model: "claude-sonnet-4-5",
    },
    {
      addonName: "rielflow/cursor-sdk-worker",
      backend: "official/cursor-sdk",
      model: "composer-2",
    },
  ])("resolves $addonName to $backend", ({ addonName, backend, model }) => {
    const resolved = resolveBuiltinNodeAddonPayload({
      nodeId: "worker",
      path: "workflow.nodes[0].addon",
      addon: {
        name: addonName,
        version: "1",
        config: {
          model,
          promptTemplate: "Summarize {{topic}}",
          systemPromptTemplate: "Be concise.",
          timeoutMs: 5000,
        },
        inputs: { topic: "rielflow" },
      },
    });

    expect(resolved.issues).toEqual([]);
    expect(resolved.payload).toMatchObject({
      id: "worker",
      model,
      executionBackend: backend,
      promptTemplate: "Summarize {{topic}}",
      systemPromptTemplate: "Be concise.",
      variables: { topic: "rielflow" },
      addon: {
        name: addonName,
        version: "1",
        config: { model, promptTemplate: "Summarize {{topic}}" },
        inputs: { topic: "rielflow" },
      },
      timeoutMs: 5000,
    });
  });
});
