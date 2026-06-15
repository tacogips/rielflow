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

  func testProductionArchivePlanUsesHomebrewNamesAndStagingPaths() {
    let arm64 = makeSwiftHomebrewProductionArchivePlan(
      version: "0.1.15",
      target: .darwinArm64
    )
    let x64 = makeSwiftHomebrewProductionArchivePlan(
      version: "0.1.15",
      target: .darwinX64
    )

    XCTAssertEqual(arm64.executableProduct, "rielflow")
    XCTAssertEqual(arm64.releaseDirectory, "dist/homebrew")
    XCTAssertEqual(arm64.target.triple, "arm64-apple-macosx")
    XCTAssertEqual(x64.target.triple, "x86_64-apple-macosx")
    XCTAssertEqual(
      arm64.stagedBinaryPath,
      "dist/homebrew/work/rielflow-0.1.15-darwin-arm64/bin/rielflow"
    )
    XCTAssertEqual(
      arm64.archivePath,
      "dist/homebrew/rielflow-0.1.15-darwin-arm64.tar.gz"
    )
    XCTAssertEqual(
      arm64.checksumPath,
      "dist/homebrew/rielflow-0.1.15-darwin-arm64.tar.gz.sha256"
    )
    XCTAssertEqual(
      x64.archivePath,
      "dist/homebrew/rielflow-0.1.15-darwin-x64.tar.gz"
    )
    XCTAssertFalse(arm64.archivePath.contains("rielflow-swift-"))
    XCTAssertFalse(arm64.publishSideEffects)
    XCTAssertFalse(x64.publishSideEffects)
  }

  func testSupportedProductionTargetsAreMacOSOnly() {
    XCTAssertEqual(
      SwiftHomebrewProductionTarget.allCases.map(\.rawValue),
      ["darwin-arm64", "darwin-x64"]
    )
  }

  func testCutoverGateManifestRecordsProductionCutover() throws {
    let rootURL = try repositoryRoot()
    let manifestURL = rootURL.appendingPathComponent("packaging/homebrew/swift-cutover-gates.json")
    let data = try Data(contentsOf: manifestURL)
    let manifest = try JSONDecoder().decode(SwiftCutoverGateManifest.self, from: data)

    XCTAssertEqual(manifest.productionRuntime, "swift-native")
    XCTAssertEqual(manifest.swiftArtifactStatus, "production-cutover-enabled")
    XCTAssertEqual(manifest.homebrewFormulaSource, "swift-executable-archive")
    XCTAssertEqual(manifest.swiftReadinessArchiveDirectory, "dist/swift-homebrew")
    XCTAssertEqual(manifest.currentProductionArchiveDirectory, "dist/homebrew")
    XCTAssertEqual(
      manifest.swiftArchiveNames,
      [
        "rielflow-swift-<version>-darwin-arm64.tar.gz",
        "rielflow-swift-<version>-darwin-x64.tar.gz",
      ]
    )
    XCTAssertTrue(manifest.allowsProductionCutover)
    XCTAssertEqual(manifest.typeScriptDeletionReadiness?.ready, false)
    XCTAssertEqual(
      manifest.typeScriptDeletionReadiness?.gatePath,
      "packaging/swift-deletion-readiness.json"
    )
    XCTAssertTrue(manifest.gates.count >= 10)
    XCTAssertTrue(manifest.gates.allSatisfy { $0.status == "passed" })
    XCTAssertEqual(manifest.gates.filter { $0.id == "task009-adversarial-review" }.map(\.status), ["passed"])
    XCTAssertTrue(manifest.gates.allSatisfy(\.requiredBeforeCutover))
    XCTAssertTrue(manifest.gates.allSatisfy(\.forbidsProductionMutation))
    XCTAssertEqual(manifest.productionCutoverEvidence?.intendedProductionRuntime, "swift-native")
    XCTAssertEqual(manifest.productionCutoverEvidence?.intendedHomebrewFormulaSource, "swift-executable-archive")
    XCTAssertEqual(manifest.productionCutoverEvidence?.productionArchiveDirectory, "dist/homebrew")
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

  func testProductionBuilderUsesSwiftAndRejectsLinuxTargets() throws {
    let rootURL = try repositoryRoot()
    let scriptURL = rootURL.appendingPathComponent("scripts/build-homebrew-release.sh")
    let script = try String(contentsOf: scriptURL, encoding: .utf8)

    XCTAssertTrue(script.contains("--dry-run"))
    XCTAssertTrue(script.contains("swift build -c release --product rielflow"))
    XCTAssertTrue(script.contains("--triple"))
    XCTAssertTrue(script.contains("rielflow-$version-$target.tar.gz"))
    XCTAssertFalse(script.contains("bun build"))
    XCTAssertFalse(script.contains("--target \"bun-$target\""))
    XCTAssertFalse(script.contains("gh release"))
    XCTAssertFalse(script.contains("git push"))
    XCTAssertFalse(script.contains("brew tap"))

    let result = try runProductionBuilder(
      rootURL: rootURL,
      environment: ["RIEL_VERSION": "0.0.0-cutover"],
      arguments: ["--dry-run", "linux-x64"]
    )
    XCTAssertNotEqual(result.exitCode, 0)
    XCTAssertTrue(result.stderr.contains("unsupported Swift production target"))
  }

  func testProductionBuilderWritesPortableChecksumSidecars() throws {
    let rootURL = try repositoryRoot()
    let scriptURL = rootURL.appendingPathComponent("scripts/build-homebrew-release.sh")
    let script = try String(contentsOf: scriptURL, encoding: .utf8)

    XCTAssertTrue(script.contains("base=\"$(basename \"$file\")\""))
    XCTAssertTrue(script.contains("shasum -a 256 \"$base\""))
    XCTAssertTrue(script.contains("sha256sum \"$base\""))
    XCTAssertFalse(script.contains("shasum -a 256 \"$file\""))
    XCTAssertFalse(script.contains("sha256sum \"$file\""))
  }

  func testFormulaRendererRequiresOnlyMacOSChecksumsAndFailsLinuxClosed() throws {
    let rootURL = try repositoryRoot()
    let scriptURL = rootURL.appendingPathComponent("scripts/render-homebrew-formula.sh")
    let script = try String(contentsOf: scriptURL, encoding: .utf8)

    XCTAssertTrue(script.contains("darwin-arm64"))
    XCTAssertTrue(script.contains("darwin-x64"))
    XCTAssertFalse(script.contains("linux_arm64_sha"))
    XCTAssertFalse(script.contains("linux_x64_sha"))
    XCTAssertFalse(script.contains("rielflow-$version-linux"))
    XCTAssertTrue(script.contains("Swift-native workflow runtime"))
    XCTAssertTrue(script.contains("Swift Homebrew archives are currently macOS-only"))
  }


  private struct SwiftCutoverGateManifest: Decodable {
    var productionRuntime: String
    var swiftArtifactStatus: String
    var homebrewFormulaSource: String
    var currentProductionArchiveDirectory: String
    var swiftReadinessArchiveDirectory: String
    var swiftArchiveNames: [String]
    var allowsProductionCutover: Bool
    var typeScriptDeletionReadiness: SwiftTypeScriptDeletionReadiness?
    var gates: [SwiftCutoverGate]
    var productionCutoverEvidence: SwiftProductionCutoverEvidence?
  }

  private struct SwiftTypeScriptDeletionReadiness: Decodable {
    var ready: Bool
    var gatePath: String
  }

  private struct SwiftCutoverGate: Decodable {
    var id: String
    var status: String
    var requiredBeforeCutover: Bool
    var forbidsProductionMutation: Bool
  }

  private struct SwiftProductionCutoverEvidence: Decodable {
    var intendedProductionRuntime: String
    var intendedHomebrewFormulaSource: String
    var productionArchiveDirectory: String
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

  private func runProductionBuilder(
    rootURL: URL,
    environment: [String: String],
    arguments: [String]
  ) throws -> ScriptResult {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/bash")
    process.arguments = [rootURL.appendingPathComponent("scripts/build-homebrew-release.sh").path] + arguments
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
