import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { executeNativeNode } from "./native-node-executor";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "rielflow-mp4-audio-extract-test-"),
  );
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function makeExecutionMailbox() {
  return {
    meta: {
      protocolVersion: 1,
      mailboxDirEnvVar: "RIEL_MAILBOX_DIR",
      node: {
        workflowId: "wf",
        workflowDescription: "demo workflow",
        nodeId: "extract-audio",
        nodeKind: "task",
      },
      objective: {
        reason: "Extract MP4 audio.",
        expectedReturn: "Return JSON.",
        instruction: "extract audio",
      },
      paths: {
        inputPath: "inbox/input.json",
        inputFilesDir: "inbox/files",
        outputPath: "outbox/output.json",
        outputFilesDir: "outbox/files",
      },
      input: {
        kind: "json",
        upstreamSources: [],
      },
      output: {
        kind: "json",
        required: true,
        path: "outbox/output.json",
        filesDirectory: "outbox/files",
      },
    },
    input: {
      arguments: {},
      upstream: [],
    },
  } as const;
}

describe("executeNativeNode MP4 audio extract add-on", () => {
  test("extracts audio with ffmpeg argv and writes an audio artifact", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    const artifactDir = path.join(workflowDirectory, "artifacts", "mp4");
    const videoPath = path.join(workflowWorkingDirectory, "meeting.mp4");
    const ffmpegPath = path.join(workflowDirectory, "fake-ffmpeg.sh");
    const capturedArgsPath = path.join(workflowDirectory, "ffmpeg-args.txt");
    const capturedEnvPath = path.join(workflowDirectory, "ffmpeg-env.txt");
    await mkdir(workflowWorkingDirectory, { recursive: true });
    await writeFile(videoPath, "fake mp4", "utf8");
    await writeFile(
      ffmpegPath,
      [
        "#!/bin/sh",
        "set -eu",
        `printf "%s\\n" "$@" > ${JSON.stringify(capturedArgsPath)}`,
        `env | sort > ${JSON.stringify(capturedEnvPath)}`,
        "for last do :; done",
        'mkdir -p "$(dirname "$last")"',
        'printf "fake flac" > "$last"',
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o755 },
    );

    const output = await executeNativeNode(
      {
        workflowDirectory,
        workflowWorkingDirectory,
        artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
        workflowId: "wf",
        workflowDescription: "demo workflow",
        workflowExecutionId: "sess-1",
        nodeId: "extract-audio",
        nodeExecId: "exec-1",
        node: {
          id: "extract-audio",
          nodeType: "addon",
          variables: {
            videoPath: "meeting.mp4",
          },
          addon: {
            name: "rielflow/mp4-audio-extract",
            version: "1",
            config: {
              mp4PathTemplate: "{{videoPath}}",
              ffmpegPath,
              sampleRateHertz: 16000,
              audioChannelCount: 1,
            },
          },
        },
        workflowDefaults: {
          maxLoopIterations: 3,
          nodeTimeoutMs: 120000,
        },
        runtimeVariables: {},
        mergedVariables: {},
        arguments: {},
        artifactDir,
        executionMailbox: makeExecutionMailbox(),
        env: {
          SHOULD_NOT_REACH_FFMPEG: "ambient-only-value",
        },
      },
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
    );

    const audioArtifactPath = path.join(artifactDir, "audio/extracted.flac");
    expect(output.provider).toBe("native-addon:mp4-audio-extract");
    expect(output.payload).toEqual({
      audioExtract: {
        audioPath: audioArtifactPath,
        metadata: {
          provider: "ffmpeg",
          sourceFileName: "meeting.mp4",
          audioArtifactPath: "audio/extracted.flac",
          sampleRateHertz: 16000,
          audioChannelCount: 1,
        },
      },
    });
    await expect(stat(audioArtifactPath)).resolves.toMatchObject({ size: 9 });

    const capturedArgs = await readFile(capturedArgsPath, "utf8");
    expect(capturedArgs.split(/\r?\n/).filter(Boolean)).toEqual([
      "-y",
      "-i",
      videoPath,
      "-vn",
      "-acodec",
      "flac",
      "-ac",
      "1",
      "-ar",
      "16000",
      audioArtifactPath,
    ]);
    const capturedEnv = await readFile(capturedEnvPath, "utf8");
    expect(capturedEnv).not.toContain("SHOULD_NOT_REACH_FFMPEG");
    expect(JSON.stringify(output)).not.toContain("ambient-only-value");
  });

  test("fails before ffmpeg when the rendered MP4 path is empty", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    const artifactDir = path.join(workflowDirectory, "artifacts", "mp4");
    await mkdir(workflowWorkingDirectory, { recursive: true });

    await expect(
      executeNativeNode(
        {
          workflowDirectory,
          workflowWorkingDirectory,
          artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
          workflowId: "wf",
          workflowDescription: "demo workflow",
          workflowExecutionId: "sess-1",
          nodeId: "extract-audio",
          nodeExecId: "exec-1",
          node: {
            id: "extract-audio",
            nodeType: "addon",
            variables: {},
            addon: {
              name: "rielflow/mp4-audio-extract",
              version: "1",
              config: {
                mp4PathTemplate: "{{missingVideoPath}}",
              },
            },
          },
          workflowDefaults: {
            maxLoopIterations: 3,
            nodeTimeoutMs: 120000,
          },
          runtimeVariables: {},
          mergedVariables: {},
          arguments: {},
          artifactDir,
          executionMailbox: makeExecutionMailbox(),
          env: {},
        },
        {
          timeoutMs: 5_000,
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toThrow("rendered an empty MP4 path");
  });
});
