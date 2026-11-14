import { createHash } from "node:crypto";
import { isJsonObject } from "../../shared/json";
import type { EventSourceAdapter, RawExternalEvent } from "../source-adapter";
import type { ExternalEventEnvelope, S3RepositorySourceConfig } from "../types";

interface ExtractedS3ObjectEvent {
  readonly bucket: string;
  readonly key: string;
  readonly region?: string;
  readonly versionId?: string;
  readonly etag?: string;
  readonly size?: number;
  readonly sequencer?: string;
  readonly eventName?: string;
  readonly contentType?: string;
  readonly eventId?: string;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function decodeObjectKey(key: string): string {
  return decodeURIComponent(key.replace(/\+/g, " "));
}

function isSafeRepositoryPath(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.split("/").some((segment) => segment === "." || segment === "..")
  );
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function firstRecord(body: unknown): unknown {
  if (!isJsonObject(body)) {
    return undefined;
  }
  const records = body["Records"];
  if (Array.isArray(records)) {
    return records[0];
  }
  return body;
}

function extractS3ObjectEvent(body: unknown): ExtractedS3ObjectEvent {
  const record = firstRecord(body);
  if (!isJsonObject(record)) {
    throw new Error("S3 repository event must be a JSON object");
  }
  const s3 = isJsonObject(record["s3"]) ? record["s3"] : undefined;
  const bucketObject =
    s3 !== undefined && isJsonObject(s3["bucket"]) ? s3["bucket"] : undefined;
  const objectObject =
    s3 !== undefined && isJsonObject(s3["object"]) ? s3["object"] : undefined;
  const bucket =
    readString(bucketObject?.["name"]) ??
    readString(record["bucket"]) ??
    readString(record["bucketName"]);
  const key =
    readString(objectObject?.["key"]) ??
    readString(record["key"]) ??
    readString(record["objectKey"]);
  if (bucket === undefined || key === undefined) {
    throw new Error("S3 repository event requires bucket and object key");
  }
  const region = readString(record["awsRegion"]);
  const versionId = readString(objectObject?.["versionId"]);
  const etag = readString(objectObject?.["eTag"]);
  const size = readNumber(objectObject?.["size"]);
  const sequencer = readString(objectObject?.["sequencer"]);
  const eventName = readString(record["eventName"]);
  const contentType = readString(record["contentType"]);
  const eventId = readString(record["eventID"]);
  return {
    bucket,
    key: decodeObjectKey(key),
    ...(region === undefined ? {} : { region }),
    ...(versionId === undefined ? {} : { versionId }),
    ...(etag === undefined ? {} : { etag }),
    ...(size === undefined ? {} : { size }),
    ...(sequencer === undefined ? {} : { sequencer }),
    ...(eventName === undefined ? {} : { eventName }),
    ...(contentType === undefined ? {} : { contentType }),
    ...(eventId === undefined ? {} : { eventId }),
  };
}

function deriveRepositoryPath(
  source: S3RepositorySourceConfig,
  key: string,
): string {
  const rootPrefix = source.rootPrefix ?? "";
  if (rootPrefix.length > 0 && !key.startsWith(rootPrefix)) {
    throw new Error("S3 object key is outside the configured root prefix");
  }
  const relativePath =
    rootPrefix.length === 0 ? key : key.slice(rootPrefix.length);
  if (!isSafeRepositoryPath(relativePath)) {
    throw new Error(
      "S3 object key cannot be represented as a safe repository path",
    );
  }
  const suffixes = source.filters?.suffixes;
  if (
    suffixes !== undefined &&
    suffixes.length > 0 &&
    !suffixes.some((suffix) => relativePath.endsWith(suffix))
  ) {
    throw new Error("S3 object key does not match configured suffix filters");
  }
  return relativePath;
}

export function normalizeS3RepositoryRawEvent(
  source: S3RepositorySourceConfig,
  raw: RawExternalEvent,
): ExternalEventEnvelope {
  const extracted = extractS3ObjectEvent(raw.body);
  if (extracted.bucket !== source.bucket) {
    throw new Error("S3 event bucket does not match source configuration");
  }
  const repositoryPath = deriveRepositoryPath(source, extracted.key);
  const eventIdentity =
    extracted.versionId ??
    extracted.sequencer ??
    extracted.eventId ??
    raw.receivedAt;
  const eventId =
    extracted.eventId ??
    `${source.id}:${extracted.bucket}:${extracted.key}:${eventIdentity}`;
  return {
    sourceId: source.id,
    eventId,
    provider: source.provider,
    eventType: "repository.file.created",
    receivedAt: raw.receivedAt,
    dedupeKey: hash(
      `${source.id}:${extracted.bucket}:${extracted.key}:${eventIdentity}`,
    ),
    input: {
      repository: {
        provider: source.provider,
        bucket: source.bucket,
        ...(source.region === undefined ? {} : { region: source.region }),
        ...(source.rootPrefix === undefined
          ? {}
          : { rootPrefix: source.rootPrefix }),
      },
      file: {
        path: repositoryPath,
        s3Key: extracted.key,
        ...(extracted.versionId === undefined
          ? {}
          : { versionId: extracted.versionId }),
        ...(extracted.etag === undefined ? {} : { etag: extracted.etag }),
        ...(extracted.size === undefined ? {} : { size: extracted.size }),
        ...(extracted.contentType === undefined
          ? {}
          : { contentType: extracted.contentType }),
      },
      receiver: {
        mode: source.eventReceiver.mode,
        ...(extracted.eventName === undefined
          ? {}
          : { eventName: extracted.eventName }),
        ...(extracted.sequencer === undefined
          ? {}
          : { sequencer: extracted.sequencer }),
      },
    },
    ...(raw.rawRef === undefined ? {} : { rawRef: raw.rawRef }),
  };
}

export function createS3RepositoryEventSourceAdapter(): EventSourceAdapter {
  return {
    kind: "s3-repository",
    capabilities: {
      eventTypes: ["repository.file.created"],
      supportsStart: false,
      webhook: true,
    },
    async start(input) {
      return {
        sourceId: input.source.id,
        stop: async () => {},
      };
    },
    async normalize(raw): Promise<ExternalEventEnvelope> {
      const source = raw.body;
      if (!isJsonObject(source)) {
        throw new Error("S3 repository raw event body must be a JSON object");
      }
      const bucket = readString(source["bucket"]) ?? "unknown";
      return normalizeS3RepositoryRawEvent(
        {
          id: raw.sourceId,
          kind: "s3-repository",
          provider: "s3-compatible",
          bucket,
          eventReceiver: { mode: "webhook-bridge" },
          objectAccess: { mode: "metadata-only" },
        },
        raw,
      );
    },
  };
}
