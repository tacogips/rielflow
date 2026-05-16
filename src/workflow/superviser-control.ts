import {
  normalizeAutoImprovePolicy,
  parseAutoImprovePolicyInput,
} from "./auto-improve-policy";
import { err, ok, type Result } from "./result";
import { parseWorkflowBundleInput } from "./workflow-bundle-input";
import type {
  GetWorkflowExecutionDetailsAddonInput,
  GetWorkflowStatusAddonInput,
  LoadWorkflowDefinitionAddonInput,
  RerunWorkflowAddonInput,
  StartWorkflowAddonInput,
  GetWorkflowExecutionDetailsOutput,
  GetWorkflowStatusOutput,
  LoadWorkflowDefinitionOutput,
  RerunTargetWorkflowOutput,
  SaveWorkflowDefinitionAddonInput,
  SaveWorkflowDefinitionOutput,
  StartTargetWorkflowOutput,
  SuperviserControlAuth,
  SuperviserControlAddonName,
} from "./types";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(
  raw: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
): Result<string, string> {
  const v = raw[key];
  if (typeof v !== "string" || v.trim().length === 0) {
    return err(`${path}.${key} must be a non-empty string`);
  }
  return ok(v.trim());
}

/**
 * Engine-provided target workflow operations for a nested `superviserWorkflowId` run
 * (design-auto-improve-superviser-mode phase 2).
 */
export interface SuperviserRuntimeControl {
  readonly auth: Readonly<SuperviserControlAuth>;
  startTargetWorkflow(
    input: Readonly<StartWorkflowAddonInput>,
  ): Promise<Result<StartTargetWorkflowOutput, string>>;
  getWorkflowStatus(
    input: Readonly<GetWorkflowStatusAddonInput>,
  ): Promise<Result<GetWorkflowStatusOutput, string>>;
  getWorkflowExecutionDetails(
    input: Readonly<GetWorkflowExecutionDetailsAddonInput>,
  ): Promise<Result<GetWorkflowExecutionDetailsOutput, string>>;
  rerunTargetWorkflow(
    input: Readonly<RerunWorkflowAddonInput>,
  ): Promise<Result<RerunTargetWorkflowOutput, string>>;
  loadWorkflowDefinition(
    input: Readonly<LoadWorkflowDefinitionAddonInput>,
  ): Promise<Result<LoadWorkflowDefinitionOutput, string>>;
  saveWorkflowDefinition(
    input: Readonly<SaveWorkflowDefinitionAddonInput>,
  ): Promise<Result<SaveWorkflowDefinitionOutput, string>>;
}

export function parseSuperviserControlAuth(
  args: Readonly<Record<string, unknown>> | null,
  path: string,
): Result<SuperviserControlAuth, string> {
  if (args === null || !isRecord(args)) {
    return err(`${path} must be an object`);
  }
  const supervisionRunId = readNonEmptyString(args, "supervisionRunId", path);
  if (!supervisionRunId.ok) {
    return supervisionRunId;
  }
  const targetSessionId = readNonEmptyString(args, "targetSessionId", path);
  if (!targetSessionId.ok) {
    return targetSessionId;
  }
  return ok({
    supervisionRunId: supervisionRunId.value,
    targetSessionId: targetSessionId.value,
  });
}

function validateAuthForControl(
  expected: Readonly<SuperviserControlAuth>,
  parsed: Readonly<SuperviserControlAuth>,
): Result<void, string> {
  if (expected.supervisionRunId !== parsed.supervisionRunId) {
    return err(
      `supervisionRunId does not match active superviser control scope (expected ${expected.supervisionRunId})`,
    );
  }
  if (expected.targetSessionId !== parsed.targetSessionId) {
    return err(
      "targetSessionId does not match active superviser control scope for this supervision run",
    );
  }
  return ok(undefined);
}

interface ParsedAuthorizedArguments {
  readonly args: Readonly<Record<string, unknown>>;
  readonly auth: SuperviserControlAuth;
}

