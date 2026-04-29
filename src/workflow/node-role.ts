import type { WorkflowNodeRef } from "./types";

export function isManagerNodeRef(
  nodeRef: Pick<WorkflowNodeRef, "kind" | "role">,
): boolean {
  return nodeRef.role === "manager";
}

export function describeWorkflowNodeKind(
  nodeRef: Pick<WorkflowNodeRef, "kind" | "role" | "control">,
): string {
  if (nodeRef.role === "manager") {
    return "manager";
  }
  if (nodeRef.control !== undefined && nodeRef.control !== "none") {
    return nodeRef.control;
  }
  if (nodeRef.role === "worker") {
    return "worker";
  }
  if (nodeRef.kind !== undefined) {
    return nodeRef.kind;
  }
  return "task";
}
