import { describe, expect, test } from "vitest";
import { normalizeS3RepositoryRawEvent } from "./s3-repository";

describe("S3 repository event adapter", () => {
  test("normalizes AWS-style object-created metadata", () => {
    const envelope = normalizeS3RepositoryRawEvent(
      {
        id: "incoming-docs",
        kind: "s3-repository",
        provider: "s3-compatible",
        bucket: "team-docs",
        rootPrefix: "incoming/",
        eventReceiver: { mode: "webhook-bridge" },
        objectAccess: { mode: "metadata-only" },
        filters: { suffixes: [".md"] },
      },
      {
        sourceId: "incoming-docs",
        receivedAt: "2026-04-20T00:00:00.000Z",
        body: {
          Records: [
            {
              eventID: "event-1",
              eventName: "ObjectCreated:Put",
              awsRegion: "ap-northeast-1",
              s3: {
                bucket: { name: "team-docs" },
                object: {
                  key: "incoming/plans/release.md",
                  versionId: "v1",
                  eTag: "abc",
                  size: 123,
                  sequencer: "seq-1",
                },
              },
            },
          ],
        },
      },
    );

    expect(envelope.eventType).toBe("repository.file.created");
    expect(envelope.input).toEqual({
      repository: {
        provider: "s3-compatible",
        bucket: "team-docs",
        rootPrefix: "incoming/",
      },
      file: {
        path: "plans/release.md",
        s3Key: "incoming/plans/release.md",
        versionId: "v1",
        etag: "abc",
        size: 123,
      },
      receiver: {
        mode: "webhook-bridge",
        eventName: "ObjectCreated:Put",
        sequencer: "seq-1",
      },
    });
  });

  test("rejects unsafe repository paths", () => {
    expect(() =>
      normalizeS3RepositoryRawEvent(
        {
          id: "incoming-docs",
          kind: "s3-repository",
          provider: "s3-compatible",
          bucket: "team-docs",
          rootPrefix: "incoming/",
          eventReceiver: { mode: "webhook-bridge" },
          objectAccess: { mode: "metadata-only" },
        },
        {
          sourceId: "incoming-docs",
          receivedAt: "2026-04-20T00:00:00.000Z",
          body: {
            bucket: "team-docs",
            key: "incoming/../secret.md",
          },
        },
      ),
    ).toThrow("safe repository path");
  });
});
