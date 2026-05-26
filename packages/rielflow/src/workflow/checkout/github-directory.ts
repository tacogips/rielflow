import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isSafeWorkflowName } from "../paths";
import { err, ok, type Result } from "../result";
import type { WorkflowCheckoutFailure } from "./types";

export interface GitHubDirectoryUrl {
  readonly owner: string;
  readonly repository: string;
  readonly ref: string;
  readonly directoryPath: string;
  readonly workflowName: string;
}

export interface GitHubDirectoryFetch {
  readonly sourceUrl: string;
  readonly destinationDirectory: string;
  readonly fetchImpl?: typeof fetch;
}

interface GitHubDirectoryUrlParts {
  readonly owner: string;
  readonly repository: string;
  readonly pathSegments: readonly string[];
  readonly workflowName: string;
}

interface GitHubContentsEntry {
  readonly type: string;
  readonly path: string;
  readonly download_url?: string | null;
}

function checkoutFailure(
  code: WorkflowCheckoutFailure["code"],
  message: string,
): WorkflowCheckoutFailure {
  return { code, message };
}

function parseUrlParts(
  sourceUrl: string,
): Result<GitHubDirectoryUrlParts, WorkflowCheckoutFailure> {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return err(checkoutFailure("INVALID_SOURCE_URL", "source URL is invalid"));
  }

  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
    return err(
      checkoutFailure(
        "UNSUPPORTED_SOURCE_URL",
        "workflow checkout supports only https://github.com directory URLs",
      ),
    );
  }

  let segments: string[];
  try {
    segments = parsed.pathname
      .split("/")
      .filter((segment) => segment.length > 0)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return err(
      checkoutFailure(
        "INVALID_SOURCE_URL",
        "source URL path contains invalid percent encoding",
      ),
    );
  }
  const [owner, repository, treeSegment, ...pathSegments] = segments;
  if (
    owner === undefined ||
    repository === undefined ||
    treeSegment !== "tree" ||
    pathSegments.length < 2
  ) {
    return err(
      checkoutFailure(
        "INVALID_SOURCE_URL",
        "expected https://github.com/<owner>/<repo>/tree/<ref>/<workflow-directory-path>",
      ),
    );
  }

  const workflowName = pathSegments[pathSegments.length - 1];
  if (workflowName === undefined || !isSafeWorkflowName(workflowName)) {
    return err({
      code: "INVALID_WORKFLOW_NAME",
      message: `invalid workflow name '${workflowName ?? ""}'`,
    });
  }

  return ok({ owner, repository, pathSegments, workflowName });
}

export function parseGitHubDirectoryUrl(
  sourceUrl: string,
): Result<GitHubDirectoryUrl, WorkflowCheckoutFailure> {
  const parts = parseUrlParts(sourceUrl);
  if (!parts.ok) {
    return parts;
  }

  const [ref, ...directorySegments] = parts.value.pathSegments;
  if (ref === undefined || directorySegments.length === 0) {
    return err(
      checkoutFailure(
        "INVALID_SOURCE_URL",
        "GitHub directory URL must include a ref and workflow directory path",
      ),
    );
  }

  return ok({
    owner: parts.value.owner,
    repository: parts.value.repository,
    ref,
    directoryPath: directorySegments.join("/"),
    workflowName: parts.value.workflowName,
  });
}

