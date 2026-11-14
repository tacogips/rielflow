#!/usr/bin/env sh

set -eu

mailbox_dir="${DIVEDRA_MAILBOX_DIR:?DIVEDRA_MAILBOX_DIR is required}"
output_path="${mailbox_dir}/outbox/output.json"

mkdir -p "$(dirname "$output_path")"

bun -e '
const fs = require("fs");
const path = require("path");

const mailboxDir = process.env.DIVEDRA_MAILBOX_DIR;
const outputPath = path.join(mailboxDir, "outbox", "output.json");
const inboxInputPath = path.join(mailboxDir, "inbox", "input.json");
const activeDir = path.join("impl-plans", "active");
const completedDir = path.join("impl-plans", "completed");
const readmePath = path.join("impl-plans", "README.md");
const progressPath = path.join("impl-plans", "PROGRESS.json");

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeOutput(payload) {
  fs.writeFileSync(
    outputPath,
    `${JSON.stringify(
      {
        payload,
      },
      null,
      2,
    )}\n`,
  );
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function normalizeStatus(rawStatus, criteria) {
  const trimmed = rawStatus?.trim();
  if (trimmed !== undefined && /^completed$/i.test(trimmed)) {
    return "Completed";
  }
  if (trimmed !== undefined && /^in progress$/i.test(trimmed)) {
    return "In Progress";
  }
  if (trimmed !== undefined && /^not started$/i.test(trimmed)) {
    return "Not Started";
  }
  if (trimmed !== undefined && /^ready$/i.test(trimmed)) {
    return "Ready";
  }
  if (criteria.length > 0 && criteria.every((criterion) => criterion.done)) {
    return "Completed";
  }
  return trimmed ?? "Unknown";
}

function readPlanTasksFromText(text) {
  const taskRegex = /^### (TASK-\d+): ([^\n]+)\n([\s\S]*?)(?=^### TASK-\d+: |\n## Dependencies|\n## Parallelization Notes|\n## Verification Plan|\n## Plan Completion Criteria|\n## Completion Criteria|\n## Progress Log|(?![\s\S]))/gm;
  const tasks = [];
  let match;
  while ((match = taskRegex.exec(text)) !== null) {
    const [, taskId, title, body] = match;
    const statusMatch = body.match(/\*\*Status\*\*:\s*([^\n]+)/);
    const criteria = [];
    for (const criteriaMatch of body.matchAll(/^- \[( |x|X)\] (.+)$/gm)) {
      criteria.push({
        done: criteriaMatch[1].toLowerCase() === "x",
        text: criteriaMatch[2],
      });
    }
    tasks.push({
      taskId,
      title: title.trim(),
      status: normalizeStatus(statusMatch?.[1], criteria),
      completionCriteria: criteria,
    });
  }
  if (tasks.length === 0) {
    for (const rowMatch of text.matchAll(
      /^\|\s*(TASK-\d+)\s+([^|]+?)\s*\|[^|]*\|\s*([^|]+?)\s*\|[^|]*\|$/gm,
    )) {
      const [, taskId, title, statusRaw] = rowMatch;
      tasks.push({
        taskId,
        title: title.trim(),
        status: normalizeStatus(statusRaw, []),
        completionCriteria: [],
      });
    }
  }
  return tasks;
}

function readPlanMetadata(planPath) {
  const text = readText(planPath);
  const topStatus = text.match(/^\*\*Status\*\*:\s*([^\n]+)/m)?.[1]?.trim() ?? "Unknown";
  const designReference =
    text.match(/^\*\*Design Reference\*\*:\s*([^\n]+)/m)?.[1]?.trim() ?? "Unspecified";
  const tasks = readPlanTasksFromText(text);
  const status = normalizeStatus(topStatus, []);
  const complete =
    status === "Completed" ||
    (tasks.length > 0 && tasks.every((task) => task.status === "Completed"));
  return {
    status,
    complete,
    designReference,
    tasks,
  };
}

function summarizeDesignReference(raw) {
  const matches = [...raw.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  const refs = matches.length > 0 ? matches : raw.split(/[;,]/).map((entry) => entry.trim());
  const summarized = refs
    .filter((entry) => entry.length > 0)
    .map((entry) =>
      entry
        .replace(/^design-docs\/specs\//, "")
        .replace(/\.md(#.*)?$/, "")
        .replace(/^design-/, "design-"),
    );
  return summarized.length > 0 ? summarized.map((entry) => `\`${entry}\``).join(", ") : "`unspecified`";
}

function getLatestPlanAssessment() {
  const input = readJsonFile(inboxInputPath, {});
  const upstream = Array.isArray(input.upstream) ? input.upstream : [];
  for (let index = upstream.length - 1; index >= 0; index -= 1) {
    const payload = upstream[index]?.output?.payload;
    if (payload?.plan_complete === true && typeof payload.planPath === "string") {
      return payload;
    }
  }
  const latestOutputs = Array.isArray(input.latestOutputs) ? input.latestOutputs : [];
  for (let index = latestOutputs.length - 1; index >= 0; index -= 1) {
    const payload = latestOutputs[index]?.payload;
    if (payload?.plan_complete === true && typeof payload.planPath === "string") {
      return payload;
    }
  }
  return null;
}

function listPlanFiles(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs
    .readdirSync(directory)
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => path.join(directory, entry))
    .sort();
}

function archiveCompletedActivePlans() {
  fs.mkdirSync(completedDir, { recursive: true });
  const archived = [];
  const skipped = [];
  for (const planPath of listPlanFiles(activeDir)) {
    const metadata = readPlanMetadata(planPath);
    if (!metadata.complete) {
      skipped.push({
        planPath,
        reason: "not complete",
        status: metadata.status,
      });
      continue;
    }
    const destination = path.join(completedDir, path.basename(planPath));
    if (fs.existsSync(destination)) {
      skipped.push({
        planPath,
        reason: `destination exists: ${destination}`,
        status: metadata.status,
      });
      continue;
    }
    fs.renameSync(planPath, destination);
    archived.push({
      planPath,
      completedPath: destination,
      planName: path.basename(planPath, ".md"),
      status: metadata.status,
      designReference: metadata.designReference,
    });
  }
  return { archived, skipped };
}

function buildActivePlansSection() {
  const activePlans = listPlanFiles(activeDir).map((planPath) => {
    const metadata = readPlanMetadata(planPath);
    return {
      planName: path.basename(planPath, ".md"),
      status: metadata.status,
      designReference: metadata.designReference,
    };
  });
  if (activePlans.length === 0) {
    return "## Active Plans\n\nNo active implementation plans remain.\n\n";
  }
  const rows = [
    "## Active Plans",
    "",
    "| Plan | Status | Design Reference |",
    "| ---- | ------ | ---------------- |",
    ...activePlans.map(
      (plan) =>
        `| \`active/${plan.planName}\` | ${plan.status} | ${summarizeDesignReference(plan.designReference)} |`,
    ),
    "",
  ];
  return `${rows.join("\n")}\n`;
}

function updateReadme(archived) {
  if (!fs.existsSync(readmePath)) {
    return false;
  }
  let text = readText(readmePath);
  text = text.replace(
    /## Active Plans\n[\s\S]*?(?=## Recently Completed\n)/,
    buildActivePlansSection(),
  );

  if (archived.length > 0) {
    const today = new Date().toISOString().slice(0, 10);
    const rows = archived
      .filter((plan) => !text.includes(`| \`${plan.planName}\` `))
      .map(
        (plan) =>
          `| \`${plan.planName}\` | ${today} | ${summarizeDesignReference(plan.designReference)} |`,
      );
    if (rows.length > 0) {
      text = text.replace(
        /(## Recently Completed\n\n\| Plan[^\n]*\n\|[- |]*\n)/,
        `$1${rows.join("\n")}\n`,
      );
    }
  }

  fs.writeFileSync(readmePath, text);
  return true;
}

function updateProgress(archived) {
  if (!fs.existsSync(progressPath) || archived.length === 0) {
    return false;
  }
  const progress = readJsonFile(progressPath, null);
  if (progress === null || typeof progress !== "object") {
    return false;
  }
  let changed = false;
  for (const plan of archived) {
    const planRecord = progress.plans?.[plan.planName];
    if (planRecord === undefined) {
      continue;
    }
    if (planRecord.status !== "Completed") {
      planRecord.status = "Completed";
      changed = true;
    }
    if (planRecord.phase !== undefined && progress.phases?.[String(planRecord.phase)] !== undefined) {
      const phaseRecord = progress.phases[String(planRecord.phase)];
      if (phaseRecord.status !== "COMPLETED") {
        phaseRecord.status = "COMPLETED";
        changed = true;
      }
    }
  }
  if (changed) {
    progress.lastUpdated = new Date().toISOString();
    fs.writeFileSync(progressPath, `${JSON.stringify(progress, null, 2)}\n`);
  }
  return changed;
}

const assessment = getLatestPlanAssessment();
const { archived, skipped } = archiveCompletedActivePlans();
const readmeUpdated = updateReadme(archived);
const progressUpdated = updateProgress(archived);

writeOutput({
  status: "archived-completed-plans",
  latestAssessmentPlanPath: assessment?.planPath ?? null,
  archivedPlans: archived,
  skippedPlans: skipped,
  activePlansRemaining: listPlanFiles(activeDir),
  readmeUpdated,
  progressUpdated,
});
'
