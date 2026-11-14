import type { WorkflowScopeSelector } from "../workflow/types";
import type { ParsedArgs } from "./storage-and-options";
import {
  parseAutoImprovePolicyFromCliFlags,
  parseEnumOption,
  parseNumericOption,
  parseRequiredStringOption,
  parseWorkflowDefinitionDirectoryOption,
  parseWorkflowScopeOption,
} from "./storage-and-options";

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  let workflowRoot: string | undefined;
  let workflowScope: WorkflowScopeSelector | undefined;
  let userRoot: string | undefined;
  let projectRoot: string | undefined;
  let addonRoot: string | undefined;
  let artifactRoot: string | undefined;
  let sessionStoreRoot: string | undefined;
  let workingDirectory: string | undefined;
  let workerOnly = false;
  let output: "text" | "json" | "table" = "text";
  let structure = false;
  let format: "text" | "json" | "jsonl" | undefined;
  let variablesPath: string | undefined;
  let dryRun = false;
  let verbose = false;
  let debug = false;
  let mockScenarioPath: string | undefined;
  let maxSteps: number | undefined;
  let maxConcurrency: number | undefined;
  let maxLoopIterations: number | undefined;
  let defaultTimeoutMs: number | undefined;
  let timeoutMs: number | undefined;
  let host: string | undefined;
  let port: number | undefined;
  let endpoint: string | undefined;
  let authToken: string | undefined;
  let authTokenEnv: string | undefined;
  let filePath: string | undefined;
  let readOnly = false;
  let noExec = false;
  let messageJson: string | undefined;
  let messageFile: string | undefined;
  let promptVariant: string | undefined;
  let continueSession = false;
  let resumeStepExecId: string | undefined;
  let vendor: string | undefined;
  let eventRoot: string | undefined;
  let eventFile: string | undefined;
  let sourceId: string | undefined;
  let status: string | undefined;
  let limit: number | undefined;
  let logLimit: number | undefined;
  let includeLlmMessages = false;
  let llmLimit: number | undefined;
  let live = false;
  let reason: string | undefined;
  let parseError: string | undefined;
  let autoImprove = false;
  let disableAutoImprove = false;
  let superviserWorkflowId: string | undefined;
  let monitorIntervalMs: number | undefined;
  let stallTimeoutMs: number | undefined;
  let maxSupervisedAttempts: number | undefined;
  let maxWorkflowPatches: number | undefined;
  let workflowMutationMode: "execution-copy" | "in-place" | undefined;
  let noAllowTargetedRerun = false;
  let firstAutoImprovePolicyFlag: string | undefined;
  let firstAutoImproveOnlyPolicyFlag: string | undefined;
  let nestedSuperviser = false;
  let continuationStartStepId: string | undefined;
  let continuationAfterStepRunId: string | undefined;
  let stepRunsFilterStepId: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) {
      continue;
    }

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const readNext = (): string | undefined => {
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        index += 1;
        return next;
      }
      return undefined;
    };
    const markAutoImprovePolicyFlag = (): void => {
      firstAutoImprovePolicyFlag ??= token;
      if (token !== "--stall-timeout-ms") {
        firstAutoImproveOnlyPolicyFlag ??= token;
      }
    };

    switch (token) {
      case "--workflow-definition-dir":
        {
          const parsedString = parseWorkflowDefinitionDirectoryOption(
            token,
            readNext(),
          );
          if (parsedString.error !== undefined) {
            parseError = parsedString.error;
            break;
          }
          workflowRoot = parsedString.value;
        }
        break;
      case "--workflow-root":
        readNext();
        parseError =
          "--workflow-root has been removed; use --workflow-definition-dir";
        break;
      case "--scope":
        {
          const rawScope = readNext();
          const parsedScope = parseWorkflowScopeOption(rawScope);
          if (parsedScope === undefined) {
            parseError =
              rawScope === undefined
                ? "--scope requires a value: auto, project, or user"
                : `invalid --scope value '${rawScope}'; expected auto, project, or user`;
          } else {
            workflowScope = parsedScope;
          }
        }
        break;
      case "--user-root": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        userRoot = parsedString.value;
        break;
      }
      case "--project-root": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        projectRoot = parsedString.value;
        break;
      }
      case "--addon-root": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        addonRoot = parsedString.value;
        break;
      }
      case "--artifact-root": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        artifactRoot = parsedString.value;
        break;
      }
      case "--session-store": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        sessionStoreRoot = parsedString.value;
        break;
      }
      case "--working-dir":
      case "--working-directory": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        workingDirectory = parsedString.value;
        break;
      }
      case "--worker-only":
        workerOnly = true;
        break;
      case "--structure":
        structure = true;
        break;
      case "--variables": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        variablesPath = parsedString.value;
        break;
      }
      case "--output": {
        const parsedOutput = parseEnumOption(
          token,
          readNext(),
          ["json", "text", "table"],
          "json, text, or table",
        );
        if (parsedOutput.error !== undefined) {
          parseError = parsedOutput.error;
          break;
        }
        if (parsedOutput.value !== undefined) {
          output = parsedOutput.value;
        }
        break;
      }
      case "--format": {
        const parsedFormat = parseEnumOption(
          token,
          readNext(),
          ["json", "jsonl", "text"],
          "json, jsonl, or text",
        );
        if (parsedFormat.error !== undefined) {
          parseError = parsedFormat.error;
          break;
        }
        if (parsedFormat.value !== undefined) {
          format = parsedFormat.value;
        }
        break;
      }
      case "--dry-run":
        dryRun = true;
        break;
      case "--verbose":
      case "-v":
        verbose = true;
        break;
      case "--debug":
        debug = true;
        break;
      case "--mock-scenario": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        mockScenarioPath = parsedString.value;
        break;
      }
      case "--max-steps":
        {
          const parsedNumber = parseNumericOption(token, readNext());
          if (parsedNumber.error !== undefined) {
            parseError = parsedNumber.error;
            break;
          }
          maxSteps = parsedNumber.value;
        }
        break;
      case "--max-concurrency":
        {
          const parsedNumber = parseNumericOption(token, readNext());
          if (parsedNumber.error !== undefined) {
            parseError = parsedNumber.error;
            break;
          }
          const parsed = parsedNumber.value;
          if (parsed === undefined) {
            parseError = `${token} requires a numeric value`;
            break;
          }
          if (!Number.isInteger(parsed) || parsed < 1) {
            parseError = `invalid --max-concurrency value '${parsed}'; expected a positive integer`;
            break;
          }
          maxConcurrency = parsed;
        }
        break;
      case "--max-loop-iterations":
        {
          const parsedNumber = parseNumericOption(token, readNext());
          if (parsedNumber.error !== undefined) {
            parseError = parsedNumber.error;
            break;
          }
          maxLoopIterations = parsedNumber.value;
        }
        break;
      case "--default-timeout-ms":
        {
          const parsedNumber = parseNumericOption(token, readNext());
          if (parsedNumber.error !== undefined) {
            parseError = parsedNumber.error;
            break;
          }
          defaultTimeoutMs = parsedNumber.value;
        }
        break;
      case "--timeout-ms":
        {
          const parsedNumber = parseNumericOption(token, readNext());
          if (parsedNumber.error !== undefined) {
            parseError = parsedNumber.error;
            break;
          }
          timeoutMs = parsedNumber.value;
        }
        break;
      case "--host": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        host = parsedString.value;
        break;
      }
      case "--port":
        {
          const parsedNumber = parseNumericOption(token, readNext());
          if (parsedNumber.error !== undefined) {
            parseError = parsedNumber.error;
            break;
          }
          port = parsedNumber.value;
        }
        break;
      case "--endpoint": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        endpoint = parsedString.value;
        break;
      }
      case "--auth-token": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        authToken = parsedString.value;
        break;
      }
      case "--auth-token-env": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        authTokenEnv = parsedString.value;
        break;
      }
      case "--file": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        filePath = parsedString.value;
        break;
      }
      case "--read-only":
        readOnly = true;
        break;
      case "--no-exec":
        noExec = true;
        break;
      case "--message-json": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        messageJson = parsedString.value;
        break;
      }
      case "--message-file": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        messageFile = parsedString.value;
        break;
      }
      case "--prompt-variant": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        promptVariant = parsedString.value;
        break;
      }
      case "--continue-session":
        continueSession = true;
        break;
      case "--resume-node-exec":
        readNext();
        parseError ??=
          "--resume-node-exec has been removed; use --resume-step-exec";
        break;
      case "--resume-step-exec": {
        const nextResumeExec = readNext();
        if (nextResumeExec === undefined) {
          parseError = `${token} requires an execution record id`;
          break;
        }
        resumeStepExecId = nextResumeExec;
        break;
      }
      case "--vendor": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        vendor = parsedString.value;
        break;
      }
      case "--event-root": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        eventRoot = parsedString.value;
        break;
      }
      case "--event-file": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        eventFile = parsedString.value;
        break;
      }
      case "--source": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        sourceId = parsedString.value;
        break;
      }
      case "--status": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        status = parsedString.value;
        break;
      }
      case "--limit":
        {
          const parsedNumber = parseNumericOption(token, readNext());
          if (parsedNumber.error !== undefined) {
            parseError = parsedNumber.error;
            break;
          }
          limit = parsedNumber.value;
        }
        break;
      case "--log-limit":
        {
          const parsedNumber = parseNumericOption(token, readNext());
          if (parsedNumber.error !== undefined) {
            parseError = parsedNumber.error;
            break;
          }
          logLimit = parsedNumber.value;
        }
        break;
      case "--llm-limit":
        {
          const parsedNumber = parseNumericOption(token, readNext());
          if (parsedNumber.error !== undefined) {
            parseError = parsedNumber.error;
            break;
          }
          llmLimit = parsedNumber.value;
        }
        break;
      case "--include-llm-messages":
      case "--include-llm-history":
        includeLlmMessages = true;
        break;
      case "--live":
        live = true;
        break;
      case "--reason": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        reason = parsedString.value;
        break;
      }
      case "--auto-improve":
        autoImprove = true;
        break;
      case "--no-auto-improve":
        disableAutoImprove = true;
        break;
      case "--superviser-workflow":
      case "--supervisor-workflow": {
        markAutoImprovePolicyFlag();
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        superviserWorkflowId = parsedString.value;
        break;
      }
      case "--monitor-interval-ms":
        {
          markAutoImprovePolicyFlag();
          const parsedNumber = parseNumericOption(token, readNext());
          if (parsedNumber.error !== undefined) {
            parseError = parsedNumber.error;
            break;
          }
          monitorIntervalMs = parsedNumber.value;
        }
        break;
      case "--stall-timeout-ms":
        {
          markAutoImprovePolicyFlag();
          const parsedNumber = parseNumericOption(token, readNext());
          if (parsedNumber.error !== undefined) {
            parseError = parsedNumber.error;
            break;
          }
          stallTimeoutMs = parsedNumber.value;
        }
        break;
      case "--max-supervised-attempts":
        {
          markAutoImprovePolicyFlag();
          const parsedNumber = parseNumericOption(token, readNext());
          if (parsedNumber.error !== undefined) {
            parseError = parsedNumber.error;
            break;
          }
          maxSupervisedAttempts = parsedNumber.value;
        }
        break;
      case "--max-workflow-patches":
        {
          markAutoImprovePolicyFlag();
          const parsedNumber = parseNumericOption(token, readNext());
          if (parsedNumber.error !== undefined) {
            parseError = parsedNumber.error;
            break;
          }
          maxWorkflowPatches = parsedNumber.value;
        }
        break;
      case "--workflow-mutation-mode": {
        markAutoImprovePolicyFlag();
        const parsedMode = parseEnumOption(
          token,
          readNext(),
          ["execution-copy", "in-place"],
          "execution-copy or in-place",
        );
        if (parsedMode.error !== undefined) {
          parseError = parsedMode.error;
          break;
        }
        if (parsedMode.value !== undefined) {
          workflowMutationMode = parsedMode.value;
        }
        break;
      }
      case "--no-allow-targeted-rerun":
      case "--disable-targeted-rerun":
        markAutoImprovePolicyFlag();
        noAllowTargetedRerun = true;
        break;
      case "--nested-superviser":
      case "--nested-supervisor":
        nestedSuperviser = true;
        break;
      case "--start-step": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        continuationStartStepId = parsedString.value;
        break;
      }
      case "--after-step-run": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        continuationAfterStepRunId = parsedString.value;
        break;
      }
      case "--step": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        stepRunsFilterStepId = parsedString.value;
        break;
      }
      default:
        break;
    }

    if (parseError !== undefined) {
      break;
    }
  }

  const isSessionHealthCommand =
    positionals[0] === "session" && positionals[1] === "health";
  const hasWorkflowAutoImprovePolicyFlag =
    firstAutoImprovePolicyFlag !== undefined && !isSessionHealthCommand;
  const shouldEnableCliAutoImprovePolicy =
    !isSessionHealthCommand &&
    (disableAutoImprove ||
      autoImprove ||
      nestedSuperviser ||
      hasWorkflowAutoImprovePolicyFlag);
  const autoImproveInputs = {
    enabled: shouldEnableCliAutoImprovePolicy,
    ...(superviserWorkflowId === undefined ? {} : { superviserWorkflowId }),
    ...(monitorIntervalMs === undefined ? {} : { monitorIntervalMs }),
    ...(stallTimeoutMs === undefined || (!autoImprove && isSessionHealthCommand)
      ? {}
      : { stallTimeoutMs }),
    ...(maxSupervisedAttempts === undefined ? {} : { maxSupervisedAttempts }),
    ...(disableAutoImprove
      ? { maxWorkflowPatches: 0 }
      : maxWorkflowPatches === undefined
        ? {}
        : { maxWorkflowPatches }),
    ...(disableAutoImprove || workflowMutationMode === undefined
      ? {}
      : { workflowMutationMode }),
    ...(noAllowTargetedRerun ? { allowTargetedRerun: false } : {}),
  } as const;
  const autoImprovePolicy =
    parseAutoImprovePolicyFromCliFlags(autoImproveInputs);
  if (parseError === undefined) {
    if (autoImprove && disableAutoImprove) {
      parseError = "--auto-improve cannot be combined with --no-auto-improve";
    } else if (nestedSuperviser && disableAutoImprove) {
      parseError =
        "--nested-superviser / --nested-supervisor cannot be combined with --no-auto-improve";
    } else if (disableAutoImprove && maxWorkflowPatches !== undefined) {
      parseError =
        "--max-workflow-patches cannot be combined with --no-auto-improve";
    } else if (disableAutoImprove && workflowMutationMode !== undefined) {
      parseError =
        "--workflow-mutation-mode cannot be combined with --no-auto-improve";
    } else if (
      isSessionHealthCommand &&
      !autoImprove &&
      firstAutoImproveOnlyPolicyFlag !== undefined
    ) {
      parseError = `${firstAutoImproveOnlyPolicyFlag} requires --auto-improve`;
    }
  }
  if (parseError === undefined && autoImprovePolicy.error !== undefined) {
    parseError = `invalid --auto-improve policy: ${autoImprovePolicy.error}`;
  }

  return {
    positionals,
    options: {
      ...(workflowRoot === undefined ? {} : { workflowRoot }),
      ...(workflowScope === undefined ? {} : { workflowScope }),
      ...(userRoot === undefined ? {} : { userRoot }),
      ...(projectRoot === undefined ? {} : { projectRoot }),
      ...(addonRoot === undefined ? {} : { addonRoot }),
      ...(artifactRoot === undefined ? {} : { artifactRoot }),
      ...(sessionStoreRoot === undefined ? {} : { sessionStoreRoot }),
      ...(workingDirectory === undefined ? {} : { workingDirectory }),
      workerOnly,
      structure,
      ...(format === undefined ? {} : { format }),
      ...(variablesPath === undefined ? {} : { variablesPath }),
      ...(mockScenarioPath === undefined ? {} : { mockScenarioPath }),
      output,
      dryRun,
      verbose,
      debug,
      ...(maxSteps === undefined ? {} : { maxSteps }),
      ...(maxConcurrency === undefined ? {} : { maxConcurrency }),
      ...(maxLoopIterations === undefined ? {} : { maxLoopIterations }),
      ...(defaultTimeoutMs === undefined ? {} : { defaultTimeoutMs }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(host === undefined ? {} : { host }),
      ...(port === undefined ? {} : { port }),
      ...(endpoint === undefined ? {} : { endpoint }),
      ...(authToken === undefined ? {} : { authToken }),
      ...(authTokenEnv === undefined ? {} : { authTokenEnv }),
      ...(filePath === undefined ? {} : { filePath }),
      readOnly,
      noExec,
      ...(messageJson === undefined ? {} : { messageJson }),
      ...(messageFile === undefined ? {} : { messageFile }),
      ...(promptVariant === undefined ? {} : { promptVariant }),
      continueSession,
      ...(resumeStepExecId === undefined ? {} : { resumeStepExecId }),
      ...(vendor === undefined ? {} : { vendor }),
      ...(eventRoot === undefined ? {} : { eventRoot }),
      ...(eventFile === undefined ? {} : { eventFile }),
      ...(sourceId === undefined ? {} : { sourceId }),
      ...(status === undefined ? {} : { status }),
      ...(limit === undefined ? {} : { limit }),
      ...(logLimit === undefined ? {} : { logLimit }),
      includeLlmMessages,
      ...(llmLimit === undefined ? {} : { llmLimit }),
      live,
      ...(stallTimeoutMs === undefined ? {} : { stallTimeoutMs }),
      ...(reason === undefined ? {} : { reason }),
      ...(autoImprovePolicy.policy === undefined
        ? {}
        : { autoImprove: autoImprovePolicy.policy }),
      disableAutoImprove,
      ...(nestedSuperviser ? { nestedSuperviser: true } : {}),
      ...(continuationStartStepId === undefined
        ? {}
        : { continuationStartStepId }),
      ...(continuationAfterStepRunId === undefined
        ? {}
        : { continuationAfterStepRunId }),
      ...(stepRunsFilterStepId === undefined ? {} : { stepRunsFilterStepId }),
    },
    ...(parseError === undefined ? {} : { error: parseError }),
  };
}
