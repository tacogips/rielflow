import XCTest
@testable import RielflowCLI

final class CommandParsingTests: XCTestCase {
  func testParsesTopLevelHelp() throws {
    XCTAssertEqual(try RielflowArgumentParser().parse(["--help"]), .help)
    XCTAssertEqual(try RielflowArgumentParser().parse(["-h"]), .help)
  }

  func testParsesValidateInspectAndRunOptions() throws {
    let parser = RielflowArgumentParser()

    let validate = try parser.parse([
      "workflow", "validate", "demo",
      "--workflow-definition-dir", "./examples",
      "--scope", "project",
      "--output", "json",
      "--executable",
      "--node-patch", #"{"worker":{"model":"gpt-5"}}"#,
    ])
    XCTAssertEqual(
      validate,
      .workflow(.validate(WorkflowValidateOptions(
        workflowName: "demo",
        resolution: WorkflowResolutionOptions(
          workflowName: "demo",
          scope: .direct,
          workflowDefinitionDir: "./examples",
          workingDirectory: FileManager.default.currentDirectoryPath
        ),
        output: .json,
        executable: true,
        nodePatch: #"{"worker":{"model":"gpt-5"}}"#
      )))
    )

    let inspect = try parser.parse(["workflow", "inspect", "demo", "--structure"])
    if case let .workflow(.inspect(options)) = inspect {
      XCTAssertTrue(options.structure)
      XCTAssertEqual(options.output, .text)
    } else {
      XCTFail("expected inspect command")
    }

    let usage = try parser.parse([
      "workflow", "usage", "demo",
      "--workflow-definition-dir", "./examples",
      "--output", "json",
    ])
    if case let .workflow(.usage(options)) = usage {
      XCTAssertEqual(options.workflowName, "demo")
      XCTAssertEqual(options.resolution.workflowDefinitionDir, "./examples")
      XCTAssertEqual(options.output, .json)
    } else {
      XCTFail("expected usage command")
    }

    let run = try parser.parse([
      "workflow", "run", "demo",
      "--variables", #"{"topic":"swift"}"#,
      "--mock-scenario", "./scenario.json",
      "--max-steps", "2",
      "--output", "json",
    ])
    if case let .workflow(.run(options)) = run {
      XCTAssertEqual(options.variables, #"{"topic":"swift"}"#)
      XCTAssertEqual(options.mockScenarioPath, "./scenario.json")
      XCTAssertEqual(options.maxSteps, 2)
      XCTAssertEqual(options.output, .json)
    } else {
      XCTFail("expected run command")
    }
  }

  func testRejectsUnsupportedRemoteRun() {
    XCTAssertThrowsError(try RielflowArgumentParser().parse([
      "workflow", "run", "demo", "--endpoint", "http://localhost:4000/graphql",
    ])) { error in
      XCTAssertEqual((error as? CLIUsageError)?.message, "Swift TASK-007 supports deterministic local workflow run only")
    }
  }

  func testRejectsEndpointAndRegistryFlagsForValidateAndInspect() {
    XCTAssertThrowsError(try RielflowArgumentParser().parse([
      "workflow", "validate", "demo", "--endpoint", "http://localhost:4000/graphql",
    ])) { error in
      XCTAssertEqual((error as? CLIUsageError)?.message, "Swift TASK-007 supports local workflow validate only")
    }

    XCTAssertThrowsError(try RielflowArgumentParser().parse([
      "workflow", "inspect", "demo", "--from-registry",
    ])) { error in
      XCTAssertEqual((error as? CLIUsageError)?.message, "Swift TASK-007 supports local workflow inspect only")
    }
  }
}
