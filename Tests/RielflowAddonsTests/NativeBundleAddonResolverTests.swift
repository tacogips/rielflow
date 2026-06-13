import Foundation
import CryptoKit
import XCTest
@testable import RielflowAddons
@testable import RielflowCore

final class NativeBundleAddonResolverTests: XCTestCase {
  func testDeterministicRunnerCanExecuteNativeBundleResolver() async throws {
    let recorder = EnvelopeRecorder()
    let resolver = NativeBundleAddonResolver(
      registrations: [registration(), registration(packageName: "other-native-addon-package")],
      loader: FakeNativeBundleLoader(handle: FakeNativeBundleHandle(
        descriptorValue: validDescriptor(),
        output: .init(candidatePayload: ["status": .string("native-ok")]),
        recorder: recorder
      ))
    )
    let store = InMemoryWorkflowRuntimeStore()
    let runner = DeterministicWorkflowRunner(store: store, addonResolver: resolver)

    let result = try await runner.run(DeterministicWorkflowRunRequest(
      workflow: addonWorkflow(addonName: "native-addon-package/native-runner"),
      variables: ["secret": .string("must-not-cross-abi")]
    ))

    XCTAssertEqual(result.status, .completed)
    XCTAssertEqual(result.rootOutput, ["status": .string("native-ok")])
    XCTAssertEqual(result.nodeExecutions, 1)
    let recordedEnvelopes = await recorder.values()
    let envelope = try XCTUnwrap(recordedEnvelopes.first)
    XCTAssertEqual(envelope.addonName, "native-runner")
    XCTAssertEqual(envelope.source.packageName, "native-addon-package")
    XCTAssertEqual(envelope.nodePayload["workflowId"], .string("native-addon-runner"))
    XCTAssertEqual(envelope.nodePayload["stepId"], .string("native-step"))
    XCTAssertEqual(envelope.nodePayload["nodeId"], .string("native-node"))
    XCTAssertEqual(envelope.nodePayload["config"], .object(["mode": .string("test")]))
    XCTAssertFalse(envelope.options.allowDispatchIntents)

    let encoded = try JSONEncoder().encode(envelope)
    let encodedString = String(decoding: encoded, as: UTF8.self)
    XCTAssertFalse(encodedString.contains("variables"))
    XCTAssertFalse(encodedString.contains("must-not-cross-abi"))
  }

  func testDeterministicRunnerInfersPackageForBareAddonName() async throws {
    let recorder = EnvelopeRecorder()
    let resolver = NativeBundleAddonResolver(
      registrations: [registration()],
      loader: FakeNativeBundleLoader(handle: FakeNativeBundleHandle(
        descriptorValue: validDescriptor(),
        output: .init(candidatePayload: ["status": .string("bare-ok")]),
        recorder: recorder
      ))
    )
    let runner = DeterministicWorkflowRunner(addonResolver: resolver)

    let result = try await runner.run(DeterministicWorkflowRunRequest(
      workflow: addonWorkflow(addonName: "native-runner")
    ))

    XCTAssertEqual(result.rootOutput, ["status": .string("bare-ok")])
    let recordedEnvelopes = await recorder.values()
    let envelope = try XCTUnwrap(recordedEnvelopes.first)
    XCTAssertEqual(envelope.addonName, "native-runner")
    XCTAssertEqual(envelope.source.packageName, "native-addon-package")
  }

  func testDeterministicRunnerRecordsPolicyBlockedNativeDispatchIntent() async throws {
    let resolver = NativeBundleAddonResolver(
      registrations: [registration()],
      loader: FakeNativeBundleLoader(handle: FakeNativeBundleHandle(
        descriptorValue: validDescriptor(),
        output: .init(dispatchIntents: [.init(kind: "workflow.resume", payload: ["step": .string("next")])])
      ))
    )
    let store = InMemoryWorkflowRuntimeStore()
    let runner = DeterministicWorkflowRunner(store: store, addonResolver: resolver)

    await XCTAssertThrowsErrorAsync(try await runner.run(DeterministicWorkflowRunRequest(
      workflow: addonWorkflow(addonName: "native-addon-package/native-runner")
    )))

    let maybeSession = await store.loadSessionForTest(id: "native-addon-runner-session-1")
    let session = try XCTUnwrap(maybeSession)
    XCTAssertEqual(session.status, .failed)
    XCTAssertEqual(session.executions.first?.status, .failed)
    XCTAssertTrue(session.executions.first?.failureReason?.contains("policy_blocked") == true)
    XCTAssertTrue(session.executions.first?.failureReason?.contains("NATIVE_DISPATCH_INTENT_DENIED") == true)
  }

