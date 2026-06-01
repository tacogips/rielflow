#!/usr/bin/env sh
set -eu

mailbox_dir="${RIEL_MAILBOX_DIR:?RIEL_MAILBOX_DIR is required}"
mkdir -p "$mailbox_dir/outbox"

node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function upstreamPayloads(input) {
  const directPayloads = (Array.isArray(input.upstream) ? input.upstream : [])
    .map((entry) => entry && entry.output && entry.output.payload)
    .filter(isObject);
  const latestOutputPayloads = (Array.isArray(input.latestOutputs) ? input.latestOutputs : [])
    .map((entry) => entry && entry.payload)
    .filter(isObject);
  return [...directPayloads, ...latestOutputPayloads];
}

function findCursorPayload(payloads) {
  return (
    payloads.find(
      (payload) =>
        typeof payload.windowStartIso === "string" &&
        typeof payload.requestedAt === "string" &&
        typeof payload.maxPosts === "number",
    ) || {}
  );
}

function findXGatewayPayload(payloads) {
  return payloads.find((payload) => isObject(payload.xGateway)) || {};
}

function parseDate(value) {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function numericPostId(value) {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function comparePostIdsDescending(a, b) {
  const aId = numericPostId(a.id);
  const bId = numericPostId(b.id);
  if (aId !== null && bId !== null) {
    return aId > bId ? -1 : aId < bId ? 1 : 0;
  }
  return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
}

function postUrl(post) {
  const username = post.author && typeof post.author.username === "string"
    ? post.author.username.replace(/^@/, "")
    : "";
  return username.length > 0 && typeof post.id === "string"
    ? `https://x.com/${username}/status/${post.id}`
    : "";
}

function authorUrl(post) {
  const username = post.author && typeof post.author.username === "string"
    ? post.author.username.replace(/^@/, "")
    : "";
  return username.length > 0 ? `https://x.com/${username}` : "";
}

function normalizePost(post) {
  const metrics = isObject(post.metrics) ? post.metrics : {};
  return {
    id: typeof post.id === "string" ? post.id : "",
    text: typeof post.text === "string" ? post.text : "",
    createdAt: typeof post.createdAt === "string" ? post.createdAt : "",
    author: isObject(post.author)
      ? {
          username:
            typeof post.author.username === "string" ? post.author.username : "",
          name: typeof post.author.name === "string" ? post.author.name : "",
        }
      : { username: "", name: "" },
    metrics: {
      impressionCount:
        typeof metrics.impressionCount === "number"
          ? metrics.impressionCount
          : null,
      likeCount: typeof metrics.likeCount === "number" ? metrics.likeCount : null,
      replyCount:
        typeof metrics.replyCount === "number" ? metrics.replyCount : null,
      repostCount:
        typeof metrics.repostCount === "number" ? metrics.repostCount : null,
      quoteCount:
        typeof metrics.quoteCount === "number" ? metrics.quoteCount : null,
      bookmarkCount:
        typeof metrics.bookmarkCount === "number" ? metrics.bookmarkCount : null,
    },
    postUrl: postUrl(post),
    authorUrl: authorUrl(post),
    referencedPosts: Array.isArray(post.referencedPosts)
      ? post.referencedPosts
          .filter(isObject)
          .map((ref) => ({
            relation: typeof ref.relation === "string" ? ref.relation : "",
            id: typeof ref.id === "string" ? ref.id : "",
            text: typeof ref.text === "string" ? ref.text : "",
            author: isObject(ref.author)
              ? {
                  username:
                    typeof ref.author.username === "string"
                      ? ref.author.username
                      : "",
                  name:
                    typeof ref.author.name === "string" ? ref.author.name : "",
                }
              : { username: "", name: "" },
          }))
      : [],
  };
}

const mailboxDir = process.env.RIEL_MAILBOX_DIR;
const input = readJson(path.join(mailboxDir, "inbox", "input.json"));
const payloads = upstreamPayloads(input);
const cursor = findCursorPayload(payloads);
const xGatewayPayload = findXGatewayPayload(payloads);
const xGateway = isObject(xGatewayPayload.xGateway) ? xGatewayPayload.xGateway : {};
const timeline =
  xGateway &&
  xGateway.data &&
  xGateway.data.data &&
  (xGateway.data.data.followingTimeline || xGateway.data.data.homeTimeline);
const rawPosts =
  timeline && Array.isArray(timeline.posts) ? timeline.posts : [];
const fetchedPosts = rawPosts.filter(isObject).map(normalizePost);
const windowStart = parseDate(cursor.windowStartIso);
const windowEnd = parseDate(cursor.requestedAt) || new Date();
const sinceId = typeof cursor.sinceId === "string" ? cursor.sinceId : "";
const sinceIdNumeric = numericPostId(sinceId);
const maxPosts = typeof cursor.maxPosts === "number" ? cursor.maxPosts : 50;

const selectedPosts = fetchedPosts
  .filter((post) => {
    const createdAt = parseDate(post.createdAt);
    const inWindow =
      createdAt === null ||
      ((windowStart === null || createdAt >= windowStart) &&
        createdAt <= windowEnd);
    const postId = numericPostId(post.id);
    const afterCursor =
      sinceIdNumeric === null ||
      postId === null ||
      postId > sinceIdNumeric;
    return inWindow && afterCursor;
  })
  .sort(comparePostIdsDescending)
  .slice(0, maxPosts);

const maxFetchedPostId =
  fetchedPosts
    .map((post) => post.id)
    .filter((id) => numericPostId(id) !== null)
    .sort((a, b) => (BigInt(a) > BigInt(b) ? -1 : BigInt(a) < BigInt(b) ? 1 : 0))[0] ||
  sinceId;

const output = {
  when: {
    always: true,
  },
  payload: {
    fetchWindow: {
      startIso: cursor.windowStartIso || "",
      endIso: cursor.requestedAt || "",
      lookbackMinutes: cursor.lookbackMinutes || 60,
    },
    sinceId,
    maxPosts,
    fetchedPostCount: fetchedPosts.length,
    selectedPostCount: selectedPosts.length,
    maxFetchedPostId,
    pageInfo: timeline && isObject(timeline.pageInfo)
      ? timeline.pageInfo
      : {},
    selectedPosts,
  },
};

fs.writeFileSync(
  path.join(mailboxDir, "outbox", "output.json"),
  `${JSON.stringify(output, null, 2)}\n`,
);
NODE
