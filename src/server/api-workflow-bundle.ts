import { isJsonObject, type JsonObject } from "../shared/json";
import {
  remapAuthoredNodePayloadsByNodeFile,
} from "../workflow/authored-node";
import { jsonBodyObject, optionalStringField } from "./api-request";

export interface ParsedWorkflowBundleRequest {
  readonly workflow: JsonObject;
  readonly workflowVis: JsonObject;
  readonly nodePayloads: JsonObject;
}

export type WorkflowSaveRequestParseResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly bundle: ParsedWorkflowBundleRequest;
        readonly expectedRevision?: string;
      };
    }
  | {
      readonly ok: false;
      readonly error: string;
    };

export type WorkflowValidationBundleParseResult =
  | {
      readonly kind: "missing";
    }
  | {
      readonly kind: "invalid";
      readonly error: string;
    }
  | {
      readonly kind: "bundle";
      readonly value: ParsedWorkflowBundleRequest;
    };

function parseWorkflowBundleSections(
  bundle: unknown,
): ParsedWorkflowBundleRequest | string {
  if (!isJsonObject(bundle)) {
    return "bundle is required";
  }

  const workflow = bundle["workflow"];
  if (!isJsonObject(workflow)) {
    return "bundle.workflow is required";
  }

  const workflowVis = bundle["workflowVis"];
  if (!isJsonObject(workflowVis)) {
    return "bundle.workflowVis is required";
  }

  const nodePayloads = bundle["nodePayloads"];
  if (!isJsonObject(nodePayloads)) {
    return "bundle.nodePayloads is required";
  }

  return {
    workflow,
    workflowVis,
    nodePayloads,
  };
}

export function readWorkflowSaveRequest(
  body: unknown,
): WorkflowSaveRequestParseResult {
  const bodyObject = jsonBodyObject(body);
  const parsedBundle = parseWorkflowBundleSections(bodyObject["bundle"]);
  if (typeof parsedBundle === "string") {
    return {
      ok: false,
      error: parsedBundle,
    };
  }

  const expectedRevision = optionalStringField(bodyObject, "expectedRevision");
  return {
    ok: true,
    value: {
      bundle: parsedBundle,
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
    },
  };
}

export function readWorkflowValidationBundle(
  body: unknown,
): WorkflowValidationBundleParseResult {
  const bodyObject = jsonBodyObject(body);
  if (!Object.hasOwn(bodyObject, "bundle")) {
    return { kind: "missing" };
  }

  const parsedBundle = parseWorkflowBundleSections(bodyObject["bundle"]);
  if (typeof parsedBundle === "string") {
    return {
      kind: "invalid",
      error: parsedBundle,
    };
  }

  return {
    kind: "bundle",
    value: parsedBundle,
  };
}

export function remapNodePayloadsForValidation(
  bundle: ParsedWorkflowBundleRequest,
): JsonObject {
  return remapAuthoredNodePayloadsByNodeFile(
    bundle.workflow,
    bundle.nodePayloads,
  ) as JsonObject;
}
