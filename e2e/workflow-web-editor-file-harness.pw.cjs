const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { expect, test } = require("@playwright/test");

const sampleBundle = {
  workflow: {
    workflowId: "browser-demo",
    description: "New workflow",
    defaults: {
      maxLoopIterations: 3,
      nodeTimeoutMs: 120000,
    },
    prompts: {
      divedraPromptTemplate:
        "Coordinate {{workflowId}} so each node and sub-workflow works for a clear reason and returns the value needed downstream.",
      workerSystemPromptTemplate:
        "Work only on the assigned node task, use the provided workflow context, and return the business JSON payload requested by the node.",
    },
    managerNodeId: "divedra-manager",
    subWorkflows: [
      {
        id: "main",
        description: "Main sub-workflow",
        managerNodeId: "main-divedra",
        inputNodeId: "workflow-input",
        outputNodeId: "workflow-output",
        nodeIds: ["main-divedra", "workflow-input", "workflow-output"],
        inputSources: [{ type: "human-input" }],
        block: { type: "plain" },
      },
    ],
    nodes: [
      {
        id: "divedra-manager",
        nodeFile: "node-divedra-manager.json",
        kind: "root-manager",
        completion: { type: "none" },
      },
      {
        id: "main-divedra",
        nodeFile: "node-main-divedra.json",
        kind: "sub-divedra-manager",
        completion: { type: "none" },
      },
      {
        id: "workflow-input",
        nodeFile: "node-workflow-input.json",
        kind: "input",
        completion: { type: "none" },
      },
      {
        id: "workflow-output",
        nodeFile: "node-workflow-output.json",
        kind: "output",
        completion: { type: "none" },
      },
    ],
    edges: [{ from: "workflow-input", to: "workflow-output", when: "always" }],
    loops: [],
    branching: { mode: "fan-out" },
  },
  workflowVis: {
    nodes: [
      { id: "divedra-manager", order: 0 },
      { id: "main-divedra", order: 1 },
      { id: "workflow-input", order: 2 },
      { id: "workflow-output", order: 3 },
    ],
    uiMeta: { layout: "vertical" },
  },
  nodePayloads: {
    "divedra-manager": {
      id: "divedra-manager",
      model: "gpt-5",
      executionBackend: "tacogips/codex-agent",
      promptTemplate: "Coordinate workflow execution for {{workflowId}}",
      variables: { workflowId: "browser-demo" },
    },
    "main-divedra": {
      id: "main-divedra",
      model: "gpt-5",
      executionBackend: "tacogips/codex-agent",
      promptTemplate:
        "Translate the parent divedra instruction into this sub-workflow's child work for {{workflowId}}",
      variables: { workflowId: "browser-demo" },
    },
    "workflow-input": {
      id: "workflow-input",
      model: "gpt-5",
      executionBackend: "tacogips/codex-agent",
      promptTemplate:
        "Normalize the received sub-workflow instruction into workflow input",
      variables: {},
    },
    "workflow-output": {
      id: "workflow-output",
      model: "gpt-5",
      executionBackend: "tacogips/codex-agent",
      promptTemplate: "Finalize workflow output",
      variables: {},
    },
  },
};

const sampleDerivedVisualization = [
  { id: "divedra-manager", order: 0, indent: 0, color: "default" },
  { id: "main-divedra", order: 1, indent: 0, color: "default" },
  { id: "workflow-input", order: 2, indent: 1, color: "group:main" },
  { id: "workflow-output", order: 3, indent: 1, color: "group:main" },
];

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createWorkflowResponse(workflowName) {
  const bundle = deepClone(sampleBundle);
  bundle.workflow.workflowId = workflowName;
  bundle.workflow.description = "New workflow";
  bundle.nodePayloads["divedra-manager"].variables.workflowId = workflowName;
  bundle.nodePayloads["main-divedra"].variables.workflowId = workflowName;

  return {
    workflowName,
    workflowDirectory: `/virtual/workflows/${workflowName}`,
    revision: `sha256:${workflowName}-rev-1`,
    bundle,
    derivedVisualization: deepClone(sampleDerivedVisualization),
  };
}

