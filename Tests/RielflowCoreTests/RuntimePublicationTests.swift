import XCTest
@testable import RielflowCore

final class RuntimePublicationTests: XCTestCase {
  func testPublicationRecordsAcceptedOutputAndRuntimeGeneratedMessages() async throws {
    let date = Date(timeIntervalSince1970: 300)
    let store = InMemoryWorkflowRuntimeStore(clock: FixedWorkflowRuntimeClock(date))
    let session = try await store.createSession(WorkflowSessionCreateInput(workflowId: "wf", entryStepId: "start"))
    let publisher = InMemoryWorkflowOutputPublisher(store: store, clock: FixedWorkflowRuntimeClock(date))

    let result = try await publisher.publishAcceptedOutput(
      WorkflowPublicationRequest(
        sessionId: session.sessionId,
        stepId: "start",
        nodeId: "node-start",
        attempt: 1,
        backend: .codexAgent,
        adapterOutput: AdapterExecutionOutput(
          provider: "codex-agent",
          model: "gpt-5",
          promptText: "prompt",
          completionPassed: true,
          when: ["next": true],
          payload: ["answer": .string("ok")]
        ),
        outputContract: WorkflowOutputContract(requiredObject: true),
        transitions: [WorkflowStepTransition(toStepId: "next", label: "next")]
      )
    )

    XCTAssertEqual(result.stepExecution.status, .completed)
    XCTAssertEqual(result.stepExecution.acceptedOutput?.payload, ["answer": .string("ok")])
    XCTAssertEqual(result.stepExecution.adapterOutput?.provider, "codex-agent")
    XCTAssertEqual(result.publishedMessages.map(\.communicationId), ["comm-000001"])
    XCTAssertEqual(result.publishedMessages.first?.sourceStepExecutionId, result.stepExecution.executionId)
    XCTAssertEqual(result.publishedMessages.first?.payload, ["answer": .string("ok")])
    XCTAssertEqual(result.publishedMessages.first?.lifecycleStatus, .delivered)
    XCTAssertNil(result.rootOutput)
  }

  func testValidationFailureMarksStepFailedAndPublishesNoMessages() async throws {
    let store = InMemoryWorkflowRuntimeStore(clock: FixedWorkflowRuntimeClock(Date(timeIntervalSince1970: 300)))
    let session = try await store.createSession(WorkflowSessionCreateInput(workflowId: "wf", entryStepId: "start"))
    let publisher = InMemoryWorkflowOutputPublisher(store: store)

    do {
      _ = try await publisher.publishAcceptedOutput(
        WorkflowPublicationRequest(
          sessionId: session.sessionId,
          stepId: "start",
          nodeId: "node-start",
          attempt: 1,
          inlineCandidate: ["completionPassed": .bool(false), "when": .object(["next": .bool(true)]), "payload": .object(["answer": .string("bad")])],
          outputContract: WorkflowOutputContract(requiredObject: true),
          transitions: [WorkflowStepTransition(toStepId: "next", label: "next")]
        )
      )
      XCTFail("expected validation failure")
    } catch WorkflowPublicationError.validationRejected(let reason) {
      XCTAssertEqual(reason, "completionPassed is false")
    }

    let listedMessages = try await store.listMessages(for: session.sessionId, toStepId: nil)
    let loadedSession = try await store.loadSession(id: session.sessionId)
    let updatedSession = try XCTUnwrap(loadedSession)
    XCTAssertEqual(listedMessages, [])
    XCTAssertEqual(updatedSession.executions.first?.status, .failed)
  }

