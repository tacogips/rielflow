import Foundation
import XCTest
@testable import RielflowCore

final class SwiftDeletionReadinessTests: XCTestCase {
  func testTrackedGateKeepsTypeScriptDeletionBlocked() throws {
    let data = try loadTrackedGateData()
    let gate = try JSONDecoder().decode(SwiftDeletionReadinessGate.self, from: data)
    let result = SwiftDeletionReadinessValidator().decodeAndValidate(data)

    XCTAssertTrue(result.valid, result.diagnostics.joined(separator: "\n"))
    XCTAssertFalse(result.allowsTypeScriptDeletion)
    XCTAssertFalse(gate.allowsTypeScriptDeletion)
    XCTAssertFalse(gate.typeScriptSourceDeletionReady)
    XCTAssertTrue(gate.productionSwiftPackagingReady)
    XCTAssertEqual(Set(gate.domains.compactMap(\.id)), Set(SwiftDeletionReadinessValidator.requiredDomainIds))
    XCTAssertTrue(result.blockingDomainIds.contains("agent-codex"))
    XCTAssertTrue(result.blockingDomainIds.contains("agent-claude-code"))
    XCTAssertTrue(result.blockingDomainIds.contains("agent-cursor-cli"))
  }

  func testDecodeAndValidateRejectsMissingRequiredDomainField() throws {
    var gate = try loadTrackedGate()
    gate.domains[0].evidenceArtifacts = nil
    let data = try JSONEncoder().encode(gate)

    let result = SwiftDeletionReadinessValidator().decodeAndValidate(data)

    XCTAssertFalse(result.valid)
    XCTAssertTrue(result.diagnostics.contains("domain package-build missing evidenceArtifacts"))
  }

  func testDecodeAndValidateRejectsMissingLastVerifiedAtAndNotesFields() throws {
    var raw = try rawTrackedGateObject()
    var domains = try XCTUnwrap(raw["domains"] as? [[String: Any]])
    domains[0].removeValue(forKey: "lastVerifiedAt")
    domains[1].removeValue(forKey: "notes")
    raw["domains"] = domains
    let data = try JSONSerialization.data(withJSONObject: raw, options: [.sortedKeys])

    let result = SwiftDeletionReadinessValidator().decodeAndValidate(data)

    XCTAssertFalse(result.valid)
    XCTAssertTrue(result.diagnostics.contains("domain package-build missing lastVerifiedAt"))
    XCTAssertTrue(result.diagnostics.contains("domain cli missing notes"))
  }

  func testValidateRejectsMissingEvidenceMetadata() throws {
    var gate = try loadTrackedGate()
    gate.domains[0].evidenceCommands = nil
    gate.domains[1].evidenceArtifacts = nil

    let result = SwiftDeletionReadinessValidator().validate(gate)

    XCTAssertFalse(result.valid)
    XCTAssertTrue(result.diagnostics.contains("domain package-build missing evidenceCommands"))
    XCTAssertTrue(result.diagnostics.contains("domain cli missing evidenceArtifacts"))
  }

  func testValidateRejectsMissingAgentDomain() throws {
    var gate = try loadTrackedGate()
    gate.domains.removeAll { $0.id == "agent-cursor-cli" }

    let result = SwiftDeletionReadinessValidator().validate(gate)

    XCTAssertFalse(result.valid)
    XCTAssertTrue(result.blockingDomainIds.contains("agent-cursor-cli"))
    XCTAssertTrue(result.diagnostics.contains("required domain agent-cursor-cli is missing"))
  }

  func testValidateRejectsDuplicateDomainId() throws {
    var gate = try loadTrackedGate()
    gate.domains.append(try XCTUnwrap(gate.domains.first { $0.id == "cli" }))

    let result = SwiftDeletionReadinessValidator().validate(gate)

    XCTAssertFalse(result.valid)
    XCTAssertTrue(result.diagnostics.contains("domain cli is duplicated"))
  }

  func testValidateRejectsUnsafeDeletionReadyAggregate() throws {
    var gate = try loadTrackedGate()
    gate.allowsTypeScriptDeletion = true
    gate.typeScriptSourceDeletionReady = true

    let result = SwiftDeletionReadinessValidator().validate(gate)

    XCTAssertFalse(result.valid)
    XCTAssertFalse(result.allowsTypeScriptDeletion)
    XCTAssertTrue(result.diagnostics.contains("allowsTypeScriptDeletion cannot be true while required domains are blocked"))
    XCTAssertTrue(result.diagnostics.contains("typeScriptSourceDeletionReady cannot be true while required domains are blocked"))
  }

