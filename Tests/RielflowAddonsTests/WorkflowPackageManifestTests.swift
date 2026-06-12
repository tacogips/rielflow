import Foundation
import XCTest
@testable import RielflowAddons
@testable import RielflowCore

final class WorkflowPackageManifestTests: XCTestCase {
  func testManifestDecodesWithWorkflowDefaultAndDeterministicValidation() throws {
    let data = Data("""
    {
      "name": "@scope/sample_package",
      "version": "1.0.0",
      "description": "Sample workflow package",
      "tags": ["sample"],
      "registry": "default",
      "checksum": "abc123",
      "checksumAlgorithm": "md5",
      "authors": ["Rielflow"],
      "license": "MIT",
      "repository": "https://example.invalid/repo.git",
      "examples": ["examples/sample"],
      "minimumRielflowVersion": "0.1.0",
      "backends": ["codex-agent"],
      "workflowDirectory": "workflows/main",
      "skills": [{"vendor": "codex", "name": "use-package", "sourcePath": "skills/use-package/SKILL.md"}],
      "dependencies": ["string-dependency", {"packageId": "shared-package", "kind": "workflow"}],
      "addons": [{"name": "reply", "version": "1.0.0", "sourcePath": "addons/reply", "execution": {"kind": "declarative"}}]
    }
    """.utf8)

    let manifest = try JSONDecoder().decode(WorkflowPackageManifest.self, from: data)

    XCTAssertEqual(manifest.kind, .workflow)
    XCTAssertEqual(manifest.registry, "default")
    XCTAssertEqual(manifest.checksumAlgorithm, "md5")
    XCTAssertEqual(manifest.dependencies.first?.packageId, "string-dependency")
    XCTAssertEqual(manifest.backends, ["codex-agent"])
    XCTAssertEqual(manifest.nodeAddons.first?.execution?.kind, .declarative)
    XCTAssertEqual(WorkflowPackageManifestValidator.validate(manifest), [])
  }

