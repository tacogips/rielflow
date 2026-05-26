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
  const headingRegex = /^### ((?:TASK|REF)-\d+): ([^\n]+)/gm;
  const headingTitles = new Map(
    [...text.matchAll(headingRegex)].map((headingMatch) => [
      headingMatch[1],
      headingMatch[2].trim(),
    ]),
  );
  const taskRegex = /^### ((?:TASK|REF)-\d+): ([^\n]+)\n([\s\S]*?)(?=^### (?:TASK|REF)-\d+: |\n## Dependencies|\n## Parallelization Notes|\n## Verification Plan|\n## Plan Completion Criteria|\n## Completion Criteria|\n## Progress Log|(?![\s\S]))/gm;
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
      /^\|\s*((?:TASK|REF)-\d+)\s*\|\s*([^|]+?)\s*\|.*$/gm,
    )) {
      const [, taskId, statusRaw] = rowMatch;
      tasks.push({
        taskId,
        title: headingTitles.get(taskId) ?? taskId,
        status: normalizeStatus(statusRaw, []),
        dependencies: "See plan dependencies table",
        completionCriteria: [],
      });
    }
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

function readPlanTopStatus(planPath) {
  const text = fs.readFileSync(planPath, "utf8");
  return normalizeStatus(text.match(/^\*\*Status\*\*:\s*([^\n]+)/m)?.[1], []);
}

function readPlanDesignReference(planPath) {
  const text = fs.readFileSync(planPath, "utf8");
  return text.match(/^\*\*Design Reference\*\*:\s*([^\n]+)/m)?.[1]?.trim() ?? "Unspecified";
}

function isPlanComplete(planPath) {
  const tasks = readPlanTasks(planPath);
  if (tasks.length > 0) {
    return tasks.every((task) => task.status === "Completed");
  }
  return readPlanTopStatus(planPath) === "Completed";
}

function selectPlanPath() {
  if (requestedPlanPath.length > 0) {
    return {
      planPath: requestedPlanPath,
      selectionMode: "explicit",
      candidatePlans: [],
      completedCandidatePlans: [],
    };
  }

  const activeDir = path.join("impl-plans", "active");
  if (!fs.existsSync(activeDir)) {
    return {
      planPath: null,
      selectionMode: "active-auto",
      candidatePlans: [],
      completedCandidatePlans: [],
    };
  }

  const candidatePlans = fs
    .readdirSync(activeDir)
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => path.join(activeDir, entry))
    .sort();

  const completedCandidatePlans = [];
  for (const candidate of candidatePlans) {
    if (!isPlanComplete(candidate)) {
      return {
        planPath: candidate,
        selectionMode: "active-auto",
        candidatePlans,
        completedCandidatePlans,
      };
    }
    completedCandidatePlans.push(candidate);
  }

  return {
    planPath: null,
    selectionMode: "active-auto",
    candidatePlans,
    completedCandidatePlans,
  };
}

const planSelection = selectPlanPath();
const planPath = planSelection.planPath;

if (planPath === null) {
  emit({
    plan_complete: true,
    activePlanFound: false,
    planPath: null,
    planSelectionMode: planSelection.selectionMode,
    candidatePlans: planSelection.candidatePlans,
    completedCandidatePlans: planSelection.completedCandidatePlans,
    taskCount: 0,
    remainingCount: 0,
    completedTasks: [],
    incompleteTasks: [],
    nextTaskId: null,
    nextTaskTitle: null,
    nextTaskStatus: null,
    completionCriteria: [],
    designReference: null,
    guidance: "No incomplete active implementation plans remain.",
  });
  process.exit(0);
}

if (!fs.existsSync(planPath)) {
  emit({
    plan_complete: false,
    activePlanFound: false,
    planPath,
    planSelectionMode: planSelection.selectionMode,
    candidatePlans: planSelection.candidatePlans,
    completedCandidatePlans: planSelection.completedCandidatePlans,
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
const topStatus = readPlanTopStatus(planPath);

const completedTasks = tasks.filter((task) => task.status === "Completed");
const incompleteTasks = tasks.filter((task) => task.status !== "Completed");
const inProgress = incompleteTasks.find((task) => task.status === "In Progress");
const notStarted = incompleteTasks.find((task) => task.status === "Not Started");
const ready = incompleteTasks.find((task) => task.status === "Ready");
const nextTask = inProgress ?? notStarted ?? ready ?? incompleteTasks[0] ?? null;
const planComplete =
  tasks.length > 0 ? incompleteTasks.length === 0 : topStatus === "Completed";
const remainingCount =
  tasks.length > 0 ? incompleteTasks.length : planComplete ? 0 : 1;

emit({
  plan_complete: planComplete,
  activePlanFound: true,
  planPath,
  planSelectionMode: planSelection.selectionMode,
  candidatePlans: planSelection.candidatePlans,
  completedCandidatePlans: planSelection.completedCandidatePlans,
  targetTasks: targetTasks === null ? null : [...targetTasks],
  taskCount: tasks.length,
  remainingCount,
  designReference: readPlanDesignReference(planPath),
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
    planComplete
      ? "All target tasks are completed."
      : nextTask === null
        ? `Delegate ${planPath} to design-and-implement-review-loop to complete plan-level active work before reassessment.`
      : `Delegate ${planPath} to design-and-implement-review-loop to complete ${nextTask.taskId} and remaining active-plan work before reassessment.`,
});
'