  func testMessageAppendFailurePreventsPublicationSuccess() async throws {
    let store = InMemoryWorkflowRuntimeStore(
      clock: FixedWorkflowRuntimeClock(Date(timeIntervalSince1970: 300)),
      appendFailurePredicate: { _ in "message append blocked" }
    )
    let session = try await store.createSession(WorkflowSessionCreateInput(workflowId: "wf", entryStepId: "start"))
    let publisher = InMemoryWorkflowOutputPublisher(store: store)

    do {
      _ = try await publisher.publishAcceptedOutput(
        WorkflowPublicationRequest(
          sessionId: session.sessionId,
          stepId: "start",
          nodeId: "node-start",
          attempt: 1,
          inlineCandidate: ["answer": .string("ok")],
          transitions: [WorkflowStepTransition(toStepId: "next")]
        )
      )
      XCTFail("expected append failure")
    } catch WorkflowRuntimeStoreError.messageAppendRejected(let reason) {
      XCTAssertEqual(reason, "message append blocked")
    }

    let listedMessages = try await store.listMessages(for: session.sessionId, toStepId: nil)
    let loadedSession = try await store.loadSession(id: session.sessionId)
    let updatedSession = try XCTUnwrap(loadedSession)
    XCTAssertEqual(listedMessages, [])
    XCTAssertEqual(updatedSession.executions.first?.status, .failed)
  }

  func testBatchMessageAppendFailureDoesNotLeavePartialMessages() async throws {
    let store = InMemoryWorkflowRuntimeStore(
      clock: FixedWorkflowRuntimeClock(Date(timeIntervalSince1970: 300)),
      appendFailurePredicate: { input in input.toStepId == "second" ? "second append blocked" : nil }
    )
    let session = try await store.createSession(WorkflowSessionCreateInput(workflowId: "wf", entryStepId: "start"))
    let publisher = InMemoryWorkflowOutputPublisher(store: store)

    do {
      _ = try await publisher.publishAcceptedOutput(
        WorkflowPublicationRequest(
          sessionId: session.sessionId,
          stepId: "start",
          nodeId: "node-start",
          attempt: 1,
          inlineCandidate: ["answer": .string("ok")],
          transitions: [
            WorkflowStepTransition(toStepId: "first"),
            WorkflowStepTransition(toStepId: "second")
          ]
        )
      )
      XCTFail("expected append failure")
    } catch WorkflowRuntimeStoreError.messageAppendRejected(let reason) {
      XCTAssertEqual(reason, "second append blocked")
    }

    let listedMessages = try await store.listMessages(for: session.sessionId, toStepId: nil)
    XCTAssertEqual(listedMessages, [])
  }

  func testRootOutputComesFromAcceptedOutputWithoutDownstreamMessages() async throws {
    let store = InMemoryWorkflowRuntimeStore(clock: FixedWorkflowRuntimeClock(Date(timeIntervalSince1970: 300)))
    let session = try await store.createSession(WorkflowSessionCreateInput(workflowId: "wf", entryStepId: "output"))
    let publisher = InMemoryWorkflowOutputPublisher(store: store)

    let result = try await publisher.publishAcceptedOutput(
      WorkflowPublicationRequest(
        sessionId: session.sessionId,
        stepId: "output",
        nodeId: "node-output",
        attempt: 1,
        inlineCandidate: ["answer": .string("root")],
        transitions: [],
        publishesRootOutput: true
      )
    )

    XCTAssertEqual(result.rootOutput, ["answer": .string("root")])
    XCTAssertEqual(result.publishedMessages, [])
    XCTAssertEqual(result.session.status, .completed)
  }

  func testTerminalNonOutputStepDoesNotPublishRootOutput() async throws {
    let store = InMemoryWorkflowRuntimeStore(clock: FixedWorkflowRuntimeClock(Date(timeIntervalSince1970: 300)))
    let session = try await store.createSession(WorkflowSessionCreateInput(workflowId: "wf", entryStepId: "cleanup"))
    let publisher = InMemoryWorkflowOutputPublisher(store: store)

    let result = try await publisher.publishAcceptedOutput(
      WorkflowPublicationRequest(
        sessionId: session.sessionId,
        stepId: "cleanup",
        nodeId: "node-cleanup",
        attempt: 1,
        inlineCandidate: ["internal": .bool(true)],
        transitions: []
      )
    )

    XCTAssertNil(result.rootOutput)
    XCTAssertEqual(result.publishedMessages, [])
    XCTAssertEqual(result.session.status, .running)
    XCTAssertEqual(result.stepExecution.acceptedOutput?.isRootOutput, false)
  }

