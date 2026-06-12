import XCTest
@testable import RielflowCore

final class PromptTemplateTests: XCTestCase {
  func testPromptRenderingMatchesTypeScriptTemplateFixtures() throws {
    let rendered = renderPromptTemplate(
      """
      literal {brace} {{ user.name }} {{missing.path}} {{ flags.enabled }} {{ zero }} {{ array }} {{ object }} {{ nullValue }} {{ escaped }}
      """,
      variables: [
        "user": .object(["name": .string("Ada")]),
        "flags": .object(["enabled": .bool(false)]),
        "zero": .number(0),
        "array": .array([.string("a"), .number(2)]),
        "object": .object(["b": .bool(true), "a": .string("x")]),
        "nullValue": .null,
        "escaped": .string(#"value with \"quoted\" braces {inside}"#),
      ]
    )

    XCTAssertEqual(
      rendered,
      #"literal {brace} Ada  false 0 ["a",2] {"a":"x","b":true}  value with \"quoted\" braces {inside}"#
    )
  }

  func testPromptRenderingLeavesUnsupportedPlaceholderSyntaxLiteral() {
    let rendered = renderPromptTemplate(
      "{{ valid.path }} {{ invalid path }} {{#each items}}",
      variables: ["valid": .object(["path": .string("ok")])]
    )

    XCTAssertEqual(rendered, "ok {{ invalid path }} {{#each items}}")
  }

  func testPromptRenderingFormatsLargeIntegralNumbersWithoutTrapping() {
    let rendered = renderPromptTemplate(
      "{{ total }} {{ decimal }} {{ precise }} {{ exponent }} {{ threshold }} {{ negativeThreshold }} {{ small }} {{ zero }}",
      variables: [
        "total": .number(1.0e20),
        "decimal": .number(0.30000000000000004),
        "precise": .number(1.2345678901234567),
        "exponent": .number(1.0e21),
        "threshold": .number(1.0e-6),
        "negativeThreshold": .number(-1.0e-6),
        "small": .number(1.0e-7),
        "zero": .number(0),
      ]
    )

    XCTAssertEqual(
      rendered,
      "100000000000000000000 0.30000000000000004 1.2345678901234567 1e+21 0.000001 -0.000001 1e-7 0"
    )
  }

  func testPromptRenderingFormatsNestedLargeNumbersLikeTypeScriptJSONStringify() {
    let rendered = renderPromptTemplate(
      "{{ object }} {{ array }}",
      variables: [
        "object": .object([
          "threshold": .number(1.0e-6),
          "total": .number(1.0e20),
          "url": .string("https://example.test/a/b"),
        ]),
        "array": .array([.number(1.0e20), .number(1.0e-6), .string("https://example.test/a/b")]),
      ]
    )

    XCTAssertEqual(
      rendered,
      #"{"threshold":0.000001,"total":100000000000000000000,"url":"https://example.test/a/b"} [100000000000000000000,0.000001,"https://example.test/a/b"]"#
    )
  }

  func testPromptTemplateAssetLoaderHydratesTopLevelAndVariantTemplatesWhilePreservingReferences() throws {
    let root = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    try FileManager.default.createDirectory(at: root.appendingPathComponent("prompts"), withIntermediateDirectories: true)
    try "system".write(to: root.appendingPathComponent("prompts/system.md"), atomically: true, encoding: .utf8)
    try "prompt".write(to: root.appendingPathComponent("prompts/prompt.md"), atomically: true, encoding: .utf8)
    try "start".write(to: root.appendingPathComponent("prompts/start.md"), atomically: true, encoding: .utf8)
    try "review".write(to: root.appendingPathComponent("prompts/review.md"), atomically: true, encoding: .utf8)

    let payload = AgentNodePayload(
      id: "worker",
      executionBackend: .codexAgent,
      model: "gpt-5-nano",
      systemPromptTemplateFile: "prompts/system.md",
      promptTemplateFile: "prompts/prompt.md",
      sessionStartPromptTemplateFile: "prompts/start.md",
      promptVariants: [
        "review": NodePromptVariant(promptTemplateFile: "prompts/review.md")
      ]
    )

    let hydrated = try PromptTemplateAssetLoader().hydrate(payload, workflowDirectory: root)

    XCTAssertEqual(hydrated.systemPromptTemplate, "system")
    XCTAssertEqual(hydrated.promptTemplate, "prompt")
    XCTAssertEqual(hydrated.sessionStartPromptTemplate, "start")
    XCTAssertEqual(hydrated.promptVariants?["review"]?.promptTemplate, "review")
    XCTAssertEqual(hydrated.systemPromptTemplateFile, "prompts/system.md")
    XCTAssertEqual(hydrated.promptTemplateFile, "prompts/prompt.md")
    XCTAssertEqual(hydrated.sessionStartPromptTemplateFile, "prompts/start.md")
    XCTAssertEqual(hydrated.promptVariants?["review"]?.promptTemplateFile, "prompts/review.md")
  }

  func testPromptTemplateAssetLoaderRejectsUnsafeReservedMissingAndUnreadablePaths() throws {
    let root = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    try FileManager.default.createDirectory(at: root.appendingPathComponent("prompts/unreadable.md"), withIntermediateDirectories: true)

    let invalidPaths = [
      "",
      "/tmp/prompt.md",
      "C:\\tmp\\prompt.md",
      ".",
      "prompts/../prompt.md",
      "workflow.json",
      "nodes/node-worker.json",
      "prompts/missing.md",
      "prompts/unreadable.md",
    ]

    for invalidPath in invalidPaths {
      let payload = AgentNodePayload(
        id: "worker",
        executionBackend: .codexAgent,
        model: "gpt-5-nano",
        promptTemplateFile: invalidPath
      )

      XCTAssertThrowsError(try PromptTemplateAssetLoader().hydrate(payload, workflowDirectory: root), "expected rejection for \(invalidPath)") { error in
        guard let loadingError = error as? PromptTemplateAssetLoadingError else {
          XCTFail("unexpected error \(error)")
          return
        }
        XCTAssertEqual(loadingError.diagnostic.path, "node.promptTemplateFile")
        XCTAssertTrue(loadingError.diagnostic.message.contains("promptTemplateFile"))
      }
    }
  }

  private func temporaryDirectory() -> URL {
    FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
  }
}
