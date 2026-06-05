import { mkdir, mkdtemp, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  AdapterExecutionError,
  type AdapterExecutionOutput,
  type AdapterProcessLog,
  renderPromptTemplate,
  resolveNodeExecutionWorkingDirectory,
} from "../../../rielflow-core/src/index";
import type { ResolvedYoutubeMp4DownloadAddon } from "../../../rielflow-core/src/index";
import {
  buildNativeOutput,
  buildProcessLogAttachments,
  resolveTemplateVariables,
  runLoggedSpawnedProcess,
  type NativeNodeExecutionContext,
  type NativeNodeExecutionInput,
  type SpawnedProcessResult,
} from "./template-env-and-containers";
import {
  validateYoutubeMp4FileNameTemplate,
  validateYoutubeMp4OutputDirectory,
  validateYoutubeMp4Url,
} from "../node-addons/youtube-mp4-download-config";

const DEFAULT_YOUTUBE_MP4_TIMEOUT_MS = 30 * 60 * 1000;

function issueMessages(
  issues: readonly { readonly path: string; readonly message: string }[],
): string {
  return issues.map((issue) => `${issue.path} ${issue.message}`).join("; ");
}

function ensureNoControlCharacters(input: {
  readonly value: string;
  readonly fieldName: string;
  readonly nodeId: string;
}): void {
  if (/[\0\r\n\t]/u.test(input.value)) {
    throw new AdapterExecutionError(
      "policy_blocked",
      `node '${input.nodeId}' refused ${input.fieldName} containing control characters`,
    );
  }
}

function validateRuntimeYoutubeConfig(input: {
  readonly addon: ResolvedYoutubeMp4DownloadAddon;
  readonly nodeId: string;
}): void {
  const config = input.addon.config;
  const issues = [
    ...validateYoutubeMp4OutputDirectory(
      config.outputDirectory,
      "addon.config.outputDirectory",
    ),
    ...validateYoutubeMp4FileNameTemplate(
      config.fileNameTemplate,
      "addon.config.fileNameTemplate",
    ),
  ];
  for (const [fieldName, value] of [
    ["ytDlpPath", config.ytDlpPath],
    ["outputDirectory", config.outputDirectory],
    ["fileNameTemplate", config.fileNameTemplate],
    ["formatSelector", config.formatSelector],
  ] as const) {
    ensureNoControlCharacters({
      value,
      fieldName,
      nodeId: input.nodeId,
    });
  }
  if (issues.length > 0) {
    throw new AdapterExecutionError(
      "policy_blocked",
      `node '${input.nodeId}' refused unsafe YouTube MP4 download config: ${issueMessages(issues)}`,
    );
  }
}

function validateRenderedUrl(input: {
  readonly url: string;
  readonly nodeId: string;
}): void {
  ensureNoControlCharacters({
    value: input.url,
    fieldName: "inputs.url",
    nodeId: input.nodeId,
  });
  const issues = validateYoutubeMp4Url(input.url, "addon.inputs.url");
  if (issues.length > 0) {
    throw new AdapterExecutionError(
      "policy_blocked",
      `node '${input.nodeId}' refused unsafe YouTube URL: ${issueMessages(issues)}`,
    );
  }
}

