import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { v1 as speech } from "@google-cloud/speech";
import {
  AdapterExecutionError,
  type AdapterExecutionOutput,
  atomicWriteTextFile,
  renderPromptTemplate,
  resolveNodeExecutionWorkingDirectory,
} from "../../../rielflow-core/src/index";
import type {
  GoogleSpeechToTextAddonConfig,
  GoogleSpeechToTextOutputFormat,
  ResolvedGoogleSpeechToTextAddon,
} from "../../../rielflow-core/src/index";
import { resolveAddonEnv } from "./chat-and-gateway-addons";
import {
  buildNativeOutput,
  resolveTemplateVariables,
  type NativeNodeExecutionContext,
  type NativeNodeExecutionInput,
} from "./template-env-and-containers";

export interface GoogleDurationLike {
  readonly seconds?: unknown;
  readonly nanos?: unknown;
}

export interface GoogleSpeechWordLike {
  readonly word?: string | null;
  readonly startTime?: GoogleDurationLike | null;
  readonly endTime?: GoogleDurationLike | null;
  readonly confidence?: number | null;
}

export interface GoogleSpeechAlternativeLike {
  readonly transcript?: string | null;
  readonly confidence?: number | null;
  readonly words?: readonly GoogleSpeechWordLike[] | null;
}

export interface GoogleSpeechResultLike {
  readonly alternatives?: readonly GoogleSpeechAlternativeLike[] | null;
  readonly languageCode?: string | null;
}

export interface GoogleSpeechRecognizeResponseLike {
  readonly results?: readonly GoogleSpeechResultLike[] | null;
}

export interface GoogleSpeechOperationLike {
  promise(): Promise<readonly [GoogleSpeechRecognizeResponseLike]>;
}

export interface GoogleSpeechRecognizeRequestLike {
  readonly config: Readonly<Record<string, unknown>>;
  readonly audio: Readonly<Record<string, unknown>>;
}

export interface GoogleSpeechClientLike {
  recognize(
    request: GoogleSpeechRecognizeRequestLike,
  ): Promise<readonly [GoogleSpeechRecognizeResponseLike]>;
  longRunningRecognize(
    request: GoogleSpeechRecognizeRequestLike,
  ): Promise<readonly [GoogleSpeechOperationLike]>;
}

type GoogleSpeechClientOptions = ConstructorParameters<
  typeof speech.SpeechClient
>[0];

type GoogleSpeechClientFactory = (
  options: GoogleSpeechClientOptions,
) => GoogleSpeechClientLike;

interface GoogleServiceAccountCredentials {
  readonly client_email?: string;
  readonly private_key?: string;
  readonly project_id?: string;
  readonly [key: string]: unknown;
}

export interface SubtitleSegment {
  readonly index: number;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly text: string;
  readonly confidence?: number;
  readonly languageCode?: string;
  readonly words: readonly {
    readonly word: string;
    readonly startSeconds?: number;
    readonly endSeconds?: number;
    readonly confidence?: number;
  }[];
}

export interface NormalizedGoogleSpeechResponse {
  readonly transcript: string;
  readonly segments: readonly SubtitleSegment[];
}

