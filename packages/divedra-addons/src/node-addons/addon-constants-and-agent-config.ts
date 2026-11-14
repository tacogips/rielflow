import type {
  AgentWorkerAddonConfig,
  AsyncNodeAddonPayloadResolver,
  ChatReplyWorkerConfig,
  NodeAddonDefinition,
  NodeAddonValidateResult,
  NodeAddonPayloadResolver,
  NodeAddonResolveResult,
  NodeOutputContract,
  NodePayload,
  ValidationIssue,
  WorkflowNodeAddonRef,
  XGatewayAddonConfig,
  XGatewayReadAddonConfig,
} from "../../../divedra-core/src/index";
import { NodeValidationResult } from "../../../divedra-core/src/index";

export const CHAT_REPLY_WORKER_ADDON_NAME = "divedra/chat-reply-worker";
export const CHAT_REPLY_WORKER_ADDON_VERSION = "1";
export const CODEX_WORKER_ADDON_NAME = "divedra/codex-worker";
export const CLAUDE_CODE_WORKER_ADDON_NAME = "divedra/claude-code-worker";
export const AGENT_WORKER_ADDON_VERSION = "1";
export const X_GATEWAY_ADDON_NAME = "divedra/x-gateway";
export const X_GATEWAY_ADDON_VERSION = "1";
export const X_GATEWAY_READ_ADDON_NAME = "divedra/x-gateway-read";
export const X_GATEWAY_READ_ADDON_VERSION = "1";
export const DEFAULT_X_GATEWAY_IMAGE = "ghcr.io/tacogips/x-gateway:latest";
export const MAIL_GATEWAY_ADDON_NAME = "divedra/mail-gateway";
export const MAIL_GATEWAY_ADDON_VERSION = "1";
export const MAIL_GATEWAY_READ_ADDON_NAME = "divedra/mail-gateway-read";
export const MAIL_GATEWAY_READ_ADDON_VERSION = "1";
export const DEFAULT_MAIL_GATEWAY_IMAGE =
  "ghcr.io/tacogips/mail-gateway:latest";
