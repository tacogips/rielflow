#!/usr/bin/env bun

import { runCli } from "./cli";
import { getWorkflowTelemetry } from "./telemetry";

async function main(): Promise<void> {
  try {
    const exitCode = await runCli(process.argv.slice(2));
    process.exitCode = exitCode;
  } finally {
    await getWorkflowTelemetry().shutdown();
  }
}

void main();
