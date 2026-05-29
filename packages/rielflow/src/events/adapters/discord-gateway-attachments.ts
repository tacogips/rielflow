import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isJsonObject, type JsonObject } from "../../shared/json";
import type { EventSourceDiagnosticSink } from "../source-adapter";
import type { DiscordGatewaySourceConfig } from "../types";

const DISCORD_PROVIDER = "discord";
const DISCORD_ATTACHMENT_DOWNLOAD_HTTP_ERROR_CLASS =
  "DiscordAttachmentDownloadHttpError";

export interface DiscordGatewayRawAttachment {
  readonly id: string;
  readonly filename: string;
  readonly url?: string;
  readonly proxyUrl?: string;
  readonly contentType?: string;
  readonly sizeBytes?: number;
  readonly width?: number;
  readonly height?: number;
}

export interface DiscordGatewayImageAttachment extends JsonObject {
  readonly id: string;
  readonly kind: "image";
  readonly mediaType?: string;
  readonly filename: string;
  readonly sizeBytes?: number;
  readonly width?: number;
  readonly height?: number;
  readonly url?: string;
  readonly proxyUrl?: string;
  readonly localPath?: string;
  readonly contentRef?: string;
  readonly source: JsonObject;
}

interface DiscordResolvedAttachment {
  readonly localPath?: string;
  readonly contentRef?: string;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function safePathSegment(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "");
  return normalized.length > 0 ? normalized.slice(0, 96) : "item";
}

function normalizeErrorClass(error: unknown): string {
  if (typeof error === "string" && error.length > 0) {
    return error;
  }
  if (error instanceof Error && error.name.length > 0) {
    return error.name;
  }
  if (error instanceof DOMException && error.name.length > 0) {
    return error.name;
  }
  return typeof error;
}

function readDiscordAttachment(
  value: unknown,
): DiscordGatewayRawAttachment | null {
  if (!isJsonObject(value)) {
    return null;
  }
  const id = optionalString(value["id"]);
  const filename = optionalString(value["filename"]);
  if (id === undefined || filename === undefined) {
    return null;
  }
  const url = optionalString(value["url"]);
  const proxyUrl =
    optionalString(value["proxy_url"]) ?? optionalString(value["proxyUrl"]);
  const contentType =
    optionalString(value["content_type"]) ??
    optionalString(value["contentType"]);
  const sizeBytes = optionalNumber(value["size"]);
  const width = optionalNumber(value["width"]);
  const height = optionalNumber(value["height"]);
  return {
    id,
    filename,
    ...(url === undefined ? {} : { url }),
    ...(proxyUrl === undefined ? {} : { proxyUrl }),
    ...(contentType === undefined ? {} : { contentType }),
    ...(sizeBytes === undefined ? {} : { sizeBytes }),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
  };
}

export function readDiscordMessageAttachments(
  value: unknown,
): readonly DiscordGatewayRawAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const attachment = readDiscordAttachment(entry);
    return attachment === null ? [] : [attachment];
  });
}

function isImageAttachment(attachment: DiscordGatewayRawAttachment): boolean {
  return (
    attachment.contentType?.startsWith("image/") === true ||
    (attachment.width !== undefined && attachment.height !== undefined)
  );
}

function relativeEventAttachmentPath(input: {
  readonly source: DiscordGatewaySourceConfig;
  readonly messageId: string;
  readonly attachment: DiscordGatewayRawAttachment;
}): string {
  const ext = path
    .extname(input.attachment.filename)
    .match(/^\.[A-Za-z0-9]{1,12}$/)
    ? path.extname(input.attachment.filename)
    : ".img";
  return path.join(
    "attachments",
    "discord-gateway",
    safePathSegment(input.source.id),
    `${safePathSegment(input.messageId)}-${safePathSegment(
      input.attachment.id,
    )}-${safePathSegment(path.basename(input.attachment.filename, ext))}${ext}`,
  );
}