function encodeGitHubPath(value: string): string {
  return value
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildContentsApiUrl(input: {
  readonly owner: string;
  readonly repository: string;
  readonly ref: string;
  readonly directoryPath: string;
}): string {
  return `https://api.github.com/repos/${encodeURIComponent(
    input.owner,
  )}/${encodeURIComponent(input.repository)}/contents/${encodeGitHubPath(
    input.directoryPath,
  )}?ref=${encodeURIComponent(input.ref)}`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseContentsEntry(value: unknown): GitHubContentsEntry | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const type = value["type"];
  const entryPath = value["path"];
  const downloadUrl = value["download_url"];
  if (typeof type !== "string" || typeof entryPath !== "string") {
    return undefined;
  }
  return {
    type,
    path: entryPath,
    ...(typeof downloadUrl === "string" || downloadUrl === null
      ? { download_url: downloadUrl }
      : {}),
  };
}

async function fetchDirectoryContents(
  input: GitHubDirectoryUrl & { readonly fetchImpl: typeof fetch },
): Promise<Result<readonly GitHubContentsEntry[], WorkflowCheckoutFailure>> {
  let response: Response;
  const apiUrl = buildContentsApiUrl(input);
  try {
    response = await input.fetchImpl(apiUrl);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err(
      checkoutFailure("FETCH_FAILED", `GitHub fetch failed: ${message}`),
    );
  }

  if (response.status === 404) {
    return err(
      checkoutFailure(
        "INVALID_REMOTE_DIRECTORY",
        `GitHub directory was not found for ref '${input.ref}' and path '${input.directoryPath}'`,
      ),
    );
  }
  if (!response.ok) {
    return err(
      checkoutFailure(
        "FETCH_FAILED",
        `GitHub contents API returned HTTP ${String(response.status)} for '${input.directoryPath}'`,
      ),
    );
  }

  let payload: unknown;
  try {
    payload = (await response.json()) as unknown;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err(
      checkoutFailure(
        "FETCH_FAILED",
        `GitHub contents response is not JSON: ${message}`,
      ),
    );
  }
  if (!Array.isArray(payload)) {
    return err(
      checkoutFailure(
        "INVALID_REMOTE_DIRECTORY",
        `GitHub URL does not resolve to a directory: ${input.directoryPath}`,
      ),
    );
  }

  const entries = payload.map(parseContentsEntry);
  if (entries.some((entry) => entry === undefined)) {
    return err(
      checkoutFailure(
        "FETCH_FAILED",
        `GitHub contents response for '${input.directoryPath}' contains an unsupported entry`,
      ),
    );
  }
  return ok(entries as readonly GitHubContentsEntry[]);
}

function candidateUrls(
  parts: GitHubDirectoryUrlParts,
): readonly GitHubDirectoryUrl[] {
  const candidates: GitHubDirectoryUrl[] = [];
  for (let index = 1; index < parts.pathSegments.length; index += 1) {
    candidates.push({
      owner: parts.owner,
      repository: parts.repository,
      ref: parts.pathSegments.slice(0, index).join("/"),
      directoryPath: parts.pathSegments.slice(index).join("/"),
      workflowName: parts.workflowName,
    });
  }
  return candidates;
}

async function resolveRemoteDirectory(
  sourceUrl: string,
  fetchImpl: typeof fetch,
): Promise<
  Result<
    {
      readonly parsed: GitHubDirectoryUrl;
      readonly entries: readonly GitHubContentsEntry[];
    },
    WorkflowCheckoutFailure
  >
> {
  const parts = parseUrlParts(sourceUrl);
  if (!parts.ok) {
    return parts;
  }

  const matches: {
    readonly parsed: GitHubDirectoryUrl;
    readonly entries: readonly GitHubContentsEntry[];
  }[] = [];
  let firstFetchFailure: WorkflowCheckoutFailure | undefined;
  for (const candidate of candidateUrls(parts.value)) {
    const fetched = await fetchDirectoryContents({ ...candidate, fetchImpl });
    if (fetched.ok) {
      matches.push({ parsed: candidate, entries: fetched.value });
      continue;
    }
    if (
      fetched.error.code !== "INVALID_REMOTE_DIRECTORY" &&
      firstFetchFailure === undefined
    ) {
      firstFetchFailure = fetched.error;
    }
  }

  if (matches.length === 1) {
    const [match] = matches;
    return match === undefined
      ? err(
          checkoutFailure("FETCH_FAILED", "GitHub directory resolution failed"),
        )
      : ok(match);
  }
  if (matches.length > 1) {
    return err(
      checkoutFailure(
        "AMBIGUOUS_GITHUB_DIRECTORY_URL",
        "GitHub URL could resolve through multiple ref/path splits; use a less ambiguous ref or directory path",
      ),
    );
  }
  return err(
    firstFetchFailure ??
      checkoutFailure(
        "INVALID_REMOTE_DIRECTORY",
        "GitHub URL did not resolve to a workflow directory",
      ),
  );
}

function relativeEntryPath(
  selectedDirectoryPath: string,
  entryPath: string,
): Result<string, WorkflowCheckoutFailure> {
  const prefix = `${selectedDirectoryPath}/`;
  if (!entryPath.startsWith(prefix)) {
    return err(
      checkoutFailure(
        "INVALID_REMOTE_DIRECTORY",
        `GitHub entry path escapes selected directory: ${entryPath}`,
      ),
    );
  }
  const relativePath = entryPath.slice(prefix.length);
  const segments = relativePath.split("/");
  if (
    relativePath.length === 0 ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment === ".git",
    )
  ) {
    return err(
      checkoutFailure(
        "INVALID_REMOTE_DIRECTORY",
        `GitHub entry path is not safe to install: ${entryPath}`,
      ),
    );
  }
  return ok(relativePath);
}

