#!/usr/bin/env sh
set -eu

node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

function readPositiveInteger(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function readState(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function assertPrivateRuntimePath(filePath) {
  const resolved = path.resolve(filePath);
  const relative = path.relative(process.cwd(), resolved);
  const normalized = relative.split(path.sep).join("/");
  const allowedRelativePrefixes = [
    ".rielflow-data/",
    ".rielflow-artifact/",
    ".rielflow-artifacts/",
    ".private/",
    "tmp/",
    "temp/",
  ];
  const allowedAbsolutePrefixes = ["/tmp/", "/var/tmp/", "/var/folders/"];
  const isAllowed =
    allowedRelativePrefixes.some((prefix) => normalized.startsWith(prefix)) ||
    allowedAbsolutePrefixes.some((prefix) => resolved.startsWith(prefix));
  if (!isAllowed) {
    throw new Error(
      `RIEL_X_DIGEST_STATE_FILE must point to an ignored/private runtime path, got ${filePath}`,
    );
  }
}

const stateFile =
  process.env.RIEL_X_DIGEST_STATE_FILE ||
  ".rielflow-data/x-follower-ai-business-digest/state.json";
assertPrivateRuntimePath(stateFile);
const accountUsername =
  process.env.RIEL_X_DIGEST_ACCOUNT_USERNAME ||
  process.env.X_GW_ACCOUNT_USERNAME ||
  "@tacogips";
const lookbackMinutes = readPositiveInteger(
  "RIEL_X_DIGEST_LOOKBACK_MINUTES",
  60,
);
const maxPosts = Math.max(
  5,
  Math.min(readPositiveInteger("RIEL_X_DIGEST_MAX_POSTS", 50), 50),
);
const state = readState(stateFile);
const sinceId =
  typeof state.lastPostId === "string" && state.lastPostId.length > 0
    ? state.lastPostId
    : "";
const now = new Date();
const windowStart = new Date(now.getTime() - lookbackMinutes * 60 * 1000);
const output = {
  when: {
    always: true,
  },
  payload: {
    stateFile,
    accountUsername,
    accountUsernameBare: accountUsername.replace(/^@/, ""),
    lookbackMinutes,
    maxPosts,
    sinceId,
    windowStartIso: windowStart.toISOString(),
    requestedAt: now.toISOString(),
    previousState: state,
  },
};
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
NODE