  func testManifestRejectsUnknownTopLevelKeys() {
    let data = Data(#"{"name":"sample","unsupported":true}"#.utf8)

    XCTAssertThrowsError(try JSONDecoder().decode(WorkflowPackageManifest.self, from: data)) { error in
      XCTAssertTrue(String(describing: error).contains("unsupported key"))
    }
  }

  func testManifestRejectsUnknownNestedKeys() {
    let dependencyData = Data(#"{"name":"sample","dependencies":[{"packageId":"other","unsupported":true}]}"#.utf8)
    let addonData = Data(#"{"name":"sample","addons":[{"name":"reply","version":"1.0.0","sourcePath":"addons/reply","unsupported":true}]}"#.utf8)
    let capabilityData = Data(#"{"name":"sample","addons":[{"name":"reply","version":"1.0.0","sourcePath":"addons/reply","capabilities":[{"name":"network","unsupported":true}]}]}"#.utf8)
    let skillData = Data(#"{"name":"sample","skills":[{"vendor":"codex","name":"skill","sourcePath":"skills/skill/SKILL.md","unsupported":true}]}"#.utf8)
    let workflowData = Data(#"{"name":"sample","workflow":{"description":"sample","unsupported":true}}"#.utf8)
    let integrityData = Data(#"{"name":"sample","integrity":{"digest":"abc","unsupported":true}}"#.utf8)

    XCTAssertThrowsError(try JSONDecoder().decode(WorkflowPackageManifest.self, from: dependencyData))
    XCTAssertThrowsError(try JSONDecoder().decode(WorkflowPackageManifest.self, from: addonData))
    XCTAssertThrowsError(try JSONDecoder().decode(WorkflowPackageManifest.self, from: capabilityData))
    XCTAssertThrowsError(try JSONDecoder().decode(WorkflowPackageManifest.self, from: skillData))
    XCTAssertThrowsError(try JSONDecoder().decode(WorkflowPackageManifest.self, from: workflowData))
    XCTAssertThrowsError(try JSONDecoder().decode(WorkflowPackageManifest.self, from: integrityData))
  }

  func testManifestValidationRequiresDecodedTagsAndRejectsEmptyTags() throws {
    let missingTagsData = Data("""
    {
      "name": "workflow-package",
      "version": "1.0.0",
      "description": "Workflow package",
      "registry": "default",
      "checksum": "abc123",
      "checksumAlgorithm": "md5"
    }
    """.utf8)
    let emptyTagData = Data("""
    {
      "name": "workflow-package",
      "version": "1.0.0",
      "description": "Workflow package",
      "tags": ["valid", ""],
      "registry": "default",
      "checksum": "abc123",
      "checksumAlgorithm": "md5",
      "workflow": {"description": "Workflow metadata", "tags": [""]}
    }
    """.utf8)

    let missingTagsManifest = try JSONDecoder().decode(WorkflowPackageManifest.self, from: missingTagsData)
    let emptyTagManifest = try JSONDecoder().decode(WorkflowPackageManifest.self, from: emptyTagData)

    XCTAssertTrue(WorkflowPackageManifestValidator.validate(missingTagsManifest).contains { $0.path == "tags" })
    let emptyTagIssues = WorkflowPackageManifestValidator.validate(emptyTagManifest)
    XCTAssertTrue(emptyTagIssues.contains { $0.path == "tags[1]" })
    XCTAssertTrue(emptyTagIssues.contains { $0.path == "workflow.tags[0]" })
  }

  func testManifestDecodingRejectsNullTags() {
    let topLevelNullTags = Data("""
    {
      "name": "workflow-package",
      "version": "1.0.0",
      "description": "Workflow package",
      "tags": null,
      "registry": "default",
      "checksum": "abc123",
      "checksumAlgorithm": "md5"
    }
    """.utf8)
    let workflowNullTags = Data("""
    {
      "name": "workflow-package",
      "version": "1.0.0",
      "description": "Workflow package",
      "tags": [],
      "registry": "default",
      "checksum": "abc123",
      "checksumAlgorithm": "md5",
      "workflow": {"description": "Workflow metadata", "tags": null}
    }
    """.utf8)

    XCTAssertThrowsError(try JSONDecoder().decode(WorkflowPackageManifest.self, from: topLevelNullTags))
    XCTAssertThrowsError(try JSONDecoder().decode(WorkflowPackageManifest.self, from: workflowNullTags))
  }

  func testManifestValidationRejectsUnsafeNamesPathsAndAddonLocks() {
    let manifest = WorkflowPackageManifest(
      name: "BadName",
      version: nil,
      description: nil,
      registry: nil,
      checksum: nil,
      checksumAlgorithm: "sha1",
      workflowDirectory: "../outside",
      nodeAddons: [.init(name: "", version: "", sourcePath: "/absolute")],
      skills: [.init(vendor: .codex, name: "", sourcePath: "")],
      dependencies: [.init(packageId: "BadName", kind: .nodeAddon)]
    )

    let issues = WorkflowPackageManifestValidator.validate(manifest)

    XCTAssertEqual(issues.map(\.code), Array(repeating: "INVALID_MANIFEST", count: issues.count))
    XCTAssertTrue(issues.map(\.path).contains("name"))
    XCTAssertTrue(issues.map(\.path).contains("version"))
    XCTAssertTrue(issues.map(\.path).contains("checksumAlgorithm"))
    XCTAssertTrue(issues.map(\.path).contains("workflowDirectory"))
    XCTAssertTrue(issues.map(\.path).contains("dependencies[0].addons"))
  }

  func testNodeAddonManifestValidationRequiresAddonsAndExecutableSafetyMetadata() {
    let executableAddon = WorkflowPackageNodeAddon(
      name: "runner",
      version: "1.0.0",
      sourcePath: "addons/runner",
      execution: .init(kind: .localCommand, entrypoint: "run.sh"),
      capabilities: [],
      contentDigest: nil
    )
    let manifest = WorkflowPackageManifest(
      name: "addon-package",
      version: "1.0.0",
      kind: .nodeAddon,
      description: "Add-on package",
      tags: [],
      registry: "default",
      checksum: "abc123",
      checksumAlgorithm: "md5",
      workflow: .init(description: "must not be present"),
      workflowDirectory: ".",
      nodeAddons: [executableAddon]
    )

    let issues = WorkflowPackageManifestValidator.validate(manifest)

    XCTAssertTrue(issues.map(\.path).contains("workflow"))
    XCTAssertTrue(issues.map(\.path).contains("addons[0].capabilities"))
    XCTAssertTrue(issues.map(\.path).contains("addons[0].contentDigest"))
  }

  func testAddonCapabilityValidationCoversNamesPoliciesSensitiveReasonsDuplicatesAndGrants() {
    let duplicateReadCapability = WorkflowAddonCapability(name: "filesystem.read", scope: "repo")
    let executableAddon = WorkflowPackageNodeAddon(
      name: "runner",
      version: "1.0.0",
      sourcePath: "addons/runner",
      execution: .init(kind: .localCommand, entrypoint: "run.sh"),
      capabilities: [
        .init(name: "network.egress"),
        .init(name: "filesystem.read", scope: "repo", defaultPolicy: "ask"),
        duplicateReadCapability,
        duplicateReadCapability,
        .init(name: "unknown.capability", reason: "unsupported")
      ],
      contentDigest: "sha256:\(String(repeating: "a", count: 64))"
    )
    let dependency = WorkflowPackageDependency(
      packageId: "addon-package",
      kind: .nodeAddon,
      addons: [
        .init(
          name: "runner",
          version: "1.0.0",
          capabilityGrant: [
            "process.spawn": .init(allowed: true, scope: "commands/*"),
            "unknown.capability": .init(allowed: true)
          ]
        )
      ]
    )
    let manifest = WorkflowPackageManifest(
      name: "workflow-package",
      version: "1.0.0",
      description: "Workflow package",
      registry: "default",
      checksum: "abc123",
      checksumAlgorithm: "md5",
      nodeAddons: [executableAddon],
      dependencies: [dependency]
    )

    let issues = WorkflowPackageManifestValidator.validate(manifest)

    XCTAssertTrue(issues.contains { $0.path == "addons[0].capabilities[0].reason" })
    XCTAssertTrue(issues.contains { $0.path == "addons[0].capabilities[1].defaultPolicy" })
    XCTAssertTrue(issues.contains { $0.path == "addons[0].capabilities[3]" })
    XCTAssertTrue(issues.contains { $0.path == "addons[0].capabilities[4].name" })
    XCTAssertTrue(issues.contains { $0.path == "dependencies[0].addons[0].capabilityGrant.process.spawn.scope" })
    XCTAssertTrue(issues.contains { $0.path == "dependencies[0].addons[0].capabilityGrant" })
  }

  func testAddonManifestValidationRejectsUnsafeAddonSourceAndExecutionArtifactPaths() {
    let manifest = validManifest(nodeAddons: [
      .init(name: "dot-source", version: "1.0.0", sourcePath: ".", execution: .init(kind: .declarative)),
      .init(name: "traversal-source", version: "1.0.0", sourcePath: "addons/../runner", execution: .init(kind: .declarative)),
      .init(
        name: "bad-entrypoint",
        version: "1.0.0",
        sourcePath: "addons/bad-entrypoint",
        execution: .init(kind: .localCommand, entrypoint: "../run.sh"),
        capabilities: [.init(name: "process.spawn", reason: "runs package command")],
        contentDigest: "sha256:\(String(repeating: "b", count: 64))"
      ),
      .init(
        name: "bad-containerfile",
        version: "1.0.0",
        sourcePath: "addons/bad-containerfile",
        execution: .init(kind: .container, containerfilePath: "."),
        capabilities: [.init(name: "container.run", reason: "runs package container")],
        contentDigest: "sha256:\(String(repeating: "c", count: 64))"
      )
    ])

    let issues = WorkflowPackageManifestValidator.validate(manifest)

    XCTAssertTrue(issues.contains { $0.path == "addons[0].sourcePath" })
    XCTAssertTrue(issues.contains { $0.path == "addons[1].sourcePath" })
    XCTAssertTrue(issues.contains { $0.path == "addons[2].execution.entrypoint" })
    XCTAssertTrue(issues.contains { $0.path == "addons[3].execution.containerfilePath" })
  }

  func testAddonManifestValidationRejectsMissingExecutableArtifactsAndDeclarativeArtifacts() {
    let manifest = validManifest(nodeAddons: [
      .init(
        name: "missing-artifact",
        version: "1.0.0",
        sourcePath: "addons/missing-artifact",
        execution: .init(kind: .localCommand),
        capabilities: [.init(name: "process.spawn", reason: "runs package command")],
        contentDigest: "sha256:\(String(repeating: "d", count: 64))"
      ),
      .init(
        name: "declarative-artifact",
        version: "1.0.0",
        sourcePath: "addons/declarative-artifact",
        execution: .init(kind: .declarative, entrypoint: "run.sh")
      )
    ])

    let issues = WorkflowPackageManifestValidator.validate(manifest)

    XCTAssertTrue(issues.contains { $0.path == "addons[0].execution" && $0.message.contains("entrypoint or containerfilePath") })
    XCTAssertTrue(issues.contains { $0.path == "addons[1].execution" && $0.message.contains("must not declare executable artifacts") })
  }

  func testLoaderValidationRequiresWorkflowJsonAtWorkflowDirectory() async throws {
    let packageRoot = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: packageRoot) }
    let workflowDirectory = packageRoot.appendingPathComponent("workflows/main", isDirectory: true)
    try FileManager.default.createDirectory(at: workflowDirectory, withIntermediateDirectories: true)
    let manifest = WorkflowPackageManifest(
      name: "workflow-package",
      version: "1.0.0",
      description: "Workflow package",
      registry: "default",
      checksum: "abc123",
      checksumAlgorithm: "md5",
      workflowDirectory: "workflows/main"
    )
    let loader = FileWorkflowPackageManifestLoader()

    let missingIssues = await loader.validate(manifest, packageRoot: packageRoot)

    XCTAssertTrue(missingIssues.contains { $0.code == "MISSING_WORKFLOW_BUNDLE" && $0.path == "workflowDirectory" })

    try Data(#"{"nodes":[]}"#.utf8).write(to: workflowDirectory.appendingPathComponent("workflow.json", isDirectory: false))
    let presentIssues = await loader.validate(manifest, packageRoot: packageRoot)

    XCTAssertFalse(presentIssues.contains { $0.code == "MISSING_WORKFLOW_BUNDLE" })
  }

  func testLoaderRejectsNonFileManifestURLsBeforeReading() async {
    let loader = FileWorkflowPackageManifestLoader()
    let url = URL(string: "https://example.invalid/rielflow-package.json")!

    do {
      _ = try await loader.loadManifest(from: url)
      XCTFail("expected non-file URL rejection")
    } catch WorkflowPackageManifestLoadingError.nonFileURL(let value) {
      XCTAssertEqual(value, "https://example.invalid/rielflow-package.json")
    } catch {
      XCTFail("unexpected error: \(error)")
    }
  }

  func testRelativePathNormalizerFailsClosed() {
    XCTAssertEqual(WorkflowPackageManifestValidator.normalizePackageRelativePath("."), ".")
    XCTAssertEqual(WorkflowPackageManifestValidator.normalizePackageRelativePath("a/./b"), "a/b")
    XCTAssertNil(WorkflowPackageManifestValidator.normalizePackageRelativePath(""))
    XCTAssertNil(WorkflowPackageManifestValidator.normalizePackageRelativePath("a/.."))
    XCTAssertNil(WorkflowPackageManifestValidator.normalizePackageRelativePath("a/../b"))
    XCTAssertNil(WorkflowPackageManifestValidator.normalizePackageRelativePath("../secret"))
    XCTAssertNil(WorkflowPackageManifestValidator.normalizePackageRelativePath("/tmp/package"))
    XCTAssertNil(WorkflowPackageManifestValidator.normalizePackageRelativePath("C:\\temp\\package"))
    XCTAssertNil(WorkflowPackageManifestValidator.normalizePackageRelativePath("\\\\server\\share"))
  }

  func testManifestValidationRejectsWindowsAbsoluteDirectories() {
    let manifest = WorkflowPackageManifest(
      name: "workflow-package",
      version: "1.0.0",
      description: "Workflow package",
      tags: [],
      registry: "default",
      checksum: "abc123",
      checksumAlgorithm: "md5",
      workflowDirectory: "C:\\temp\\package",
      skillDirectory: "\\\\server\\share"
    )

    let issues = WorkflowPackageManifestValidator.validate(manifest)

    XCTAssertTrue(issues.contains { $0.path == "workflowDirectory" })
    XCTAssertTrue(issues.contains { $0.path == "skillDirectory" })
  }

  private func validManifest(nodeAddons: [WorkflowPackageNodeAddon]) -> WorkflowPackageManifest {
    WorkflowPackageManifest(
      name: "workflow-package",
      version: "1.0.0",
      description: "Workflow package",
      registry: "default",
      checksum: "abc123",
      checksumAlgorithm: "md5",
      nodeAddons: nodeAddons
    )
  }

  private func temporaryDirectory() -> URL {
    FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
  }
}
