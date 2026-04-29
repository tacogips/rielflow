import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MAX_SUPERVISED_ATTEMPTS,
  DEFAULT_MAX_WORKFLOW_PATCHES,
  DEFAULT_MONITOR_INTERVAL_MS,
  DEFAULT_STALL_TIMEOUT_MS,
  DEFAULT_SUPERVISER_WORKFLOW_ID,
  DEFAULT_WORKFLOW_MUTATION_MODE,
  normalizeAutoImprovePolicy,
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

  test("returns undefined when auto-improve is disabled", () => {
    const result = normalizeAutoImprovePolicy({ enabled: false });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toBeUndefined();
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
});