import Foundation
import XCTest
@testable import RielflowCore
@testable import RielflowGraphQL

final class GraphQLContractsTests: XCTestCase {
  func testProjectsRuntimeSessionAndMessagesIntoStableDTOs() {
    let date = Date(timeIntervalSince1970: 1)
    let session = WorkflowSession(
      workflowId: "workflow-a",
      sessionId: "session-a",
      status: .running,
      entryStepId: "step-1",
      currentStepId: "step-2",
      createdAt: date,
      updatedAt: date,
      executions: [
        .init(executionId: "exec-1", stepId: "step-1", nodeId: "node-1", attempt: 1, backend: .codexAgent, status: .completed, createdAt: date, updatedAt: date)
      ]
    )
    let message = WorkflowMessageRecord(
      communicationId: "comm-1",
      workflowExecutionId: "session-a",
      fromStepId: "step-1",
      toStepId: "step-2",
      sourceStepExecutionId: "exec-1",
      payload: ["ok": .bool(true)],
      lifecycleStatus: .delivered,
      createdOrder: 1,
      createdAt: date
    )

    let dto = GraphQLContractProjector.project(
      session: session,
      communications: [message],
      hookEvents: [.init(vendor: "codex", eventName: "PostToolUse", agentSessionId: "agent-session")],
      eventReceipts: [.init(sourceId: "web-a", eventId: "evt-1", status: "dry-run")],
      replyDispatches: [.init(sourceId: "web-a", provider: "web", payload: ["text": .string("hi")])],
      logs: [.init(level: "info", message: "ready")],
      llmSessionMessages: [.init(role: "assistant", content: "done")]
    )

    XCTAssertEqual(dto.workflowId, "workflow-a")
    XCTAssertEqual(dto.stepExecutions.first?.backend, "codex-agent")
    XCTAssertEqual(dto.communications.first?.lifecycleStatus, "delivered")
    XCTAssertEqual(dto.hookEvents.first?.eventName, "PostToolUse")
    XCTAssertTrue(GraphQLContractProjector.schemaContract.contains("continueSession"))
  }

  func testSchemaContractExposesStableInspectionDTOFields() {
    let schema = GraphQLContractProjector.schemaContract

    for field in [
      "type ControlPlaneResult",
      "hookEvents: [HookEvent!]!",
      "eventReceipts: [EventReceipt!]!",
      "replyDispatches: [ReplyDispatch!]!",
      "logs: [LogEntry!]!",
      "llmSessionMessages: [LLMSessionMessage!]!",
      "createdOrder: Int!",
      "failureReason: String",
      "input ContinueSessionInput { workflowId: String!, sessionId: String!, input: JSONObject! }",
      "type Mutation { continueSession(input: ContinueSessionInput!): ControlPlaneResult! }"
    ] {
      XCTAssertTrue(schema.contains(field), "missing schema field: \(field)")
    }
    XCTAssertFalse(schema.contains("continueSession(workflowId: String!, sessionId: String!)"))
  }
}