  func testDeterministicRunnerFailsClosedForAmbiguousBareAddonName() async throws {
    let loadRecorder = LoadRecorder()
    let resolver = NativeBundleAddonResolver(
      registrations: [registration(), registration(packageName: "other-native-addon-package")],
      loader: FakeNativeBundleLoader(
        handle: FakeNativeBundleHandle(
          descriptorValue: validDescriptor(),
          output: .init(candidatePayload: ["status": .string("should-not-run")])
        ),
        recorder: loadRecorder
      )
    )
    let store = InMemoryWorkflowRuntimeStore()
    let runner = DeterministicWorkflowRunner(store: store, addonResolver: resolver)

    await XCTAssertThrowsErrorAsync(try await runner.run(DeterministicWorkflowRunRequest(
      workflow: addonWorkflow(addonName: "native-runner")
    )))

    let loadedRegistrations = await loadRecorder.values()
    XCTAssertEqual(loadedRegistrations, [])
    let maybeSession = await store.loadSessionForTest(id: "native-addon-runner-session-1")
    let session = try XCTUnwrap(maybeSession)
    XCTAssertEqual(session.status, .failed)
    XCTAssertTrue(session.executions.first?.failureReason?.contains("DUPLICATE_NATIVE_BUNDLE_ADDON") == true)
  }

  func testResolverInvokesNativeBundleWithMinimumEnvelopeAndNoVariables() async throws {
    let recorder = EnvelopeRecorder()
    let resolver = NativeBundleAddonResolver(
      registrations: [registration()],
      loader: FakeNativeBundleLoader(handle: FakeNativeBundleHandle(
        descriptorValue: validDescriptor(),
        output: .init(candidatePayload: ["message": .string("ok")]),
        recorder: recorder
      ))
    )
    let request = AddonResolveRequest(input: .init(
      addonName: "native-runner",
      version: "1.0.0",
      nodePayload: ["prompt": .string("hello")],
      variables: ["secret": .string("must-not-cross-abi")],
      source: .init(packageName: "native-addon-package", addonName: "native-runner", sourcePath: "addons/native-runner"),
      options: .init(allowDispatchIntents: true)
    ))

    let result = await resolver.resolve(request)

    guard case .resolved = result else {
      return XCTFail("expected native bundle resolution")
    }
    let envelopes = await recorder.values()
    let envelope = try XCTUnwrap(envelopes.first)
    XCTAssertEqual(envelope.nodePayload["prompt"], .string("hello"))
    XCTAssertFalse(envelope.options.allowDispatchIntents)

    let encoded = try JSONEncoder().encode(envelope)
    let encodedString = String(decoding: encoded, as: UTF8.self)
    XCTAssertFalse(encodedString.contains("variables"))
    XCTAssertFalse(encodedString.contains("must-not-cross-abi"))
  }

  func testResolverDefaultDeniesDispatchIntents() async {
    let resolver = NativeBundleAddonResolver(
      registrations: [registration()],
      loader: FakeNativeBundleLoader(handle: FakeNativeBundleHandle(
        descriptorValue: validDescriptor(),
        output: .init(dispatchIntents: [.init(kind: "workflow.resume", payload: ["step": .string("next")])])
      ))
    )

    let result = await resolver.resolve(request(options: .init(allowDispatchIntents: true)))

    guard case let .failed(diagnostics) = result else {
      return XCTFail("expected dispatch intent denial")
    }
    XCTAssertTrue(diagnostics.contains { $0.code == "NATIVE_DISPATCH_INTENT_DENIED" })
  }

  func testResolverRejectsDescriptorMismatchBeforeExecution() async throws {
    let recorder = EnvelopeRecorder()
    let resolver = NativeBundleAddonResolver(
      registrations: [registration()],
      loader: FakeNativeBundleLoader(handle: FakeNativeBundleHandle(
        descriptorValue: .init(
          abiVersion: 2,
          bundleIdentifier: "com.example.rielflow.NativeRunner",
          exports: [.init(addonName: "native-runner", version: "1.0.0")]
        ),
        output: .init(candidatePayload: ["message": .string("should-not-run")]),
        recorder: recorder
      ))
    )

    let result = await resolver.resolve(request())

    guard case let .failed(diagnostics) = result else {
      return XCTFail("expected descriptor validation failure")
    }
    XCTAssertTrue(diagnostics.contains { $0.code == "INVALID_NATIVE_BUNDLE_DESCRIPTOR" })
    let recordedEnvelopes = await recorder.values()
    XCTAssertEqual(recordedEnvelopes, [])
  }

