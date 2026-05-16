import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ScheduledEventManager } from "../events/scheduled-event-manager";
import { err, ok, type Result } from "./result";
import {
  isSafeSessionId,
  normalizeSessionState,
  reconcileTerminalWorkflowSleepScheduledEvents,
  type WorkflowSessionState,
} from "./session";
import { resolveRootDataDir } from "./paths";
import {
  createRuntimeDbSessionSnapshotIndexer,
  type SessionSnapshotIndexer,
} from "./runtime-db";
import { ROOT_DATA_SESSIONS_SUBDIR, type LoadOptions } from "./types";

export interface SessionStoreOptions extends LoadOptions {
  readonly sessionStoreRoot?: string;
  readonly scheduledEventManager?: ScheduledEventManager;
  readonly sessionSnapshotIndexer?: SessionSnapshotIndexer;
}

export interface SessionStoreFailure {
  readonly code: "INVALID_SESSION_ID" | "NOT_FOUND" | "IO" | "INVALID_DATA";
  readonly message: string;
}

function resolveSessionStoreRoot(options: SessionStoreOptions = {}): string {
  if (options.sessionStoreRoot !== undefined) {
    return path.isAbsolute(options.sessionStoreRoot)
      ? options.sessionStoreRoot
      : path.resolve(options.cwd ?? process.cwd(), options.sessionStoreRoot);
  }

  const env = options.env ?? process.env;
  const envRoot = env["DIVEDRA_SESSION_STORE"];
  if (typeof envRoot === "string" && envRoot.length > 0) {
    return path.isAbsolute(envRoot)
      ? envRoot
      : path.resolve(options.cwd ?? process.cwd(), envRoot);
  }

  return path.join(resolveRootDataDir(options), ROOT_DATA_SESSIONS_SUBDIR);
}

function sessionFilePath(sessionStoreRoot: string, sessionId: string): string {
  return path.join(sessionStoreRoot, `${sessionId}.json`);
}

async function saveSessionSnapshotIndex(
  session: WorkflowSessionState,
  options: SessionStoreOptions,
): Promise<void> {
  const indexer =
    options.sessionSnapshotIndexer ??
    createRuntimeDbSessionSnapshotIndexer(options);
  await indexer.saveSnapshot(session);
}

export async function saveSession(
  session: WorkflowSessionState,
  options: SessionStoreOptions = {},
): Promise<Result<string, SessionStoreFailure>> {
  const sessionToPersist = reconcileTerminalWorkflowSleepScheduledEvents(
    session,
    options.scheduledEventManager,
  );
  if (!isSafeSessionId(session.sessionId)) {
    return err({
      code: "INVALID_SESSION_ID",
      message: `invalid session id '${session.sessionId}'`,
    });
  }

  const root = resolveSessionStoreRoot(options);
  const target = sessionFilePath(root, session.sessionId);

  try {
    await mkdir(root, { recursive: true });
    await writeFile(
      target,
      `${JSON.stringify(sessionToPersist, null, 2)}\n`,
      "utf8",
    );
    try {
      await saveSessionSnapshotIndex(sessionToPersist, options);
    } catch {
      // runtime DB index is best-effort and must not break primary file persistence
    }
    return ok(target);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err({
      code: "IO",
      message: `failed writing session file: ${message}`,
    });
  }
}

export async function loadSession(
  sessionId: string,
  options: SessionStoreOptions = {},
): Promise<Result<WorkflowSessionState, SessionStoreFailure>> {
  if (!isSafeSessionId(sessionId)) {
    return err({
      code: "INVALID_SESSION_ID",
      message: `invalid session id '${sessionId}'`,
    });
  }

  const root = resolveSessionStoreRoot(options);
  const target = sessionFilePath(root, sessionId);

  try {
    const content = await readFile(target, "utf8");
    const parsed = JSON.parse(content) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return err({
        code: "INVALID_DATA",
        message: "session file content must be an object",
      });
    }
    return ok(normalizeSessionState(parsed as WorkflowSessionState));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    if (message.includes("ENOENT")) {
      return err({
        code: "NOT_FOUND",
        message: `session not found: ${sessionId}`,
      });
    }
    return err({
      code: "IO",
      message: `failed reading session file: ${message}`,
    });
  }
}

export async function listSessions(
  options: SessionStoreOptions = {},
): Promise<Result<readonly string[], SessionStoreFailure>> {
  const root = resolveSessionStoreRoot(options);
  try {
    await mkdir(root, { recursive: true });
    const files = await readdir(root, { withFileTypes: true });
    const sessionIds = files
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name.replace(/\.json$/, ""));
    return ok(sessionIds);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err({ code: "IO", message: `failed listing sessions: ${message}` });
  }
}

export async function deleteSession(
  sessionId: string,
  options: SessionStoreOptions = {},
): Promise<Result<void, SessionStoreFailure>> {
  if (!isSafeSessionId(sessionId)) {
    return err({
      code: "INVALID_SESSION_ID",
      message: `invalid session id '${sessionId}'`,
    });
  }

  const root = resolveSessionStoreRoot(options);
  const target = sessionFilePath(root, sessionId);

  try {
    await rm(target, { force: true });
    return ok(undefined);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err({
      code: "IO",
      message: `failed deleting session file: ${message}`,
    });
  }
}

export function getSessionStoreRoot(options: SessionStoreOptions = {}): string {
  return resolveSessionStoreRoot(options);
}