function parseAuthorizedArgumentsObject(
  args: Readonly<Record<string, unknown>> | null,
  path: string,
  expected: Readonly<SuperviserControlAuth>,
): Result<ParsedAuthorizedArguments, string> {
  const authResult = parseSuperviserControlAuth(args, path);
  if (!authResult.ok) {
    return authResult;
  }
  const authValidation = validateAuthForControl(expected, authResult.value);
  if (!authValidation.ok) {
    return authValidation;
  }
  if (args === null || !isRecord(args)) {
    return err(`${path} must be an object`);
  }
  return ok({ args, auth: authResult.value });
}

function parseStartWorkflowAfterAuth(
  args: Readonly<Record<string, unknown>>,
  path: string,
  auth: SuperviserControlAuth,
): Result<
  { readonly auth: SuperviserControlAuth } & StartWorkflowAddonInput,
  string
> {
  const workflowId = readNonEmptyString(args, "workflowId", path);
  if (!workflowId.ok) {
    return workflowId;
  }
  const rv = args["runtimeVariables"];
  let runtimeVariables: Readonly<Record<string, unknown>> | undefined;
  if (rv !== undefined) {
    if (!isRecord(rv)) {
      return err(`${path}.runtimeVariables must be an object when provided`);
    }
    runtimeVariables = rv;
  }
  const ai = args["autoImprove"];
  if (ai === undefined) {
    return ok({
      auth,
      workflowId: workflowId.value,
      ...(runtimeVariables === undefined ? {} : { runtimeVariables }),
    });
  }
  const parsedAutoImprove = parseAutoImprovePolicyInput(
    ai,
    `${path}.autoImprove`,
  );
  if (!parsedAutoImprove.ok) {
    return parsedAutoImprove;
  }
  const policy = normalizeAutoImprovePolicy(parsedAutoImprove.value);
  if (!policy.ok) {
    return err(`${path}.autoImprove: ${policy.error}`);
  }
  if (policy.value === undefined) {
    return err(
      `${path}.autoImprove cannot be disabled (enabled=false) for nested start-workflow; omit autoImprove instead`,
    );
  }
  return ok({
    auth,
    workflowId: workflowId.value,
    ...(runtimeVariables === undefined ? {} : { runtimeVariables }),
    autoImprove: policy.value,
  });
}

export function parseStartTargetWorkflowControlArguments(
  args: Readonly<Record<string, unknown>> | null,
  path: string,
  expected: Readonly<SuperviserControlAuth>,
): Result<
  { readonly auth: SuperviserControlAuth } & StartWorkflowAddonInput,
  string
> {
  const authorizedArgs = parseAuthorizedArgumentsObject(args, path, expected);
  if (!authorizedArgs.ok) {
    return authorizedArgs;
  }
  return parseStartWorkflowAfterAuth(
    authorizedArgs.value.args,
    path,
    authorizedArgs.value.auth,
  );
}

interface ParsedTargetSessionControlArguments {
  readonly args: Readonly<Record<string, unknown>>;
  readonly sessionId: string;
}

function parseTargetSessionControlArguments(
  args: Readonly<Record<string, unknown>> | null,
  path: string,
  expected: Readonly<SuperviserControlAuth>,
): Result<ParsedTargetSessionControlArguments, string> {
  const authorizedArgs = parseAuthorizedArgumentsObject(args, path, expected);
  if (!authorizedArgs.ok) {
    return authorizedArgs;
  }
  const sessionIdResult = readNonEmptyString(
    authorizedArgs.value.args,
    "sessionId",
    path,
  );
  if (!sessionIdResult.ok) {
    return sessionIdResult;
  }
  if (sessionIdResult.value !== authorizedArgs.value.auth.targetSessionId) {
    return err(
      `${path}.sessionId must match targetSessionId for nested superviser control calls`,
    );
  }
  return ok({
    args: authorizedArgs.value.args,
    sessionId: sessionIdResult.value,
  });
}

export function parseGetWorkflowStatusControlArguments(
  args: Readonly<Record<string, unknown>> | null,
  path: string,
  expected: Readonly<SuperviserControlAuth>,
): Result<GetWorkflowStatusAddonInput, string> {
  const parsed = parseTargetSessionControlArguments(args, path, expected);
  if (!parsed.ok) {
    return parsed;
  }
  return ok({ sessionId: parsed.value.sessionId });
}

