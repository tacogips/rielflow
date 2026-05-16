import type { WorkflowSessionState } from "../session";
import type { LoadOptions } from "../types";
import { saveSessionSnapshotToRuntimeDb } from "./event-records";

export interface SessionSnapshotIndexer {
  saveSnapshot(session: WorkflowSessionState): Promise<void>;
}

export function createRuntimeDbSessionSnapshotIndexer(
  options: LoadOptions = {},
): SessionSnapshotIndexer {
  return {
    async saveSnapshot(session) {
      await saveSessionSnapshotToRuntimeDb(session, options);
    },
  };
}
