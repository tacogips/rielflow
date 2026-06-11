import XCTest
@testable import RielflowCore

final class WorkflowModelTests: XCTestCase {
  func testNormalizesKnownBackends() {
    XCTAssertEqual(normalizeCliAgentBackend("codex-agent"), .codexAgent)
    XCTAssertEqual(normalizeCliAgentBackend("claude-code-agent"), .claudeCodeAgent)
    XCTAssertEqual(normalizeCliAgentBackend("cursor-cli-agent"), .cursorCliAgent)
    XCTAssertNil(normalizeCliAgentBackend("official/openai-sdk"))
    XCTAssertEqual(normalizeNodeExecutionBackend("official/anthropic-sdk"), .officialAnthropicSDK)
  }

  func testWorkflowDecodesStepAddressedShape() throws {
    let data = """
      {
        "workflowId": "sample",
        "description": "Sample workflow",
        "defaults": { "nodeTimeoutMs": 120000, "maxLoopIterations": 3 },
        "entryStepId": "main",
        "nodes": [{ "id": "main", "nodeFile": "nodes/main.json" }],
        "steps": [{ "id": "main", "nodeId": "main", "role": "worker" }]
      }
      """.data(using: .utf8)!

    let workflow = try JSONDecoder().decode(AuthoredWorkflowJSON.self, from: data)

    XCTAssertEqual(workflow.workflowId, "sample")
    XCTAssertEqual(workflow.defaults.nodeTimeoutMs, 120000)
    XCTAssertEqual(workflow.nodes.first?.nodeFile, "nodes/main.json")
    XCTAssertEqual(workflow.steps?.first?.role, .worker)
  }

  func testWorkflowValidationLoadsProjectDesignLoopFixture() throws {
    let rootURL = try repositoryRoot()
    let fixtureURL = rootURL.appendingPathComponent(".rielflow/workflows/codex-design-and-implement-review-loop/workflow.json")
    let data = try Data(contentsOf: fixtureURL)

    let result = validateAuthoredWorkflowData(data)

    XCTAssertTrue(result.diagnostics.filter { $0.severity == .error }.isEmpty)
    let workflow = try XCTUnwrap(result.workflow)
    XCTAssertEqual(workflow.workflowId, "codex-design-and-implement-review-loop")
    XCTAssertEqual(workflow.entryStepId, "rielflow-manager")
    XCTAssertEqual(workflow.managerStepId, "rielflow-manager")
    XCTAssertEqual(workflow.defaults.fanoutConcurrency, 20)
    XCTAssertTrue(workflow.steps.contains { $0.id == "step6-implement" })
    XCTAssertEqual(workflow.steps.first?.transitions?.first?.toStepId, "step1-issue-intake")

    let gitCommitNode = try XCTUnwrap(workflow.nodes.first { $0.id == "step10-git-commit" })
    XCTAssertNil(gitCommitNode.nodeFile)
    XCTAssertEqual(gitCommitNode.addon?.name, "rielflow/git-commit")

    let gitPushNode = try XCTUnwrap(workflow.nodes.first { $0.id == "step11-git-push" })
    XCTAssertNil(gitPushNode.nodeFile)
    XCTAssertEqual(gitPushNode.addon?.name, "rielflow/git-push")
  }

  func testWorkflowValidationRejectsRemovedTopLevelEdgesAndBrokenStepReference() throws {
    let data = """
      {
        "workflowId": "broken",
        "defaults": { "nodeTimeoutMs": 120000, "maxLoopIterations": 3 },
        "entryStepId": "missing-entry",
        "nodes": [{ "id": "main", "nodeFile": "nodes/main.json" }],
        "steps": [{ "id": "main-step", "nodeId": "missing-node", "role": "worker" }],
        "edges": [{ "from": "main-step", "to": "other-step" }]
      }
      """.data(using: .utf8)!

    let diagnostics = validateAuthoredWorkflowData(data).diagnostics

    XCTAssertTrue(
      diagnostics.contains {
        $0.path == "workflow.edges" && $0.message.contains("workflow.steps[].transitions")
      }
    )
    XCTAssertTrue(
      diagnostics.contains {
        $0.path == "workflow.entryStepId" && $0.message == "must reference workflow.steps[] entry 'missing-entry'"
      }
    )
    XCTAssertTrue(
      diagnostics.contains {
        $0.path == "workflow.steps.main-step.nodeId" && $0.message == "must reference workflow.nodes[] entry 'missing-node'"
      }
    )
  }