async function downloadFile(input: {
  readonly fetchImpl: typeof fetch;
  readonly url: string;
  readonly destinationPath: string;
}): Promise<Result<void, WorkflowCheckoutFailure>> {
  let response: Response;
  try {
    response = await input.fetchImpl(input.url);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err(
      checkoutFailure("FETCH_FAILED", `GitHub file fetch failed: ${message}`),
    );
  }
  if (!response.ok) {
    return err(
      checkoutFailure(
        "FETCH_FAILED",
        `GitHub file download returned HTTP ${String(response.status)} for '${input.url}'`,
      ),
    );
  }
  await mkdir(path.dirname(input.destinationPath), { recursive: true });
  await writeFile(
    input.destinationPath,
    new Uint8Array(await response.arrayBuffer()),
  );
  return ok(undefined);
}

async function downloadDirectory(input: {
  readonly parsed: GitHubDirectoryUrl;
  readonly entries: readonly GitHubContentsEntry[];
  readonly destinationDirectory: string;
  readonly fetchImpl: typeof fetch;
}): Promise<Result<void, WorkflowCheckoutFailure>> {
  for (const entry of input.entries) {
    const relativePath = relativeEntryPath(
      input.parsed.directoryPath,
      entry.path,
    );
    if (!relativePath.ok) {
      return relativePath;
    }
    const destinationPath = path.join(
      input.destinationDirectory,
      relativePath.value,
    );
    if (entry.type === "file") {
      if (entry.download_url === undefined || entry.download_url === null) {
        return err(
          checkoutFailure(
            "FETCH_FAILED",
            `GitHub file entry does not include download_url: ${entry.path}`,
          ),
        );
      }
      const downloaded = await downloadFile({
        fetchImpl: input.fetchImpl,
        url: entry.download_url,
        destinationPath,
      });
      if (!downloaded.ok) {
        return downloaded;
      }
      continue;
    }
    if (entry.type === "dir") {
      const childContents = await fetchDirectoryContents({
        ...input.parsed,
        directoryPath: entry.path,
        fetchImpl: input.fetchImpl,
      });
      if (!childContents.ok) {
        return childContents;
      }
      const downloaded = await downloadDirectory({
        ...input,
        entries: childContents.value,
      });
      if (!downloaded.ok) {
        return downloaded;
      }
      continue;
    }
    return err(
      checkoutFailure(
        "FETCH_FAILED",
        `GitHub entry type '${entry.type}' is not supported for checkout`,
      ),
    );
  }
  return ok(undefined);
}

export async function fetchGitHubDirectoryToStaging(
  input: GitHubDirectoryFetch,
): Promise<Result<GitHubDirectoryUrl, WorkflowCheckoutFailure>> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const resolved = await resolveRemoteDirectory(input.sourceUrl, fetchImpl);
  if (!resolved.ok) {
    return resolved;
  }

  await mkdir(input.destinationDirectory, { recursive: true });
  const downloaded = await downloadDirectory({
    parsed: resolved.value.parsed,
    entries: resolved.value.entries,
    destinationDirectory: input.destinationDirectory,
    fetchImpl,
  });
  if (!downloaded.ok) {
    return downloaded;
  }
  return ok(resolved.value.parsed);
}