export function parseGetWorkflowExecutionDetailsControlArguments(
  args: Readonly<Record<string, unknown>> | null,
  path: string,
  expected: Readonly<SuperviserControlAuth>,
): Result<GetWorkflowExecutionDetailsAddonInput, string> {
  const parsed = parseTargetSessionControlArguments(args, path, expected);
  if (!parsed.ok) {
    return parsed;
  }
  return ok({ sessionId: parsed.value.sessionId });
}

/** Nested `divedra/rerun-workflow` accepts auth + session pairing plus optional step rerun only. */
const NESTED_RERUN_WORKFLOW_ALLOWED_KEYS = new Set([
  "supervisionRunId",
  "targetSessionId",
  "sessionId",
  "rerunFromStepId",
]);

export function parseRerunTargetWorkflowControlArguments(
  args: Readonly<Record<string, unknown>> | null,
  path: string,
  expected: Readonly<SuperviserControlAuth>,
): Result<RerunWorkflowAddonInput, string> {
  const parsed = parseTargetSessionControlArguments(args, path, expected);
  if (!parsed.ok) {
    return parsed;
  }
  for (const key of Object.keys(parsed.value.args)) {
    if (!NESTED_RERUN_WORKFLOW_ALLOWED_KEYS.has(key)) {
      return err(
        `${path}.${key} is not a supported argument for nested superviser rerun-workflow`,
      );
    }
  }
  const rerun = parsed.value.args["rerunFromStepId"];
  if (rerun === undefined) {
    return ok({ sessionId: parsed.value.sessionId });
  }
  if (typeof rerun !== "string" || rerun.trim().length === 0) {
    return err(
      `${path}.rerunFromStepId must be a non-empty string when provided`,
    );
  }
  return ok({
    sessionId: parsed.value.sessionId,
    rerunFromStepId: rerun.trim(),
  });
}

function parseLoadOrSavePathArgs(
  args: Readonly<Record<string, unknown>> | null,
  path: string,
  expected: Readonly<SuperviserControlAuth>,
): Result<
  {
    readonly workflowId: string;
    readonly mutableWorkflowDir: string;
  },
  string
> {
  const authorizedArgs = parseAuthorizedArgumentsObject(args, path, expected);
  if (!authorizedArgs.ok) {
    return authorizedArgs;
  }
  const workflowIdResult = readNonEmptyString(
    authorizedArgs.value.args,
    "workflowId",
    path,
  );
  if (!workflowIdResult.ok) {
    return workflowIdResult;
  }
  const mutableWorkflowDirResult = readNonEmptyString(
    authorizedArgs.value.args,
    "mutableWorkflowDir",
    path,
  );
  if (!mutableWorkflowDirResult.ok) {
    return mutableWorkflowDirResult;
  }
  return ok({
    workflowId: workflowIdResult.value,
    mutableWorkflowDir: mutableWorkflowDirResult.value,
  });
}

function parseSavePathArgsWithBundle(
  args: Readonly<Record<string, unknown>> | null,
  path: string,
  expected: Readonly<SuperviserControlAuth>,
): Result<SaveWorkflowDefinitionAddonInput, string> {
  const base = parseLoadOrSavePathArgs(args, path, expected);
  if (!base.ok) {
    return base;
  }
  if (args === null || !isRecord(args)) {
    return err(`${path} must be an object`);
  }
  const bundle = args["bundle"];
  if (bundle === undefined) {
    return err(
      `${path}.bundle must be an object when saving a workflow definition`,
    );
  }
  const parsedBundle = parseWorkflowBundleInput(bundle, `${path}.bundle`);
  if (!parsedBundle.ok) {
    return err(parsedBundle.error);
  }
  return ok({
    workflowId: base.value.workflowId,
    mutableWorkflowDir: base.value.mutableWorkflowDir,
    bundle: parsedBundle.value,
  });
}

