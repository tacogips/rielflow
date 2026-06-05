import type {
  GoogleSpeechToTextAddonConfig,
  GoogleSpeechToTextOutputFormat,
  GoogleSpeechToTextRecognitionMode,
  NodeOutputContract,
  NodePayload,
  ResolvedGoogleSpeechToTextAddon,
  ValidationIssue,
  WorkflowNodeAddonEnvBinding,
  WorkflowNodeAddonRef,
} from "../../../rielflow-core/src/index";
import {
  isRecord,
  makeIssue,
  readOptionalStringConfig,
  readRequiredStringConfig,
} from "./addon-constants-and-agent-config";

export const GOOGLE_SPEECH_TO_TEXT_ADDON_NAME =
  "rielflow/google-speech-to-text";
export const GOOGLE_SPEECH_TO_TEXT_ADDON_VERSION = "1";
const GOOGLE_SPEECH_TO_TEXT_ENV_KEYS = new Set([
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_APPLICATION_CREDENTIALS_JSON",
]);

export const GOOGLE_SPEECH_TO_TEXT_OUTPUT: NodeOutputContract = {
  description:
    "Google Cloud Speech-to-Text transcription and optional subtitle artifacts.",
  jsonSchema: {
    type: "object",
    required: ["googleSpeechToText"],
    additionalProperties: true,
    properties: {
      googleSpeechToText: {
        type: "object",
        required: ["transcript", "languageCode", "outputFiles"],
        additionalProperties: true,
        properties: {
          transcript: { type: "string" },
          languageCode: { type: "string", minLength: 1 },
          outputFiles: {
            type: "object",
            additionalProperties: { type: "string", minLength: 1 },
          },
        },
      },
    },
  },
};

function readOptionalBooleanConfig(
  config: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  issues: ValidationIssue[],
): boolean | undefined {
  const value = config[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  issues.push(makeIssue(`${path}.${key}`, "must be a boolean"));
  return undefined;
}

function readOptionalPositiveIntegerConfig(
  config: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  issues: ValidationIssue[],
): number | undefined {
  const value = config[key];
  if (value === undefined) {
    return undefined;
  }
  if (Number.isInteger(value) && typeof value === "number" && value > 0) {
    return value;
  }
  issues.push(makeIssue(`${path}.${key}`, "must be a positive integer"));
  return undefined;
}

function normalizeAlternativeLanguageCodes(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    issues.push(makeIssue(path, "must be an array of non-empty strings"));
    return undefined;
  }
  const codes: string[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      issues.push(makeIssue(`${path}[${index}]`, "must be a non-empty string"));
      continue;
    }
    codes.push(entry);
  }
  return codes;
}

function normalizeRecognitionMode(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): GoogleSpeechToTextRecognitionMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "sync" || value === "long-running") {
    return value;
  }
  issues.push(makeIssue(path, "must be 'sync' or 'long-running'"));
  return undefined;
}

function normalizeOutputFormats(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): readonly GoogleSpeechToTextOutputFormat[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    issues.push(makeIssue(path, "must be an array of json, srt, or vtt"));
    return undefined;
  }
  const formats: GoogleSpeechToTextOutputFormat[] = [];
  for (const [index, entry] of value.entries()) {
    if (entry === "json" || entry === "srt" || entry === "vtt") {
      formats.push(entry);
      continue;
    }
    issues.push(makeIssue(`${path}[${index}]`, "must be json, srt, or vtt"));
  }
  const uniqueFormats = [...new Set(formats)];
  if (uniqueFormats.length === 0) {
    issues.push(makeIssue(path, "must include at least one output format"));
  }
  return uniqueFormats;
}