async function downloadDiscordAttachment(input: {
  readonly source: DiscordGatewaySourceConfig;
  readonly messageId: string;
  readonly attachment: DiscordGatewayRawAttachment;
  readonly eventDataRoot?: string | undefined;
  readonly fetchImpl: typeof fetch;
  readonly diagnosticSink?: EventSourceDiagnosticSink | undefined;
}): Promise<DiscordResolvedAttachment> {
  if (
    input.eventDataRoot === undefined ||
    input.eventDataRoot.length === 0 ||
    input.attachment.url === undefined
  ) {
    return {};
  }
  const maxBytes = input.source.attachments?.maxBytes;
  if (
    maxBytes !== undefined &&
    input.attachment.sizeBytes !== undefined &&
    input.attachment.sizeBytes > maxBytes
  ) {
    return {};
  }
  const contentRef = relativeEventAttachmentPath(input);
  const localPath = path.join(input.eventDataRoot, contentRef);
  try {
    const response = await input.fetchImpl(input.attachment.url, {
      method: "GET",
    });
    if (!response.ok) {
      input.diagnosticSink?.({
        sourceId: input.source.id,
        httpStatus: response.status,
        errorClass: DISCORD_ATTACHMENT_DOWNLOAD_HTTP_ERROR_CLASS,
      });
      return {};
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (maxBytes !== undefined && bytes.byteLength > maxBytes) {
      return {};
    }
    await mkdir(path.dirname(localPath), { recursive: true });
    await writeFile(localPath, bytes);
    return { localPath, contentRef };
  } catch (error: unknown) {
    input.diagnosticSink?.({
      sourceId: input.source.id,
      errorClass: normalizeErrorClass(error),
    });
    return {};
  }
}

export async function resolveDiscordImageFiles(input: {
  readonly source: DiscordGatewaySourceConfig;
  readonly messageId: string;
  readonly attachments: readonly DiscordGatewayRawAttachment[];
  readonly eventDataRoot?: string | undefined;
  readonly fetchImpl: typeof fetch;
  readonly diagnosticSink?: EventSourceDiagnosticSink | undefined;
}): Promise<ReadonlyMap<string, DiscordResolvedAttachment>> {
  if (input.source.attachments?.resolveFilePaths !== true) {
    return new Map();
  }
  const entries = await Promise.all(
    input.attachments
      .filter(isImageAttachment)
      .map(
        async (attachment) =>
          [
            attachment.id,
            await downloadDiscordAttachment({ ...input, attachment }),
          ] as const,
      ),
  );
  return new Map(entries);
}

export function buildDiscordImageAttachments(input: {
  readonly source: DiscordGatewaySourceConfig;
  readonly attachments: readonly DiscordGatewayRawAttachment[];
  readonly files?: ReadonlyMap<string, DiscordResolvedAttachment>;
}): readonly DiscordGatewayImageAttachment[] {
  if (input.source.attachments?.includeImages === false) {
    return [];
  }
  return input.attachments.filter(isImageAttachment).map((attachment) => {
    const file = input.files?.get(attachment.id);
    return {
      id: attachment.id,
      kind: "image",
      ...(attachment.contentType === undefined
        ? {}
        : { mediaType: attachment.contentType }),
      filename: attachment.filename,
      ...(attachment.sizeBytes === undefined
        ? {}
        : { sizeBytes: attachment.sizeBytes }),
      ...(attachment.width === undefined ? {} : { width: attachment.width }),
      ...(attachment.height === undefined ? {} : { height: attachment.height }),
      ...(attachment.url === undefined ? {} : { url: attachment.url }),
      ...(attachment.proxyUrl === undefined
        ? {}
        : { proxyUrl: attachment.proxyUrl }),
      ...(file?.localPath === undefined ? {} : { localPath: file.localPath }),
      ...(file?.contentRef === undefined
        ? {}
        : { contentRef: file.contentRef }),
      source: {
        provider: DISCORD_PROVIDER,
        attachmentId: attachment.id,
        ...(attachment.url === undefined ? {} : { url: attachment.url }),
        ...(attachment.proxyUrl === undefined
          ? {}
          : { proxyUrl: attachment.proxyUrl }),
        ...(file?.localPath === undefined ? {} : { localPath: file.localPath }),
        ...(file?.contentRef === undefined
          ? {}
          : { contentRef: file.contentRef }),
      },
    };
  });
}

export function discordImagePathsFromAttachments(
  attachments: readonly DiscordGatewayImageAttachment[],
): readonly string[] {
  return attachments.flatMap((attachment) =>
    attachment.localPath === undefined ? [] : [attachment.localPath],
  );
}
