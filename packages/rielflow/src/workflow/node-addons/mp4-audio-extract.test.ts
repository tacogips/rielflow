import { describe, expect, test } from "vitest";
import { resolveBuiltinNodeAddonPayload } from "./addon-payload-resolution";

describe("MP4 audio extract built-in add-on", () => {
  test("resolves valid config without cloud env bindings", () => {
    const resolved = resolveBuiltinNodeAddonPayload({
      nodeId: "extract-audio",
      path: "workflow.nodes[0].addon",
      addon: {
        name: "rielflow/mp4-audio-extract",
        version: "1",
        config: {
          mp4PathTemplate: "{{args.videoPath}}",
          ffmpegPath: "custom-ffmpeg",
          sampleRateHertz: 16000,
          audioChannelCount: 1,
        },
        inputs: { videoPath: "meeting.mp4" },
      },
    });

    expect(resolved.issues).toEqual([]);
    expect(resolved.payload).toMatchObject({
      id: "extract-audio",
      nodeType: "addon",
      variables: { videoPath: "meeting.mp4" },
      addon: {
        name: "rielflow/mp4-audio-extract",
        version: "1",
        config: {
          mp4PathTemplate: "{{args.videoPath}}",
          ffmpegPath: "custom-ffmpeg",
          sampleRateHertz: 16000,
          audioChannelCount: 1,
        },
        inputs: { videoPath: "meeting.mp4" },
      },
      output: {
        jsonSchema: {
          required: ["audioExtract"],
        },
      },
    });
  });

  test("rejects unsupported version", () => {
    const unsupportedVersion = resolveBuiltinNodeAddonPayload({
      nodeId: "extract-audio",
      path: "workflow.nodes[0].addon",
      addon: {
        name: "rielflow/mp4-audio-extract",
        version: "2",
        config: {
          mp4PathTemplate: "video.mp4",
        },
      },
    });

    expect((unsupportedVersion.issues ?? [])[0]?.message).toContain(
      "unsupported version '2'",
    );
  });

  test("rejects invalid config", () => {
    const resolved = resolveBuiltinNodeAddonPayload({
      nodeId: "extract-audio",
      path: "workflow.nodes[0].addon",
      addon: {
        name: "rielflow/mp4-audio-extract",
        version: "1",
        config: {
          mp4PathTemplate: "",
          sampleRateHertz: 0,
          audioChannelCount: 1.5,
          languageCode: "en-US",
          extra: true,
        },
        inputs: { videoPath: "video.mp4" },
      },
    });

    expect(resolved.payload).toBeUndefined();
    expect((resolved.issues ?? []).map((issue) => issue.path)).toEqual([
      "workflow.nodes[0].addon.config.languageCode",
      "workflow.nodes[0].addon.config.extra",
      "workflow.nodes[0].addon.config.mp4PathTemplate",
      "workflow.nodes[0].addon.config.sampleRateHertz",
      "workflow.nodes[0].addon.config.audioChannelCount",
    ]);
  });

  test("rejects non-object inputs", () => {
    const resolved = resolveBuiltinNodeAddonPayload({
      nodeId: "extract-audio",
      path: "workflow.nodes[0].addon",
      addon: {
        name: "rielflow/mp4-audio-extract",
        version: "1",
        config: {
          mp4PathTemplate: "video.mp4",
        },
        inputs: ["video.mp4"] as unknown as Readonly<Record<string, unknown>>,
      },
    });

    expect(resolved.payload).toBeUndefined();
    expect((resolved.issues ?? [])[0]?.path).toBe(
      "workflow.nodes[0].addon.inputs",
    );
  });
});