function normalizeGoogleSpeechEnv(
  value: Readonly<Record<string, unknown>> | undefined,
  path: string,
): {
  readonly env?: Readonly<Record<string, WorkflowNodeAddonEnvBinding>>;
  readonly issues: readonly ValidationIssue[];
} {
  if (value === undefined) {
    return { issues: [] };
  }
  const issues: ValidationIssue[] = [];
  const env: Record<string, WorkflowNodeAddonEnvBinding> = {};
  for (const [targetEnv, binding] of Object.entries(value)) {
    if (!GOOGLE_SPEECH_TO_TEXT_ENV_KEYS.has(targetEnv)) {
      issues.push(
        makeIssue(
          `${path}.${targetEnv}`,
          "must be GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_APPLICATION_CREDENTIALS_JSON",
        ),
      );
    }
    if (!isRecord(binding)) {
      issues.push(makeIssue(`${path}.${targetEnv}`, "must be an object"));
      continue;
    }
    const fromEnv = binding["fromEnv"];
    if (typeof fromEnv !== "string" || fromEnv.trim().length === 0) {
      issues.push(
        makeIssue(`${path}.${targetEnv}.fromEnv`, "must be a non-empty string"),
      );
      continue;
    }
    const required = binding["required"];
    if (required !== undefined && typeof required !== "boolean") {
      issues.push(
        makeIssue(`${path}.${targetEnv}.required`, "must be a boolean"),
      );
      continue;
    }
    env[targetEnv] = {
      fromEnv,
      ...(typeof required === "boolean" ? { required } : {}),
    };
  }
  if (issues.length > 0) {
    return { issues };
  }
  return { env, issues };
}

export function normalizeGoogleSpeechToTextConfig(
  value: Readonly<Record<string, unknown>> | undefined,
  path: string,
): {
  readonly config?: GoogleSpeechToTextAddonConfig;
  readonly issues: readonly ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const config: Readonly<Record<string, unknown>> = value ?? {};
  const allowedKeys = new Set([
    "audioPathTemplate",
    "gcsUriTemplate",
    "languageCodeTemplate",
    "alternativeLanguageCodes",
    "encoding",
    "sampleRateHertz",
    "audioChannelCount",
    "model",
    "useEnhanced",
    "enableAutomaticPunctuation",
    "enableWordTimeOffsets",
    "enableWordConfidence",
    "profanityFilter",
    "maxAlternatives",
    "recognitionMode",
    "outputFormats",
    "outputBaseNameTemplate",
  ]);

  for (const key of Object.keys(config)) {
    if (!allowedKeys.has(key)) {
      issues.push(makeIssue(`${path}.${key}`, "is not supported"));
    }
  }

  const audioPathTemplate = readOptionalStringConfig(
    config,
    "audioPathTemplate",
    path,
    issues,
  );
  const gcsUriTemplate = readOptionalStringConfig(
    config,
    "gcsUriTemplate",
    path,
    issues,
  );
  if (
    (audioPathTemplate === undefined && gcsUriTemplate === undefined) ||
    (audioPathTemplate !== undefined && gcsUriTemplate !== undefined)
  ) {
    issues.push(
      makeIssue(
        `${path}.audioPathTemplate`,
        "exactly one of audioPathTemplate or gcsUriTemplate must be provided",
      ),
    );
  }

  const languageCodeTemplate = readRequiredStringConfig(
    config,
    "languageCodeTemplate",
    path,
    issues,
  );
  const alternativeLanguageCodes = normalizeAlternativeLanguageCodes(
    config["alternativeLanguageCodes"],
    `${path}.alternativeLanguageCodes`,
    issues,
  );
  const encoding = readOptionalStringConfig(config, "encoding", path, issues);
  const model = readOptionalStringConfig(config, "model", path, issues);
  const outputBaseNameTemplate = readOptionalStringConfig(
    config,
    "outputBaseNameTemplate",
    path,
    issues,
  );
  const sampleRateHertz = readOptionalPositiveIntegerConfig(
    config,
    "sampleRateHertz",
    path,
    issues,
  );
  const audioChannelCount = readOptionalPositiveIntegerConfig(
    config,
    "audioChannelCount",
    path,
    issues,
  );
  const maxAlternatives = readOptionalPositiveIntegerConfig(
    config,
    "maxAlternatives",
    path,
    issues,
  );
  const useEnhanced = readOptionalBooleanConfig(
    config,
    "useEnhanced",
    path,
    issues,
  );
  const enableAutomaticPunctuation = readOptionalBooleanConfig(
    config,
    "enableAutomaticPunctuation",
    path,
    issues,
  );
  const enableWordTimeOffsets = readOptionalBooleanConfig(
    config,
    "enableWordTimeOffsets",
    path,
    issues,
  );
  const enableWordConfidence = readOptionalBooleanConfig(
    config,
    "enableWordConfidence",
    path,
    issues,
  );
  const profanityFilter = readOptionalBooleanConfig(
    config,
    "profanityFilter",
    path,
    issues,
  );
  const recognitionMode = normalizeRecognitionMode(
    config["recognitionMode"],
    `${path}.recognitionMode`,
    issues,
  );
  const outputFormats = normalizeOutputFormats(
    config["outputFormats"],
    `${path}.outputFormats`,
    issues,
  );

  if (issues.length > 0 || languageCodeTemplate === undefined) {
    return { issues };
  }

  return {
    config: {
      ...(audioPathTemplate === undefined ? {} : { audioPathTemplate }),
      ...(gcsUriTemplate === undefined ? {} : { gcsUriTemplate }),
      languageCodeTemplate,
      ...(alternativeLanguageCodes === undefined
        ? {}
        : { alternativeLanguageCodes }),
      ...(encoding === undefined ? {} : { encoding }),
      ...(sampleRateHertz === undefined ? {} : { sampleRateHertz }),
      ...(audioChannelCount === undefined ? {} : { audioChannelCount }),
      ...(model === undefined ? {} : { model }),
      ...(useEnhanced === undefined ? {} : { useEnhanced }),
      ...(enableAutomaticPunctuation === undefined
        ? {}
        : { enableAutomaticPunctuation }),
      ...(enableWordTimeOffsets === undefined ? {} : { enableWordTimeOffsets }),
      ...(enableWordConfidence === undefined ? {} : { enableWordConfidence }),
      ...(profanityFilter === undefined ? {} : { profanityFilter }),
      ...(maxAlternatives === undefined ? {} : { maxAlternatives }),
      ...(recognitionMode === undefined ? {} : { recognitionMode }),
      ...(outputFormats === undefined ? {} : { outputFormats }),
      ...(outputBaseNameTemplate === undefined
        ? {}
        : { outputBaseNameTemplate }),
    },
    issues,
  };
}

