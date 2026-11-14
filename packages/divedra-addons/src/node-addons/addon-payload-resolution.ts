import { resolveLocalNodeAddonPayload } from "../local-node-addons";
import {
  describeSuperviserControlAddon,
  isSuperviserControlAddonName,
  resolveAddonSource,
} from "../../../divedra-core/src/index";
import type {
  AsyncNodeAddonPayloadResolver,
  LoadOptions,
  NodeAddonPayloadResolver,
  NodeAddonResolveInput,
  NodeAddonResolveResult,
  NodePayload,
  ResolvedNodeAddon,
  ResolvedSuperviserControlAddon,
  ResolvedWorkflowSource,
  SuperviserControlAddonName,
  ValidationIssue,
  WorkflowNodeAddonRef,
} from "../../../divedra-core/src/index";
import { NodeValidationResult } from "../../../divedra-core/src/index";
import {
  CHAT_REPLY_WORKER_ADDON_NAME,
  CHAT_REPLY_WORKER_ADDON_VERSION,
  CHAT_REPLY_WORKER_OUTPUT,
  SUPERVISER_CONTROL_ADDON_OUTPUT,
  SUPERVISER_CONTROL_ADDON_VERSION,
  errorMessageFromUnknown,
  isRecord,
  makeIssue,
  normalizeChatReplyWorkerConfig,
  normalizeThirdPartyResolverResult,
} from "./addon-constants-and-agent-config";
import {
  rejectUnsupportedAddonEnv,
  resolveAgentWorkerPayload,
  resolveGitCommitPayload,
  resolveGitPushPayload,
  resolveMailGatewayPayload,
  resolveMailGatewayReadPayload,
  resolveXGatewayPayload,
  resolveXGatewayReadPayload,
} from "./gateway-and-git-config";

