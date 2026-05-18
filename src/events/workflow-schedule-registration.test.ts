import { describe, expect, test } from "vitest";
import { createWorkflowScheduleRegistrationValidator } from "./workflow-schedule-registration";

describe("workflow schedule registration validator", () => {
  test("accepts a ready one-time decision after workflow catalog resolution", async () => {
    const validator = createWorkflowScheduleRegistrationValidator();

    const result = await validator.validate({
      workflowRoot: "./examples",
      hasSafeReplyDestination: true,
      output: {
        payload: {
          status: "ready",
          workflowName: "worker-only-single-step",
          confidence: 0.98,
          schedule: {
            kind: "one-time",
            timezone: "UTC",
            dueAt: "2026-05-19T09:00:00.000Z",
          },
          workflowInput: { topic: "release" },
          confirmationText: "Scheduled worker-only-single-step.",
        },
      },
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.nextDueAt).toBe("2026-05-19T09:00:00.000Z");
      expect(result.decision.workflowName).toBe("worker-only-single-step");
    }
  });

  test("requires clarification for ambiguous workflow names and invalid cron", async () => {
    const validator = createWorkflowScheduleRegistrationValidator();

    const ambiguous = await validator.validate({
      workflowRoot: "./examples",
      hasSafeReplyDestination: true,
      output: {
        status: "ready",
        workflowName: "worker",
        schedule: {
          kind: "one-time",
          timezone: "UTC",
          dueAt: "2026-05-19T09:00:00.000Z",
        },
        workflowInput: {},
        confirmationText: "Scheduled worker.",
      },
    });
    expect(ambiguous.status).toBe("needs-clarification");

    const invalidCron = await validator.validate({
      workflowRoot: "./examples",
      hasSafeReplyDestination: true,
      output: {
        status: "ready",
        workflowName: "worker-only-single-step",
        schedule: {
          kind: "recurring",
          timezone: "UTC",
          cron: "not cron",
        },
        workflowInput: {},
        confirmationText: "Scheduled worker-only-single-step.",
      },
    });
    expect(invalidCron.status).toBe("needs-clarification");
  });

  test("computes recurring nextDueAt instead of trusting resolver output", async () => {
    const validator = createWorkflowScheduleRegistrationValidator();

    const result = await validator.validate({
      workflowRoot: "./examples",
      hasSafeReplyDestination: true,
      now: new Date("2026-05-18T00:00:00.000Z"),
      output: {
        status: "ready",
        workflowName: "worker-only-single-step",
        schedule: {
          kind: "recurring",
          timezone: "UTC",
          cron: "0 9 * * *",
          nextDueAt: "2026-01-01T00:00:00.000Z",
        },
        workflowInput: {},
        confirmationText: "Scheduled worker-only-single-step.",
      },
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.nextDueAt).toBe("2026-05-18T09:00:00.000Z");
    }
  });

  test("refuses unsafe clarification when no reply destination is available", async () => {
    const validator = createWorkflowScheduleRegistrationValidator();

    const resolverClarification = await validator.validate({
      workflowRoot: "./examples",
      hasSafeReplyDestination: false,
      output: {
        status: "needs-clarification",
        missing: ["timezone"],
        question: "Which timezone should I use?",
      },
    });

    expect(resolverClarification).toMatchObject({
      status: "refused",
      decision: {
        reason:
          "cannot ask schedule clarification without a safe reply destination",
      },
    });

    const runtimeClarification = await validator.validate({
      workflowRoot: "./examples",
      hasSafeReplyDestination: false,
      output: {
        status: "ready",
        workflowName: "worker-only-single-step",
        schedule: {
          kind: "recurring",
          timezone: "UTC",
          cron: "not cron",
        },
        workflowInput: {},
        confirmationText: "Scheduled worker-only-single-step.",
      },
    });

    expect(runtimeClarification).toMatchObject({
      status: "refused",
      decision: {
        reason:
          "cannot ask schedule clarification without a safe reply destination",
      },
    });
  });
});
