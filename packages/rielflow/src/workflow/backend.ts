import {
  normalizeCliAgentBackend as normalizeCoreCliAgentBackend,
  normalizeNodeExecutionBackend as normalizeCoreNodeExecutionBackend,
} from "rielflow-core/workflow-model";
export {
  CLI_AGENT_BACKENDS,
  NODE_EXECUTION_BACKEND,
  NODE_EXECUTION_BACKENDS,
  NODE_EXECUTION_BACKEND_LIST_TEXT,
} from "rielflow-core/workflow-model";
import type { CliAgentBackend, NodeExecutionBackend } from "./types";

export function normalizeCliAgentBackend(
  value: unknown,
): CliAgentBackend | null {
  return normalizeCoreCliAgentBackend(value) ?? null;
}

export function isCliAgentBackend(value: unknown): value is CliAgentBackend {
  return normalizeCliAgentBackend(value) !== null;
}

export function normalizeNodeExecutionBackend(
  value: unknown,
): NodeExecutionBackend | null {
  return normalizeCoreNodeExecutionBackend(value) ?? null;
}
