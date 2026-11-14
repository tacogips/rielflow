import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { emitEventFile } from "./manual-emit";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-matrix-chat-reply-example-"),
  );
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("matrix chat reply event example", () => {
  test("dispatches the checked-in Matrix sample workflow to a Matrix room send", async () => {
    const root = await makeTempDir();
    const calls: Array<{ readonly url: string; readonly init?: RequestInit }> =
      [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url: String(url), ...(init === undefined ? {} : { init }) });
      return new Response(JSON.stringify({ event_id: "$reply-event" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const results = await emitEventFile({
      sourceId: "team-matrix",
      workflowRoot: path.resolve("examples"),
      eventRoot: path.resolve("examples/event-sources/.divedra-events"),
      rootDataDir: path.join(root, "data"),
      eventFile: path.resolve(
        "examples/event-sources/payloads/matrix-room-message.json",
      ),
      env: {
        DIVEDRA_MATRIX_HOMESERVER_URL: "https://matrix.example",
        DIVEDRA_MATRIX_ACCESS_TOKEN: "matrix-bot-token",
      },
      fetchImpl,
      cwd: process.cwd(),
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.receipt.status).toBe("dispatched");
    expect(results[0]?.workflowName).toBe("matrix-chat-reply");
    expect(fetchImpl).toHaveBeenCalled();
    const finalCall = calls.at(-1);
    expect(finalCall?.url).toContain(
      "https://matrix.example/_matrix/client/v3/rooms/!release%3Amatrix.example/send/m.room.message/",
    );
    expect(finalCall?.init?.headers).toMatchObject({
      authorization: "Bearer matrix-bot-token",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(finalCall?.init?.body))).toMatchObject({
      msgtype: "m.text",
      body: "Matrix sample received from @alice:matrix.example: Run the release workflow from Matrix.",
      "m.relates_to": {
        rel_type: "m.thread",
        event_id: "$release-thread-root",
        is_falling_back: true,
        "m.in_reply_to": { event_id: "$release-event-1" },
      },
    });
  });
});