  func testValidateRejectsDeletionReadyClaimWithoutCurrentAcceptedEvidence() throws {
    var gate = try deletionReadyGate()
    gate.domains[0].verifiedCommit = "stale-commit"

    let result = SwiftDeletionReadinessValidator().validate(
      gate,
      context: deletionReadyContext(for: gate)
    )

    XCTAssertFalse(result.valid)
    XCTAssertFalse(result.allowsTypeScriptDeletion)
    XCTAssertTrue(result.diagnostics.contains("domain package-build verifiedCommit does not match current commit"))
  }

  func testValidateRejectsDeletionReadyClaimWithHighOrMidReviewFinding() throws {
    var gate = try deletionReadyGate()
    gate.domains[0].acceptedReviewFindingSeverities = ["low", "Mid"]

    let result = SwiftDeletionReadinessValidator().validate(
      gate,
      context: deletionReadyContext(for: gate)
    )

    XCTAssertFalse(result.valid)
    XCTAssertFalse(result.allowsTypeScriptDeletion)
    XCTAssertTrue(result.diagnostics.contains("domain package-build accepted review includes blocking finding severity mid"))
  }

  func testValidateRejectsDeletionReadyClaimWithoutReviewSeverityEvidence() throws {
    var gate = try deletionReadyGate()
    gate.domains[0].acceptedReviewFindingSeverities = nil

    let result = SwiftDeletionReadinessValidator().validate(
      gate,
      context: deletionReadyContext(for: gate)
    )

    XCTAssertFalse(result.valid)
    XCTAssertFalse(result.allowsTypeScriptDeletion)
    XCTAssertTrue(result.diagnostics.contains("domain package-build missing acceptedReviewFindingSeverities"))
  }

  func testValidateRejectsDeletionReadyClaimWithEmptyReviewSeverityEvidence() throws {
    var gate = try deletionReadyGate()
    gate.domains[0].acceptedReviewFindingSeverities = []

    let result = SwiftDeletionReadinessValidator().validate(
      gate,
      context: deletionReadyContext(for: gate)
    )

    XCTAssertFalse(result.valid)
    XCTAssertFalse(result.allowsTypeScriptDeletion)
    XCTAssertTrue(
      result.diagnostics.contains(
        "domain package-build acceptedReviewFindingSeverities must include explicit non-blocking severity evidence"
      )
    )
  }

  func testValidateRejectsDeletionReadyClaimWithBlockingOrInvalidReviewSeverity() throws {
    let cases = [
      ("medium", "domain package-build accepted review includes blocking finding severity medium"),
      ("critical", "domain package-build accepted review includes blocking finding severity critical"),
      ("blocker", "domain package-build accepted review includes blocking finding severity blocker"),
      ("unknown", "domain package-build accepted review includes unknown finding severity unknown"),
      ("", "domain package-build accepted review includes blank finding severity"),
    ]

    for (severity, expectedDiagnostic) in cases {
      var gate = try deletionReadyGate()
      gate.domains[0].acceptedReviewFindingSeverities = [severity]

      let result = SwiftDeletionReadinessValidator().validate(
        gate,
        context: deletionReadyContext(for: gate)
      )

      XCTAssertFalse(result.valid, "severity: \(severity)")
      XCTAssertFalse(result.allowsTypeScriptDeletion, "severity: \(severity)")
      XCTAssertTrue(result.diagnostics.contains(expectedDiagnostic), "severity: \(severity)")
    }
  }

  func testValidateRejectsDeletionReadyClaimWithPlaceholderEvidenceCommand() throws {
    var gate = try deletionReadyGate()
    gate.domains[0].evidenceCommands = ["true"]

    let result = SwiftDeletionReadinessValidator().validate(
      gate,
      context: deletionReadyContext(for: gate)
    )

    XCTAssertFalse(result.valid)
    XCTAssertFalse(result.allowsTypeScriptDeletion)
    XCTAssertTrue(result.diagnostics.contains("domain package-build evidenceCommands contains placeholder command true"))
  }