  func testMissingProviderCandidateMarksStepFailedWithoutPublishingMessages() async throws {
    let store = InMemoryWorkflowRuntimeStore(clock: FixedWorkflowRuntimeClock(Date(timeIntervalSince1970: 300)))
    let session = try await store.createSession(WorkflowSessionCreateInput(workflowId: "wf", entryStepId: "start"))
    let publisher = InMemoryWorkflowOutputPublisher(store: store)

    do {
      _ = try await publisher.publishAcceptedOutput(
        WorkflowPublicationRequest(
          sessionId: session.sessionId,
          stepId: "start",
          nodeId: "node-start",
          attempt: 1,
          transitions: [WorkflowStepTransition(toStepId: "next")]
        )
      )
      XCTFail("expected missing candidate failure")
    } catch WorkflowPublicationError.noCandidateOutput {}

    let listedMessages = try await store.listMessages(for: session.sessionId, toStepId: nil)
    let loadedSession = try await store.loadSession(id: session.sessionId)
    let updatedSession = try XCTUnwrap(loadedSession)
    XCTAssertEqual(listedMessages, [])
    XCTAssertEqual(updatedSession.executions.first?.status, .failed)
  }

  func testAdapterFailureMarksStepFailedWithoutPublishingMessages() async throws {
    let store = InMemoryWorkflowRuntimeStore(clock: FixedWorkflowRuntimeClock(Date(timeIntervalSince1970: 300)))
    let session = try await store.createSession(WorkflowSessionCreateInput(workflowId: "wf", entryStepId: "start"))
    let publisher = InMemoryWorkflowOutputPublisher(store: store)

    do {
      _ = try await publisher.publishAcceptedOutput(
        WorkflowPublicationRequest(
          sessionId: session.sessionId,
          stepId: "start",
          nodeId: "node-start",
          attempt: 1,
          backend: .codexAgent,
          adapterFailure: AdapterExecutionError(.policyBlocked, "codex login required"),
          transitions: [WorkflowStepTransition(toStepId: "next")]
        )
      )
      XCTFail("expected adapter failure")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .policyBlocked)
    }

