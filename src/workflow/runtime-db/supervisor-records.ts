import type { LoadOptions } from "../types";
import { withDatabase } from "./schema-and-record-types";
import type {
  RuntimeSupervisorConversationSaveInput,
  RuntimeSupervisorDispatchDecisionSaveInput,
  RuntimeSupervisorManagedRunSaveInput,
} from "./session-query-records";
import {
  toRuntimeSupervisorConversationSaveInput,
  toRuntimeSupervisorManagedRunSaveInput,
} from "./session-query-records";

export async function insertSupervisorConversationToRuntimeDb(
  row: RuntimeSupervisorConversationSaveInput,
  options: LoadOptions = {},
): Promise<"inserted" | "duplicate"> {
  return withDatabase(options, (db) => {
    try {
      const stmt = db.prepare(`
        INSERT INTO supervisor_conversations (
          supervisor_conversation_id, supervisor_profile_id, profile_revision,
          supervisor_workflow_name, supervisor_execution_id, source_id, binding_id,
          correlation_key, conversation_revision, selected_managed_run_id,
          selected_managed_run_ids_by_workflow_key_json, status, artifact_dir,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        row.supervisorConversationId,
        row.supervisorProfileId,
        row.profileRevision,
        row.supervisorWorkflowName,
        row.supervisorExecutionId ?? null,
        row.sourceId,
        row.bindingId ?? null,
        row.correlationKey,
        row.conversationRevision,
        row.selectedManagedRunId ?? null,
        row.selectedManagedRunIdsByWorkflowKeyJson ?? null,
        row.status,
        row.artifactDir,
        row.createdAt,
        row.updatedAt,
      );
      return "inserted";
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("UNIQUE constraint failed")) {
        return "duplicate";
      }
      throw error;
    }
  });
}
export async function loadSupervisorConversationFromRuntimeDb(
  supervisorConversationId: string,
  options: LoadOptions = {},
): Promise<RuntimeSupervisorConversationSaveInput | null> {
  return withDatabase(options, (db) => {
    const row = db
      .query(
        `SELECT
          supervisor_conversation_id, supervisor_profile_id, profile_revision,
          supervisor_workflow_name, supervisor_execution_id, source_id, binding_id,
          correlation_key, conversation_revision, selected_managed_run_id,
          selected_managed_run_ids_by_workflow_key_json, status, artifact_dir,
          created_at, updated_at
         FROM supervisor_conversations
         WHERE supervisor_conversation_id = ?
         LIMIT 1`,
      )
      .get(supervisorConversationId) as
      | Parameters<typeof toRuntimeSupervisorConversationSaveInput>[0]
      | null;
    return row === null ? null : toRuntimeSupervisorConversationSaveInput(row);
  });
}
export async function findSupervisorConversationByCorrelationInRuntimeDb(
  input: {
    readonly sourceId: string;
    readonly bindingId?: string;
    readonly correlationKey: string;
  },
  options: LoadOptions = {},
): Promise<RuntimeSupervisorConversationSaveInput | null> {
  return withDatabase(options, (db) => {
    const row = db
      .query(
        `SELECT
          supervisor_conversation_id, supervisor_profile_id, profile_revision,
          supervisor_workflow_name, supervisor_execution_id, source_id, binding_id,
          correlation_key, conversation_revision, selected_managed_run_id,
          selected_managed_run_ids_by_workflow_key_json, status, artifact_dir,
          created_at, updated_at
         FROM supervisor_conversations
         WHERE source_id = ?
           AND binding_id IS ?
           AND correlation_key = ?
           AND status IN ('active', 'idle')
         ORDER BY updated_at DESC
         LIMIT 1`,
      )
      .get(input.sourceId, input.bindingId ?? null, input.correlationKey) as
      | Parameters<typeof toRuntimeSupervisorConversationSaveInput>[0]
      | null;
    return row === null ? null : toRuntimeSupervisorConversationSaveInput(row);
  });
}
export async function updateSupervisorConversationCasInRuntimeDb(
  input: {
    readonly supervisorConversationId: string;
    readonly expectedConversationRevision: number;
    readonly next: RuntimeSupervisorConversationSaveInput;
  },
  options: LoadOptions = {},
): Promise<RuntimeSupervisorConversationSaveInput | null> {
  return withDatabase(options, (db) => {
    const result = db
      .prepare(
        `UPDATE supervisor_conversations SET
          supervisor_execution_id = ?,
          selected_managed_run_id = ?,
          selected_managed_run_ids_by_workflow_key_json = ?,
          conversation_revision = ?,
          status = ?,
          updated_at = ?
        WHERE supervisor_conversation_id = ?
          AND conversation_revision = ?`,
      )
      .run(
        input.next.supervisorExecutionId ?? null,
        input.next.selectedManagedRunId ?? null,
        input.next.selectedManagedRunIdsByWorkflowKeyJson ?? null,
        input.next.conversationRevision,
        input.next.status,
        input.next.updatedAt,
        input.supervisorConversationId,
        input.expectedConversationRevision,
      );
    if (result.changes === 0) {
      return null;
    }
    const row = db
      .query(
        `SELECT
          supervisor_conversation_id, supervisor_profile_id, profile_revision,
          supervisor_workflow_name, supervisor_execution_id, source_id, binding_id,
          correlation_key, conversation_revision, selected_managed_run_id,
          selected_managed_run_ids_by_workflow_key_json, status, artifact_dir,
          created_at, updated_at
         FROM supervisor_conversations
         WHERE supervisor_conversation_id = ?
         LIMIT 1`,
      )
      .get(input.supervisorConversationId) as Parameters<
      typeof toRuntimeSupervisorConversationSaveInput
    >[0];
    return toRuntimeSupervisorConversationSaveInput(row);
  });
}
export async function upsertSupervisorManagedRunToRuntimeDb(
  row: RuntimeSupervisorManagedRunSaveInput,
  options: LoadOptions = {},
): Promise<void> {
  await withDatabase(options, (db) => {
    try {
      const stmt = db.prepare(`
      INSERT INTO supervisor_conversation_managed_runs (
        managed_run_id, supervisor_conversation_id, managed_workflow_key,
        target_workflow_name, run_alias, active_target_execution_id, status,
        restart_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(managed_run_id) DO UPDATE SET
        supervisor_conversation_id=excluded.supervisor_conversation_id,
        managed_workflow_key=excluded.managed_workflow_key,
        target_workflow_name=excluded.target_workflow_name,
        run_alias=excluded.run_alias,
        active_target_execution_id=excluded.active_target_execution_id,
        status=excluded.status,
        restart_count=excluded.restart_count,
        updated_at=excluded.updated_at
    `);
      stmt.run(
        row.managedRunId,
        row.supervisorConversationId,
        row.managedWorkflowKey,
        row.targetWorkflowName,
        row.runAlias ?? null,
        row.activeTargetExecutionId ?? null,
        row.status,
        row.restartCount,
        row.createdAt,
        row.updatedAt,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "";
      if (
        message.includes("UNIQUE constraint failed") &&
        (message.includes("idx_supervisor_managed_runs_alias_scope") ||
          (message.includes("supervisor_conversation_managed_runs") &&
            message.includes("run_alias")))
      ) {
        throw new Error(
          "duplicate managed run runAlias for the same supervisor conversation and managed workflow key",
        );
      }
      throw error;
    }
  });
}
export async function listSupervisorManagedRunsFromRuntimeDb(
  supervisorConversationId: string,
  options: LoadOptions = {},
): Promise<readonly RuntimeSupervisorManagedRunSaveInput[]> {
  return withDatabase(options, (db) => {
    const rows = db
      .query(
        `SELECT
          managed_run_id, supervisor_conversation_id, managed_workflow_key,
          target_workflow_name, run_alias, active_target_execution_id, status,
          restart_count, created_at, updated_at
         FROM supervisor_conversation_managed_runs
         WHERE supervisor_conversation_id = ?
         ORDER BY created_at ASC`,
      )
      .all(supervisorConversationId) as Parameters<
      typeof toRuntimeSupervisorManagedRunSaveInput
    >[0][];
    return rows.map(toRuntimeSupervisorManagedRunSaveInput);
  });
}
export async function insertSupervisorDispatchDecisionToRuntimeDb(
  row: RuntimeSupervisorDispatchDecisionSaveInput,
  options: LoadOptions = {},
): Promise<"inserted" | "duplicate"> {
  return withDatabase(options, (db) => {
    try {
      const stmt = db.prepare(`
        INSERT INTO supervisor_dispatch_decisions (
          decision_id, supervisor_conversation_id, source_message_id,
          profile_revision, conversation_revision, status, proposal_json,
          result_summary_json, receipt_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        row.decisionId,
        row.supervisorConversationId,
        row.sourceMessageId,
        row.profileRevision,
        row.conversationRevision,
        row.status,
        row.proposalJson,
        row.resultSummaryJson ?? null,
        row.receiptId ?? null,
        row.createdAt,
        row.updatedAt,
      );
      return "inserted";
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("UNIQUE constraint failed")) {
        return "duplicate";
      }
      throw error;
    }
  });
}
export async function updateSupervisorDispatchDecisionFromProposedInRuntimeDb(
  input: {
    readonly decisionId: string;
    readonly nextStatus: "applied" | "rejected";
    readonly proposalJson: string;
    readonly resultSummaryJson: string | null;
    readonly conversationRevision: number;
    readonly profileRevision: string;
    readonly updatedAt: string;
  },
  options: LoadOptions = {},
): Promise<boolean> {
  return withDatabase(options, (db) => {
    const result = db
      .prepare(
        `UPDATE supervisor_dispatch_decisions SET
          status = ?,
          proposal_json = ?,
          result_summary_json = ?,
          conversation_revision = ?,
          profile_revision = ?,
          updated_at = ?
        WHERE decision_id = ? AND status = 'proposed'`,
      )
      .run(
        input.nextStatus,
        input.proposalJson,
        input.resultSummaryJson,
        input.conversationRevision,
        input.profileRevision,
        input.updatedAt,
        input.decisionId,
      );
    return result.changes > 0;
  });
}
export async function loadSupervisorDispatchDecisionBySourceMessageFromRuntimeDb(
  input: {
    readonly supervisorConversationId: string;
    readonly sourceMessageId: string;
  },
  options: LoadOptions = {},
): Promise<RuntimeSupervisorDispatchDecisionSaveInput | null> {
  return withDatabase(options, (db) => {
    const row = db
      .query(
        `SELECT
          decision_id, supervisor_conversation_id, source_message_id,
          profile_revision, conversation_revision, status, proposal_json,
          result_summary_json, receipt_id, created_at, updated_at
         FROM supervisor_dispatch_decisions
         WHERE supervisor_conversation_id = ? AND source_message_id = ?
         LIMIT 1`,
      )
      .get(input.supervisorConversationId, input.sourceMessageId) as {
      readonly decision_id: string;
      readonly supervisor_conversation_id: string;
      readonly source_message_id: string;
      readonly profile_revision: string;
      readonly conversation_revision: number;
      readonly status: string;
      readonly proposal_json: string;
      readonly result_summary_json: string | null;
      readonly receipt_id: string | null;
      readonly created_at: string;
      readonly updated_at: string;
    } | null;
    if (row === null) {
      return null;
    }
    return {
      decisionId: row.decision_id,
      supervisorConversationId: row.supervisor_conversation_id,
      sourceMessageId: row.source_message_id,
      profileRevision: row.profile_revision,
      conversationRevision: row.conversation_revision,
      status: row.status,
      proposalJson: row.proposal_json,
      ...(row.result_summary_json === null
        ? {}
        : { resultSummaryJson: row.result_summary_json }),
      ...(row.receipt_id === null ? {} : { receiptId: row.receipt_id }),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}
