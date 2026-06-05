import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AdapterExecutionError } from "../../../rielflow-core/src/index";
import {
  buildGoogleSpeechClientOptions,
  executeGoogleSpeechToTextAddonNode,
  executeGoogleSpeechToTextAddonNodeWithClient,
  type GoogleSpeechClientLike,
  type GoogleSpeechRecognizeRequestLike,
  type GoogleSpeechRecognizeResponseLike,
} from "../../../rielflow-addons/src/native-node-executor/google-speech-to-text-addon";
import { resolveNodeAddonPayload } from "../../../rielflow-addons/src/node-addons/addon-payload-resolution";
import type { NativeNodeExecutionInput } from "../../../rielflow-addons/src/native-node-executor/template-env-and-containers";
import type { ResolvedGoogleSpeechToTextAddon } from "./addon-types";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "rielflow-google-stt-addon-test-"),
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
        workflowDescription: "speech workflow",
        nodeId: "speech",
        nodeKind: "task",
      },
      objective: {
        reason: "Transcribe audio.",
        expectedReturn: "Return transcription JSON and captions.",
        instruction: "transcribe",
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

function makeFakeClient(
  response: GoogleSpeechRecognizeResponseLike,
  requests: GoogleSpeechRecognizeRequestLike[],
  options: {
    readonly mode?: "sync" | "long-running";
    readonly error?: Error;
  } = {},
): GoogleSpeechClientLike {
  return {
    recognize: async (request) => {
      if (options.error !== undefined) {
        throw options.error;
      }
      if (options.mode === "long-running") {
        throw new Error("unexpected recognize call");
      }
      requests.push(request);
      return [response];
    },
    longRunningRecognize: async (request) => {
      if (options.error !== undefined) {
        throw options.error;
      }
      if (options.mode !== "long-running") {
        throw new Error("unexpected longRunningRecognize call");
      }
      requests.push(request);
      return [
        {
          promise: async () => [response],
        },
      ];
    },
  };
}

function makeResponse(input: {
  readonly transcript: string;
  readonly languageCode: string;
  readonly words: readonly {
    readonly word: string;
    readonly startSeconds: number;
    readonly endSeconds: number;
  }[];
}): GoogleSpeechRecognizeResponseLike {
  return {
    results: [
      {
        languageCode: input.languageCode,
        alternatives: [
          {
            transcript: input.transcript,
            confidence: 0.91,
            words: input.words.map((word) => ({
              word: word.word,
              startTime: {
                seconds: Math.floor(word.startSeconds),
                nanos: Math.round((word.startSeconds % 1) * 1_000_000_000),
              },
              endTime: {
                seconds: Math.floor(word.endSeconds),
                nanos: Math.round((word.endSeconds % 1) * 1_000_000_000),
              },
            })),
          },
        ],
      },
    ],
  };
}

async function runFixtureCase(input: {
  readonly workflowDirectory: string;
  readonly fixtureName: string;
  readonly languageCode: string;
  readonly alternativeLanguageCodes?: readonly string[];
  readonly response: GoogleSpeechRecognizeResponseLike;
}): Promise<{
  readonly payload: Readonly<Record<string, unknown>>;
  readonly request: GoogleSpeechRecognizeRequestLike;
}> {
  const audioDir = path.join(input.workflowDirectory, "audio");
  const artifactDir = path.join(input.workflowDirectory, "artifacts");
  await mkdir(audioDir, { recursive: true });
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    path.join(audioDir, `${input.fixtureName}.wav`),
    `fixture audio for ${input.fixtureName}\n`,
    "utf8",
  );
  const requests: GoogleSpeechRecognizeRequestLike[] = [];
  const addon: ResolvedGoogleSpeechToTextAddon = {
    name: "rielflow/google-speech-to-text",
    version: "1",
    config: {
      audioPathTemplate: `audio/${input.fixtureName}.wav`,
      languageCodeTemplate: input.languageCode,
      ...(input.alternativeLanguageCodes === undefined
        ? {}
        : { alternativeLanguageCodes: input.alternativeLanguageCodes }),
      encoding: "LINEAR16",
      sampleRateHertz: 16000,
      outputBaseNameTemplate: input.fixtureName,
      outputFormats: ["json", "srt", "vtt"],
    },
  };
  const nodeInput: NativeNodeExecutionInput = {
    workflowDirectory: input.workflowDirectory,
    workflowWorkingDirectory: input.workflowDirectory,
    artifactWorkflowRoot: artifactDir,
    workflowId: "wf",
    workflowDescription: "speech workflow",
    workflowExecutionId: "sess-1",
    nodeId: "speech",
    nodeExecId: `exec-${input.fixtureName}`,
    node: {
      id: "speech",
      nodeType: "addon",
      variables: {},
      addon,
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
  };

  const output = await executeGoogleSpeechToTextAddonNodeWithClient(
    nodeInput,
    addon,
    {
      timeoutMs: 5_000,
      signal: new AbortController().signal,
    },
    makeFakeClient(input.response, requests),
  );
  const [request] = requests;
  if (request === undefined) {
    throw new Error("fake Google Speech client did not receive a request");
  }
  return { payload: output.payload, request };
}

function readGoogleSpeechPayload(
  payload: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const value = payload["googleSpeechToText"];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("missing googleSpeechToText payload");
  }
  return value as Readonly<Record<string, unknown>>;
}