export function resolveGoogleSpeechToTextPayload(input: {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
}): {
  readonly payload?: NodePayload;
  readonly issues: readonly ValidationIssue[];
} {
  if (input.addon.name !== GOOGLE_SPEECH_TO_TEXT_ADDON_NAME) {
    return { issues: [] };
  }

  const version =
    input.addon.version ?? GOOGLE_SPEECH_TO_TEXT_ADDON_VERSION;
  if (version !== GOOGLE_SPEECH_TO_TEXT_ADDON_VERSION) {
    return {
      issues: [
        makeIssue(
          `${input.path}.version`,
          `unsupported version '${version}' for ${GOOGLE_SPEECH_TO_TEXT_ADDON_NAME}`,
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
  if (input.addon.env !== undefined && !isRecord(input.addon.env)) {
    return {
      issues: [makeIssue(`${input.path}.env`, "must be an object")],
    };
  }
  const normalizedEnv = normalizeGoogleSpeechEnv(
    input.addon.env,
    `${input.path}.env`,
  );
  if (normalizedEnv.issues.length > 0) {
    return { issues: normalizedEnv.issues };
  }

  const normalized = normalizeGoogleSpeechToTextConfig(
    input.addon.config,
    `${input.path}.config`,
  );
  if (normalized.config === undefined) {
    return { issues: normalized.issues };
  }

  const addon: ResolvedGoogleSpeechToTextAddon = {
    name: GOOGLE_SPEECH_TO_TEXT_ADDON_NAME,
    version: GOOGLE_SPEECH_TO_TEXT_ADDON_VERSION,
    config: normalized.config,
    ...(normalizedEnv.env === undefined ? {} : { env: normalizedEnv.env }),
    ...(input.addon.inputs === undefined ? {} : { inputs: input.addon.inputs }),
  };

  return {
    payload: {
      id: input.nodeId,
      description:
        "Built-in worker that transcribes audio with Google Cloud Speech-to-Text and writes JSON/SRT/VTT artifacts.",
      nodeType: "addon",
      variables: input.addon.inputs ?? {},
      addon,
      output: GOOGLE_SPEECH_TO_TEXT_OUTPUT,
    },
    issues: [],
  };
}
