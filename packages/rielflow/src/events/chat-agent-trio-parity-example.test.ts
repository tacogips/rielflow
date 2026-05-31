import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { emitEventFile } from "./manual-emit";
import type { MockNodeScenario } from "../workflow/scenario-adapter";

const workflowNames = [
  "discord-agent-trio-chat",
  "telegram-agent-trio-chat",
  "matrix-agent-trio-chat",
] as const;

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "rielflow-chat-agent-trio-parity-"),
  );
  tempDirs.push(directory);
  return directory;
}

async function readJsonObject(
  relativePath: string,
): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(path.resolve(relativePath), "utf8"),
  ) as Record<string, unknown>;
}

function objectAtPath(
  value: Record<string, unknown>,
  pathName: readonly string[],
): Record<string, unknown> {
  let current: unknown = value;
  for (const segment of pathName) {
    expect(current).toEqual(expect.any(Object));
    current = (current as Record<string, unknown>)[segment];
  }
  expect(current).toEqual(expect.any(Object));
  return current as Record<string, unknown>;
}

function arrayAtPath(
  value: Record<string, unknown>,
  pathName: readonly string[],
): readonly Record<string, unknown>[] {
  const current = objectAtPath(value, pathName.slice(0, -1))[
    pathName[pathName.length - 1] ?? ""
  ];
  expect(Array.isArray(current)).toBe(true);
  return current as readonly Record<string, unknown>[];
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("chat agent trio example parity", () => {
  test("keeps Discord, Telegram, and Matrix trio workflows structurally aligned", async () => {
    const workflows = await Promise.all(
      workflowNames.map((workflowName) =>
        readJsonObject(`examples/${workflowName}/workflow.json`),
      ),
    );

    for (const workflow of workflows) {
      expect(workflow["entryStepId"]).toBe("route-message");
      expect(
        arrayAtPath(workflow, ["nodes"]).map((node) => node["id"]),
      ).toEqual([
        "route-message",
        "yui-codex",
        "mika-claude",
        "rina-cursor",
        "send-yui-reply",
        "send-mika-reply",
        "send-rina-reply",
      ]);
      expect(
        arrayAtPath(workflow, ["steps"]).map((step) => step["id"]),
      ).toEqual([
        "route-message",
        "yui-codex",
        "send-yui-reply",
        "mika-claude",
        "send-mika-reply",
        "rina-cursor",
        "send-rina-reply",
      ]);

      const routeNode = arrayAtPath(workflow, ["nodes"]).find(
        (node) => node["id"] === "route-message",
      );
      expect(routeNode).toBeDefined();
      const routeConfig = objectAtPath(routeNode ?? {}, ["addon", "config"]);
      expect(routeConfig["defaultPersonaId"]).toBe("yui");
      expect(routeConfig["personas"]).toEqual([
        expect.objectContaining({ id: "yui", name: "Yui Codex" }),
        expect.objectContaining({ id: "mika", name: "Mika Trend" }),
        expect.objectContaining({ id: "rina", name: "Rina Cursor" }),
      ]);

      const replyAsByNode = Object.fromEntries(
        arrayAtPath(workflow, ["nodes"])
          .filter((node) => String(node["id"]).startsWith("send-"))
          .map((node) => [
            node["id"],
            objectAtPath(node, ["addon", "config"])["replyAsTemplate"],
          ]),
      );
      expect(replyAsByNode).toEqual({
        "send-yui-reply": "yui",
        "send-mika-reply": "mika",
        "send-rina-reply": "rina",
      });
    }
  });

  test("maps each provider source to the matching trio workflow and reply destination", async () => {
    const discordBinding = await readJsonObject(
      "examples/event-sources/.rielflow-events/bindings/discord-gateway-personas-to-workflow.json",
    );
    const telegramBinding = await readJsonObject(
      "examples/event-sources/.rielflow-events/bindings/telegram-gateway-personas-to-workflow.json",
    );
    const matrixBinding = await readJsonObject(
      "examples/event-sources/.rielflow-events/bindings/matrix-agent-trio-to-workflow.json",
    );
    const matrixSource = await readJsonObject(
      "examples/event-sources/.rielflow-events/sources/team-matrix.json",
    );

    expect(discordBinding).toMatchObject({
      sourceId: "discord-gateway-personas",
      workflowName: "discord-agent-trio-chat",
      outputDestinations: ["discord-gateway-persona-replies"],
    });
    expect(telegramBinding).toMatchObject({
      sourceId: "telegram-gateway-personas",
      workflowName: "telegram-agent-trio-chat",
      outputDestinations: ["telegram-gateway-persona-replies"],
    });
    expect(matrixBinding).toMatchObject({
      sourceId: "team-matrix",
      workflowName: "matrix-agent-trio-chat",
      outputDestinations: ["matrix-persona-replies"],
      match: {
        eventType: "chat.message",
        conversationId: "!persona:matrix.example",
      },
    });
    expect(matrixSource).toMatchObject({
      replyBots: {
        yui: { accessTokenEnv: "RIEL_MATRIX_YUI_ACCESS_TOKEN" },
        mika: { accessTokenEnv: "RIEL_MATRIX_MIKA_ACCESS_TOKEN" },
        rina: { accessTokenEnv: "RIEL_MATRIX_RINA_ACCESS_TOKEN" },
      },
    });
  });

  test("runs the Matrix trio handoff fixture with stubbed Matrix sends", async () => {
    const root = await makeTempDir();
    const calls: Array<{ readonly url: string; readonly init?: RequestInit }> =
      [];
    const mockScenario = (await readJsonObject(
      "examples/matrix-agent-trio-chat/mock-scenario.json",
    )) as MockNodeScenario;
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url: String(url), ...(init === undefined ? {} : { init }) });
      return new Response(JSON.stringify({ event_id: "$matrix-reply" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const results = await emitEventFile({
      sourceId: "team-matrix",
      workflowRoot: path.resolve("examples"),
      eventRoot: path.resolve("examples/event-sources/.rielflow-events"),
      rootDataDir: path.join(root, "data"),
      eventFile: path.resolve(
        "examples/event-sources/payloads/matrix-persona-message.json",
      ),
      mockScenario,
      env: {
        RIEL_MATRIX_HOMESERVER_URL: "https://matrix.example",
        RIEL_MATRIX_ACCESS_TOKEN: "matrix-default-token",
        RIEL_MATRIX_YUI_ACCESS_TOKEN: "matrix-yui-token",
        RIEL_MATRIX_MIKA_ACCESS_TOKEN: "matrix-mika-token",
        RIEL_MATRIX_RINA_ACCESS_TOKEN: "matrix-rina-token",
      },
      fetchImpl,
      cwd: process.cwd(),
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.receipt.status).toBe("dispatched");
    expect(results[0]?.workflowName).toBe("matrix-agent-trio-chat");
    expect(calls).toHaveLength(2);
    expect(calls.map((call) => call.init?.headers)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ authorization: "Bearer matrix-yui-token" }),
        expect.objectContaining({ authorization: "Bearer matrix-mika-token" }),
      ]),
    );
    expect(
      calls.map((call) => JSON.parse(String(call.init?.body)) as unknown),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ body: expect.stringContaining("Yui") }),
        expect.objectContaining({ body: expect.stringContaining("Mika") }),
      ]),
    );
  });

  test("runs the Telegram trio time-signal cron fixture with a stubbed Telegram send", async () => {
    const root = await makeTempDir();
    const calls: Array<{ readonly url: string; readonly init?: RequestInit }> =
      [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url: String(url), ...(init === undefined ? {} : { init }) });
      return new Response(
        JSON.stringify({ ok: true, result: { message_id: 456 } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const results = await emitEventFile({
      sourceId: "telegram-time-signal-cron",
      workflowRoot: path.resolve("examples"),
      eventRoot: path.resolve("examples/event-sources/.rielflow-events"),
      rootDataDir: path.join(root, "data"),
      eventFile: path.resolve(
        "examples/event-sources/payloads/telegram-time-signal-cron.json",
      ),
      env: {
        RIEL_TELEGRAM_BOT_TOKEN: "telegram-default-token",
        RIEL_TELEGRAM_YUI_BOT_TOKEN: "telegram-yui-token",
        RIEL_TELEGRAM_CHAT_ID: "-1009876543210",
      },
      fetchImpl,
      cwd: process.cwd(),
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.receipt.status).toBe("dispatched");
    expect(results[0]?.workflowName).toBe("telegram-agent-trio-time-signal");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://api.telegram.org/bottelegram-yui-token/sendMessage",
    );
    const body = JSON.parse(String(calls[0]?.init?.body)) as {
      readonly chat_id: string;
      readonly text: string;
    };
    expect(body.chat_id).toBe("-1009876543210");
    expect(body.text).toContain("Asia/Tokyo");
    expect(body.text).toContain("2026-05-31 19:05");
  });
});
