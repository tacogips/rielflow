import path from "node:path";
import type {
  NodePayload,
  NormalizedYoutubeMp4DownloadConfig,
  ResolvedYoutubeMp4DownloadAddon,
  ValidationIssue,
  WorkflowNodeAddonRef,
} from "../../../rielflow-core/src/index";
import {
  YOUTUBE_MP4_DOWNLOAD_ADDON_NAME,
  YOUTUBE_MP4_DOWNLOAD_ADDON_VERSION,
  YOUTUBE_MP4_DOWNLOAD_OUTPUT,
  isRecord,
  makeIssue,
} from "./addon-constants-and-agent-config";
import { rejectUnsupportedAddonEnv } from "./gateway-and-git-config";

export const DEFAULT_YT_DLP_PATH = "yt-dlp";
export const DEFAULT_YOUTUBE_MP4_OUTPUT_DIRECTORY = "downloads";
export const DEFAULT_YOUTUBE_MP4_FILE_NAME_TEMPLATE =
  "%(title).200B-%(id)s.%(ext)s";
export const DEFAULT_YOUTUBE_MP4_FORMAT_SELECTOR =
  "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best[ext=mp4]";

const SUPPORTED_YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{6,128}$/u;

function hasTemplateSyntax(value: string): boolean {
  return value.includes("{{") || value.includes("}}");
}

function hasControlCharacters(value: string): boolean {
  return /[\0\r\n\t]/u.test(value);
}

function readNonEmptyStringConfig(input: {
  readonly config: Readonly<Record<string, unknown>>;
  readonly key: string;
  readonly path: string;
  readonly issues: ValidationIssue[];
}): string | undefined {
  const raw = input.config[input.key];
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "string" || raw.length === 0) {
    input.issues.push(makeIssue(`${input.path}.${input.key}`, "must be a non-empty string"));
    return undefined;
  }
  if (hasControlCharacters(raw)) {
    input.issues.push(
      makeIssue(
        `${input.path}.${input.key}`,
        "must not contain NUL, tab, carriage return, or newline characters",
      ),
    );
    return undefined;
  }
  return raw;
}

export function validateYoutubeMp4OutputDirectory(
  value: string,
  pathLabel: string,
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (path.isAbsolute(value)) {
    issues.push(makeIssue(pathLabel, "must be relative"));
  }
  const normalized = path.posix.normalize(value.replaceAll(path.win32.sep, "/"));
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    issues.push(makeIssue(pathLabel, "must stay inside the workflow working directory"));
  }
  return issues;
}

export function validateYoutubeMp4FileNameTemplate(
  value: string,
  pathLabel: string,
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (
    path.isAbsolute(value) ||
    value.includes("/") ||
    value.includes("\\") ||
    value === ".." ||
    value.startsWith("../") ||
    value.endsWith("/..") ||
    value.includes("/../")
  ) {
    issues.push(makeIssue(pathLabel, "must be a basename template without path separators or '..' segments"));
  }
  return issues;
}

export function validateYoutubeMp4Url(
  value: string,
  pathLabel: string,
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    issues.push(makeIssue(pathLabel, "must be a valid URL"));
    return issues;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    issues.push(makeIssue(pathLabel, "must use http or https"));
  }
  if (!SUPPORTED_YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) {
    issues.push(makeIssue(pathLabel, "must target a supported YouTube host"));
  }
  const list = url.searchParams.get("list");
  if (list !== null && list.length > 0) {
    issues.push(makeIssue(pathLabel, "must not include playlist parameters"));
  }
  if (!isYoutubeVideoUrl(url)) {
    issues.push(
      makeIssue(
        pathLabel,
        "must target a single YouTube video URL such as /watch?v=, /shorts/, /embed/, /live/, or youtu.be/",
      ),
    );
  }
  return issues;
}

function isYoutubeVideoUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  if (hostname === "youtu.be") {
    const [videoId] = url.pathname.split("/").filter((part) => part.length > 0);
    return videoId !== undefined && YOUTUBE_VIDEO_ID_PATTERN.test(videoId);
  }
  const pathParts = url.pathname.split("/").filter((part) => part.length > 0);
  if (pathParts.length === 0) {
    return false;
  }
  const [route, videoId] = pathParts;
  if (route === "watch") {
    const watchId = url.searchParams.get("v");
    return watchId !== null && YOUTUBE_VIDEO_ID_PATTERN.test(watchId);
  }
  return (
    (route === "shorts" || route === "embed" || route === "live") &&
    videoId !== undefined &&
    YOUTUBE_VIDEO_ID_PATTERN.test(videoId)
  );
}