    let listedMessages = try await store.listMessages(for: session.sessionId, toStepId: nil)
    let loadedSession = try await store.loadSession(id: session.sessionId)
    let updatedSession = try XCTUnwrap(loadedSession)
    XCTAssertEqual(listedMessages, [])
    XCTAssertEqual(updatedSession.executions.first?.status, .failed)
    XCTAssertEqual(updatedSession.executions.first?.failureReason, "policy_blocked: codex login required")
  }

  func testPublicationRejectsAmbiguousCandidateSourcesAndFinalizesStaging() async throws {
    let root = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let store = InMemoryWorkflowRuntimeStore(clock: FixedWorkflowRuntimeClock(Date(timeIntervalSince1970: 300)))
    let session = try await store.createSession(WorkflowSessionCreateInput(workflowId: "wf", entryStepId: "start"))
    let staging = FileSystemRuntimeCandidatePathStaging(rootDirectory: root, clock: FixedWorkflowRuntimeClock(Date(timeIntervalSince1970: 300)))
    let reservation = try await staging.prepareCandidatePath(sessionId: session.sessionId, stepExecutionId: "exec", attempt: 1)
    try writeCandidate(["answer": .string("from-file")], to: reservation.candidatePath)
    let publisher = InMemoryWorkflowOutputPublisher(store: store)

    do {
      _ = try await publisher.publishAcceptedOutput(
        WorkflowPublicationRequest(
          sessionId: session.sessionId,
          stepId: "start",
          nodeId: "node-start",
          attempt: 1,
          adapterOutput: AdapterExecutionOutput(
            provider: "codex-agent",
            model: "gpt-5",
            promptText: "prompt",
            completionPassed: true,
            payload: ["answer": .string("from-adapter")]
          ),
          candidatePath: reservation.candidatePath,
          candidatePathReservation: reservation,
          transitions: [WorkflowStepTransition(toStepId: "next")]
        )
      )
      XCTFail("expected ambiguous candidate source rejection")
    } catch WorkflowPublicationError.ambiguousCandidateSources(let sources) {
      XCTAssertEqual(sources, ["adapterOutput", "candidatePath"])
    }

    let listedMessages = try await store.listMessages(for: session.sessionId, toStepId: nil)
    let loadedSession = try await store.loadSession(id: session.sessionId)
    XCTAssertEqual(listedMessages, [])
    XCTAssertEqual(loadedSession?.executions.first?.status, .failed)
    XCTAssertFalse(FileManager.default.fileExists(atPath: reservation.stagingDirectory.path))
  }

  func testPublicationRejectsInlineCandidatePathAmbiguityAndReservationWithoutCandidatePath() async throws {
    let root = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let firstStore = InMemoryWorkflowRuntimeStore(clock: FixedWorkflowRuntimeClock(Date(timeIntervalSince1970: 300)))
    let firstSession = try await firstStore.createSession(WorkflowSessionCreateInput(workflowId: "wf", entryStepId: "start"))
    let staging = FileSystemRuntimeCandidatePathStaging(rootDirectory: root, clock: FixedWorkflowRuntimeClock(Date(timeIntervalSince1970: 300)))
    let firstReservation = try await staging.prepareCandidatePath(sessionId: firstSession.sessionId, stepExecutionId: "exec-1", attempt: 1)
    try writeCandidate(["answer": .string("from-file")], to: firstReservation.candidatePath)

    do {
      _ = try await InMemoryWorkflowOutputPublisher(store: firstStore).publishAcceptedOutput(
        WorkflowPublicationRequest(
          sessionId: firstSession.sessionId,
          stepId: "start",
          nodeId: "node-start",
          attempt: 1,
          inlineCandidate: ["answer": .string("inline")],
          candidatePath: firstReservation.candidatePath,
          candidatePathReservation: firstReservation,
          transitions: [WorkflowStepTransition(toStepId: "next")]
        )
      )
      XCTFail("expected ambiguous inline and candidate path rejection")
    } catch WorkflowPublicationError.ambiguousCandidateSources(let sources) {
      XCTAssertEqual(sources, ["inlineCandidate", "candidatePath"])
    }
    XCTAssertFalse(FileManager.default.fileExists(atPath: firstReservation.stagingDirectory.path))

    let secondStore = InMemoryWorkflowRuntimeStore(clock: FixedWorkflowRuntimeClock(Date(timeIntervalSince1970: 300)))
    let secondSession = try await secondStore.createSession(WorkflowSessionCreateInput(workflowId: "wf", entryStepId: "start"))
    let secondReservation = try await staging.prepareCandidatePath(sessionId: secondSession.sessionId, stepExecutionId: "exec-2", attempt: 1)
    try writeCandidate(["answer": .string("from-file")], to: secondReservation.candidatePath)

    do {
      _ = try await InMemoryWorkflowOutputPublisher(store: secondStore).publishAcceptedOutput(
        WorkflowPublicationRequest(
          sessionId: secondSession.sessionId,
          stepId: "start",
          nodeId: "node-start",
          attempt: 1,
          adapterOutput: AdapterExecutionOutput(
            provider: "codex-agent",
            model: "gpt-5",
            promptText: "prompt",
            completionPassed: true,
            payload: ["answer": .string("adapter")]
          ),
          candidatePathReservation: secondReservation,
          transitions: [WorkflowStepTransition(toStepId: "next")]
        )
      )
      XCTFail("expected reservation without candidate path rejection")
    } catch WorkflowPublicationError.candidatePathReservationRequiresCandidatePath {}
    XCTAssertFalse(FileManager.default.fileExists(atPath: secondReservation.stagingDirectory.path))
  }

  func testPublicationFinalizesCandidatePathStagingAfterSuccess() async throws {
    let root = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let store = InMemoryWorkflowRuntimeStore(clock: FixedWorkflowRuntimeClock(Date(timeIntervalSince1970: 300)))
    let session = try await store.createSession(WorkflowSessionCreateInput(workflowId: "wf", entryStepId: "start"))
    let staging = FileSystemRuntimeCandidatePathStaging(rootDirectory: root, clock: FixedWorkflowRuntimeClock(Date(timeIntervalSince1970: 300)))
    let reservation = try await staging.prepareCandidatePath(sessionId: session.sessionId, stepExecutionId: "exec", attempt: 1)
    try writeCandidate(["answer": .string("ok")], to: reservation.candidatePath)
    let publisher = InMemoryWorkflowOutputPublisher(store: store)

    let result = try await publisher.publishAcceptedOutput(
      WorkflowPublicationRequest(
        sessionId: session.sessionId,
        stepId: "start",
        nodeId: "node-start",
        attempt: 1,
        candidatePath: reservation.candidatePath,
        candidatePathReservation: reservation,
        transitions: [WorkflowStepTransition(toStepId: "next")]
      )
    )

    XCTAssertEqual(result.stepExecution.status, .completed)
    XCTAssertEqual(result.publishedMessages.map(\.communicationId), ["comm-000001"])
    XCTAssertFalse(FileManager.default.fileExists(atPath: reservation.stagingDirectory.path))
  }

  func testPublicationFinalizesCandidatePathStagingAfterValidationFailure() async throws {
    let root = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let store = InMemoryWorkflowRuntimeStore(clock: FixedWorkflowRuntimeClock(Date(timeIntervalSince1970: 300)))
    let session = try await store.createSession(WorkflowSessionCreateInput(workflowId: "wf", entryStepId: "start"))
    let staging = FileSystemRuntimeCandidatePathStaging(rootDirectory: root, clock: FixedWorkflowRuntimeClock(Date(timeIntervalSince1970: 300)))
    let reservation = try await staging.prepareCandidatePath(sessionId: session.sessionId, stepExecutionId: "exec", attempt: 1)
    try Data(#"{"completionPassed":false,"when":{},"payload":{"answer":"bad"}}"#.utf8).write(to: reservation.candidatePath)
    let publisher = InMemoryWorkflowOutputPublisher(store: store)

    do {
      _ = try await publisher.publishAcceptedOutput(
        WorkflowPublicationRequest(
          sessionId: session.sessionId,
          stepId: "start",
          nodeId: "node-start",
          attempt: 1,
          candidatePath: reservation.candidatePath,
          candidatePathReservation: reservation,
          outputContract: WorkflowOutputContract(requiredObject: true),
          transitions: [WorkflowStepTransition(toStepId: "next")]
        )
      )
      XCTFail("expected validation failure")
    } catch WorkflowPublicationError.validationRejected(let reason) {
      XCTAssertEqual(reason, "completionPassed is false")
    }

    let listedMessages = try await store.listMessages(for: session.sessionId, toStepId: nil)
    XCTAssertEqual(listedMessages, [])
    XCTAssertFalse(FileManager.default.fileExists(atPath: reservation.stagingDirectory.path))
  }

  func testPublicationFinalizesCandidatePathStagingAfterAppendFailure() async throws {
    let root = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let store = InMemoryWorkflowRuntimeStore(
      clock: FixedWorkflowRuntimeClock(Date(timeIntervalSince1970: 300)),
      appendFailurePredicate: { _ in "append blocked" }
    )
    let session = try await store.createSession(WorkflowSessionCreateInput(workflowId: "wf", entryStepId: "start"))
    let staging = FileSystemRuntimeCandidatePathStaging(rootDirectory: root, clock: FixedWorkflowRuntimeClock(Date(timeIntervalSince1970: 300)))
    let reservation = try await staging.prepareCandidatePath(sessionId: session.sessionId, stepExecutionId: "exec", attempt: 1)
    try writeCandidate(["answer": .string("ok")], to: reservation.candidatePath)
    let publisher = InMemoryWorkflowOutputPublisher(store: store)

    do {
      _ = try await publisher.publishAcceptedOutput(
        WorkflowPublicationRequest(
          sessionId: session.sessionId,
          stepId: "start",
          nodeId: "node-start",
          attempt: 1,
          candidatePath: reservation.candidatePath,
          candidatePathReservation: reservation,
          transitions: [WorkflowStepTransition(toStepId: "next")]
        )
      )
      XCTFail("expected append failure")
    } catch WorkflowRuntimeStoreError.messageAppendRejected(let reason) {
      XCTAssertEqual(reason, "append blocked")
    }

    let listedMessages = try await store.listMessages(for: session.sessionId, toStepId: nil)
    XCTAssertEqual(listedMessages, [])
    XCTAssertFalse(FileManager.default.fileExists(atPath: reservation.stagingDirectory.path))
  }

  func testUnsupportedTransitionShapesFailBeforeAcceptedOutputAndMessages() async throws {
    let unsupportedTransitions: [(WorkflowStepTransition, String)] = [
      (
        WorkflowStepTransition(toStepId: "child-start", toWorkflowId: "child-workflow", resumeStepId: "resume"),
        "cross-workflow transitions are not supported by the Swift TASK-005 in-memory publisher"
      ),
      (
        WorkflowStepTransition(toStepId: "next", resumeStepId: "resume"),
        "resume-step transitions are not supported by the Swift TASK-005 in-memory publisher"
      ),
      (
        WorkflowStepTransition(
          toStepId: "fanout-start",
          fanout: WorkflowStepFanout(groupId: "group", itemsFrom: "items", joinStepId: "join")
        ),
        "fanout transitions are not supported by the Swift TASK-005 in-memory publisher"
      )
    ]

    for (transition, reason) in unsupportedTransitions {
      let store = InMemoryWorkflowRuntimeStore(clock: FixedWorkflowRuntimeClock(Date(timeIntervalSince1970: 300)))
      let session = try await store.createSession(WorkflowSessionCreateInput(workflowId: "wf", entryStepId: "start"))
      let publisher = InMemoryWorkflowOutputPublisher(store: store)

      do {
        _ = try await publisher.publishAcceptedOutput(
          WorkflowPublicationRequest(
            sessionId: session.sessionId,
            stepId: "start",
            nodeId: "node-start",
            attempt: 1,
            inlineCandidate: ["answer": .string("ok")],
            transitions: [transition]
          )
        )
        XCTFail("expected unsupported transition failure")
      } catch WorkflowPublicationError.unsupportedTransition(let actualReason) {
        XCTAssertEqual(actualReason, reason)
      }

      let listedMessages = try await store.listMessages(for: session.sessionId, toStepId: nil)
      let loadedSession = try await store.loadSession(id: session.sessionId)
      let execution = try XCTUnwrap(loadedSession?.executions.first)
      XCTAssertEqual(listedMessages, [])
      XCTAssertEqual(execution.status, .failed)
      XCTAssertNil(execution.acceptedOutput)
      XCTAssertEqual(execution.failureReason, reason)
    }
  }

  private func writeCandidate(_ payload: JSONObject, to url: URL) throws {
    let encoded = try JSONEncoder().encode(JSONValue.object(payload))
    let payloadText = String(decoding: encoded, as: UTF8.self)
    try Data(#"{"completionPassed":true,"when":{},"payload":\#(payloadText)}"#.utf8).write(to: url)
  }

  private func temporaryDirectory() -> URL {
    FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
  }
}
