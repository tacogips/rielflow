import {
  resetAgentBackendReadinessOperationsForTests,
  setAgentBackendReadinessOperationsForTests,
  type AgentBackendReadinessOperations,
} from "./runtime-readiness-agent-probes";

export interface MockAgentBackendReadinessOperationsHandle {
  readonly restore: () => void;
}

export function mockAgentBackendReadinessOperations(
  operations: Partial<AgentBackendReadinessOperations>,
): MockAgentBackendReadinessOperationsHandle {
  setAgentBackendReadinessOperationsForTests(operations);
  return {
    restore: resetAgentBackendReadinessOperationsForTests,
  };
}
