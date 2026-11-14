import type { CompletionRule, LoopRule } from "./types";

export interface LoopRuntimeState {
  readonly loopId: string;
  readonly iteration: number;
}

export interface CompletionEvaluationInput {
  readonly rule: CompletionRule | undefined;
  readonly output: Readonly<Record<string, unknown>>;
}

export interface CompletionEvaluationResult {
  readonly passed: boolean;
  readonly reason: string | null;
}

export interface BranchEvaluationInput {
  readonly when: string;
  readonly output: Readonly<Record<string, unknown>>;
}

function lookupCondition(
  output: Readonly<Record<string, unknown>>,
  key: string,
): boolean {
  const whenMap = output["when"];
  if (typeof whenMap === "object" && whenMap !== null) {
    const fromWhen = (whenMap as Record<string, unknown>)[key];
    if (fromWhen === true) {
      return true;
    }
    if (fromWhen === false) {
      return false;
    }
  }
  return output[key] === true;
}

function tokenizeExpression(expression: string): readonly string[] | null {
  const tokens: string[] = [];
  let index = 0;

  while (index < expression.length) {
    const char = expression[index];
    if (char === undefined) {
      break;
    }

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    const twoChars = expression.slice(index, index + 2);
    if (twoChars === "&&" || twoChars === "||") {
      tokens.push(twoChars);
      index += 2;
      continue;
    }

    if (char === "!" || char === "(" || char === ")") {
      tokens.push(char);
      index += 1;
      continue;
    }

    const identifierMatch = expression
      .slice(index)
      .match(/^[A-Za-z_][A-Za-z0-9_-]*/);
    if (identifierMatch?.[0] !== undefined) {
      tokens.push(identifierMatch[0]);
      index += identifierMatch[0].length;
      continue;
    }

    return null;
  }

  return tokens;
}

function evaluateBooleanExpression(
  expression: string,
  output: Readonly<Record<string, unknown>>,
): boolean {
  const tokens = tokenizeExpression(expression);
  if (tokens === null || tokens.length === 0) {
    return false;
  }

  let index = 0;

  const parseExpression = (): boolean => parseOr();

  const parseOr = (): boolean => {
    let value = parseAnd();
    while (tokens[index] === "||") {
      index += 1;
      value = value || parseAnd();
    }
    return value;
  };

  const parseAnd = (): boolean => {
    let value = parseUnary();
    while (tokens[index] === "&&") {
      index += 1;
      value = value && parseUnary();
    }
    return value;
  };

  const parseUnary = (): boolean => {
    const token = tokens[index];
    if (token === "!") {
      index += 1;
      return !parseUnary();
    }
    return parsePrimary();
  };

  const parsePrimary = (): boolean => {
    const token = tokens[index];
    if (token === undefined) {
      return false;
    }

    if (token === "(") {
      index += 1;
      const value = parseExpression();
      if (tokens[index] !== ")") {
        return false;
      }
      index += 1;
      return value;
    }

    if (token === "true") {
      index += 1;
      return true;
    }
    if (token === "false") {
      index += 1;
      return false;
    }
    if (token === "always") {
      index += 1;
      return true;
    }
    if (token === "never") {
      index += 1;
      return false;
    }

    index += 1;
    return lookupCondition(output, token);
  };

  const value = parseExpression();
  return index === tokens.length ? value : false;
}

export function evaluateBranch(input: BranchEvaluationInput): boolean {
  if (input.when.length === 0) {
    return false;
  }
  return evaluateBooleanExpression(input.when, input.output);
}

function evaluateChecklistCompletion(
  config: Readonly<Record<string, unknown>> | undefined,
  output: Readonly<Record<string, unknown>>,
): CompletionEvaluationResult {
  const requiredRaw = config?.["required"];
  if (!Array.isArray(requiredRaw) || requiredRaw.length === 0) {
    return { passed: false, reason: "missing checklist required fields" };
  }

  const checklist = output["checklist"];
  const checklistMap =
    typeof checklist === "object" && checklist !== null
      ? (checklist as Record<string, unknown>)
      : {};

  for (const required of requiredRaw) {
    if (typeof required !== "string" || required.length === 0) {
      return { passed: false, reason: "invalid checklist required item" };
    }
    if (checklistMap[required] === true || output[required] === true) {
      continue;
    }
    return { passed: false, reason: `missing checklist item '${required}'` };
  }

  return { passed: true, reason: null };
}

function evaluateScoreThresholdCompletion(
  config: Readonly<Record<string, unknown>> | undefined,
  output: Readonly<Record<string, unknown>>,
): CompletionEvaluationResult {
  const threshold = config?.["threshold"];
  const score = output["score"];
  if (typeof threshold !== "number") {
    return { passed: false, reason: "missing score threshold" };
  }
  if (typeof score !== "number") {
    return { passed: false, reason: "missing score output" };
  }
  if (score >= threshold) {
    return { passed: true, reason: null };
  }
  return {
    passed: false,
    reason: `score ${score} below threshold ${threshold}`,
  };
}

function evaluateValidatorResultCompletion(
  config: Readonly<Record<string, unknown>> | undefined,
  output: Readonly<Record<string, unknown>>,
): CompletionEvaluationResult {
  const resultField = config?.["resultField"];
  const field =
    typeof resultField === "string" && resultField.length > 0
      ? resultField
      : "validatorResult";
  if (output[field] === true || output["valid"] === true) {
    return { passed: true, reason: null };
  }
  return { passed: false, reason: `${field} is not true` };
}

export function evaluateCompletion(
  input: CompletionEvaluationInput,
): CompletionEvaluationResult {
  const rule = input.rule;
  if (rule === undefined || rule.type === "none") {
    return { passed: true, reason: null };
  }

  if (rule.type === "checklist") {
    return evaluateChecklistCompletion(rule.config, input.output);
  }
  if (rule.type === "score-threshold") {
    return evaluateScoreThresholdCompletion(rule.config, input.output);
  }
  if (rule.type === "validator-result") {
    return evaluateValidatorResultCompletion(rule.config, input.output);
  }

  return { passed: false, reason: "unsupported completion rule type" };
}

export function resolveLoopTransition(args: {
  readonly loopRule: LoopRule;
  readonly output: Readonly<Record<string, unknown>>;
  readonly state: LoopRuntimeState;
}): "continue" | "exit" | "none" {
  const maxIterations = args.loopRule.maxIterations;
  const continueMatches = evaluateBranch({
    when: args.loopRule.continueWhen,
    output: args.output,
  });
  const exitMatches = evaluateBranch({
    when: args.loopRule.exitWhen,
    output: args.output,
  });

  if (exitMatches) {
    return "exit";
  }

  if (!continueMatches) {
    return "none";
  }

  if (
    typeof maxIterations === "number" &&
    args.state.iteration >= maxIterations
  ) {
    return "exit";
  }

  return "continue";
}
