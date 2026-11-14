import { stat } from "node:fs/promises";
import path from "node:path";
import {
  AdapterExecutionError,
  type AdapterExecutionOutput,
  type AdapterProcessLog,
} from "../adapter";
import { GIT_COMMIT_ADDON_NAME, GIT_PUSH_ADDON_NAME } from "../node-addons";
import { renderPromptTemplate } from "../render";
import { executeSuperviserControlNativeOperation } from "../superviser-control";
import type {
  ResolvedGitCommitAddon,
  ResolvedGitPushAddon,
  ResolvedSuperviserControlAddon,
} from "../types";
import {
  getSuperviserControlAddonProviderOperationId,
  isSuperviserControlAddonName,
} from "../types";
import { resolveNodeExecutionWorkingDirectory } from "../working-directory";
import type {
  NativeNodeExecutionContext,
  NativeNodeExecutionInput,
  SpawnedProcessResult,
} from "./template-env-and-containers";
import {
  buildNativeOutput,
  buildProcessLogAttachments,
  buildRunnerEnv,
  executeCommandNode,
  executeContainerNode,
  resolveTemplateVariables,
  runLoggedSpawnedProcess,
} from "./template-env-and-containers";
import {
  executeChatReplyAddonNode,
  executeMailGatewayAddonNode,
  executeMailGatewayReadAddonNode,
  executeXGatewayAddonNode,
  executeXGatewayReadAddonNode,
  normalizeCommittedFilePath,
  parseCommittedFiles,
} from "./chat-and-gateway-addons";

