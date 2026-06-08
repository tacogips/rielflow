import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const tempDirs: string[] = [];
const repoRoot = process.cwd();

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "rielflow-example-script-test-"),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

async function runExampleScript(input: {
  readonly relativePath: string;
  readonly resolvedInput: unknown;
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
}): Promise<Record<string, unknown>> {
  const inputPath = path.join(input.cwd, "resolved-input.json");
  const stdoutPath = path.join(input.cwd, "script-output.json");
  await writeFile(
    inputPath,
    `${JSON.stringify(input.resolvedInput, null, 2)}\n`,
  );
  const child = Bun.spawn(
    [
      "sh",
      "-c",
      'exec "$1" >"$2"',
      "rielflow-example-script",
      path.join(repoRoot, input.relativePath),
      stdoutPath,
    ],
    {
      cwd: input.cwd,
      env: {
        ...process.env,
        ...(input.env ?? {}),
        RIEL_RESOLVED_INPUT_PATH: inputPath,
      },
      stderr: "pipe",
      stdout: "ignore",
    },
  );
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `${input.relativePath} failed with ${String(exitCode)}: ${stderr}`,
    );
  }
  const stdout = await readFile(stdoutPath, "utf8");
  return asRecord(JSON.parse(stdout), "script output");
}

function outputPayload(
  output: Record<string, unknown>,
): Record<string, unknown> {
  return asRecord(output["payload"], "script payload");
}

describe("example command scripts", () => {
  test("x-follower digest scripts consume resolved input payloads without mailbox files", async () => {
    const root = await makeTempDir();
    const normalizeOutput = await runExampleScript({
      cwd: root,
      relativePath:
        "examples/x-follower-ai-business-digest/scripts/normalize-fetched-posts.sh",
      resolvedInput: {
        upstream: [
          {
            output: {
              payload: {
                windowStartIso: "2026-06-08T00:00:00.000Z",
                requestedAt: "2026-06-08T01:00:00.000Z",
                maxPosts: 5,
                sinceId: "100",
              },
            },
          },
          {
            output: {
              payload: {
                xGateway: {
                  data: {
                    data: {
                      followingTimeline: {
                        posts: [
                          {
                            id: "101",
                            text: "AI business update",
                            createdAt: "2026-06-08T00:30:00.000Z",
                            author: { username: "founder", name: "Founder" },
                            metrics: { impressionCount: 42 },
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
        ],
        latestOutputs: [],
        runtimeVariables: {},
      },
    });
    const normalizedPayload = outputPayload(normalizeOutput);
    expect(normalizedPayload["selectedPostCount"]).toBe(1);
    expect(normalizedPayload["maxFetchedPostId"]).toBe("101");

    const validateOutput = await runExampleScript({
      cwd: root,
      relativePath:
        "examples/x-follower-ai-business-digest/scripts/validate-summary-output.sh",
      resolvedInput: {
        upstream: [],
        latestOutputs: [
          { payload: normalizedPayload },
          {
            payload: {
              shouldSendTelegram: true,
              topicDigests: [
                {
                  topic: "AI funding",
                  summary: "A concise update",
                  sourcePostIds: ["101"],
                },
              ],
            },
          },
        ],
        runtimeVariables: {},
      },
    });
    const validatedPayload = outputPayload(validateOutput);
    expect(validatedPayload["shouldSendTelegram"]).toBe(true);
    expect(String(validatedPayload["replyText"])).toContain(
      "https://x.com/founder/status/101",
    );

    const stateFile = ".rielflow-data/digest-state.json";
    const stateFilePath = path.join(root, stateFile);
    const persistOutput = await runExampleScript({
      cwd: root,
      relativePath:
        "examples/x-follower-ai-business-digest/scripts/persist-digest-state.sh",
      resolvedInput: {
        upstream: [{ output: { payload: validatedPayload } }],
        latestOutputs: [],
        runtimeVariables: { workflowInput: { stateFile } },
      },
    });
    const persistedPayload = outputPayload(persistOutput);
    expect(persistedPayload["persisted"]).toBe(true);
    const persistedState = asRecord(
      JSON.parse(await readFile(stateFilePath, "utf8")),
      "persisted state",
    );
    expect(persistedState["lastPostId"]).toBe("101");
  });

  test("persona memory scripts use workflowInput memoryRoot and upstream replies", async () => {
    const scriptGroups = [
      "examples/discord-agent-trio-chat",
      "examples/matrix-agent-trio-chat",
      "examples/telegram-agent-trio-chat",
    ];
    for (const scriptGroup of scriptGroups) {
      const root = await makeTempDir();
      const memoryRoot = path.join(root, "memory");
      const personaDir = path.join(memoryRoot, "yui");
      await mkdir(personaDir, { recursive: true });
      await writeFile(
        path.join(personaDir, "2026-06-08.md"),
        "remember this detail\n",
      );
      const sharedEnv = {
        RIEL_TRIO_MEMORY_PERSONA_ID: "yui",
        RIEL_TRIO_MEMORY_PERSONA_NAME: "Yui",
      };

      const readOutput = await runExampleScript({
        cwd: root,
        env: sharedEnv,
        relativePath: `${scriptGroup}/scripts/read-persona-memory.sh`,
        resolvedInput: {
          upstream: [],
          latestOutputs: [],
          runtimeVariables: { workflowInput: { memoryRoot } },
        },
      });
      const readPayload = outputPayload(readOutput);
      expect(readPayload["memoryRoot"]).toBe(memoryRoot);
      expect(String(readPayload["memoryMarkdown"])).toContain(
        "remember this detail",
      );

      const writeOutput = await runExampleScript({
        cwd: root,
        env: sharedEnv,
        relativePath: `${scriptGroup}/scripts/write-persona-memory.sh`,
        resolvedInput: {
          upstream: [],
          latestOutputs: [
            {
              payload: {
                replyText: "reply",
                memoryEntries: [{ content: "new memory", source: "test" }],
                handoff_yui: true,
              },
            },
          ],
          runtimeVariables: { workflowInput: { memoryRoot } },
        },
      });
      const writePayload = outputPayload(writeOutput);
      expect(writePayload["replyText"]).toBe("reply");
      expect(writePayload["handoff_yui"]).toBe(true);
      const memory = asRecord(writePayload["memory"], "memory payload");
      expect(memory["entriesWritten"]).toBe(1);
      const files = await readdir(personaDir);
      expect(files.some((file) => file.endsWith(".md"))).toBe(true);
      const writtenFile = files.find((file) => file.includes("_"));
      expect(writtenFile).toBeDefined();
      const writtenMarkdown = await readFile(
        path.join(personaDir, writtenFile ?? ""),
        "utf8",
      );
      expect(writtenMarkdown).toContain("new memory");
    }
  });
});