function readOutputFiles(
  googleSpeechPayload: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  const value = googleSpeechPayload["outputFiles"];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("missing outputFiles payload");
  }
  return value as Readonly<Record<string, string>>;
}

function makeGoogleSpeechNodeInput(input: {
  readonly workflowDirectory: string;
  readonly artifactDir: string;
  readonly addon: ResolvedGoogleSpeechToTextAddon;
  readonly nodeExecId: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}): NativeNodeExecutionInput {
  return {
    workflowDirectory: input.workflowDirectory,
    workflowWorkingDirectory: input.workflowDirectory,
    artifactWorkflowRoot: input.artifactDir,
    workflowId: "wf",
    workflowDescription: "speech workflow",
    workflowExecutionId: "sess-1",
    nodeId: "speech",
    nodeExecId: input.nodeExecId,
    node: {
      id: "speech",
      nodeType: "addon",
      variables: {},
      addon: input.addon,
    },
    workflowDefaults: {
      maxLoopIterations: 3,
      nodeTimeoutMs: 120000,
    },
    runtimeVariables: {},
    mergedVariables: {},
    arguments: {},
    artifactDir: input.artifactDir,
    executionMailbox: makeExecutionMailbox(),
    ...(input.env === undefined ? {} : { env: input.env }),
  };
}