  func testResolverRejectsBuiltinNamesBeforeLoading() async {
    let loadRecorder = LoadRecorder()
    let resolver = NativeBundleAddonResolver(
      registrations: [registration(packageName: "rielflow")],
      loader: FakeNativeBundleLoader(
        handle: FakeNativeBundleHandle(
          descriptorValue: validDescriptor(),
          output: .init(candidatePayload: ["message": .string("should-not-run")])
        ),
        recorder: loadRecorder
      )
    )

    let result = await resolver.resolve(AddonResolveRequest(input: .init(
      addonName: "native-runner",
      version: "1.0.0",
      nodePayload: ["prompt": .string("hello")],
      source: .init(packageName: "rielflow", addonName: "native-runner")
    )))

    guard case let .failed(diagnostics) = result else {
      return XCTFail("expected built-in native bundle denial")
    }
    XCTAssertTrue(diagnostics.contains { $0.code == "BUILTIN_NATIVE_BUNDLE_ADDON_DENIED" })
    let loadedRegistrations = await loadRecorder.values()
    XCTAssertEqual(loadedRegistrations, [])
  }

  func testResolverRejectsDuplicateUnlockedRegistrationsBeforeLoading() async {
    let loadRecorder = LoadRecorder()
    let resolver = NativeBundleAddonResolver(
      registrations: [registration(), registration(packageName: "other-native-addon-package")],
      loader: FakeNativeBundleLoader(
        handle: FakeNativeBundleHandle(
          descriptorValue: validDescriptor(),
          output: .init(candidatePayload: ["message": .string("should-not-run")])
        ),
        recorder: loadRecorder
      )
    )

    let result = await resolver.resolve(request(packageName: nil))

    guard case let .failed(diagnostics) = result else {
      return XCTFail("expected duplicate native bundle denial")
    }
    XCTAssertTrue(diagnostics.contains { $0.code == "DUPLICATE_NATIVE_BUNDLE_ADDON" })
    let loadedRegistrations = await loadRecorder.values()
    XCTAssertEqual(loadedRegistrations, [])
  }

  func testResolverProjectsGrantedAttachmentReadAsBoundedValuesOnly() async throws {
    let recorder = EnvelopeRecorder()
    let resolver = NativeBundleAddonResolver(
      registrations: [registration(attachmentReadInputFields: ["attachmentId"])],
      loader: FakeNativeBundleLoader(handle: FakeNativeBundleHandle(
        descriptorValue: validDescriptor(),
        output: .init(candidatePayload: ["message": .string("attachment-ok")]),
        recorder: recorder
      ))
    )
    let attachment = attachment(id: "att_123", text: "hello native bundle")

    let result = await resolver.resolve(request(
      nodePayload: [
        "inputs": .object(["attachmentId": .string("att_123")]),
        "localPath": .string("/tmp/should-not-be-forwarded-as-attachment"),
      ],
      attachments: ["attachmentId": attachment]
    ))

    guard case .resolved = result else {
      return XCTFail("expected attachment resolution")
    }
    let envelopes = await recorder.values()
    let envelope = try XCTUnwrap(envelopes.first)
    guard case let .object(attachmentsObject)? = envelope.nodePayload["attachments"],
      case let .object(projected)? = attachmentsObject["attachmentId"]
    else {
      return XCTFail("expected projected attachment")
    }
    XCTAssertEqual(projected["id"], .string("att_123"))
    XCTAssertEqual(projected["mediaType"], .string("text/plain"))
    XCTAssertEqual(projected["filename"], .string("note.txt"))
    XCTAssertEqual(projected["sizeBytes"], .number(Double("hello native bundle".utf8.count)))
    XCTAssertEqual(projected["sha256"], .string(attachment.sha256))
    XCTAssertEqual(projected["contentText"], .string("hello native bundle"))
    XCTAssertNil(projected["localPath"])
    XCTAssertNil(projected["path"])
    XCTAssertNil(projected["pathBase"])
    XCTAssertNil(projected["contentRef"])
  }

  func testResolverRejectsUngivenAttachmentGrantBeforeLoading() async {
    let loadRecorder = LoadRecorder()
    let resolver = NativeBundleAddonResolver(
      registrations: [registration()],
      loader: FakeNativeBundleLoader(
        handle: FakeNativeBundleHandle(descriptorValue: validDescriptor(), output: .init()),
        recorder: loadRecorder
      )
    )

    let result = await resolver.resolve(request(attachments: ["attachmentId": attachment(id: "att_123", text: "hello")]))

    guard case let .failed(diagnostics) = result else {
      return XCTFail("expected ungranted attachment failure")
    }
    XCTAssertTrue(diagnostics.contains { $0.code == "native_attachment_ungranted" && $0.path == "attachments.attachmentId" })
    let loadedRegistrations = await loadRecorder.values()
    XCTAssertEqual(loadedRegistrations, [])
  }

