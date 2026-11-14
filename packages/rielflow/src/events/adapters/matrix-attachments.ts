import { isJsonObject, type JsonObject } from "../../shared/json";
import type { EventSourceDiagnosticSink } from "../source-adapter";
import type { MatrixSourceConfig } from "../types";

const ATTACHMENT_MESSAGE_TYPES = new Set([
  "m.file",
  "m.image",
  "m.audio",
  "m.video",
]);
const DEFAULT_ATTACHMENT_MAX_BYTES = 65_536;
const MATRIX_ATTACHMENT_DOWNLOAD_HTTP_ERROR_CLASS =
  "MatrixAttachmentDownloadHttpError";
const MATRIX_ATTACHMENT_INVALID_MEDIA_URL_ERROR_CLASS =
  "MatrixAttachmentInvalidMediaUrl";

export interface MatrixAttachmentInput extends JsonObject {
  readonly name: string;
  readonly msgtype: string;
  readonly mediaUrl?: string;
  readonly mimetype?: string;
  readonly size?: number;
  readonly contentText?: string;
  readonly truncated?: boolean;
  readonly encrypted?: boolean;
  readonly downloadError?: string;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
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
  if (error !== null && typeof error === "object") {
    return error.constructor.name.length > 0
      ? error.constructor.name
      : "Object";
  }
  return typeof error;
}

function matrixClientUrl(homeserver: string, pathname: string): string {
  const url = new URL(pathname, `${trimTrailingSlash(homeserver)}/`);
  return url.toString();
}

function attachmentMaxBytes(source: MatrixSourceConfig): number {
  return typeof source.attachments?.maxBytes === "number"
    ? source.attachments.maxBytes
    : DEFAULT_ATTACHMENT_MAX_BYTES;
}

function defaultTextAttachmentMimeType(mimetype: string | undefined): boolean {
  if (mimetype === undefined) {
    return false;
  }
  return (
    mimetype.startsWith("text/") ||
    mimetype === "application/json" ||
    mimetype === "application/ld+json" ||
    mimetype === "application/xml" ||
    mimetype === "application/yaml" ||
    mimetype === "application/x-yaml" ||
    mimetype === "application/javascript" ||
    mimetype === "application/x-javascript" ||
    mimetype === "application/x-ndjson"
  );
}

function isTextAttachmentAllowed(input: {
  readonly source: MatrixSourceConfig;
  readonly mimetype?: string | undefined;
  readonly name: string;
}): boolean {
  const allowed = input.source.attachments?.allowedMimeTypes;
  if (allowed !== undefined) {
    return allowed.some((entry) =>
      entry.endsWith("/*")
        ? input.mimetype?.startsWith(entry.slice(0, -1)) === true
        : input.mimetype === entry,
    );
  }
  if (defaultTextAttachmentMimeType(input.mimetype)) {
    return true;
  }
  return /\.(csv|json|jsonl|log|md|txt|xml|ya?ml)$/i.test(input.name);
}

function matrixMediaDownloadUrl(
  homeserver: string,
  mediaUrl: string | undefined,
): string | undefined {
  if (mediaUrl === undefined || !mediaUrl.startsWith("mxc://")) {
    return undefined;
  }
  const withoutScheme = mediaUrl.slice("mxc://".length);
  const slashIndex = withoutScheme.indexOf("/");
  if (slashIndex <= 0 || slashIndex === withoutScheme.length - 1) {
    return undefined;
  }
  const serverName = withoutScheme.slice(0, slashIndex);
  const mediaId = withoutScheme.slice(slashIndex + 1);
  return matrixClientUrl(
    homeserver,
    `/_matrix/client/v1/media/download/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`,
  );
}

export function isMatrixAttachmentMessageType(msgtype: string): boolean {
  return ATTACHMENT_MESSAGE_TYPES.has(msgtype);
}

export function readMatrixAttachmentMetadata(
  content: JsonObject,
): MatrixAttachmentInput | null {
  const msgtype = optionalString(content["msgtype"]);
  const name = optionalString(content["body"]);
  if (
    msgtype === undefined ||
    !isMatrixAttachmentMessageType(msgtype) ||
    name === undefined
  ) {
    return null;
  }
  const info = isJsonObject(content["info"]) ? content["info"] : undefined;
  const encryptedFile = isJsonObject(content["file"])
    ? content["file"]
    : undefined;
  const mimetype = optionalString(info?.["mimetype"]);
  const size = typeof info?.["size"] === "number" ? info["size"] : undefined;
  const mediaUrl =
    optionalString(content["url"]) ?? optionalString(encryptedFile?.["url"]);
  return {
    name,
    msgtype,
    ...(mediaUrl === undefined ? {} : { mediaUrl }),
    ...(mimetype === undefined ? {} : { mimetype }),
    ...(size === undefined ? {} : { size }),
    ...(encryptedFile === undefined ? {} : { encrypted: true }),
  };
}

export async function downloadMatrixAttachmentText(input: {
  readonly source: MatrixSourceConfig;
  readonly attachment: MatrixAttachmentInput;
  readonly homeserver: string;
  readonly accessToken: string;
  readonly fetchImpl: typeof fetch;
  readonly diagnosticSink?: EventSourceDiagnosticSink | undefined;
}): Promise<MatrixAttachmentInput> {
  if (
    input.source.attachments?.downloadText !== true ||
    input.attachment.encrypted === true ||
    !isTextAttachmentAllowed({
      source: input.source,
      mimetype: input.attachment.mimetype,
      name: input.attachment.name,
    })
  ) {
    return input.attachment;
  }
  const url = matrixMediaDownloadUrl(
    input.homeserver,
    input.attachment.mediaUrl,
  );
  if (url === undefined) {
    if (input.attachment.mediaUrl !== undefined) {
      input.diagnosticSink?.({
        sourceId: input.source.id,
        errorClass: MATRIX_ATTACHMENT_INVALID_MEDIA_URL_ERROR_CLASS,
      });
      return {
        ...input.attachment,
        downloadError: MATRIX_ATTACHMENT_INVALID_MEDIA_URL_ERROR_CLASS,
      };
    }
    return input.attachment;
  }
  const maxBytes = attachmentMaxBytes(input.source);
  try {
    const response = await input.fetchImpl(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        range: `bytes=0-${String(maxBytes - 1)}`,
      },
    });
    if (!response.ok) {
      input.diagnosticSink?.({
        sourceId: input.source.id,
        httpStatus: response.status,
        errorClass: MATRIX_ATTACHMENT_DOWNLOAD_HTTP_ERROR_CLASS,
      });
      return {
        ...input.attachment,
        downloadError: MATRIX_ATTACHMENT_DOWNLOAD_HTTP_ERROR_CLASS,
      };
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const slice = bytes.slice(0, maxBytes);
    return {
      ...input.attachment,
      contentText: new TextDecoder("utf-8").decode(slice),
      truncated: bytes.length > maxBytes,
    };
  } catch (error: unknown) {
    input.diagnosticSink?.({
      sourceId: input.source.id,
      errorClass: normalizeErrorClass(error),
    });
    return {
      ...input.attachment,
      downloadError: normalizeErrorClass(error),
    };
  }
}

export function textWithMatrixAttachment(input: {
  readonly text: string;
  readonly attachment?: MatrixAttachmentInput;
}): string {
  const contentText = input.attachment?.contentText;
  return contentText === undefined || contentText.length === 0
    ? input.text
    : `${input.text}\n\n${contentText}`;
}
