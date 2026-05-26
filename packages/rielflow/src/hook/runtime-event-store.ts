import type { HookEventStore } from "rielflow-hook/recorder-contracts";
import { saveHookEventToRuntimeDb } from "../workflow/runtime-db";

export const runtimeDbHookEventStore: HookEventStore = {
  async saveHookEvent(row, options = {}) {
    await saveHookEventToRuntimeDb(row, options);
  },
};