export const GIT_COMMIT_ADDON_NAME = "divedra/git-commit";
export const GIT_COMMIT_ADDON_VERSION = "1";
export const GIT_PUSH_ADDON_NAME = "divedra/git-push";
export const GIT_PUSH_ADDON_VERSION = "1";
export const SUPERVISER_CONTROL_ADDON_VERSION = "1";
export const CHAT_REPLY_WORKER_OUTPUT: NodeOutputContract = {
  description:
    "Provider-neutral chat reply request produced by the built-in chat reply worker.",
  jsonSchema: {
    type: "object",
    required: ["reply"],
    additionalProperties: true,
    properties: {
      reply: {
        type: "object",
        required: ["status", "target", "message", "idempotencyKey"],
        additionalProperties: true,
        properties: {
          status: {
            enum: ["sent", "queued", "intent-only", "dry-run"],
          },
          target: {
            type: "object",
            additionalProperties: true,
          },
          message: {
            type: "object",
            required: ["text"],
            additionalProperties: false,
            properties: {
              text: { type: "string", minLength: 1 },
            },
          },
          idempotencyKey: { type: "string", minLength: 1 },
          providerMessageId: { type: "string", minLength: 1 },
          dispatchId: { type: "string", minLength: 1 },
        },
      },
    },
  },
};
export const X_GATEWAY_READ_OUTPUT: NodeOutputContract = {
  description:
    "Read-only x-gateway query result produced by the built-in x-gateway read add-on.",
  jsonSchema: {
    type: "object",
    required: ["xGateway"],
    additionalProperties: true,
    properties: {
      xGateway: {
        type: "object",
        required: ["ok"],
        additionalProperties: true,
        properties: {
          ok: { type: "boolean" },
          data: {},
        },
      },
    },
  },
};
export const X_GATEWAY_OUTPUT: NodeOutputContract = {
  description:
    "x-gateway query or mutation result produced by the built-in x-gateway add-on.",
  jsonSchema: {
    type: "object",
    required: ["xGateway"],
    additionalProperties: true,
    properties: {
      xGateway: {
        type: "object",
        required: ["ok"],
        additionalProperties: true,
        properties: {
          ok: { type: "boolean" },
          data: {},
        },
      },
    },
  },
};
export const MAIL_GATEWAY_READ_OUTPUT: NodeOutputContract = {
  description:
    "Read-only mail-gateway query result produced by the built-in mail-gateway read add-on.",
  jsonSchema: {
    type: "object",
    required: ["mailGateway"],
    additionalProperties: true,
    properties: {
      mailGateway: {
        type: "object",
        additionalProperties: true,
      },
    },
  },
};
export const MAIL_GATEWAY_OUTPUT: NodeOutputContract = {
  description:
    "mail-gateway query or mutation result produced by the built-in mail-gateway add-on.",
  jsonSchema: {
    type: "object",
    required: ["mailGateway"],
    additionalProperties: true,
    properties: {
      mailGateway: {
        type: "object",
        additionalProperties: true,
      },
    },
  },
};
export const GIT_COMMIT_OUTPUT: NodeOutputContract = {
  description: "Git commit result produced by the built-in git commit add-on.",
  jsonSchema: {
    type: "object",
    required: ["git"],
    additionalProperties: true,
    properties: {
      git: {
        type: "object",
        required: ["status", "commitHash", "committedFiles"],
        additionalProperties: true,
        properties: {
          status: { enum: ["committed"] },
          commitHash: { type: "string", minLength: 1 },
          committedFiles: {
            type: "array",
            items: { type: "string", minLength: 1 },
          },
        },
      },
    },
  },
};
export const GIT_PUSH_OUTPUT: NodeOutputContract = {
  description: "Git push result produced by the built-in git push add-on.",
  jsonSchema: {
    type: "object",
    required: ["git"],
    additionalProperties: true,
    properties: {
      git: {
        type: "object",
        required: ["status", "commitHash", "pushedRemote", "pushedBranch"],
        additionalProperties: true,
        properties: {
          status: { enum: ["pushed"] },
          commitHash: { type: "string", minLength: 1 },
          pushedRemote: { type: "string", minLength: 1 },
          pushedBranch: { type: "string", minLength: 1 },
        },
      },
    },
  },
};
export const SUPERVISER_CONTROL_ADDON_OUTPUT: NodeOutputContract = {
  description:
    "Nested superviser control-plane result (start/status/rerun/load/save) scoped to a supervision run (phase-2 auto-improve).",
  jsonSchema: {
    type: "object",
    required: ["superviser"],
    additionalProperties: true,
    properties: {
      superviser: {
        type: "object",
        additionalProperties: true,
      },
    },
  },
};
export function makeIssue(path: string, message: string): ValidationIssue {
  return { severity: "error", path, message };
}
export function errorMessageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
export function isRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function isValidationIssue(value: unknown): value is ValidationIssue {
  if (!isRecord(value)) {
    return false;
  }
  const severity = value["severity"];
  return (
    (severity === "error" || severity === "warning") &&
    typeof value["path"] === "string" &&
    typeof value["message"] === "string"
  );
}
export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}
export function normalizeThirdPartyResolverResult(input: {
  readonly addonName: string;
  readonly path: string;
  readonly value: unknown;
}): NodeAddonResolveResult {
  if (input.value === undefined) {
    return { issues: [] };
  }
  if (!isRecord(input.value)) {
    return {
      issues: [
        makeIssue(
          `${input.path}.resolverResult`,
          `third-party node add-on resolver for '${input.addonName}' must return an object result`,
        ),
      ],
    };
  }

  const issuesRaw = input.value["issues"] ?? [];
  if (!Array.isArray(issuesRaw)) {
    return {
      issues: [
        makeIssue(
          `${input.path}.resolverResult.issues`,
          `third-party node add-on resolver for '${input.addonName}' must return issues as an array`,
        ),
      ],
    };
  }

  const issues: ValidationIssue[] = [];
  for (const [index, issue] of issuesRaw.entries()) {
    if (isValidationIssue(issue)) {
      issues.push(issue);
      continue;
    }
    return {
      issues: [
        makeIssue(
          `${input.path}.resolverResult.issues[${index}]`,
          "must contain validation issues with severity, path, and message",
        ),
      ],
    };
  }

  const payload = input.value["payload"];
  const nodeValidationResultsRaw = input.value["nodeValidationResults"] ?? [];
  if (!Array.isArray(nodeValidationResultsRaw)) {
    return {
      issues: [
        makeIssue(
          `${input.path}.resolverResult.nodeValidationResults`,
          `third-party node add-on resolver for '${input.addonName}' must return nodeValidationResults as an array`,
        ),
      ],
    };
  }
  const nodeValidationResults: NodeValidationResult[] = [];
  for (const [index, result] of nodeValidationResultsRaw.entries()) {
    if (isNodeValidationResultLike(result)) {
      nodeValidationResults.push(new NodeValidationResult(result));
      continue;
    }
    return {
      issues: [
        makeIssue(
          `${input.path}.resolverResult.nodeValidationResults[${index}]`,
          "must contain node validation results with status and message",
        ),
      ],
    };
  }
  return {
    issues,
    ...(payload === undefined ? {} : { payload: payload as NodePayload }),
    ...(nodeValidationResults.length === 0 ? {} : { nodeValidationResults }),
  };
}

