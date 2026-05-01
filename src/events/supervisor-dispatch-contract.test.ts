import { describe, expect, test } from "vitest";
import {
  fallbackSupervisorDispatchProposalForLowConfidence,
  mapSupervisorChatDecisionToDispatchProposal,
  parseSupervisorDispatchProposal,
  validateSupervisorDispatchProposalAgainstContext,
  type WorkflowSupervisorDispatchContext,
} from "./supervisor-dispatch-contract";
import type { SupervisorChatCommandDecision } from "./supervisor-command-contract";
import type { WorkflowSupervisorProfile } from "./supervisor-profiles";

function minimalProfile(
  overrides: Partial<WorkflowSupervisorProfile> = {},
): WorkflowSupervisorProfile {
  return {
    supervisorProfileId: "p",
    profileRevision: "1",
    supervisorWorkflowName: "sup",
    managedWorkflows: [
      {
        key: "code-review",
        workflowName: "code-review-wf",
        description: "d",
        concurrency: { mode: "single-active" },
      },
    ],
    ...overrides,
  };
}

function minimalContext(
  profile: WorkflowSupervisorProfile,
): WorkflowSupervisorDispatchContext {
  return {
    supervisorConversationId: "c1",
    profile,
    sourceMessageId: "m1",
    conversationRevision: 0,
    managedRuns: [],
  };
}

