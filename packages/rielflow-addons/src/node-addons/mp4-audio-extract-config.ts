import type {
  Mp4AudioExtractAddonConfig,
  NodePayload,
  ResolvedMp4AudioExtractAddon,
  ValidationIssue,
  WorkflowNodeAddonRef,
} from "../../../rielflow-core/src/index";
import {
  MP4_AUDIO_EXTRACT_ADDON_NAME,
  MP4_AUDIO_EXTRACT_ADDON_VERSION,
  MP4_AUDIO_EXTRACT_OUTPUT,
  isRecord,
  makeIssue,
} from "./addon-constants-and-agent-config";

export function normalizeMp4AudioExtractConfig(
  value: Readonly<Record<string, unknown>> | undefined,
  path: string,
): {
  readonly config?: Mp4AudioExtractAddonConfig;
  readonly issues: readonly ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const config: Readonly<Record<string, unknown>> = value ?? {};
  const allowedKeys = new Set([
    "mp4PathTemplate",
    "ffmpegPath",
    "sampleRateHertz",
    "audioChannelCount",
  ]);

  for (const key of Object.keys(config)) {
    if (!allowedKeys.has(key)) {
      issues.push(makeIssue(`${path}.${key}`, "is not supported"));
    }
  }

  const mp4PathTemplate = readRequiredNonBlankStringConfig(
    config,
    "mp4PathTemplate",
    path,
    issues,
  );
  const ffmpegPath = readOptionalNonBlankStringConfig(
    config,
    "ffmpegPath",
    path,
    issues,
  );
  const sampleRateHertz = readPositiveIntegerConfig(
    config,
    "sampleRateHertz",
    path,
    issues,
  );
  const audioChannelCount = readPositiveIntegerConfig(
    config,
    "audioChannelCount",
    path,
    issues,
  );

  if (issues.length > 0 || mp4PathTemplate === undefined) {
    return { issues };
  }

  return {
    config: {
      mp4PathTemplate,
      ...(ffmpegPath === undefined ? {} : { ffmpegPath }),
      ...(sampleRateHertz === undefined ? {} : { sampleRateHertz }),
      ...(audioChannelCount === undefined ? {} : { audioChannelCount }),
    },
    issues,
  };
}

function readOptionalNonBlankStringConfig(
  config: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  issues: ValidationIssue[],
): string | undefined {
  const value = config[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  issues.push(makeIssue(`${path}.${key}`, "must be a non-empty string"));
  return undefined;
}

function readRequiredNonBlankStringConfig(
  config: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  issues: ValidationIssue[],
): string | undefined {
  const value = readOptionalNonBlankStringConfig(config, key, path, issues);
  if (value === undefined && config[key] === undefined) {
    issues.push(makeIssue(`${path}.${key}`, "must be a non-empty string"));
  }
  return value;
}

function readPositiveIntegerConfig(
  config: Readonly<Record<string, unknown>>,
  key: "sampleRateHertz" | "audioChannelCount",
  path: string,
  issues: ValidationIssue[],
): number | undefined {
  const raw = config[key];
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) {
    return raw;
  }
  issues.push(makeIssue(`${path}.${key}`, "must be a positive integer"));
  return undefined;
}

export function resolveMp4AudioExtractPayload(input: {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
}): {
  readonly payload?: NodePayload;
  readonly issues: readonly ValidationIssue[];
} {
  if (input.addon.name !== MP4_AUDIO_EXTRACT_ADDON_NAME) {
    return { issues: [] };
  }

  const version =
    input.addon.version ?? MP4_AUDIO_EXTRACT_ADDON_VERSION;
  if (version !== MP4_AUDIO_EXTRACT_ADDON_VERSION) {
    return {
      issues: [
        makeIssue(
          `${input.path}.version`,
          `unsupported version '${version}' for ${MP4_AUDIO_EXTRACT_ADDON_NAME}`,
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

  const normalized = normalizeMp4AudioExtractConfig(
    input.addon.config,
    `${input.path}.config`,
  );
  if (normalized.config === undefined) {
    return {
      issues: [...normalized.issues],
    };
  }

  const addon: ResolvedMp4AudioExtractAddon = {
    name: MP4_AUDIO_EXTRACT_ADDON_NAME,
    version: MP4_AUDIO_EXTRACT_ADDON_VERSION,
    config: normalized.config,
    ...(input.addon.inputs === undefined ? {} : { inputs: input.addon.inputs }),
  };

  return {
    payload: {
      id: input.nodeId,
      description:
        "Built-in worker that extracts MP4 audio with ffmpeg.",
      nodeType: "addon",
      variables: input.addon.inputs ?? {},
      addon,
      output: MP4_AUDIO_EXTRACT_OUTPUT,
    },
    issues: [],
  };
}