describe("google speech-to-text add-on", () => {
  test("resolves the built-in add-on payload", () => {
    const result = resolveNodeAddonPayload({
      nodeId: "speech",
      addon: {
        name: "rielflow/google-speech-to-text",
        version: "1",
        config: {
          audioPathTemplate: "audio/input.wav",
          languageCodeTemplate: "ja-JP",
        },
      },
      path: "workflow.nodes[0].addon",
    });

    expect(result.issues ?? []).toEqual([]);
    expect(result.payload).toMatchObject({
      id: "speech",
      nodeType: "addon",
      addon: {
        name: "rielflow/google-speech-to-text",
        version: "1",
      },
      output: {
        description:
          "Google Cloud Speech-to-Text transcription and optional subtitle artifacts.",
      },
    });
  });

  test("rejects invalid built-in add-on config and unsupported env mappings", () => {
    const missingAudio = resolveNodeAddonPayload({
      nodeId: "speech",
      addon: {
        name: "rielflow/google-speech-to-text",
        version: "1",
        config: {
          languageCodeTemplate: "ja-JP",
        },
      },
      path: "workflow.nodes[0].addon",
    });
    expect(missingAudio.issues).toEqual([
      expect.objectContaining({
        path: "workflow.nodes[0].addon.config.audioPathTemplate",
        message:
          "exactly one of audioPathTemplate or gcsUriTemplate must be provided",
      }),
    ]);

    const bothAudioSources = resolveNodeAddonPayload({
      nodeId: "speech",
      addon: {
        name: "rielflow/google-speech-to-text",
        version: "1",
        config: {
          audioPathTemplate: "audio/input.wav",
          gcsUriTemplate: "gs://bucket/input.wav",
          languageCodeTemplate: "ja-JP",
        },
      },
      path: "workflow.nodes[0].addon",
    });
    expect(bothAudioSources.issues).toEqual([
      expect.objectContaining({
        path: "workflow.nodes[0].addon.config.audioPathTemplate",
      }),
    ]);

    const unsupportedEnv = resolveNodeAddonPayload({
      nodeId: "speech",
      addon: {
        name: "rielflow/google-speech-to-text",
        version: "1",
        config: {
          audioPathTemplate: "audio/input.wav",
          languageCodeTemplate: "ja-JP",
        },
        env: {
          GOOGLE_TOKEN: {
            fromEnv: "GOOGLE_TOKEN",
          },
        },
      },
      path: "workflow.nodes[0].addon",
    });
    expect(unsupportedEnv.issues).toEqual([
      expect.objectContaining({
        path: "workflow.nodes[0].addon.env.GOOGLE_TOKEN",
        message:
          "must be GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_APPLICATION_CREDENTIALS_JSON",
      }),
    ]);
  });

  test("writes JSON, SRT, and VTT outputs for Japanese-only, English-only, and mixed fixtures", async () => {
    const workflowDirectory = await makeTempDir();
    const cases: readonly {
      readonly fixtureName: string;
      readonly languageCode: string;
      readonly alternativeLanguageCodes?: readonly string[];
      readonly response: GoogleSpeechRecognizeResponseLike;
    }[] = [
      {
        fixtureName: "japanese-only",
        languageCode: "ja-JP",
        response: makeResponse({
          transcript: "こんにちは 世界",
          languageCode: "ja-jp",
          words: [
            { word: "こんにちは", startSeconds: 0, endSeconds: 0.7 },
            { word: "世界", startSeconds: 0.8, endSeconds: 1.4 },
          ],
        }),
      },
      {
        fixtureName: "english-only",
        languageCode: "en-US",
        response: makeResponse({
          transcript: "Hello world",
          languageCode: "en-us",
          words: [
            { word: "Hello", startSeconds: 0, endSeconds: 0.4 },
            { word: "world", startSeconds: 0.5, endSeconds: 1.1 },
          ],
        }),
      },
      {
        fixtureName: "mixed-ja-en",
        languageCode: "ja-JP",
        alternativeLanguageCodes: ["en-US"],
        response: makeResponse({
          transcript: "こんにちは world",
          languageCode: "ja-jp",
          words: [
            { word: "こんにちは", startSeconds: 0, endSeconds: 0.6 },
            { word: "world", startSeconds: 0.7, endSeconds: 1.2 },
          ],
        }),
      },
    ];

    for (const fixtureCase of cases) {
      const { payload, request } = await runFixtureCase({
        workflowDirectory,
        fixtureName: fixtureCase.fixtureName,
        languageCode: fixtureCase.languageCode,
        ...(fixtureCase.alternativeLanguageCodes === undefined
          ? {}
          : { alternativeLanguageCodes: fixtureCase.alternativeLanguageCodes }),
        response: fixtureCase.response,
      });
      const googleSpeech = readGoogleSpeechPayload(payload);
      const outputFiles = readOutputFiles(googleSpeech);

      expect(request.config).toMatchObject({
        languageCode: fixtureCase.languageCode,
        encoding: "LINEAR16",
        sampleRateHertz: 16000,
        enableWordTimeOffsets: true,
      });
      if (fixtureCase.alternativeLanguageCodes !== undefined) {
        expect(request.config).toMatchObject({
          alternativeLanguageCodes: fixtureCase.alternativeLanguageCodes,
        });
      }
      expect(typeof request.audio["content"]).toBe("string");
      expect(googleSpeech["transcript"]).toBe(
        fixtureCase.response.results?.[0]?.alternatives?.[0]?.transcript,
      );
      expect(await readFile(outputFiles["json"] ?? "", "utf8")).toContain(
        String(googleSpeech["transcript"]),
      );
      expect(await readFile(outputFiles["srt"] ?? "", "utf8")).toContain(
        "00:00:00,000 -->",
      );
      expect(await readFile(outputFiles["vtt"] ?? "", "utf8")).toContain(
        "WEBVTT",
      );
    }
  });

  test("uses Google Speech audio.uri and long-running recognition for gs:// audio", async () => {
    const workflowDirectory = await makeTempDir();
    const artifactDir = path.join(workflowDirectory, "artifacts");
    await mkdir(artifactDir, { recursive: true });
    const requests: GoogleSpeechRecognizeRequestLike[] = [];
    const addon: ResolvedGoogleSpeechToTextAddon = {
      name: "rielflow/google-speech-to-text",
      version: "1",
      config: {
        gcsUriTemplate: "gs://rielflow-test/input.wav",
        languageCodeTemplate: "ja-JP",
        alternativeLanguageCodes: ["en-US"],
        outputFormats: ["json"],
      },
    };
    const output = await executeGoogleSpeechToTextAddonNodeWithClient(
      {
        workflowDirectory,
        workflowWorkingDirectory: workflowDirectory,
        artifactWorkflowRoot: artifactDir,
        workflowId: "wf",
        workflowDescription: "speech workflow",
        workflowExecutionId: "sess-1",
        nodeId: "speech",
        nodeExecId: "exec-gcs",
        node: {
          id: "speech",
          nodeType: "addon",
          variables: {},
          addon,
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
      },
      addon,
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
      makeFakeClient(
        makeResponse({
          transcript: "こんにちは world",
          languageCode: "ja-jp",
          words: [],
        }),
        requests,
        { mode: "long-running" },
      ),
    );

    expect(requests[0]?.audio).toEqual({ uri: "gs://rielflow-test/input.wav" });
    expect(requests[0]?.config).toMatchObject({
      languageCode: "ja-JP",
      alternativeLanguageCodes: ["en-US"],
    });
    expect(readGoogleSpeechPayload(output.payload)["recognitionMode"]).toBe(
      "long-running",
    );
  });

  test("builds client options from credential JSON without exposing secret values", () => {
    const fakePrivateKey = `-----BEGIN PRIVATE ${"KEY"}-----\ncredential-body\n-----END PRIVATE ${"KEY"}-----\n`;
    const options = buildGoogleSpeechClientOptions({
      env: {
        GOOGLE_APPLICATION_CREDENTIALS_JSON: JSON.stringify({
          type: "service_account",
          project_id: "ai-tools-proj",
          client_email: "speech@example.invalid",
          private_key: fakePrivateKey,
        }),
      },
      nodeId: "speech",
    });

    expect(options).toMatchObject({
      projectId: "ai-tools-proj",
      credentials: {
        project_id: "ai-tools-proj",
      },
    });
  });

  test("builds client options from GOOGLE_APPLICATION_CREDENTIALS path", () => {
    const credentialPath =
      "/tmp/rielflow-test/google-credentials/service-account.json";
    const options = buildGoogleSpeechClientOptions({
      env: {
        GOOGLE_APPLICATION_CREDENTIALS: credentialPath,
      },
      nodeId: "speech",
    });

    expect(options).toMatchObject({
      keyFilename: credentialPath,
    });
  });

  test("uses source env GOOGLE_APPLICATION_CREDENTIALS_JSON when addon.env is omitted", async () => {
    const workflowDirectory = await makeTempDir();
    const audioDir = path.join(workflowDirectory, "audio");
    const artifactDir = path.join(workflowDirectory, "artifacts");
    await mkdir(audioDir, { recursive: true });
    await mkdir(artifactDir, { recursive: true });
    await writeFile(path.join(audioDir, "input.wav"), "fixture", "utf8");
    const fakePrivateKey = `-----BEGIN PRIVATE ${"KEY"}-----\ncredential-body\n-----END PRIVATE ${"KEY"}-----\n`;
    const addon: ResolvedGoogleSpeechToTextAddon = {
      name: "rielflow/google-speech-to-text",
      version: "1",
      config: {
        audioPathTemplate: "audio/input.wav",
        languageCodeTemplate: "en-US",
        outputFormats: ["json"],
      },
    };
    const clientOptions: unknown[] = [];
    const requests: GoogleSpeechRecognizeRequestLike[] = [];
    const output = await executeGoogleSpeechToTextAddonNode(
      makeGoogleSpeechNodeInput({
        workflowDirectory,
        artifactDir,
        addon,
        nodeExecId: "exec-source-json-env",
        env: {
          GOOGLE_APPLICATION_CREDENTIALS_JSON: JSON.stringify({
            type: "service_account",
            project_id: "ai-tools-proj",
            client_email: "speech@example.invalid",
            private_key: fakePrivateKey,
          }),
        },
      }),
      addon,
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
      (options) => {
        clientOptions.push(options);
        return makeFakeClient(
          makeResponse({
            transcript: "Hello world",
            languageCode: "en-us",
            words: [],
          }),
          requests,
        );
      },
    );

    expect(clientOptions[0]).toMatchObject({
      projectId: "ai-tools-proj",
      credentials: {
        project_id: "ai-tools-proj",
      },
    });
    expect(requests[0]?.audio).toHaveProperty("content");
    expect(readGoogleSpeechPayload(output.payload)["transcript"]).toBe(
      "Hello world",
    );
  });

  test("redacts source env GOOGLE_APPLICATION_CREDENTIALS paths from provider errors", async () => {
    const workflowDirectory = await makeTempDir();
    const audioDir = path.join(workflowDirectory, "audio");
    const artifactDir = path.join(workflowDirectory, "artifacts");
    await mkdir(audioDir, { recursive: true });
    await mkdir(artifactDir, { recursive: true });
    await writeFile(path.join(audioDir, "input.wav"), "fixture", "utf8");
    const credentialPath =
      "/tmp/rielflow-test/google-credentials/service-account.json";
    const addon: ResolvedGoogleSpeechToTextAddon = {
      name: "rielflow/google-speech-to-text",
      version: "1",
      config: {
        audioPathTemplate: "audio/input.wav",
        languageCodeTemplate: "en-US",
      },
    };
    const request = executeGoogleSpeechToTextAddonNode(
      makeGoogleSpeechNodeInput({
        workflowDirectory,
        artifactDir,
        addon,
        nodeExecId: "exec-source-path-redact",
        env: {
          GOOGLE_APPLICATION_CREDENTIALS: credentialPath,
        },
      }),
      addon,
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
      () =>
        makeFakeClient({ results: [] }, [], {
          error: new Error(`auth failed for keyFilename ${credentialPath}`),
        }),
    );

    await expect(request).rejects.toThrow(AdapterExecutionError);
    await expect(request).rejects.not.toThrow(credentialPath);
  });

  test("redacts credential-like values from provider errors", async () => {
    const workflowDirectory = await makeTempDir();
    const audioDir = path.join(workflowDirectory, "audio");
    const artifactDir = path.join(workflowDirectory, "artifacts");
    await mkdir(audioDir, { recursive: true });
    await mkdir(artifactDir, { recursive: true });
    await writeFile(path.join(audioDir, "input.wav"), "fixture", "utf8");
    const addon: ResolvedGoogleSpeechToTextAddon = {
      name: "rielflow/google-speech-to-text",
      version: "1",
      config: {
        audioPathTemplate: "audio/input.wav",
        languageCodeTemplate: "en-US",
      },
    };
    const providerErrorPayload = JSON.stringify({
      client_email: "speech@example.invalid",
      private_key: `-----BEGIN PRIVATE ${"KEY"}-----\ncredential-body\n-----END PRIVATE ${"KEY"}-----`,
    });
    const request = executeGoogleSpeechToTextAddonNodeWithClient(
      {
        workflowDirectory,
        workflowWorkingDirectory: workflowDirectory,
        artifactWorkflowRoot: artifactDir,
        workflowId: "wf",
        workflowDescription: "speech workflow",
        workflowExecutionId: "sess-1",
        nodeId: "speech",
        nodeExecId: "exec-redact",
        node: {
          id: "speech",
          nodeType: "addon",
          variables: {},
          addon,
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
      },
      addon,
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
      makeFakeClient({ results: [] }, [], {
        error: new Error(`bad credentials ${providerErrorPayload}`),
      }),
    );

    await expect(request).rejects.toThrow(AdapterExecutionError);
    await expect(request).rejects.not.toThrow("speech@example.invalid");
    await expect(request).rejects.not.toThrow("credential-body");
    await expect(request).rejects.not.toThrow("PRIVATE KEY");
  });

  test("redacts configured credential file paths from provider errors", async () => {
    const workflowDirectory = await makeTempDir();
    const audioDir = path.join(workflowDirectory, "audio");
    const artifactDir = path.join(workflowDirectory, "artifacts");
    await mkdir(audioDir, { recursive: true });
    await mkdir(artifactDir, { recursive: true });
    await writeFile(path.join(audioDir, "input.wav"), "fixture", "utf8");
    const credentialPath =
      "/tmp/rielflow-test/google-credentials/service-account.json";
    const addon: ResolvedGoogleSpeechToTextAddon = {
      name: "rielflow/google-speech-to-text",
      version: "1",
      config: {
        audioPathTemplate: "audio/input.wav",
        languageCodeTemplate: "en-US",
      },
    };
    const request = executeGoogleSpeechToTextAddonNodeWithClient(
      {
        workflowDirectory,
        workflowWorkingDirectory: workflowDirectory,
        artifactWorkflowRoot: artifactDir,
        workflowId: "wf",
        workflowDescription: "speech workflow",
        workflowExecutionId: "sess-1",
        nodeId: "speech",
        nodeExecId: "exec-redact-path",
        node: {
          id: "speech",
          nodeType: "addon",
          variables: {},
          addon,
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
      },
      addon,
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      },
      makeFakeClient({ results: [] }, [], {
        error: new Error(`auth failed for keyFilename ${credentialPath}`),
      }),
      { sensitiveValues: [credentialPath] },
    );

    await expect(request).rejects.toThrow(AdapterExecutionError);
    await expect(request).rejects.not.toThrow(credentialPath);
  });
});
