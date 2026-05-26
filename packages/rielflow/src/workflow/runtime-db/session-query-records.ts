import type { CommunicationRecord, NodeExecutionRecord } from "../session";
import type { LoadOptions } from "../types";
import type {
  RuntimeLlmSessionMessageRecord,
  RuntimeNodeExecutionSummary,
  RuntimeNodeLogEntry,
  RuntimeSessionRow,
  RuntimeSessionSummary,
} from "./schema-and-record-types";
import {
  toRuntimeSessionSummary,
  withDatabase,
  withEventRuntimeDatabase,
} from "./schema-and-record-types";
import {
  formatCommunicationEventMessage,
  insertNodeLog,
  toNodeLogRow,
} from "./event-records";

export async function saveCommunicationEventToRuntimeDb(
  communication: CommunicationRecord,
  options: LoadOptions = {},
): Promise<void> {
  await withDatabase(options, (db) => {
    insertNodeLog(
      db,
      toNodeLogRow({
        sessionId: communication.workflowExecutionId,
        nodeId: communication.fromNodeId,
        nodeExecId: communication.sourceNodeExecId,
        level: communication.status === "delivery_failed" ? "warning" : "info",
        message: formatCommunicationEventMessage(communication),
        payload: {
          eventType: "communication",
          workflowId: communication.workflowId,
          workflowExecutionId: communication.workflowExecutionId,
          communicationId: communication.communicationId,
          fromNodeId: communication.fromNodeId,
          toNodeId: communication.toNodeId,
          routingScope: communication.routingScope,
          deliveryKind: communication.deliveryKind,
          transitionWhen: communication.transitionWhen,
          sourceNodeExecId: communication.sourceNodeExecId,
          status: communication.status,
          artifactDir: communication.artifactDir,
          createdAt: communication.createdAt,
          ...(communication.deliveredAt === undefined
            ? {}
            : { deliveredAt: communication.deliveredAt }),
        },
        at: communication.deliveredAt ?? communication.createdAt,
      }),
    );
  });
}
export async function listRuntimeSessions(
  options: LoadOptions = {},
): Promise<readonly RuntimeSessionSummary[]> {
  return withDatabase(options, (db) => {
    const rows = db
      .query(
        `SELECT
          session_id,
          workflow_name,
          workflow_id,
          status,
          started_at,
          ended_at,
          current_node_id,
          current_step_id,
          node_execution_counter,
          last_error,
          updated_at
         FROM sessions
         ORDER BY updated_at DESC`,
      )
      .all() as RuntimeSessionRow[];

    return rows.map(toRuntimeSessionSummary);
  });
}
export async function loadRuntimeSessionSummary(
  sessionId: string,
  options: LoadOptions = {},
): Promise<RuntimeSessionSummary | null> {
  return withDatabase(options, (db) => {
    const row = db
      .query(
        `SELECT
          session_id,
          workflow_name,
          workflow_id,
          status,
          started_at,
          ended_at,
          current_node_id,
          current_step_id,
          node_execution_counter,
          last_error,
          updated_at
         FROM sessions
         WHERE session_id = ?`,
      )
      .get(sessionId) as RuntimeSessionRow | null;

    return row === null ? null : toRuntimeSessionSummary(row);
  });
}
export async function listRuntimeNodeExecutions(
  sessionId: string,
  options: LoadOptions = {},
): Promise<readonly RuntimeNodeExecutionSummary[]> {
  return withDatabase(options, (db) => {
    const rows = db
      .query(
        `         SELECT
           session_id,
           node_exec_id,
           node_id,
           step_id,
           node_registry_id,
           mailbox_instance_id,
           status,
           artifact_dir,
           started_at,
           ended_at,
           attempt,
           output_attempt_count,
           output_validation_errors_json,
           prompt_variant,
           timeout_ms,
           backend_session_mode,
           backend_session_id,
           restarted_from_node_exec_id,
           execution_ordinal,
           input_hash,
           output_hash,
           input_json,
           output_json,
           created_at
          FROM node_executions
         WHERE session_id = ?
         ORDER BY created_at ASC`,
      )
      .all(sessionId) as Array<{
      session_id: string;
      node_exec_id: string;
      node_id: string;
      step_id: string | null;
      node_registry_id: string | null;
      mailbox_instance_id: string | null;
      status: string;
      artifact_dir: string;
      started_at: string;
      ended_at: string;
      attempt: number | null;
      output_attempt_count: number | null;
      output_validation_errors_json: string | null;
      prompt_variant: string | null;
      timeout_ms: number | null;
      backend_session_mode: NodeExecutionRecord["backendSessionMode"] | null;
      backend_session_id: NodeExecutionRecord["backendSessionId"] | null;
      restarted_from_node_exec_id: string | null;
      execution_ordinal: number | null;
      input_hash: string;
      output_hash: string;
      input_json: string;
      output_json: string;
      created_at: string;
    }>;

    return rows.map((row) => ({
      sessionId: row.session_id,
      nodeExecId: row.node_exec_id,
      nodeId: row.node_id,
      stepId: row.step_id,
      nodeRegistryId: row.node_registry_id,
      mailboxInstanceId: row.mailbox_instance_id,
      status: row.status,
      artifactDir: row.artifact_dir,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      attempt: row.attempt,
      outputAttemptCount: row.output_attempt_count,
      outputValidationErrors:
        row.output_validation_errors_json === null
          ? null
          : (JSON.parse(
              row.output_validation_errors_json,
            ) as NodeExecutionRecord["outputValidationErrors"]),
      promptVariant: row.prompt_variant,
      timeoutMs: row.timeout_ms,
      backendSessionMode: row.backend_session_mode,
      backendSessionId: row.backend_session_id,
      restartedFromNodeExecId: row.restarted_from_node_exec_id,
      executionOrdinal: row.execution_ordinal,
      inputHash: row.input_hash,
      outputHash: row.output_hash,
      inputJson: row.input_json,
      outputJson: row.output_json,
      createdAt: row.created_at,
    }));
  });
}
export async function listRuntimeNodeLogs(
  sessionId: string,
  options: LoadOptions = {},
): Promise<readonly RuntimeNodeLogEntry[]> {
  return withDatabase(options, (db) => {
    const rows = db
      .query(
        `SELECT
          id,
          session_id,
          node_exec_id,
          node_id,
          level,
          message,
          payload_json,
          at
         FROM node_logs
         WHERE session_id = ?
         ORDER BY id ASC`,
      )
      .all(sessionId) as Array<{
      id: number;
      session_id: string;
      node_exec_id: string | null;
      node_id: string | null;
      level: string;
      message: string;
      payload_json: string | null;
      at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      nodeExecId: row.node_exec_id,
      nodeId: row.node_id,
      level: row.level,
      message: row.message,
      payloadJson: row.payload_json,
      at: row.at,
    }));
  });
}
export async function listRuntimeLlmSessionMessages(
  sessionId: string,
  options: LoadOptions = {},
): Promise<readonly RuntimeLlmSessionMessageRecord[]> {
  return withDatabase(options, (db) => {
    const rows = db
      .query(
        `SELECT
          id,
          session_id,
          node_exec_id,
          node_id,
          provider,
          model,
          backend_session_id,
          ordinal,
          role,
          event_type,
          content_text,
          raw_message_json,
          at
         FROM llm_session_messages
         WHERE session_id = ?
         ORDER BY node_exec_id ASC, ordinal ASC, id ASC`,
      )
      .all(sessionId) as Array<{
      id: number;
      session_id: string;
      node_exec_id: string;
      node_id: string;
      provider: string;
      model: string;
      backend_session_id: string | null;
      ordinal: number;
      role: string | null;
      event_type: string;
      content_text: string | null;
      raw_message_json: string | null;
      at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      nodeExecId: row.node_exec_id,
      nodeId: row.node_id,
      provider: row.provider,
      model: row.model,
      backendSessionId: row.backend_session_id,
      ordinal: row.ordinal,
      role: row.role,
      eventType: row.event_type,
      contentText: row.content_text,
      rawMessageJson: row.raw_message_json,
      at: row.at,
    }));
  });
}
export async function deleteRuntimeSession(
  sessionId: string,
  options: LoadOptions = {},
): Promise<void> {
  await withDatabase(options, (db) => {
    const runDelete = db.transaction((targetSessionId: string) => {
      db.prepare("DELETE FROM llm_session_messages WHERE session_id = ?").run(
        targetSessionId,
      );
      db.prepare("DELETE FROM node_logs WHERE session_id = ?").run(
        targetSessionId,
      );
      db.prepare("DELETE FROM node_executions WHERE session_id = ?").run(
        targetSessionId,
      );
      db.prepare("DELETE FROM sessions WHERE session_id = ?").run(
        targetSessionId,
      );
    });
    runDelete(sessionId);
  });
}
export interface RuntimeEventSupervisedRunSaveInput {
  readonly supervisedRunId: string;
  readonly sourceId: string;
  readonly bindingId: string;
  readonly correlationKey: string;
  readonly supervisorWorkflowName: string;
  readonly supervisorExecutionId?: string;
  readonly targetWorkflowName: string;
  readonly activeTargetExecutionId?: string;
  readonly status: string;
  readonly restartCount: number;
  readonly maxRestartsOnFailure: number;
  readonly autoImproveEnabled: boolean;
  readonly artifactDir: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface RuntimeEventSupervisorCommandSaveInput {
  readonly commandId: string;
  readonly supervisedRunId: string;
  readonly sourceId: string;
  readonly bindingId: string;
  readonly correlationKey: string;
  readonly action: string;
  readonly argsJson?: string;
  readonly receiptId: string;
  readonly resultJson: string;
  readonly createdAt: string;
}
export async function upsertEventSupervisedRunToRuntimeDb(
  row: RuntimeEventSupervisedRunSaveInput,
  options: LoadOptions = {},
): Promise<void> {
  await withEventRuntimeDatabase(options, (db) => {
    const stmt = db.prepare(`
      INSERT INTO event_supervised_runs (
        supervised_run_id, source_id, binding_id, correlation_key,
        supervisor_workflow_name, supervisor_execution_id, target_workflow_name,
        active_target_execution_id, status, restart_count, max_restarts_on_failure,
        auto_improve_enabled, artifact_dir, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(supervised_run_id) DO UPDATE SET
        supervisor_workflow_name=excluded.supervisor_workflow_name,
        supervisor_execution_id=excluded.supervisor_execution_id,
        target_workflow_name=excluded.target_workflow_name,
        active_target_execution_id=excluded.active_target_execution_id,
        status=excluded.status,
        restart_count=excluded.restart_count,
        max_restarts_on_failure=excluded.max_restarts_on_failure,
        auto_improve_enabled=excluded.auto_improve_enabled,
        artifact_dir=excluded.artifact_dir,
        updated_at=excluded.updated_at
    `);
    stmt.run(
      row.supervisedRunId,
      row.sourceId,
      row.bindingId,
      row.correlationKey,
      row.supervisorWorkflowName,
      row.supervisorExecutionId ?? null,
      row.targetWorkflowName,
      row.activeTargetExecutionId ?? null,
      row.status,
      row.restartCount,
      row.maxRestartsOnFailure,
      row.autoImproveEnabled ? 1 : 0,
      row.artifactDir,
      row.createdAt,
      row.updatedAt,
    );
  });
}
export async function findActiveEventSupervisedRunRow(
  input: {
    readonly sourceId: string;
    readonly bindingId: string;
    readonly correlationKey: string;
  },
  options: LoadOptions = {},
): Promise<RuntimeEventSupervisedRunSaveInput | null> {
  return withEventRuntimeDatabase(options, (db) => {
    const row = db
      .query(
        `SELECT
          supervised_run_id, source_id, binding_id, correlation_key,
          supervisor_workflow_name, supervisor_execution_id, target_workflow_name,
          active_target_execution_id, status, restart_count, max_restarts_on_failure,
          auto_improve_enabled, artifact_dir, created_at, updated_at
         FROM event_supervised_runs
         WHERE source_id = ? AND binding_id = ? AND correlation_key = ?
           AND status IN ('starting','running','stopping','restarting')
         ORDER BY updated_at DESC
         LIMIT 1`,
      )
      .get(input.sourceId, input.bindingId, input.correlationKey) as {
      readonly supervised_run_id: string;
      readonly source_id: string;
      readonly binding_id: string;
      readonly correlation_key: string;
      readonly supervisor_workflow_name: string;
      readonly supervisor_execution_id: string | null;
      readonly target_workflow_name: string;
      readonly active_target_execution_id: string | null;
      readonly status: string;
      readonly restart_count: number;
      readonly max_restarts_on_failure: number;
      readonly auto_improve_enabled: number;
      readonly artifact_dir: string;
      readonly created_at: string;
      readonly updated_at: string;
    } | null;
    if (row === null) {
      return null;
    }
    return {
      supervisedRunId: row.supervised_run_id,
      sourceId: row.source_id,
      bindingId: row.binding_id,
      correlationKey: row.correlation_key,
      supervisorWorkflowName: row.supervisor_workflow_name,
      ...(row.supervisor_execution_id === null
        ? {}
        : { supervisorExecutionId: row.supervisor_execution_id }),
      targetWorkflowName: row.target_workflow_name,
      ...(row.active_target_execution_id === null
        ? {}
        : { activeTargetExecutionId: row.active_target_execution_id }),
      status: row.status,
      restartCount: row.restart_count,
      maxRestartsOnFailure: row.max_restarts_on_failure,
      autoImproveEnabled: row.auto_improve_enabled !== 0,
      artifactDir: row.artifact_dir,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}
export async function findLatestEventSupervisedRunRow(
  input: {
    readonly sourceId: string;
    readonly bindingId: string;
    readonly correlationKey: string;
  },
  options: LoadOptions = {},
): Promise<RuntimeEventSupervisedRunSaveInput | null> {
  return withEventRuntimeDatabase(options, (db) => {
    const row = db
      .query(
        `SELECT
          supervised_run_id, source_id, binding_id, correlation_key,
          supervisor_workflow_name, supervisor_execution_id, target_workflow_name,
          active_target_execution_id, status, restart_count, max_restarts_on_failure,
          auto_improve_enabled, artifact_dir, created_at, updated_at
         FROM event_supervised_runs
         WHERE source_id = ? AND binding_id = ? AND correlation_key = ?
         ORDER BY updated_at DESC
         LIMIT 1`,
      )
      .get(input.sourceId, input.bindingId, input.correlationKey) as {
      readonly supervised_run_id: string;
      readonly source_id: string;
      readonly binding_id: string;
      readonly correlation_key: string;
      readonly supervisor_workflow_name: string;
      readonly supervisor_execution_id: string | null;
      readonly target_workflow_name: string;
      readonly active_target_execution_id: string | null;
      readonly status: string;
      readonly restart_count: number;
      readonly max_restarts_on_failure: number;
      readonly auto_improve_enabled: number;
      readonly artifact_dir: string;
      readonly created_at: string;
      readonly updated_at: string;
    } | null;
    if (row === null) {
      return null;
    }
    return {
      supervisedRunId: row.supervised_run_id,
      sourceId: row.source_id,
      bindingId: row.binding_id,
      correlationKey: row.correlation_key,
      supervisorWorkflowName: row.supervisor_workflow_name,
      ...(row.supervisor_execution_id === null
        ? {}
        : { supervisorExecutionId: row.supervisor_execution_id }),
      targetWorkflowName: row.target_workflow_name,
      ...(row.active_target_execution_id === null
        ? {}
        : { activeTargetExecutionId: row.active_target_execution_id }),
      status: row.status,
      restartCount: row.restart_count,
      maxRestartsOnFailure: row.max_restarts_on_failure,
      autoImproveEnabled: row.auto_improve_enabled !== 0,
      artifactDir: row.artifact_dir,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}
export async function loadEventSupervisedRunRowById(
  supervisedRunId: string,
  options: LoadOptions = {},
): Promise<RuntimeEventSupervisedRunSaveInput | null> {
  return withEventRuntimeDatabase(options, (db) => {
    const row = db
      .query(
        `SELECT
          supervised_run_id, source_id, binding_id, correlation_key,
          supervisor_workflow_name, supervisor_execution_id, target_workflow_name,
          active_target_execution_id, status, restart_count, max_restarts_on_failure,
          auto_improve_enabled, artifact_dir, created_at, updated_at
         FROM event_supervised_runs
         WHERE supervised_run_id = ?
         LIMIT 1`,
      )
      .get(supervisedRunId) as {
      readonly supervised_run_id: string;
      readonly source_id: string;
      readonly binding_id: string;
      readonly correlation_key: string;
      readonly supervisor_workflow_name: string;
      readonly supervisor_execution_id: string | null;
      readonly target_workflow_name: string;
      readonly active_target_execution_id: string | null;
      readonly status: string;
      readonly restart_count: number;
      readonly max_restarts_on_failure: number;
      readonly auto_improve_enabled: number;
      readonly artifact_dir: string;
      readonly created_at: string;
      readonly updated_at: string;
    } | null;
    if (row === null) {
      return null;
    }
    return {
      supervisedRunId: row.supervised_run_id,
      sourceId: row.source_id,
      bindingId: row.binding_id,
      correlationKey: row.correlation_key,
      supervisorWorkflowName: row.supervisor_workflow_name,
      ...(row.supervisor_execution_id === null
        ? {}
        : { supervisorExecutionId: row.supervisor_execution_id }),
      targetWorkflowName: row.target_workflow_name,
      ...(row.active_target_execution_id === null
        ? {}
        : { activeTargetExecutionId: row.active_target_execution_id }),
      status: row.status,
      restartCount: row.restart_count,
      maxRestartsOnFailure: row.max_restarts_on_failure,
      autoImproveEnabled: row.auto_improve_enabled !== 0,
      artifactDir: row.artifact_dir,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}
export async function loadEventSupervisedRunRowByActiveTargetExecutionId(
  activeTargetExecutionId: string,
  options: LoadOptions = {},
): Promise<RuntimeEventSupervisedRunSaveInput | null> {
  return withEventRuntimeDatabase(options, (db) => {
    const row = db
      .query(
        `SELECT
          supervised_run_id, source_id, binding_id, correlation_key,
          supervisor_workflow_name, supervisor_execution_id, target_workflow_name,
          active_target_execution_id, status, restart_count, max_restarts_on_failure,
          auto_improve_enabled, artifact_dir, created_at, updated_at
         FROM event_supervised_runs
         WHERE active_target_execution_id = ?
         ORDER BY updated_at DESC
         LIMIT 1`,
      )
      .get(activeTargetExecutionId) as {
      readonly supervised_run_id: string;
      readonly source_id: string;
      readonly binding_id: string;
      readonly correlation_key: string;
      readonly supervisor_workflow_name: string;
      readonly supervisor_execution_id: string | null;
      readonly target_workflow_name: string;
      readonly active_target_execution_id: string | null;
      readonly status: string;
      readonly restart_count: number;
      readonly max_restarts_on_failure: number;
      readonly auto_improve_enabled: number;
      readonly artifact_dir: string;
      readonly created_at: string;
      readonly updated_at: string;
    } | null;
    if (row === null) {
      return null;
    }
    return {
      supervisedRunId: row.supervised_run_id,
      sourceId: row.source_id,
      bindingId: row.binding_id,
      correlationKey: row.correlation_key,
      supervisorWorkflowName: row.supervisor_workflow_name,
      ...(row.supervisor_execution_id === null
        ? {}
        : { supervisorExecutionId: row.supervisor_execution_id }),
      targetWorkflowName: row.target_workflow_name,
      ...(row.active_target_execution_id === null
        ? {}
        : { activeTargetExecutionId: row.active_target_execution_id }),
      status: row.status,
      restartCount: row.restart_count,
      maxRestartsOnFailure: row.max_restarts_on_failure,
      autoImproveEnabled: row.auto_improve_enabled !== 0,
      artifactDir: row.artifact_dir,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}
export async function loadEventSupervisedRunRowByCommandId(
  commandId: string,
  options: LoadOptions = {},
): Promise<RuntimeEventSupervisedRunSaveInput | null> {
  return withEventRuntimeDatabase(options, (db) => {
    const row = db
      .query(
        `SELECT
          r.supervised_run_id, r.source_id, r.binding_id, r.correlation_key,
          r.supervisor_workflow_name, r.supervisor_execution_id,
          r.target_workflow_name, r.active_target_execution_id, r.status,
          r.restart_count, r.max_restarts_on_failure, r.auto_improve_enabled,
          r.artifact_dir, r.created_at, r.updated_at
         FROM event_supervisor_commands c
         JOIN event_supervised_runs r
           ON r.supervised_run_id = c.supervised_run_id
         WHERE c.command_id = ?
         LIMIT 1`,
      )
      .get(commandId) as {
      readonly supervised_run_id: string;
      readonly source_id: string;
      readonly binding_id: string;
      readonly correlation_key: string;
      readonly supervisor_workflow_name: string;
      readonly supervisor_execution_id: string | null;
      readonly target_workflow_name: string;
      readonly active_target_execution_id: string | null;
      readonly status: string;
      readonly restart_count: number;
      readonly max_restarts_on_failure: number;
      readonly auto_improve_enabled: number;
      readonly artifact_dir: string;
      readonly created_at: string;
      readonly updated_at: string;
    } | null;
    if (row === null) {
      return null;
    }
    return {
      supervisedRunId: row.supervised_run_id,
      sourceId: row.source_id,
      bindingId: row.binding_id,
      correlationKey: row.correlation_key,
      supervisorWorkflowName: row.supervisor_workflow_name,
      ...(row.supervisor_execution_id === null
        ? {}
        : { supervisorExecutionId: row.supervisor_execution_id }),
      targetWorkflowName: row.target_workflow_name,
      ...(row.active_target_execution_id === null
        ? {}
        : { activeTargetExecutionId: row.active_target_execution_id }),
      status: row.status,
      restartCount: row.restart_count,
      maxRestartsOnFailure: row.max_restarts_on_failure,
      autoImproveEnabled: row.auto_improve_enabled !== 0,
      artifactDir: row.artifact_dir,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}
export async function findEventSupervisorCommandResultJson(
  commandId: string,
  options: LoadOptions = {},
): Promise<string | null> {
  return withEventRuntimeDatabase(options, (db) => {
    const row = db
      .query(
        "SELECT result_json FROM event_supervisor_commands WHERE command_id = ? LIMIT 1",
      )
      .get(commandId) as { readonly result_json: string } | null;
    return row === null ? null : row.result_json;
  });
}
export async function insertEventSupervisorCommandRow(
  row: RuntimeEventSupervisorCommandSaveInput,
  options: LoadOptions = {},
): Promise<"inserted" | "duplicate"> {
  return withEventRuntimeDatabase(options, (db) => {
    try {
      const stmt = db.prepare(`
        INSERT INTO event_supervisor_commands (
          command_id, supervised_run_id, source_id, binding_id, correlation_key,
          action, args_json, receipt_id, result_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        row.commandId,
        row.supervisedRunId,
        row.sourceId,
        row.bindingId,
        row.correlationKey,
        row.action,
        row.argsJson ?? null,
        row.receiptId,
        row.resultJson,
        row.createdAt,
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
export async function updateEventSupervisorCommandResultJson(
  commandId: string,
  resultJson: string,
  options: LoadOptions = {},
): Promise<void> {
  await withEventRuntimeDatabase(options, (db) => {
    db.prepare(
      "UPDATE event_supervisor_commands SET result_json = ? WHERE command_id = ?",
    ).run(resultJson, commandId);
  });
}
export interface RuntimeSupervisorConversationSaveInput {
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
  readonly selectedManagedRunIdsByWorkflowKeyJson?: string | null;
  readonly status: string;
  readonly artifactDir: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface RuntimeSupervisorManagedRunSaveInput {
  readonly managedRunId: string;
  readonly supervisorConversationId: string;
  readonly managedWorkflowKey: string;
  readonly targetWorkflowName: string;
  readonly runAlias?: string;
  readonly activeTargetExecutionId?: string;
  readonly status: string;
  readonly restartCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface RuntimeSupervisorDispatchDecisionSaveInput {
  readonly decisionId: string;
  readonly supervisorConversationId: string;
  readonly sourceMessageId: string;
  readonly profileRevision: string;
  readonly conversationRevision: number;
  readonly status: string;
  readonly proposalJson: string;
  readonly resultSummaryJson?: string;
  readonly receiptId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export function toRuntimeSupervisorConversationSaveInput(row: {
  readonly supervisor_conversation_id: string;
  readonly supervisor_profile_id: string;
  readonly profile_revision: string;
  readonly supervisor_workflow_name: string;
  readonly supervisor_execution_id: string | null;
  readonly source_id: string;
  readonly binding_id: string | null;
  readonly correlation_key: string;
  readonly conversation_revision: number;
  readonly selected_managed_run_id: string | null;
  readonly selected_managed_run_ids_by_workflow_key_json: string | null;
  readonly status: string;
  readonly artifact_dir: string;
  readonly created_at: string;
  readonly updated_at: string;
}): RuntimeSupervisorConversationSaveInput {
  return {
    supervisorConversationId: row.supervisor_conversation_id,
    supervisorProfileId: row.supervisor_profile_id,
    profileRevision: row.profile_revision,
    supervisorWorkflowName: row.supervisor_workflow_name,
    ...(row.supervisor_execution_id === null
      ? {}
      : { supervisorExecutionId: row.supervisor_execution_id }),
    sourceId: row.source_id,
    ...(row.binding_id === null ? {} : { bindingId: row.binding_id }),
    correlationKey: row.correlation_key,
    conversationRevision: row.conversation_revision,
    ...(row.selected_managed_run_id === null
      ? {}
      : { selectedManagedRunId: row.selected_managed_run_id }),
    ...(row.selected_managed_run_ids_by_workflow_key_json === null
      ? {}
      : {
          selectedManagedRunIdsByWorkflowKeyJson:
            row.selected_managed_run_ids_by_workflow_key_json,
        }),
    status: row.status,
    artifactDir: row.artifact_dir,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export function toRuntimeSupervisorManagedRunSaveInput(row: {
  readonly managed_run_id: string;
  readonly supervisor_conversation_id: string;
  readonly managed_workflow_key: string;
  readonly target_workflow_name: string;
  readonly run_alias: string | null;
  readonly active_target_execution_id: string | null;
  readonly status: string;
  readonly restart_count: number;
  readonly created_at: string;
  readonly updated_at: string;
}): RuntimeSupervisorManagedRunSaveInput {
  return {
    managedRunId: row.managed_run_id,
    supervisorConversationId: row.supervisor_conversation_id,
    managedWorkflowKey: row.managed_workflow_key,
    targetWorkflowName: row.target_workflow_name,
    ...(row.run_alias === null ? {} : { runAlias: row.run_alias }),
    ...(row.active_target_execution_id === null
      ? {}
      : { activeTargetExecutionId: row.active_target_execution_id }),
    status: row.status,
    restartCount: row.restart_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