function isNodeValidationResultLike(
  value: unknown,
): value is ConstructorParameters<typeof NodeValidationResult>[0] {
  if (!isRecord(value)) {
    return false;
  }
  const status = value["status"];
  return (
    (status === "valid" ||
      status === "warning" ||
      status === "invalid" ||
      status === "unknown") &&
    typeof value["message"] === "string" &&
    value["message"].length > 0
  );
}

function normalizeAddonValidateResult(
  value: NodeAddonValidateResult,
): readonly NodeValidationResult[] {
  const entries = Array.isArray(value) ? value : [value];
  return entries.map((entry) => new NodeValidationResult(entry));
}

function attachSyncValidateResult(input: {
  readonly definition: NodeAddonDefinition;
  readonly resolverInput: Parameters<NodeAddonPayloadResolver>[0];
  readonly resolved: NodeAddonResolveResult;
}): NodeAddonResolveResult {
  if (input.definition.validate === undefined) {
    return input.resolved;
  }
  const validation = input.definition.validate({
    nodeId: input.resolverInput.nodeId,
    addon: input.resolverInput.addon,
    ...(input.resolved.payload === undefined
      ? {}
      : { resolvedPayload: input.resolved.payload }),
    path: input.resolverInput.path,
    executablePreflight: input.resolverInput.executablePreflight === true,
  });
  if (isPromiseLike(validation)) {
    void Promise.resolve(validation).catch(() => undefined);
    return {
      ...input.resolved,
      issues: [
        ...(input.resolved.issues ?? []),
        makeIssue(
          input.resolverInput.path,
          `third-party node add-on '${input.resolverInput.addon.name}' uses an async validate hook; use loadWorkflowFromDisk or validateWorkflowBundleAsync for async add-ons`,
        ),
      ],
    };
  }
  return {
    ...input.resolved,
    nodeValidationResults: [
      ...(input.resolved.nodeValidationResults ?? []),
      ...normalizeAddonValidateResult(validation),
    ],
  };
}

async function attachAsyncValidateResult(input: {
  readonly definition: NodeAddonDefinition;
  readonly resolverInput: Parameters<NodeAddonPayloadResolver>[0];
  readonly resolved: NodeAddonResolveResult;
}): Promise<NodeAddonResolveResult> {
  if (input.definition.validate === undefined) {
    return input.resolved;
  }
  const validation = await input.definition.validate({
    nodeId: input.resolverInput.nodeId,
    addon: input.resolverInput.addon,
    ...(input.resolved.payload === undefined
      ? {}
      : { resolvedPayload: input.resolved.payload }),
    path: input.resolverInput.path,
    executablePreflight: input.resolverInput.executablePreflight === true,
  });
  return {
    ...input.resolved,
    nodeValidationResults: [
      ...(input.resolved.nodeValidationResults ?? []),
      ...normalizeAddonValidateResult(validation),
    ],
  };
}
export function definitionVersionMatches(
  definition: NodeAddonDefinition,
  addon: WorkflowNodeAddonRef,
): boolean {
  return (
    definition.version === undefined ||
    addon.version === undefined ||
    definition.version === addon.version
  );
}
export function describeAddonDefinitionVersions(
  definitions: readonly NodeAddonDefinition[],
): string {
  return definitions
    .map((definition) => definition.version ?? "<unspecified>")
    .sort((left, right) => left.localeCompare(right))
    .join(", ");
}
export type NodeAddonDefinitionSelection =
  | { readonly kind: "missing" }
  | { readonly kind: "issues"; readonly issues: readonly ValidationIssue[] }
  | { readonly kind: "definition"; readonly definition: NodeAddonDefinition };
