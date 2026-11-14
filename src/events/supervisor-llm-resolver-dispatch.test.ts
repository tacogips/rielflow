import { describe, expect, test } from "vitest";
import { interpretSupervisorDispatchResolverRootJson } from "./supervisor-llm-resolver";

describe("interpretSupervisorDispatchResolverRootJson", () => {
  test("unwraps adapter payload and returns parsed proposal", () => {
    const r = interpretSupervisorDispatchResolverRootJson(
      {
        payload: {
          action: "status",
          reason: "user asked",
          confidence: 0.9,
        },
      },
      { minConfidence: 0.75, invalidOutputBehavior: "error" },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.proposal.action).toBe("status");
      expect(r.proposal.reason).toBe("user asked");
    }
  });

  test("returns error on invalid structure when behavior is error", () => {
    const r = interpretSupervisorDispatchResolverRootJson(
      { action: "bogus", reason: "x" },
      { minConfidence: 0.75, invalidOutputBehavior: "error" },
    );
    expect(r.ok).toBe(false);
  });

  test("clarifies on invalid structure when behavior is clarify", () => {
    const r = interpretSupervisorDispatchResolverRootJson(
      { action: "bogus", reason: "x" },
      { minConfidence: 0.75, invalidOutputBehavior: "clarify" },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.proposal.action).toBe("clarify");
      expect(r.proposal.confidence).toBe(1);
    }
  });

  test("no-ops on invalid structure when behavior is no-op", () => {
    const r = interpretSupervisorDispatchResolverRootJson(
      { action: "bogus", reason: "x" },
      { minConfidence: 0.75, invalidOutputBehavior: "no-op" },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.proposal.action).toBe("no-op");
    }
  });

  test("applies floor to low confidence", () => {
    const r = interpretSupervisorDispatchResolverRootJson(
      {
        action: "status",
        reason: "low",
        confidence: 0.1,
      },
      { minConfidence: 0.75, invalidOutputBehavior: "clarify" },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.proposal.action).toBe("clarify");
    }
  });

  test("omitted confidence passes floor check", () => {
    const r = interpretSupervisorDispatchResolverRootJson(
      {
        action: "no-op",
        reason: "n",
      },
      { minConfidence: 0.75, invalidOutputBehavior: "error" },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.proposal.action).toBe("no-op");
    }
  });
});
