import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { err, ok, type Result } from "../result";
import type {
  WorkflowPackageContainerRuntime,
  WorkflowPackageContainerRuntimeRequest,
  WorkflowPackageFailure,
  WorkflowPackagePreInstallCheckMode,
  WorkflowPackagePreInstallCheckResult,
} from "./types";

const execFileAsync = promisify(execFile);

export interface WorkflowPackageContainerCheckInput {
  readonly packageDirectory: string;
  readonly runtime: WorkflowPackageContainerRuntimeRequest;
  readonly mode: WorkflowPackagePreInstallCheckMode;
}

interface ContainerCommand {
  readonly runtime: WorkflowPackageContainerRuntime;
  readonly args: readonly string[];
}

function packageFailure(
  code: WorkflowPackageFailure["code"],
  message: string,
): WorkflowPackageFailure {
  return { code, message };
}

async function runtimeIsAvailable(
  runtime: WorkflowPackageContainerRuntime,
): Promise<boolean> {
  try {
    await execFileAsync(runtime, ["--version"], {
      env: { PATH: process.env["PATH"] },
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

export async function resolveWorkflowPackageContainerRuntime(
  runtime: WorkflowPackageContainerRuntimeRequest,
): Promise<WorkflowPackageContainerRuntime | undefined> {
  if (runtime !== "auto") {
    return (await runtimeIsAvailable(runtime)) ? runtime : undefined;
  }
  if (await runtimeIsAvailable("docker")) {
    return "docker";
  }
  if (await runtimeIsAvailable("podman")) {
    return "podman";
  }
  return undefined;
}

export function buildWorkflowPackageContainerCheckCommand(input: {
  readonly runtime: WorkflowPackageContainerRuntime;
  readonly packageDirectory: string;
  readonly tempDirectory: string;
}): ContainerCommand {
  const mountFlag =
    input.runtime === "docker"
      ? `${input.packageDirectory}:/package:ro`
      : `${input.packageDirectory}:/package:ro,Z`;
  return {
    runtime: input.runtime,
    args: [
      "run",
      "--rm",
      "--network",
      "none",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "-v",
      mountFlag,
      "-v",
      `${input.tempDirectory}:/work:rw`,
      "--workdir",
      "/package",
      "--env",
      "HOME=/work",
      "alpine:3.20",
      "sh",
      "-c",
      "find /package -maxdepth 5 -type f >/dev/null",
    ],
  };
}

export async function runWorkflowPackageContainerCheck(
  input: WorkflowPackageContainerCheckInput,
): Promise<
  Result<WorkflowPackagePreInstallCheckResult, WorkflowPackageFailure>
> {
  const runtime = await resolveWorkflowPackageContainerRuntime(input.runtime);
  if (runtime === undefined) {
    return err(
      packageFailure(
        "PRE_INSTALL_CHECK_FAILED",
        `pre-install container runtime '${input.runtime}' is unavailable`,
      ),
    );
  }
  const tempDirectory = await mkdtemp(
    path.join(os.tmpdir(), "rielflow-package-container-"),
  );
  try {
    const command = buildWorkflowPackageContainerCheckCommand({
      runtime,
      packageDirectory: input.packageDirectory,
      tempDirectory,
    });
    await execFileAsync(command.runtime, [...command.args], {
      env: { PATH: process.env["PATH"] },
      timeout: 30_000,
    });
    return ok({
      enabled: true,
      mode: input.mode,
      status: "passed",
      scannerVersion: "container-v1",
      containerRuntime: runtime,
      findings: [],
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err(
      packageFailure(
        "PRE_INSTALL_CHECK_FAILED",
        `pre-install container check failed: ${message}`,
      ),
    );
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}