export function selectNodeAddonDefinition(input: {
  readonly definitions: readonly NodeAddonDefinition[];
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
}): NodeAddonDefinitionSelection {
  const matchingNameDefinitions = input.definitions.filter(
    (definition) => definition.name === input.addon.name,
  );
  if (matchingNameDefinitions.length === 0) {
    return { kind: "missing" };
  }

  const matchingDefinitions = matchingNameDefinitions.filter((definition) =>
    definitionVersionMatches(definition, input.addon),
  );
  if (matchingDefinitions.length === 0) {
    return {
      kind: "issues",
      issues: [
        makeIssue(
          `${input.path}.version`,
          `unsupported version '${input.addon.version ?? "<unspecified>"}' for third-party node add-on '${input.addon.name}'; registered versions: ${describeAddonDefinitionVersions(matchingNameDefinitions)}`,
        ),
      ],
    };
  }

  if (input.addon.version === undefined && matchingDefinitions.length > 1) {
    return {
      kind: "issues",
      issues: [
        makeIssue(
          `${input.path}.version`,
          `must be specified because multiple versions are registered for third-party node add-on '${input.addon.name}': ${describeAddonDefinitionVersions(matchingDefinitions)}`,
        ),
      ],
    };
  }

  const [definition] = matchingDefinitions;
  return definition === undefined
    ? { kind: "missing" }
    : { kind: "definition", definition };
}
export function createNodeAddonRegistry(
  definitions: readonly NodeAddonDefinition[],
): NodeAddonPayloadResolver {
  const registeredDefinitions = [...definitions];
  return (input) => {
    const selection = selectNodeAddonDefinition({
      definitions: registeredDefinitions,
      addon: input.addon,
      path: input.path,
    });
    if (selection.kind === "missing") {
      return undefined;
    }
    if (selection.kind === "issues") {
      return { issues: selection.issues };
    }
    const resolved = selection.definition.resolve(input);
    if (isPromiseLike(resolved)) {
      void Promise.resolve(resolved).catch(() => undefined);
      return {
        issues: [
          makeIssue(
            input.path,
            `third-party node add-on '${input.addon.name}' uses an async definition resolver; use loadWorkflowFromDisk or validateWorkflowBundleAsync for async add-ons`,
          ),
        ],
      };
    }
    return attachSyncValidateResult({
      definition: selection.definition,
      resolverInput: input,
      resolved,
    });
  };
}
export function createNodeAddonPayloadResolver(
  definition: NodeAddonDefinition,
): NodeAddonPayloadResolver {
  return createNodeAddonRegistry([definition]);
}
export function createAsyncNodeAddonRegistry(
  definitions: readonly NodeAddonDefinition[],
): AsyncNodeAddonPayloadResolver {
  const registeredDefinitions = [...definitions];
  return async (input) => {
    const selection = selectNodeAddonDefinition({
      definitions: registeredDefinitions,
      addon: input.addon,
      path: input.path,
    });
    if (selection.kind === "missing") {
      return undefined;
    }
    if (selection.kind === "issues") {
      return { issues: selection.issues };
    }
    const resolved = await selection.definition.resolve(input);
    return await attachAsyncValidateResult({
      definition: selection.definition,
      resolverInput: input,
      resolved,
    });
  };
}
export function createAsyncNodeAddonPayloadResolver(
  definition: NodeAddonDefinition,
): AsyncNodeAddonPayloadResolver {
  return createAsyncNodeAddonRegistry([definition]);
}
export function normalizeChatReplyWorkerConfig(
  value: Readonly<Record<string, unknown>> | undefined,
  path: string,
): {
  readonly config?: ChatReplyWorkerConfig;
  readonly issues: readonly ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const config: Readonly<Record<string, unknown>> = value ?? {};
  const allowedKeys = new Set([
    "textTemplate",
    "visibility",
    "threadPolicy",
    "onMissingTarget",
  ]);

  for (const key of Object.keys(config)) {
    if (!allowedKeys.has(key)) {
      issues.push(makeIssue(`${path}.${key}`, "is not supported"));
    }
  }

  const textTemplate = config["textTemplate"];
  if (typeof textTemplate !== "string" || textTemplate.trim().length === 0) {
    issues.push(
      makeIssue(`${path}.textTemplate`, "must be a non-empty string"),
    );
  }

  const visibility = config["visibility"];
  if (
    visibility !== undefined &&
    visibility !== "public" &&
    visibility !== "ephemeral"
  ) {
    issues.push(
      makeIssue(`${path}.visibility`, "must be 'public' or 'ephemeral'"),
    );
  }

  const threadPolicy = config["threadPolicy"];
  if (
    threadPolicy !== undefined &&
    threadPolicy !== "same-thread" &&
    threadPolicy !== "conversation-root"
  ) {
    issues.push(
      makeIssue(
        `${path}.threadPolicy`,
        "must be 'same-thread' or 'conversation-root'",
      ),
    );
  }

  const onMissingTarget = config["onMissingTarget"];
  if (
    onMissingTarget !== undefined &&
    onMissingTarget !== "fail" &&
    onMissingTarget !== "intent-only" &&
    onMissingTarget !== "dry-run"
  ) {
    issues.push(
      makeIssue(
        `${path}.onMissingTarget`,
        "must be 'fail', 'intent-only', or 'dry-run'",
      ),
    );
  }

  if (issues.length > 0 || typeof textTemplate !== "string") {
    return { issues };
  }
  const normalizedVisibility =
    visibility === "public" || visibility === "ephemeral"
      ? visibility
      : undefined;
  const normalizedThreadPolicy =
    threadPolicy === "same-thread" || threadPolicy === "conversation-root"
      ? threadPolicy
      : undefined;
  const normalizedOnMissingTarget =
    onMissingTarget === "fail" ||
    onMissingTarget === "intent-only" ||
    onMissingTarget === "dry-run"
      ? onMissingTarget
      : undefined;

  return {
    config: {
      textTemplate,
      ...(normalizedVisibility === undefined
        ? {}
        : { visibility: normalizedVisibility }),
      ...(normalizedThreadPolicy === undefined
        ? {}
        : { threadPolicy: normalizedThreadPolicy }),
      ...(normalizedOnMissingTarget === undefined
        ? {}
        : { onMissingTarget: normalizedOnMissingTarget }),
    },
    issues,
  };
}
export function normalizeSessionPolicy(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): AgentWorkerAddonConfig["sessionPolicy"] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue(path, "must be an object when provided"));
    return undefined;
  }
  const mode = value["mode"];
  if (mode !== "new" && mode !== "reuse") {
    issues.push(makeIssue(`${path}.mode`, "must be 'new' or 'reuse'"));
    return undefined;
  }
  return { mode };
}
export function readOptionalStringConfig(
  config: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  issues: ValidationIssue[],
): string | undefined {
  const value = config[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  issues.push(makeIssue(`${path}.${key}`, "must be a non-empty string"));
  return undefined;
}
export function readRequiredStringConfig(
  config: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  issues: ValidationIssue[],
): string | undefined {
  const value = readOptionalStringConfig(config, key, path, issues);
  if (value === undefined && config[key] === undefined) {
    issues.push(makeIssue(`${path}.${key}`, "must be a non-empty string"));
  }
  return value;
}
export type GatewayTemplateKey = "queryTemplate" | "documentTemplate";
export interface GatewayContainerConfigFields {
  readonly image?: string;
  readonly runnerKind?: "podman" | "docker" | "nerdctl";
  readonly runnerPath?: string;
  readonly networkPolicy?: "disabled" | "egress-allowed";
}
export interface QueryGatewayConfig extends GatewayContainerConfigFields {
  readonly queryTemplate: string;
}
export interface DocumentGatewayConfig extends GatewayContainerConfigFields {
  readonly documentTemplate: string;
}
export function buildGatewayContainerConfig(
  input: GatewayContainerConfigFields,
): GatewayContainerConfigFields {
  return {
    ...(input.image === undefined ? {} : { image: input.image }),
    ...(input.runnerKind === undefined ? {} : { runnerKind: input.runnerKind }),
    ...(input.runnerPath === undefined ? {} : { runnerPath: input.runnerPath }),
    ...(input.networkPolicy === undefined
      ? {}
      : { networkPolicy: input.networkPolicy }),
  };
}
export function normalizeGatewayTemplateConfig(
  value: Readonly<Record<string, unknown>> | undefined,
  path: string,
  templateKey: "queryTemplate",
): {
  readonly config?: QueryGatewayConfig;
  readonly issues: readonly ValidationIssue[];
};
export function normalizeGatewayTemplateConfig(
  value: Readonly<Record<string, unknown>> | undefined,
  path: string,
  templateKey: "documentTemplate",
): {
  readonly config?: DocumentGatewayConfig;
  readonly issues: readonly ValidationIssue[];
};
export function normalizeGatewayTemplateConfig(
  value: Readonly<Record<string, unknown>> | undefined,
  path: string,
  templateKey: GatewayTemplateKey,
): {
  readonly config?: QueryGatewayConfig | DocumentGatewayConfig;
  readonly issues: readonly ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const config: Readonly<Record<string, unknown>> = value ?? {};
  const allowedKeys = new Set([
    templateKey,
    "image",
    "runnerKind",
    "runnerPath",
    "networkPolicy",
  ]);

  for (const key of Object.keys(config)) {
    if (!allowedKeys.has(key)) {
      issues.push(makeIssue(`${path}.${key}`, "is not supported"));
    }
  }

  const template = readRequiredStringConfig(config, templateKey, path, issues);
  const image = readOptionalStringConfig(config, "image", path, issues);
  const runnerPath = readOptionalStringConfig(
    config,
    "runnerPath",
    path,
    issues,
  );

  const runnerKindRaw = config["runnerKind"];
  let runnerKind: XGatewayReadAddonConfig["runnerKind"];
  if (runnerKindRaw !== undefined) {
    if (
      runnerKindRaw === "podman" ||
      runnerKindRaw === "docker" ||
      runnerKindRaw === "nerdctl"
    ) {
      runnerKind = runnerKindRaw;
    } else {
      issues.push(
        makeIssue(
          `${path}.runnerKind`,
          "must be 'podman', 'docker', or 'nerdctl'",
        ),
      );
    }
  }

  const networkPolicyRaw = config["networkPolicy"];
  let networkPolicy: XGatewayReadAddonConfig["networkPolicy"];
  if (networkPolicyRaw !== undefined) {
    if (
      networkPolicyRaw === "disabled" ||
      networkPolicyRaw === "egress-allowed"
    ) {
      networkPolicy = networkPolicyRaw;
    } else {
      issues.push(
        makeIssue(
          `${path}.networkPolicy`,
          "must be 'disabled' or 'egress-allowed'",
        ),
      );
    }
  }

  if (issues.length > 0 || template === undefined) {
    return { issues };
  }

  const containerConfig = buildGatewayContainerConfig({
    ...(image === undefined ? {} : { image }),
    ...(runnerKind === undefined ? {} : { runnerKind }),
    ...(runnerPath === undefined ? {} : { runnerPath }),
    ...(networkPolicy === undefined ? {} : { networkPolicy }),
  });

  if (templateKey === "queryTemplate") {
    return {
      config: {
        queryTemplate: template,
        ...containerConfig,
      },
      issues,
    };
  }

  return {
    config: {
      documentTemplate: template,
      ...containerConfig,
    },
    issues,
  };
}
export function normalizeXGatewayReadConfig(
  value: Readonly<Record<string, unknown>> | undefined,
  path: string,
): {
  readonly config?: XGatewayReadAddonConfig;
  readonly issues: readonly ValidationIssue[];
} {
  return normalizeGatewayTemplateConfig(value, path, "queryTemplate");
}
export function normalizeXGatewayConfig(
  value: Readonly<Record<string, unknown>> | undefined,
  path: string,
): {
  readonly config?: XGatewayAddonConfig;
  readonly issues: readonly ValidationIssue[];
} {
  return normalizeGatewayTemplateConfig(value, path, "documentTemplate");
}
