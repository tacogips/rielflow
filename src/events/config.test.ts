import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadEventConfiguration, resolveEventRoot } from "./config";
import { loadAndValidateEventConfiguration } from "./validate";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "divedra-events-"));
  tempDirs.push(directory);
  return directory;
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("event configuration", () => {
  test("resolves default event root next to workflow root", () => {
    const root = path.join(os.tmpdir(), "event-root-project");
    expect(
      resolveEventRoot({
        workflowRoot: path.join(root, ".divedra"),
        cwd: root,
      }),
    ).toBe(path.join(root, ".divedra-events"));
  });

  test("loads and validates source and binding configuration", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".divedra");
    const eventRoot = path.join(root, ".divedra-events");
    await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
      workflowId: "demo",
    });
    await writeJson(path.join(eventRoot, "sources", "local-webhook.json"), {
      id: "local-webhook",
      kind: "webhook",
      path: "/events/local",
    });
    await writeJson(path.join(eventRoot, "destinations", "local-chat.json"), {
      id: "local-chat",
      kind: "chat",
      sourceId: "local-webhook",
    });
    await writeJson(path.join(eventRoot, "bindings", "to-demo.json"), {
      id: "to-demo",
      sourceId: "local-webhook",
      outputDestinations: ["local-chat"],
      workflowName: "demo",
      inputMapping: {
        mode: "event-input",
      },
    });

    const loaded = await loadEventConfiguration({
      workflowRoot,
      eventRoot,
      cwd: root,
    });
    expect(loaded.sources.map((source) => source.id)).toEqual([
      "local-webhook",
    ]);
    expect(loaded.destinations.map((destination) => destination.id)).toEqual([
      "local-chat",
    ]);
    expect(loaded.bindings.map((binding) => binding.id)).toEqual(["to-demo"]);
    expect(loaded.bindings[0]?.outputDestinations).toEqual(["local-chat"]);

    const validation = await loadAndValidateEventConfiguration({
      workflowRoot,
      eventRoot,
      cwd: root,
    });
    expect(validation.valid).toBe(true);
    expect(
      validation.issues.filter((issue) => issue.severity === "error"),
    ).toEqual([]);
  });

  test("validates bindings against user-scope workflow catalog entries", async () => {
    const root = await makeTempDir();
    const userRoot = path.join(root, "user-scope");
    const eventRoot = path.join(root, ".divedra-events");

    await writeJson(
      path.join(userRoot, "workflows", "user-demo", "workflow.json"),
      {
        workflowId: "user-demo",
      },
    );
    await writeJson(path.join(eventRoot, "sources", "local-webhook.json"), {
      id: "local-webhook",
      kind: "webhook",
      path: "/events/local",
    });
    await writeJson(path.join(eventRoot, "bindings", "to-user-demo.json"), {
      id: "to-user-demo",
      sourceId: "local-webhook",
      workflowName: "user-demo",
      inputMapping: {
        mode: "event-input",
      },
    });

    const validation = await loadAndValidateEventConfiguration({
      eventRoot,
      workflowScope: "user",
      userRoot,
      cwd: root,
      env: {},
    });

    expect(validation.valid).toBe(true);
    expect(
      validation.issues.filter((issue) => issue.severity === "error"),
    ).toEqual([]);
  });

  test("reports invalid workflow scope environment values during validation", async () => {
    const root = await makeTempDir();
    const eventRoot = path.join(root, ".divedra-events");

    await writeJson(path.join(eventRoot, "sources", "local-webhook.json"), {
      id: "local-webhook",
      kind: "webhook",
      path: "/events/local",
    });
    await writeJson(path.join(eventRoot, "bindings", "to-demo.json"), {
      id: "to-demo",
      sourceId: "local-webhook",
      workflowName: "demo",
      inputMapping: {
        mode: "event-input",
      },
    });

    const validation = await loadAndValidateEventConfiguration({
      eventRoot,
      cwd: root,
      env: {
        DIVEDRA_WORKFLOW_SCOPE: "global",
      },
    });

    expect(validation.valid).toBe(false);
    expect(
      validation.issues.some((issue) =>
        issue.message.includes("DIVEDRA_WORKFLOW_SCOPE"),
      ),
    ).toBe(true);
  });

  test("reports invalid binding and unsafe webhook sync execution", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".divedra");
    const eventRoot = path.join(root, ".divedra-events");
    await writeJson(path.join(eventRoot, "sources", "local-webhook.json"), {
      id: "local-webhook",
      kind: "webhook",
      path: "/events/local",
      replyEndpointEnv: "not-loud-enough",
    });
    await writeJson(path.join(eventRoot, "bindings", "to-missing.json"), {
      id: "to-missing",
      sourceId: "missing",
      workflowName: "missing-workflow",
      inputMapping: {
        mode: "template",
        template: {
          request: "{{bad.scope}}",
        },
      },
      execution: {
        async: false,
      },
    });

    const validation = await loadAndValidateEventConfiguration({
      workflowRoot,
      eventRoot,
      cwd: root,
    });
    expect(validation.valid).toBe(false);
    expect(validation.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        "bindings.to-missing.sourceId",
        "bindings.to-missing.workflowName",
        "bindings.to-missing.inputMapping.template.request",
        "sources.local-webhook.replyEndpointEnv",
      ]),
    );
  });

  test("reports invalid output destinations and binding references", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".divedra");
    const eventRoot = path.join(root, ".divedra-events");
    await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
      workflowId: "demo",
    });
    await writeJson(path.join(eventRoot, "sources", "local-webhook.json"), {
      id: "local-webhook",
      kind: "webhook",
      path: "/events/local",
    });
    await writeJson(path.join(eventRoot, "destinations", "bad-chat.json"), {
      id: "bad-chat",
      kind: "chat",
      sourceId: "missing-source",
      target: {
        conversationId: "",
      },
    });
    await writeJson(path.join(eventRoot, "destinations", "bad-backup.json"), {
      id: "bad-backup",
      kind: "s3-backup",
      provider: "other",
      rootPrefix: "../unsafe",
    });
    await writeJson(path.join(eventRoot, "bindings", "to-demo.json"), {
      id: "to-demo",
      sourceId: "local-webhook",
      outputDestinations: ["missing-destination"],
      workflowName: "demo",
      inputMapping: {
        mode: "event-input",
      },
      taskPlanning: {
        requiredInput: [
          {
            label: "missing path",
          },
        ],
        planTemplate: "",
      },
    });

    const validation = await loadAndValidateEventConfiguration({
      workflowRoot,
      eventRoot,
      cwd: root,
    });

    expect(validation.valid).toBe(false);
    expect(validation.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        "destinations.bad-chat.sourceId",
        "destinations.bad-chat.target.conversationId",
        "destinations.bad-backup.provider",
        "destinations.bad-backup.bucket",
        "destinations.bad-backup.rootPrefix",
        "bindings.to-demo.outputDestinations[0]",
        "bindings.to-demo.taskPlanning.requiredInput[0].path",
        "bindings.to-demo.taskPlanning.planTemplate",
      ]),
    );
  });

  test("rejects duplicate event HTTP paths", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".divedra");
    const eventRoot = path.join(root, ".divedra-events");
    await writeJson(path.join(eventRoot, "sources", "first-webhook.json"), {
      id: "first-webhook",
      kind: "webhook",
      path: "/events/shared",
    });
    await writeJson(path.join(eventRoot, "sources", "second-webhook.json"), {
      id: "second-webhook",
      kind: "webhook",
      path: "/events/shared",
    });

    const validation = await loadAndValidateEventConfiguration({
      workflowRoot,
      eventRoot,
      cwd: root,
    });

    expect(validation.valid).toBe(false);
    expect(validation.issues.map((issue) => issue.path)).toContain(
      "sources.second-webhook.path",
    );
  });

  test("rejects unsafe synchronous S3 event receiver bindings", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".divedra");
    const eventRoot = path.join(root, ".divedra-events");
    await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
      workflowId: "demo",
    });
    await writeJson(path.join(eventRoot, "sources", "incoming-docs.json"), {
      id: "incoming-docs",
      kind: "s3-repository",
      provider: "s3-compatible",
      bucket: "docs",
      eventReceiver: {
        mode: "webhook-bridge",
        path: "/events/incoming-docs",
      },
      objectAccess: {
        mode: "metadata-only",
      },
    });
    await writeJson(path.join(eventRoot, "bindings", "docs-demo.json"), {
      id: "docs-demo",
      sourceId: "incoming-docs",
      workflowName: "demo",
      inputMapping: {
        mode: "event-input",
      },
      execution: {
        async: false,
      },
    });

    const validation = await loadAndValidateEventConfiguration({
      workflowRoot,
      eventRoot,
      cwd: root,
    });

    expect(validation.valid).toBe(false);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        path: "bindings.docs-demo.execution.async",
        message: expect.stringContaining("HTTP-backed"),
      }),
    );
  });

  test("rejects cron schedules and timezones the scheduler cannot execute", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".divedra");
    const eventRoot = path.join(root, ".divedra-events");
    await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
      workflowId: "demo",
    });
    await writeJson(path.join(eventRoot, "sources", "bad-cron.json"), {
      id: "bad-cron",
      kind: "cron",
      schedule: "*/0 2 * * *",
      timezone: "Mars/Base",
    });
    await writeJson(path.join(eventRoot, "bindings", "to-demo.json"), {
      id: "to-demo",
      sourceId: "bad-cron",
      workflowName: "demo",
      inputMapping: {
        mode: "event-input",
      },
    });

    const validation = await loadAndValidateEventConfiguration({
      workflowRoot,
      eventRoot,
      cwd: root,
    });

    expect(validation.valid).toBe(false);
    expect(validation.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        "sources.bad-cron.schedule",
        "sources.bad-cron.timezone",
      ]),
    );
  });

  test("validates Matrix source configuration", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".divedra");
    const eventRoot = path.join(root, ".divedra-events");
    await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
      workflowId: "demo",
    });
    await writeJson(path.join(eventRoot, "sources", "team-matrix.json"), {
      id: "team-matrix",
      kind: "matrix",
      provider: "matrix",
      homeserverUrlEnv: "DIVEDRA_MATRIX_HOMESERVER_URL",
      accessTokenEnv: "DIVEDRA_MATRIX_ACCESS_TOKEN",
      userId: "@divedra:matrix.example",
      rooms: [
        {
          roomId: "!release:matrix.example",
          alias: "#release:matrix.example",
        },
      ],
      sync: {
        pollTimeoutMs: 30000,
        sinceTokenPath: "matrix/team-matrix-sync.json",
      },
    });
    await writeJson(path.join(eventRoot, "bindings", "to-demo.json"), {
      id: "to-demo",
      sourceId: "team-matrix",
      workflowName: "demo",
      inputMapping: {
        mode: "event-input",
      },
    });

    const validation = await loadAndValidateEventConfiguration({
      workflowRoot,
      eventRoot,
      cwd: root,
    });

    expect(validation.valid).toBe(true);
    expect(
      validation.issues.filter((issue) => issue.severity === "error"),
    ).toEqual([]);
  });

  test("rejects malformed Matrix source configuration", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".divedra");
    const eventRoot = path.join(root, ".divedra-events");
    await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
      workflowId: "demo",
    });
    await writeJson(path.join(eventRoot, "sources", "bad-matrix.json"), {
      id: "bad-matrix",
      kind: "matrix",
      homeserverUrlEnv: "not-loud-enough",
      accessTokenEnv: "",
      userId: "divedra",
      rooms: [
        {
          roomId: "release-room",
          alias: "",
        },
      ],
      sync: {
        pollTimeoutMs: 10,
        sinceTokenPath: "../token.json",
      },
      ignoreOwnMessages: "yes",
    });
    await writeJson(path.join(eventRoot, "bindings", "to-demo.json"), {
      id: "to-demo",
      sourceId: "bad-matrix",
      workflowName: "demo",
      inputMapping: {
        mode: "event-input",
      },
    });

    const validation = await loadAndValidateEventConfiguration({
      workflowRoot,
      eventRoot,
      cwd: root,
    });

    expect(validation.valid).toBe(false);
    expect(validation.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        "sources.bad-matrix.homeserverUrlEnv",
        "sources.bad-matrix.accessTokenEnv",
        "sources.bad-matrix.userId",
        "sources.bad-matrix.rooms[0].roomId",
        "sources.bad-matrix.rooms[0].alias",
        "sources.bad-matrix.sync.pollTimeoutMs",
        "sources.bad-matrix.sync.sinceTokenPath",
        "sources.bad-matrix.ignoreOwnMessages",
      ]),
    );
  });

  test("rejects malformed supervised command-map configuration", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".divedra");
    const eventRoot = path.join(root, ".divedra-events");
    await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
      workflowId: "demo",
    });
    await writeJson(path.join(eventRoot, "sources", "chat-webhook.json"), {
      id: "chat-webhook",
      kind: "webhook",
      path: "/events/chat",
    });
    await writeJson(path.join(eventRoot, "bindings", "supervised-demo.json"), {
      id: "supervised-demo",
      sourceId: "chat-webhook",
      workflowName: "demo",
      inputMapping: {
        mode: "event-input",
      },
      execution: {
        mode: "supervised",
        control: {
          intentMapping: {
            mode: "command-map",
            inputPath: "event.input.text",
            commands: {
              start: 1,
              invalidAction: "status",
            },
            defaultAction: "launch",
          },
        },
      },
    });

    const validation = await loadAndValidateEventConfiguration({
      workflowRoot,
      eventRoot,
      cwd: root,
    });

    expect(validation.valid).toBe(false);
    expect(validation.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        "bindings.supervised-demo.execution.control.intentMapping.defaultAction",
        "bindings.supervised-demo.execution.control.intentMapping.commands.start",
        "bindings.supervised-demo.execution.control.intentMapping.commands.invalidAction",
      ]),
    );
  });
});