function createSessionDetail(workflowName, workflowExecutionId) {
  return {
    workflowExecutionId,
    sessionId: workflowExecutionId,
    workflowName,
    workflowId: workflowName,
    status: "paused",
    startedAt: "2026-03-09T10:00:00.000Z",
    endedAt: undefined,
    queue: ["workflow-output"],
    currentNodeId: "workflow-output",
    nodeExecutionCounter: 1,
    nodeExecutionCounts: {
      "divedra-manager": 1,
    },
    loopIterationCounts: {},
    restartCounts: {},
    restartEvents: [],
    transitions: [
      { from: "workflow-input", to: "workflow-output", when: "always" },
    ],
    nodeExecutions: [
      {
        nodeId: "divedra-manager",
        nodeExecId: `${workflowExecutionId}-node-1`,
        status: "succeeded",
        artifactDir: `/virtual/artifacts/${workflowExecutionId}/divedra-manager/1`,
        startedAt: "2026-03-09T10:00:00.000Z",
        endedAt: "2026-03-09T10:00:02.000Z",
      },
    ],
    communicationCounter: 0,
    communications: [],
    conversationTurns: [],
    nodeBackendSessions: {},
    runtimeVariables: {
      workflowName,
      topic: "demo",
    },
  };
}

function sessionSummaryFromDetail(detail) {
  return {
    workflowExecutionId: detail.workflowExecutionId,
    sessionId: detail.sessionId,
    workflowName: detail.workflowName,
    status: detail.status,
    currentNodeId: detail.currentNodeId ?? null,
    nodeExecutionCounter: detail.nodeExecutionCounter,
    startedAt: detail.startedAt,
    endedAt: detail.endedAt ?? null,
  };
}

function jsonResponse(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload, null, 2));
}

