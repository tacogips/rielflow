#!/usr/bin/env sh
set -eu

node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readResolvedInput() {
  const filePath = process.env.RIEL_RESOLVED_INPUT_PATH;
  if (typeof filePath === "string" && filePath.length > 0) {
    return readJson(filePath);
  }
  const stdin = fs.readFileSync(0, "utf8").trim();
  if (stdin.length > 0) {
    return JSON.parse(stdin);
  }
  throw new Error("RIEL_RESOLVED_INPUT_PATH or stdin resolved input JSON is required");
}

function latestUpstreamPayload(input) {
  const upstream = Array.isArray(input.upstream) ? input.upstream : [];
  for (let index = upstream.length - 1; index >= 0; index -= 1) {
    const payload = upstream[index] && upstream[index].output && upstream[index].output.payload;
    if (payload && typeof payload === "object") {
      return payload;
    }
  }
  return {};
}

function readStateFileFromInput(input) {
  const runtime = input.runtimeVariables && input.runtimeVariables.workflowInput;
  if (runtime && typeof runtime.stateFile === "string" && runtime.stateFile.length > 0) {
    return runtime.stateFile;
  }
  return (
    process.env.RIEL_X_DIGEST_STATE_FILE ||
    ".rielflow-data/x-follower-ai-business-digest/state.json"
  );
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

const input = readResolvedInput();
const payload = latestUpstreamPayload(input);
const stateFile = readStateFileFromInput(input);
assertPrivateRuntimePath(stateFile);
const maxFetchedPostId =
  typeof payload.maxFetchedPostId === "string" ? payload.maxFetchedPostId : "";
const shouldSendTelegram =
  payload.shouldSendTelegram === true || payload.hasDigest === true;
const replyText = typeof payload.replyText === "string" ? payload.replyText : "";

if (maxFetchedPostId.length > 0) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(
    stateFile,
    `${JSON.stringify(
      {
        lastPostId: maxFetchedPostId,
        updatedAt: new Date().toISOString(),
        retainedTopicCount: Array.isArray(payload.topicDigests)
          ? payload.topicDigests.length
          : Array.isArray(payload.filteredPosts)
            ? payload.filteredPosts.length
            : 0,
        retainedPostCount: Array.isArray(payload.filteredPosts)
          ? payload.filteredPosts.length
          : 0,
      },
      null,
      2,
    )}\n`,
  );
}

const output = {
  when: {
    should_send_telegram: shouldSendTelegram && replyText.trim().length > 0,
  },
  payload: {
    shouldSendTelegram,
    replyText,
    maxFetchedPostId,
    stateFile,
    persisted: maxFetchedPostId.length > 0,
  },
};
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
NODE
