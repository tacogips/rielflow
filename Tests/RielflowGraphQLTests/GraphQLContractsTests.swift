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
      "type ManagerIntentSummary",
      "type SendManagerMessagePayload",
      "type ReplayCommunicationPayload",
      "type RetryCommunicationDeliveryPayload",
      "hookEvents: [HookEvent!]!",
      "eventReceipts: [EventReceipt!]!",
      "replyDispatches: [ReplyDispatch!]!",
      "logs: [LogEntry!]!",
      "llmSessionMessages: [LLMSessionMessage!]!",
      "createdOrder: Int!",
      "failureReason: String",
      "input ContinueSessionInput { workflowId: String!, sessionId: String!, input: JSONObject! }",
      "input SendManagerMessageInput { workflowId: String!, workflowExecutionId: String!, message: String, actions: JSON, attachments: JSON, idempotencyKey: String, managerSessionId: String, managerNodeExecId: String }",
      "input ReplayCommunicationInput { workflowId: String!, workflowExecutionId: String!, communicationId: String!, reason: String, idempotencyKey: String, managerSessionId: String }",
      "input RetryCommunicationDeliveryInput { workflowId: String!, workflowExecutionId: String!, communicationId: String!, reason: String, idempotencyKey: String, managerSessionId: String }",
      "managerSession(managerSessionId: String): ManagerSessionView",
      "continueSession(input: ContinueSessionInput!): ControlPlaneResult!",
      "sendManagerMessage(input: SendManagerMessageInput!): SendManagerMessagePayload!",
      "replayCommunication(input: ReplayCommunicationInput!): ReplayCommunicationPayload!",
      "retryCommunicationDelivery(input: RetryCommunicationDeliveryInput!): RetryCommunicationDeliveryPayload!"
    ] {
      XCTAssertTrue(schema.contains(field), "missing schema field: \(field)")
    }
    XCTAssertFalse(schema.contains("continueSession(workflowId: String!, sessionId: String!)"))
    XCTAssertFalse(schema.contains("managerRuntimeId"))
  }

  func testManagerControlRequestsPreserveInputShapeAndIdempotency() throws {
    let send = GraphQLSendManagerMessageRequest(
      workflowId: "workflow-a",
      workflowExecutionId: "exec-a",
      message: "resume",
      actions: .object(["retryStepIds": .array([.string("worker-step")])]),
      attachments: .array([.object(["path": .string("files/workflow-a/exec-a/a.png")])]),
      idempotencyKey: "idem-send",
      managerSessionId: "mgrsess-1",
      managerNodeExecId: "node-exec-1"
    )
    let replay = GraphQLReplayCommunicationRequest(
      workflowId: "workflow-a",
      workflowExecutionId: "exec-a",
      communicationId: "comm-1",
      reason: "retry downstream",
      idempotencyKey: "idem-replay",
      managerSessionId: "mgrsess-1"
    )
    let sendObject = try encodedObject(send)
    let replayObject = try encodedObject(replay)

    XCTAssertEqual(sendObject["idempotencyKey"], .string("idem-send"))
    XCTAssertEqual(sendObject["managerSessionId"], .string("mgrsess-1"))
    XCTAssertEqual(sendObject["managerNodeExecId"], .string("node-exec-1"))
    XCTAssertEqual(sendObject["workflowExecutionId"], .string("exec-a"))
    XCTAssertEqual(sendObject["actions"], .object(["retryStepIds": .array([.string("worker-step")])]))
    XCTAssertEqual(sendObject["attachments"], .array([.object(["path": .string("files/workflow-a/exec-a/a.png")])]))
    XCTAssertEqual(replayObject["communicationId"], .string("comm-1"))
    XCTAssertEqual(replayObject["idempotencyKey"], .string("idem-replay"))
    XCTAssertNil(sendObject["communicationId"])
  }

  func testManagerControlPayloadsExposeResultFields() {
    let sendPayload = GraphQLSendManagerMessagePayload(
      accepted: true,
      managerMessageId: "mgrmsg-1",
      parsedIntent: [.init(kind: "retry-step", targetId: "worker-step", reason: "operator")],
      createdCommunicationIds: ["comm-2"],
      queuedNodeIds: ["worker-step"],
      workflowId: "workflow-a",
      workflowExecutionId: "exec-a",
      managerSessionId: "mgrsess-1"
    )
    let replayPayload = GraphQLReplayCommunicationPayload(
      sourceCommunicationId: "comm-1",
      workflowExecutionId: "exec-a",
      replayedCommunicationId: "comm-2",
      status: "queued"
    )
    let retryPayload = GraphQLRetryCommunicationDeliveryPayload(
      communicationId: "comm-2",
      activeDeliveryAttemptId: "attempt-1",
      status: "queued"
    )

    XCTAssertTrue(sendPayload.accepted)
    XCTAssertEqual(sendPayload.createdCommunicationIds, ["comm-2"])
    XCTAssertEqual(sendPayload.parsedIntent.first?.kind, "retry-step")
    XCTAssertEqual(replayPayload.replayedCommunicationId, "comm-2")
    XCTAssertEqual(retryPayload.activeDeliveryAttemptId, "attempt-1")
  }

  private func encodedObject<T: Encodable>(_ value: T) throws -> JSONObject {
    let data = try JSONEncoder().encode(value)
    guard case let .object(object) = try JSONDecoder().decode(JSONValue.self, from: data) else {
      return [:]
    }
    return object
  }
}
