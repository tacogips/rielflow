import type { WorkflowExecutionCompactSummary } from "../shared/ui-contract";
import { createLifecycleSupervisionPolicyInput } from "../workflow/auto-improve-policy";
import type { CallStepInput } from "../workflow/call-step";
import {
  listWorkflowCatalogSources,
  withResolvedWorkflowSourceOptions,
} from "../workflow/catalog";
import type { WorkflowRunOptions } from "../workflow/engine";
import type { LoadedWorkflow } from "../workflow/load";
import type {
  WorkflowOverviewRow,
  WorkflowStatusOverview,
} from "../workflow/overview";
import type {
  LoadOptions,
  ResolvedWorkflowSource,
  WorkflowSourceScope,
} from "../workflow/types";
import type {
  WorkflowUsageCatalog,
  WorkflowUsageSummary,
} from "../workflow/usage";
import { normalizeWorkflowWorkingDirectoryOverride } from "../workflow/working-directory";
import type {
  CliIo,
  CliStorageOptions,
  ParsedOptions,
  WorkflowSourceOutput,
  WorkflowVariablesExample,
} from "./storage-and-options";
import {
  requireArrayField,
  requireNumberField,
  requireObjectField,
  requireStringField,
} from "./input-output-helpers";

export function buildLocalWorkflowRunOverrides(
  parsedOptions: ParsedOptions,
  defaultAutoImprove = false,
): Pick<
  WorkflowRunOptions,
  | "autoImprove"
  | "nestedSuperviserDriver"
  | "defaultTimeoutMs"
  | "debug"
  | "dryRun"
  | "maxConcurrency"
  | "maxLoopIterations"
  | "maxSteps"
  | "workflowWorkingDirectory"
