import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type {
  IdempotentMutationLookup,
  ManagerSessionStore,
} from "../manager-session-store";

export interface IdempotencyStore
  extends Pick<
    ManagerSessionStore,
    | "claimIdempotentMutation"
    | "completeIdempotentMutation"
    | "failIdempotentMutation"
    | "loadIdempotentResult"
  > {}

const PENDING_POLL_INTERVAL_MS = 10;
const PENDING_POLL_TIMEOUT_MS = 2000;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(
      ([key, entryValue]) =>
        `${JSON.stringify(key)}:${stableStringify(entryValue)}`,
    )
    .join(",")}}`;
}

export async function runIdempotentMutation<TResult>(args: {
  readonly mutationName: string;
  readonly idempotencyKey: string | undefined;
  readonly managerSessionId: string | undefined;
  readonly normalizedPayload: unknown;
  readonly store: IdempotencyStore | undefined;
  readonly action: () => Promise<TResult>;
  readonly now: string;
}): Promise<TResult> {
  if (args.idempotencyKey === undefined) {
    return await args.action();
  }
  if (args.managerSessionId === undefined) {
    throw new Error(
      `${args.mutationName} idempotency requires a managerSessionId scope`,
    );
  }
  if (args.store === undefined) {
    return await args.action();
  }

  const normalizedRequestHash = `sha256:${sha256Hex(
    stableStringify(args.normalizedPayload),
  )}`;
  const claimToken = randomUUID();
  const lookup: IdempotentMutationLookup = {
    mutationName: args.mutationName,
    managerSessionId: args.managerSessionId,
    idempotencyKey: args.idempotencyKey,
  };
  const claim = await args.store.claimIdempotentMutation({
    ...lookup,
    normalizedRequestHash,
    claimToken,
    claimedAt: args.now,
  });
  if (claim.normalizedRequestHash !== normalizedRequestHash) {
    throw new Error(
      `${args.mutationName} idempotency conflict for key '${args.idempotencyKey}'`,
    );
  }
  if (claim.status === "completed") {
    return parseCompletedIdempotentResult<TResult>(args.mutationName, claim);
  }
  if (claim.status === "failed") {
    throw parseFailedIdempotentResult(args.mutationName, claim);
  }
  if (claim.claimToken !== claimToken) {
    return await waitForCompletedIdempotentResult<TResult>({
      lookup,
      store: args.store,
      mutationName: args.mutationName,
      idempotencyKey: args.idempotencyKey,
      normalizedRequestHash,
    });
  }

  let result: TResult;
  try {
    result = await args.action();
  } catch (error) {
    await args.store.failIdempotentMutation({
      ...lookup,
      normalizedRequestHash,
      claimToken,
      errorJson: JSON.stringify(toIdempotentFailure(error)),
      failedAt: args.now,
    });
    throw error;
  }
  const completed = await args.store.completeIdempotentMutation({
    ...lookup,
    normalizedRequestHash,
    claimToken,
    responseJson: JSON.stringify(result),
    completedAt: args.now,
  });
  if (completed === null) {
    throw new Error(
      `${args.mutationName} idempotency claim for key '${args.idempotencyKey}' could not be completed`,
    );
  }
  return result;
}

interface IdempotentFailure {
  readonly name: string;
  readonly message: string;
}

function toIdempotentFailure(error: unknown): IdempotentFailure {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }
  return {
    name: "Error",
    message: String(error),
  };
}

function parseCompletedIdempotentResult<TResult>(
  mutationName: string,
  claim: { readonly responseJson?: string },
): TResult {
  if (claim.responseJson === undefined) {
    throw new Error(`${mutationName} idempotency completed without response`);
  }
  return JSON.parse(claim.responseJson) as TResult;
}

function parseFailedIdempotentResult(
  mutationName: string,
  claim: { readonly errorJson?: string },
): Error {
  if (claim.errorJson === undefined) {
    return new Error(`${mutationName} idempotency failed without error`);
  }
  const failure = JSON.parse(claim.errorJson) as Partial<IdempotentFailure>;
  const message =
    typeof failure.message === "string" && failure.message.length > 0
      ? failure.message
      : `${mutationName} idempotency failed`;
  const error = new Error(message);
  error.name =
    typeof failure.name === "string" && failure.name.length > 0
      ? failure.name
      : "Error";
  return error;
}

async function waitForCompletedIdempotentResult<TResult>(args: {
  readonly lookup: IdempotentMutationLookup;
  readonly store: IdempotencyStore;
  readonly mutationName: string;
  readonly idempotencyKey: string;
  readonly normalizedRequestHash: string;
}): Promise<TResult> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= PENDING_POLL_TIMEOUT_MS) {
    await delay(PENDING_POLL_INTERVAL_MS);
    const current = await args.store.loadIdempotentResult(args.lookup);
    if (current === null) {
      continue;
    }
    if (current.normalizedRequestHash !== args.normalizedRequestHash) {
      throw new Error(
        `${args.mutationName} idempotency conflict for key '${args.idempotencyKey}'`,
      );
    }
    if (current.status === "completed") {
      return parseCompletedIdempotentResult<TResult>(
        args.mutationName,
        current,
      );
    }
    if (current.status === "failed") {
      throw parseFailedIdempotentResult(args.mutationName, current);
    }
  }
  throw new Error(
    `${args.mutationName} idempotency pending timeout for key '${args.idempotencyKey}'`,
  );
}

export function createManagerMessageId(): string {
  return `mgrmsg-${randomUUID()}`;
}
