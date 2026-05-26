import type { EventSupervisedRunRepository } from "../../events/supervised-runs";
import type { EventSupervisedRunRecord } from "../../events/types";
import type { SupervisedWorkflowLookup } from "../supervisor-client-types";
import type { LoadOptions } from "../types";
import {
  reconcileTerminalSupervisedRunForCorrelation,
  reconcileTerminalSupervisedRunRecord,
  requireNonEmptyLookupValue,
} from "./supervisor-client-helpers";

export async function resolveSupervisedWorkflowLookupRecord(
  input: SupervisedWorkflowLookup,
  repo: EventSupervisedRunRepository,
  options: LoadOptions,
): Promise<EventSupervisedRunRecord> {
  if (input.supervisedRunId !== undefined && input.supervisedRunId.length > 0) {
    const byId = await repo.loadById(input.supervisedRunId);
    if (byId === null) {
      throw new Error(`unknown supervised run '${input.supervisedRunId}'`);
    }
    return await reconcileTerminalSupervisedRunRecord(byId, repo, options);
  }
  if (
    input.workflowExecutionId !== undefined &&
    input.workflowExecutionId.length > 0
  ) {
    const byExecutionId = await repo.loadByActiveTargetExecutionId(
      input.workflowExecutionId,
    );
    if (byExecutionId === null) {
      throw new Error(
        `unknown supervised workflow execution '${input.workflowExecutionId}'`,
      );
    }
    return await reconcileTerminalSupervisedRunRecord(
      byExecutionId,
      repo,
      options,
    );
  }
  const targetWorkflowName = input.workflowKey ?? input.alias;
  if (targetWorkflowName !== undefined) {
    return await resolveTargetWorkflowLookupRecord(
      targetWorkflowName,
      input.workflowKey === undefined ? "alias" : "workflowKey",
      repo,
      options,
    );
  }
  const hasCorrelationLookup =
    input.sourceId !== undefined ||
    input.bindingId !== undefined ||
    input.correlationKey !== undefined;
  if (hasCorrelationLookup) {
    return await resolveCorrelationLookupRecord(input, repo, options);
  }
  if (input.idempotencyKey !== undefined && input.idempotencyKey.length > 0) {
    const byCommandId = await repo.loadByCommandId(input.idempotencyKey);
    if (byCommandId === null) {
      throw new Error("no supervised run matches the lookup");
    }
    return await reconcileTerminalSupervisedRunRecord(
      byCommandId,
      repo,
      options,
    );
  }
  return await resolveCorrelationLookupRecord(input, repo, options);
}

async function resolveCorrelationLookupRecord(
  input: SupervisedWorkflowLookup,
  repo: EventSupervisedRunRepository,
  options: LoadOptions,
): Promise<EventSupervisedRunRecord> {
  if (
    input.sourceId === undefined ||
    input.bindingId === undefined ||
    input.correlationKey === undefined
  ) {
    throw new Error(
      "supervised workflow lookup requires supervisedRunId or sourceId+bindingId+correlationKey",
    );
  }
  const sourceId = requireNonEmptyLookupValue(input.sourceId, "input.sourceId");
  const bindingId = requireNonEmptyLookupValue(
    input.bindingId,
    "input.bindingId",
  );
  const correlationKey = requireNonEmptyLookupValue(
    input.correlationKey,
    "input.correlationKey",
  );
  await reconcileTerminalSupervisedRunForCorrelation(
    {
      sourceId,
      bindingId,
      correlationKey,
    },
    repo,
    options,
  );
  const latest = await repo.findLatestByCorrelation({
    sourceId,
    bindingId,
    correlationKey,
  });
  if (latest === null) {
    throw new Error("no supervised run matches the lookup");
  }
  return await reconcileTerminalSupervisedRunRecord(latest, repo, options);
}

async function resolveTargetWorkflowLookupRecord(
  targetWorkflowNameInput: string,
  label: "alias" | "workflowKey",
  repo: EventSupervisedRunRepository,
  options: LoadOptions,
): Promise<EventSupervisedRunRecord> {
  const targetWorkflowName = requireNonEmptyLookupValue(
    targetWorkflowNameInput,
    `input.${label}`,
  );
  const activeCandidates =
    await repo.findActiveByTargetWorkflowName(targetWorkflowName);
  const activeRecords = [] as EventSupervisedRunRecord[];
  for (const candidate of activeCandidates) {
    const reconciled = await reconcileTerminalSupervisedRunRecord(
      candidate,
      repo,
      options,
    );
    if (
      reconciled.status === "starting" ||
      reconciled.status === "running" ||
      reconciled.status === "stopping" ||
      reconciled.status === "restarting"
    ) {
      activeRecords.push(reconciled);
    }
  }
  if (activeRecords.length > 1) {
    throw new Error(
      `supervised workflow lookup by ${label} '${targetWorkflowName}' is ambiguous; use runnerPoolRunId, supervisedRunId, workflowExecutionId, or sourceId+bindingId+correlationKey`,
    );
  }
  const active = activeRecords[0];
  if (active !== undefined) {
    return active;
  }
  const latest = await repo.findLatestByTargetWorkflowName(targetWorkflowName);
  if (latest === null) {
    throw new Error(
      `no supervised run matches ${label} '${targetWorkflowName}'`,
    );
  }
  return await reconcileTerminalSupervisedRunRecord(latest, repo, options);
}
