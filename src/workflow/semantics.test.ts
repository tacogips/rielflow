import { describe, expect, test } from "vitest";
import {
  evaluateBranch,
  evaluateCompletion,
  resolveLoopTransition,
} from "./semantics";

describe("evaluateBranch", () => {
  test("supports identifiers from top-level output and when map", () => {
    expect(
      evaluateBranch({
        when: "needs_review",
        output: { needs_review: true },
      }),
    ).toBe(true);

    expect(
      evaluateBranch({
        when: "needs_fix",
        output: { when: { needs_fix: true } },
      }),
    ).toBe(true);
  });

  test("supports boolean operators and precedence", () => {
    const output = { when: { a: true, b: false, c: true } };
    expect(evaluateBranch({ when: "a && b || c", output })).toBe(true);
    expect(evaluateBranch({ when: "a && (b || c)", output })).toBe(true);
    expect(evaluateBranch({ when: "a && !c", output })).toBe(false);
  });
});

describe("evaluateCompletion", () => {
  test("passes auto-completion for none and undefined", () => {
    expect(evaluateCompletion({ rule: undefined, output: {} }).passed).toBe(
      true,
    );
    expect(
      evaluateCompletion({ rule: { type: "none" }, output: {} }).passed,
    ).toBe(true);
  });

  test("evaluates checklist rule", () => {
    const pass = evaluateCompletion({
      rule: {
        type: "checklist",
        config: { required: ["draft_created", "lint_clean"] },
      },
      output: { checklist: { draft_created: true, lint_clean: true } },
    });
    expect(pass).toEqual({ passed: true, reason: null });

    const fail = evaluateCompletion({
      rule: { type: "checklist", config: { required: ["draft_created"] } },
      output: { checklist: {} },
    });
    expect(fail.passed).toBe(false);
  });

  test("evaluates score-threshold and validator-result rules", () => {
    expect(
      evaluateCompletion({
        rule: { type: "score-threshold", config: { threshold: 0.8 } },
        output: { score: 0.9 },
      }).passed,
    ).toBe(true);
    expect(
      evaluateCompletion({
        rule: { type: "score-threshold", config: { threshold: 0.8 } },
        output: { score: 0.5 },
      }).passed,
    ).toBe(false);
    expect(
      evaluateCompletion({
        rule: { type: "validator-result" },
        output: { validatorResult: true },
      }).passed,
    ).toBe(true);
  });
});

describe("resolveLoopTransition", () => {
  test("returns continue when continueWhen matches and budget remains", () => {
    const transition = resolveLoopTransition({
      loopRule: {
        id: "L1",
        judgeNodeId: "loop-judge",
        continueWhen: "continue_round",
        exitWhen: "round_done",
        maxIterations: 2,
      },
      output: { when: { continue_round: true, round_done: false } },
      state: { loopId: "L1", iteration: 1 },
    });
    expect(transition).toBe("continue");
  });

  test("returns exit when budget is exhausted even if continue matches", () => {
    const transition = resolveLoopTransition({
      loopRule: {
        id: "L1",
        judgeNodeId: "loop-judge",
        continueWhen: "continue_round",
        exitWhen: "round_done",
        maxIterations: 2,
      },
      output: { when: { continue_round: true, round_done: false } },
      state: { loopId: "L1", iteration: 2 },
    });
    expect(transition).toBe("exit");
  });
});