function handleGraphqlRequest(state, body) {
  const query =
    typeof body.query === "string" ? body.query : "";
  const variables =
    body.variables !== null && typeof body.variables === "object"
      ? body.variables
      : {};

  if (query.includes("query Workflows")) {
    return {
      data: {
        workflows: [...state.workflows],
      },
    };
  }

  if (query.includes("workflowDefinition(")) {
    const workflowName =
      typeof variables.workflowName === "string"
        ? variables.workflowName
        : "";
    return {
      data: {
        workflowDefinition: deepClone(
          state.workflowResponses[workflowName] ?? null,
        ),
      },
    };
  }

  if (query.includes("createWorkflowDefinition")) {
    const input =
      variables.input !== null && typeof variables.input === "object"
        ? variables.input
        : {};
    const workflowName =
      typeof input.workflowName === "string" ? input.workflowName.trim() : "";
    const created = createWorkflowResponse(workflowName);
    state.workflows = [...state.workflows, workflowName];
    state.workflowResponses[workflowName] = created;
    return {
      data: {
        createWorkflowDefinition: deepClone(created),
      },
    };
  }

  if (query.includes("saveWorkflowDefinition")) {
    const input =
      variables.input !== null && typeof variables.input === "object"
        ? variables.input
        : {};
    const workflowName =
      typeof input.workflowName === "string" ? input.workflowName : "";
    const current = state.workflowResponses[workflowName];
    const revisionNumber =
      Number(String(current.revision).split("-rev-")[1] ?? "1") + 1;
    const updated = {
      ...current,
      revision: "sha256:" + workflowName + "-rev-" + String(revisionNumber),
      bundle: deepClone(input.bundle),
    };
    state.workflowResponses[workflowName] = updated;
    return {
      data: {
        saveWorkflowDefinition: {
          workflowName,
          workflowDirectory: updated.workflowDirectory,
          revision: updated.revision,
        },
      },
    };
  }

  if (query.includes("validateWorkflowDefinition")) {
    const input =
      variables.input !== null && typeof variables.input === "object"
        ? variables.input
        : {};
    const bundle =
      input.bundle !== null && typeof input.bundle === "object"
        ? input.bundle
        : null;
    const nodes = Array.isArray(bundle?.workflow?.nodes)
      ? bundle.workflow.nodes
      : [];
    if (bundle !== null && nodes.length === 0) {
      return {
        data: {
          validateWorkflowDefinition: {
            valid: false,
            issues: [
              {
                severity: "error",
                path: "workflow.nodes",
                message: "at least one node is required",
              },
            ],
          },
        },
      };
    }
    const workflowName =
      typeof input.workflowName === "string" ? input.workflowName : "";
    return {
      data: {
        validateWorkflowDefinition: {
          valid: true,
          workflowId:
            bundle?.workflow?.workflowId ?? workflowName,
          warnings: [],
          issues: [],
        },
      },
    };
  }

  if (query.includes("workflowExecutions")) {
    return {
      data: {
        workflowExecutions: {
          items: deepClone(state.sessions),
          totalCount: state.sessions.length,
          nextCursor: null,
        },
      },
    };
  }

  if (query.includes("workflowExecution(")) {
    const workflowExecutionId =
      typeof variables.workflowExecutionId === "string"
        ? variables.workflowExecutionId
        : "";
    const detail = state.sessionDetails[workflowExecutionId] ?? null;
    return {
      data: {
        workflowExecution:
          detail === null
            ? null
            : {
                workflowExecutionId,
                session: deepClone(detail),
              },
      },
    };
  }

  if (query.includes("executeWorkflow")) {
    const input =
      variables.input !== null && typeof variables.input === "object"
        ? variables.input
        : {};
    const workflowName =
      typeof input.workflowName === "string" ? input.workflowName : "";
    const workflowExecutionId =
      "sess-20260309T100000Z-" +
      String(state.nextSessionCounter).padStart(2, "0");
    state.nextSessionCounter += 1;
    const detail = createSessionDetail(workflowName, workflowExecutionId);
    state.sessionDetails[workflowExecutionId] = detail;
    state.sessions = [sessionSummaryFromDetail(detail), ...state.sessions];
    return {
      data: {
        executeWorkflow: {
          accepted: true,
          workflowExecutionId,
          sessionId: workflowExecutionId,
          status: "running",
          exitCode: null,
        },
      },
    };
  }

  if (query.includes("cancelWorkflowExecution")) {
    const input =
      variables.input !== null && typeof variables.input === "object"
        ? variables.input
        : {};
    const workflowExecutionId =
      typeof input.workflowExecutionId === "string"
        ? input.workflowExecutionId
        : "";
    const current = state.sessionDetails[workflowExecutionId];
    if (current !== undefined) {
      current.status = "cancelled";
      current.endedAt = "2026-03-09T10:05:00.000Z";
      state.sessions = state.sessions.map((session) =>
        session.workflowExecutionId === workflowExecutionId
          ? {
              ...session,
              status: "cancelled",
              endedAt: current.endedAt,
            }
          : session,
      );
    }
    return {
      data: {
        cancelWorkflowExecution: {
          accepted: true,
          workflowExecutionId,
          sessionId: workflowExecutionId,
          status: current?.status ?? "cancelled",
        },
      },
    };
  }

  return {
    errors: [
      {
        message: `Unhandled harness GraphQL request: ${query.trim()}`,
      },
    ],
  };
}

async function detectFrontendModeFromEntrypoints() {
  const { detectUiFramework, frontendModeFromUiFramework } = await import(
    "../scripts/ui-framework.mjs"
  );
  return frontendModeFromUiFramework(detectUiFramework());
}

