import type { HookEventStore } from "divedra-hook/recorder-contracts";
import { saveHookEventToRuntimeDb } from "../workflow/runtime-db";

export const runtimeDbHookEventStore: HookEventStore = {
  async saveHookEvent(row, options = {}) {
    await saveHookEventToRuntimeDb(row, options);
  },
};
