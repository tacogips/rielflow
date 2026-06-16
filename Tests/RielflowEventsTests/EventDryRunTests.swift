import Foundation
import XCTest
@testable import RielflowCore
@testable import RielflowEvents

final class EventDryRunTests: XCTestCase {
  func testEventSourceAndBindingDecodeOptionalEnabledDefaults() throws {
    let source = try JSONDecoder().decode(EventSourceContract.self, from: Data(#"{"id":"web-a","kind":"webhook"}"#.utf8))
    let binding = try JSONDecoder().decode(EventBindingContract.self, from: Data(#"{"id":"bind-a","sourceId":"web-a","workflowName":"workflow-a","inputMapping":{"mode":"event-input"}}"#.utf8))

    XCTAssertTrue(source.enabled)
    XCTAssertTrue(binding.enabled)
    XCTAssertEqual(binding.workflowName, "workflow-a")
    XCTAssertEqual(binding.inputMapping.mode, .eventInput)
  }

  func testEventSourceDecodesAndEncodesTypeScriptWebhookAndS3Shapes() throws {
    let webhook = try JSONDecoder().decode(EventSourceContract.self, from: Data(#"""
    {
      "id": "web-a",
      "kind": "webhook",
      "provider": "web",
      "path": "/events/web",
      "signingSecretEnv": "WEBHOOK_SECRET"
    }
    """#.utf8))
    let s3 = try JSONDecoder().decode(EventSourceContract.self, from: Data(#"""
    {
      "id": "s3-a",
      "kind": "s3-repository",
      "provider": "aws-s3",
      "bucket": "release-artifacts",
      "rootPrefix": "incoming/releases",
      "eventReceiver": {
        "mode": "webhook-bridge",
        "path": "/events/s3",
        "signingSecretEnv": "S3_WEBHOOK_SECRET"
      },
      "objectAccess": {"mode": "metadata-only"}
    }
    """#.utf8))

    XCTAssertEqual(webhook.routePath, "/events/web")
    XCTAssertEqual(webhook.secretEnv, "WEBHOOK_SECRET")
    XCTAssertEqual(s3.eventReceiverMode, "webhook-bridge")
    XCTAssertEqual(s3.eventReceiverPath, "/events/s3")
    XCTAssertEqual(s3.secretEnv, "S3_WEBHOOK_SECRET")
    XCTAssertEqual(s3.objectAccessMode, "metadata-only")

    guard case let .object(encodedWebhook) = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(webhook)),
      case let .object(encodedS3) = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(s3)),
      case let .object(encodedEventReceiver)? = encodedS3["eventReceiver"],
      case let .object(encodedObjectAccess)? = encodedS3["objectAccess"]
    else {
      return XCTFail("expected encoded TypeScript event source shapes")
    }
    XCTAssertEqual(encodedWebhook["path"], .string("/events/web"))
    XCTAssertEqual(encodedWebhook["signingSecretEnv"], .string("WEBHOOK_SECRET"))
    XCTAssertNil(encodedWebhook["routePath"])
    XCTAssertEqual(encodedEventReceiver["mode"], .string("webhook-bridge"))
    XCTAssertEqual(encodedEventReceiver["path"], .string("/events/s3"))
    XCTAssertEqual(encodedEventReceiver["signingSecretEnv"], .string("S3_WEBHOOK_SECRET"))
    XCTAssertEqual(encodedObjectAccess["mode"], .string("metadata-only"))
  }

  func testEventSourceDecodesAndEncodesTypeScriptChatSdkWebhookShape() throws {
    let source = try JSONDecoder().decode(EventSourceContract.self, from: Data(#"""
    {
      "id": "chat-a",
      "kind": "chat-sdk",
      "provider": "slack",
      "webhook": {
        "path": "slack/events",
        "signingSecretEnv": "SLACK_SIGNING_SECRET",
        "bearerTokenEnv": "SLACK_BOT_TOKEN"
      }
    }
    """#.utf8))

    XCTAssertEqual(source.routePath, "slack/events")
    XCTAssertEqual(source.secretEnv, "SLACK_SIGNING_SECRET")
    XCTAssertEqual(source.chatWebhookBearerTokenEnv, "SLACK_BOT_TOKEN")

    guard case let .object(encoded) = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(source)),
      case let .object(webhook)? = encoded["webhook"]
    else {
      return XCTFail("expected encoded chat-sdk webhook shape")
    }
    XCTAssertNil(encoded["path"])
    XCTAssertEqual(webhook["path"], .string("slack/events"))
    XCTAssertEqual(webhook["signingSecretEnv"], .string("SLACK_SIGNING_SECRET"))
    XCTAssertEqual(webhook["bearerTokenEnv"], .string("SLACK_BOT_TOKEN"))
  }

  func testValidationCoversRouteConflictsSecretsAndUnknownBindings() {
    let sources = [
      EventSourceContract(id: "web-a", kind: .webhook, routePath: "/hook", secretEnv: "VALID_SECRET"),
      EventSourceContract(id: "web-a", kind: .webhook, routePath: "/hook", secretEnv: "bad-name")
    ]
    let bindings = [EventBindingContract(
      id: "bind-a",
      sourceId: "missing",
      workflowName: "workflow-a",
      inputMapping: .init(mode: .eventInput)
    )]

    let diagnostics = EventContractValidator.validate(sources: sources, bindings: bindings)

    XCTAssertTrue(diagnostics.map(\.code).contains("INVALID_EVENT_SOURCE"))
    XCTAssertTrue(diagnostics.map(\.code).contains("EVENT_ROUTE_CONFLICT"))
    XCTAssertTrue(diagnostics.map(\.code).contains("INVALID_EVENT_SECRET"))
    XCTAssertTrue(diagnostics.map(\.code).contains("UNKNOWN_EVENT_SOURCE"))
  }

  func testValidationUsesEffectiveHttpPathsAndRequiresWebhookAndS3Receivers() {
    let sources = [
      EventSourceContract(id: "missing-webhook-path", kind: .webhook),
      EventSourceContract(
        id: "web-a",
        kind: .webhook,
        routePath: "/events/shared"
      ),
      EventSourceContract(
        id: "s3-a",
        kind: .s3Repository,
        bucket: "bucket-a",
        eventReceiverMode: "webhook-bridge",
        eventReceiverPath: "/events/shared",
        objectAccessMode: "metadata-only"
      ),
      EventSourceContract(
        id: "s3-default",
        kind: .s3Repository,
        bucket: "bucket-b",
        objectAccessMode: "metadata-only"
      ),
      EventSourceContract(
        id: "web-default-conflict",
        kind: .webhook,
        routePath: "/events/s3-default"
      )
    ]

    let diagnostics = EventContractValidator.validate(sources: sources, bindings: [])

    XCTAssertTrue(diagnostics.contains { $0.code == "INVALID_EVENT_ROUTE" && $0.path == "sources[0].path" })
    XCTAssertTrue(diagnostics.contains { $0.code == "EVENT_ROUTE_CONFLICT" && $0.path == "sources[2].eventReceiver.path" })
    XCTAssertTrue(diagnostics.contains { $0.code == "INVALID_EVENT_SOURCE" && $0.path == "sources[3].eventReceiver" })
    XCTAssertTrue(diagnostics.contains { $0.code == "EVENT_ROUTE_CONFLICT" && $0.path == "sources[4].path" })
  }

  func testValidationIncludesChatSdkWebhookEffectivePathsAndSecrets() {
    let sources = [
      EventSourceContract(
        id: "web-a",
        kind: .webhook,
        routePath: "/events/slack/events"
      ),
      EventSourceContract(
        id: "chat-a",
        kind: .chatSdk,
        routePath: "slack/events",
        secretEnv: "SLACK_SIGNING_SECRET"
      ),
      EventSourceContract(
        id: "chat-b",
        kind: .chatSdk,
        routePath: "bad path",
        secretEnv: "bad-name"
      ),
      EventSourceContract(
        id: "chat-c",
        kind: .chatSdk,
        routePath: "no-auth"
      ),
      EventSourceContract(
        id: "chat-d",
        kind: .chatSdk
      )
    ]

    let diagnostics = EventContractValidator.validate(sources: sources, bindings: [])

    XCTAssertTrue(diagnostics.contains { $0.code == "EVENT_ROUTE_CONFLICT" && $0.path == "sources[1].webhook.path" })
    XCTAssertTrue(diagnostics.contains { $0.code == "INVALID_EVENT_ROUTE" && $0.path == "sources[2].webhook.path" })
    XCTAssertTrue(diagnostics.contains { $0.code == "INVALID_EVENT_SECRET" && $0.path == "sources[2].webhook.signingSecretEnv" })
    XCTAssertTrue(diagnostics.contains { $0.code == "INVALID_EVENT_SECRET" && $0.path == "sources[3].webhook" })
    XCTAssertTrue(diagnostics.contains { $0.code == "INVALID_EVENT_SOURCE" && $0.path == "sources[4].webhook" })
    XCTAssertTrue(diagnostics.contains { $0.code == "INVALID_EVENT_ROUTE" && $0.path == "sources[4].webhook.path" })
  }

  func testValidationRejectsChatSdkMissingAndUnknownProviders() {
    let sources = [
      EventSourceContract(
        id: "chat-missing",
        kind: .chatSdk,
        routePath: "chat/events",
        secretEnv: "CHAT_WEBHOOK_SECRET"
      ),
      EventSourceContract(
        id: "chat-unknown",
        kind: .chatSdk,
        provider: "irc",
        routePath: "irc/events",
        secretEnv: "IRC_WEBHOOK_SECRET"
      )
    ]

    let diagnostics = EventContractValidator.validate(sources: sources, bindings: [])

    XCTAssertTrue(diagnostics.contains {
      $0.code == "INVALID_EVENT_SOURCE" && $0.path == "sources[0].provider"
        && $0.message.contains("slack, teams, gchat, discord, telegram, github, linear, whatsapp, messenger, web")
    })
    XCTAssertTrue(diagnostics.contains {
      $0.code == "INVALID_EVENT_SOURCE" && $0.path == "sources[1].provider"
    })
  }

  func testValidationRejectsUnsupportedChatSdkBindingEventTypes() {
    let source = EventSourceContract(
      id: "chat-a",
      kind: .chatSdk,
      provider: "slack",
      routePath: "slack/events",
      secretEnv: "SLACK_SIGNING_SECRET"
    )
    let binding = EventBindingContract(
      id: "bind-action",
      sourceId: "chat-a",
      match: .init(eventType: "chat.action"),
      workflowName: "workflow-a",
      inputMapping: .init(mode: .eventInput)
    )

    let diagnostics = EventContractValidator.validate(sources: [source], bindings: [binding])

    XCTAssertTrue(diagnostics.contains {
      $0.code == "INVALID_EVENT_BINDING"
        && $0.path == "bindings[0].match.eventType"
        && $0.message == "chat-sdk provider 'slack' does not support event type 'chat.action'"
    })
  }

  func testValidationRejectsUnsupportedTopLevelChatSdkBindingEventType() {
    let source = EventSourceContract(
      id: "chat-a",
      kind: .chatSdk,
      provider: "slack",
      routePath: "slack/events",
      secretEnv: "SLACK_SIGNING_SECRET"
    )
    let binding = EventBindingContract(
      id: "bind-action",
      sourceId: "chat-a",
      eventType: "chat.action",
      workflowName: "workflow-a",
      inputMapping: .init(mode: .eventInput)
    )

    let diagnostics = EventContractValidator.validate(sources: [source], bindings: [binding])

    XCTAssertTrue(diagnostics.contains {
      $0.code == "INVALID_EVENT_BINDING"
        && $0.path == "bindings[0].eventType"
        && $0.message == "chat-sdk provider 'slack' does not support event type 'chat.action'"
    })
  }

  func testDryRunRejectsInvalidChatSdkProviderCapabilities() async {
    let source = EventSourceContract(
      id: "chat-a",
      kind: .chatSdk,
      provider: "slack",
      routePath: "slack/events",
      secretEnv: "SLACK_SIGNING_SECRET"
    )
    let binding = EventBindingContract(
      id: "bind-action",
      sourceId: "chat-a",
      match: .init(eventType: "chat.action"),
      workflowName: "workflow-a",
      inputMapping: .init(mode: .eventInput)
    )
    let envelope = ExternalEventEnvelope(
      sourceId: "chat-a",
      eventId: "evt-1",
      provider: "slack",
      eventType: "chat.action",
      receivedAt: Date(timeIntervalSince1970: 1),
      input: ["text": .string("clicked")]
    )

    let result = await DeterministicEventDryRunTrigger().dryRun(.init(
      sources: [source],
      bindings: [binding],
      envelope: envelope
    ))

    XCTAssertFalse(result.accepted)
    XCTAssertEqual(result.triggers, [])
    XCTAssertTrue(result.diagnostics.contains {
      $0.code == "INVALID_EVENT_BINDING" && $0.path == "bindings[0].match.eventType"
    })
  }

  func testDryRunRejectsUnsupportedTopLevelChatSdkEventType() async {
    let source = EventSourceContract(
      id: "chat-a",
      kind: .chatSdk,
      provider: "slack",
      routePath: "slack/events",
      secretEnv: "SLACK_SIGNING_SECRET"
    )
    let binding = EventBindingContract(
      id: "bind-action",
      sourceId: "chat-a",
      eventType: "chat.action",
      workflowName: "workflow-a",
      inputMapping: .init(mode: .eventInput)
    )
    let envelope = ExternalEventEnvelope(
      sourceId: "chat-a",
      eventId: "evt-1",
      provider: "slack",
      eventType: "chat.action",
      receivedAt: Date(timeIntervalSince1970: 1),
      input: ["text": .string("clicked")]
    )

    let result = await DeterministicEventDryRunTrigger().dryRun(.init(
      sources: [source],
      bindings: [binding],
      envelope: envelope
    ))

    XCTAssertFalse(result.accepted)
    XCTAssertEqual(result.triggers, [])
    XCTAssertTrue(result.diagnostics.contains {
      $0.code == "INVALID_EVENT_BINDING" && $0.path == "bindings[0].eventType"
    })
  }

  func testDryRunRejectsMissingAndUnknownChatSdkProviders() async {
    let binding = EventBindingContract(
      id: "bind-a",
      sourceId: "chat-a",
      match: .init(eventType: "chat.message"),
      workflowName: "workflow-a",
      inputMapping: .init(mode: .eventInput)
    )
    let envelope = ExternalEventEnvelope(
      sourceId: "chat-a",
      eventId: "evt-1",
      provider: "irc",
      eventType: "chat.message",
      receivedAt: Date(timeIntervalSince1970: 1),
      input: ["text": .string("hello")]
    )
    let missingProvider = await DeterministicEventDryRunTrigger().dryRun(.init(
      sources: [EventSourceContract(
        id: "chat-a",
        kind: .chatSdk,
        routePath: "chat/events",
        secretEnv: "CHAT_WEBHOOK_SECRET"
      )],
      bindings: [binding],
      envelope: envelope
    ))
    let unknownProvider = await DeterministicEventDryRunTrigger().dryRun(.init(
      sources: [EventSourceContract(
        id: "chat-a",
        kind: .chatSdk,
        provider: "irc",
        routePath: "chat/events",
        secretEnv: "CHAT_WEBHOOK_SECRET"
      )],
      bindings: [binding],
      envelope: envelope
    ))

    XCTAssertFalse(missingProvider.accepted)
    XCTAssertFalse(unknownProvider.accepted)
    XCTAssertTrue(missingProvider.diagnostics.contains { $0.path == "sources[0].provider" })
    XCTAssertTrue(unknownProvider.diagnostics.contains { $0.path == "sources[0].provider" })
  }

  func testValidationCoversTemplateOutputDestinationsAndExpandedSourceKinds() {
    let sources = [
      EventSourceContract(id: "files", kind: .fileChange),
      EventSourceContract(
        id: "s3",
        kind: .s3Repository,
        routePath: "/s3",
        bucket: "",
        eventReceiverPath: "bad path",
        objectAccessMode: "full",
        rootPrefix: "../unsafe"
      )
    ]
    let bindings = [
      EventBindingContract(
        id: "bind-template",
        sourceId: "files",
        workflowName: "workflow-a",
        inputMapping: .init(mode: .template, template: .object(["request": .string("{{ bad.reference }}")])),
        outputDestinations: []
      )
    ]

    let diagnostics = EventContractValidator.validate(sources: sources, bindings: bindings)

    XCTAssertTrue(diagnostics.map(\.code).contains("INVALID_EVENT_TEMPLATE"))
    XCTAssertTrue(diagnostics.map(\.code).contains("INVALID_EVENT_OUTPUT_DESTINATION"))
    XCTAssertTrue(diagnostics.contains { $0.path == "sources[1].bucket" })
    XCTAssertTrue(diagnostics.contains { $0.path == "sources[1].objectAccess.mode" })
    XCTAssertTrue(diagnostics.contains { $0.path == "sources[1].eventReceiver.path" })
    XCTAssertTrue(diagnostics.contains { $0.path == "sources[1].rootPrefix" })
  }

  func testValidationAcceptsSupportedTemplatePrefixesAndS3MetadataOnlyContract() {
    let sources = [
      EventSourceContract(
        id: "s3",
        kind: .s3Repository,
        routePath: "/s3",
        bucket: "release-artifacts",
        eventReceiverPath: "/s3/events",
        objectAccessMode: "metadata-only",
        rootPrefix: "incoming/releases"
      )
    ]
    let bindings = [
      EventBindingContract(
        id: "bind-s3",
        sourceId: "s3",
        workflowName: "workflow-a",
        inputMapping: .init(mode: .template, template: .object([
          "eventId": .string("{{ event.eventId }}"),
          "source": .string("{{ source.id }}"),
          "binding": .string("{{ binding.id }}")
        ])),
        outputDestinations: ["chat-output"]
      )
    ]

    XCTAssertEqual(EventContractValidator.validate(sources: sources, bindings: bindings), [])
  }

  func testDryRunProducesTriggerSummaryWithoutSideEffects() async {
    let source = EventSourceContract(id: "web-a", kind: .webhook, provider: "web", routePath: "/hook")
    let binding = EventBindingContract(
      id: "bind-a",
      sourceId: "web-a",
      eventType: "message",
      workflowName: "workflow-a",
      inputMapping: .init(mode: .template, template: .object([
        "text": .string("{{ event.input.text }}"),
        "persona": .string("default")
      ])),
      outputDestinations: ["root"]
    )
    let envelope = ExternalEventEnvelope(
      sourceId: "web-a",
      eventId: "evt-1",
      provider: "web",
      eventType: "message",
      receivedAt: Date(timeIntervalSince1970: 1),
      dedupeKey: "web-a:evt-1",
      input: ["text": .string("hello")]
    )

    let result = await DeterministicEventDryRunTrigger().dryRun(.init(sources: [source], bindings: [binding], envelope: envelope))

    XCTAssertTrue(result.accepted)
    XCTAssertEqual(result.triggers.first?.workflowName, "workflow-a")
    XCTAssertEqual(result.triggers.first?.input["text"], .string("hello"))
    XCTAssertEqual(result.triggers.first?.input["persona"], .string("default"))
    XCTAssertEqual(result.triggers.first?.outputDestinations, ["root"])
    XCTAssertEqual(result.triggers.first?.runtimeVariables["eventOutputDestinations"], .array([.string("root")]))
    XCTAssertEqual(result.triggers.first?.runtimeVariables["humanInput"], .object([
      "text": .string("hello"),
      "persona": .string("default")
    ]))
    XCTAssertEqual(result.triggers.first?.runtimeVariables["eventMailboxBridgePolicy"], .object([
      "input": .object(["consumer": .string("direct-workflow")]),
      "output": .object([
        "reply": .object(["mode": .string("final")]),
        "progress": .object(["mode": .string("status-only")]),
        "control": .object(["mode": .string("none")])
      ])
    ]))
    XCTAssertEqual(result.receipt?.status, "dry-run")
    XCTAssertEqual(result.replyDispatches, [])
  }

  func testDryRunRendersTemplateInputMappingWithEventSourceAndBindingRoots() async {
    let source = EventSourceContract(id: "web-a", kind: .webhook, provider: "web", routePath: "/hook")
    let binding = EventBindingContract(
      id: "bind-a",
      sourceId: "web-a",
      eventType: "message",
      workflowName: "workflow-a",
      inputMapping: .init(mode: .template, template: .object([
        "text": .string("{{ event.input.text }}"),
        "file": .string("{{ event.input.files.0 }}"),
        "summary": .string("{{ source.kind }}:{{ binding.id }}"),
        "workflow": .string("{{ binding.workflowName }}"),
        "nested": .array([.string("{{ event.input.text }}")])
      ])),
      outputDestinations: ["root"]
    )
    let envelope = ExternalEventEnvelope(
      sourceId: "web-a",
      eventId: "evt-1",
      provider: "web",
      eventType: "message",
      receivedAt: Date(timeIntervalSince1970: 1),
      input: [
        "text": .string("hello"),
        "files": .array([.object(["path": .string("docs/readme.md")])])
      ]
    )

    let result = await DeterministicEventDryRunTrigger().dryRun(.init(sources: [source], bindings: [binding], envelope: envelope))

    XCTAssertTrue(result.accepted)
    XCTAssertEqual(result.triggers.first?.input["text"], .string("hello"))
    XCTAssertEqual(result.triggers.first?.input["file"], .object(["path": .string("docs/readme.md")]))
    XCTAssertEqual(result.triggers.first?.input["summary"], .string("webhook:bind-a"))
    XCTAssertEqual(result.triggers.first?.input["workflow"], .string("workflow-a"))
    XCTAssertEqual(result.triggers.first?.input["nested"], .array([.string("hello")]))
  }

  func testDryRunHonorsBindingEnabledAndMatchRules() async {
    let source = EventSourceContract(id: "web-a", kind: .webhook, provider: "web", routePath: "/hook")
    let disabled = EventBindingContract(id: "disabled", enabled: false, sourceId: "web-a", workflowName: "workflow-disabled", inputMapping: .init(mode: .eventInput))
    let wrongConversation = EventBindingContract(
      id: "wrong-conversation",
      sourceId: "web-a",
      match: .init(eventType: "message", conversationId: "other", pathPrefix: "docs/"),
      workflowName: "workflow-wrong-conversation",
      inputMapping: .init(mode: .eventInput)
    )
    let wrongPath = EventBindingContract(
      id: "wrong-path",
      sourceId: "web-a",
      match: .init(eventType: "message", conversationId: "conversation-a", pathPrefix: "src/"),
      workflowName: "workflow-wrong-path",
      inputMapping: .init(mode: .eventInput)
    )
    let matched = EventBindingContract(
      id: "matched",
      sourceId: "web-a",
      match: .init(eventType: "message", conversationId: "conversation-a", pathPrefix: "docs/"),
      workflowName: "workflow-a",
      inputMapping: .init(mode: .eventInput)
    )
    let envelope = ExternalEventEnvelope(
      sourceId: "web-a",
      eventId: "evt-1",
      provider: "web",
      eventType: "message",
      receivedAt: Date(timeIntervalSince1970: 1),
      conversation: ["id": .string("conversation-a")],
      input: ["file": .object(["path": .string("docs/readme.md")])]
    )

    let result = await DeterministicEventDryRunTrigger().dryRun(.init(
      sources: [source],
      bindings: [disabled, wrongConversation, wrongPath, matched],
      envelope: envelope
    ))

    XCTAssertEqual(result.triggers.map(\.bindingId), ["matched"])
    XCTAssertEqual(result.triggers.first?.workflowName, "workflow-a")
  }

  func testBindingDecodeRequiresWorkflowNameExceptSupervisorModesAndTypedInputMapping() throws {
    let direct = try JSONDecoder().decode(EventBindingContract.self, from: Data(#"{"id":"bind-a","sourceId":"web-a","workflowName":"workflow-a","inputMapping":{"mode":"event-input"},"outputDestinations":["chat"]}"#.utf8))
    let supervisor = try JSONDecoder().decode(EventBindingContract.self, from: Data(#"{"id":"bind-b","sourceId":"web-a","execution":{"mode":"supervisor-dispatch"},"inputMapping":{"mode":"template","template":{"text":"{{ event.input.text }}"}}}"#.utf8))

    XCTAssertEqual(direct.workflowName, "workflow-a")
    XCTAssertEqual(direct.outputDestinations, ["chat"])
    XCTAssertNil(supervisor.workflowName)
    XCTAssertEqual(supervisor.execution?.mode, .supervisorDispatch)
    XCTAssertEqual(EventContractValidator.validate(sources: [EventSourceContract(id: "web-a", kind: .webhook, routePath: "/hook")], bindings: [direct, supervisor]), [])

    let missingWorkflow = EventBindingContract(id: "bind-c", sourceId: "web-a", workflowName: nil, inputMapping: .init(mode: .eventInput))
    XCTAssertTrue(EventContractValidator.validate(sources: [EventSourceContract(id: "web-a", kind: .webhook, routePath: "/hook")], bindings: [missingWorkflow]).contains { $0.path == "bindings[0].workflowName" })

    XCTAssertThrowsError(try JSONDecoder().decode(EventBindingContract.self, from: Data(#"{"id":"bad","sourceId":"web-a","workflowName":"workflow-a","inputMapping":{"mode":"merge"}}"#.utf8)))
    XCTAssertThrowsError(try JSONDecoder().decode(EventBindingContract.self, from: Data(#"{"id":"bad","sourceId":"web-a","workflowName":"workflow-a"}"#.utf8)))
  }

  func testBindingDecodesAuthoredMailboxBridgePolicy() throws {
    let binding = try JSONDecoder().decode(EventBindingContract.self, from: Data(#"""
    {
      "id": "bind-a",
      "sourceId": "web-a",
      "workflowName": "workflow-a",
      "inputMapping": {"mode": "event-input"},
      "mailboxBridge": {
        "input": {"consumer": "supervisor"},
        "output": {
          "reply": {"mode": "none"},
          "progress": {"mode": "none"},
          "control": {"mode": "status-only"}
        }
      }
    }
    """#.utf8))

    XCTAssertEqual(binding.mailboxBridge?.input?.consumer, .supervisor)
    XCTAssertEqual(binding.mailboxBridge?.output?.reply?.mode, EventMailboxBridgeReplyMode.none)
    XCTAssertEqual(binding.mailboxBridge?.output?.progress?.mode, EventMailboxBridgeStatusMode.none)
    XCTAssertEqual(binding.mailboxBridge?.output?.control?.mode, .statusOnly)
  }

  func testValidationRejectsMailboxBridgeConsumerModeMismatches() {
    let source = EventSourceContract(id: "web-a", kind: .webhook, routePath: "/hook")
    let directWithSupervisorConsumer = EventBindingContract(
      id: "direct",
      sourceId: "web-a",
      workflowName: "workflow-a",
      inputMapping: .init(mode: .eventInput),
      mailboxBridge: .init(input: .init(consumer: .supervisor))
    )
    let supervisedWithDirectConsumer = EventBindingContract(
      id: "supervised",
      sourceId: "web-a",
      workflowName: "workflow-b",
      inputMapping: .init(mode: .eventInput),
      execution: .init(mode: .supervised),
      mailboxBridge: .init(input: .init(consumer: .directWorkflow))
    )

    let diagnostics = EventContractValidator.validate(
      sources: [source],
      bindings: [directWithSupervisorConsumer, supervisedWithDirectConsumer]
    )

    XCTAssertTrue(diagnostics.contains { $0.code == "INVALID_EVENT_MAILBOX_BRIDGE" && $0.path == "bindings[0].mailboxBridge.input.consumer" })
    XCTAssertTrue(diagnostics.contains { $0.code == "INVALID_EVENT_MAILBOX_BRIDGE" && $0.path == "bindings[1].mailboxBridge.input.consumer" })
  }

  func testDryRunHonorsExplicitHumanInputMirrorFalseAndSupervisorBridgePolicy() async {
    let source = EventSourceContract(id: "chat-a", kind: .chatSdk, provider: "web", routePath: "chat/events", secretEnv: "CHAT_WEBHOOK_SECRET")
    let binding = EventBindingContract(
      id: "bind-a",
      sourceId: "chat-a",
      workflowName: "workflow-a",
      inputMapping: .init(mode: .eventInput, mirrorToHumanInput: false),
      execution: .init(mode: .supervised),
      outputDestinations: ["chat"]
    )
    let envelope = ExternalEventEnvelope(
      sourceId: "chat-a",
      eventId: "evt-1",
      provider: "web",
      eventType: "message",
      receivedAt: Date(timeIntervalSince1970: 1),
      input: ["text": .string("hello")]
    )

    let result = await DeterministicEventDryRunTrigger().dryRun(.init(sources: [source], bindings: [binding], envelope: envelope))

    XCTAssertNil(result.triggers.first?.runtimeVariables["humanInput"])
    XCTAssertEqual(result.triggers.first?.runtimeVariables["eventMailboxBridgePolicy"], .object([
      "input": .object(["consumer": .string("supervisor")]),
      "output": .object([
        "reply": .object(["mode": .string("final")]),
        "progress": .object(["mode": .string("status-only")]),
        "control": .object(["mode": .string("status-only")])
      ])
    ]))
  }

  func testDryRunAppliesAuthoredMailboxBridgePolicyOverrides() async {
    let source = EventSourceContract(id: "chat-a", kind: .chatSdk, provider: "web", routePath: "chat/events", secretEnv: "CHAT_WEBHOOK_SECRET")
    let binding = EventBindingContract(
      id: "bind-a",
      sourceId: "chat-a",
      workflowName: "workflow-a",
      inputMapping: .init(mode: .eventInput),
      execution: .init(mode: .supervised),
      mailboxBridge: .init(
        input: .init(consumer: .supervisor),
        output: .init(
          reply: .init(mode: .none),
          progress: .init(mode: .none),
          control: .init(mode: .none)
        )
      )
    )
    let envelope = ExternalEventEnvelope(
      sourceId: "chat-a",
      eventId: "evt-1",
      provider: "web",
      eventType: "message",
      receivedAt: Date(timeIntervalSince1970: 1),
      input: ["text": .string("hello")]
    )

    let result = await DeterministicEventDryRunTrigger().dryRun(.init(sources: [source], bindings: [binding], envelope: envelope))

    XCTAssertEqual(result.triggers.first?.runtimeVariables["eventMailboxBridgePolicy"], .object([
      "input": .object(["consumer": .string("supervisor")]),
      "output": .object([
        "reply": .object(["mode": .string("none")]),
        "progress": .object(["mode": .string("none")]),
        "control": .object(["mode": .string("none")])
      ])
    ]))
  }
}
