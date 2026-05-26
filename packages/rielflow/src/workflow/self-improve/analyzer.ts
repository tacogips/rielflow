import type { NormalizedWorkflowBundle } from "../types";
import type {
  WorkflowPurposeAchievement,
  WorkflowSelfImproveFinding,
  WorkflowSelfImproveSourceNodeExecution,
  WorkflowSelfImproveSourceRun,
} from "./types";

export interface WorkflowSelfImproveAnalysis {
  readonly purposeAchievement: WorkflowPurposeAchievement;
  readonly findings: readonly WorkflowSelfImproveFinding[];
  readonly recommendedActions: readonly string[];
}

const UNFINISHED_SESSION_STATUSES = new Set(["failed", "cancelled", "paused"]);
const FAILED_NODE_STATUSES = new Set(["failed", "timed_out", "cancelled"]);

function nodeExecutions(
  runs: readonly WorkflowSelfImproveSourceRun[],
): readonly WorkflowSelfImproveSourceNodeExecution[] {
  return runs.flatMap((run) => run.nodeExecutions ?? []);
}

function sessionsForNodeExecutions(
  runs: readonly WorkflowSelfImproveSourceRun[],
  executions: readonly WorkflowSelfImproveSourceNodeExecution[],
): readonly string[] {
  const executionIds = new Set(
    executions.map((execution) => execution.nodeExecId),
  );
  return runs
    .filter((run) =>
      (run.nodeExecutions ?? []).some((execution) =>
        executionIds.has(execution.nodeExecId),
      ),
    )
    .map((run) => run.sessionId);
}