  func testValidateRejectsDeletionReadyClaimWithSourceOnlyEvidenceArtifact() throws {
    var gate = try deletionReadyGate()
    gate.domains[0].evidenceArtifacts = ["Sources"]

    let result = SwiftDeletionReadinessValidator().validate(
      gate,
      context: deletionReadyContext(for: gate)
    )

    XCTAssertFalse(result.valid)
    XCTAssertFalse(result.allowsTypeScriptDeletion)
    XCTAssertTrue(result.diagnostics.contains("domain package-build evidenceArtifacts contains non-durable reference Sources"))
  }

  func testValidateRejectsDeletionReadyClaimWithMalformedLastVerifiedAt() throws {
    var gate = try deletionReadyGate()
    gate.domains[0].lastVerifiedAt = "not-a-date"

    let result = SwiftDeletionReadinessValidator().validate(
      gate,
      context: deletionReadyContext(for: gate)
    )

    XCTAssertFalse(result.valid)
    XCTAssertFalse(result.allowsTypeScriptDeletion)
    XCTAssertTrue(result.diagnostics.contains("domain package-build lastVerifiedAt must be ISO-8601"))
  }

  func testValidateRejectsDeletionReadyClaimWithUnresolvedEvidenceArtifact() throws {
    var gate = try deletionReadyGate()
    let context = deletionReadyContext(for: gate)
    gate.domains[0].evidenceArtifacts = ["verification-result:fake/package-build"]

    let result = SwiftDeletionReadinessValidator().validate(
      gate,
      context: context
    )

    XCTAssertFalse(result.valid)
    XCTAssertFalse(result.allowsTypeScriptDeletion)
    XCTAssertTrue(
      result.diagnostics.contains(
        "domain package-build evidenceArtifact verification-result:fake/package-build is not resolved"
      )
    )
  }

  func testValidateRejectsDeletionReadyClaimWithFailedCommandEvidence() throws {
    let gate = try deletionReadyGate()
    var context = deletionReadyContext(for: gate)
    let artifact = try XCTUnwrap(gate.domains[0].evidenceArtifacts?.first)
    context.resolvedEvidenceArtifacts[artifact]?.exitCode = 1

    let result = SwiftDeletionReadinessValidator().validate(gate, context: context)

    XCTAssertFalse(result.valid)
    XCTAssertFalse(result.allowsTypeScriptDeletion)
    XCTAssertTrue(result.diagnostics.contains("domain package-build evidenceArtifact \(artifact) command exitCode is not 0"))
  }

  func testValidateRejectsDeletionReadyClaimWithIncompleteMigrationStatus() throws {
    var gate = try deletionReadyGate()
    gate.migrationStatus = "incomplete"

    let result = SwiftDeletionReadinessValidator().validate(
      gate,
      context: deletionReadyContext(for: gate)
    )

    XCTAssertFalse(result.valid)
    XCTAssertFalse(result.allowsTypeScriptDeletion)
    XCTAssertTrue(result.diagnostics.contains("migrationStatus must be deletion_ready when TypeScript deletion is accepted"))
  }

  func testValidateRejectsDeletionReadyClaimWithUnexpectedReviewWorkflow() throws {
    var gate = try deletionReadyGate()
    gate.domains[0].acceptedReviewWorkflowId = "manual"

    let result = SwiftDeletionReadinessValidator().validate(
      gate,
      context: deletionReadyContext(for: gate)
    )

    XCTAssertFalse(result.valid)
    XCTAssertFalse(result.allowsTypeScriptDeletion)
    XCTAssertTrue(
      result.diagnostics.contains("domain package-build acceptedReviewWorkflowId does not match expected review workflow")
    )
  }

  func testValidateRejectsDeletionReadyClaimWithUnexpectedReviewNode() throws {
    var gate = try deletionReadyGate()
    gate.domains[0].acceptedReviewNodeId = "step1"

    let result = SwiftDeletionReadinessValidator().validate(
      gate,
      context: deletionReadyContext(for: gate)
    )

    XCTAssertFalse(result.valid)
    XCTAssertFalse(result.allowsTypeScriptDeletion)
    XCTAssertTrue(result.diagnostics.contains("domain package-build acceptedReviewNodeId does not match expected review node"))
  }

