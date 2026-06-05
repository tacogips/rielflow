import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  AdapterExecutionError,
  type AdapterExecutionOutput,
  renderPromptTemplate,
  resolveNodeExecutionWorkingDirectory,
} from "../../../rielflow-core/src/index";
import type { ResolvedMp4AudioExtractAddon } from "../../../rielflow-core/src/index";
import type {
  NativeNodeExecutionContext,
  NativeNodeExecutionInput,
} from "./template-env-and-containers";
import {
  buildNativeOutput,
  buildProcessLogAttachments,
  mergeProcessLogsIntoAdapterError,
  resolveTemplateVariables,
  runLoggedSpawnedProcess,
} from "./template-env-and-containers";

const MP4_AUDIO_EXTRACT_AUDIO_ARTIFACT_PATH = "audio/extracted.flac";

export async function executeMp4AudioExtractAddonNode(
  input: NativeNodeExecutionInput,
  addon: ResolvedMp4AudioExtractAddon,
  context: NativeNodeExecutionContext,
): Promise<AdapterExecutionOutput> {
  const workingDirectory = resolveNodeExecutionWorkingDirectory(
    input.workflowWorkingDirectory,
    input.node.workingDirectory,
  );
  const renderedMp4Path = renderMp4PathTemplate({
    input,
    addon,
  });
  const mp4Path = path.isAbsolute(renderedMp4Path)
    ? renderedMp4Path
    : path.join(workingDirectory, renderedMp4Path);
  const audioArtifactPath = path.join(
    input.artifactDir,
    MP4_AUDIO_EXTRACT_AUDIO_ARTIFACT_PATH,
  );
  await mkdir(path.dirname(audioArtifactPath), { recursive: true });

  const ffmpegPath = normalizeExecutablePath({
    value: addon.config.ffmpegPath ?? "ffmpeg",
    nodeId: input.nodeId,
    fieldName: "ffmpegPath",
  });
  const ffmpegArgs = buildFfmpegArgs({
    mp4Path,
    audioArtifactPath,
    audioChannelCount: addon.config.audioChannelCount,
    sampleRateHertz: addon.config.sampleRateHertz,
  });
  const ffmpegResult = await runLoggedSpawnedProcess({
    command: ffmpegPath,
    args: ffmpegArgs,
    cwd: workingDirectory,
    env: buildFfmpegEnv(input.env),
    context,
    artifactDir: input.artifactDir,
    logPrefix: "ffmpeg-audio-extract",
  });
  const processLogs = buildProcessLogAttachments(
    ffmpegResult,
    "ffmpeg-audio-extract",
  );

  try {
    return buildNativeOutput({
      provider: "native-addon:mp4-audio-extract",
      model: `${addon.name}@${addon.version}`,
      promptText: addon.config.mp4PathTemplate,
      payload: buildAudioExtractPayload({
        addon,
        audioArtifactPath,
        sourceFileName: path.basename(mp4Path),
      }),
      processLogs,
    });
  } catch (error: unknown) {
    throw mergeProcessLogsIntoAdapterError(error, processLogs);
  }
}

function buildFfmpegEnv(
  ambientEnv: Readonly<Record<string, string | undefined>> | undefined,
): NodeJS.ProcessEnv {
  return {
    PATH: ambientEnv?.["PATH"] ?? process.env["PATH"] ?? "/usr/bin:/bin",
    HOME: ambientEnv?.["HOME"] ?? process.env["HOME"] ?? "/tmp",
    LANG: ambientEnv?.["LANG"] ?? process.env["LANG"] ?? "C.UTF-8",
  };
}

function renderMp4PathTemplate(input: {
  readonly input: NativeNodeExecutionInput;
  readonly addon: ResolvedMp4AudioExtractAddon;
}): string {
  const rendered = renderPromptTemplate(
    input.addon.config.mp4PathTemplate,
    resolveTemplateVariables(input.input),
  ).trim();
  if (rendered.length === 0) {
    throw new AdapterExecutionError(
      "invalid_output",
      `node '${input.input.nodeId}' rendered an empty MP4 path`,
    );
  }
  if (/[\0\r\n\t]/.test(rendered)) {
    throw new AdapterExecutionError(
      "policy_blocked",
      `node '${input.input.nodeId}' refused MP4 path containing control characters`,
    );
  }
  return rendered;
}

function normalizeExecutablePath(input: {
  readonly value: string;
  readonly nodeId: string;
  readonly fieldName: string;
}): string {
  const trimmed = input.value.trim();
  if (trimmed.length === 0 || /[\0\r\n\t]/.test(trimmed)) {
    throw new AdapterExecutionError(
      "policy_blocked",
      `node '${input.nodeId}' refused invalid ${input.fieldName}`,
    );
  }
  return trimmed;
}

function buildFfmpegArgs(input: {
  readonly mp4Path: string;
  readonly audioArtifactPath: string;
  readonly audioChannelCount: number | undefined;
  readonly sampleRateHertz: number | undefined;
}): readonly string[] {
  const args = [
    "-y",
    "-i",
    input.mp4Path,
    "-vn",
    "-acodec",
    "flac",
    "-ac",
    String(input.audioChannelCount ?? 1),
  ];
  if (input.sampleRateHertz !== undefined) {
    args.push("-ar", String(input.sampleRateHertz));
  }
  args.push(input.audioArtifactPath);
  return args;
}

function buildAudioExtractPayload(input: {
  readonly addon: ResolvedMp4AudioExtractAddon;
  readonly audioArtifactPath: string;
  readonly sourceFileName: string;
}): Readonly<Record<string, unknown>> {
  return {
    audioExtract: {
      audioPath: input.audioArtifactPath,
      metadata: {
        provider: "ffmpeg",
        sourceFileName: input.sourceFileName,
        audioArtifactPath: MP4_AUDIO_EXTRACT_AUDIO_ARTIFACT_PATH,
        ...(input.addon.config.sampleRateHertz === undefined
          ? {}
          : { sampleRateHertz: input.addon.config.sampleRateHertz }),
        ...(input.addon.config.audioChannelCount === undefined
          ? {}
          : { audioChannelCount: input.addon.config.audioChannelCount }),
      },
    },
  };
}
