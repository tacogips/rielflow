#!/usr/bin/env sh

set -eu

mailbox_dir="${DIVEDRA_MAILBOX_DIR:?DIVEDRA_MAILBOX_DIR is required}"
plan_path="${PLAN_PATH:-}"
target_tasks_json="${TARGET_TASKS_JSON:-}"
output_path="${mailbox_dir}/outbox/output.json"

mkdir -p "$(dirname "$output_path")"

PLAN_PATH="$plan_path" TARGET_TASKS_JSON="$target_tasks_json" bun -e '
const fs = require("fs");
const path = require("path");

const requestedPlanPath = (process.env.PLAN_PATH ?? "").trim();
let targetTasks = null;
if ((process.env.TARGET_TASKS_JSON ?? "").trim().length > 0) {
  try {
    const parsed = JSON.parse(process.env.TARGET_TASKS_JSON);
    if (Array.isArray(parsed)) {
      targetTasks = new Set(parsed.filter((entry) => typeof entry === "string"));
    }
  } catch {
    targetTasks = null;
  }
}

const outputPath = path.join(process.env.DIVEDRA_MAILBOX_DIR, "outbox", "output.json");

function emit(payload) {
  fs.writeFileSync(
    outputPath,
    `${JSON.stringify(
      {
        when: { plan_complete: payload.plan_complete === true },
        payload,
      },
      null,
      2,
    )}\n`,
  );
}

function readPlanTasks(planPath) {
  const text = fs.readFileSync(planPath, "utf8");
  const taskRegex = /^### (TASK-\d+): ([^\n]+)\n([\s\S]*?)(?=^### TASK-\d+: |\n## Dependencies|\n## Parallelization Notes|\n## Verification Plan|\n## Plan Completion Criteria|\n## Completion Criteria|\n## Progress Log|(?![\s\S]))/gm;
  const tasks = [];
  let match;
  while ((match = taskRegex.exec(text)) !== null) {
    const [, taskId, title, body] = match;
    if (targetTasks !== null && !targetTasks.has(taskId)) {
      continue;
    }
    const statusMatch = body.match(/\*\*Status\*\*:\s*([^\n]+)/);
    const depsMatch = body.match(/\*\*Dependencies\*\*:\s*([^\n]+)/);
    const criteria = [];
    for (const criteriaMatch of body.matchAll(/^- \[( |x|X)\] (.+)$/gm)) {
      criteria.push({
        done: criteriaMatch[1].toLowerCase() === "x",
        text: criteriaMatch[2],
      });
    }
    const status = normalizeStatus(statusMatch?.[1], criteria);
    tasks.push({
      taskId,
      title: title.trim(),
      status,
      dependencies: depsMatch?.[1]?.trim() ?? "None",
      completionCriteria: criteria,
    });
  }
  if (tasks.length === 0) {
    for (const rowMatch of text.matchAll(
      /^\|\s*(TASK-\d+)\s+([^|]+?)\s*\|[^|]*\|\s*([^|]+?)\s*\|[^|]*\|$/gm,
    )) {
      const [, taskId, title, statusRaw] = rowMatch;
      if (targetTasks !== null && !targetTasks.has(taskId)) {
        continue;
      }
      tasks.push({
        taskId,
        title: title.trim(),
        status: normalizeStatus(statusRaw, []),
        dependencies: "See plan dependencies table",
        completionCriteria: [],
      });
    }
  }
  return tasks;
}

function selectPlanPath() {
  if (requestedPlanPath.length > 0) {
    return {
      planPath: requestedPlanPath,
      selectionMode: "explicit",
      candidatePlans: [],
    };
  }

  const activeDir = path.join("impl-plans", "active");
  if (!fs.existsSync(activeDir)) {
    return {
      planPath: path.join(activeDir, "__missing__.md"),
      selectionMode: "active-auto",
      candidatePlans: [],
    };
  }

  const candidatePlans = fs
    .readdirSync(activeDir)
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => path.join(activeDir, entry))
    .sort();

  for (const candidate of candidatePlans) {
    const candidateTasks = readPlanTasks(candidate);
    if (
      candidateTasks.length > 0 &&
      candidateTasks.some((task) => task.status !== "Completed")
    ) {
      return {
        planPath: candidate,
        selectionMode: "active-auto",
        candidatePlans,
      };
    }
  }

  return {
    planPath: candidatePlans[0] ?? path.join(activeDir, "__empty__.md"),
    selectionMode: "active-auto",
    candidatePlans,
  };
}

const planSelection = selectPlanPath();
const planPath = planSelection.planPath;

if (!fs.existsSync(planPath)) {
  emit({
    plan_complete: false,
    planPath,
    planSelectionMode: planSelection.selectionMode,
    candidatePlans: planSelection.candidatePlans,
    error: "plan file not found",
    incompleteTasks: [],
    completedTasks: [],
    nextTaskId: null,
    remainingCount: 0,
  });
  process.exit(1);
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

const tasks = readPlanTasks(planPath);

const completedTasks = tasks.filter((task) => task.status === "Completed");
const incompleteTasks = tasks.filter((task) => task.status !== "Completed");
const inProgress = incompleteTasks.find((task) => task.status === "In Progress");
const notStarted = incompleteTasks.find((task) => task.status === "Not Started");
const ready = incompleteTasks.find((task) => task.status === "Ready");
const nextTask = inProgress ?? notStarted ?? ready ?? incompleteTasks[0] ?? null;

emit({
  plan_complete: incompleteTasks.length === 0,
  planPath,
  planSelectionMode: planSelection.selectionMode,
  candidatePlans: planSelection.candidatePlans,
  targetTasks: targetTasks === null ? null : [...targetTasks],
  taskCount: tasks.length,
  remainingCount: incompleteTasks.length,
  completedTasks: completedTasks.map((task) => ({
    taskId: task.taskId,
    title: task.title,
    status: task.status,
  })),
  incompleteTasks: incompleteTasks.map((task) => ({
    taskId: task.taskId,
    title: task.title,
    status: task.status,
    dependencies: task.dependencies,
    uncheckedCriteria: task.completionCriteria
      .filter((criterion) => !criterion.done)
      .map((criterion) => criterion.text),
  })),
  nextTaskId: nextTask?.taskId ?? null,
  nextTaskTitle: nextTask?.title ?? null,
  nextTaskStatus: nextTask?.status ?? null,
  completionCriteria: nextTask?.completionCriteria ?? [],
  guidance:
    nextTask === null
      ? "All target tasks are completed."
      : `Implement ${nextTask.taskId} and update ${planPath} before reassessment.`,
});
'
