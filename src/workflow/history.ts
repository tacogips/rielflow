import { rm } from "node:fs/promises";
import { loadWorkflowFromDisk } from "./load";
import { createManagerSessionStore } from "./manager-session-store";
import {
  resolveAttachmentRoot,
  resolveWorkflowScopedPath,
} from "./paths";
import { listRuntimeSessions } from "./runtime-db";
import {
  listSessions,
  loadSession,
  type SessionStoreOptions,
} from "./session-store";
import { deleteWorkflowSessionHistory } from "./session-history";
import type { SessionStatus } from "./session";
import type { LoadOptions } from "./types";

export interface DeleteWorkflowHistoryInput
  extends LoadOptions,
    SessionStoreOptions {
  readonly workflowId: string;
  readonly workflowName: string;
}

export interface DeleteWorkflowHistoryResult {
  readonly deletedSessionCount: number;
  readonly workflowId: string;
  readonly workflowName: string;
}

function isNonTerminalStatus(status: SessionStatus): boolean {
  return status === "running" || status === "paused";
}

async function collectSessionStates(input: {
  readonly options: DeleteWorkflowHistoryInput;
  readonly workflowId: string;
}): Promise<ReadonlyMap<string, SessionStatus>> {
  const states = new Map<string, SessionStatus>();

  for (const session of await listRuntimeSessions(input.options)) {
    if (session.workflowId === input.workflowId) {
      states.set(session.sessionId, session.status);
    }
  }

  const listedSessions = await listSessions(input.options);
  if (!listedSessions.ok) {
    throw new Error(listedSessions.error.message);
  }

  for (const sessionId of listedSessions.value) {
    const loadedSession = await loadSession(sessionId, input.options);
    if (!loadedSession.ok || loadedSession.value.workflowId !== input.workflowId) {
      continue;
    }
    states.set(loadedSession.value.sessionId, loadedSession.value.status);
  }

  return states;
}

export async function deleteWorkflowHistory(
  input: DeleteWorkflowHistoryInput,
): Promise<DeleteWorkflowHistoryResult> {
  const loadedWorkflow = await loadWorkflowFromDisk(input.workflowName, input);
  if (!loadedWorkflow.ok) {
    throw new Error(loadedWorkflow.error.message);
  }

  const workflowId = loadedWorkflow.value.bundle.workflow.workflowId;
  if (workflowId !== input.workflowId) {
    throw new Error(
      `workflow '${input.workflowName}' does not match workflow id '${input.workflowId}'`,
    );
  }
  const sessionStates = await collectSessionStates({
    options: input,
    workflowId,
  });
  const blockedSessionIds = [...sessionStates.entries()]
    .filter(([, status]) => isNonTerminalStatus(status))
    .map(([sessionId]) => sessionId)
    .sort((left, right) => left.localeCompare(right));
  if (blockedSessionIds.length > 0) {
    throw new Error(
      `cannot delete workflow history while sessions are active: ${blockedSessionIds.join(", ")}`,
    );
  }

  const sessionIds = [...sessionStates.keys()].sort((left, right) =>
    left.localeCompare(right),
  );
  for (const sessionId of sessionIds) {
    await deleteWorkflowSessionHistory(
      {
        sessionId,
        workflowId,
        workflowName: loadedWorkflow.value.workflowName,
      },
      input,
    );
  }

  await createManagerSessionStore(input).deleteByWorkflowId(workflowId);

  await rm(loadedWorkflow.value.artifactWorkflowRoot, {
    force: true,
    recursive: true,
  });
  const attachmentWorkflowRoot = resolveWorkflowScopedPath(
    resolveAttachmentRoot(input),
    workflowId,
  );
  if (attachmentWorkflowRoot !== undefined) {
    await rm(attachmentWorkflowRoot, {
      force: true,
      recursive: true,
    });
  }

  return {
    deletedSessionCount: sessionIds.length,
    workflowId,
    workflowName: loadedWorkflow.value.workflowName,
  };
}