  func testValidateDoesNotAllowDeletionWhenDuplicateDomainInvalidatesReadyGate() throws {
    var gate = try deletionReadyGate()
    gate.domains.append(try XCTUnwrap(gate.domains.first { $0.id == "cli" }))

    let result = SwiftDeletionReadinessValidator().validate(
      gate,
      context: deletionReadyContext(for: gate)
    )

    XCTAssertFalse(result.valid)
    XCTAssertFalse(result.allowsTypeScriptDeletion)
    XCTAssertTrue(result.diagnostics.contains("domain cli is duplicated"))
  }

  func testDecodeAndValidateDoesNotAllowDeletionWhenRequiredStructuralFieldIsMissing() throws {
    let gate = try deletionReadyGate()
    var raw = try JSONSerialization.jsonObject(with: JSONEncoder().encode(gate)) as? [String: Any]
    var domains = try XCTUnwrap(raw?["domains"] as? [[String: Any]])
    domains[0].removeValue(forKey: "notes")
    raw?["domains"] = domains
    let data = try JSONSerialization.data(withJSONObject: try XCTUnwrap(raw), options: [.sortedKeys])

    let result = SwiftDeletionReadinessValidator().decodeAndValidate(
      data,
      context: deletionReadyContext(for: gate)
    )

    XCTAssertFalse(result.valid)
    XCTAssertFalse(result.allowsTypeScriptDeletion)
    XCTAssertTrue(result.diagnostics.contains("domain package-build missing notes"))
  }

  func testValidateRejectsDeletionReadyClaimWhenEvidenceCommandHasNoResolvedArtifact() throws {
    var gate = try deletionReadyGate()
    gate.domains[0].evidenceCommands = [
      "swift build",
      "bun run typecheck:server",
    ]
    gate.domains[0].evidenceArtifacts = ["verification-result:swift-deletion-readiness/package-build-0"]
    let context = deletionReadyContext(for: gate)

    let result = SwiftDeletionReadinessValidator().validate(gate, context: context)

    XCTAssertFalse(result.valid)
    XCTAssertFalse(result.allowsTypeScriptDeletion)
    XCTAssertTrue(
      result.diagnostics.contains(
        "domain package-build evidenceCommand bun run typecheck:server has no resolved successful evidenceArtifact"
      )
    )
  }

  func testValidateRejectsDeletionReadyClaimWithValidatorOnlyCommands() throws {
    var gate = try deletionReadyGate()
    gate.domains = gate.domains.map { domain in
      var updated = domain
      updated.evidenceCommands = ["swift test --filter SwiftDeletionReadinessTests"]
      updated.evidenceArtifacts = ["verification-result:swift-deletion-readiness/\(updated.id ?? "domain")-validator-only"]
      return updated
    }

    let result = SwiftDeletionReadinessValidator().validate(
      gate,
      context: deletionReadyContext(for: gate)
    )

    XCTAssertFalse(result.valid)
    XCTAssertFalse(result.allowsTypeScriptDeletion)
    XCTAssertTrue(result.blockingDomainIds.contains("package-build"))
    XCTAssertTrue(result.blockingDomainIds.contains("agent-codex"))
    XCTAssertTrue(result.diagnostics.contains("domain package-build missing required evidence command matching swift + build"))
    XCTAssertTrue(result.diagnostics.contains("domain agent-codex missing required evidence command matching swift + test + CodexAgent"))
  }

  func testValidateAllowsDeletionOnlyWhenEveryDomainHasAcceptedEvidence() throws {
    let gate = try deletionReadyGate()

    let result = SwiftDeletionReadinessValidator().validate(
      gate,
      context: deletionReadyContext(for: gate)
    )

    XCTAssertTrue(result.valid, result.diagnostics.joined(separator: "\n"))
    XCTAssertTrue(result.allowsTypeScriptDeletion)
    XCTAssertTrue(result.blockingDomainIds.isEmpty)
  }

  private func deletionReadyGate() throws -> SwiftDeletionReadinessGate {
    var gate = try loadTrackedGate()
    gate.migrationStatus = "deletion_ready"
    gate.allowsTypeScriptDeletion = true
    gate.typeScriptSourceDeletionReady = true
    gate.domains = try gate.domains.map { domain in
      var updated = domain
      let domainId = try XCTUnwrap(updated.id)
      let commands = deletionReadyEvidenceCommands(for: domainId)
      updated.status = "passed"
      updated.reviewDecision = "accepted"
      updated.lastVerifiedAt = "2026-06-16T00:00:00Z"
      updated.evidenceCommands = commands
      updated.evidenceArtifacts = commands.indices.map { index in
        "verification-result:swift-deletion-readiness/\(domainId)-\(index)"
      }
      updated.verifiedBranch = "main"
      updated.verifiedCommit = "current-commit"
      updated.acceptedReviewWorkflowId = "codex-design-and-implement-review-loop"
      updated.acceptedReviewNodeId = "step7-adversarial-review"
      updated.acceptedReviewFindingSeverities = ["low"]
      return updated
    }
    return gate
  }