  func testResolverRejectsMalformedAttachmentHashBeforeLoading() async {
    let loadRecorder = LoadRecorder()
    let resolver = NativeBundleAddonResolver(
      registrations: [registration(attachmentReadInputFields: ["attachmentId"])],
      loader: FakeNativeBundleLoader(
        handle: FakeNativeBundleHandle(descriptorValue: validDescriptor(), output: .init()),
        recorder: loadRecorder
      )
    )
    var malformed = attachment(id: "att_123", text: "hello")
    malformed.sha256 = "sha256:not-a-digest"

    let result = await resolver.resolve(request(attachments: ["attachmentId": malformed]))

    guard case let .failed(diagnostics) = result else {
      return XCTFail("expected malformed hash failure")
    }
    XCTAssertTrue(diagnostics.contains { $0.code == "native_attachment_hash_malformed" && $0.path == "attachments.attachmentId" })
    let loadedRegistrations = await loadRecorder.values()
    XCTAssertEqual(loadedRegistrations, [])
  }

  func testResolverRejectsCallerAuthoredAttachmentsPayloadBeforeLoading() async {
    let loadRecorder = LoadRecorder()
    let resolver = NativeBundleAddonResolver(
      registrations: [registration()],
      loader: FakeNativeBundleLoader(
        handle: FakeNativeBundleHandle(descriptorValue: validDescriptor(), output: .init()),
        recorder: loadRecorder
      )
    )

    let result = await resolver.resolve(request(nodePayload: [
      "attachments": .object([
        "attachmentId": .object(["localPath": .string("/tmp/secret.txt")])
      ])
    ], attachments: [:]))

    guard case let .failed(diagnostics) = result else {
      return XCTFail("expected reserved attachments field failure")
    }
    XCTAssertTrue(diagnostics.contains { $0.code == "native_attachment_reserved_field" && $0.path == "nodePayload.attachments" })
    let loadedRegistrations = await loadRecorder.values()
    XCTAssertEqual(loadedRegistrations, [])
  }

  func testDeterministicRunnerPassesAddonAttachmentsThroughNativeResolver() async throws {
    let recorder = EnvelopeRecorder()
    let resolver = NativeBundleAddonResolver(
      registrations: [registration(attachmentReadInputFields: ["attachmentId"])],
      loader: FakeNativeBundleLoader(handle: FakeNativeBundleHandle(
        descriptorValue: validDescriptor(),
        output: .init(candidatePayload: ["status": .string("runner-attachment-ok")]),
        recorder: recorder
      ))
    )
    let runner = DeterministicWorkflowRunner(addonResolver: resolver)

    let result = try await runner.run(DeterministicWorkflowRunRequest(
      workflow: addonWorkflow(addonName: "native-addon-package/native-runner"),
      addonAttachments: ["attachmentId": attachment(id: "att_123", text: "runner attachment")]
    ))

    XCTAssertEqual(result.rootOutput, ["status": .string("runner-attachment-ok")])
    let envelopes = await recorder.values()
    let envelope = try XCTUnwrap(envelopes.first)
    guard case let .object(attachmentsObject)? = envelope.nodePayload["attachments"],
      case let .object(projected)? = attachmentsObject["attachmentId"]
    else {
      return XCTFail("expected runner-projected attachment")
    }
    XCTAssertEqual(projected["id"], .string("att_123"))
    XCTAssertEqual(projected["contentText"], .string("runner attachment"))
  }

  private func request(packageName: String? = "native-addon-package", options: AddonExecutionOptions = .init()) -> AddonResolveRequest {
    AddonResolveRequest(input: .init(
      addonName: "native-runner",
      version: "1.0.0",
      nodePayload: ["prompt": .string("hello")],
      variables: ["secret": .string("must-not-cross-abi")],
      source: .init(packageName: packageName, addonName: "native-runner", sourcePath: "addons/native-runner"),
      options: options
    ))
  }

  private func request(
    packageName: String? = "native-addon-package",
    nodePayload: JSONObject = ["prompt": .string("hello")],
    attachments: [String: WorkflowAddonAttachmentValue],
    options: AddonExecutionOptions = .init()
  ) -> AddonResolveRequest {
    AddonResolveRequest(input: .init(
      addonName: "native-runner",
      version: "1.0.0",
      nodePayload: nodePayload,
      variables: ["secret": .string("must-not-cross-abi")],
      attachments: attachments,
      source: .init(packageName: packageName, addonName: "native-runner", sourcePath: "addons/native-runner"),
      options: options
    ))
  }

