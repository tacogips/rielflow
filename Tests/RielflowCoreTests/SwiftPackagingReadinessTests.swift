import Foundation
import XCTest
@testable import RielflowCore

final class SwiftPackagingReadinessTests: XCTestCase {
  func testArchivePlanUsesReadinessOnlyNamesAndStagingPaths() {
    let plan = makeSwiftHomebrewReadinessArchivePlan(
      version: "0.1.15",
      target: .darwinArm64
    )

    XCTAssertEqual(plan.executableProduct, "rielflow")
    XCTAssertEqual(
      plan.releaseBinPathCommand,
      swiftHomebrewReadinessReleaseBinPathCommand
    )
    XCTAssertEqual(
      plan.stagedBinaryPath,
      "dist/swift-homebrew/work/rielflow-0.1.15-darwin-arm64/bin/rielflow"
    )
    XCTAssertEqual(
      plan.archivePath,
      "dist/swift-homebrew/rielflow-swift-0.1.15-darwin-arm64.tar.gz"
    )
    XCTAssertEqual(
      plan.checksumPath,
      "dist/swift-homebrew/rielflow-swift-0.1.15-darwin-arm64.tar.gz.sha256"
    )
    XCTAssertFalse(plan.publishSideEffects)
    XCTAssertFalse(plan.archivePath.contains("dist/homebrew/rielflow-0.1.15"))
  }

  func testSupportedTargetsAreMacOSOnlyBeforeCutover() {
    XCTAssertEqual(
      SwiftHomebrewReadinessTarget.allCases.map(\.rawValue),
      ["darwin-arm64", "darwin-x64"]
    )
  }

  func testCutoverGateManifestKeepsProductionCutoverBlocked() throws {
    let rootURL = try repositoryRoot()
    let manifestURL = rootURL.appendingPathComponent("packaging/homebrew/swift-cutover-gates.json")
    let data = try Data(contentsOf: manifestURL)
    let manifest = try JSONDecoder().decode(SwiftCutoverGateManifest.self, from: data)

    XCTAssertEqual(manifest.productionRuntime, "typescript-bun")
    XCTAssertEqual(manifest.swiftArtifactStatus, "cutover-evidence-ready-review-blocked")
    XCTAssertEqual(manifest.swiftReadinessArchiveDirectory, "dist/swift-homebrew")
    XCTAssertEqual(manifest.currentProductionArchiveDirectory, "dist/homebrew")
    XCTAssertEqual(
      manifest.swiftArchiveNames,
      [
        "rielflow-swift-<version>-darwin-arm64.tar.gz",
        "rielflow-swift-<version>-darwin-x64.tar.gz",
      ]
    )
    XCTAssertFalse(manifest.allowsProductionCutover)
    XCTAssertTrue(manifest.gates.count >= 10)
    XCTAssertTrue(manifest.gates.allSatisfy { $0.status == "passed" || $0.status == "blocked" })
    XCTAssertEqual(manifest.gates.filter { $0.id == "task009-adversarial-review" }.map(\.status), ["blocked"])
    XCTAssertTrue(manifest.gates.filter { $0.id != "task009-adversarial-review" }.allSatisfy { $0.status == "passed" })
    XCTAssertTrue(manifest.gates.allSatisfy(\.requiredBeforeCutover))
    XCTAssertTrue(manifest.gates.allSatisfy(\.forbidsProductionMutation))
  }

  func testReadinessScriptDoesNotExecuteProductionPublishingCommands() throws {
    let rootURL = try repositoryRoot()
    let scriptURL = rootURL.appendingPathComponent("scripts/build-swift-homebrew-readiness.sh")
    let script = try String(contentsOf: scriptURL, encoding: .utf8)

    XCTAssertTrue(script.contains("--dry-run"))
    XCTAssertTrue(script.contains("RIEL_SWIFT_RELEASE_DIR"))
    XCTAssertTrue(script.contains("rielflow-swift-$version-$target.tar.gz"))
    XCTAssertFalse(script.contains("gh release"))
    XCTAssertFalse(script.contains("git push"))
    XCTAssertFalse(script.contains("brew tap"))
    XCTAssertFalse(script.contains("render-homebrew-formula"))
    XCTAssertFalse(script.contains("Formula/rielflow.rb"))
  }

  func testReadinessScriptWritesPortableChecksumSidecars() throws {
    let rootURL = try repositoryRoot()
    let scriptURL = rootURL.appendingPathComponent("scripts/build-swift-homebrew-readiness.sh")
    let script = try String(contentsOf: scriptURL, encoding: .utf8)

    XCTAssertTrue(script.contains("base=\"$(basename \"$file\")\""))
    XCTAssertTrue(script.contains("shasum -a 256 \"$base\""))
    XCTAssertTrue(script.contains("sha256sum \"$base\""))
    XCTAssertFalse(script.contains("shasum -a 256 \"$file\""))
    XCTAssertFalse(script.contains("sha256sum \"$file\""))
  }

  func testReadinessScriptRejectsUnsafeVersionBeforePrintingPaths() throws {
    let rootURL = try repositoryRoot()
    let result = try runReadinessScript(
      rootURL: rootURL,
      environment: ["RIEL_VERSION": "x/../../../escape"],
      arguments: ["--dry-run", "darwin-arm64"]
    )

    XCTAssertNotEqual(result.exitCode, 0)
    XCTAssertTrue(result.stderr.contains("unsafe Swift readiness version"))
    XCTAssertFalse(result.stdout.contains("rielflow-x/../../../escape"))
  }

  func testReadinessScriptRejectsReleaseDirectoryTraversal() throws {
    let rootURL = try repositoryRoot()
    let result = try runReadinessScript(
      rootURL: rootURL,
      environment: [
        "RIEL_VERSION": "0.0.0-task008",
        "RIEL_SWIFT_RELEASE_DIR": "../escape",
      ],
      arguments: ["--dry-run", "darwin-arm64"]
    )

    XCTAssertNotEqual(result.exitCode, 0)
    XCTAssertTrue(result.stderr.contains("unsafe Swift readiness release directory"))
  }


  private struct SwiftCutoverGateManifest: Decodable {
    var productionRuntime: String
    var swiftArtifactStatus: String
    var currentProductionArchiveDirectory: String
    var swiftReadinessArchiveDirectory: String
    var swiftArchiveNames: [String]
    var allowsProductionCutover: Bool
    var gates: [SwiftCutoverGate]
  }

  private struct SwiftCutoverGate: Decodable {
    var id: String
    var status: String
    var requiredBeforeCutover: Bool
    var forbidsProductionMutation: Bool
  }

  private struct ScriptResult {
    var exitCode: Int32
    var stdout: String
    var stderr: String
  }

  private func runReadinessScript(
    rootURL: URL,
    environment: [String: String],
    arguments: [String]
  ) throws -> ScriptResult {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/bash")
    process.arguments = [rootURL.appendingPathComponent("scripts/build-swift-homebrew-readiness.sh").path] + arguments
    process.currentDirectoryURL = rootURL
    process.environment = ProcessInfo.processInfo.environment.merging(environment) { _, new in new }

    let stdout = Pipe()
    let stderr = Pipe()
    process.standardOutput = stdout
    process.standardError = stderr

    try process.run()
    process.waitUntilExit()

    return ScriptResult(
      exitCode: process.terminationStatus,
      stdout: String(decoding: stdout.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self),
      stderr: String(decoding: stderr.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
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
    throw NSError(domain: "SwiftPackagingReadinessTests", code: 1, userInfo: [NSLocalizedDescriptionKey: "Package.swift not found"])
  }
}
