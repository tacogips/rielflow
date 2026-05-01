import { executeGraphqlRequest } from "../graphql/client";
import type { EventBinding, EventSupervisorCommand } from "../events/types";
import type {
  DispatchSupervisorConversationGraphqlInput,
  DispatchSupervisorConversationPayload,
} from "../graphql/types";
import type { WorkflowSessionState } from "../workflow/session";
import {
  eventBindingStubFromSupervisedRunRecord,
  type RestartSupervisedWorkflowInput,
  type StartSupervisedWorkflowInput,
  type StopSupervisedWorkflowInput,
  type SubmitSupervisedWorkflowInput,
  type SupervisedWorkflowLookup,
  type SupervisedWorkflowView,
  type SupervisorEngineOverrides,
  type WorkflowSupervisorClient,
} from "./supervisor-client";

export interface WorkflowSupervisorGraphqlClientOptions {
  readonly endpoint: string;
  readonly authToken?: string;
  readonly fetchImpl?: typeof fetch;
  readonly managerSessionId?: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return { ...value };
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requireOptionalString(
  value: unknown,
  label: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return requireString(value, label);
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function parseSupervisedRunRecord(
  payload: unknown,
  label: string,
): SupervisedWorkflowView["supervisedRun"] {
  const obj = requireObject(payload, label);
  const status = requireString(obj["status"], `${label}.status`);
  const supervisorExecutionId = requireOptionalString(
    obj["supervisorExecutionId"],
    `${label}.supervisorExecutionId`,
  );
  const activeTargetExecutionId = requireOptionalString(
    obj["activeTargetExecutionId"],
    `${label}.activeTargetExecutionId`,
  );
  if (
    status !== "starting" &&
    status !== "running" &&
    status !== "stopping" &&
    status !== "stopped" &&
    status !== "restarting" &&
    status !== "completed" &&
    status !== "failed"
  ) {
    throw new Error(`${label}.status must be a valid supervised run status`);
  }
  return {
    supervisedRunId: requireString(
      obj["supervisedRunId"],
      `${label}.supervisedRunId`,
    ),
    sourceId: requireString(obj["sourceId"], `${label}.sourceId`),
    bindingId: requireString(obj["bindingId"], `${label}.bindingId`),
    correlationKey: requireString(
      obj["correlationKey"],
      `${label}.correlationKey`,
    ),
    supervisorWorkflowName: requireString(
      obj["supervisorWorkflowName"],
      `${label}.supervisorWorkflowName`,
    ),
    ...(supervisorExecutionId === undefined ? {} : { supervisorExecutionId }),
    targetWorkflowName: requireString(
      obj["targetWorkflowName"],
      `${label}.targetWorkflowName`,
    ),
    ...(activeTargetExecutionId === undefined
      ? {}
      : { activeTargetExecutionId }),
    status,
    restartCount: requireNumber(obj["restartCount"], `${label}.restartCount`),
    maxRestartsOnFailure: requireNumber(
      obj["maxRestartsOnFailure"],
      `${label}.maxRestartsOnFailure`,
    ),
    autoImproveEnabled: requireBoolean(
      obj["autoImproveEnabled"],
      `${label}.autoImproveEnabled`,
    ),
    createdAt: requireString(obj["createdAt"], `${label}.createdAt`),
    updatedAt: requireString(obj["updatedAt"], `${label}.updatedAt`),
  };
}

function parseSupervisedWorkflowView(
  payload: unknown,
  label: string,
): SupervisedWorkflowView {
  const obj = requireObject(payload, label);
  const supervisedRun = parseSupervisedRunRecord(
    obj["supervisedRun"],
    `${label}.supervisedRun`,
  );
  const activeRaw = obj["activeTargetStatus"];
  if (activeRaw === undefined || activeRaw === null) {
    return { supervisedRun };
  }
  if (
    activeRaw !== "idle" &&
    activeRaw !== "running" &&
    activeRaw !== "paused" &&
    activeRaw !== "completed" &&
    activeRaw !== "failed" &&
    activeRaw !== "cancelled"
  ) {
    throw new Error(
      `${label}.activeTargetStatus must be a valid workflow status when set`,
    );
  }
  return {
    supervisedRun,
    activeTargetStatus: activeRaw as WorkflowSessionState["status"],
  };
}

async function postSupervisedMutation(
  options: WorkflowSupervisorGraphqlClientOptions,
  variables: Readonly<Record<string, unknown>>,
): Promise<SupervisedWorkflowView> {
  const response = await executeGraphqlRequest({
    endpoint: options.endpoint,
    document: `
      mutation DispatchSupervisedWorkflowCommand(
        $input: DispatchSupervisedWorkflowCommandInput!
      ) {
        dispatchSupervisedWorkflowCommand(input: $input) {
          supervisedRun
          activeTargetStatus
        }
      }
    `,
    variables: { input: variables },
    ...(options.authToken === undefined
      ? {}
      : { authToken: options.authToken }),
    ...(options.managerSessionId === undefined
      ? {}
      : { managerSessionId: options.managerSessionId }),
    ...(options.fetchImpl === undefined
      ? {}
      : { fetchImpl: options.fetchImpl }),
  });
  if (response.errors !== undefined && response.errors.length > 0) {
    throw new Error(response.errors.map((e) => e.message).join("; "));
  }
  const data = response.data;
  if (!isRecord(data)) {
    throw new Error("GraphQL response.data must be an object");
  }
  return parseSupervisedWorkflowView(
    data["dispatchSupervisedWorkflowCommand"],
    "dispatchSupervisedWorkflowCommand",
  );
}

async function querySupervisedSnapshot(
  options: WorkflowSupervisorGraphqlClientOptions,
  lookup: SupervisedWorkflowLookup,
): Promise<SupervisedWorkflowView> {
  const response = await executeGraphqlRequest({
    endpoint: options.endpoint,
    document: `
      query SupervisedWorkflowRun($input: SupervisedWorkflowLookupGraphqlInput!) {
        supervisedWorkflowRun(input: $input) {
          supervisedRun
          activeTargetStatus
        }
      }
    `,
    variables: { input: lookup },
    ...(options.authToken === undefined
      ? {}
      : { authToken: options.authToken }),
    ...(options.managerSessionId === undefined
      ? {}
      : { managerSessionId: options.managerSessionId }),
    ...(options.fetchImpl === undefined
      ? {}
      : { fetchImpl: options.fetchImpl }),
  });
  if (response.errors !== undefined && response.errors.length > 0) {
    throw new Error(response.errors.map((e) => e.message).join("; "));
  }
  const data = response.data;
  if (!isRecord(data)) {
    throw new Error("GraphQL response.data must be an object");
  }
  return parseSupervisedWorkflowView(
    data["supervisedWorkflowRun"],
    "supervisedWorkflowRun",
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

function lookupForGraphqlQuery(input: SupervisedWorkflowLookup): Readonly<{
  supervisedRunId?: string;
  sourceId?: string;
  bindingId?: string;
  correlationKey?: string;
}> {
  return {
    ...(input.supervisedRunId === undefined
      ? {}
      : { supervisedRunId: input.supervisedRunId }),
    ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId }),
    ...(input.bindingId === undefined ? {} : { bindingId: input.bindingId }),
    ...(input.correlationKey === undefined
      ? {}
      : { correlationKey: input.correlationKey }),
  };
}

function resolveRemoteCommandId(input: {
  readonly idempotencyKey: string | undefined;
  readonly prefix: string;
  readonly scope: string;
}): string {
  if (input.idempotencyKey !== undefined && input.idempotencyKey.length > 0) {
    return input.idempotencyKey;
  }
  return `${input.prefix}-${nowIso()}-${input.scope}`;
}

export function createWorkflowSupervisorGraphqlClient(
  options: WorkflowSupervisorGraphqlClientOptions,
): WorkflowSupervisorClient {
  async function dispatchRemote(input: {
    readonly command: EventSupervisorCommand;
    readonly binding: EventBinding;
    readonly runtimeVariables: Readonly<Record<string, unknown>>;
    readonly engine?: SupervisorEngineOverrides;
  }): Promise<SupervisedWorkflowView> {
    return postSupervisedMutation(options, {
      command: input.command,
      binding: input.binding,
      runtimeVariables: input.runtimeVariables,
      ...(input.engine?.mockScenario === undefined
        ? {}
        : { mockScenario: input.engine.mockScenario }),
      ...(input.engine?.dryRun === undefined
        ? {}
        : { dryRun: input.engine.dryRun }),
      ...(input.engine?.maxSteps === undefined
        ? {}
        : { maxSteps: input.engine.maxSteps }),
      ...(input.engine?.maxLoopIterations === undefined
        ? {}
        : { maxLoopIterations: input.engine.maxLoopIterations }),
      ...(input.engine?.defaultTimeoutMs === undefined
        ? {}
        : { defaultTimeoutMs: input.engine.defaultTimeoutMs }),
    });
  }

  const client: WorkflowSupervisorClient = {
    dispatchCommand: dispatchRemote,

    async start(
      input: StartSupervisedWorkflowInput,
    ): Promise<SupervisedWorkflowView> {
      const cmd: EventSupervisorCommand = {
        commandId: resolveRemoteCommandId({
          idempotencyKey: input.idempotencyKey,
          prefix: "gql-start",
          scope: input.correlationKey,
        }),
        sourceId: input.sourceId,
        bindingId: input.bindingId,
        correlationKey: input.correlationKey,
        action: "start",
        targetWorkflowName: input.targetWorkflowName,
        ...(input.runtimeVariables === undefined
          ? {}
          : { runtimeVariables: input.runtimeVariables }),
        receivedEventReceiptId: "graphql",
      };
      return dispatchRemote({
        command: cmd,
        binding: input.bindingSnapshot,
        runtimeVariables: input.runtimeVariables ?? {},
        engine: {
          ...(input.mockScenario === undefined
            ? {}
            : { mockScenario: input.mockScenario }),
          ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }),
          ...(input.maxSteps === undefined ? {} : { maxSteps: input.maxSteps }),
          ...(input.maxLoopIterations === undefined
            ? {}
            : { maxLoopIterations: input.maxLoopIterations }),
          ...(input.defaultTimeoutMs === undefined
            ? {}
            : { defaultTimeoutMs: input.defaultTimeoutMs }),
        },
      });
    },

    async stop(
      input: StopSupervisedWorkflowInput,
    ): Promise<SupervisedWorkflowView> {
      const prior = await querySupervisedSnapshot(
        options,
        lookupForGraphqlQuery(input),
      );
      const record = prior.supervisedRun;
      const cmd: EventSupervisorCommand = {
        commandId: resolveRemoteCommandId({
          idempotencyKey: input.idempotencyKey,
          prefix: "gql-stop",
          scope: record.supervisedRunId,
        }),
        sourceId: record.sourceId,
        bindingId: record.bindingId,
        correlationKey: record.correlationKey,
        action: "stop",
        targetWorkflowName: record.targetWorkflowName,
        supervisedRunId: record.supervisedRunId,
        receivedEventReceiptId: "graphql",
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      };
      return dispatchRemote({
        command: cmd,
        binding: eventBindingStubFromSupervisedRunRecord(record),
        runtimeVariables: {},
      });
    },

    async restart(
      input: RestartSupervisedWorkflowInput,
    ): Promise<SupervisedWorkflowView> {
      const prior = await querySupervisedSnapshot(
        options,
        lookupForGraphqlQuery(input),
      );
      const record = prior.supervisedRun;
      const cmd: EventSupervisorCommand = {
        commandId: resolveRemoteCommandId({
          idempotencyKey: input.idempotencyKey,
          prefix: "gql-restart",
          scope: record.supervisedRunId,
        }),
        sourceId: record.sourceId,
        bindingId: record.bindingId,
        correlationKey: record.correlationKey,
        action: "restart",
        targetWorkflowName: record.targetWorkflowName,
        supervisedRunId: record.supervisedRunId,
        receivedEventReceiptId: "graphql",
        ...(input.runtimeVariables === undefined
          ? {}
          : { runtimeVariables: input.runtimeVariables }),
      };
      return dispatchRemote({
        command: cmd,
        binding: eventBindingStubFromSupervisedRunRecord(record),
        runtimeVariables: input.runtimeVariables ?? {},
        engine: {
          ...(input.mockScenario === undefined
            ? {}
            : { mockScenario: input.mockScenario }),
          ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }),
          ...(input.maxSteps === undefined ? {} : { maxSteps: input.maxSteps }),
          ...(input.maxLoopIterations === undefined
            ? {}
            : { maxLoopIterations: input.maxLoopIterations }),
          ...(input.defaultTimeoutMs === undefined
            ? {}
            : { defaultTimeoutMs: input.defaultTimeoutMs }),
        },
      });
    },

    async status(
      input: SupervisedWorkflowLookup,
    ): Promise<SupervisedWorkflowView> {
      const prior = await querySupervisedSnapshot(
        options,
        lookupForGraphqlQuery(input),
      );
      const record = prior.supervisedRun;
      const cmd: EventSupervisorCommand = {
        commandId: resolveRemoteCommandId({
          idempotencyKey: input.idempotencyKey,
          prefix: "gql-status",
          scope: record.supervisedRunId,
        }),
        sourceId: record.sourceId,
        bindingId: record.bindingId,
        correlationKey: record.correlationKey,
        action: "status",
        targetWorkflowName: record.targetWorkflowName,
        supervisedRunId: record.supervisedRunId,
        receivedEventReceiptId: "graphql",
      };
      return dispatchRemote({
        command: cmd,
        binding: eventBindingStubFromSupervisedRunRecord(record),
        runtimeVariables: {},
      });
    },

    async submitInput(
      input: SubmitSupervisedWorkflowInput,
    ): Promise<SupervisedWorkflowView> {
      let record = null as
        | Awaited<ReturnType<typeof querySupervisedSnapshot>>["supervisedRun"]
        | null;
      try {
        const prior = await querySupervisedSnapshot(
          options,
          lookupForGraphqlQuery(input),
        );
        record = prior.supervisedRun;
      } catch (error: unknown) {
        if (
          !(error instanceof Error) ||
          !error.message.includes("no supervised run matches the lookup")
        ) {
          throw error;
        }
      }
      const binding =
        record === null
          ? input.bindingSnapshot
          : eventBindingStubFromSupervisedRunRecord(record);
      if (binding === undefined) {
        throw new Error(
          "supervised input start requires bindingSnapshot when no supervised run exists",
        );
      }
      const sourceId = record?.sourceId ?? input.sourceId;
      const bindingId = record?.bindingId ?? input.bindingId;
      const correlationKey = record?.correlationKey ?? input.correlationKey;
      const targetWorkflowName =
        record?.targetWorkflowName ?? input.targetWorkflowName;
      if (
        sourceId === undefined ||
        sourceId.length === 0 ||
        bindingId === undefined ||
        bindingId.length === 0 ||
        correlationKey === undefined ||
        correlationKey.length === 0 ||
        targetWorkflowName === undefined ||
        targetWorkflowName.length === 0
      ) {
        throw new Error(
          "supervised input start requires sourceId, bindingId, correlationKey, and targetWorkflowName when no supervised run exists",
        );
      }
      const cmd: EventSupervisorCommand = {
        commandId: resolveRemoteCommandId({
          idempotencyKey: input.idempotencyKey,
          prefix: "gql-input",
          scope: record?.supervisedRunId ?? correlationKey,
        }),
        sourceId,
        bindingId,
        correlationKey,
        action: "input",
        targetWorkflowName,
        ...(record === null ? {} : { supervisedRunId: record.supervisedRunId }),
        receivedEventReceiptId: "graphql",
        ...(input.runtimeVariables === undefined
          ? {}
          : { runtimeVariables: input.runtimeVariables }),
      };
      const withControl: EventBinding = {
        ...binding,
        execution: {
          ...binding.execution,
          ...(record === null
            ? {}
            : {
                control: {
                  ...binding.execution?.control,
                  startOnFirstInput: false,
                },
              }),
        },
      };
      return dispatchRemote({
        command: cmd,
        binding: withControl,
        runtimeVariables: input.runtimeVariables ?? {},
        engine: {
          ...(input.mockScenario === undefined
            ? {}
            : { mockScenario: input.mockScenario }),
          ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }),
          ...(input.maxSteps === undefined ? {} : { maxSteps: input.maxSteps }),
          ...(input.maxLoopIterations === undefined
            ? {}
            : { maxLoopIterations: input.maxLoopIterations }),
          ...(input.defaultTimeoutMs === undefined
            ? {}
            : { defaultTimeoutMs: input.defaultTimeoutMs }),
        },
      });
    },
  };

  return client;
}