  private func registration(
    packageName: String = "native-addon-package",
    allowDispatchIntents: Bool = false,
    attachmentReadInputFields: [String] = []
  ) -> NativeBundleAddonRegistration {
    NativeBundleAddonRegistration(
      packageName: packageName,
      addonName: "native-runner",
      version: "1.0.0",
      bundleURL: URL(fileURLWithPath: "/tmp/NativeRunner.bundle"),
      bundleIdentifier: "com.example.rielflow.NativeRunner",
      contentDigest: "sha256:\(String(repeating: "a", count: 64))",
      allowDispatchIntents: allowDispatchIntents,
      attachmentReadInputFields: attachmentReadInputFields
    )
  }

  private func validDescriptor() -> NativeBundleAddonDescriptor {
    NativeBundleAddonDescriptor(
      abiVersion: 1,
      bundleIdentifier: "com.example.rielflow.NativeRunner",
      exports: [.init(addonName: "native-runner", version: "1.0.0")]
    )
  }

  private func addonWorkflow(addonName: String) -> WorkflowDefinition {
    let addon = WorkflowNodeAddonRef(
      name: addonName,
      version: "1.0.0",
      config: ["mode": .string("test")]
    )
    return WorkflowDefinition(
      workflowId: "native-addon-runner",
      defaults: WorkflowDefaults(nodeTimeoutMs: 120_000, maxLoopIterations: 3),
      entryStepId: "native-step",
      nodeRegistry: [WorkflowNodeRegistryRef(id: "native-node", addon: addon)],
      steps: [WorkflowStepRef(id: "native-step", nodeId: "native-node")],
      nodes: [WorkflowNodeRef(id: "native-node", addon: addon)]
    )
  }

  private func attachment(id: String, text: String) -> WorkflowAddonAttachmentValue {
    let data = Data(text.utf8)
    return WorkflowAddonAttachmentValue(
      id: id,
      mediaType: "text/plain",
      filename: "note.txt",
      sizeBytes: data.count,
      sha256: sha256Digest(for: data),
      contentText: text
    )
  }

  private func sha256Digest(for data: Data) -> String {
    let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    return "sha256:\(hash)"
  }
}

private actor LoadRecorder {
  private var registrations: [NativeBundleAddonRegistration] = []

  func record(_ registration: NativeBundleAddonRegistration) {
    registrations.append(registration)
  }

  func values() -> [NativeBundleAddonRegistration] {
    registrations
  }
}

private actor EnvelopeRecorder {
  private var envelopes: [NativeBundleInvocationEnvelope] = []

  func record(_ envelope: NativeBundleInvocationEnvelope) {
    envelopes.append(envelope)
  }

  func values() -> [NativeBundleInvocationEnvelope] {
    envelopes
  }
}

private struct FakeNativeBundleLoader: NativeBundlePluginLoading {
  var handle: FakeNativeBundleHandle
  var recorder: LoadRecorder? = nil

  func loadPlugin(for registration: NativeBundleAddonRegistration) async throws -> any NativeBundlePluginHandle {
    await recorder?.record(registration)
    return handle
  }
}

private struct FakeNativeBundleHandle: NativeBundlePluginHandle {
  var descriptorValue: NativeBundleAddonDescriptor
  var output: AddonExecutionOutput
  var recorder: EnvelopeRecorder?

  func loadDescriptor() async throws -> NativeBundleAddonDescriptor {
    descriptorValue
  }

  init(descriptorValue: NativeBundleAddonDescriptor, output: AddonExecutionOutput, recorder: EnvelopeRecorder? = nil) {
    self.descriptorValue = descriptorValue
    self.output = output
    self.recorder = recorder
  }

  func execute(_ envelope: NativeBundleInvocationEnvelope) async throws -> AddonExecutionOutput {
    await recorder?.record(envelope)
    return output
  }
}

private func XCTAssertThrowsErrorAsync(
  _ expression: @autoclosure () async throws -> some Sendable,
  file: StaticString = #filePath,
  line: UInt = #line
) async {
  do {
    _ = try await expression()
    XCTFail("expected error", file: file, line: line)
  } catch {}
}

private extension InMemoryWorkflowRuntimeStore {
  func loadSessionForTest(id: String) async -> WorkflowSession? {
    try? await loadSession(id: id)
  }
}
