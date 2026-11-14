import { rm } from "node:fs/promises";
import { createManagerSessionStore } from "./manager-session-store";
import {
  resolveAttachmentRoot,
  resolveEffectiveRoots,
  resolveWorkflowScopedPath,
} from "./paths";
import { deleteRuntimeSession, loadRuntimeSessionSummary } from "./runtime-db";
import {
  sessionReferencesWorkflowExecutionAsContinuationSource,
  type SessionStatus,
} from "./session";
import {
  deleteSession,
  listSessions,
  loadSession,
  type SessionStoreOptions,
} from "./session-store";

export interface DeleteWorkflowSessionHistoryInput {
  readonly sessionId: string;
  readonly workflowId: string;
  readonly workflowName: string;
}

function isNonTerminalSessionStatus(status: SessionStatus): boolean {
  return status === "paused" || status === "running";
}

async function listContinuationDependentsOfWorkflowExecution(
  targetWorkflowExecutionId: string,
  options: SessionStoreOptions,
): Promise<readonly string[]> {
  const listed = await listSessions(options);
  if (!listed.ok) {
    throw new Error(listed.error.message);
  }
  const dependents: string[] = [];
  for (const sessionId of listed.value) {
    if (sessionId === targetWorkflowExecutionId) {
      continue;
    }
    const loaded = await loadSession(sessionId, options);
    if (!loaded.ok) {
      continue;
    }
    if (
      sessionReferencesWorkflowExecutionAsContinuationSource(
        loaded.value,
        targetWorkflowExecutionId,
      )
    ) {
      dependents.push(sessionId);
    }
  }
  return dependents.sort((left, right) => left.localeCompare(right));
}

function assertMatchingWorkflowIdentity(input: {
  readonly actualWorkflowId: string;
  readonly actualWorkflowName: string;
  readonly expected: DeleteWorkflowSessionHistoryInput;
  readonly label: string;
}): void {
  if (
    input.expected.workflowId !== input.actualWorkflowId ||
    input.expected.workflowName !== input.actualWorkflowName
  ) {
    throw new Error(
      `${input.label} for workflow run '${input.expected.sessionId}' does not match the stored workflow identity`,
    );
  }
}

async function resolveDeletionWorkflowId(
  input: DeleteWorkflowSessionHistoryInput,
  options: SessionStoreOptions,
): Promise<string> {
  const runtimeSummary = await loadRuntimeSessionSummary(
    input.sessionId,
    options,
  );
  if (runtimeSummary !== null) {
    assertMatchingWorkflowIdentity({
      actualWorkflowId: runtimeSummary.workflowId,
      actualWorkflowName: runtimeSummary.workflowName,
      expected: input,
      label: "runtime session summary",
    });
    if (isNonTerminalSessionStatus(runtimeSummary.status)) {
      throw new Error(
        `cannot delete workflow run '${input.sessionId}' while it is ${runtimeSummary.status}`,
      );
    }
  }

  const persistedSessionResult = await loadSession(input.sessionId, options);
  if (persistedSessionResult.ok) {
    assertMatchingWorkflowIdentity({
      actualWorkflowId: persistedSessionResult.value.workflowId,
      actualWorkflowName: persistedSessionResult.value.workflowName,
      expected: input,
      label: "persisted session",
    });
    if (isNonTerminalSessionStatus(persistedSessionResult.value.status)) {
      throw new Error(
        `cannot delete workflow run '${input.sessionId}' while it is ${persistedSessionResult.value.status}`,
      );
    }
    return persistedSessionResult.value.workflowId;
  }

  if (runtimeSummary !== null) {
    return runtimeSummary.workflowId;
  }

  return input.workflowId;
}

export async function deleteWorkflowSessionHistory(
  input: DeleteWorkflowSessionHistoryInput,
  options: SessionStoreOptions = {},
): Promise<void> {
  const workflowId = await resolveDeletionWorkflowId(input, options);

  const dependents = await listContinuationDependentsOfWorkflowExecution(
    input.sessionId,
    options,
  );
  if (dependents.length > 0) {
    throw new Error(
      `cannot delete workflow run '${input.sessionId}' while other executions still reference its history: ${dependents.join(", ")}`,
    );
  }

  const deletedSession = await deleteSession(input.sessionId, options);
  if (!deletedSession.ok && deletedSession.error.code !== "NOT_FOUND") {
    throw new Error(deletedSession.error.message);
  }

  await deleteRuntimeSession(input.sessionId, options);
  await createManagerSessionStore(options).deleteByWorkflowExecutionId(
    input.sessionId,
  );

  const roots = resolveEffectiveRoots(options);
  const attachmentRoot = resolveAttachmentRoot(options);
  const pathsToDelete: string[] = [];

  const executionRoot = resolveWorkflowScopedPath(
    roots.artifactRoot,
    workflowId,
    "executions",
    input.sessionId,
  );
  if (executionRoot !== undefined) {
    pathsToDelete.push(executionRoot);
  }

  const attachmentDirectory = resolveWorkflowScopedPath(
    attachmentRoot,
    workflowId,
    input.sessionId,
  );
  if (attachmentDirectory !== undefined) {
    pathsToDelete.push(attachmentDirectory);
  }

  await Promise.all(
    pathsToDelete.map((targetPath) =>
      rm(targetPath, { force: true, recursive: true }),
    ),
  );
}