describe("parseSupervisorDispatchProposal", () => {
  test("parses start-workflow proposal", () => {
    const r = parseSupervisorDispatchProposal({
      action: "start-workflow",
      reason: "user asked",
      confidence: 0.9,
      targets: [
        {
          managedWorkflowKey: "code-review",
          runAlias: "r1",
          input: { text: "go" },
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.action).toBe("start-workflow");
      expect(r.value.targets).toHaveLength(1);
      expect(r.value.targets?.[0]?.runAlias).toBe("r1");
    }
  });

  test("rejects unknown action", () => {
    const r = parseSupervisorDispatchProposal({
      action: "bogus",
      reason: "x",
    });
    expect(r.ok).toBe(false);
  });
});

describe("validateSupervisorDispatchProposalAgainstContext", () => {
  test("flags unknown managed workflow key", () => {
    const profile = minimalProfile();
    const ctx = minimalContext(profile);
    const proposal = parseSupervisorDispatchProposal({
      action: "start-workflow",
      reason: "r",
      targets: [{ managedWorkflowKey: "missing" }],
    });
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) {
      return;
    }
    const issues = validateSupervisorDispatchProposalAgainstContext(
      proposal.value,
      ctx,
    );
    expect(issues.some((i) => i.code === "unknown-managed-key")).toBe(true);
  });

  test("flags low confidence", () => {
    const profile = minimalProfile({
      conversationPolicy: { llmDecisionMinConfidence: 0.9 },
    });
    const ctx = minimalContext(profile);
    const issues = validateSupervisorDispatchProposalAgainstContext(
      {
        action: "clarify",
        reason: "low",
        confidence: 0.2,
      },
      ctx,
    );
    expect(issues.some((i) => i.code === "low-confidence")).toBe(true);
  });

  test("rejects answer-directly when policy disabled", () => {
    const profile = minimalProfile({
      directAnswerPolicy: { enabled: false },
    });
    const ctx = minimalContext(profile);
    const issues = validateSupervisorDispatchProposalAgainstContext(
      {
        action: "answer-directly",
        reason: "hi",
      },
      ctx,
    );
    expect(issues.some((i) => i.code === "direct-answer-disabled")).toBe(true);
  });

  test("rejects key-only submit-input when multiple active runs share a key", () => {
    const profile = minimalProfile({
      managedWorkflows: [
        {
          key: "code-review",
          workflowName: "code-review-wf",
          description: "d",
          concurrency: { mode: "multiple-active" },
        },
      ],
    });
    const ctx: WorkflowSupervisorDispatchContext = {
      ...minimalContext(profile),
      managedRuns: [
        {
          managedRunId: "mr-1",
          supervisorConversationId: "c1",
          managedWorkflowKey: "code-review",
          status: "running",
        },
        {
          managedRunId: "mr-2",
          supervisorConversationId: "c1",
          managedWorkflowKey: "code-review",
          status: "running",
        },
      ],
    };
    const issues = validateSupervisorDispatchProposalAgainstContext(
      {
        action: "submit-input",
        reason: "go",
        confidence: 1,
        targets: [{ managedWorkflowKey: "code-review", input: { x: 1 } }],
      },
      ctx,
    );
    expect(issues.some((i) => i.code === "ambiguous-managed-target")).toBe(
      true,
    );
  });

  test("allows key-only submit-input when per-key selection disambiguates", () => {
    const profile = minimalProfile({
      managedWorkflows: [
        {
          key: "code-review",
          workflowName: "code-review-wf",
          description: "d",
          concurrency: { mode: "multiple-active" },
        },
      ],
    });
    const ctx: WorkflowSupervisorDispatchContext = {
      ...minimalContext(profile),
      selectedManagedRunIdsByWorkflowKey: { "code-review": "mr-2" },
      managedRuns: [
        {
          managedRunId: "mr-1",
          supervisorConversationId: "c1",
          managedWorkflowKey: "code-review",
          status: "running",
        },
        {
          managedRunId: "mr-2",
          supervisorConversationId: "c1",
          managedWorkflowKey: "code-review",
          status: "running",
        },
      ],
    };
    const issues = validateSupervisorDispatchProposalAgainstContext(
      {
        action: "submit-input",
        reason: "go",
        confidence: 1,
        targets: [{ managedWorkflowKey: "code-review", input: { x: 1 } }],
      },
      ctx,
    );
    expect(issues.some((i) => i.code === "ambiguous-managed-target")).toBe(
      false,
    );
  });

  test("requires managedRunId for switch-workflow when startOnSwitch is off", () => {
    const profile = minimalProfile();
    const ctx = minimalContext(profile);
    const issues = validateSupervisorDispatchProposalAgainstContext(
      {
        action: "switch-workflow",
        reason: "pick",
        confidence: 1,
        targets: [{ managedWorkflowKey: "code-review" }],
      },
      ctx,
    );
    expect(
      issues.some((i) => i.code === "switch-workflow-requires-managed-run-id"),
    ).toBe(true);
  });

  test("allows switch-workflow without managedRunId when lifecycle.startOnSwitch", () => {
    const profile = minimalProfile({
      managedWorkflows: [
        {
          key: "code-review",
          workflowName: "code-review-wf",
          description: "d",
          concurrency: { mode: "single-active" },
          lifecycle: { startOnSwitch: true },
        },
      ],
    });
    const ctx = minimalContext(profile);
    const issues = validateSupervisorDispatchProposalAgainstContext(
      {
        action: "switch-workflow",
        reason: "pick",
        confidence: 1,
        targets: [{ managedWorkflowKey: "code-review" }],
      },
      ctx,
    );
    expect(
      issues.some((i) => i.code === "switch-workflow-requires-managed-run-id"),
    ).toBe(false);
    expect(issues.some((i) => i.code === "ambiguous-managed-target")).toBe(
      false,
    );
  });

  test("rejects ambiguous switch-workflow without managedRunId under startOnSwitch", () => {
    const profile = minimalProfile({
      managedWorkflows: [
        {
          key: "code-review",
          workflowName: "code-review-wf",
          description: "d",
          concurrency: { mode: "multiple-active" },
          lifecycle: { startOnSwitch: true },
        },
      ],
    });
    const ctx: WorkflowSupervisorDispatchContext = {
      ...minimalContext(profile),
      managedRuns: [
        {
          managedRunId: "mr-1",
          supervisorConversationId: "c1",
          managedWorkflowKey: "code-review",
          status: "running",
        },
        {
          managedRunId: "mr-2",
          supervisorConversationId: "c1",
          managedWorkflowKey: "code-review",
          status: "running",
        },
      ],
    };
    const issues = validateSupervisorDispatchProposalAgainstContext(
      {
        action: "switch-workflow",
        reason: "pick",
        confidence: 1,
        targets: [{ managedWorkflowKey: "code-review" }],
      },
      ctx,
    );
    expect(issues.some((i) => i.code === "ambiguous-managed-target")).toBe(
      true,
    );
  });

  test("rejects multi-target proposals until fanout semantics are implemented", () => {
    const profile = minimalProfile({
      managedWorkflows: [
        {
          key: "code-review",
          workflowName: "code-review-wf",
          description: "d",
          concurrency: { mode: "multiple-active" },
        },
        {
          key: "doc-review",
          workflowName: "doc-review-wf",
          description: "d2",
          concurrency: { mode: "multiple-active" },
        },
      ],
    });
    const ctx = minimalContext(profile);
    const issues = validateSupervisorDispatchProposalAgainstContext(
      {
        action: "start-workflow",
        reason: "fan out",
        confidence: 1,
        targets: [
          { managedWorkflowKey: "code-review" },
          { managedWorkflowKey: "doc-review" },
        ],
      },
      ctx,
    );
    expect(issues.some((i) => i.code === "multiple-targets-unsupported")).toBe(
      true,
    );
  });
});

describe("mapSupervisorChatDecisionToDispatchProposal", () => {
  test("maps start to start-workflow with target key", () => {
    const d: SupervisorChatCommandDecision = {
      action: "start",
      managedWorkflowName: "code-review",
      confidence: 1,
      reason: "ok",
    };
    const p = mapSupervisorChatDecisionToDispatchProposal(d);
    expect(p.action).toBe("start-workflow");
    expect(p.targets?.[0]?.managedWorkflowKey).toBe("code-review");
  });
});

describe("fallbackSupervisorDispatchProposalForLowConfidence", () => {
  test("returns clarify proposal", () => {
    const p = fallbackSupervisorDispatchProposalForLowConfidence("stale");
    expect(p.action).toBe("clarify");
    expect(p.confidence).toBe(1);
  });
});