export function resolveSuperviserControlPayload(input: {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
}): {
  readonly payload?: NodePayload;
  readonly issues: readonly ValidationIssue[];
} {
  if (!isSuperviserControlAddonName(input.addon.name)) {
    return { issues: [] };
  }
  const name: SuperviserControlAddonName = input.addon.name;
  const version = input.addon.version ?? SUPERVISER_CONTROL_ADDON_VERSION;
  if (version !== SUPERVISER_CONTROL_ADDON_VERSION) {
    return {
      issues: [
        makeIssue(
          `${input.path}.version`,
          `unsupported version '${version}' for ${name}`,
        ),
      ],
    };
  }
  let argumentsTemplate: Readonly<Record<string, unknown>> | undefined;
  let argumentBindings: NodePayload["argumentBindings"];
  const cfg = input.addon.config;
  if (cfg !== undefined) {
    if (!isRecord(cfg)) {
      return {
        issues: [makeIssue(`${input.path}.config`, "must be an object")],
      };
    }
    const allowed = new Set(["argumentsTemplate", "argumentBindings"]);
    for (const key of Object.keys(cfg)) {
      if (!allowed.has(key)) {
        return {
          issues: [
            makeIssue(
              `${input.path}.config.${key}`,
              "only argumentsTemplate and argumentBindings are allowed for divedra superviser control add-ons",
            ),
          ],
        };
      }
    }
    const at = cfg["argumentsTemplate"];
    if (at !== undefined) {
      if (!isRecord(at)) {
        return {
          issues: [
            makeIssue(
              `${input.path}.config.argumentsTemplate`,
              "must be an object",
            ),
          ],
        };
      }
      argumentsTemplate = at;
    }
    const ab = cfg["argumentBindings"];
    if (ab !== undefined) {
      if (!Array.isArray(ab)) {
        return {
          issues: [
            makeIssue(
              `${input.path}.config.argumentBindings`,
              "must be an array",
            ),
          ],
        };
      }
      argumentBindings = ab as NodePayload["argumentBindings"];
    }
  }
  if (input.addon.inputs !== undefined && !isRecord(input.addon.inputs)) {
    return {
      issues: [makeIssue(`${input.path}.inputs`, "must be an object")],
    };
  }
  const unsupportedEnvIssues = rejectUnsupportedAddonEnv(
    input.addon,
    input.path,
  );
  if (unsupportedEnvIssues.length > 0) {
    return { issues: unsupportedEnvIssues };
  }
  const addon: ResolvedSuperviserControlAddon = {
    name,
    version: SUPERVISER_CONTROL_ADDON_VERSION,
  };
  return {
    payload: {
      id: input.nodeId,
      description: describeSuperviserControlAddon(name),
      nodeType: "addon",
      variables: input.addon.inputs ?? {},
      addon,
      output: SUPERVISER_CONTROL_ADDON_OUTPUT,
      ...(argumentsTemplate === undefined ? {} : { argumentsTemplate }),
      ...(argumentBindings === undefined ? {} : { argumentBindings }),
    },
    issues: [],
  };
}
export function resolveBuiltinNodeAddonPayload(
  input: NodeAddonResolveInput,
): NodeAddonResolveResult {
  const version = input.addon.version ?? CHAT_REPLY_WORKER_ADDON_VERSION;
  const superviserControlPayload = resolveSuperviserControlPayload(input);
  if (
    superviserControlPayload.payload !== undefined ||
    superviserControlPayload.issues.length > 0
  ) {
    return superviserControlPayload;
  }
  const agentWorkerPayload = resolveAgentWorkerPayload(input);
  if (
    agentWorkerPayload.payload !== undefined ||
    agentWorkerPayload.issues.length > 0
  ) {
    return agentWorkerPayload;
  }
  const xGatewayReadPayload = resolveXGatewayReadPayload(input);
  if (
    xGatewayReadPayload.payload !== undefined ||
    xGatewayReadPayload.issues.length > 0
  ) {
    return xGatewayReadPayload;
  }
  const xGatewayPayload = resolveXGatewayPayload(input);
  if (
    xGatewayPayload.payload !== undefined ||
    xGatewayPayload.issues.length > 0
  ) {
    return xGatewayPayload;
  }
  const mailGatewayReadPayload = resolveMailGatewayReadPayload(input);
  if (
    mailGatewayReadPayload.payload !== undefined ||
    mailGatewayReadPayload.issues.length > 0
  ) {
    return mailGatewayReadPayload;
  }
  const mailGatewayPayload = resolveMailGatewayPayload(input);
  if (
    mailGatewayPayload.payload !== undefined ||
    mailGatewayPayload.issues.length > 0
  ) {
    return mailGatewayPayload;
  }
  const gitCommitPayload = resolveGitCommitPayload(input);
  if (
    gitCommitPayload.payload !== undefined ||
    gitCommitPayload.issues.length > 0
  ) {
    return gitCommitPayload;
  }
  const gitPushPayload = resolveGitPushPayload(input);
  if (
    gitPushPayload.payload !== undefined ||
    gitPushPayload.issues.length > 0
  ) {
    return gitPushPayload;
  }

  if (input.addon.name !== CHAT_REPLY_WORKER_ADDON_NAME) {
    return {
      issues: [
        makeIssue(
          `${input.path}.name`,
          `unknown built-in node add-on '${input.addon.name}'`,
        ),
      ],
    };
  }
  if (version !== CHAT_REPLY_WORKER_ADDON_VERSION) {
    return {
      issues: [
        makeIssue(
          `${input.path}.version`,
          `unsupported version '${version}' for ${CHAT_REPLY_WORKER_ADDON_NAME}`,
        ),
      ],
    };
  }
  if (input.addon.config !== undefined && !isRecord(input.addon.config)) {
    return {
      issues: [makeIssue(`${input.path}.config`, "must be an object")],
    };
  }
  if (input.addon.inputs !== undefined && !isRecord(input.addon.inputs)) {
    return {
      issues: [makeIssue(`${input.path}.inputs`, "must be an object")],
    };
  }
  const unsupportedEnvIssues = rejectUnsupportedAddonEnv(
    input.addon,
    input.path,
  );
  if (unsupportedEnvIssues.length > 0) {
    return { issues: unsupportedEnvIssues };
  }

  const normalized = normalizeChatReplyWorkerConfig(
    input.addon.config,
    `${input.path}.config`,
  );
  if (normalized.config === undefined) {
    return { issues: normalized.issues };
  }

  const addon: ResolvedNodeAddon = {
    name: CHAT_REPLY_WORKER_ADDON_NAME,
    version: CHAT_REPLY_WORKER_ADDON_VERSION,
    config: normalized.config,
    ...(input.addon.inputs === undefined ? {} : { inputs: input.addon.inputs }),
  };

  return {
    payload: {
      id: input.nodeId,
      description:
        "Built-in worker that prepares a provider-neutral reply to the triggering chat event.",
      nodeType: "addon",
      variables: input.addon.inputs ?? {},
      addon,
      output: CHAT_REPLY_WORKER_OUTPUT,
    },
    issues: [],
  };
}
export function isBuiltinAddonNamespace(name: string): boolean {
  return name.startsWith("divedra/");
}

function withDefaultAddonValidation(input: {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
  readonly resolved: NodeAddonResolveResult;
}): NodeAddonResolveResult {
  if (input.resolved.payload === undefined) {
    return input.resolved;
  }
  return {
    ...input.resolved,
    nodeValidationResults: [
      ...(input.resolved.nodeValidationResults ?? []),
      new NodeValidationResult({
        status: "valid",
        message: `node add-on '${input.addon.name}' resolved to an executable payload`,
        nodeId: input.nodeId,
        source: "addon",
        path: input.path,
        addonName: input.addon.name,
      }),
    ],
  };
}