export function analyzeWorkflowSelfImprove(input: {
  readonly bundle: NormalizedWorkflowBundle;
  readonly sourceRuns: readonly WorkflowSelfImproveSourceRun[];
}): WorkflowSelfImproveAnalysis {
  const findings: WorkflowSelfImproveFinding[] = [];
  const failedRuns = input.sourceRuns.filter((run) =>
    UNFINISHED_SESSION_STATUSES.has(run.status),
  );
  const completedRuns = input.sourceRuns.filter(
    (run) => run.status === "completed",
  );
  const allNodeExecutions = nodeExecutions(input.sourceRuns);
  const failedNodeExecutions = allNodeExecutions.filter((execution) =>
    FAILED_NODE_STATUSES.has(execution.status),
  );
  const validationErrorExecutions = allNodeExecutions.filter(
    (execution) =>
      execution.outputValidationErrors !== undefined &&
      execution.outputValidationErrors.length > 0,
  );

  let purposeAchievement: WorkflowPurposeAchievement = "unknown";
  if (input.sourceRuns.length === 0) {
    findings.push({
      severity: "low",
      category: "runtime",
      message:
        "No workflow executions were selected, so purpose achievement cannot be judged.",
      evidenceSessionIds: [],
    });
  } else if (
    failedRuns.length === input.sourceRuns.length ||
    (input.sourceRuns.length > 0 &&
      allNodeExecutions.length > 0 &&
      failedNodeExecutions.length === allNodeExecutions.length)
  ) {
    purposeAchievement = "not-achieved";
    findings.push({
      severity: "high",
      category: "purpose",
      message:
        "All selected workflow executions failed or all recorded node executions failed.",
      evidenceSessionIds: [
        ...new Set([
          ...failedRuns.map((run) => run.sessionId),
          ...sessionsForNodeExecutions(input.sourceRuns, failedNodeExecutions),
        ]),
      ],
      stepIds: failedNodeExecutions
        .map((execution) => execution.stepId)
        .filter((stepId): stepId is string => stepId !== undefined),
      nodeIds: failedNodeExecutions.map((execution) => execution.nodeId),
    });
  } else if (
    failedRuns.length > 0 ||
    failedNodeExecutions.length > 0 ||
    validationErrorExecutions.length > 0
  ) {
    purposeAchievement = "partially-achieved";
    findings.push({
      severity: "mid",
      category: "purpose",
      message:
        "Selected workflow executions include failed sessions, failed node executions, or output-contract validation errors.",
      evidenceSessionIds: [
        ...new Set([
          ...failedRuns.map((run) => run.sessionId),
          ...sessionsForNodeExecutions(input.sourceRuns, failedNodeExecutions),
          ...sessionsForNodeExecutions(
            input.sourceRuns,
            validationErrorExecutions,
          ),
        ]),
      ],
      stepIds: [
        ...new Set(
          [...failedNodeExecutions, ...validationErrorExecutions]
            .map((execution) => execution.stepId)
            .filter((stepId): stepId is string => stepId !== undefined),
        ),
      ],
      nodeIds: [
        ...new Set(
          [...failedNodeExecutions, ...validationErrorExecutions].map(
            (execution) => execution.nodeId,
          ),
        ),
      ],
    });
  } else if (completedRuns.length > 0 && allNodeExecutions.length > 0) {
    purposeAchievement = "achieved";
  } else if (completedRuns.length > 0) {
    findings.push({
      severity: "low",
      category: "runtime",
      message:
        "Selected completed workflow executions have no recorded node execution evidence.",
      evidenceSessionIds: completedRuns.map((run) => run.sessionId),
    });
  }

  if (failedNodeExecutions.length > 0) {
    findings.push({
      severity: "mid",
      category: "runtime",
      message:
        "One or more selected source runs contain failed, timed-out, or cancelled node executions.",
      evidenceSessionIds: sessionsForNodeExecutions(
        input.sourceRuns,
        failedNodeExecutions,
      ),
      stepIds: [
        ...new Set(
          failedNodeExecutions
            .map((execution) => execution.stepId)
            .filter((stepId): stepId is string => stepId !== undefined),
        ),
      ],
      nodeIds: [
        ...new Set(failedNodeExecutions.map((execution) => execution.nodeId)),
      ],
    });
  }

  if (validationErrorExecutions.length > 0) {
    findings.push({
      severity: "mid",
      category: "runtime",
      message:
        "One or more selected source runs contain node output-contract validation errors.",
      evidenceSessionIds: sessionsForNodeExecutions(
        input.sourceRuns,
        validationErrorExecutions,
      ),
      stepIds: [
        ...new Set(
          validationErrorExecutions
            .map((execution) => execution.stepId)
            .filter((stepId): stepId is string => stepId !== undefined),
        ),
      ],
      nodeIds: [
        ...new Set(
          validationErrorExecutions.map((execution) => execution.nodeId),
        ),
      ],
    });
  }

  const workflow = input.bundle.workflow;
  if (workflow.description.trim().length === 0) {
    findings.push({
      severity: "mid",
      category: "structure",
      message:
        "Workflow description is empty, which weakens purpose-achievement assessment.",
      evidenceSessionIds: input.sourceRuns.map((run) => run.sessionId),
    });
  }
  if (workflow.steps.length === 0) {
    findings.push({
      severity: "high",
      category: "structure",
      message: "Workflow has no executable steps.",
      evidenceSessionIds: input.sourceRuns.map((run) => run.sessionId),
    });
  }

  const weakPromptNodeIds = Object.entries(input.bundle.nodePayloads)
    .filter(([, payload]) => {
      const prompt = "promptTemplate" in payload ? payload.promptTemplate : "";
      return typeof prompt !== "string" || prompt.trim().length < 20;
    })
    .map(([nodeId]) => nodeId);
  if (weakPromptNodeIds.length > 0) {
    findings.push({
      severity: "low",
      category: "prompt",
      message:
        "One or more node prompts are very short or missing after prompt-template resolution.",
      evidenceSessionIds: input.sourceRuns.map((run) => run.sessionId),
      nodeIds: weakPromptNodeIds,
    });
  }

  const recommendedActions =
    findings.length === 0
      ? ["Keep monitoring future workflow executions for regressions."]
      : findings.map((finding) => finding.message);

  return { purposeAchievement, findings, recommendedActions };
}
