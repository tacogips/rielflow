import XCTest
@testable import RielflowAddons
@testable import RielflowCore

final class AddonExecutionContractsTests: XCTestCase {
  func testUnknownAddonFailsDeterministicallyWithoutInjectedResolver() async {
    let input = AddonExecutionInput(
      addonName: "third-party-addon",
      nodePayload: ["kind": .string("addon")],
      variables: ["dryRun": .bool(true)],
      source: .init(packageName: "pkg", addonName: "third-party-addon", sourcePath: "addons/addon"),
      options: .init(boundary: .async)
    )

    let result = await DeterministicAddonResolver().resolve(.init(input: input))

    guard case let .failed(diagnostics) = result else {
      return XCTFail("expected deterministic failure")
    }
    XCTAssertEqual(diagnostics.first?.code, "UNKNOWN_ADDON")
  }

  func testBuiltinAddonResolvesDeclarativelyWithoutRuntimeInternals() async throws {
    let input = AddonExecutionInput(
      addonName: "chat-reply",
      version: "1.0.0",
      nodePayload: ["message": .string("hello")],
      variables: [:],
      source: .init(addonName: "chat-reply", builtin: true),
      options: .init(boundary: .sync)
    )

    let result = await DeterministicAddonResolver().resolve(.init(input: input, allowedBuiltins: ["chat-reply"]))
    guard case let .resolved(output) = result else {
      return XCTFail("expected declarative resolution")
    }

    XCTAssertNil(output.candidatePayload)
    let encoded = String(data: try JSONEncoder().encode(input), encoding: .utf8)!
    XCTAssertFalse(encoded.contains("communicationId"))
    XCTAssertFalse(encoded.contains("candidatePath"))
    XCTAssertFalse(encoded.contains("WorkflowRuntimeStore"))
  }

  func testAllowedBuiltinNamesDoNotAuthorizePackageAddons() async {
    let input = AddonExecutionInput(
      addonName: "chat-reply",
      nodePayload: ["message": .string("spoof")],
      source: .init(packageName: "third-party", addonName: "chat-reply", sourcePath: "addons/chat-reply", builtin: false)
    )

    let result = await DeterministicAddonResolver().resolve(.init(input: input, allowedBuiltins: ["chat-reply"]))

    guard case let .failed(diagnostics) = result else {
      return XCTFail("expected package add-on with built-in name to require an injected resolver")
    }
    XCTAssertEqual(diagnostics.first?.code, "UNKNOWN_ADDON")
  }
}