function renderHarnessHtml(assetUrls) {
  const stylesheetTags = assetUrls.stylesheetUrls
    .map(
      (stylesheetUrl) =>
        `    <link rel="stylesheet" href="${stylesheetUrl}" />`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>divedra UI harness</title>
${stylesheetTags}
    <script type="module" src="${assetUrls.moduleScriptUrl}"></script>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>`;
}

function contentTypeForAsset(assetPath) {
  if (assetPath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (assetPath.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }
  return "application/octet-stream";
}

async function readJsonRequest(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const rawBody = Buffer.concat(chunks).toString("utf8").trim();
  if (rawBody.length === 0) {
    return {};
  }
  return JSON.parse(rawBody);
}

async function startHarnessServer(assetUrls, frontendMode) {
  const state = {
    config: {
      fixedWorkflowName: null,
      readOnly: false,
      noExec: false,
      frontend: frontendMode,
    },
    workflows: [],
    workflowResponses: {},
    sessions: [],
    sessionDetails: {},
    nextSessionCounter: 1,
  };

  const server = createServer(async (request, response) => {
    try {
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const pathname = url.pathname;

      if (pathname === "/") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
        });
        response.end(renderHarnessHtml(assetUrls));
        return;
      }

      if (
        pathname === assetUrls.moduleScriptUrl ||
        assetUrls.stylesheetUrls.includes(pathname)
      ) {
        const assetPath = path.join(
          process.cwd(),
          "ui",
          "dist",
          pathname.replace(/^\/+/u, ""),
        );
        const body = await readFile(assetPath);
        response.writeHead(200, {
          "content-type": contentTypeForAsset(pathname),
        });
        response.end(body);
        return;
      }

      if (pathname === "/api/ui-config" && method === "GET") {
        jsonResponse(response, 200, deepClone(state.config));
        return;
      }

      if (pathname === "/graphql" && method === "POST") {
        const body = await readJsonRequest(request);
        jsonResponse(response, 200, handleGraphqlRequest(state, body));
        return;
      }

      jsonResponse(response, 404, {
        error: `Unhandled harness request: ${method} ${pathname}`,
      });
    } catch (error) {
      jsonResponse(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(undefined);
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("mock harness server did not provide a numeric port");
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
  };
}

test("runs browser workflow editor flow against the built UI with a file-backed mock API", async ({
  page,
}) => {
  const { parseBuiltIndexAssets } = await import("../scripts/ui-built-assets.mjs");
  const builtIndexHtml = await readFile(
    path.join(process.cwd(), "ui", "dist", "index.html"),
    "utf8",
  );
  const assetUrls = parseBuiltIndexAssets(builtIndexHtml, (assetPath) => assetPath);
  const frontendMode = await detectFrontendModeFromEntrypoints();
  const { server, baseUrl } = await startHarnessServer(assetUrls, frontendMode);

  try {
    await page.goto(`${baseUrl}/`);

    await expect(
      page.getByRole("heading", { name: "divedra Workflow Editor" }),
    ).toBeVisible();

    await page.getByLabel("Create Workflow").fill("browser-demo");
    await page.getByRole("button", { name: "Create" }).click();

    await expect(page.getByLabel("Select Workflow")).toHaveValue(
      "browser-demo",
    );
    await expect(page.locator(".message.info")).toContainText(
      "Created workflow 'browser-demo'.",
    );

    await page
      .getByLabel("Workflow Description")
      .fill("Workflow created through file-backed browser regression");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".message.info")).toContainText(
      "Saved workflow 'browser-demo' at revision",
    );

    await page
      .getByLabel("Mock Scenario JSON")
      .fill(
        '{"divedra-manager":{"provider":"scenario-mock","when":{"always":true},"payload":{"stage":"design"}}}',
      );
    await page.getByLabel("Max Steps").fill("1");
    await page.getByRole("button", { name: "Run Workflow" }).click();

    await expect(page.locator(".message.info")).toContainText(
      "Execution accepted for 'browser-demo' as execution sess-",
    );
    await expect(page.locator(".sessions")).toContainText("sess-");
    await expect(page.locator(".session-detail")).toContainText("Execution ID");
    await expect(page.locator(".session-detail")).toContainText("Session ID");
    await expect(page.locator(".session-detail")).toContainText("paused");
    await expect(page.locator(".session-detail")).toContainText(
      '"workflowName": "browser-demo"',
    );
    await expect(page.locator(".execution-history")).toContainText(
      "divedra-manager",
    );

    await page.getByRole("button", { name: "Cancel Selected" }).click();
    await expect(page.locator(".message.info")).toContainText(
      "Cancelled execution sess-",
    );
    await expect(page.locator(".session-detail")).toContainText("cancelled");
  } finally {
    await new Promise((resolve) => {
      server.close(() => resolve(undefined));
    });
  }
});
