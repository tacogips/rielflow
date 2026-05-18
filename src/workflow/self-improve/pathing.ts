import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { LoadOptions } from "../types";

function expandLeadingHome(value: string): string {
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

export function resolveSelfImproveLogRoot(
  options: LoadOptions & { readonly selfImproveLogRoot?: string } = {},
): string {
  const env = options.env ?? process.env;
  const configured =
    options.selfImproveLogRoot ??
    env["DIVEDRA_SELF_IMPROVE_LOG_ROOT"] ??
    path.join(
      options.userRoot ?? env["DIVEDRA_USER_ROOT"] ?? "~/.divedra",
      "self-improve-log",
    );
  const expanded = expandLeadingHome(configured);
  return path.isAbsolute(expanded)
    ? expanded
    : path.resolve(options.cwd ?? process.cwd(), expanded);
}

export function workflowDirectoryIdentity(workflowDirectory: string): string {
  const resolved = path.resolve(workflowDirectory);
  const base =
    path
      .basename(resolved)
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "workflow";
  const digest = createHash("sha256")
    .update(resolved)
    .digest("hex")
    .slice(0, 12);
  return `${base}-${digest}`;
}

export function resolveWorkflowSelfImproveDirectory(input: {
  readonly logRoot: string;
  readonly workflowDirectory: string;
}): string {
  return path.join(
    input.logRoot,
    workflowDirectoryIdentity(input.workflowDirectory),
  );
}

export function resolveSelfImproveExecutionDirectory(input: {
  readonly logRoot: string;
  readonly workflowDirectory: string;
  readonly selfImproveId: string;
}): string {
  return path.join(
    resolveWorkflowSelfImproveDirectory(input),
    input.selfImproveId,
  );
}
