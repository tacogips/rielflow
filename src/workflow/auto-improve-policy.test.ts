import { describe, expect, test } from "bun:test";
import {
  applyWorkflowSupervisionDefaults,
  DEFAULT_MAX_SUPERVISED_ATTEMPTS,
  DEFAULT_MAX_WORKFLOW_PATCHES,
  DEFAULT_MONITOR_INTERVAL_MS,
  DEFAULT_STALL_TIMEOUT_MS,
  DEFAULT_SUPERVISER_WORKFLOW_ID,
  DEFAULT_WORKFLOW_MUTATION_MODE,
  normalizeAutoImprovePolicy,
  parseAutoImprovePolicyInput,
  resolveSuperviserWorkflowId,
} from "./auto-improve-policy";

describe("normalizeAutoImprovePolicy", () => {
  test("applies shared defaults for enabled auto-improve policies", () => {
    const result = normalizeAutoImprovePolicy({ enabled: true });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toEqual({
      enabled: true,
      superviserWorkflowId: DEFAULT_SUPERVISER_WORKFLOW_ID,
      monitorIntervalMs: DEFAULT_MONITOR_INTERVAL_MS,
      stallTimeoutMs: DEFAULT_STALL_TIMEOUT_MS,
      maxSupervisedAttempts: DEFAULT_MAX_SUPERVISED_ATTEMPTS,
      maxWorkflowPatches: DEFAULT_MAX_WORKFLOW_PATCHES,
      workflowMutationMode: DEFAULT_WORKFLOW_MUTATION_MODE,
    });
  });

  test("maps disabled auto-improve to lifecycle-only supervision", () => {
    const result = normalizeAutoImprovePolicy({ enabled: false });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value?.enabled).toBe(true);
    expect(result.value?.maxWorkflowPatches).toBe(0);
  });

  test("rejects disabled auto-improve payloads that still include policy fields", () => {
    const result = normalizeAutoImprovePolicy({
      enabled: false,
      monitorIntervalMs: 1000,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toBe(
      "autoImprove settings require enabled=true when additional policy fields are provided",
    );
  });

  test("rejects whitespace-only superviser workflow ids", () => {
    const result = normalizeAutoImprovePolicy({
      enabled: true,
      superviserWorkflowId: "   ",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toBe(
      "superviserWorkflowId must not be empty when provided",
    );
  });

  test("trims explicit superviser workflow ids before persisting policy", () => {
    const result = normalizeAutoImprovePolicy({
      enabled: true,
      superviserWorkflowId: "  divedra/custom-superviser  ",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value?.superviserWorkflowId).toBe(
      "divedra/custom-superviser",
    );
  });

  test("reuses the shared superviser workflow id fallback", () => {
    const result = resolveSuperviserWorkflowId(undefined);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toBe(DEFAULT_SUPERVISER_WORKFLOW_ID);
  });

  test("allows zero workflow patches for lifecycle-only supervision", () => {
    const result = normalizeAutoImprovePolicy({
      enabled: true,
      maxWorkflowPatches: 0,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value?.maxWorkflowPatches).toBe(0);
  });

  test("rejects invalid runtime workflow mutation modes", () => {
    const result = normalizeAutoImprovePolicy({
      enabled: true,
      workflowMutationMode: "invalid-mode" as unknown as
        | "execution-copy"
        | "in-place",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toBe(
      "workflowMutationMode must be 'execution-copy' or 'in-place' when provided",
    );
  });

  test("rejects a stall timeout shorter than the monitor interval", () => {
    const result = normalizeAutoImprovePolicy({
      enabled: true,
      monitorIntervalMs: 5000,
      stallTimeoutMs: 4999,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toBe(
      "stallTimeoutMs must be greater than or equal to monitorIntervalMs",
    );
  });

  test("rejects non-string superviser workflow ids from untyped callers", () => {
    const result = normalizeAutoImprovePolicy({
      enabled: true,
      superviserWorkflowId: 123 as unknown as string,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toBe(
      "superviserWorkflowId must be a string when provided",
    );
  });

  test("preserves explicit targeted-rerun disablement", () => {
    const result = normalizeAutoImprovePolicy({
      enabled: true,
      allowTargetedRerun: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value?.allowTargetedRerun).toBe(false);
  });

  test("applies workflow supervision defaults only to omitted input values", () => {
    expect(
      applyWorkflowSupervisionDefaults(
        {
          enabled: true,
          stallTimeoutMs: DEFAULT_STALL_TIMEOUT_MS,
          maxWorkflowPatches: 0,
        },
        {
          monitorIntervalMs: 12_000,
          stallTimeoutMs: 900_000,
          maxWorkflowPatches: 9,
        },
      ),
    ).toEqual({
      enabled: true,
      monitorIntervalMs: 12_000,
      stallTimeoutMs: DEFAULT_STALL_TIMEOUT_MS,
      maxWorkflowPatches: 0,
    });
  });

  test("normalizes workflow supervision defaults after applying them", () => {
    const result = normalizeAutoImprovePolicy(
      applyWorkflowSupervisionDefaults(
        { enabled: true },
        {
          superviserWorkflowId: DEFAULT_SUPERVISER_WORKFLOW_ID,
          monitorIntervalMs: 12_000,
          stallTimeoutMs: 900_000,
          maxSupervisedAttempts: DEFAULT_MAX_SUPERVISED_ATTEMPTS,
          maxWorkflowPatches: 9,
          workflowMutationMode: DEFAULT_WORKFLOW_MUTATION_MODE,
        },
      ),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toMatchObject({
      monitorIntervalMs: 12_000,
      stallTimeoutMs: 900_000,
      maxWorkflowPatches: 9,
    });
  });
});

describe("parseAutoImprovePolicyInput", () => {
  test("accepts raw nested superviser auto-improve policy input", () => {
    const result = parseAutoImprovePolicyInput(
      {
        enabled: true,
        monitorIntervalMs: 1500,
        workflowMutationMode: "execution-copy",
        allowTargetedRerun: false,
      },
      "args.autoImprove",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toEqual({
      enabled: true,
      monitorIntervalMs: 1500,
      workflowMutationMode: "execution-copy",
      allowTargetedRerun: false,
    });
  });

  test("preserves parser validation messages for raw policy input", () => {
    const result = parseAutoImprovePolicyInput(
      {
        enabled: true,
        maxWorkflowPatches: Number.NaN,
      },
      "args.autoImprove",
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toBe(
      "args.autoImprove.maxWorkflowPatches must be a finite number when provided",
    );
  });
});
