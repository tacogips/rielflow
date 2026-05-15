import { describe, expect, test } from "vitest";
import { createScheduledEventManager } from "./scheduled-event-manager";
import {
  buildWorkflowExecutionClientOptions,
  workflowTriggerLocalEngineOverrides,
} from "./trigger-runner/sticky-dispatch-planning";

describe("workflow trigger runner options", () => {
  test("preserves the shared scheduled event manager for local workflow starts and resumes", () => {
    const scheduledEventManager = createScheduledEventManager();

    expect(
      buildWorkflowExecutionClientOptions("demo", {
        scheduledEventManager,
      }).scheduledEventManager,
    ).toBe(scheduledEventManager);
    expect(
      workflowTriggerLocalEngineOverrides({
        scheduledEventManager,
      }).scheduledEventManager,
    ).toBe(scheduledEventManager);

    scheduledEventManager.stop();
  });
});