function parseNumberLike(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "toString" in value &&
    typeof value.toString === "function"
  ) {
    const parsed = Number(value.toString());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function durationToSeconds(
  duration: GoogleDurationLike | null | undefined,
): number | undefined {
  if (duration === undefined || duration === null) {
    return undefined;
  }
  const seconds = parseNumberLike(duration.seconds) ?? 0;
  const nanos = parseNumberLike(duration.nanos) ?? 0;
  return seconds + nanos / 1_000_000_000;
}

function buildSegmentFromAlternative(input: {
  readonly index: number;
  readonly alternative: GoogleSpeechAlternativeLike;
  readonly languageCode?: string;
  readonly fallbackStartSeconds: number;
}): SubtitleSegment | undefined {
  const transcript = input.alternative.transcript?.trim();
  if (transcript === undefined || transcript.length === 0) {
    return undefined;
  }
  const words = (input.alternative.words ?? [])
    .map((word) => {
      const text = word.word?.trim();
      if (text === undefined || text.length === 0) {
        return undefined;
      }
      const startSeconds = durationToSeconds(word.startTime);
      const endSeconds = durationToSeconds(word.endTime);
      return {
        word: text,
        ...(startSeconds === undefined ? {} : { startSeconds }),
        ...(endSeconds === undefined ? {} : { endSeconds }),
        ...(typeof word.confidence === "number"
          ? { confidence: word.confidence }
          : {}),
      };
    })
    .filter((word): word is NonNullable<typeof word> => word !== undefined);

  const firstWord = words[0];
  const lastWord = words[words.length - 1];
  const startSeconds =
    firstWord?.startSeconds ?? input.fallbackStartSeconds;
  const endSeconds =
    lastWord?.endSeconds ?? Math.max(startSeconds + 2, input.fallbackStartSeconds + 2);

  return {
    index: input.index,
    startSeconds,
    endSeconds: endSeconds <= startSeconds ? startSeconds + 0.5 : endSeconds,
    text: transcript,
    ...(typeof input.alternative.confidence === "number"
      ? { confidence: input.alternative.confidence }
      : {}),
    ...(input.languageCode === undefined ? {} : { languageCode: input.languageCode }),
    words,
  };
}

export function normalizeGoogleSpeechResponse(
  response: GoogleSpeechRecognizeResponseLike,
): NormalizedGoogleSpeechResponse {
  const segments: SubtitleSegment[] = [];
  let fallbackStartSeconds = 0;
  for (const result of response.results ?? []) {
    const alternative = result.alternatives?.[0];
    if (alternative === undefined) {
      continue;
    }
    const segment = buildSegmentFromAlternative({
      index: segments.length + 1,
      alternative,
      ...(result.languageCode === undefined || result.languageCode === null
        ? {}
        : { languageCode: result.languageCode }),
      fallbackStartSeconds,
    });
    if (segment === undefined) {
      continue;
    }
    segments.push(segment);
    fallbackStartSeconds = segment.endSeconds;
  }
  return {
    transcript: segments.map((segment) => segment.text).join("\n"),
    segments,
  };
}

function formatSrtTime(seconds: number): string {
  const boundedSeconds = Math.max(0, seconds);
  const millisecondsTotal = Math.round(boundedSeconds * 1000);
  const milliseconds = millisecondsTotal % 1000;
  const totalSeconds = Math.floor(millisecondsTotal / 1000);
  const displaySeconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(displaySeconds).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
}

function formatVttTime(seconds: number): string {
  return formatSrtTime(seconds).replace(",", ".");
}

export function renderSrt(segments: readonly SubtitleSegment[]): string {
  return `${segments
    .map((segment, index) =>
      [
        String(index + 1),
        `${formatSrtTime(segment.startSeconds)} --> ${formatSrtTime(segment.endSeconds)}`,
        segment.text,
      ].join("\n"),
    )
    .join("\n\n")}\n`;
}

export function renderVtt(segments: readonly SubtitleSegment[]): string {
  return `WEBVTT\n\n${segments
    .map((segment) =>
      [
        `${formatVttTime(segment.startSeconds)} --> ${formatVttTime(segment.endSeconds)}`,
        segment.text,
      ].join("\n"),
    )
    .join("\n\n")}\n`;
}

function resolveOutputFormats(
  config: GoogleSpeechToTextAddonConfig,
): readonly GoogleSpeechToTextOutputFormat[] {
  return config.outputFormats ?? ["json", "srt", "vtt"];
}

function sanitizeArtifactBaseName(value: string): string {
  const baseName = path.basename(value.trim()).replace(/[^A-Za-z0-9._-]/g, "-");
  return baseName.length === 0 ? "google-speech-to-text" : baseName;
}

function buildRecognitionConfig(input: {
  readonly config: GoogleSpeechToTextAddonConfig;
  readonly languageCode: string;
  readonly outputFormats: readonly GoogleSpeechToTextOutputFormat[];
}): Readonly<Record<string, unknown>> {
  const wantsSubtitles =
    input.outputFormats.includes("srt") || input.outputFormats.includes("vtt");
  return {
    languageCode: input.languageCode,
    ...(input.config.alternativeLanguageCodes === undefined
      ? {}
      : { alternativeLanguageCodes: input.config.alternativeLanguageCodes }),
    ...(input.config.encoding === undefined ? {} : { encoding: input.config.encoding }),
    ...(input.config.sampleRateHertz === undefined
      ? {}
      : { sampleRateHertz: input.config.sampleRateHertz }),
    ...(input.config.audioChannelCount === undefined
      ? {}
      : { audioChannelCount: input.config.audioChannelCount }),
    ...(input.config.model === undefined ? {} : { model: input.config.model }),
    enableAutomaticPunctuation:
      input.config.enableAutomaticPunctuation ?? true,
    enableWordTimeOffsets:
      input.config.enableWordTimeOffsets ?? wantsSubtitles,
    ...(input.config.enableWordConfidence === undefined
      ? {}
      : { enableWordConfidence: input.config.enableWordConfidence }),
    ...(input.config.useEnhanced === undefined
      ? {}
      : { useEnhanced: input.config.useEnhanced }),
    ...(input.config.profanityFilter === undefined
      ? {}
      : { profanityFilter: input.config.profanityFilter }),
    ...(input.config.maxAlternatives === undefined
      ? {}
      : { maxAlternatives: input.config.maxAlternatives }),
  };
}

async function buildAudioRequest(input: {
  readonly renderedAudioPath?: string;
  readonly renderedGcsUri?: string;
  readonly cwd: string;
  readonly nodeId: string;
}): Promise<Readonly<Record<string, unknown>>> {
  if (input.renderedGcsUri !== undefined) {
    if (!input.renderedGcsUri.startsWith("gs://")) {
      throw new AdapterExecutionError(
        "invalid_output",
        `node '${input.nodeId}' rendered gcsUriTemplate that does not start with gs://`,
      );
    }
    return { uri: input.renderedGcsUri };
  }
  if (input.renderedAudioPath === undefined) {
    throw new AdapterExecutionError(
      "invalid_output",
      `node '${input.nodeId}' did not render a Google Speech-to-Text audio source`,
    );
  }
  if (/[\0\r\n]/.test(input.renderedAudioPath)) {
    throw new AdapterExecutionError(
      "policy_blocked",
      `node '${input.nodeId}' refused audioPathTemplate containing control characters`,
    );
  }
  const audioPath = path.isAbsolute(input.renderedAudioPath)
    ? input.renderedAudioPath
    : path.resolve(input.cwd, input.renderedAudioPath);
  const content = await readFile(audioPath);
  return { content: content.toString("base64") };
}

function messageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeGoogleSpeechErrorMessage(
  message: string,
  sensitiveValues: readonly string[] = [],
): string {
  const privateKeyLabel = `PRIVATE ${"KEY"}`;
  const privateKeyBlockPattern = new RegExp(
    `-----BEGIN ${privateKeyLabel}-----[\\s\\S]*?-----END ${privateKeyLabel}-----`,
    "g",
  );
  let sanitized = message
    .replace(privateKeyBlockPattern, "[redacted-private-key]")
    .replace(/("private_key"\s*:\s*)"[^"]*"/gi, "$1\"[redacted]\"")
    .replace(/("client_email"\s*:\s*)"[^"]*"/gi, "$1\"[redacted]\"")
    .replace(
      /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi,
      "[redacted-email]",
    )
    .replace(
      /(GOOGLE_APPLICATION_CREDENTIALS(?:_JSON)?[^\s:=]*\s*[:=]\s*)[^\s]+/gi,
      "$1[redacted]",
    )
    .replace(
      /(?:[A-Za-z]:)?\/(?:[^\s"'`]+\/)*[^\s"'`]*(?:credential|credentials|service-account|service_account|google|gcp)[^\s"'`]*\.json/gi,
      "[redacted-credential-path]",
    );

  for (const value of sensitiveValues) {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      continue;
    }
    sanitized = sanitized.replace(
      new RegExp(escapeRegExp(trimmed), "g"),
      "[redacted]",
    );
  }
  return sanitized;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildGoogleSpeechClientOptions(input: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly nodeId: string;
}): GoogleSpeechClientOptions {
  const keyFilename = input.env["GOOGLE_APPLICATION_CREDENTIALS"];
  if (keyFilename !== undefined && keyFilename.length > 0) {
    return { keyFilename };
  }

  const credentialsJson = input.env["GOOGLE_APPLICATION_CREDENTIALS_JSON"];
  if (credentialsJson === undefined || credentialsJson.length === 0) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(credentialsJson);
  } catch {
    throw new AdapterExecutionError(
      "invalid_output",
      `node '${input.nodeId}' GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON`,
    );
  }
  if (!isRecord(parsed)) {
    throw new AdapterExecutionError(
      "invalid_output",
      `node '${input.nodeId}' GOOGLE_APPLICATION_CREDENTIALS_JSON must be a JSON object`,
    );
  }
  const credentials = parsed as GoogleServiceAccountCredentials;
  const options: GoogleSpeechClientOptions = { credentials };
  if (typeof credentials.project_id === "string" && credentials.project_id.length > 0) {
    return { ...options, projectId: credentials.project_id };
  }
  return options;
}

async function recognizeWithClient(input: {
  readonly client: GoogleSpeechClientLike;
  readonly request: GoogleSpeechRecognizeRequestLike;
  readonly recognitionMode: "sync" | "long-running";
  readonly context: NativeNodeExecutionContext;
  readonly nodeId: string;
  readonly sensitiveValues: readonly string[];
}): Promise<GoogleSpeechRecognizeResponseLike> {
  if (input.context.signal.aborted) {
    throw new AdapterExecutionError("timeout", "native node execution timed out");
  }
  try {
    if (input.recognitionMode === "long-running") {
      const [operation] = await input.client.longRunningRecognize(input.request);
      const [response] = await operation.promise();
      return response;
    }
    const [response] = await input.client.recognize(input.request);
    return response;
  } catch (error: unknown) {
    throw new AdapterExecutionError(
      "provider_error",
      `node '${input.nodeId}' Google Speech-to-Text request failed: ${sanitizeGoogleSpeechErrorMessage(messageFromUnknown(error), input.sensitiveValues)}`,
    );
  }
}

async function writeOutputFiles(input: {
  readonly artifactDir: string;
  readonly baseName: string;
  readonly outputFormats: readonly GoogleSpeechToTextOutputFormat[];
  readonly normalized: NormalizedGoogleSpeechResponse;
  readonly response: GoogleSpeechRecognizeResponseLike;
  readonly languageCode: string;
  readonly recognitionMode: "sync" | "long-running";
}): Promise<{
  readonly outputFiles: Readonly<Record<string, string>>;
  readonly captions: Readonly<Record<string, string>>;
}> {
  await mkdir(input.artifactDir, { recursive: true });
  const outputFiles: Record<string, string> = {};
  const captions: Record<string, string> = {};
  if (input.outputFormats.includes("json")) {
    const jsonPath = path.join(input.artifactDir, `${input.baseName}.json`);
    await atomicWriteTextFile(
      jsonPath,
      `${JSON.stringify(
        {
          transcript: input.normalized.transcript,
          languageCode: input.languageCode,
          recognitionMode: input.recognitionMode,
          segments: input.normalized.segments,
          rawResponse: input.response,
        },
        null,
        2,
      )}\n`,
    );
    outputFiles["json"] = jsonPath;
  }
  if (input.outputFormats.includes("srt")) {
    const srt = renderSrt(input.normalized.segments);
    const srtPath = path.join(input.artifactDir, `${input.baseName}.srt`);
    await atomicWriteTextFile(srtPath, srt);
    outputFiles["srt"] = srtPath;
    captions["srt"] = srt;
  }
  if (input.outputFormats.includes("vtt")) {
    const vtt = renderVtt(input.normalized.segments);
    const vttPath = path.join(input.artifactDir, `${input.baseName}.vtt`);
    await atomicWriteTextFile(vttPath, vtt);
    outputFiles["vtt"] = vttPath;
    captions["vtt"] = vtt;
  }
  return { outputFiles, captions };
}

const GOOGLE_SPEECH_CREDENTIAL_ENV_KEYS = [
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_APPLICATION_CREDENTIALS_JSON",
] as const;

function selectGoogleSpeechCredentialEnv(
  sourceEnv?: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
  if (sourceEnv === undefined) {
    return {};
  }
  const env: Record<string, string> = {};
  for (const key of GOOGLE_SPEECH_CREDENTIAL_ENV_KEYS) {
    const value = sourceEnv[key];
    if (value !== undefined && value.length > 0) {
      env[key] = value;
    }
  }
  return env;
}

function resolveGoogleSpeechEnv(input: {
  readonly addon: ResolvedGoogleSpeechToTextAddon;
  readonly nodeId: string;
  readonly sourceEnv?: Readonly<Record<string, string | undefined>>;
}): Readonly<Record<string, string>> {
  if (input.addon.env === undefined) {
    return selectGoogleSpeechCredentialEnv(input.sourceEnv);
  }
  return resolveAddonEnv({
    addonName: input.addon.name,
    nodeId: input.nodeId,
    bindings: input.addon.env,
    ...(input.sourceEnv === undefined ? {} : { sourceEnv: input.sourceEnv }),
  });
}

export async function executeGoogleSpeechToTextAddonNodeWithClient(
  input: NativeNodeExecutionInput,
  addon: ResolvedGoogleSpeechToTextAddon,
  context: NativeNodeExecutionContext,
  client: GoogleSpeechClientLike,
  options: {
    readonly sensitiveValues?: readonly string[];
  } = {},
): Promise<AdapterExecutionOutput> {
  const variables = resolveTemplateVariables(input);
  const outputFormats = resolveOutputFormats(addon.config);
  const cwd = resolveNodeExecutionWorkingDirectory(
    input.workflowWorkingDirectory,
    input.node.workingDirectory,
  );
  const languageCode = renderPromptTemplate(
    addon.config.languageCodeTemplate,
    variables,
  ).trim();
  if (languageCode.length === 0) {
    throw new AdapterExecutionError(
      "invalid_output",
      `node '${input.nodeId}' rendered an empty Google Speech-to-Text languageCodeTemplate`,
    );
  }
  const renderedAudioPath =
    addon.config.audioPathTemplate === undefined
      ? undefined
      : renderPromptTemplate(addon.config.audioPathTemplate, variables).trim();
  const renderedGcsUri =
    addon.config.gcsUriTemplate === undefined
      ? undefined
      : renderPromptTemplate(addon.config.gcsUriTemplate, variables).trim();
  const recognitionMode =
    addon.config.recognitionMode ??
    (renderedGcsUri === undefined ? "sync" : "long-running");
  const request: GoogleSpeechRecognizeRequestLike = {
    config: buildRecognitionConfig({
      config: addon.config,
      languageCode,
      outputFormats,
    }),
    audio: await buildAudioRequest({
      ...(renderedAudioPath === undefined ? {} : { renderedAudioPath }),
      ...(renderedGcsUri === undefined ? {} : { renderedGcsUri }),
      cwd,
      nodeId: input.nodeId,
    }),
  };
  const response = await recognizeWithClient({
    client,
    request,
    recognitionMode,
    context,
    nodeId: input.nodeId,
    sensitiveValues: options.sensitiveValues ?? [],
  });
  const normalized = normalizeGoogleSpeechResponse(response);
  const outputBaseName = sanitizeArtifactBaseName(
    renderPromptTemplate(
      addon.config.outputBaseNameTemplate ?? input.nodeId,
      variables,
    ),
  );
  const files = await writeOutputFiles({
    artifactDir: input.artifactDir,
    baseName: outputBaseName,
    outputFormats,
    normalized,
    response,
    languageCode,
    recognitionMode,
  });

  return buildNativeOutput({
    provider: "native-addon:google-speech-to-text",
    model: `${addon.name}@${addon.version}`,
    promptText: renderedAudioPath ?? renderedGcsUri ?? languageCode,
    payload: {
      googleSpeechToText: {
        transcript: normalized.transcript,
        languageCode,
        ...(addon.config.alternativeLanguageCodes === undefined
          ? {}
          : { alternativeLanguageCodes: addon.config.alternativeLanguageCodes }),
        recognitionMode,
        segments: normalized.segments,
        outputFiles: files.outputFiles,
        captions: files.captions,
      },
      transcript: normalized.transcript,
      outputFiles: files.outputFiles,
      captions: files.captions,
    },
  });
}

function googleSpeechCredentialSensitiveValues(
  ...envs: readonly Readonly<Record<string, string | undefined>>[]
): readonly string[] {
  const values: string[] = [];
  for (const env of envs) {
    for (const key of GOOGLE_SPEECH_CREDENTIAL_ENV_KEYS) {
      const value = env[key];
      if (value !== undefined && value.length > 0) {
        values.push(value);
      }
    }
  }
  return [...new Set(values)];
}

export async function executeGoogleSpeechToTextAddonNode(
  input: NativeNodeExecutionInput,
  addon: ResolvedGoogleSpeechToTextAddon,
  context: NativeNodeExecutionContext,
  createClient: GoogleSpeechClientFactory = (clientOptions) =>
    new speech.SpeechClient(clientOptions) as unknown as GoogleSpeechClientLike,
): Promise<AdapterExecutionOutput> {
  const sourceCredentialEnv = selectGoogleSpeechCredentialEnv(input.env);
  const mappedEnv = resolveGoogleSpeechEnv({
    addon,
    nodeId: input.nodeId,
    ...(input.env === undefined ? {} : { sourceEnv: input.env }),
  });
  const sensitiveValues = googleSpeechCredentialSensitiveValues(
    mappedEnv,
    sourceCredentialEnv,
  );
  const clientOptions = buildGoogleSpeechClientOptions({
    env: mappedEnv,
    nodeId: input.nodeId,
  });
  let client: GoogleSpeechClientLike;
  try {
    client = createClient(clientOptions);
  } catch (error: unknown) {
    throw new AdapterExecutionError(
      "provider_error",
      `node '${input.nodeId}' Google Speech-to-Text client initialization failed: ${sanitizeGoogleSpeechErrorMessage(messageFromUnknown(error), sensitiveValues)}`,
    );
  }
  return await executeGoogleSpeechToTextAddonNodeWithClient(
    input,
    addon,
    context,
    client,
    { sensitiveValues },
  );
}
