#!/usr/bin/env sh
set -eu

resolved_input_json=$(cat)
node - "$resolved_input_json" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

function readResolvedInput() {
  const stdin = process.argv[2] || "";
  if (stdin.length > 0) {
    return JSON.parse(stdin);
  }
  throw new Error("stdin resolved input JSON is required");
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

function findNormalizePayload(payloads) {
  return (
    payloads.find(
      (payload) =>
        isObject(payload.fetchWindow) &&
        Array.isArray(payload.selectedPosts) &&
        typeof payload.maxFetchedPostId === "string",
    ) || {}
  );
}

function findSummaryPayload(payloads) {
  return (
    payloads.find(
      (payload) =>
        (Array.isArray(payload.topicDigests) ||
          Array.isArray(payload.filteredPosts)) &&
        typeof payload.shouldSendTelegram === "boolean",
    ) || {}
  );
}

function postUrl(post) {
  if (typeof post.postUrl === "string" && post.postUrl.length > 0) {
    return post.postUrl;
  }
  const username = post.author && typeof post.author.username === "string"
    ? post.author.username.replace(/^@/, "")
    : "";
  return username.length > 0 && typeof post.id === "string"
    ? `https://x.com/${username}/status/${post.id}`
    : "";
}

function authorUrl(post) {
  if (typeof post.authorUrl === "string" && post.authorUrl.length > 0) {
    return post.authorUrl;
  }
  const username = post.author && typeof post.author.username === "string"
    ? post.author.username.replace(/^@/, "")
    : "";
  return username.length > 0 ? `https://x.com/${username}` : "";
}

function viewCount(post) {
  const metrics = isObject(post.metrics) ? post.metrics : {};
  return typeof metrics.impressionCount === "number"
    ? metrics.impressionCount
    : null;
}

function cleanText(value, fallback) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().replace(/\s+/g, " ")
    : fallback;
}

function authorHandle(post) {
  const username = post.author && typeof post.author.username === "string"
    ? post.author.username.replace(/^@/, "")
    : "";
  return username.length > 0 ? `@${username}` : "@unknown";
}

function authorKey(post) {
  const username = post.author && typeof post.author.username === "string"
    ? post.author.username.replace(/^@/, "")
    : "";
  return username.length > 0 ? username.toLowerCase() : "";
}

function sourcePostIds(item) {
  if (Array.isArray(item.sourcePostIds)) {
    return item.sourcePostIds.filter((id) => typeof id === "string" && id.length > 0);
  }
  return typeof item.id === "string" && item.id.length > 0 ? [item.id] : [];
}

const input = readResolvedInput();
const payloads = upstreamPayloads(input);
const normalizePayload = findNormalizePayload(payloads);
const summaryPayload = findSummaryPayload(payloads);
const selectedPosts = Array.isArray(normalizePayload.selectedPosts)
  ? normalizePayload.selectedPosts.filter(isObject)
  : [];
const selectedById = new Map(
  selectedPosts
    .filter((post) => typeof post.id === "string" && post.id.length > 0)
    .map((post) => [post.id, post]),
);
const filteredPosts = Array.isArray(summaryPayload.filteredPosts)
  ? summaryPayload.filteredPosts.filter(isObject)
  : [];
const topicDigests = Array.isArray(summaryPayload.topicDigests)
  ? summaryPayload.topicDigests.filter(isObject)
  : filteredPosts;

const validatedTopics = topicDigests
  .map((item) => {
    const requestedSourcePostIds = sourcePostIds(item);
    const invalidSourcePostIdCount = requestedSourcePostIds.filter(
      (id) => !selectedById.has(id),
    ).length;
    const posts = requestedSourcePostIds
      .map((id) => selectedById.get(id))
      .filter(Boolean);
    const uniquePosts = [];
    const seenPostIds = new Set();
    for (const post of posts) {
      if (!seenPostIds.has(post.id)) {
        seenPostIds.add(post.id);
        uniquePosts.push(post);
      }
    }
    if (uniquePosts.length === 0) {
      return null;
    }
    const sourcePosts = uniquePosts
      .map((post) => ({
        id: post.id,
        postUrl: postUrl(post),
        authorHandle: authorHandle(post),
        authorUrl: authorUrl(post),
        viewCount: viewCount(post),
      }))
      .sort((left, right) => {
        const leftCount = typeof left.viewCount === "number" ? left.viewCount : -1;
        const rightCount = typeof right.viewCount === "number" ? right.viewCount : -1;
        return rightCount - leftCount;
      });
    const users = [];
    const seenUsers = new Set();
    for (const post of uniquePosts) {
      const key = authorKey(post);
      if (key.length > 0 && !seenUsers.has(key)) {
        seenUsers.add(key);
        users.push({
          handle: authorHandle(post),
          url: authorUrl(post),
        });
      }
    }
    const totalViewCount = sourcePosts.reduce(
      (sum, post) => sum + (typeof post.viewCount === "number" ? post.viewCount : 0),
      0,
    );
    return {
      topic: cleanText(item.topic, "AI/business update"),
      reason: cleanText(item.reason, "AI/business relevant"),
      totalViewCount,
      postUserCount: users.length,
      summary: cleanText(item.summary, cleanText(uniquePosts[0].text, "")),
      userLinks: users.slice(0, 3),
      sourcePosts: sourcePosts.slice(0, 3).map(({ authorHandle, ...post }) => post),
      sourcePostIds: uniquePosts.map((post) => post.id),
      invalidSourcePostIdCount,
      ...(typeof item.articleUrl === "string" && item.articleUrl.length > 0
        ? { articleUrl: item.articleUrl }
        : {}),
    };
  })
  .filter(Boolean)
  .sort((left, right) => {
    return right.totalViewCount - left.totalViewCount;
  });

const replyText = validatedTopics
  .map((topic, index) => {
    const users = topic.userLinks
      .map((user) => `${user.handle} ${user.url}`)
      .join(", ");
    const posts = topic.sourcePosts
      .map((post) => post.postUrl)
      .filter((value) => value.length > 0)
      .join(" ");
    const article =
      typeof topic.articleUrl === "string" && topic.articleUrl.length > 0
        ? `\nArticle: ${topic.articleUrl}`
        : "";
    return `${index + 1}. ${topic.topic} (${topic.totalViewCount} views, ${topic.postUserCount} users)\n${topic.summary}\nUsers: ${users}\nPosts: ${posts}${article}`;
  })
  .join("\n");

const maxFetchedPostId =
  typeof normalizePayload.maxFetchedPostId === "string"
    ? normalizePayload.maxFetchedPostId
    : typeof summaryPayload.maxFetchedPostId === "string"
      ? summaryPayload.maxFetchedPostId
      : "";
const output = {
  when: {
    should_send_telegram: validatedTopics.length > 0 && replyText.trim().length > 0,
  },
  payload: {
    shouldSendTelegram: validatedTopics.length > 0,
    maxFetchedPostId,
    replyText,
    topicDigests: validatedTopics,
    filteredPosts: validatedTopics,
    discardedCount:
      typeof summaryPayload.discardedCount === "number"
        ? summaryPayload.discardedCount + (topicDigests.length - validatedTopics.length)
        : selectedPosts.length - validatedTopics.reduce((count, topic) => count + topic.sourcePostIds.length, 0),
    droppedInvalidFilteredPostCount: topicDigests.length - validatedTopics.length,
    droppedInvalidSourcePostIdCount: validatedTopics.reduce(
      (count, topic) => count + topic.invalidSourcePostIdCount,
      0,
    ),
  },
};

process.stdout.write(`${JSON.stringify(output)}\n`);
NODE
