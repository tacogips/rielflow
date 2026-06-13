import Foundation
import XCTest
@testable import RielflowAddons
@testable import RielflowCore

private let nativeBundleCStringRegistry = NativeBundleCStringRegistry()

private func nativeBundleDescriptorSymbol() -> UnsafeMutablePointer<CChar>? {
  nativeBundleCStringRegistry.takeDescriptorPointer()
}

private func nativeBundleExecuteSymbol(_ input: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>? {
  nativeBundleCStringRegistry.takeExecutePointer(input: input)
}

private func nativeBundleFreeSymbol(_ pointer: UnsafeMutablePointer<CChar>?) {
  nativeBundleCStringRegistry.free(pointer)
}

final class NativeBundleAddonContractsTests: XCTestCase {
  func testInvocationEnvelopeEncodingExcludesWorkflowPrivateFields() throws {
    let envelope = NativeBundleInvocationEnvelope(
      addonName: "native-runner",
      version: "1.0.0",
      nodePayload: ["prompt": .string("hello")],
      source: .init(packageName: "native-addon-package", addonName: "native-runner", sourcePath: "addons/native-runner"),
      options: .init(allowDispatchIntents: true)
    )

    let data = try JSONEncoder().encode(envelope)
    let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    let options = try XCTUnwrap(object["options"] as? [String: Any])

    XCTAssertNil(object["variables"])
    XCTAssertNil(object["communicationId"])
    XCTAssertNil(object["candidatePath"])
    XCTAssertEqual(options["allowDispatchIntents"] as? Bool, true)
  }

  func testDescriptorRoundTripPreservesAbiAndExports() throws {
    let descriptor = NativeBundleAddonDescriptor(
      abiVersion: 1,
      bundleIdentifier: "com.example.rielflow.NativeRunner",
      exports: [.init(addonName: "native-runner", version: "1.0.0")]
    )

    let decoded = try JSONDecoder().decode(NativeBundleAddonDescriptor.self, from: JSONEncoder().encode(descriptor))

    XCTAssertEqual(decoded, descriptor)
  }

  func testCABIHandleCopiesDescriptorAndExecuteOutputAndFreesReturnedStrings() async throws {
    let descriptor = NativeBundleAddonDescriptor(
      abiVersion: 1,
      bundleIdentifier: "com.example.rielflow.NativeRunner",
      exports: [.init(addonName: "native-runner", version: "1.0.0")]
    )
    let output = AddonExecutionOutput(candidatePayload: ["status": .string("ok")])
    nativeBundleCStringRegistry.reset(
      descriptorPointer: allocatedCString(try jsonString(descriptor)),
      executePointer: allocatedCString(try jsonString(output))
    )
    let handle = NativeBundleCABIPluginHandle(symbols: testSymbols(), maxCStringBytes: 4096)

    let loadedDescriptor = try await handle.loadDescriptor()
    let loadedOutput = try await handle.execute(envelope())

    XCTAssertEqual(loadedDescriptor, descriptor)
    XCTAssertEqual(loadedOutput, output)
    XCTAssertEqual(nativeBundleCStringRegistry.freedCount(), 2)
    let executeInputs = nativeBundleCStringRegistry.executeInputs()
    let executeInput = try XCTUnwrap(executeInputs.first)
    XCTAssertTrue(executeInput.contains(#""addonName":"native-runner""#))
    XCTAssertFalse(executeInput.contains("variables"))
  }

  func testCABIHandleFreesMalformedDescriptorJSON() async {
    nativeBundleCStringRegistry.reset(
      descriptorPointer: allocatedCString("{"),
      executePointer: nil
    )
    let handle = NativeBundleCABIPluginHandle(symbols: testSymbols(), maxCStringBytes: 4096)

    await XCTAssertThrowsErrorAsync(try await handle.loadDescriptor()) { error in
      guard case let .invalidDescriptor(message) = error as? NativeBundleAddonContractError else {
        return XCTFail("expected invalidDescriptor")
      }
      XCTAssertTrue(message.hasPrefix("descriptor JSON was malformed"))
    }
    XCTAssertEqual(nativeBundleCStringRegistry.freedCount(), 1)
  }

  func testCABIHandleFreesDescriptorWhenNULTerminatorIsMissingWithinLimit() async {
    nativeBundleCStringRegistry.reset(
      descriptorPointer: allocatedBytes([65, 65, 65]),
      executePointer: nil
    )
    let handle = NativeBundleCABIPluginHandle(symbols: testSymbols(), maxCStringBytes: 2)

    await XCTAssertThrowsErrorAsync(try await handle.loadDescriptor()) { error in
      XCTAssertEqual(
        error as? NativeBundleAddonContractError,
        .invalidDescriptor("descriptor exceeded 2 bytes or was missing a NUL terminator")
      )
    }
    XCTAssertEqual(nativeBundleCStringRegistry.freedCount(), 1)
  }

  func testCABIHandleFreesMalformedExecuteOutputJSON() async throws {
    let descriptor = NativeBundleAddonDescriptor(
      abiVersion: 1,
      bundleIdentifier: "com.example.rielflow.NativeRunner",
      exports: [.init(addonName: "native-runner", version: "1.0.0")]
    )
    nativeBundleCStringRegistry.reset(
      descriptorPointer: allocatedCString(try jsonString(descriptor)),
      executePointer: allocatedCString("[")
    )
    let handle = NativeBundleCABIPluginHandle(symbols: testSymbols(), maxCStringBytes: 4096)

    _ = try await handle.loadDescriptor()
    await XCTAssertThrowsErrorAsync(try await handle.execute(envelope())) { error in
      guard case let .executionFailed(message) = error as? NativeBundleAddonContractError else {
        return XCTFail("expected executionFailed")
      }
      XCTAssertTrue(message.contains("execute output JSON was malformed"))
    }
    XCTAssertEqual(nativeBundleCStringRegistry.freedCount(), 2)
  }

  func testDynamicLibraryLoaderBuildsCABIHandleFromRequiredSymbols() async throws {
    let descriptor = NativeBundleAddonDescriptor(
      abiVersion: 1,
      bundleIdentifier: "com.example.rielflow.NativeRunner",
      exports: [.init(addonName: "native-runner", version: "1.0.0")]
    )
    let output = AddonExecutionOutput(candidatePayload: ["status": .string("dynamic-ok")])
    nativeBundleCStringRegistry.reset(
      descriptorPointer: allocatedCString(try jsonString(descriptor)),
      executePointer: allocatedCString(try jsonString(output))
    )
    let opener = FakeDynamicLibraryOpener(symbols: [
      NativeBundlePluginSymbolNames.descriptor: symbolPointer(nativeBundleDescriptorSymbol as NativeBundleDescriptorSymbol),
      NativeBundlePluginSymbolNames.execute: symbolPointer(nativeBundleExecuteSymbol as NativeBundleExecuteSymbol),
      NativeBundlePluginSymbolNames.free: symbolPointer(nativeBundleFreeSymbol as NativeBundleFreeSymbol),
    ])
    let snapshotValidator = FakeInstallSnapshotValidator()
    let verifier = FakeCodeSignatureVerifier()
    let loader = NativeBundleDynamicLibraryPluginLoader(
      opener: opener,
      snapshotValidator: snapshotValidator,
      codeSignatureVerifier: verifier,
      maxCStringBytes: 4096
    )

    let handle = try await loader.loadPlugin(for: registration())
    let loadedDescriptor = try await handle.loadDescriptor()
    let loadedOutput = try await handle.execute(envelope())

    XCTAssertEqual(loadedDescriptor, descriptor)
    XCTAssertEqual(loadedOutput, output)
    XCTAssertEqual(opener.openedURLs(), [registration().bundleURL])
    XCTAssertEqual(snapshotValidator.validatedKeys(), [registration().cacheKey])
    XCTAssertEqual(verifier.verifiedRequirements(), ["identifier \"com.example.rielflow.NativeRunner\""])
    XCTAssertEqual(nativeBundleCStringRegistry.freedCount(), 2)
  }

  func testDynamicLibraryLoaderRejectsMissingRequiredSymbolsBeforeDescriptorCall() async {
    nativeBundleCStringRegistry.reset(
      descriptorPointer: allocatedCString("{\"should\":\"not be consumed\"}"),
      executePointer: nil
    )
    let opener = FakeDynamicLibraryOpener(symbols: [
      NativeBundlePluginSymbolNames.descriptor: symbolPointer(nativeBundleDescriptorSymbol as NativeBundleDescriptorSymbol),
      NativeBundlePluginSymbolNames.execute: symbolPointer(nativeBundleExecuteSymbol as NativeBundleExecuteSymbol),
    ])
    let snapshotValidator = FakeInstallSnapshotValidator()
    let verifier = FakeCodeSignatureVerifier()
    let loader = NativeBundleDynamicLibraryPluginLoader(
      opener: opener,
      snapshotValidator: snapshotValidator,
      codeSignatureVerifier: verifier,
      maxCStringBytes: 4096
    )

    await XCTAssertThrowsErrorAsync(try await loader.loadPlugin(for: registration())) { error in
      XCTAssertEqual(
        error as? NativeBundleAddonContractError,
        .loadFailed("native-bundle 'native-runner' is missing symbol \(NativeBundlePluginSymbolNames.free)")
      )
    }
    XCTAssertEqual(opener.openedURLs(), [registration().bundleURL])
    XCTAssertEqual(snapshotValidator.validatedKeys(), [registration().cacheKey])
    XCTAssertEqual(verifier.verifiedRequirements(), ["identifier \"com.example.rielflow.NativeRunner\""])
    XCTAssertEqual(nativeBundleCStringRegistry.freedCount(), 0)
    let unconsumedDescriptorPointer = nativeBundleCStringRegistry.takeDescriptorPointer()
    XCTAssertNotNil(unconsumedDescriptorPointer)
    nativeBundleCStringRegistry.free(unconsumedDescriptorPointer)
  }

  func testDynamicLibraryLoaderRequiresSignatureBeforeOpeningBundle() async {
    let opener = FakeDynamicLibraryOpener(symbols: [:])
    let snapshotValidator = FakeInstallSnapshotValidator()
    let verifier = FakeCodeSignatureVerifier()
    let loader = NativeBundleDynamicLibraryPluginLoader(
      opener: opener,
      snapshotValidator: snapshotValidator,
      codeSignatureVerifier: verifier,
      maxCStringBytes: 4096
    )

    await XCTAssertThrowsErrorAsync(try await loader.loadPlugin(for: registration(codeSignatureRequirementDigest: nil, codeSignatureRequirement: nil))) { error in
      XCTAssertEqual(
        error as? NativeBundleAddonContractError,
        .loadFailed("native-bundle at /tmp/NativeRunner.bundle is missing code signature requirement")
      )
    }
    XCTAssertEqual(opener.openedURLs(), [])
    XCTAssertEqual(snapshotValidator.validatedKeys(), [registration(codeSignatureRequirementDigest: nil, codeSignatureRequirement: nil).cacheKey])
    XCTAssertEqual(verifier.verifiedRequirements(), [])
  }

  func testDynamicLibraryLoaderRevalidatesSnapshotBeforeSignatureAndOpen() async {
    let opener = FakeDynamicLibraryOpener(symbols: [:])
    let snapshotValidator = FakeInstallSnapshotValidator(error: .loadFailed("native-bundle snapshot is stale"))
    let verifier = FakeCodeSignatureVerifier()
    let loader = NativeBundleDynamicLibraryPluginLoader(
      opener: opener,
      snapshotValidator: snapshotValidator,
      codeSignatureVerifier: verifier,
      maxCStringBytes: 4096
    )

    await XCTAssertThrowsErrorAsync(try await loader.loadPlugin(for: registration())) { error in
      XCTAssertEqual(error as? NativeBundleAddonContractError, .loadFailed("native-bundle snapshot is stale"))
    }
    XCTAssertEqual(snapshotValidator.validatedKeys(), [registration().cacheKey])
    XCTAssertEqual(verifier.verifiedRequirements(), [])
    XCTAssertEqual(opener.openedURLs(), [])
  }

  func testStaticSnapshotValidatorRequiresProductionMetadataAndExistingBundle() {
    let validator = NativeBundleStaticInstallSnapshotValidator()

    XCTAssertThrowsError(try validator.validateSnapshot(for: registration(dependencyClosureDigest: ""))) { error in
      XCTAssertEqual(
        error as? NativeBundleAddonContractError,
        .loadFailed("native-bundle 'native-runner' has invalid dependency closure digest")
      )
    }

    XCTAssertThrowsError(try validator.validateSnapshot(for: registration(codeSignatureRequirementDigest: nil))) { error in
      XCTAssertEqual(
        error as? NativeBundleAddonContractError,
        .loadFailed("native-bundle 'native-runner' is missing code signature requirement digest")
      )
    }

    XCTAssertThrowsError(try validator.validateSnapshot(for: registration(bundleIdentifier: "1.invalid"))) { error in
      XCTAssertEqual(
        error as? NativeBundleAddonContractError,
        .loadFailed("native-bundle 'native-runner' has invalid bundle identifier")
      )
    }

    XCTAssertThrowsError(try validator.validateSnapshot(for: registration())) { error in
      XCTAssertEqual(
        error as? NativeBundleAddonContractError,
        .loadFailed("native-bundle snapshot disappeared before load: /tmp/NativeRunner.bundle")
      )
    }
  }

  func testCachedPluginLoaderKeysLoadedHandlesByInstalledNativeMetadata() async throws {
    let base = CacheTestPluginLoader()
    let loader = NativeBundleCachedPluginLoader(base: base)
    let firstRegistration = registration(
      contentDigest: "sha256:\(String(repeating: "a", count: 64))",
      dependencyClosureDigest: "sha256:\(String(repeating: "b", count: 64))",
      codeSignatureRequirementDigest: "sha256:\(String(repeating: "c", count: 64))"
    )
    let changedDigestRegistration = registration(
      contentDigest: "sha256:\(String(repeating: "d", count: 64))",
      dependencyClosureDigest: "sha256:\(String(repeating: "b", count: 64))",
      codeSignatureRequirementDigest: "sha256:\(String(repeating: "c", count: 64))"
    )

    let firstHandle = try await loader.loadPlugin(for: firstRegistration)
    let cachedHandle = try await loader.loadPlugin(for: firstRegistration)
    let changedDigestHandle = try await loader.loadPlugin(for: changedDigestRegistration)

    XCTAssertEqual((firstHandle as? CacheTestPluginHandle)?.identifier, 1)
    XCTAssertEqual((cachedHandle as? CacheTestPluginHandle)?.identifier, 1)
    XCTAssertEqual((changedDigestHandle as? CacheTestPluginHandle)?.identifier, 2)
    let loadedKeys = await base.loadedKeys()
    XCTAssertEqual(loadedKeys, [firstRegistration.cacheKey, changedDigestRegistration.cacheKey])
    XCTAssertNotEqual(firstRegistration.cacheKey, changedDigestRegistration.cacheKey)
  }

  private func envelope() -> NativeBundleInvocationEnvelope {
    NativeBundleInvocationEnvelope(
      addonName: "native-runner",
      version: "1.0.0",
      nodePayload: ["prompt": .string("hello")],
      source: .init(packageName: "native-addon-package", addonName: "native-runner")
    )
  }

  private func testSymbols() -> NativeBundlePluginSymbols {
    NativeBundlePluginSymbols(
      descriptor: nativeBundleDescriptorSymbol,
      execute: nativeBundleExecuteSymbol,
      free: nativeBundleFreeSymbol
    )
  }

  private func registration(
    contentDigest: String = "sha256:\(String(repeating: "a", count: 64))",
    dependencyClosureDigest: String = "sha256:\(String(repeating: "b", count: 64))",
    codeSignatureRequirementDigest: String? = "sha256:\(String(repeating: "c", count: 64))",
    codeSignatureRequirement: NativeBundleCodeSignatureRequirement? = NativeBundleCodeSignatureRequirement("identifier \"com.example.rielflow.NativeRunner\""),
    bundleIdentifier: String = "com.example.rielflow.NativeRunner"
  ) -> NativeBundleAddonRegistration {
    NativeBundleAddonRegistration(
      packageName: "native-addon-package",
      addonName: "native-runner",
      version: "1.0.0",
      sourceScope: "project",
      packageInstallId: "install-snapshot-1",
      bundleURL: URL(fileURLWithPath: "/tmp/NativeRunner.bundle"),
      bundleIdentifier: bundleIdentifier,
      contentDigest: contentDigest,
      dependencyClosureDigest: dependencyClosureDigest,
      codeSignatureRequirement: codeSignatureRequirement,
      codeSignatureRequirementDigest: codeSignatureRequirementDigest
    )
  }
}

private final class FakeCodeSignatureVerifier: NativeBundleCodeSignatureVerifying, @unchecked Sendable {
  private let lock = NSLock()
  private var requirements: [String] = []

  func verifyBundle(at url: URL, requirement: NativeBundleCodeSignatureRequirement?) throws {
    let requirementText = requirement?.requirement.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard !requirementText.isEmpty else {
      throw NativeBundleAddonContractError.loadFailed("native-bundle at \(url.path) is missing code signature requirement")
    }
    lock.lock()
    requirements.append(requirementText)
    lock.unlock()
  }

  func verifiedRequirements() -> [String] {
    lock.lock()
    defer { lock.unlock() }
    return requirements
  }
}

private final class FakeInstallSnapshotValidator: NativeBundleInstallSnapshotValidating, @unchecked Sendable {
  private let lock = NSLock()
  private let error: NativeBundleAddonContractError?
  private var keys: [NativeBundleCacheKey] = []

  init(error: NativeBundleAddonContractError? = nil) {
    self.error = error
  }

  func validateSnapshot(for registration: NativeBundleAddonRegistration) throws {
    lock.lock()
    keys.append(registration.cacheKey)
    lock.unlock()
    if let error {
      throw error
    }
  }

  func validatedKeys() -> [NativeBundleCacheKey] {
    lock.lock()
    defer { lock.unlock() }
    return keys
  }
}

private actor CacheTestPluginLoader: NativeBundlePluginLoading {
  private var keys: [NativeBundleCacheKey] = []

  func loadPlugin(for registration: NativeBundleAddonRegistration) async throws -> any NativeBundlePluginHandle {
    keys.append(registration.cacheKey)
    return CacheTestPluginHandle(identifier: keys.count)
  }

  func loadedKeys() -> [NativeBundleCacheKey] {
    keys
  }
}

private struct CacheTestPluginHandle: NativeBundlePluginHandle {
  var identifier: Int

  func loadDescriptor() async throws -> NativeBundleAddonDescriptor {
    NativeBundleAddonDescriptor(abiVersion: 1, bundleIdentifier: "com.example.rielflow.NativeRunner", exports: [])
  }

  func execute(_ envelope: NativeBundleInvocationEnvelope) async throws -> AddonExecutionOutput {
    AddonExecutionOutput(candidatePayload: ["identifier": .number(Double(identifier))])
  }
}

private final class FakeDynamicLibraryOpener: NativeBundleDynamicLibraryOpening, @unchecked Sendable {
  private let lock = NSLock()
  private let symbols: [String: UnsafeMutableRawPointer]
  private var urls: [URL] = []

  init(symbols: [String: UnsafeMutableRawPointer]) {
    self.symbols = symbols
  }

  func openLibrary(at url: URL) throws -> any NativeBundleDynamicLibrarySymbolResolving {
    lock.lock()
    urls.append(url)
    lock.unlock()
    return FakeDynamicLibraryHandle(symbols: symbols)
  }

  func openedURLs() -> [URL] {
    lock.lock()
    defer { lock.unlock() }
    return urls
  }
}

private final class FakeDynamicLibraryHandle: NativeBundleDynamicLibrarySymbolResolving, @unchecked Sendable {
  private let symbols: [String: UnsafeMutableRawPointer]

  init(symbols: [String: UnsafeMutableRawPointer]) {
    self.symbols = symbols
  }

  func symbol(named name: String) -> UnsafeMutableRawPointer? {
    symbols[name]
  }
}

private final class NativeBundleCStringRegistry: @unchecked Sendable {
  private let lock = NSLock()
  private var descriptorPointer: UnsafeMutablePointer<CChar>?
  private var executePointer: UnsafeMutablePointer<CChar>?
  private var freedPointers: [UnsafeMutableRawPointer] = []
  private var capturedExecuteInputs: [String] = []

  func reset(descriptorPointer: UnsafeMutablePointer<CChar>?, executePointer: UnsafeMutablePointer<CChar>?) {
    lock.lock()
    self.descriptorPointer = descriptorPointer
    self.executePointer = executePointer
    self.freedPointers = []
    self.capturedExecuteInputs = []
    lock.unlock()
  }

  func takeDescriptorPointer() -> UnsafeMutablePointer<CChar>? {
    lock.lock()
    defer { lock.unlock() }
    let pointer = descriptorPointer
    descriptorPointer = nil
    return pointer
  }

  func takeExecutePointer(input: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>? {
    lock.lock()
    defer { lock.unlock() }
    capturedExecuteInputs.append(String(cString: input))
    let pointer = executePointer
    executePointer = nil
    return pointer
  }

  func free(_ pointer: UnsafeMutablePointer<CChar>?) {
    guard let pointer else {
      return
    }
    lock.lock()
    freedPointers.append(UnsafeMutableRawPointer(pointer))
    lock.unlock()
    pointer.deallocate()
  }

  func freedCount() -> Int {
    lock.lock()
    defer { lock.unlock() }
    return freedPointers.count
  }

  func executeInputs() -> [String] {
    lock.lock()
    defer { lock.unlock() }
    return capturedExecuteInputs
  }
}

private func allocatedCString(_ string: String) -> UnsafeMutablePointer<CChar> {
  allocatedBytes(Array(string.utf8) + [0])
}

private func allocatedBytes(_ bytes: [UInt8]) -> UnsafeMutablePointer<CChar> {
  let pointer = UnsafeMutablePointer<CChar>.allocate(capacity: bytes.count)
  for (index, byte) in bytes.enumerated() {
    pointer.advanced(by: index).initialize(to: CChar(bitPattern: byte))
  }
  return pointer
}

private func jsonString<T: Encodable>(_ value: T) throws -> String {
  let data = try JSONEncoder().encode(value)
  return String(decoding: data, as: UTF8.self)
}

private func symbolPointer<T>(_ symbol: T) -> UnsafeMutableRawPointer {
  unsafeBitCast(symbol, to: UnsafeMutableRawPointer.self)
}

private func XCTAssertThrowsErrorAsync(
  _ expression: @autoclosure () async throws -> some Sendable,
  _ errorHandler: (Error) -> Void,
  file: StaticString = #filePath,
  line: UInt = #line
) async {
  do {
    _ = try await expression()
    XCTFail("expected error", file: file, line: line)
  } catch {
    errorHandler(error)
  }
}
