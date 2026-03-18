import { access } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { atomicWriteJsonFile, atomicWriteTextFile } from "../shared/fs";
import {
  createCommunicationService,
  type CommunicationService,
} from "./communication-service";
import { loadWorkflowFromDisk } from "./load";
import {
  createManagerSessionStore,
  type IdempotentMutationLookup,
  type IdempotentMutationRecord,
  type ManagerIntentSummary,
  type ManagerSessionStore,
} from "./manager-session-store";
import {
  assertCommunicationInManagerScope,
  parseManagerControlActionInput,
  parseManagerControlActions,
  type ManagerControlAction,
} from "./manager-control";
import { resolveRootDataDir } from "./paths";
import {
  loadSession,
  saveSession,
  type SessionStoreOptions,
} from "./session-store";
import type {
  CommunicationRecord,
  ManagerMessagePayloadRef,
  PendingOptionalNodeDecision,
  WorkflowSessionState,
} from "./session";
import type { WorkflowJson } from "./types";

export interface DataDirFileRef {
  readonly path: string;
  readonly mediaType?: string;
}

export interface SendManagerMessageInput {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly managerSessionId: string;
  readonly message?: string;
  readonly actions?: readonly ManagerControlAction[];
  readonly attachments?: readonly DataDirFileRef[];
  readonly idempotencyKey?: string;
}

export interface SendManagerMessageResult {
  readonly accepted: boolean;
  readonly managerMessageId: string;
  readonly parsedIntent: readonly ManagerIntentSummary[];
  readonly createdCommunicationIds: readonly string[];
  readonly queuedNodeIds: readonly string[];
  readonly rejectionReason?: string;
}

interface IdempotencyStore
  extends Pick<
    ManagerSessionStore,
    | "loadIdempotentResult"
    | "saveIdempotentResult"
    | "loadSession"
    | "listMessages"
    | "appendMessage"
  > {}

export interface ManagerMessageServiceDependencies {
  readonly now?: () => string;
  readonly managerSessionStore?: ManagerSessionStore;
  readonly communicationService?: CommunicationService;
}

export interface ManagerMessageService {
  sendManagerMessage(
    input: SendManagerMessageInput,
    options?: SessionStoreOptions,
  ): Promise<SendManagerMessageResult>;
}

