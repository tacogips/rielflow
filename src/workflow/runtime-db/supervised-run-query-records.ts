import type { LoadOptions } from "../types";
import type { RuntimeEventSupervisedRunSaveInput } from "./session-query-records";
import { withEventRuntimeDatabase } from "./schema-and-record-types";

type EventSupervisedRunRow = {
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
};

function rowToSaveInput(
  row: EventSupervisedRunRow,
): RuntimeEventSupervisedRunSaveInput {
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
}

export async function listActiveEventSupervisedRunRowsByTargetWorkflowName(
  targetWorkflowName: string,
  options: LoadOptions = {},
): Promise<readonly RuntimeEventSupervisedRunSaveInput[]> {
  return withEventRuntimeDatabase(options, (db) => {
    const rows = db
      .query(
        `SELECT
          supervised_run_id, source_id, binding_id, correlation_key,
          supervisor_workflow_name, supervisor_execution_id, target_workflow_name,
          active_target_execution_id, status, restart_count, max_restarts_on_failure,
          auto_improve_enabled, artifact_dir, created_at, updated_at
         FROM event_supervised_runs
         WHERE target_workflow_name = ?
           AND status IN ('starting','running','stopping','restarting')
         ORDER BY updated_at DESC
         LIMIT 2`,
      )
      .all(targetWorkflowName) as EventSupervisedRunRow[];
    return rows.map(rowToSaveInput);
  });
}

export async function findLatestEventSupervisedRunRowByTargetWorkflowName(
  targetWorkflowName: string,
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
         WHERE target_workflow_name = ?
         ORDER BY updated_at DESC
         LIMIT 1`,
      )
      .get(targetWorkflowName) as EventSupervisedRunRow | null;
    return row === null ? null : rowToSaveInput(row);
  });
}
