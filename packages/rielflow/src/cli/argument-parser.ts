import type {
  WorkflowSelfImproveMode,
  WorkflowSelfImproveSourceMode,
} from "rielflow-core";
import type { WorkflowScopeSelector } from "../workflow/types";
import type { ParsedArgs } from "./storage-and-options";
import { parseAutoImproveFlagState } from "./argument-auto-improve";
import { validateCliFlagCombinations } from "./argument-validation";
import {
  parseEnumOption,
  parseNumericOption,
  parseRequiredStringOption,
  parseWorkflowDefinitionDirectoryOption,
  parseWorkflowScopeOption,
} from "./storage-and-options";

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  let workflowRoot: string | undefined;
  let workflowManifestPath: string | undefined;
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
  let executablePreflight = false;
  let format: "text" | "json" | "jsonl" | undefined;
  let variablesPath: string | undefined;
  let nodePatchPath: string | undefined;
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
  let userScope = false;
  let overwrite = false;
  let yes = false;
  let selfImproveSourceMode: WorkflowSelfImproveSourceMode | undefined;
  let selfImproveSessions: string[] = [];
  let selfImproveMode: WorkflowSelfImproveMode | undefined;
  let selfImproveEnableDisabled = false;
  let registry: string | undefined;
  let registryUrl: string | undefined;
  let installId: string | undefined;
  let packageName: string | undefined;
  let packageId: string | undefined;
  let branch: string | undefined;
  let backend: string | undefined;
  let localPath: string | undefined;
  let refresh = false;
  let noCache = false;
  let createPr = false;
  let preInstallCheck = false;
  let noPreInstallCheck = false;
  let preInstallCheckMode: "warn" | "reject" | undefined;
  let preInstallCheckContainer: "docker" | "podman" | "auto" | undefined;
  let tags: string[] = [];
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
      case "--workflow-manifest":
        {
          const parsedString = parseRequiredStringOption(token, readNext());
          if (parsedString.error !== undefined) {
            parseError = parsedString.error;
            break;
          }
          workflowManifestPath = parsedString.value;
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
      case "--user-scope":
        userScope = true;
        break;
      case "--overwrite":
        overwrite = true;
        break;
      case "--yes":
        yes = true;
        break;
      case "--structure":
        structure = true;
        break;
      case "--executable":
        executablePreflight = true;
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
      case "--node-patch": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        nodePatchPath = parsedString.value;
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
      case "--since-last":
        if (selfImproveSourceMode !== undefined) {
          parseError =
            "--since-last cannot be combined with another self-improve source selector";
          break;
        }
        selfImproveSourceMode = "since-last";
        break;
      case "--latest":
        if (selfImproveSourceMode !== undefined) {
          parseError =
            "--latest cannot be combined with another self-improve source selector";
          break;
        }
        selfImproveSourceMode = "latest";
        break;
      case "--session": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        if (parsedString.value === undefined) {
          parseError = `${token} requires a value`;
          break;
        }
        if (
          selfImproveSourceMode !== undefined &&
          selfImproveSourceMode !== "explicit"
        ) {
          parseError =
            "--session cannot be combined with --since-last or --latest";
          break;
        }
        selfImproveSourceMode = "explicit";
        selfImproveSessions = [...selfImproveSessions, parsedString.value];
        break;
      }
      case "--mode": {
        const parsedMode = parseEnumOption(
          token,
          readNext(),
          ["report-only", "report-and-auto-improve"],
          "report-only or report-and-auto-improve",
        );
        if (parsedMode.error !== undefined) {
          parseError = parsedMode.error;
          break;
        }
        selfImproveMode = parsedMode.value;
        break;
      }
      case "--enable-disabled":
        selfImproveEnableDisabled = true;
        break;
      case "--registry": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        registry = parsedString.value;
        break;
      }
      case "--registry-url": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        registryUrl = parsedString.value;
        break;
      }
      case "--install-id":
        {
          const parsedString = parseRequiredStringOption(token, readNext());
          if (parsedString.error !== undefined) {
            parseError = parsedString.error;
            break;
          }
          installId = parsedString.value;
        }
        break;
      case "--package-name": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        packageName = parsedString.value;
        break;
      }
      case "--package-id": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        packageId = parsedString.value;
        break;
      }
      case "--branch": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        branch = parsedString.value;
        break;
      }
      case "--backend": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        backend = parsedString.value;
        break;
      }
      case "--local-path":
      case "--registry-local-path": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        localPath = parsedString.value;
        break;
      }
      case "--refresh":
        refresh = true;
        break;
      case "--no-cache":
        noCache = true;
        break;
      case "--pre-install-check":
        preInstallCheck = true;
        break;
      case "--no-pre-install-check":
        noPreInstallCheck = true;
        break;
      case "--pre-install-check-mode": {
        const parsedMode = parseEnumOption(
          token,
          readNext(),
          ["warn", "reject"],
          "warn or reject",
        );
        if (parsedMode.error !== undefined) {
          parseError = parsedMode.error;
          break;
        }
        preInstallCheckMode = parsedMode.value;
        break;
      }
      case "--pre-install-check-container": {
        const parsedRuntime = parseEnumOption(
          token,
          readNext(),
          ["docker", "podman", "auto"],
          "docker, podman, or auto",
        );
        if (parsedRuntime.error !== undefined) {
          parseError = parsedRuntime.error;
          break;
        }
        preInstallCheckContainer = parsedRuntime.value;
        preInstallCheck = true;
        break;
      }
      case "--pr":
      case "--create-pr":
        createPr = true;
        break;
      case "--tag": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        if (parsedString.value !== undefined) {
          tags = [...tags, parsedString.value];
        }
        break;
      }
      default:
        break;
    }

    if (parseError !== undefined) {
      break;
    }
  }
  const autoImproveState = parseAutoImproveFlagState({
    positionals,
    disableAutoImprove,
    autoImprove,
    nestedSuperviser,
    firstAutoImprovePolicyFlag,
    superviserWorkflowId,
    monitorIntervalMs,
    stallTimeoutMs,
    maxSupervisedAttempts,
    maxWorkflowPatches,
    workflowMutationMode,
    noAllowTargetedRerun,
  });
  parseError = validateCliFlagCombinations({
    parseError,
    autoImprove,
    disableAutoImprove,
    nestedSuperviser,
    maxWorkflowPatches,
    workflowMutationMode,
    isSessionHealthCommand: autoImproveState.isSessionHealthCommand,
    firstAutoImproveOnlyPolicyFlag,
    autoImprovePolicyError: autoImproveState.autoImprovePolicy.error,
    preInstallCheck,
    noPreInstallCheck,
  });
  return {
    positionals,
    options: {
      ...(workflowRoot === undefined ? {} : { workflowRoot }),
      ...(workflowManifestPath === undefined ? {} : { workflowManifestPath }),
      ...(workflowScope === undefined ? {} : { workflowScope }),
      ...(userRoot === undefined ? {} : { userRoot }),
      ...(projectRoot === undefined ? {} : { projectRoot }),
      ...(addonRoot === undefined ? {} : { addonRoot }),
      ...(artifactRoot === undefined ? {} : { artifactRoot }),
      ...(sessionStoreRoot === undefined ? {} : { sessionStoreRoot }),
      ...(workingDirectory === undefined ? {} : { workingDirectory }),
      workerOnly,
      userScope,
      overwrite,
      yes,
      structure,
      executablePreflight,
      ...(format === undefined ? {} : { format }),
      ...(variablesPath === undefined ? {} : { variablesPath }),
      ...(nodePatchPath === undefined ? {} : { nodePatchPath }),
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
      ...(autoImproveState.autoImprovePolicy.policy === undefined
        ? {}
        : { autoImprove: autoImproveState.autoImprovePolicy.policy }),
      disableAutoImprove,
      ...(nestedSuperviser ? { nestedSuperviser: true } : {}),
      ...(continuationStartStepId === undefined
        ? {}
        : { continuationStartStepId }),
      ...(continuationAfterStepRunId === undefined
        ? {}
        : { continuationAfterStepRunId }),
      ...(stepRunsFilterStepId === undefined ? {} : { stepRunsFilterStepId }),
      ...(selfImproveSourceMode === undefined ? {} : { selfImproveSourceMode }),
      ...(selfImproveSessions.length === 0 ? {} : { selfImproveSessions }),
      ...(selfImproveMode === undefined ? {} : { selfImproveMode }),
      selfImproveEnableDisabled,
      ...(registry === undefined ? {} : { registry }),
      ...(registryUrl === undefined ? {} : { registryUrl }),
      ...(installId === undefined ? {} : { installId }),
      ...(packageName === undefined ? {} : { packageName }),
      ...(packageId === undefined ? {} : { packageId }),
      ...(branch === undefined ? {} : { branch }),
      ...(backend === undefined ? {} : { backend }),
      ...(localPath === undefined ? {} : { localPath }),
      refresh,
      noCache,
      createPr,
      preInstallCheck,
      noPreInstallCheck,
      fromRegistry: argv.includes("--from-registry"),
      ...(preInstallCheckMode === undefined ? {} : { preInstallCheckMode }),
      ...(preInstallCheckContainer === undefined
        ? {}
        : { preInstallCheckContainer }),
      ...(tags.length === 0 ? {} : { tags }),
    },
    ...(parseError === undefined ? {} : { error: parseError }),
  };
}