function parseDispatchSupervisorConversationPayload(
  payload: unknown,
  label: string,
): DispatchSupervisorConversationPayload {
  const o = requireObject(payload, label);
  requireBoolean(o["applied"], `${label}.applied`);
  if (!Array.isArray(o["managedRuns"])) {
    throw new Error(`${label}.managedRuns must be an array`);
  }
  if (typeof o["conversation"] !== "object" || o["conversation"] === null) {
    throw new Error(`${label}.conversation must be an object`);
  }
  if (typeof o["decision"] !== "object" || o["decision"] === null) {
    throw new Error(`${label}.decision must be an object`);
  }
  if (typeof o["proposal"] !== "object" || o["proposal"] === null) {
    throw new Error(`${label}.proposal must be an object`);
  }
  return o as unknown as DispatchSupervisorConversationPayload;
}

/**
 * Invokes the {@link GraphqlSchema} `dispatchSupervisorConversation` mutation
 * against a remote GraphQL endpoint using the same input contract as the
 * library schema implementation.
 */
export async function postDispatchSupervisorConversationThroughGraphql(
  options: WorkflowSupervisorGraphqlClientOptions,
  input: DispatchSupervisorConversationGraphqlInput,
): Promise<DispatchSupervisorConversationPayload> {
  const response = await executeGraphqlRequest({
    endpoint: options.endpoint,
    document: `
      mutation DispatchSupervisorConversation(
        $input: DispatchSupervisorConversationInput!
      ) {
        dispatchSupervisorConversation(input: $input) {
          conversation
          managedRuns
          decision
          proposal
          applied
          validationIssues
        }
      }
    `,
    variables: { input },
    ...(options.authToken === undefined
      ? {}
      : { authToken: options.authToken }),
    ...(options.managerSessionId === undefined
      ? {}
      : { managerSessionId: options.managerSessionId }),
    ...(options.fetchImpl === undefined
      ? {}
      : { fetchImpl: options.fetchImpl }),
  });
  if (response.errors !== undefined && response.errors.length > 0) {
    throw new Error(response.errors.map((e) => e.message).join("; "));
  }
  const data = response.data;
  if (!isRecord(data)) {
    throw new Error("GraphQL response.data must be an object");
  }
  return parseDispatchSupervisorConversationPayload(
    data["dispatchSupervisorConversation"],
    "dispatchSupervisorConversation",
  );
}