  func testWorkflowValidationRejectsUnsafeWorkflowRelativeFilePaths() throws {
    let data = """
      {
        "workflowId": "unsafe-paths",
        "defaults": { "nodeTimeoutMs": 120000, "maxLoopIterations": 3 },
        "entryStepId": "safe-step",
        "nodes": [
          { "id": "unsafe-node", "nodeFile": "../x.json" },
          { "id": "absolute-node", "nodeFile": "/tmp/x.json" },
          { "id": "windows-node", "nodeFile": "C:\\\\tmp\\\\x.json" },
          { "id": "safe-node", "nodeFile": "nodes/node-safe-node.json" }
        ],
        "steps": [
          { "id": "unsafe-step", "nodeId": "unsafe-node" },
          { "id": "absolute-step", "nodeId": "absolute-node" },
          { "id": "windows-step", "nodeId": "windows-node" },
          { "id": "safe-step", "nodeId": "safe-node", "stepFile": "steps/safe-step.json" },
          { "id": "bad-step-file", "nodeId": "safe-node", "stepFile": "../manager-step.json" }
        ]
      }
      """.data(using: .utf8)!

    let diagnostics = validateAuthoredWorkflowData(data).diagnostics

    XCTAssertTrue(
      diagnostics.contains {
        $0.path == "workflow.nodes[0].nodeFile" && $0.message == "nodeFile '../x.json' must be a workflow-relative path without '.' or '..' segments"
      }
    )
    XCTAssertTrue(
      diagnostics.contains {
        $0.path == "workflow.nodes[1].nodeFile" && $0.message == "nodeFile '/tmp/x.json' must be a workflow-relative path without '.' or '..' segments"
      }
    )
    XCTAssertTrue(
      diagnostics.contains {
        $0.path == "workflow.nodes[2].nodeFile" && $0.message == "nodeFile 'C:\\tmp\\x.json' must be a workflow-relative path without '.' or '..' segments"
      }
    )
    XCTAssertTrue(
      diagnostics.contains {
        $0.path == "workflow.steps[4].stepFile" && $0.message == "stepFile '../manager-step.json' must be a workflow-relative path without '.' or '..' segments"
      }
    )
    XCTAssertFalse(diagnostics.contains { $0.path == "workflow.nodes[3].nodeFile" })
    XCTAssertFalse(diagnostics.contains { $0.path == "workflow.steps[3].stepFile" })
  }

  func testTypedWorkflowValidationRejectsUnsafeWorkflowRelativeFilePaths() throws {
    let workflow = AuthoredWorkflowJSON(
      workflowId: "unsafe-typed",
      defaults: WorkflowDefaults(nodeTimeoutMs: 120000, maxLoopIterations: 3),
      entryStepId: "safe-step",
      nodes: [
        WorkflowNodeRegistryRef(id: "unsafe-node", nodeFile: "../x.json"),
        WorkflowNodeRegistryRef(id: "absolute-node", nodeFile: "/tmp/x.json"),
        WorkflowNodeRegistryRef(id: "windows-node", nodeFile: "C:\\tmp\\x.json"),
        WorkflowNodeRegistryRef(id: "safe-node", nodeFile: "nodes/node-safe-node.json")
      ],
      steps: [
        WorkflowStepRef(id: "unsafe-step", nodeId: "unsafe-node"),
        WorkflowStepRef(id: "absolute-step", nodeId: "absolute-node"),
        WorkflowStepRef(id: "windows-step", nodeId: "windows-node"),
        WorkflowStepRef(id: "safe-step", stepFile: "steps/safe-step.json", nodeId: "safe-node"),
        WorkflowStepRef(id: "bad-step-file", stepFile: "../manager-step.json", nodeId: "safe-node")
      ]
    )

    let result = validateAuthoredWorkflowJSON(workflow)

    XCTAssertNil(result.workflow)
    XCTAssertTrue(
      result.diagnostics.contains {
        $0.path == "workflow.nodes[0].nodeFile" && $0.message == "nodeFile '../x.json' must be a workflow-relative path without '.' or '..' segments"
      }
    )
    XCTAssertTrue(
      result.diagnostics.contains {
        $0.path == "workflow.nodes[1].nodeFile" && $0.message == "nodeFile '/tmp/x.json' must be a workflow-relative path without '.' or '..' segments"
      }
    )
    XCTAssertTrue(
      result.diagnostics.contains {
        $0.path == "workflow.nodes[2].nodeFile" && $0.message == "nodeFile 'C:\\tmp\\x.json' must be a workflow-relative path without '.' or '..' segments"
      }
    )
    XCTAssertTrue(
      result.diagnostics.contains {
        $0.path == "workflow.steps[4].stepFile" && $0.message == "stepFile '../manager-step.json' must be a workflow-relative path without '.' or '..' segments"
      }
    )
    XCTAssertFalse(result.diagnostics.contains { $0.path == "workflow.nodes[3].nodeFile" })
    XCTAssertFalse(result.diagnostics.contains { $0.path == "workflow.steps[3].stepFile" })
  }

  func testTypedWorkflowValidationRejectsUnsafeNodeIdBeforeSynthesizingNodeFile() throws {
    let workflow = AuthoredWorkflowJSON(
      workflowId: "unsafe-typed-node",
      defaults: WorkflowDefaults(nodeTimeoutMs: 120000, maxLoopIterations: 3),
      entryStepId: "escape-step",
      nodes: [
        WorkflowNodeRegistryRef(id: "../escape")
      ],
      steps: [
        WorkflowStepRef(id: "escape-step", nodeId: "../escape")
      ]
    )

    let result = validateAuthoredWorkflowJSON(workflow)

    XCTAssertNil(result.workflow)
    XCTAssertTrue(
      result.diagnostics.contains {
        $0.path == "workflow.nodes[0].id" && $0.message == "must match ^[a-z0-9][a-z0-9-]{1,63}$"
      }
    )
    XCTAssertTrue(
      result.diagnostics.contains {
        $0.path == "workflow.nodes[0]" && $0.message == "must define nodeFile, inline node, or addon"
      }
    )
  }

  private func repositoryRoot() throws -> URL {
    var current = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
    for _ in 0..<8 {
      if FileManager.default.fileExists(atPath: current.appendingPathComponent("Package.swift").path) {
        return current
      }
      current.deleteLastPathComponent()
    }
    throw NSError(domain: "WorkflowModelTests", code: 1, userInfo: [NSLocalizedDescriptionKey: "Package.swift not found"])
  }
}