export async function rejectDirectoryCommittedFiles(input: {
  readonly cwd: string;
  readonly files: readonly string[];
  readonly nodeId: string;
}): Promise<void> {
  for (const filePath of input.files) {
    try {
      const fileStat = await stat(path.join(input.cwd, filePath));
      if (fileStat.isDirectory()) {
        throw new AdapterExecutionError(
          "policy_blocked",
          `node '${input.nodeId}' refused directory committedFiles path '${filePath}'`,
        );
      }
    } catch (error: unknown) {
      if (error instanceof AdapterExecutionError) {
        throw error;
      }
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }
      const message = error instanceof Error ? error.message : "unknown error";
      throw new AdapterExecutionError(
        "provider_error",
        `node '${input.nodeId}' could not inspect committedFiles path '${filePath}': ${message}`,
      );
    }
  }
}
export function parseGitRefTemplate(input: {
  readonly value: string | undefined;
  readonly fieldName: string;
  readonly nodeId: string;
}): string | undefined {
  const trimmed = input.value?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return undefined;
  }
  if (/[\0\r\n\t]/.test(trimmed)) {
    throw new AdapterExecutionError(
      "policy_blocked",
      `node '${input.nodeId}' refused ${input.fieldName} containing control characters`,
    );
  }
  return trimmed;
}
export async function runGitCommand(input: {
  readonly gitPath: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly context: NativeNodeExecutionContext;
  readonly artifactDir: string;
  readonly label: string;
}): Promise<{
  readonly result: SpawnedProcessResult;
  readonly processLogs: readonly AdapterProcessLog[];
}> {
  const result = await runLoggedSpawnedProcess({
    command: input.gitPath,
    args: input.args,
    cwd: input.cwd,
    env: input.env,
    context: input.context,
    artifactDir: input.artifactDir,
    logPrefix: input.label,
  });
  return {
    result,
    processLogs: buildProcessLogAttachments(result, input.label),
  };
}
export async function resolveCurrentGitBranch(input: {
  readonly gitPath: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly context: NativeNodeExecutionContext;
  readonly artifactDir: string;
  readonly nodeId: string;
}): Promise<{
  readonly branch: string;
  readonly processLogs: readonly AdapterProcessLog[];
}> {
  const { result, processLogs } = await runGitCommand({
    ...input,
    args: ["rev-parse", "--abbrev-ref", "HEAD"],
    label: "git-current-branch",
  });
  const branch = result.stdout.trim();
  if (branch.length === 0 || branch === "HEAD") {
    throw new AdapterExecutionError(
      "provider_error",
      `node '${input.nodeId}' could not resolve the current git branch`,
      { processLogs },
    );
  }
  return { branch, processLogs };
}
export async function executeGitCommit(input: {
  readonly nodeInput: NativeNodeExecutionInput;
  readonly context: NativeNodeExecutionContext;
  readonly config: ResolvedGitCommitAddon["config"];
}): Promise<{
  readonly commitHash: string;
  readonly commitMessage: string;
  readonly committedFiles: readonly string[];
  readonly cwd: string;
  readonly gitPath: string;
  readonly gitEnv: NodeJS.ProcessEnv;
  readonly processLogs: readonly AdapterProcessLog[];
}> {
  const variables = resolveTemplateVariables(input.nodeInput);
  const commitMessage = renderPromptTemplate(
    input.config.commitMessageTemplate,
    variables,
  ).trim();
  if (commitMessage.length === 0) {
    throw new AdapterExecutionError(
      "invalid_output",
      `node '${input.nodeInput.nodeId}' rendered an empty git commit message`,
    );
  }

  const committedFiles = [
    ...new Set(
      parseCommittedFiles({
        renderedFiles: renderPromptTemplate(
          input.config.committedFilesTemplate,
          variables,
        ),
        nodeId: input.nodeInput.nodeId,
      }).map((filePath) =>
        normalizeCommittedFilePath({
          filePath,
          nodeId: input.nodeInput.nodeId,
        }),
      ),
    ),
  ];
  if (committedFiles.length === 0) {
    throw new AdapterExecutionError(
      "invalid_output",
      `node '${input.nodeInput.nodeId}' committedFilesTemplate rendered an empty file list`,
    );
  }

  const cwd = resolveNodeExecutionWorkingDirectory(
    input.nodeInput.workflowWorkingDirectory,
    input.nodeInput.node.workingDirectory,
  );
  await rejectDirectoryCommittedFiles({
    cwd,
    files: committedFiles,
    nodeId: input.nodeInput.nodeId,
  });

  const gitPath = input.config.gitPath ?? "git";
  const gitEnv = buildRunnerEnv({
    ...(input.nodeInput.env === undefined
      ? {}
      : { ambientEnv: input.nodeInput.env }),
  });
  const processLogs: AdapterProcessLog[] = [];
  const appendLogs = (logs: readonly AdapterProcessLog[]): void => {
    processLogs.push(...logs);
  };

  appendLogs(
    (
      await runGitCommand({
        gitPath,
        args: ["add", "--", ...committedFiles],
        cwd,
        env: gitEnv,
        context: input.context,
        artifactDir: input.nodeInput.artifactDir,
        label: "git-add",
      })
    ).processLogs,
  );

  const staged = await runGitCommand({
    gitPath,
    args: ["diff", "--cached", "--name-only", "--"],
    cwd,
    env: gitEnv,
    context: input.context,
    artifactDir: input.nodeInput.artifactDir,
    label: "git-staged-files",
  });
  appendLogs(staged.processLogs);
  const stagedFiles = staged.result.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const allowedFiles = new Set(committedFiles);
  const unexpectedStagedFiles = stagedFiles.filter(
    (filePath) => !allowedFiles.has(filePath),
  );
  if (unexpectedStagedFiles.length > 0) {
    throw new AdapterExecutionError(
      "policy_blocked",
      `node '${input.nodeInput.nodeId}' refused to commit pre-staged files outside committedFiles: ${unexpectedStagedFiles.join(", ")}`,
      { processLogs },
    );
  }
  if (stagedFiles.length === 0) {
    throw new AdapterExecutionError(
      "provider_error",
      `node '${input.nodeInput.nodeId}' has no staged changes to commit`,
      { processLogs },
    );
  }

  appendLogs(
    (
      await runGitCommand({
        gitPath,
        args: ["commit", "-m", commitMessage],
        cwd,
        env: gitEnv,
        context: input.context,
        artifactDir: input.nodeInput.artifactDir,
        label: "git-commit",
      })
    ).processLogs,
  );

  const commitHashResult = await runGitCommand({
    gitPath,
    args: ["rev-parse", "HEAD"],
    cwd,
    env: gitEnv,
    context: input.context,
    artifactDir: input.nodeInput.artifactDir,
    label: "git-commit-hash",
  });
  appendLogs(commitHashResult.processLogs);
  const commitHash = commitHashResult.result.stdout.trim();
  if (commitHash.length === 0) {
    throw new AdapterExecutionError(
      "provider_error",
      `node '${input.nodeInput.nodeId}' could not resolve the created commit hash`,
      { processLogs },
    );
  }

  return {
    commitHash,
    commitMessage,
    committedFiles: stagedFiles,
    cwd,
    gitPath,
    gitEnv,
    processLogs,
  };
}
export async function executeGitCommitAddonNode(
  input: NativeNodeExecutionInput,
  addon: ResolvedGitCommitAddon,
  context: NativeNodeExecutionContext,
): Promise<AdapterExecutionOutput> {
  const committed = await executeGitCommit({
    nodeInput: input,
    context,
    config: addon.config,
  });
  return buildNativeOutput({
    provider: "native-addon:git-commit",
    model: `${addon.name}@${addon.version}`,
    promptText: addon.config.commitMessageTemplate,
    payload: {
      git: {
        status: "committed",
        commitHash: committed.commitHash,
        commitMessage: committed.commitMessage,
        committedFiles: committed.committedFiles,
      },
      commitStatus: "committed",
      commitHash: committed.commitHash,
      commitMessage: committed.commitMessage,
      committedFiles: committed.committedFiles,
      residualRisks: [],
    },
    processLogs: committed.processLogs,
  });
}
export async function executeGitPushAddonNode(
  input: NativeNodeExecutionInput,
  addon: ResolvedGitPushAddon,
  context: NativeNodeExecutionContext,
): Promise<AdapterExecutionOutput> {
  const variables = resolveTemplateVariables(input);
  const cwd = resolveNodeExecutionWorkingDirectory(
    input.workflowWorkingDirectory,
    input.node.workingDirectory,
  );
  const gitPath = addon.config.gitPath ?? "git";
  const gitEnv = buildRunnerEnv({
    ...(input.env === undefined ? {} : { ambientEnv: input.env }),
  });
  const remote =
    parseGitRefTemplate({
      value:
        addon.config.remoteTemplate === undefined
          ? "origin"
          : renderPromptTemplate(addon.config.remoteTemplate, variables),
      fieldName: "remoteTemplate",
      nodeId: input.nodeId,
    }) ?? "origin";
  const processLogs: AdapterProcessLog[] = [];
  const appendLogs = (logs: readonly AdapterProcessLog[]): void => {
    processLogs.push(...logs);
  };
  const currentBranch =
    addon.config.branchTemplate === undefined
      ? await resolveCurrentGitBranch({
          gitPath,
          cwd,
          env: gitEnv,
          context,
          artifactDir: input.artifactDir,
          nodeId: input.nodeId,
        })
      : undefined;
  if (currentBranch !== undefined) {
    appendLogs(currentBranch.processLogs);
  }
  const branch =
    parseGitRefTemplate({
      value:
        addon.config.branchTemplate === undefined
          ? undefined
          : renderPromptTemplate(addon.config.branchTemplate, variables),
      fieldName: "branchTemplate",
      nodeId: input.nodeId,
    }) ?? currentBranch?.branch;
  if (branch === undefined) {
    throw new AdapterExecutionError(
      "provider_error",
      `node '${input.nodeId}' could not resolve a git branch to push`,
      { processLogs },
    );
  }

  const commitHashResult = await runGitCommand({
    gitPath,
    args: ["rev-parse", "HEAD"],
    cwd,
    env: gitEnv,
    context,
    artifactDir: input.artifactDir,
    label: "git-push-commit-hash",
  });
  appendLogs(commitHashResult.processLogs);
  const commitHash = commitHashResult.result.stdout.trim();
  if (commitHash.length === 0) {
    throw new AdapterExecutionError(
      "provider_error",
      `node '${input.nodeId}' could not resolve HEAD before pushing`,
      { processLogs },
    );
  }

  const pushResult = await runGitCommand({
    gitPath,
    args: ["push", remote, `HEAD:${branch}`],
    cwd,
    env: gitEnv,
    context,
    artifactDir: input.artifactDir,
    label: "git-push",
  });
  appendLogs(pushResult.processLogs);

  return buildNativeOutput({
    provider: "native-addon:git-push",
    model: `${addon.name}@${addon.version}`,
    promptText: addon.config.branchTemplate ?? branch,
    payload: {
      git: {
        status: "pushed",
        commitHash,
        pushedRemote: remote,
        pushedBranch: branch,
      },
      pushStatus: "pushed",
      commitHash,
      pushedRemote: remote,
      pushedBranch: branch,
      residualRisks: [],
    },
    processLogs,
  });
}
export async function executeSuperviserControlAddonNode(
  input: NativeNodeExecutionInput,
  addon: ResolvedSuperviserControlAddon,
): Promise<AdapterExecutionOutput> {
  if (input.superviserControl === undefined) {
    throw new AdapterExecutionError(
      "policy_blocked",
      `node '${input.nodeId}' add-on '${addon.name}' requires nested superviser runtime control (phase-2 --auto-improve); this add-on is not available in the current execution context`,
    );
  }
  const result = await executeSuperviserControlNativeOperation({
    addonName: addon.name,
    arguments: input.arguments,
    control: input.superviserControl,
    nodeId: input.nodeId,
  });
  if (!result.ok) {
    throw new AdapterExecutionError("provider_error", result.error);
  }
  return buildNativeOutput({
    provider: `native-addon:superviser-control/${getSuperviserControlAddonProviderOperationId(addon.name)}`,
    model: addon.name,
    promptText: "superviser-control",
    payload: { superviser: result.value },
  });
}
export async function executeAddonNode(
  input: NativeNodeExecutionInput,
  context: NativeNodeExecutionContext,
): Promise<AdapterExecutionOutput> {
  const addon = input.node.addon;
  if (addon === undefined) {
    throw new AdapterExecutionError(
      "policy_blocked",
      `node '${input.nodeId}' does not declare a resolved add-on executor`,
    );
  }
  if (isSuperviserControlAddonName(addon.name)) {
    return await executeSuperviserControlAddonNode(
      input,
      addon as ResolvedSuperviserControlAddon,
    );
  }
  switch (addon.name) {
    case "divedra/chat-reply-worker":
      return await executeChatReplyAddonNode(input, addon);
    case "divedra/x-gateway-read":
      return await executeXGatewayReadAddonNode(input, addon, context);
    case "divedra/x-gateway":
      return await executeXGatewayAddonNode(input, addon, context);
    case "divedra/mail-gateway-read":
      return await executeMailGatewayReadAddonNode(input, addon, context);
    case "divedra/mail-gateway":
      return await executeMailGatewayAddonNode(input, addon, context);
    case GIT_COMMIT_ADDON_NAME:
      return await executeGitCommitAddonNode(input, addon, context);
    case GIT_PUSH_ADDON_NAME:
      return await executeGitPushAddonNode(input, addon, context);
    default:
      throw new AdapterExecutionError(
        "policy_blocked",
        `node '${input.nodeId}' declares add-on '${addon.name}' that does not use a native add-on executor`,
      );
  }
}
export async function executeNativeNode(
  input: NativeNodeExecutionInput,
  context: NativeNodeExecutionContext,
): Promise<AdapterExecutionOutput> {
  switch (input.node.nodeType) {
    case "command":
      return await executeCommandNode(input, context);
    case "container":
      return await executeContainerNode(input, context);
    case "addon":
      return await executeAddonNode(input, context);
    default:
      throw new AdapterExecutionError(
        "policy_blocked",
        `node '${input.nodeId}' does not use a native command/container/add-on executor`,
      );
  }
}
