import { afterEach, describe, expect, test, vi } from "vitest";
import type { EventBinding, ExternalEventEnvelope } from "./types";
import { planSupervisedLlmBindingsDispatch } from "./supervisor-llm-batch";
import * as supervisorIntent from "./supervisor-intent";
import type { WorkflowTriggerRunnerOptions } from "./trigger-runner";

function llmBinding(input: {
  readonly id: string;
  readonly workflowName: string;
  readonly allowMultiTarget?: boolean;
}): EventBinding {
  return {
    id: input.id,
    sourceId: "src",
    workflowName: input.workflowName,
    inputMapping: { mode: "event-input" },
    execution: {
      mode: "supervised",
      control: {
        intentMapping: {
          mode: "llm-command",
          resolverWorkflowName: "r",
          resolverNodeId: "n",
          ...(input.allowMultiTarget === true
            ? { allowMultiTargetCommands: true }
            : {}),
        },
      },
    },
  };
}

function event(input: { readonly text: string }): ExternalEventEnvelope {
  return {
    sourceId: "src",
    eventId: "e1",
    provider: "p",
    eventType: "t",
    receivedAt: "2026-04-29T00:00:00.000Z",
    dedupeKey: "d1",
    input: { text: input.text },
  };
}

const baseOptions = {
  workflowRoot: "/tmp",
  artifactRoot: "/tmp/a",
  sessionStoreRoot: "/tmp/s",
  rootDataDir: "/tmp/d",
  cwd: "/tmp",
} as const satisfies WorkflowTriggerRunnerOptions;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("planSupervisedLlmBindingsDispatch", () => {
  test("returns per-binding when at most one llm-command supervised binding", async () => {
    const plan = await planSupervisedLlmBindingsDispatch({
      bindings: [llmBinding({ id: "b1", workflowName: "wf-a" })],
      event: event({ text: "hi" }),
      options: baseOptions,
    });
    expect(plan).toEqual({ kind: "per-binding" });
  });

  test("marks destructive multi-match as ambiguous and caches intents for all bindings", async () => {
    const spy = vi
      .spyOn(supervisorIntent, "resolveSupervisorIntentAsync")
      .mockImplementation(async ({ binding }) => {
        if (binding.id === "b1") {
          return { outcome: "action", action: "stop" };
        }
        return { outcome: "action", action: "stop" };
      });

    const plan = await planSupervisedLlmBindingsDispatch({
      bindings: [
        llmBinding({ id: "b1", workflowName: "wf-alpha" }),
        llmBinding({ id: "b2", workflowName: "wf-beta" }),
      ],
      event: event({ text: "stop" }),
      options: baseOptions,
    });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(plan.kind).toBe("ambiguous");
    if (plan.kind !== "ambiguous") return;
    expect(plan.bindingIds).toEqual(["b1", "b2"]);
    const i1 = plan.intents.get("b1");
    const i2 = plan.intents.get("b2");
    expect(i1?.outcome).toBe("skip");
    expect(i2?.outcome).toBe("skip");
    expect(i1?.outcome === "skip" ? i1.reason : "").toContain("ambiguous");
  });

  test("disambiguates destructive fanout when event text names one workflow", async () => {
    vi.spyOn(
      supervisorIntent,
      "resolveSupervisorIntentAsync",
    ).mockImplementation(async () => {
      return { outcome: "action", action: "stop" };
    });

    const plan = await planSupervisedLlmBindingsDispatch({
      bindings: [
        llmBinding({ id: "b1", workflowName: "wf-alpha" }),
        llmBinding({ id: "b2", workflowName: "wf-beta" }),
      ],
      event: event({ text: "please stop wf-alpha now" }),
      options: baseOptions,
    });

    expect(plan.kind).toBe("ready");
    if (plan.kind !== "ready") return;
    expect(plan.intents.get("b1")).toEqual({
      outcome: "action",
      action: "stop",
    });
    const b2Intent = plan.intents.get("b2");
    expect(b2Intent?.outcome).toBe("skip");
    expect(b2Intent?.outcome === "skip" ? b2Intent.reason : "").toContain(
      "wf-alpha",
    );
  });

  test("allows destructive fanout when every binding opts into multi-target", async () => {
    vi.spyOn(
      supervisorIntent,
      "resolveSupervisorIntentAsync",
    ).mockResolvedValue({
      outcome: "action",
      action: "stop",
    });

    const plan = await planSupervisedLlmBindingsDispatch({
      bindings: [
        llmBinding({ id: "b1", workflowName: "wf-a", allowMultiTarget: true }),
        llmBinding({ id: "b2", workflowName: "wf-b", allowMultiTarget: true }),
      ],
      event: event({ text: "stop everything" }),
      options: baseOptions,
    });

    expect(plan.kind).toBe("ready");
    if (plan.kind !== "ready") return;
    expect(plan.intents.get("b1")).toEqual({
      outcome: "action",
      action: "stop",
    });
    expect(plan.intents.get("b2")).toEqual({
      outcome: "action",
      action: "stop",
    });
  });
});