  private func deletionReadyEvidenceCommands(for domainId: String) -> [String] {
    switch domainId {
    case "package-build":
      return ["swift build", "bun run typecheck"]
    case "cli":
      return ["swift test --filter WorkflowCommandTests", "bun run packages/rielflow/src/bin.ts --help"]
    case "server":
      return ["swift test --filter RielflowServerTests", "bun run typecheck:server"]
    case "graphql":
      return ["swift test --filter RielflowGraphQLTests", "bun test packages/rielflow/src/graphql"]
    case "event":
      return ["swift test --filter RielflowEventsTests", "bun test packages/rielflow/src/events"]
    case "workflow-package":
      return ["swift test --filter WorkflowPackage", "bun run packages/rielflow/src/bin.ts package --help"]
    case "persistence":
      return ["swift test --filter Persistence", "bun test packages/rielflow/src/workflow/manager-session-store.test.ts"]
    case "release":
      return [
        "scripts/build-homebrew-release.sh --dry-run darwin-arm64",
        "scripts/render-homebrew-formula.sh 0.0.0 Formula/rielflow.rb",
      ]
    case "documentation":
      return [
        "rg -n \"swift-deletion-readiness\" design-docs",
        "rg -n \"TypeScript deletion\" design-docs",
      ]
    case "test":
      return ["swift test", "bun test"]
    case "agent-codex":
      return ["swift test --filter CodexAgent", "bun test packages/rielflow-adapters/src/codex"]
    case "agent-claude-code":
      return ["swift test --filter ClaudeCodeAgent", "bun test packages/rielflow-adapters/src/claude"]
    case "agent-cursor-cli":
      return ["swift test --filter CursorCLIAgent", "bun test packages/rielflow-adapters/src/cursor"]
    default:
      return ["swift test", "bun test"]
    }
  }

  private func deletionReadyContext(for gate: SwiftDeletionReadinessGate) -> SwiftDeletionReadinessValidationContext {
    var resolvedEvidenceArtifacts: [String: SwiftDeletionReadinessEvidenceArtifact] = [:]
    for domain in gate.domains {
      guard
        let domainId = domain.id,
        let commands = domain.evidenceCommands,
        let artifacts = domain.evidenceArtifacts
      else {
        continue
      }
      for (artifact, command) in zip(artifacts, commands) {
        resolvedEvidenceArtifacts[artifact] = SwiftDeletionReadinessEvidenceArtifact(
          domainId: domainId,
          command: command,
          exitCode: 0,
          branch: "main",
          commit: "current-commit",
          workflowId: "codex-design-and-implement-review-loop",
          nodeId: "step7-adversarial-review"
        )
      }
    }
    return SwiftDeletionReadinessValidationContext(
      currentBranch: "main",
      currentCommit: "current-commit",
      resolvedEvidenceArtifacts: resolvedEvidenceArtifacts
    )
  }

  private func loadTrackedGate() throws -> SwiftDeletionReadinessGate {
    try JSONDecoder().decode(SwiftDeletionReadinessGate.self, from: loadTrackedGateData())
  }

  private func loadTrackedGateData() throws -> Data {
    let url = try repositoryRoot()
      .appendingPathComponent("packaging/swift-deletion-readiness.json")
    return try Data(contentsOf: url)
  }

  private func rawTrackedGateObject() throws -> [String: Any] {
    let raw = try JSONSerialization.jsonObject(with: loadTrackedGateData())
    return try XCTUnwrap(raw as? [String: Any])
  }

  private func repositoryRoot() throws -> URL {
    var current = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
    for _ in 0..<8 {
      if FileManager.default.fileExists(atPath: current.appendingPathComponent("Package.swift").path) {
        return current
      }
      current.deleteLastPathComponent()
    }
    throw NSError(domain: "SwiftDeletionReadinessTests", code: 1, userInfo: [NSLocalizedDescriptionKey: "Package.swift not found"])
  }
}