function normalizeYoutubeMp4Config(
  value: Readonly<Record<string, unknown>> | undefined,
  pathLabel: string,
): {
  readonly config?: NormalizedYoutubeMp4DownloadConfig;
  readonly issues: readonly ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const config = value ?? {};
  const allowedKeys = new Set([
    "ytDlpPath",
    "outputDirectory",
    "fileNameTemplate",
    "formatSelector",
    "timeoutMs",
  ]);

  for (const key of Object.keys(config)) {
    if (!allowedKeys.has(key)) {
      issues.push(makeIssue(`${pathLabel}.${key}`, "is not supported"));
    }
  }

  const ytDlpPath =
    readNonEmptyStringConfig({ config, key: "ytDlpPath", path: pathLabel, issues }) ??
    DEFAULT_YT_DLP_PATH;
  const outputDirectory =
    readNonEmptyStringConfig({
      config,
      key: "outputDirectory",
      path: pathLabel,
      issues,
    }) ?? DEFAULT_YOUTUBE_MP4_OUTPUT_DIRECTORY;
  const fileNameTemplate =
    readNonEmptyStringConfig({
      config,
      key: "fileNameTemplate",
      path: pathLabel,
      issues,
    }) ?? DEFAULT_YOUTUBE_MP4_FILE_NAME_TEMPLATE;
  const formatSelector =
    readNonEmptyStringConfig({
      config,
      key: "formatSelector",
      path: pathLabel,
      issues,
    }) ?? DEFAULT_YOUTUBE_MP4_FORMAT_SELECTOR;

  issues.push(
    ...validateYoutubeMp4OutputDirectory(
      outputDirectory,
      `${pathLabel}.outputDirectory`,
    ),
    ...validateYoutubeMp4FileNameTemplate(
      fileNameTemplate,
      `${pathLabel}.fileNameTemplate`,
    ),
  );

  const timeoutMsRaw = config["timeoutMs"];
  let timeoutMs: number | undefined;
  if (timeoutMsRaw !== undefined) {
    if (
      Number.isInteger(timeoutMsRaw) &&
      typeof timeoutMsRaw === "number" &&
      timeoutMsRaw > 0
    ) {
      timeoutMs = timeoutMsRaw;
    } else {
      issues.push(makeIssue(`${pathLabel}.timeoutMs`, "must be a positive integer"));
    }
  }

  if (issues.length > 0) {
    return { issues };
  }

  return {
    config: {
      ytDlpPath,
      outputDirectory,
      fileNameTemplate,
      formatSelector,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    },
    issues,
  };
}

function normalizeYoutubeMp4Inputs(
  value: Readonly<Record<string, unknown>> | undefined,
  pathLabel: string,
): {
  readonly inputs?: Readonly<{ url: string }>;
  readonly issues: readonly ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  if (value === undefined) {
    return {
      issues: [makeIssue(pathLabel, "must include required url")],
    };
  }
  const url = value["url"];
  if (typeof url !== "string" || url.length === 0) {
    return {
      issues: [makeIssue(`${pathLabel}.url`, "must be a non-empty string")],
    };
  }
  if (hasControlCharacters(url)) {
    issues.push(
      makeIssue(
        `${pathLabel}.url`,
        "must not contain NUL, tab, carriage return, or newline characters",
      ),
    );
  }
  if (!hasTemplateSyntax(url)) {
    issues.push(...validateYoutubeMp4Url(url, `${pathLabel}.url`));
  }
  if (issues.length > 0) {
    return { issues };
  }
  return { inputs: { url }, issues };
}

export function resolveYoutubeMp4DownloadPayload(input: {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
}): {
  readonly payload?: NodePayload;
  readonly issues: readonly ValidationIssue[];
} {
  if (input.addon.name !== YOUTUBE_MP4_DOWNLOAD_ADDON_NAME) {
    return { issues: [] };
  }

  const version = input.addon.version ?? YOUTUBE_MP4_DOWNLOAD_ADDON_VERSION;
  if (version !== YOUTUBE_MP4_DOWNLOAD_ADDON_VERSION) {
    return {
      issues: [
        makeIssue(
          `${input.path}.version`,
          `unsupported version '${version}' for ${YOUTUBE_MP4_DOWNLOAD_ADDON_NAME}`,
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

  const normalizedConfig = normalizeYoutubeMp4Config(
    input.addon.config,
    `${input.path}.config`,
  );
  if (normalizedConfig.config === undefined) {
    return { issues: normalizedConfig.issues };
  }
  const normalizedInputs = normalizeYoutubeMp4Inputs(
    input.addon.inputs,
    `${input.path}.inputs`,
  );
  if (normalizedInputs.inputs === undefined) {
    return { issues: normalizedInputs.issues };
  }

  const addon: ResolvedYoutubeMp4DownloadAddon = {
    name: YOUTUBE_MP4_DOWNLOAD_ADDON_NAME,
    version: YOUTUBE_MP4_DOWNLOAD_ADDON_VERSION,
    config: normalizedConfig.config,
    inputs: normalizedInputs.inputs,
  };

  return {
    payload: {
      id: input.nodeId,
      description:
        "Built-in worker that downloads one validated YouTube URL as an MP4 with yt-dlp.",
      nodeType: "addon",
      variables: normalizedInputs.inputs,
      addon,
      output: YOUTUBE_MP4_DOWNLOAD_OUTPUT,
    },
    issues: [],
  };
}
