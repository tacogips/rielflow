import { describe, expect, test } from "vitest";
import type { WorkflowNodeAddonRef } from "../types";
import { resolveBuiltinNodeAddonPayload } from "./addon-payload-resolution";

function resolveYoutubeAddon(input: {
  readonly version?: string;
  readonly config?: unknown;
  readonly inputs?: unknown;
  readonly env?: unknown;
}) {
  const addon = {
    name: "rielflow/youtube-mp4-download",
    ...(input.version === undefined ? {} : { version: input.version }),
    ...(input.config === undefined ? {} : { config: input.config }),
    ...(input.inputs === undefined ? {} : { inputs: input.inputs }),
    ...(input.env === undefined ? {} : { env: input.env }),
  } as WorkflowNodeAddonRef;
  return resolveBuiltinNodeAddonPayload({
    nodeId: "download",
    path: "workflow.nodes[0].addon",
    addon,
  });
}

describe("built-in YouTube MP4 download add-on resolver", () => {
  test("resolves valid version 1 config and inputs", () => {
    const resolved = resolveYoutubeAddon({
      version: "1",
      config: {
        ytDlpPath: "/opt/tools/yt-dlp",
        outputDirectory: "media/downloads",
        fileNameTemplate: "%(id)s.%(ext)s",
        formatSelector: "best[ext=mp4]",
        timeoutMs: 1000,
      },
      inputs: {
        url: "https://www.youtube.com/watch?v=abc123",
      },
    });

    expect(resolved.issues).toEqual([]);
    expect(resolved.payload).toMatchObject({
      id: "download",
      nodeType: "addon",
      variables: {
        url: "https://www.youtube.com/watch?v=abc123",
      },
      addon: {
        name: "rielflow/youtube-mp4-download",
        version: "1",
        config: {
          ytDlpPath: "/opt/tools/yt-dlp",
          outputDirectory: "media/downloads",
          fileNameTemplate: "%(id)s.%(ext)s",
          formatSelector: "best[ext=mp4]",
          timeoutMs: 1000,
        },
        inputs: {
          url: "https://www.youtube.com/watch?v=abc123",
        },
      },
    });
  });

  test.each([
    "https://youtu.be/abc123",
    "https://www.youtube.com/shorts/abc123",
    "https://www.youtube.com/embed/abc123",
    "https://www.youtube.com/live/abc123",
  ])("accepts video-shaped URL %s", (url) => {
    const resolved = resolveYoutubeAddon({
      inputs: { url },
    });

    expect(resolved.issues).toEqual([]);
    expect(resolved.payload?.variables).toEqual({ url });
  });

  test.each([
    {
      name: "unsupported version",
      input: {
        version: "2",
        inputs: { url: "https://youtu.be/abc123" },
      },
      message: "unsupported version",
    },
    {
      name: "non-object config",
      input: {
        config: "bad",
        inputs: { url: "https://youtu.be/abc123" },
      },
      message: "must be an object",
    },
    {
      name: "non-object inputs",
      input: { inputs: "bad" },
      message: "must be an object",
    },
    {
      name: "unsupported config key",
      input: {
        config: { cookies: "secrets.txt" },
        inputs: { url: "https://youtu.be/abc123" },
      },
      message: "is not supported",
    },
    {
      name: "addon env",
      input: {
        inputs: { url: "https://youtu.be/abc123" },
        env: { HOME: { fromEnv: "HOME" } },
      },
      message: "is not supported",
    },
    {
      name: "missing url",
      input: { inputs: {} },
      message: "must be a non-empty string",
    },
    {
      name: "absolute output directory",
      input: {
        config: { outputDirectory: "/tmp/downloads" },
        inputs: { url: "https://youtu.be/abc123" },
      },
      message: "must be relative",
    },
    {
      name: "escaping output directory",
      input: {
        config: { outputDirectory: "../downloads" },
        inputs: { url: "https://youtu.be/abc123" },
      },
      message: "must stay inside",
    },
    {
      name: "unsafe file name template",
      input: {
        config: { fileNameTemplate: "../%(id)s.%(ext)s" },
        inputs: { url: "https://youtu.be/abc123" },
      },
      message: "must be a basename template",
    },
    {
      name: "invalid URL scheme",
      input: {
        inputs: { url: "file:///tmp/video.mp4" },
      },
      message: "must use http or https",
    },
    {
      name: "non-YouTube host",
      input: {
        inputs: { url: "https://example.com/watch?v=abc123" },
      },
      message: "must target a supported YouTube host",
    },
    {
      name: "playlist URL",
      input: {
        inputs: { url: "https://www.youtube.com/watch?v=abc123&list=PL123" },
      },
      message: "must not include playlist",
    },
    {
      name: "playlist route",
      input: {
        inputs: { url: "https://www.youtube.com/playlist?list=PL123" },
      },
      message: "must not include playlist",
    },
    {
      name: "channel URL",
      input: {
        inputs: { url: "https://www.youtube.com/channel/UCabcdef" },
      },
      message: "must target a single YouTube video URL",
    },
    {
      name: "search URL",
      input: {
        inputs: { url: "https://www.youtube.com/results?search_query=music" },
      },
      message: "must target a single YouTube video URL",
    },
    {
      name: "home URL",
      input: {
        inputs: { url: "https://www.youtube.com/" },
      },
      message: "must target a single YouTube video URL",
    },
  ])("rejects $name", ({ input, message }) => {
    const resolved = resolveYoutubeAddon(input);

    expect(resolved.payload).toBeUndefined();
    expect(
      (resolved.issues ?? []).map((issue) => issue.message).join("\n"),
    ).toContain(message);
  });

  test("allows templated URL for execution-time validation", () => {
    const resolved = resolveYoutubeAddon({
      inputs: { url: "{{workflowInput.youtubeUrl}}" },
    });

    expect(resolved.issues).toEqual([]);
    expect(resolved.payload?.variables).toEqual({
      url: "{{workflowInput.youtubeUrl}}",
    });
  });
});
