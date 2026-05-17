import type { NodeExecutionBackend } from "../types";

export type NodeValidationStatus = "valid" | "warning" | "invalid" | "unknown";

export type NodeValidationSource = "node" | "addon" | "agent-backend";

export interface NodeValidationResultInput {
  readonly status: NodeValidationStatus;
  readonly message: string;
  readonly nodeId?: string;
  readonly stepIds?: readonly string[];
  readonly source?: NodeValidationSource;
  readonly path?: string;
  readonly backend?: NodeExecutionBackend;
  readonly addonName?: string;
}

export class NodeValidationResult {
  readonly status: NodeValidationStatus;
  readonly message: string;
  readonly nodeId?: string;
  readonly stepIds?: readonly string[];
  readonly source?: NodeValidationSource;
  readonly path?: string;
  readonly backend?: NodeExecutionBackend;
  readonly addonName?: string;

  constructor(input: NodeValidationResultInput) {
    this.status = input.status;
    this.message = input.message;
    if (input.nodeId !== undefined) {
      this.nodeId = input.nodeId;
    }
    if (input.stepIds !== undefined) {
      this.stepIds = input.stepIds;
    }
    if (input.source !== undefined) {
      this.source = input.source;
    }
    if (input.path !== undefined) {
      this.path = input.path;
    }
    if (input.backend !== undefined) {
      this.backend = input.backend;
    }
    if (input.addonName !== undefined) {
      this.addonName = input.addonName;
    }
  }
}

export function hasInvalidNodeValidationResult(
  results: readonly NodeValidationResult[],
): boolean {
  return results.some((result) => result.status === "invalid");
}
