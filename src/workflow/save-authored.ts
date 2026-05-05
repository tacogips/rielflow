import { resolveAuthoredNodeFileReference } from "./authored-node";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function collectAuthoredNodeFiles(
  authoredWorkflow: Record<string, unknown> | undefined,
): readonly string[] {
  const authoredNodes = authoredWorkflow?.["nodes"];
  if (!Array.isArray(authoredNodes)) {
    return [];
  }

  return [
    ...new Set(
      authoredNodes.flatMap((node) =>
        isRecord(node)
          ? [resolveAuthoredNodeFileReference(node)].filter(
              (nodeFile): nodeFile is string => nodeFile !== undefined,
            )
          : [],
      ),
    ),
  ];
}

export function collectAuthoredStepFiles(
  authoredWorkflow: Record<string, unknown> | undefined,
): readonly string[] {
  const authoredSteps = authoredWorkflow?.["steps"];
  if (!Array.isArray(authoredSteps)) {
    return [];
  }

  return [
    ...new Set(
      authoredSteps.flatMap((step) => {
        if (!isRecord(step)) {
          return [];
        }
        const stepFile = step["stepFile"];
        return typeof stepFile === "string" && stepFile.length > 0
          ? [stepFile]
          : [];
      }),
    ),
  ];
}

export function isDefaultContainerRuntime(value: unknown): boolean {
  return (
    isRecord(value) &&
    value["runnerKind"] === "podman" &&
    value["runnerPath"] === undefined
  );
}
