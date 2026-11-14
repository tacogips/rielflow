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

  test.each([
    "slack",
    "teams",
    "gchat",
    "discord",
    "telegram",
    "github",
    "linear",
    "whatsapp",
    "messenger",
    "web",
  ] as const)("validates Chat SDK %s source configuration", async (provider) => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".divedra");
    const eventRoot = path.join(root, ".divedra-events");
    await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
      workflowId: "demo",
    });
    await writeJson(path.join(eventRoot, "sources", `${provider}.json`), {
      id: `${provider}-chat`,
      kind: "chat-sdk",
      provider,
      mode: "generic-webhook",
      webhook: {
        path: `chat-sdk/${provider}`,
        signingSecretEnv: "DIVEDRA_CHAT_SDK_WEBHOOK_SECRET",
        bearerTokenEnv: "DIVEDRA_CHAT_SDK_BEARER_TOKEN",
        rateLimit: { windowMs: 60000, maxRequests: 10 },
      },
      send: {
        endpointUrlEnv: "DIVEDRA_CHAT_SDK_SEND_URL",
        tokenEnv: "DIVEDRA_CHAT_SDK_SEND_TOKEN",
      },
    });
    await writeJson(path.join(eventRoot, "destinations", `${provider}.json`), {
      id: `${provider}-reply`,
      kind: "chat",
      sourceId: `${provider}-chat`,
    });
    await writeJson(path.join(eventRoot, "bindings", `${provider}.json`), {
      id: `${provider}-to-demo`,
      sourceId: `${provider}-chat`,
      outputDestinations: [`${provider}-reply`],
      workflowName: "demo",
      match: { eventType: "chat.message" },
      inputMapping: { mode: "event-input" },
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

  test("rejects malformed Chat SDK source configuration", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".divedra");
    const eventRoot = path.join(root, ".divedra-events");
    await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
      workflowId: "demo",
    });
    await writeJson(path.join(eventRoot, "sources", "bad-chat-sdk.json"), {
      id: "bad-chat-sdk",
      kind: "chat-sdk",
      provider: "irc",
      mode: "direct-package",
      webhook: {
        path: "../unsafe",
        signingSecretEnv: "literal-secret-value",
        bearerTokenEnv: "not-loud-enough",
        rateLimit: { windowMs: 0, maxRequests: 0 },
      },
      send: {
        endpointUrlEnv: "https://send.example.test",
        tokenEnv: "plain-token",
      },
      providerConfig: {
        eventType: "chat.action",
      },
    });
    await writeJson(path.join(eventRoot, "bindings", "bad.json"), {
      id: "bad-to-demo",
      sourceId: "bad-chat-sdk",
      workflowName: "demo",
      inputMapping: { mode: "event-input" },
    });

    const validation = await loadAndValidateEventConfiguration({
      workflowRoot,
      eventRoot,
      cwd: root,
    });

    expect(validation.valid).toBe(false);
    expect(validation.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        "sources.bad-chat-sdk.provider",
        "sources.bad-chat-sdk.mode",
        "sources.bad-chat-sdk.webhook.path",
        "sources.bad-chat-sdk.webhook.signingSecretEnv",
        "sources.bad-chat-sdk.webhook.bearerTokenEnv",
        "sources.bad-chat-sdk.webhook.rateLimit.windowMs",
        "sources.bad-chat-sdk.webhook.rateLimit.maxRequests",
        "sources.bad-chat-sdk.send.endpointUrlEnv",
        "sources.bad-chat-sdk.send.tokenEnv",
        "sources.bad-chat-sdk.providerConfig.eventType",
      ]),
    );
  });

  test("reports non-string Chat SDK webhook paths without throwing", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".divedra");
    const eventRoot = path.join(root, ".divedra-events");
    await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
      workflowId: "demo",
    });
    await writeJson(path.join(eventRoot, "sources", "bad-path.json"), {
      id: "bad-path-chat-sdk",
      kind: "chat-sdk",
      provider: "slack",
      webhook: {
        path: 123,
        bearerTokenEnv: "DIVEDRA_CHAT_SDK_BEARER_TOKEN",
      },
    });
    await writeJson(path.join(eventRoot, "bindings", "bad-path.json"), {
      id: "bad-path-to-demo",
      sourceId: "bad-path-chat-sdk",
      workflowName: "demo",
      inputMapping: { mode: "event-input" },
    });

    const validation = await loadAndValidateEventConfiguration({
      workflowRoot,
      eventRoot,
      cwd: root,
    });

    expect(validation.valid).toBe(false);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        path: "sources.bad-path-chat-sdk.webhook.path",
      }),
    );
  });

  test("reports unsupported Chat SDK providers with binding event types without throwing", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".divedra");
    const eventRoot = path.join(root, ".divedra-events");
    await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
      workflowId: "demo",
    });
    await writeJson(path.join(eventRoot, "sources", "irc.json"), {
      id: "irc-chat-sdk",
      kind: "chat-sdk",
      provider: "irc",
      webhook: {
        path: "chat-sdk/irc",
        bearerTokenEnv: "DIVEDRA_CHAT_SDK_BEARER_TOKEN",
      },
    });
    await writeJson(path.join(eventRoot, "bindings", "irc.json"), {
      id: "irc-to-demo",
      sourceId: "irc-chat-sdk",
      workflowName: "demo",
      match: { eventType: "chat.message" },
      inputMapping: { mode: "event-input" },
    });

    const validation = await loadAndValidateEventConfiguration({
      workflowRoot,
      eventRoot,
      cwd: root,
    });

    expect(validation.valid).toBe(false);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        path: "sources.irc-chat-sdk.provider",
      }),
    );
  });

  test("rejects Chat SDK webhook sources without inbound authentication", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".divedra");
    const eventRoot = path.join(root, ".divedra-events");
    await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
      workflowId: "demo",
    });
    await writeJson(path.join(eventRoot, "sources", "no-auth.json"), {
      id: "no-auth-chat-sdk",
      kind: "chat-sdk",
      provider: "slack",
      webhook: { path: "chat-sdk/no-auth" },
    });
    await writeJson(path.join(eventRoot, "bindings", "no-auth.json"), {
      id: "no-auth-to-demo",
      sourceId: "no-auth-chat-sdk",
      workflowName: "demo",
      inputMapping: { mode: "event-input" },
    });

    const validation = await loadAndValidateEventConfiguration({
      workflowRoot,
      eventRoot,
      cwd: root,
    });

    expect(validation.valid).toBe(false);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        path: "sources.no-auth-chat-sdk.webhook",
        message: expect.stringContaining("signingSecretEnv or bearerTokenEnv"),
      }),
    );
  });

  test("rejects Chat SDK duplicate paths, destinations without send config, and unsupported event types", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".divedra");
    const eventRoot = path.join(root, ".divedra-events");
    await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
      workflowId: "demo",
    });
    await writeJson(path.join(eventRoot, "sources", "first.json"), {
      id: "first-chat-sdk",
      kind: "chat-sdk",
      provider: "slack",
      webhook: {
        path: "chat-sdk/shared",
        bearerTokenEnv: "DIVEDRA_CHAT_SDK_BEARER_TOKEN",
      },
    });
    await writeJson(path.join(eventRoot, "sources", "second.json"), {
      id: "second-chat-sdk",
      kind: "chat-sdk",
      provider: "discord",
      webhook: {
        path: "chat-sdk/shared",
        bearerTokenEnv: "DIVEDRA_CHAT_SDK_BEARER_TOKEN",
      },
      send: { endpointUrlEnv: "DIVEDRA_CHAT_SDK_SEND_URL" },
    });
    await writeJson(path.join(eventRoot, "destinations", "reply.json"), {
      id: "missing-send-reply",
      kind: "chat",
      sourceId: "first-chat-sdk",
    });
    await writeJson(path.join(eventRoot, "bindings", "unsupported.json"), {
      id: "unsupported-event-type",
      sourceId: "second-chat-sdk",
      workflowName: "demo",
      match: { eventType: "chat.action" },
      inputMapping: { mode: "event-input" },
    });

    const validation = await loadAndValidateEventConfiguration({
      workflowRoot,
      eventRoot,
      cwd: root,
    });

    expect(validation.valid).toBe(false);
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "sources.second-chat-sdk.path",
          message: expect.stringContaining("already used"),
        }),
        expect.objectContaining({
          path: "destinations.missing-send-reply.sourceId",
          message: expect.stringContaining("does not configure send"),
        }),
        expect.objectContaining({
          path: "bindings.unsupported-event-type.match.eventType",
          message: expect.stringContaining("does not support event type"),
        }),
      ]),
    );
  });

  test.each([
    "chat.mention",
    "chat.command",
    "chat.action",
    "chat.modal-submit",
  ])("rejects undeclared Chat SDK capability event type %s", async (eventType) => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".divedra");
    const eventRoot = path.join(root, ".divedra-events");
    await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
      workflowId: "demo",
    });
    await writeJson(path.join(eventRoot, "sources", "slack.json"), {
      id: "slack-chat",
      kind: "chat-sdk",
      provider: "slack",
      webhook: {
        path: "chat-sdk/slack",
        bearerTokenEnv: "DIVEDRA_CHAT_SDK_BEARER_TOKEN",
      },
    });
    await writeJson(path.join(eventRoot, "bindings", "slack.json"), {
      id: "slack-to-demo",
      sourceId: "slack-chat",
      workflowName: "demo",
      match: { eventType },
      inputMapping: { mode: "event-input" },
    });

    const validation = await loadAndValidateEventConfiguration({
      workflowRoot,
      eventRoot,
      cwd: root,
    });

    expect(validation.valid).toBe(false);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        path: "bindings.slack-to-demo.match.eventType",
      }),
    );
  });

  test("accepts schedule-registration policy with binding inputMapping", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".divedra");
    const eventRoot = path.join(root, ".divedra-events");
    await writeJson(path.join(workflowRoot, "resolver", "workflow.json"), {
      workflowId: "resolver",
    });
    await writeJson(path.join(eventRoot, "sources", "chat.json"), {
      id: "chat",
      kind: "webhook",
      path: "/events/chat",
    });
    await writeJson(
      path.join(eventRoot, "bindings", "register-schedule.json"),
      {
        id: "register-schedule",
        sourceId: "chat",
        inputMapping: {
          mode: "template",
          template: {
            request: "{{event.input.text}}",
            timezone: "{{event.input.timezone}}",
          },
        },
        execution: {
          mode: "schedule-registration",
          resolverWorkflowName: "resolver",
          resolverNodeId: "resolver-worker",
          minConfidence: 0.8,
        },
      },
    );

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

  test.each([
    "inputPath",
    "timezonePath",
  ] as const)("rejects schedule-registration execution.%s in favor of inputMapping", async (field) => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".divedra");
    const eventRoot = path.join(root, ".divedra-events");
    await writeJson(path.join(workflowRoot, "resolver", "workflow.json"), {
      workflowId: "resolver",
    });
    await writeJson(path.join(eventRoot, "sources", "chat.json"), {
      id: "chat",
      kind: "webhook",
      path: "/events/chat",
    });
    await writeJson(
      path.join(eventRoot, "bindings", "register-schedule.json"),
      {
        id: "register-schedule",
        sourceId: "chat",
        inputMapping: {
          mode: "event-input",
        },
        execution: {
          mode: "schedule-registration",
          resolverWorkflowName: "resolver",
          resolverNodeId: "resolver-worker",
          [field]: "event.input.text",
        },
      },
    );

    const validation = await loadAndValidateEventConfiguration({
      workflowRoot,
      eventRoot,
      cwd: root,
    });

    expect(validation.valid).toBe(false);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        path: `bindings.register-schedule.execution.${field}`,
        message: expect.stringContaining("inputMapping"),
      }),
    );
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