function isInsideDirectory(input: {
  readonly root: string;
  readonly candidate: string;
}): boolean {
  const relative = path.relative(input.root, input.candidate);
  return (
    relative.length === 0 ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

async function resolveConfinedOutputDirectory(input: {
  readonly workingDirectory: string;
  readonly outputDirectory: string;
  readonly nodeId: string;
}): Promise<string> {
  const workingRoot = await realpath(input.workingDirectory);
  const outputDirectory = path.resolve(workingRoot, input.outputDirectory);
  if (!isInsideDirectory({ root: workingRoot, candidate: outputDirectory })) {
    throw new AdapterExecutionError(
      "policy_blocked",
      `node '${input.nodeId}' refused outputDirectory outside the workflow working directory`,
    );
  }
  await mkdir(outputDirectory, { recursive: true });
  const outputRealpath = await realpath(outputDirectory);
  if (!isInsideDirectory({ root: workingRoot, candidate: outputRealpath })) {
    throw new AdapterExecutionError(
      "policy_blocked",
      `node '${input.nodeId}' refused outputDirectory symlink escaping the workflow working directory`,
    );
  }
  return outputRealpath;
}

async function createInvocationOutputDirectory(input: {
  readonly parentDirectory: string;
  readonly nodeExecId: string;
  readonly workingDirectory: string;
  readonly nodeId: string;
}): Promise<string> {
  const safePrefix = input.nodeExecId.replaceAll(/[^A-Za-z0-9_.-]/gu, "-");
  const invocationDirectory = await mkdtemp(
    path.join(input.parentDirectory, `${safePrefix}-`),
  );
  const workingRoot = await realpath(input.workingDirectory);
  const invocationRealpath = await realpath(invocationDirectory);
  if (!isInsideDirectory({ root: workingRoot, candidate: invocationRealpath })) {
    throw new AdapterExecutionError(
      "policy_blocked",
      `node '${input.nodeId}' refused invocation output directory outside the workflow working directory`,
    );
  }
  return invocationRealpath;
}

async function buildYtDlpEnv(input: {
  readonly artifactDir: string;
  readonly ambientEnv?: Readonly<Record<string, string | undefined>>;
}): Promise<NodeJS.ProcessEnv> {
  const home = path.join(input.artifactDir, "yt-dlp-home");
  const cache = path.join(input.artifactDir, "yt-dlp-cache");
  const tmp = path.join(input.artifactDir, "yt-dlp-tmp");
  await Promise.all([
    mkdir(home, { recursive: true }),
    mkdir(cache, { recursive: true }),
    mkdir(tmp, { recursive: true }),
  ]);
  const ambient = input.ambientEnv ?? {};
  const pathValue = ambient["PATH"] ?? process.env["PATH"];
  return {
    ...(pathValue === undefined ? {} : { PATH: pathValue }),
    ...(process.platform === "win32" && process.env["SystemRoot"] !== undefined
      ? { SystemRoot: process.env["SystemRoot"] }
      : {}),
    ...(process.platform === "win32" && process.env["ComSpec"] !== undefined
      ? { ComSpec: process.env["ComSpec"] }
      : {}),
    ...(process.platform === "win32" && process.env["PATHEXT"] !== undefined
      ? { PATHEXT: process.env["PATHEXT"] }
      : {}),
    HOME: home,
    XDG_CACHE_HOME: cache,
    TMPDIR: tmp,
    TMP: tmp,
    TEMP: tmp,
    LANG: ambient["LANG"] ?? process.env["LANG"] ?? "C.UTF-8",
  };
}

function withTimeoutContext(input: {
  readonly context: NativeNodeExecutionContext;
  readonly timeoutMs: number;
}): {
  readonly context: NativeNodeExecutionContext;
  readonly cleanup: () => void;
} {
  const controller = new AbortController();
  const onAbort = (): void => {
    controller.abort();
  };
  if (input.context.signal.aborted) {
    controller.abort();
  } else {
    input.context.signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  return {
    context: {
      timeoutMs: input.timeoutMs,
      signal: controller.signal,
    },
    cleanup: () => {
      clearTimeout(timer);
      input.context.signal.removeEventListener("abort", onAbort);
    },
  };
}

async function collectDownloadedMp4Files(
  outputDirectory: string,
): Promise<readonly string[]> {
  const entries = await readdir(outputDirectory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".mp4"))
    .map((entry) => path.join(outputDirectory, entry.name))
    .sort((left, right) => left.localeCompare(right));
  return files;
}

async function resolveDownloadedMp4(input: {
  readonly outputDirectory: string;
  readonly workingDirectory: string;
  readonly nodeId: string;
  readonly processLogs: readonly AdapterProcessLog[];
}): Promise<{
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly fileName: string;
  readonly fileSize?: number;
}> {
  const files = await collectDownloadedMp4Files(input.outputDirectory);
  if (files.length === 0) {
    throw new AdapterExecutionError(
      "invalid_output",
      `node '${input.nodeId}' yt-dlp completed without producing an MP4 file`,
      { processLogs: input.processLogs },
    );
  }
  if (files.length > 1) {
    throw new AdapterExecutionError(
      "invalid_output",
      `node '${input.nodeId}' yt-dlp produced multiple MP4 files; version 1 supports one video`,
      { processLogs: input.processLogs },
    );
  }
  const absolutePath = files[0];
  if (absolutePath === undefined) {
    throw new AdapterExecutionError(
      "invalid_output",
      `node '${input.nodeId}' yt-dlp completed without producing an MP4 file`,
      { processLogs: input.processLogs },
    );
  }
  const workingRoot = await realpath(input.workingDirectory);
  const outputRealpath = await realpath(absolutePath);
  if (!isInsideDirectory({ root: workingRoot, candidate: outputRealpath })) {
    throw new AdapterExecutionError(
      "policy_blocked",
      `node '${input.nodeId}' refused downloaded file outside the workflow working directory`,
      { processLogs: input.processLogs },
    );
  }
  const fileStat = await stat(outputRealpath).catch(() => undefined);
  return {
    absolutePath: outputRealpath,
    relativePath: path.relative(workingRoot, outputRealpath),
    fileName: path.basename(outputRealpath),
    ...(fileStat === undefined ? {} : { fileSize: fileStat.size }),
  };
}

export async function executeYoutubeMp4DownloadAddonNode(
  input: NativeNodeExecutionInput,
  addon: ResolvedYoutubeMp4DownloadAddon,
  context: NativeNodeExecutionContext,
): Promise<AdapterExecutionOutput> {
  validateRuntimeYoutubeConfig({ addon, nodeId: input.nodeId });
  const variables = resolveTemplateVariables(input);
  const renderedUrl = renderPromptTemplate(addon.inputs.url, variables).trim();
  validateRenderedUrl({ url: renderedUrl, nodeId: input.nodeId });

  const cwd = resolveNodeExecutionWorkingDirectory(
    input.workflowWorkingDirectory,
    input.node.workingDirectory,
  );
  const outputParentDirectory = await resolveConfinedOutputDirectory({
    workingDirectory: cwd,
    outputDirectory: addon.config.outputDirectory,
    nodeId: input.nodeId,
  });
  const outputDirectory = await createInvocationOutputDirectory({
    parentDirectory: outputParentDirectory,
    nodeExecId: input.nodeExecId,
    workingDirectory: cwd,
    nodeId: input.nodeId,
  });
  const env = await buildYtDlpEnv({
    artifactDir: input.artifactDir,
    ...(input.env === undefined ? {} : { ambientEnv: input.env }),
  });
  const args = [
    "--ignore-config",
    "--no-playlist",
    "--merge-output-format",
    "mp4",
    "--remux-video",
    "mp4",
    "--paths",
    outputDirectory,
    "--output",
    addon.config.fileNameTemplate,
    "--format",
    addon.config.formatSelector,
    renderedUrl,
  ];
  const timeout = withTimeoutContext({
    context,
    timeoutMs:
      addon.config.timeoutMs ?? context.timeoutMs ?? DEFAULT_YOUTUBE_MP4_TIMEOUT_MS,
  });
  let result: SpawnedProcessResult;
  try {
    result = await runLoggedSpawnedProcess({
      command: addon.config.ytDlpPath,
      args,
      cwd,
      env,
      context: timeout.context,
      artifactDir: input.artifactDir,
      logPrefix: "yt-dlp",
    });
  } finally {
    timeout.cleanup();
  }
  const processLogs = buildProcessLogAttachments(result, "yt-dlp");
  const downloaded = await resolveDownloadedMp4({
    outputDirectory,
    workingDirectory: cwd,
    nodeId: input.nodeId,
    processLogs,
  });

  return buildNativeOutput({
    provider: "native-addon:youtube-mp4-download",
    model: `${addon.name}@${addon.version}`,
    promptText: renderedUrl,
    payload: {
      youtubeMp4Download: {
        status: "downloaded",
        url: renderedUrl,
        outputPath: downloaded.relativePath,
        fileName: downloaded.fileName,
        ...(downloaded.fileSize === undefined
          ? {}
          : { fileSize: downloaded.fileSize }),
      },
      downloadStatus: "downloaded",
      url: renderedUrl,
      outputPath: downloaded.relativePath,
      fileName: downloaded.fileName,
      ...(downloaded.fileSize === undefined
        ? {}
        : { fileSize: downloaded.fileSize }),
      residualRisks: [],
    },
    processLogs,
  });
}
