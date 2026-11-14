import type { LoadOptions } from "../workflow/types";
import {
  findSupervisorConversationByCorrelationInRuntimeDb,
  insertSupervisorConversationToRuntimeDb,
  insertSupervisorDispatchDecisionToRuntimeDb,
  listSupervisorManagedRunsFromRuntimeDb,
  loadSupervisorConversationFromRuntimeDb,
  loadSupervisorDispatchDecisionBySourceMessageFromRuntimeDb,
  type RuntimeSupervisorConversationSaveInput,
  type RuntimeSupervisorDispatchDecisionSaveInput,
  type RuntimeSupervisorManagedRunSaveInput,
  updateSupervisorConversationCasInRuntimeDb,
  updateSupervisorDispatchDecisionFromProposedInRuntimeDb,
  upsertSupervisorManagedRunToRuntimeDb,
} from "../workflow/runtime-db";

export type SupervisorConversationStatus =
  | "active"
  | "idle"
  | "stopped"
  | "failed";

export type SupervisorManagedRunStatus =
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "completed"
  | "failed";

export type SupervisorDispatchDecisionStatus =
  | "proposed"
  | "applied"
  | "rejected"
  | "superseded";

export interface WorkflowSupervisorConversationRecord {
  readonly supervisorConversationId: string;
  readonly supervisorProfileId: string;
  readonly profileRevision: string;
  readonly supervisorWorkflowName: string;
  readonly supervisorExecutionId?: string;
  readonly sourceId: string;
  readonly bindingId?: string;
  readonly correlationKey: string;
  readonly conversationRevision: number;
  readonly selectedManagedRunId?: string;
  readonly selectedManagedRunIdsByWorkflowKey?: Readonly<
    Record<string, string>
  >;
  readonly status: SupervisorConversationStatus;
  readonly artifactDir: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ManagedWorkflowRunRecord {
  readonly managedRunId: string;
  readonly supervisorConversationId: string;
  readonly managedWorkflowKey: string;
  readonly targetWorkflowName: string;
  readonly runAlias?: string;
  readonly activeTargetExecutionId?: string;
  readonly status: SupervisorManagedRunStatus;
  readonly restartCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SupervisorDispatchDecisionRecord {
  readonly decisionId: string;
  readonly supervisorConversationId: string;
  readonly sourceMessageId: string;
  readonly profileRevision: string;
  readonly conversationRevision: number;
  readonly status: SupervisorDispatchDecisionStatus;
  readonly proposalJson: string;
  readonly resultSummaryJson?: string;
  readonly receiptId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkflowSupervisorConversationRepository {
  readonly insertConversation: (
    record: WorkflowSupervisorConversationRecord,
  ) => Promise<"inserted" | "duplicate">;
  readonly loadConversation: (
    supervisorConversationId: string,
  ) => Promise<WorkflowSupervisorConversationRecord | null>;
  readonly findConversationByCorrelation: (input: {
    readonly sourceId: string;
    readonly bindingId?: string;
    readonly correlationKey: string;
  }) => Promise<WorkflowSupervisorConversationRecord | null>;
  readonly updateConversationCas: (input: {
    readonly expectedConversationRevision: number;
    readonly next: WorkflowSupervisorConversationRecord;
  }) => Promise<WorkflowSupervisorConversationRecord | null>;
  readonly upsertManagedRun: (run: ManagedWorkflowRunRecord) => Promise<void>;
  readonly listManagedRuns: (
    supervisorConversationId: string,
  ) => Promise<readonly ManagedWorkflowRunRecord[]>;
  readonly insertDispatchDecisionIfAbsent: (
    record: SupervisorDispatchDecisionRecord,
  ) => Promise<"inserted" | "duplicate">;
  readonly updateDispatchDecisionFromProposed: (input: {
    readonly decisionId: string;
    readonly nextStatus: "applied" | "rejected";
    readonly proposalJson: string;
    readonly resultSummaryJson: string | null;
    readonly conversationRevision: number;
    readonly profileRevision: string;
    readonly updatedAt: string;
  }) => Promise<boolean>;
  readonly loadDispatchDecisionBySourceMessage: (input: {
    readonly supervisorConversationId: string;
    readonly sourceMessageId: string;
  }) => Promise<SupervisorDispatchDecisionRecord | null>;
}

function encodeSelectedByKey(
  value: Readonly<Record<string, string>> | undefined,
): string | null {
  if (value === undefined) {
    return null;
  }
  return JSON.stringify(value);
}

function decodeSelectedByKey(
  json: string | null | undefined,
): Readonly<Record<string, string>> | undefined {
  if (json === null || json === undefined || json.length === 0) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return undefined;
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && v.length > 0) {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return undefined;
  }
}

function conversationFromRuntime(
  row: RuntimeSupervisorConversationSaveInput,
): WorkflowSupervisorConversationRecord {
  return {
    supervisorConversationId: row.supervisorConversationId,
    supervisorProfileId: row.supervisorProfileId,
    profileRevision: row.profileRevision,
    supervisorWorkflowName: row.supervisorWorkflowName,
    ...(row.supervisorExecutionId === undefined
      ? {}
      : { supervisorExecutionId: row.supervisorExecutionId }),
    sourceId: row.sourceId,
    ...(row.bindingId === undefined ? {} : { bindingId: row.bindingId }),
    correlationKey: row.correlationKey,
    conversationRevision: row.conversationRevision,
    ...(row.selectedManagedRunId === undefined
      ? {}
      : { selectedManagedRunId: row.selectedManagedRunId }),
    ...(() => {
      const decoded = decodeSelectedByKey(
        row.selectedManagedRunIdsByWorkflowKeyJson ?? null,
      );
      return decoded === undefined
        ? {}
        : { selectedManagedRunIdsByWorkflowKey: decoded };
    })(),
    status: row.status as SupervisorConversationStatus,
    artifactDir: row.artifactDir,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function conversationToRuntime(
  record: WorkflowSupervisorConversationRecord,
): RuntimeSupervisorConversationSaveInput {
  return {
    supervisorConversationId: record.supervisorConversationId,
    supervisorProfileId: record.supervisorProfileId,
    profileRevision: record.profileRevision,
    supervisorWorkflowName: record.supervisorWorkflowName,
    ...(record.supervisorExecutionId === undefined
      ? {}
      : { supervisorExecutionId: record.supervisorExecutionId }),
    sourceId: record.sourceId,
    ...(record.bindingId === undefined ? {} : { bindingId: record.bindingId }),
    correlationKey: record.correlationKey,
    conversationRevision: record.conversationRevision,
    ...(record.selectedManagedRunId === undefined
      ? {}
      : { selectedManagedRunId: record.selectedManagedRunId }),
    selectedManagedRunIdsByWorkflowKeyJson: encodeSelectedByKey(
      record.selectedManagedRunIdsByWorkflowKey,
    ),
    status: record.status,
    artifactDir: record.artifactDir,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function managedRunFromRuntime(
  row: RuntimeSupervisorManagedRunSaveInput,
): ManagedWorkflowRunRecord {
  return {
    managedRunId: row.managedRunId,
    supervisorConversationId: row.supervisorConversationId,
    managedWorkflowKey: row.managedWorkflowKey,
    targetWorkflowName: row.targetWorkflowName,
    ...(row.runAlias === undefined ? {} : { runAlias: row.runAlias }),
    ...(row.activeTargetExecutionId === undefined
      ? {}
      : { activeTargetExecutionId: row.activeTargetExecutionId }),
    status: row.status as SupervisorManagedRunStatus,
    restartCount: row.restartCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function managedRunToRuntime(
  run: ManagedWorkflowRunRecord,
): RuntimeSupervisorManagedRunSaveInput {
  return {
    managedRunId: run.managedRunId,
    supervisorConversationId: run.supervisorConversationId,
    managedWorkflowKey: run.managedWorkflowKey,
    targetWorkflowName: run.targetWorkflowName,
    ...(run.runAlias === undefined ? {} : { runAlias: run.runAlias }),
    ...(run.activeTargetExecutionId === undefined
      ? {}
      : { activeTargetExecutionId: run.activeTargetExecutionId }),
    status: run.status,
    restartCount: run.restartCount,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

function decisionFromRuntime(
  row: RuntimeSupervisorDispatchDecisionSaveInput,
): SupervisorDispatchDecisionRecord {
  return {
    decisionId: row.decisionId,
    supervisorConversationId: row.supervisorConversationId,
    sourceMessageId: row.sourceMessageId,
    profileRevision: row.profileRevision,
    conversationRevision: row.conversationRevision,
    status: row.status as SupervisorDispatchDecisionStatus,
    proposalJson: row.proposalJson,
    ...(row.resultSummaryJson === undefined
      ? {}
      : { resultSummaryJson: row.resultSummaryJson }),
    ...(row.receiptId === undefined ? {} : { receiptId: row.receiptId }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function decisionToRuntime(
  record: SupervisorDispatchDecisionRecord,
): RuntimeSupervisorDispatchDecisionSaveInput {
  return {
    decisionId: record.decisionId,
    supervisorConversationId: record.supervisorConversationId,
    sourceMessageId: record.sourceMessageId,
    profileRevision: record.profileRevision,
    conversationRevision: record.conversationRevision,
    status: record.status,
    proposalJson: record.proposalJson,
    ...(record.resultSummaryJson === undefined
      ? {}
      : { resultSummaryJson: record.resultSummaryJson }),
    ...(record.receiptId === undefined ? {} : { receiptId: record.receiptId }),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function createRuntimeSupervisorConversationRepository(
  loadOptions: LoadOptions = {},
): WorkflowSupervisorConversationRepository {
  return {
    insertConversation: async (record) =>
      insertSupervisorConversationToRuntimeDb(
        conversationToRuntime(record),
        loadOptions,
      ),

    loadConversation: async (supervisorConversationId) => {
      const row = await loadSupervisorConversationFromRuntimeDb(
        supervisorConversationId,
        loadOptions,
      );
      return row === null ? null : conversationFromRuntime(row);
    },

    findConversationByCorrelation: async (input) => {
      const row = await findSupervisorConversationByCorrelationInRuntimeDb(
        input,
        loadOptions,
      );
      return row === null ? null : conversationFromRuntime(row);
    },

    updateConversationCas: async (input) => {
      const nextRow = conversationToRuntime(input.next);
      const updated = await updateSupervisorConversationCasInRuntimeDb(
        {
          supervisorConversationId: input.next.supervisorConversationId,
          expectedConversationRevision: input.expectedConversationRevision,
          next: nextRow,
        },
        loadOptions,
      );
      return updated === null ? null : conversationFromRuntime(updated);
    },

    upsertManagedRun: async (run) => {
      await upsertSupervisorManagedRunToRuntimeDb(
        managedRunToRuntime(run),
        loadOptions,
      );
    },

    listManagedRuns: async (supervisorConversationId) => {
      const rows = await listSupervisorManagedRunsFromRuntimeDb(
        supervisorConversationId,
        loadOptions,
      );
      return rows.map(managedRunFromRuntime);
    },

    insertDispatchDecisionIfAbsent: async (record) =>
      insertSupervisorDispatchDecisionToRuntimeDb(
        decisionToRuntime(record),
        loadOptions,
      ),

    updateDispatchDecisionFromProposed: async (input) =>
      updateSupervisorDispatchDecisionFromProposedInRuntimeDb(
        input,
        loadOptions,
      ),

    loadDispatchDecisionBySourceMessage: async (input) => {
      const row =
        await loadSupervisorDispatchDecisionBySourceMessageFromRuntimeDb(
          input,
          loadOptions,
        );
      return row === null ? null : decisionFromRuntime(row);
    },
  };
}
