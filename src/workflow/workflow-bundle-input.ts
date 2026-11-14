import { isJsonObject } from "../shared/json";
import { err, ok, type Result } from "./result";

export interface ParsedWorkflowBundleInput {
  readonly workflow: Readonly<Record<string, unknown>>;
  readonly nodePayloads: Readonly<Record<string, unknown>>;
}

export function parseWorkflowBundleInput(
  bundle: unknown,
  path: string,
): Result<ParsedWorkflowBundleInput, string> {
  if (!isJsonObject(bundle)) {
    return err(`${path} must be an object`);
  }
  const workflow = bundle["workflow"];
  if (!isJsonObject(workflow)) {
    return err(`${path}.workflow must be an object`);
  }
  const nodePayloads = bundle["nodePayloads"];
  if (!isJsonObject(nodePayloads)) {
    return err(`${path}.nodePayloads must be an object`);
  }
  return ok({ workflow, nodePayloads });
}