interface PersistedManagerMessageArtifacts {
  readonly artifactDir: string;
  readonly outputRaw: string;
  readonly payloadRef: ManagerMessagePayloadRef;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(
      ([key, entryValue]) =>
        `${JSON.stringify(key)}:${stableStringify(entryValue)}`,
    )
    .join(",")}}`;
}

async function runIdempotentMutation<TResult>(args: {
  readonly mutationName: string;
  readonly idempotencyKey: string | undefined;
  readonly managerSessionId: string;
  readonly normalizedPayload: unknown;
  readonly store: IdempotencyStore;
  readonly action: () => Promise<TResult>;
  readonly now: string;
}): Promise<TResult> {
  if (args.idempotencyKey === undefined) {
    return await args.action();
  }

  const normalizedRequestHash = `sha256:${sha256Hex(
    stableStringify(args.normalizedPayload),
  )}`;
  const lookup: IdempotentMutationLookup = {
    mutationName: args.mutationName,
    managerSessionId: args.managerSessionId,
    idempotencyKey: args.idempotencyKey,
  };
  const existing = await args.store.loadIdempotentResult(lookup);
  if (existing !== null) {
    if (existing.normalizedRequestHash !== normalizedRequestHash) {
      throw new Error(
        `${args.mutationName} idempotency conflict for key '${args.idempotencyKey}'`,
      );
    }
    return JSON.parse(existing.responseJson) as TResult;
  }

  const result = await args.action();
  const record: IdempotentMutationRecord = {
    mutationName: args.mutationName,
    managerSessionId: args.managerSessionId,
    idempotencyKey: args.idempotencyKey,
    normalizedRequestHash,
    responseJson: JSON.stringify(result),
    completedAt: args.now,
  };
  await args.store.saveIdempotentResult(record);
  return result;
}

function createManagerMessageId(): string {
  return `mgrmsg-${randomUUID()}`;
}

function normalizeManagerMessageText(message: string | undefined): string | undefined {
  const trimmed = message?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function toIntentSummary(action: ManagerControlAction): ManagerIntentSummary {
  switch (action.type) {
    case "planner-note":
      return { kind: "planner-note" };
    case "start-sub-workflow":
      return {
        kind: "start-sub-workflow",
        targetId: action.subWorkflowId,
      };
    case "deliver-to-child-input":
      return {
        kind: "deliver-to-child-input",
        targetId: action.inputNodeId,
      };
    case "retry-node":
      return {
        kind: "retry-node",
        targetId: action.nodeId,
      };
    case "replay-communication":
      return {
        kind: "replay-communication",
        targetId: action.communicationId,
        ...(action.reason === undefined ? {} : { reason: action.reason }),
      };
    case "execute-optional-node":
      return {
        kind: "execute-optional-node",
        targetId: action.nodeId,
      };
    case "skip-optional-node":
      return {
        kind: "skip-optional-node",
        targetId: action.nodeId,
        ...(action.reason === undefined ? {} : { reason: action.reason }),
      };
  }
}

function normalizeFileRef(fileRef: DataDirFileRef): string {
  const candidate = fileRef.path.trim();
  if (candidate.length === 0) {
    throw new Error("attachment path must be non-empty");
  }
  if (path.isAbsolute(candidate)) {
    throw new Error(
      "attachment path must be relative to DIVEDRA_ROOT_DATA_DIR",
    );
  }
  if (candidate.includes("\\")) {
    throw new Error("attachment path must use forward slashes");
  }
  const normalized = path.posix.normalize(candidate);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new Error("attachment path must not escape DIVEDRA_ROOT_DATA_DIR");
  }
  return normalized;
}

function normalizeAttachmentsForIdempotency(
  attachments: readonly DataDirFileRef[],
): readonly DataDirFileRef[] {
  return attachments.map((attachment) => ({
    path: normalizeFileRef(attachment),
    ...(attachment.mediaType === undefined
      ? {}
      : { mediaType: attachment.mediaType }),
  }));
}

function normalizeActionsForIdempotency(
  actions: readonly ManagerControlAction[],
): readonly ManagerControlAction[] {
  return actions.map((action) => parseManagerControlActionInput(action));
}

async function validateAttachments(
  attachments: readonly DataDirFileRef[],
  workflowId: string,
  workflowExecutionId: string,
  options: SessionStoreOptions,
): Promise<readonly DataDirFileRef[]> {
  const rootDataDir = resolveRootDataDir(options);
  const expectedPrefix = `files/${workflowId}/${workflowExecutionId}/`;
  const normalizedAttachments: DataDirFileRef[] = [];
  for (const attachment of attachments) {
    const normalized = normalizeFileRef(attachment);
    if (!normalized.startsWith(expectedPrefix)) {
      throw new Error(
        `attachment path must stay within ${expectedPrefix}`,
      );
    }
    const resolved = path.resolve(rootDataDir, ...normalized.split("/"));
    const rootPrefix = `${rootDataDir}${path.sep}`;
    if (resolved !== rootDataDir && !resolved.startsWith(rootPrefix)) {
      throw new Error("attachment path must stay within DIVEDRA_ROOT_DATA_DIR");
    }
    await access(resolved);
    normalizedAttachments.push({
      path: normalized,
      ...(attachment.mediaType === undefined
        ? {}
        : { mediaType: attachment.mediaType }),
    });
  }
  return normalizedAttachments;
}

function dedupe(values: readonly string[]): readonly string[] {
  return values.filter((value, index, all) => all.indexOf(value) === index);
}

function nextCommunicationId(counter: number): string {
  return `comm-${String(counter).padStart(6, "0")}`;
}

function findOwnedSubWorkflow(workflow: WorkflowJson, managerNodeId: string) {
  return workflow.subWorkflows.find(
    (entry) => entry.managerNodeId === managerNodeId,
  );
}

function findPendingOptionalNodeDecision(
  session: WorkflowSessionState,
  nodeId: string,
): PendingOptionalNodeDecision | undefined {
  return session.pendingOptionalNodeDecisions?.find(
    (entry) => entry.nodeId === nodeId,
  );
}

function upsertPendingOptionalNodeDecision(
  decisions: readonly PendingOptionalNodeDecision[],
  decision: PendingOptionalNodeDecision,
): readonly PendingOptionalNodeDecision[] {
  return [
    ...decisions.filter((entry) => entry.nodeId !== decision.nodeId),
    decision,
  ];
}

function buildManagerMessageOutputRaw(args: {
  readonly managerNodeId: string;
  readonly message: string | undefined;
  readonly attachments: readonly DataDirFileRef[];
  readonly actions: readonly ManagerControlAction[];
}): string {
  return `${JSON.stringify(
    {
      provider: "manager-message",
      model: args.managerNodeId,
      promptText: args.message ?? "",
      completionPassed: true,
      when: { always: true },
      payload: {
        message: args.message ?? "",
        attachments: args.attachments,
        actions: args.actions,
      },
    },
    null,
    2,
  )}\n`;
}

async function prepareManagerMessageArtifacts(args: {
  readonly artifactWorkflowRoot: string;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly managerSessionId: string;
  readonly managerMessageId: string;
  readonly managerNodeId: string;
  readonly managerNodeExecId: string;
  readonly subWorkflowId: string | undefined;
  readonly message: string | undefined;
  readonly attachments: readonly DataDirFileRef[];
  readonly actions: readonly ManagerControlAction[];
}): Promise<PersistedManagerMessageArtifacts> {
  const artifactDir = path.join(
    args.artifactWorkflowRoot,
    "executions",
    args.workflowExecutionId,
    "manager-sessions",
    args.managerSessionId,
    "messages",
    args.managerMessageId,
  );
  const payloadRef: ManagerMessagePayloadRef = {
    kind: "manager-message",
    workflowId: args.workflowId,
    workflowExecutionId: args.workflowExecutionId,
    ...(args.subWorkflowId === undefined
      ? {}
      : { subWorkflowId: args.subWorkflowId }),
    outputNodeId: args.managerNodeId,
    nodeExecId: args.managerNodeExecId,
    artifactDir,
    managerSessionId: args.managerSessionId,
    managerMessageId: args.managerMessageId,
    managerNodeId: args.managerNodeId,
    managerNodeExecId: args.managerNodeExecId,
  };
  const outputRaw = buildManagerMessageOutputRaw({
    managerNodeId: args.managerNodeId,
    message: args.message,
    attachments: args.attachments,
    actions: args.actions,
  });
  await atomicWriteTextFile(path.join(artifactDir, "output.json"), outputRaw);
  return {
    artifactDir,
    outputRaw,
    payloadRef,
  };
}

async function writeManagerMessageEnvelope(args: {
  readonly artifacts: PersistedManagerMessageArtifacts;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly managerSessionId: string;
  readonly managerMessageId: string;
  readonly managerNodeId: string;
  readonly managerNodeExecId: string;
  readonly message: string | undefined;
  readonly attachments: readonly DataDirFileRef[];
  readonly actions: readonly ManagerControlAction[];
  readonly parsedIntent: readonly ManagerIntentSummary[];
  readonly createdAt: string;
  readonly accepted: boolean;
  readonly createdCommunicationIds: readonly string[];
  readonly queuedNodeIds: readonly string[];
  readonly rejectionReason?: string;
}): Promise<void> {
  await atomicWriteJsonFile(
    path.join(args.artifacts.artifactDir, "message.json"),
    {
      workflowId: args.workflowId,
      workflowExecutionId: args.workflowExecutionId,
      managerSessionId: args.managerSessionId,
      managerMessageId: args.managerMessageId,
      managerNodeId: args.managerNodeId,
      managerNodeExecId: args.managerNodeExecId,
      ...(args.message === undefined ? {} : { message: args.message }),
      attachments: args.attachments,
      actions: args.actions,
      parsedIntent: args.parsedIntent,
      accepted: args.accepted,
      createdCommunicationIds: args.createdCommunicationIds,
      queuedNodeIds: args.queuedNodeIds,
      ...(args.rejectionReason === undefined
        ? {}
        : { rejectionReason: args.rejectionReason }),
      createdAt: args.createdAt,
      payloadRef: args.artifacts.payloadRef,
    },
  );
}

async function persistManagerMessageCommunication(args: {
  readonly artifactWorkflowRoot: string;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly communicationCounter: number;
  readonly managerMessageId: string;
  readonly managerNodeId: string;
  readonly managerNodeExecId: string;
  readonly targetNodeId: string;
  readonly subWorkflowId: string | undefined;
  readonly payloadRef: ManagerMessagePayloadRef;
  readonly outputRaw: string;
  readonly createdAt: string;
}): Promise<CommunicationRecord> {
  const communicationId = nextCommunicationId(args.communicationCounter + 1);
  const deliveryAttemptId = "attempt-000001";
  const artifactDir = path.join(
    args.artifactWorkflowRoot,
    "executions",
    args.workflowExecutionId,
    "communications",
    communicationId,
  );
  const envelope = {
    workflowId: args.workflowId,
    workflowExecutionId: args.workflowExecutionId,
    communicationId,
    fromNodeId: args.managerNodeId,
    toNodeId: args.targetNodeId,
    ...(args.subWorkflowId === undefined
      ? {}
      : {
          fromSubWorkflowId: args.subWorkflowId,
          toSubWorkflowId: args.subWorkflowId,
        }),
    routingScope: "intra-sub-workflow",
    sourceNodeExecId: args.managerNodeExecId,
    deliveryKind: "edge-transition",
    payloadRef: {
      ...args.payloadRef,
      outputFile: "output.json",
    },
    createdAt: args.createdAt,
    managerMessageId: args.managerMessageId,
  };
  const meta = {
    status: "delivered",
    workflowId: args.workflowId,
    workflowExecutionId: args.workflowExecutionId,
    communicationId,
    fromNodeId: args.managerNodeId,
    toNodeId: args.targetNodeId,
    sourceNodeExecId: args.managerNodeExecId,
    ...(args.subWorkflowId === undefined
      ? {}
      : {
          fromSubWorkflowId: args.subWorkflowId,
          toSubWorkflowId: args.subWorkflowId,
        }),
    routingScope: "intra-sub-workflow",
    deliveryKind: "edge-transition",
    activeDeliveryAttemptId: deliveryAttemptId,
    deliveryAttemptIds: [deliveryAttemptId],
    createdAt: args.createdAt,
    deliveredAt: args.createdAt,
    managerMessageId: args.managerMessageId,
  };
  const attempt = {
    workflowId: args.workflowId,
    workflowExecutionId: args.workflowExecutionId,
    communicationId,
    deliveryAttemptId,
    toNodeId: args.targetNodeId,
    status: "succeeded",
    startedAt: args.createdAt,
    endedAt: args.createdAt,
  };
  const receipt = {
    communicationId,
    deliveryAttemptId,
    deliveredByNodeId: args.managerNodeId,
    deliveredAt: args.createdAt,
  };

  await atomicWriteJsonFile(path.join(artifactDir, "message.json"), envelope);
  await atomicWriteJsonFile(path.join(artifactDir, "meta.json"), meta);
  await atomicWriteJsonFile(
    path.join(artifactDir, "outbox", args.managerNodeId, "message.json"),
    envelope,
  );
  await atomicWriteTextFile(
    path.join(artifactDir, "outbox", args.managerNodeId, "output.json"),
    args.outputRaw,
  );
  await atomicWriteJsonFile(
    path.join(artifactDir, "inbox", args.targetNodeId, "message.json"),
    envelope,
  );
  await atomicWriteJsonFile(
    path.join(artifactDir, "attempts", deliveryAttemptId, "attempt.json"),
    attempt,
  );
  await atomicWriteJsonFile(
    path.join(artifactDir, "attempts", deliveryAttemptId, "receipt.json"),
    receipt,
  );

  return {
    workflowId: args.workflowId,
    workflowExecutionId: args.workflowExecutionId,
    communicationId,
    fromNodeId: args.managerNodeId,
    toNodeId: args.targetNodeId,
    ...(args.subWorkflowId === undefined
      ? {}
      : {
          fromSubWorkflowId: args.subWorkflowId,
          toSubWorkflowId: args.subWorkflowId,
        }),
    routingScope: "intra-sub-workflow",
    sourceNodeExecId: args.managerNodeExecId,
    payloadRef: args.payloadRef,
    deliveryKind: "edge-transition",
    transitionWhen: `manager-message:${args.managerMessageId}:deliver-to-child-input:${args.targetNodeId}`,
    status: "delivered",
    deliveryAttemptIds: [deliveryAttemptId],
    activeDeliveryAttemptId: deliveryAttemptId,
    createdAt: args.createdAt,
    deliveredAt: args.createdAt,
    managerMessageId: args.managerMessageId,
    artifactDir,
  };
}

function queueTargetNodeIdForStartSubWorkflow(args: {
  readonly workflow: WorkflowJson;
  readonly subWorkflowId: string;
}): string {
  const subWorkflow = args.workflow.subWorkflows.find(
    (entry) => entry.id === args.subWorkflowId,
  );
  if (subWorkflow === undefined) {
    throw new Error(`unknown sub-workflow '${args.subWorkflowId}'`);
  }
  return subWorkflow.managerNodeId === args.workflow.managerNodeId
    ? subWorkflow.inputNodeId
    : subWorkflow.managerNodeId;
}

function isTerminalStatus(status: string): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

function applyOptionalNodeDecision(input: {
  readonly session: WorkflowSessionState;
  readonly workflow: WorkflowJson;
  readonly managerNodeId: string;
  readonly managerNodeExecId: string;
  readonly action: Extract<
    ManagerControlAction,
    { readonly type: "execute-optional-node" | "skip-optional-node" }
  >;
  readonly decidedAt: string;
}): WorkflowSessionState {
  const currentDecision = findPendingOptionalNodeDecision(
    input.session,
    input.action.nodeId,
  );
  if (currentDecision === undefined || currentDecision.status !== "pending") {
    throw new Error(
      `invalid manager control at '${input.managerNodeId}': optional node '${input.action.nodeId}' is not currently pending`,
    );
  }
  if (currentDecision.owningManagerNodeId !== input.managerNodeId) {
    throw new Error(
      `invalid manager control at '${input.managerNodeId}': optional node '${input.action.nodeId}' is owned by '${currentDecision.owningManagerNodeId}'`,
    );
  }

  const nodeRef = input.workflow.nodes.find(
    (entry) => entry.id === input.action.nodeId,
  );
  if (nodeRef?.execution?.mode !== "optional") {
    throw new Error(
      `invalid manager control at '${input.managerNodeId}': node '${input.action.nodeId}' is not optional`,
    );
  }

  return {
    ...input.session,
    pendingOptionalNodeDecisions: upsertPendingOptionalNodeDecision(
      input.session.pendingOptionalNodeDecisions ?? [],
      {
        ...currentDecision,
        status:
          input.action.type === "execute-optional-node" ? "execute" : "skip",
        ...(input.action.type === "skip-optional-node" &&
        input.action.reason !== undefined
          ? { reason: input.action.reason }
          : {}),
        decidedAt: input.decidedAt,
        decidedByNodeExecId: input.managerNodeExecId,
      },
    ),
  };
}

export function createManagerMessageService(
  deps: ManagerMessageServiceDependencies = {},
): ManagerMessageService {
  return {
    async sendManagerMessage(input, options = {}) {
      const now = deps.now?.() ?? new Date().toISOString();
      const managerStore =
        deps.managerSessionStore ?? createManagerSessionStore(options);
      const communicationService =
        deps.communicationService ??
        createCommunicationService({
          ...(deps.now === undefined ? {} : { now: deps.now }),
          idempotencyStore: managerStore,
        });
      const trimmedMessage = normalizeManagerMessageText(input.message);
      const normalizedActions = normalizeActionsForIdempotency(
        input.actions ?? [],
      );
      const normalizedAttachments = normalizeAttachmentsForIdempotency(
        input.attachments ?? [],
      );

      return await runIdempotentMutation({
        mutationName: "sendManagerMessage",
        idempotencyKey: input.idempotencyKey,
        managerSessionId: input.managerSessionId,
        normalizedPayload: {
          workflowId: input.workflowId,
          workflowExecutionId: input.workflowExecutionId,
          managerSessionId: input.managerSessionId,
          message: trimmedMessage ?? null,
          actions: normalizedActions,
          attachments: normalizedAttachments,
        },
        store: managerStore,
        now,
        action: async () => {
          const managerSession = await managerStore.loadSession(
            input.managerSessionId,
          );
          if (managerSession === null) {
            throw new Error(
              `manager session '${input.managerSessionId}' was not found`,
            );
          }
          if (managerSession.status !== "active") {
            throw new Error(
              `manager session '${input.managerSessionId}' is not active`,
            );
          }
          if (
            managerSession.workflowId !== input.workflowId ||
            managerSession.workflowExecutionId !== input.workflowExecutionId
          ) {
            throw new Error(
              `manager session '${input.managerSessionId}' does not match the requested workflow scope`,
            );
          }
          const controlMode = await managerStore.claimControlMode({
            managerSessionId: input.managerSessionId,
            controlMode: "graphql-manager-message",
            updatedAt: now,
          });
          if (controlMode !== "graphql-manager-message") {
            throw new Error(
              `manager session '${input.managerSessionId}' is already using payload managerControl for this execution`,
            );
          }

          const loadedSession = await loadSession(
            input.workflowExecutionId,
            options,
          );
          if (!loadedSession.ok) {
            throw new Error(loadedSession.error.message);
          }
          if (loadedSession.value.workflowId !== input.workflowId) {
            throw new Error(
              `workflow execution '${input.workflowExecutionId}' does not belong to workflow '${input.workflowId}'`,
            );
          }

          const loadedWorkflow = await loadWorkflowFromDisk(
            loadedSession.value.workflowName,
            options,
          );
          if (!loadedWorkflow.ok) {
            throw new Error(loadedWorkflow.error.message);
          }
          const workflow = loadedWorkflow.value.bundle.workflow;

          const managerNodeRef = workflow.nodes.find(
            (entry) => entry.id === managerSession.managerNodeId,
          );
          const parsedActions = parseManagerControlActions(
            normalizedActions as readonly unknown[],
            workflow,
            {
              managerNodeId: managerSession.managerNodeId,
              managerKind: managerNodeRef?.kind,
            },
          );

          const hasMessage = trimmedMessage !== undefined;
          const attachments = await validateAttachments(
            normalizedAttachments,
            input.workflowId,
            input.workflowExecutionId,
            options,
          );
          if (
            parsedActions.actions.length === 0 &&
            !hasMessage &&
            attachments.length === 0
          ) {
            throw new Error(
              "manager message must contain a message, attachments, or actions",
            );
          }

          const managerMessageId = createManagerMessageId();
          const parsedIntent =
            parsedActions.actions.length > 0
              ? parsedActions.actions.map((action) => toIntentSummary(action))
              : ([
                  { kind: "planner-note" },
                ] satisfies readonly ManagerIntentSummary[]);
          const ownedSubWorkflow = findOwnedSubWorkflow(
            workflow,
            managerSession.managerNodeId,
          );
          const artifacts = await prepareManagerMessageArtifacts({
            artifactWorkflowRoot: loadedWorkflow.value.artifactWorkflowRoot,
            workflowId: input.workflowId,
            workflowExecutionId: input.workflowExecutionId,
            managerSessionId: input.managerSessionId,
            managerMessageId,
            managerNodeId: managerSession.managerNodeId,
            managerNodeExecId: managerSession.managerNodeExecId,
            subWorkflowId: ownedSubWorkflow?.id,
            message: trimmedMessage,
            attachments,
            actions: parsedActions.actions,
          });

          try {
            const createdCommunicationIds: string[] = [];
            const queuedNodeIds: string[] = [];
            let nextSession: WorkflowSessionState = loadedSession.value;
            for (const action of parsedActions.actions) {
              switch (action.type) {
                case "planner-note":
                  break;
                case "retry-node":
                  queuedNodeIds.push(action.nodeId);
                  break;
                case "replay-communication": {
                  const sourceCommunication = nextSession.communications.find(
                    (entry) =>
                      entry.communicationId === action.communicationId,
                  );
                  if (sourceCommunication === undefined) {
                    throw new Error(
                      `communication '${action.communicationId}' was not found in workflow execution '${input.workflowExecutionId}'`,
                    );
                  }
                  assertCommunicationInManagerScope(
                    sourceCommunication,
                    workflow,
                    {
                      managerNodeId: managerSession.managerNodeId,
                      managerKind: managerNodeRef?.kind,
                    },
                    "managerControl replay-communication",
                  );
                  const replayed =
                    await communicationService.replayCommunication(
                      {
                        workflowId: input.workflowId,
                        workflowExecutionId: input.workflowExecutionId,
                        communicationId: action.communicationId,
                        managerSessionId: input.managerSessionId,
                        ...(action.reason === undefined
                          ? {}
                          : { reason: action.reason }),
                      },
                      options,
                    );
                  createdCommunicationIds.push(
                    replayed.replayedCommunicationId,
                  );
                  break;
                }
                case "start-sub-workflow":
                  queuedNodeIds.push(
                    queueTargetNodeIdForStartSubWorkflow({
                      workflow,
                      subWorkflowId: action.subWorkflowId,
                    }),
                  );
                  break;
                case "deliver-to-child-input": {
                  if (
                    ownedSubWorkflow === undefined ||
                    ownedSubWorkflow.inputNodeId !== action.inputNodeId
                  ) {
                    throw new Error(
                      `manager node '${managerSession.managerNodeId}' does not own child input '${action.inputNodeId}'`,
                    );
                  }
                  const communication =
                    await persistManagerMessageCommunication({
                      artifactWorkflowRoot:
                        loadedWorkflow.value.artifactWorkflowRoot,
                      workflowId: input.workflowId,
                      workflowExecutionId: input.workflowExecutionId,
                      communicationCounter: nextSession.communicationCounter,
                      managerMessageId,
                      managerNodeId: managerSession.managerNodeId,
                      managerNodeExecId: managerSession.managerNodeExecId,
                      targetNodeId: action.inputNodeId,
                      subWorkflowId: ownedSubWorkflow.id,
                      payloadRef: artifacts.payloadRef,
                      outputRaw: artifacts.outputRaw,
                      createdAt: now,
                    });
                  nextSession = {
                    ...nextSession,
                    communicationCounter: nextSession.communicationCounter + 1,
                    communications: [
                      ...nextSession.communications,
                      communication,
                    ],
                  };
                  createdCommunicationIds.push(communication.communicationId);
                  queuedNodeIds.push(action.inputNodeId);
                  break;
                }
                case "execute-optional-node":
                case "skip-optional-node":
                  nextSession = applyOptionalNodeDecision({
                    session: nextSession,
                    workflow,
                    managerNodeId: managerSession.managerNodeId,
                    managerNodeExecId: managerSession.managerNodeExecId,
                    action,
                    decidedAt: now,
                  });
                  queuedNodeIds.push(action.nodeId);
                  break;
              }
            }

            const dedupedQueue = dedupe([
              ...nextSession.queue,
              ...queuedNodeIds,
            ]);
            const sessionToSave =
              dedupedQueue.length > nextSession.queue.length ||
              nextSession.communicationCounter !==
                loadedSession.value.communicationCounter
                ? (() => {
                    const {
                      endedAt: _endedAt,
                      lastError: _lastError,
                      ...restSession
                    } = nextSession;
                    return isTerminalStatus(nextSession.status)
                      ? {
                          ...restSession,
                          status: "running" as const,
                          queue: dedupedQueue,
                        }
                      : {
                          ...nextSession,
                          queue: dedupedQueue,
                        };
                  })()
                : nextSession;
            if (
              sessionToSave !== loadedSession.value ||
              sessionToSave.communicationCounter !==
                loadedSession.value.communicationCounter
            ) {
              const saved = await saveSession(sessionToSave, options);
              if (!saved.ok) {
                throw new Error(saved.error.message);
              }
            }

            const acceptedResult: SendManagerMessageResult = {
              accepted: true,
              managerMessageId,
              parsedIntent,
              createdCommunicationIds,
              queuedNodeIds: dedupe(queuedNodeIds),
            };
            await writeManagerMessageEnvelope({
              artifacts,
              workflowId: input.workflowId,
              workflowExecutionId: input.workflowExecutionId,
              managerSessionId: input.managerSessionId,
              managerMessageId,
              managerNodeId: managerSession.managerNodeId,
              managerNodeExecId: managerSession.managerNodeExecId,
              message: trimmedMessage,
              attachments,
              actions: parsedActions.actions,
              parsedIntent,
              createdAt: now,
              accepted: true,
              createdCommunicationIds,
              queuedNodeIds: acceptedResult.queuedNodeIds,
            });
            await managerStore.appendMessage({
              managerMessageId,
              managerSessionId: input.managerSessionId,
              workflowId: input.workflowId,
              workflowExecutionId: input.workflowExecutionId,
              managerNodeId: managerSession.managerNodeId,
              managerNodeExecId: managerSession.managerNodeExecId,
              ...(trimmedMessage === undefined
                ? {}
                : { message: trimmedMessage }),
              parsedIntent,
              accepted: true,
              createdAt: now,
            });
            return acceptedResult;
          } catch (error: unknown) {
            const rejectionReason =
              error instanceof Error ? error.message : String(error);
            await writeManagerMessageEnvelope({
              artifacts,
              workflowId: input.workflowId,
              workflowExecutionId: input.workflowExecutionId,
              managerSessionId: input.managerSessionId,
              managerMessageId,
              managerNodeId: managerSession.managerNodeId,
              managerNodeExecId: managerSession.managerNodeExecId,
              message: trimmedMessage,
              attachments,
              actions: parsedActions.actions,
              parsedIntent,
              createdAt: now,
              accepted: false,
              createdCommunicationIds: [],
              queuedNodeIds: [],
              rejectionReason,
            });
            await managerStore.appendMessage({
              managerMessageId,
              managerSessionId: input.managerSessionId,
              workflowId: input.workflowId,
              workflowExecutionId: input.workflowExecutionId,
              managerNodeId: managerSession.managerNodeId,
              managerNodeExecId: managerSession.managerNodeExecId,
              ...(trimmedMessage === undefined
                ? {}
                : { message: trimmedMessage }),
              parsedIntent,
              accepted: false,
              rejectionReason,
              createdAt: now,
            });
            return {
              accepted: false,
              managerMessageId,
              parsedIntent,
              createdCommunicationIds: [],
              queuedNodeIds: [],
              rejectionReason,
            };
          }
        },
      });
    },
  };
}
