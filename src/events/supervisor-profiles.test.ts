import { describe, expect, test } from "vitest";
import {
  parseWorkflowSupervisorProfile,
  validateSupervisorProfileAgainstCatalog,
} from "./supervisor-profiles";

describe("parseWorkflowSupervisorProfile", () => {
  test("parses a minimal valid profile with managed workflows", () => {
    const parsed = parseWorkflowSupervisorProfile({
      supervisorProfileId: "p1",
      profileRevision: "r1",
      supervisorWorkflowName: "sup-wf",
      managedWorkflows: [
        {
          key: "a",
          workflowName: "wf-a",
          description: "d",
          concurrency: { mode: "single-active" },
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.supervisorProfileId).toBe("p1");
      expect(parsed.value.managedWorkflows).toHaveLength(1);
      expect(parsed.value.managedWorkflows[0]?.key).toBe("a");
    }
  });

  test("rejects empty managed catalog without direct answers", () => {
    const parsed = parseWorkflowSupervisorProfile({
      supervisorProfileId: "p1",
      profileRevision: "r1",
      supervisorWorkflowName: "sup-wf",
      managedWorkflows: [],
    });
    expect(parsed.ok).toBe(false);
  });

  test("allows empty managed catalog when direct answers enabled", () => {
    const parsed = parseWorkflowSupervisorProfile({
      supervisorProfileId: "p1",
      profileRevision: "r1",
      supervisorWorkflowName: "sup-wf",
      managedWorkflows: [],
      directAnswerPolicy: { enabled: true },
    });
    expect(parsed.ok).toBe(true);
  });

  test("rejects allowedDecisionKinds when direct answers disabled", () => {
    const parsed = parseWorkflowSupervisorProfile({
      supervisorProfileId: "p1",
      profileRevision: "r1",
      supervisorWorkflowName: "sup-wf",
      managedWorkflows: [
        {
          key: "a",
          workflowName: "wf-a",
          description: "d",
          concurrency: { mode: "single-active" },
        },
      ],
      directAnswerPolicy: {
        enabled: false,
        allowedDecisionKinds: ["status"],
      },
    });
    expect(parsed.ok).toBe(false);
  });

  test("rejects conflicting lifecycle flags", () => {
    const parsed = parseWorkflowSupervisorProfile({
      supervisorProfileId: "p1",
      profileRevision: "r1",
      supervisorWorkflowName: "sup-wf",
      managedWorkflows: [
        {
          key: "a",
          workflowName: "wf-a",
          description: "d",
          concurrency: { mode: "single-active" },
          lifecycle: { stopOnSwitch: true, startOnSwitch: true },
        },
      ],
    });
    expect(parsed.ok).toBe(false);
  });

  test("requires explicit alias policy for multiple-active", () => {
    const parsed = parseWorkflowSupervisorProfile({
      supervisorProfileId: "p1",
      profileRevision: "r1",
      supervisorWorkflowName: "sup-wf",
      managedWorkflows: [
        {
          key: "a",
          workflowName: "wf-a",
          description: "d",
          concurrency: { mode: "multiple-active" },
        },
      ],
    });
    expect(parsed.ok).toBe(false);

    const ok = parseWorkflowSupervisorProfile({
      supervisorProfileId: "p1",
      profileRevision: "r1",
      supervisorWorkflowName: "sup-wf",
      managedWorkflows: [
        {
          key: "a",
          workflowName: "wf-a",
          description: "d",
          concurrency: {
            mode: "multiple-active",
            requiresAliasForParallelRuns: true,
          },
        },
      ],
    });
    expect(ok.ok).toBe(true);
  });
});

describe("validateSupervisorProfileAgainstCatalog", () => {
  test("reports missing supervisor and managed workflow names", () => {
    const parsed = parseWorkflowSupervisorProfile({
      supervisorProfileId: "p1",
      profileRevision: "r1",
      supervisorWorkflowName: "sup-wf",
      managedWorkflows: [
        {
          key: "a",
          workflowName: "wf-a",
          description: "d",
          concurrency: { mode: "single-active" },
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const issues = validateSupervisorProfileAgainstCatalog(parsed.value, new Set());
    expect(issues.length).toBeGreaterThanOrEqual(1);
  });

  test("passes when catalog contains all names", () => {
    const parsed = parseWorkflowSupervisorProfile({
      supervisorProfileId: "p1",
      profileRevision: "r1",
      supervisorWorkflowName: "sup-wf",
      managedWorkflows: [
        {
          key: "a",
          workflowName: "wf-a",
          description: "d",
          concurrency: { mode: "single-active" },
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const issues = validateSupervisorProfileAgainstCatalog(
      parsed.value,
      new Set(["sup-wf", "wf-a"]),
    );
    expect(issues).toEqual([]);
  });
});