export function resolveNodeAddonPayload(input: {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
  readonly workflowSource?: ResolvedWorkflowSource;
  readonly options?: LoadOptions;
  readonly thirdPartyResolvers?: readonly NodeAddonPayloadResolver[];
}): NodeAddonResolveResult {
  if (isBuiltinAddonNamespace(input.addon.name)) {
    return withDefaultAddonValidation({
      nodeId: input.nodeId,
      addon: input.addon,
      path: input.path,
      resolved: resolveBuiltinNodeAddonPayload(input),
    });
  }

  for (const resolver of input.thirdPartyResolvers ?? []) {
    let resolvedRaw: unknown;
    try {
      resolvedRaw = resolver(input);
    } catch (error: unknown) {
      return {
        issues: [
          makeIssue(
            input.path,
            `third-party node add-on resolver failed for '${input.addon.name}': ${errorMessageFromUnknown(error)}`,
          ),
        ],
      };
    }

    const resolved = normalizeThirdPartyResolverResult({
      addonName: input.addon.name,
      path: input.path,
      value: resolvedRaw,
    });
    if (resolved.payload !== undefined || (resolved.issues ?? []).length > 0) {
      return resolved;
    }
  }

  if (requiresAsyncLocalAddonResolution(input)) {
    return {
      issues: [
        makeIssue(
          `${input.path}.name`,
          `local node add-on '${input.addon.name}' requires async workflow loading or validation`,
        ),
      ],
    };
  }

  return {
    issues: [
      makeIssue(
        `${input.path}.name`,
        `unknown third-party node add-on '${input.addon.name}'`,
      ),
    ],
  };
}
export function requiresAsyncLocalAddonResolution(input: {
  readonly addon: WorkflowNodeAddonRef;
  readonly workflowSource?: ResolvedWorkflowSource;
  readonly options?: LoadOptions;
}): boolean {
  if (input.addon.version === undefined || input.addon.version.length === 0) {
    return false;
  }
  const env = input.options?.env ?? process.env;
  return (
    input.options?.addonRoot !== undefined ||
    (env["DIVEDRA_ADDON_ROOT"] ?? "").length > 0 ||
    (input.workflowSource !== undefined &&
      input.workflowSource.scope !== "direct")
  );
}
export async function resolveNodeAddonPayloadAsync(input: {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
  readonly workflowSource?: ResolvedWorkflowSource;
  readonly options?: LoadOptions;
  readonly thirdPartyResolvers?: readonly AsyncNodeAddonPayloadResolver[];
}): Promise<NodeAddonResolveResult> {
  if (isBuiltinAddonNamespace(input.addon.name)) {
    return withDefaultAddonValidation({
      nodeId: input.nodeId,
      addon: input.addon,
      path: input.path,
      resolved: resolveBuiltinNodeAddonPayload(input),
    });
  }

  let deferredLocalIssue: ValidationIssue | undefined;
  const localSource = await resolveAddonSource({
    addon: input.addon,
    ...(input.workflowSource === undefined
      ? {}
      : { workflowSource: input.workflowSource }),
    ...(input.options === undefined ? {} : { options: input.options }),
  });
  if (localSource.ok) {
    return withDefaultAddonValidation({
      nodeId: input.nodeId,
      addon: input.addon,
      path: input.path,
      resolved: await resolveLocalNodeAddonPayload({
        nodeId: input.nodeId,
        addon: input.addon,
        path: input.path,
        source: localSource.value,
      }),
    });
  }
  if (localSource.error.code !== "NOT_FOUND") {
    deferredLocalIssue = makeIssue(input.path, localSource.error.message);
    if ((input.thirdPartyResolvers ?? []).length === 0) {
      return { issues: [deferredLocalIssue] };
    }
  }

  for (const resolver of input.thirdPartyResolvers ?? []) {
    let resolvedRaw: unknown;
    try {
      resolvedRaw = await resolver(input);
    } catch (error: unknown) {
      return {
        issues: [
          makeIssue(
            input.path,
            `third-party node add-on resolver failed for '${input.addon.name}': ${errorMessageFromUnknown(error)}`,
          ),
        ],
      };
    }

    const resolved = normalizeThirdPartyResolverResult({
      addonName: input.addon.name,
      path: input.path,
      value: resolvedRaw,
    });
    if (resolved.payload !== undefined || (resolved.issues ?? []).length > 0) {
      return resolved;
    }
  }

  if (deferredLocalIssue !== undefined) {
    return { issues: [deferredLocalIssue] };
  }

  return {
    issues: [
      makeIssue(
        `${input.path}.name`,
        `unknown third-party node add-on '${input.addon.name}'`,
      ),
    ],
  };
}
