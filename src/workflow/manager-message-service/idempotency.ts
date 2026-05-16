import { createHash, randomUUID } from "node:crypto";
import type {
  IdempotentMutationLookup,
  IdempotentMutationRecord,
  ManagerSessionStore,
} from "../manager-session-store";

export interface IdempotencyStore
  extends Pick<
    ManagerSessionStore,
    "loadIdempotentResult" | "saveIdempotentResult"
  > {}

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
  const lookup: IdempotentMutationLookup = {
    mutationName: args.mutationName,
    managerSessionId: args.managerSessionId,
    idempotencyKey: args.idempotencyKey,
  };
  const existing = await args.store.loadIdempotentResult(lookup);
  if (existing !== null) {
    if (existing.normalizedRequestHash !== normalizedRequestHash) {
      throw new Error(
        `${args.mutationName} idempotency conflict for key '${args.idempotencyKey}'`,
      );
    }
    return JSON.parse(existing.responseJson) as TResult;
  }

  const result = await args.action();
  const record: IdempotentMutationRecord = {
    mutationName: args.mutationName,
    managerSessionId: args.managerSessionId,
    idempotencyKey: args.idempotencyKey,
    normalizedRequestHash,
    responseJson: JSON.stringify(result),
    completedAt: args.now,
  };
  await args.store.saveIdempotentResult(record);
  return result;
}

export function createManagerMessageId(): string {
  return `mgrmsg-${randomUUID()}`;
}