> {
  const workflowWorkingDirectory = normalizeWorkflowWorkingDirectoryOverride(
    parsedOptions.workingDirectory,
  );
  const autoImprove =
    parsedOptions.autoImprove ??
    (!defaultAutoImprove
      ? undefined
      : parsedOptions.disableAutoImprove
        ? createLifecycleSupervisionPolicyInput()
        : { enabled: true });
  return {
    ...(workflowWorkingDirectory === undefined
      ? {}
      : { workflowWorkingDirectory }),
    ...(parsedOptions.maxSteps === undefined
      ? {}
      : { maxSteps: parsedOptions.maxSteps }),
    ...(parsedOptions.maxConcurrency === undefined
      ? {}
      : { maxConcurrency: parsedOptions.maxConcurrency }),
    ...(parsedOptions.maxLoopIterations === undefined
      ? {}
      : { maxLoopIterations: parsedOptions.maxLoopIterations }),
    ...(parsedOptions.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: parsedOptions.defaultTimeoutMs }),
    ...(parsedOptions.debug ? { debug: true } : {}),
    ...(parsedOptions.dryRun ? { dryRun: true } : {}),
    ...(autoImprove === undefined ? {} : { autoImprove }),
    ...(parsedOptions.nestedSuperviser ? { nestedSuperviserDriver: true } : {}),
  };
}
export function buildLocalCallStepOverrides(parsedOptions: ParsedOptions): {
  readonly defaultTimeoutMs?: number;
  readonly dryRun?: boolean;
  readonly workflowWorkingDirectory?: string;
  readonly overrides?: NonNullable<CallStepInput["overrides"]>;
} {
  const workflowWorkingDirectory = normalizeWorkflowWorkingDirectoryOverride(
    parsedOptions.workingDirectory,
  );
  const overrides =
    parsedOptions.timeoutMs === undefined &&
    parsedOptions.promptVariant === undefined &&
    !parsedOptions.continueSession &&
    parsedOptions.resumeStepExecId === undefined
      ? undefined
      : {
          ...(parsedOptions.timeoutMs === undefined
            ? {}
            : { timeoutMs: parsedOptions.timeoutMs }),
          ...(parsedOptions.promptVariant === undefined
            ? {}
            : { promptVariant: parsedOptions.promptVariant }),
          ...(parsedOptions.continueSession
            ? { sessionMode: "reuse" as const }
            : {}),
          ...(parsedOptions.resumeStepExecId === undefined
            ? {}
            : { resumeStepExecId: parsedOptions.resumeStepExecId }),
        };
  return {
    ...(workflowWorkingDirectory === undefined
      ? {}
      : { workflowWorkingDirectory }),
    ...(parsedOptions.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: parsedOptions.defaultTimeoutMs }),
    ...(parsedOptions.dryRun ? { dryRun: true } : {}),
    ...(overrides === undefined ? {} : { overrides }),
  };
}
export function optionsForLoadedWorkflow<T extends CliStorageOptions>(
  loadedWorkflow: LoadedWorkflow,
  options: T,
): T {
  return loadedWorkflow.source === undefined
    ? options
    : withResolvedWorkflowSourceOptions(loadedWorkflow.source, options);
}
export function formatWorkflowSource(
  source: ResolvedWorkflowSource | undefined,
): string | undefined {
  if (source === undefined) {
    return undefined;
  }
  return `${source.scope} ${source.workflowDirectory}`;
}
export function workflowSourceJson(
  source: ResolvedWorkflowSource | undefined,
): WorkflowSourceOutput | undefined {
  if (source === undefined) {
    return undefined;
  }
  return {
    scope: source.scope,
    workflowRoot: source.workflowRoot,
    workflowDirectory: source.workflowDirectory,
    ...(source.scopeRoot === undefined ? {} : { scopeRoot: source.scopeRoot }),
  };
}
export function formatAddonSource(source: {
  readonly nodeId: string;
  readonly name: string;
  readonly version: string;
  readonly scope: string;
  readonly manifestPath: string;
}): string {
  return `${source.nodeId}: ${source.name}@${source.version} ${source.scope} ${source.manifestPath}`;
}
export function assertWorkflowOverviewSourceScope(
  value: string,
): WorkflowSourceScope {
  if (value === "direct" || value === "project" || value === "user") {
    return value;
  }
  throw new Error(`invalid workflow overview sourceScope '${value}'`);
}
export function workflowExecutionCompactSummaryFromGraphql(
  value: unknown,
  label: string,
): WorkflowExecutionCompactSummary {
  const o = requireObjectField(value, label);
  const currentStepIdRaw = o["currentStepId"];
  return {
    workflowExecutionId: requireStringField(
      o["workflowExecutionId"],
      `${label}.workflowExecutionId`,
    ),
    sessionId: requireStringField(o["sessionId"], `${label}.sessionId`),
    workflowName: requireStringField(
      o["workflowName"],
      `${label}.workflowName`,
    ),
    status: requireStringField(
      o["status"],
      `${label}.status`,
    ) as WorkflowExecutionCompactSummary["status"],
    currentNodeId:
      o["currentNodeId"] === null || o["currentNodeId"] === undefined
        ? null
        : requireStringField(o["currentNodeId"], `${label}.currentNodeId`),
    ...(currentStepIdRaw === null || currentStepIdRaw === undefined
      ? {}
      : {
          currentStepId: requireStringField(
            currentStepIdRaw,
            `${label}.currentStepId`,
          ),
        }),
    nodeExecutionCounter: requireNumberField(
      o["nodeExecutionCounter"],
      `${label}.nodeExecutionCounter`,
    ),
    startedAt: requireStringField(o["startedAt"], `${label}.startedAt`),
    endedAt:
      o["endedAt"] === null || o["endedAt"] === undefined
        ? null
        : requireStringField(o["endedAt"], `${label}.endedAt`),
  };
}
export function workflowOverviewRowFromGraphqlJson(
  value: unknown,
  label: string,
): WorkflowOverviewRow {
  const row = requireObjectField(value, label);
  const latestRaw = row["latestExecution"];
  return {
    workflowName: requireStringField(
      row["workflowName"],
      `${label}.workflowName`,
    ),
    sourceScope: assertWorkflowOverviewSourceScope(
      requireStringField(row["sourceScope"], `${label}.sourceScope`),
    ),
    workflowDirectory: requireStringField(
      row["workflowDirectory"],
      `${label}.workflowDirectory`,
    ),
    description: requireStringField(row["description"], `${label}.description`),
    aggregateStatus: requireStringField(
      row["aggregateStatus"],
      `${label}.aggregateStatus`,
    ) as WorkflowOverviewRow["aggregateStatus"],
    activeExecutionCount: requireNumberField(
      row["activeExecutionCount"],
      `${label}.activeExecutionCount`,
    ),
    latestExecution:
      latestRaw === null || latestRaw === undefined
        ? null
        : workflowExecutionCompactSummaryFromGraphql(
            latestRaw,
            `${label}.latestExecution`,
          ),
  };
}
export function workflowOverviewWarningSourceFromGraphqlJson(
  value: unknown,
  label: string,
): {
  readonly workflowName: string;
  readonly sourceScope: WorkflowSourceScope;
} {
  const row = requireObjectField(value, label);
  return {
    workflowName: requireStringField(
      row["workflowName"],
      `${label}.workflowName`,
    ),
    sourceScope: assertWorkflowOverviewSourceScope(
      requireStringField(row["sourceScope"], `${label}.sourceScope`),
    ),
  };
}
export function workflowStatusOverviewFromGraphqlJson(
  value: unknown,
  label: string,
): WorkflowStatusOverview {
  const base = workflowOverviewRowFromGraphqlJson(value, label);
  const row = requireObjectField(value, label);
  const recentRaw = requireArrayField(
    row["recentExecutions"],
    `${label}.recentExecutions`,
  );
  const recentExecutions = recentRaw.map((entry, index) =>
    workflowExecutionCompactSummaryFromGraphql(
      entry,
      `${label}.recentExecutions[${String(index)}]`,
    ),
  );
  const newestRaw = row["newestActiveExecution"];
  const newestActiveExecution =
    newestRaw === null || newestRaw === undefined
      ? null
      : workflowExecutionCompactSummaryFromGraphql(
          newestRaw,
          `${label}.newestActiveExecution`,
        );
  return {
    ...base,
    recentExecutions,
    newestActiveExecution,
  };
}
export const WORKFLOW_CATALOG_OVERVIEW_GQL = `
  query WorkflowCatalogOverviewCli($workflowScope: String, $status: String, $limit: Int) {
    workflowCatalogOverview(workflowScope: $workflowScope, status: $status, limit: $limit) {
      workflows {
        workflowName
        sourceScope
        workflowDirectory
        description
        aggregateStatus
        activeExecutionCount
        latestExecution {
          workflowExecutionId
          sessionId
          workflowName
          status
          currentNodeId
          currentStepId
          nodeExecutionCounter
          startedAt
          endedAt
        }
      }
    }
    workflowCatalogWarningSources: workflowCatalogOverview(workflowScope: $workflowScope) {
      workflows {
        workflowName
        sourceScope
      }
    }
  }
`;
export const WORKFLOW_STATUS_OVERVIEW_GQL = `
  query WorkflowStatusOverviewCli($workflowName: String!, $workflowScope: String, $limit: Int) {
    workflowStatusOverview(workflowName: $workflowName, workflowScope: $workflowScope, limit: $limit) {
      workflowName
      sourceScope
      workflowDirectory
      description
      aggregateStatus
      activeExecutionCount
      latestExecution {
        workflowExecutionId
        sessionId
        workflowName
        status
        currentNodeId
        currentStepId
        nodeExecutionCounter
        startedAt
        endedAt
      }
      recentExecutions {
        workflowExecutionId
        sessionId
        workflowName
        status
        currentNodeId
        currentStepId
        nodeExecutionCounter
        startedAt
        endedAt
      }
      newestActiveExecution {
        workflowExecutionId
        sessionId
        workflowName
        status
        currentNodeId
        currentStepId
        nodeExecutionCounter
        startedAt
        endedAt
      }
    }
  }
`;
export function renderWorkflowOverviewTableLines(
  rows: readonly WorkflowOverviewRow[],
): string[] {
  const lines: string[] = [
    [
      "name",
      "scope",
      "workflowDirectory",
      "aggregateStatus",
      "active",
      "latestExecutionId",
      "latestStatus",
      "latestStartedAt",
    ].join("\t"),
  ];
  for (const row of rows) {
    const latest = row.latestExecution;
    lines.push(
      [
        row.workflowName,
        workflowOverviewSourceScopeLabel(row.sourceScope),
        row.workflowDirectory,
        row.aggregateStatus,
        String(row.activeExecutionCount),
        latest?.workflowExecutionId ?? "-",
        latest?.status ?? "-",
        latest?.startedAt ?? "-",
      ].join("\t"),
    );
  }
  return lines;
}
export function workflowOverviewSourceScopeLabel(
  scope: WorkflowSourceScope,
): string {
  switch (scope) {
    case "project":
      return "project scope";
    case "user":
      return "user scope";
    case "direct":
      return "direct root";
  }
}
export function workflowOverviewDuplicateWarningLines(
  sources: readonly {
    readonly workflowName: string;
    readonly sourceScope: WorkflowSourceScope;
  }[],
): string[] {
  const scopedNames = new Map<string, Set<WorkflowSourceScope>>();
  for (const source of sources) {
    if (source.sourceScope === "direct") {
      continue;
    }
    const scopes = scopedNames.get(source.workflowName) ?? new Set();
    scopes.add(source.sourceScope);
    scopedNames.set(source.workflowName, scopes);
  }

  const duplicateNames = [...scopedNames.entries()]
    .filter(([, scopes]) => scopes.has("project") && scopes.has("user"))
    .map(([workflowName]) => workflowName)
    .sort((left, right) => left.localeCompare(right));

  return duplicateNames.map(
    (workflowName) =>
      `warning: workflow '${workflowName}' exists in both project scope and user scope; bare-name commands use project scope unless --scope user is specified`,
  );
}
export function emitWorkflowOverviewWarnings(
  io: CliIo,
  sources: readonly {
    readonly workflowName: string;
    readonly sourceScope: WorkflowSourceScope;
  }[],
): void {
  for (const line of workflowOverviewDuplicateWarningLines(sources)) {
    io.stderr(line);
  }
}
export async function emitLocalWorkflowCatalogWarnings(
  io: CliIo,
  options: LoadOptions,
): Promise<void> {
  const sources = await listWorkflowCatalogSources(options);
  if (!sources.ok) {
    return;
  }
  emitWorkflowOverviewWarnings(
    io,
    sources.value.map((source) => ({
      workflowName: source.workflowName,
      sourceScope: source.scope,
    })),
  );
}
export function renderWorkflowStatusOverviewLines(
  overview: WorkflowStatusOverview,
): string[] {
  const lines: string[] = [
    `workflowName: ${overview.workflowName}`,
    `sourceScope: ${overview.sourceScope}`,
    `workflowDirectory: ${overview.workflowDirectory}`,
    `description: ${overview.description}`,
    `aggregateStatus: ${overview.aggregateStatus}`,
    `activeExecutionCount: ${String(overview.activeExecutionCount)}`,
  ];
  const latest = overview.latestExecution;
  if (latest === null) {
    lines.push("latestExecution: -");
  } else {
    lines.push(
      `latestExecution: ${latest.workflowExecutionId} ${latest.status} startedAt=${latest.startedAt} endedAt=${latest.endedAt ?? "-"}`,
    );
  }
  const active = overview.newestActiveExecution;
  if (active === null) {
    lines.push("newestActiveExecution: -");
  } else {
    const stepLabel =
      active.currentStepId !== undefined && active.currentStepId !== null
        ? active.currentStepId
        : (active.currentNodeId ?? "-");
    lines.push(
      `newestActiveExecution: ${active.workflowExecutionId} ${active.status} currentStepOrNode=${stepLabel}`,
    );
  }
  lines.push("recentExecutions:");
  if (overview.recentExecutions.length === 0) {
    lines.push("  (none)");
  } else {
    for (const e of overview.recentExecutions) {
      const step =
        e.currentStepId !== undefined && e.currentStepId !== null
          ? ` step=${e.currentStepId}`
          : "";
      lines.push(
        `  - ${e.workflowExecutionId} ${e.status} ${e.startedAt}${step}`,
      );
    }
  }
  return lines;
}
export function summarizeWorkflowContractForText(
  contract:
    | { readonly description?: string; readonly jsonSchema?: unknown }
    | undefined,
): string {
  if (contract === undefined) {
    return "-";
  }
  if (contract.description !== undefined) {
    return contract.description;
  }
  if (contract.jsonSchema !== undefined) {
    return JSON.stringify(contract.jsonSchema);
  }
  return "-";
}
export function isRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function sampleJsonValueFromSchema(schema: unknown): unknown {
  if (!isRecord(schema)) {
    return {};
  }
  if (Object.hasOwn(schema, "default")) {
    return schema["default"];
  }
  if (Object.hasOwn(schema, "const")) {
    return schema["const"];
  }
  const typeValue = schema["type"];
  const typeName =
    typeof typeValue === "string"
      ? typeValue
      : Array.isArray(typeValue) && typeof typeValue[0] === "string"
        ? typeValue[0]
        : undefined;
  switch (typeName) {
    case "string":
      return "";
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return false;
    case "array":
      return [];
    case "object":
      return sampleJsonObjectFromSchema(schema) ?? {};
    default:
      return {};
  }
}
export function sampleJsonObjectFromSchema(
  schema: unknown,
): Readonly<Record<string, unknown>> | undefined {
  if (!isRecord(schema)) {
    return undefined;
  }
  const typeValue = schema["type"];
  const isObjectSchema =
    typeValue === "object" ||
    (Array.isArray(typeValue) && typeValue.includes("object")) ||
    isRecord(schema["properties"]);
  if (!isObjectSchema) {
    return undefined;
  }
  const properties = schema["properties"];
  if (!isRecord(properties)) {
    return {};
  }
  const required = Array.isArray(schema["required"])
    ? schema["required"].filter(
        (entry): entry is string => typeof entry === "string",
      )
    : [];
  const keys = required.length > 0 ? required : Object.keys(properties);
  return Object.fromEntries(
    keys.map((key) => [key, sampleJsonValueFromSchema(properties[key])]),
  );
}
export function shellQuoteSingle(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
export function buildWorkflowVariablesExamples(input: {
  readonly workflowName: string;
  readonly jsonSchema?: unknown;
}): readonly WorkflowVariablesExample[] {
  const sample = sampleJsonObjectFromSchema(input.jsonSchema) ?? {
    workflowInput: {},
  };
  const inlineJson = JSON.stringify(sample);
  return [
    {
      mode: "inline-json",
      command: `divedra workflow run ${input.workflowName} --variables ${shellQuoteSingle(inlineJson)}`,
    },
    {
      mode: "explicit-file",
      command: `divedra workflow run ${input.workflowName} --variables @./variables.json`,
    },
    {
      mode: "file-path",
      command: `divedra workflow run ${input.workflowName} --variables ./variables.json`,
    },
  ];
}
export function renderWorkflowUsageSummaryLines(
  summary: WorkflowUsageSummary,
): string[] {
  const lines = [
    `workflowName: ${summary.workflowName}`,
    `workflowId: ${summary.workflowId}`,
  ];
  if (summary.source !== undefined) {
    lines.push(
      `source: ${summary.source.scope} ${summary.source.workflowDirectory}`,
    );
  }
  lines.push(`description: ${summary.description}`);
  lines.push(`callableStepId: ${summary.callable.stepId}`);
  lines.push(`callableRole: ${summary.callable.role}`);
  lines.push(
    `input: ${summarizeWorkflowContractForText(summary.callable.input)}`,
  );
  lines.push(
    `output: ${summarizeWorkflowContractForText(summary.callable.output)}`,
  );
  lines.push("steps:");
  if (summary.steps.length === 0) {
    lines.push("  (none)");
  } else {
    for (const step of summary.steps) {
      const description =
        step.description === undefined || step.description.length === 0
          ? "-"
          : step.description;
      lines.push(
        `  - ${step.stepId} role=${step.role} description=${description}`,
      );
    }
  }
  return lines;
}
export function renderWorkflowUsageCatalogLines(
  catalog: WorkflowUsageCatalog,
): string[] {
  const lines: string[] = [];
  for (const [index, workflow] of catalog.workflows.entries()) {
    if (index > 0) {
      lines.push("");
    }
    lines.push(...renderWorkflowUsageSummaryLines(workflow));
  }
  if (catalog.workflows.length === 0) {
    lines.push("(no workflows)");
  }
  return lines;
}
export function workflowOverviewGraphqlVariables(
  parsed: ParsedOptions,
  statusFilter: string | undefined,
): Readonly<Record<string, unknown>> {
  const variables: Record<string, unknown> = {};
  if (parsed.workflowScope !== undefined) {
    variables["workflowScope"] = parsed.workflowScope;
  }
  if (statusFilter !== undefined) {
    variables["status"] = statusFilter;
  }
  if (parsed.limit !== undefined) {
    variables["limit"] = parsed.limit;
  }
  return variables;
}