export function parseLoadWorkflowDefinitionControlArguments(
  args: Readonly<Record<string, unknown>> | null,
  path: string,
  expected: Readonly<SuperviserControlAuth>,
): Result<LoadWorkflowDefinitionAddonInput, string> {
  return parseLoadOrSavePathArgs(args, path, expected);
}

export function parseSaveWorkflowDefinitionControlArguments(
  args: Readonly<Record<string, unknown>> | null,
  path: string,
  expected: Readonly<SuperviserControlAuth>,
): Result<SaveWorkflowDefinitionAddonInput, string> {
  return parseSavePathArgsWithBundle(args, path, expected);
}

function argumentsRecord(
  value: Readonly<Record<string, unknown> | null> | null,
): Readonly<Record<string, unknown>> | null {
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    return null;
  }
  return value;
}

export function executeSuperviserControlNativeOperation(input: {
  readonly addonName: SuperviserControlAddonName;
  readonly arguments: Readonly<Record<string, unknown> | null> | null;
  readonly control: SuperviserRuntimeControl;
  readonly nodeId: string;
}): Promise<Result<Readonly<Record<string, unknown>>, string>> {
  const path = `node '${input.nodeId}'.arguments`;
  const args = argumentsRecord(input.arguments);
  if (args === null) {
    return Promise.resolve(
      err(
        `native superviser add-on '${input.addonName}' requires structured arguments (${path})`,
      ),
    );
  }
  const expected = input.control.auth;
  const wrapErr = (
    r: Result<Readonly<Record<string, unknown>>, string>,
  ): Result<Readonly<Record<string, unknown>>, string> => r;
  const wrapOk = <T extends object>(
    r: Result<T, string>,
  ): Result<Readonly<Record<string, unknown>>, string> =>
    r.ok ? ok(r.value as Readonly<Record<string, unknown>>) : r;

  switch (input.addonName) {
    case "divedra/start-workflow": {
      const parsed = parseStartTargetWorkflowControlArguments(
        args,
        path,
        expected,
      );
      if (!parsed.ok) {
        return Promise.resolve(wrapErr(parsed));
      }
      const { auth: _a, ...start } = parsed.value;
      return input.control.startTargetWorkflow(start).then((r) => wrapOk(r));
    }
    case "divedra/get-workflow-status": {
      const parsed = parseGetWorkflowStatusControlArguments(
        args,
        path,
        expected,
      );
      if (!parsed.ok) {
        return Promise.resolve(wrapErr(parsed));
      }
      return input.control
        .getWorkflowStatus(parsed.value)
        .then((r) => wrapOk(r));
    }
    case "divedra/get-workflow-execution-details": {
      const parsed = parseGetWorkflowExecutionDetailsControlArguments(
        args,
        path,
        expected,
      );
      if (!parsed.ok) {
        return Promise.resolve(wrapErr(parsed));
      }
      return input.control
        .getWorkflowExecutionDetails(parsed.value)
        .then((r) => wrapOk(r));
    }
    case "divedra/rerun-workflow": {
      const parsed = parseRerunTargetWorkflowControlArguments(
        args,
        path,
        expected,
      );
      if (!parsed.ok) {
        return Promise.resolve(wrapErr(parsed));
      }
      return input.control
        .rerunTargetWorkflow(parsed.value)
        .then((r) => wrapOk(r));
    }
    case "divedra/load-workflow-definition": {
      const parsed = parseLoadWorkflowDefinitionControlArguments(
        args,
        path,
        expected,
      );
      if (!parsed.ok) {
        return Promise.resolve(wrapErr(parsed));
      }
      return input.control
        .loadWorkflowDefinition(parsed.value)
        .then((r) => wrapOk(r));
    }
    case "divedra/save-workflow-definition": {
      const parsed = parseSaveWorkflowDefinitionControlArguments(
        args,
        path,
        expected,
      );
      if (!parsed.ok) {
        return Promise.resolve(wrapErr(parsed));
      }
      return input.control
        .saveWorkflowDefinition(parsed.value)
        .then((r) => wrapOk(r));
    }
    default: {
      const neverName: never = input.addonName;
      return Promise.resolve(
        err(`unhandled native superviser add-on '${String(neverName)}'`),
      );
    }
  }
}
