import Foundation
import RielflowCore
#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif
#if canImport(Security)
import Security
#endif

public struct NativeBundleAddonExport: Codable, Equatable, Sendable {
  public var addonName: String
  public var version: String

  public init(addonName: String, version: String) {
    self.addonName = addonName
    self.version = version
  }
}

public struct NativeBundleAddonDescriptor: Codable, Equatable, Sendable {
  public var abiVersion: Int
  public var bundleIdentifier: String
  public var exports: [NativeBundleAddonExport]

  public init(abiVersion: Int, bundleIdentifier: String, exports: [NativeBundleAddonExport]) {
    self.abiVersion = abiVersion
    self.bundleIdentifier = bundleIdentifier
    self.exports = exports
  }
}

public struct NativeBundleCodeSignatureRequirement: Codable, Equatable, Sendable {
  public var requirement: String

  public init(_ requirement: String) {
    self.requirement = requirement
  }
}

public struct NativeBundleCacheKey: Hashable, Sendable {
  public var sourceScope: String
  public var packageName: String
  public var packageInstallId: String
  public var addonName: String
  public var addonVersion: String?
  public var bundleIdentifier: String
  public var abiVersion: Int
  public var contentDigest: String
  public var dependencyClosureDigest: String
  public var signingRequirementDigest: String

  public init(
    sourceScope: String,
    packageName: String,
    packageInstallId: String,
    addonName: String,
    addonVersion: String?,
    bundleIdentifier: String,
    abiVersion: Int,
    contentDigest: String,
    dependencyClosureDigest: String,
    signingRequirementDigest: String
  ) {
    self.sourceScope = sourceScope
    self.packageName = packageName
    self.packageInstallId = packageInstallId
    self.addonName = addonName
    self.addonVersion = addonVersion
    self.bundleIdentifier = bundleIdentifier
    self.abiVersion = abiVersion
    self.contentDigest = contentDigest
    self.dependencyClosureDigest = dependencyClosureDigest
    self.signingRequirementDigest = signingRequirementDigest
  }

  public init(bundleIdentifier: String, contentDigest: String) {
    self.init(
      sourceScope: "",
      packageName: "",
      packageInstallId: "",
      addonName: "",
      addonVersion: nil,
      bundleIdentifier: bundleIdentifier,
      abiVersion: 1,
      contentDigest: contentDigest,
      dependencyClosureDigest: "",
      signingRequirementDigest: ""
    )
  }
}

public struct NativeBundleInvocationOptions: Codable, Equatable, Sendable {
  public var boundary: AddonExecutionBoundary
  public var timeoutSeconds: Int?
  public var allowCandidatePayload: Bool
  public var allowDispatchIntents: Bool

  public init(
    boundary: AddonExecutionBoundary = .async,
    timeoutSeconds: Int? = nil,
    allowCandidatePayload: Bool = true,
    allowDispatchIntents: Bool = false
  ) {
    self.boundary = boundary
    self.timeoutSeconds = timeoutSeconds
    self.allowCandidatePayload = allowCandidatePayload
    self.allowDispatchIntents = allowDispatchIntents
  }
}

public struct NativeBundleInvocationEnvelope: Codable, Equatable, Sendable {
  public var addonName: String
  public var version: String?
  public var nodePayload: JSONObject
  public var source: AddonSourceMetadata
  public var options: NativeBundleInvocationOptions

  public init(
    addonName: String,
    version: String? = nil,
    nodePayload: JSONObject,
    source: AddonSourceMetadata,
    options: NativeBundleInvocationOptions = .init()
  ) {
    self.addonName = addonName
    self.version = version
    self.nodePayload = nodePayload
    self.source = source
    self.options = options
  }
}

public typealias NativeBundleDescriptorSymbol = @Sendable @convention(c) () -> UnsafeMutablePointer<CChar>?
public typealias NativeBundleExecuteSymbol = @Sendable @convention(c) (UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>?
public typealias NativeBundleFreeSymbol = @Sendable @convention(c) (UnsafeMutablePointer<CChar>?) -> Void

public struct NativeBundlePluginSymbols: Sendable {
  public var descriptor: NativeBundleDescriptorSymbol
  public var execute: NativeBundleExecuteSymbol
  public var free: NativeBundleFreeSymbol

  public init(
    descriptor: @escaping NativeBundleDescriptorSymbol,
    execute: @escaping NativeBundleExecuteSymbol,
    free: @escaping NativeBundleFreeSymbol
  ) {
    self.descriptor = descriptor
    self.execute = execute
    self.free = free
  }
}

public enum NativeBundlePluginSymbolNames {
  public static let descriptor = "rielflow_plugin_descriptor_v1"
  public static let execute = "rielflow_plugin_execute_v1"
  public static let free = "rielflow_plugin_free_v1"
}

public protocol NativeBundlePluginHandle: Sendable {
  func loadDescriptor() async throws -> NativeBundleAddonDescriptor
  func execute(_ envelope: NativeBundleInvocationEnvelope) async throws -> AddonExecutionOutput
}

public protocol NativeBundlePluginLoading: Sendable {
  func loadPlugin(for registration: NativeBundleAddonRegistration) async throws -> any NativeBundlePluginHandle
}

public protocol NativeBundleInstallSnapshotValidating: Sendable {
  func validateSnapshot(for registration: NativeBundleAddonRegistration) throws
}

public struct NativeBundleStaticInstallSnapshotValidator: NativeBundleInstallSnapshotValidating {
  public init() {}

  public func validateSnapshot(for registration: NativeBundleAddonRegistration) throws {
    guard registration.bundleURL.isFileURL else {
      throw NativeBundleAddonContractError.loadFailed("native-bundle '\(registration.addonName)' must resolve to a file URL")
    }
    guard !registration.packageInstallId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      throw NativeBundleAddonContractError.loadFailed("native-bundle '\(registration.addonName)' is missing install snapshot identity")
    }
    guard isValidSHA256Digest(registration.contentDigest) else {
      throw NativeBundleAddonContractError.loadFailed("native-bundle '\(registration.addonName)' has invalid content digest")
    }
    guard isValidSHA256Digest(registration.dependencyClosureDigest) else {
      throw NativeBundleAddonContractError.loadFailed("native-bundle '\(registration.addonName)' has invalid dependency closure digest")
    }
    if let signingDigest = registration.codeSignatureRequirementDigest, !isValidSHA256Digest(signingDigest) {
      throw NativeBundleAddonContractError.loadFailed("native-bundle '\(registration.addonName)' has invalid code signature requirement digest")
    }
    if registration.codeSignatureRequirement != nil, registration.codeSignatureRequirementDigest == nil {
      throw NativeBundleAddonContractError.loadFailed("native-bundle '\(registration.addonName)' is missing code signature requirement digest")
    }
    if registration.codeSignatureRequirement == nil, registration.codeSignatureRequirementDigest != nil {
      throw NativeBundleAddonContractError.loadFailed("native-bundle '\(registration.addonName)' has a code signature requirement digest without a requirement")
    }
    guard isSafeBundleIdentifier(registration.bundleIdentifier) else {
      throw NativeBundleAddonContractError.loadFailed("native-bundle '\(registration.addonName)' has invalid bundle identifier")
    }
    guard registration.abiVersion == 1 else {
      throw NativeBundleAddonContractError.loadFailed("native-bundle '\(registration.addonName)' has unsupported ABI version \(registration.abiVersion)")
    }
    guard FileManager.default.fileExists(atPath: registration.bundleURL.path) else {
      throw NativeBundleAddonContractError.loadFailed("native-bundle snapshot disappeared before load: \(registration.bundleURL.path)")
    }
  }
}

public protocol NativeBundleCodeSignatureVerifying: Sendable {
  func verifyBundle(at url: URL, requirement: NativeBundleCodeSignatureRequirement?) throws
}

public struct NativeBundleSecurityCodeSignatureVerifier: NativeBundleCodeSignatureVerifying {
  public init() {}

  public func verifyBundle(at url: URL, requirement: NativeBundleCodeSignatureRequirement?) throws {
    let requirementText = requirement?.requirement.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard !requirementText.isEmpty else {
      throw NativeBundleAddonContractError.loadFailed("native-bundle at \(url.path) is missing code signature requirement")
    }

#if canImport(Security)
    var staticCode: SecStaticCode?
    let staticCodeStatus = SecStaticCodeCreateWithPath(url as CFURL, SecCSFlags(), &staticCode)
    guard staticCodeStatus == errSecSuccess, let staticCode else {
      throw NativeBundleAddonContractError.loadFailed("failed to create static code for native-bundle at \(url.path): \(securityErrorMessage(staticCodeStatus))")
    }

    var secRequirement: SecRequirement?
    let requirementStatus = SecRequirementCreateWithString(requirementText as CFString, SecCSFlags(), &secRequirement)
    guard requirementStatus == errSecSuccess, let secRequirement else {
      throw NativeBundleAddonContractError.loadFailed("invalid native-bundle code signature requirement for \(url.path): \(securityErrorMessage(requirementStatus))")
    }

    let checkStatus = SecStaticCodeCheckValidity(staticCode, SecCSFlags(), secRequirement)
    guard checkStatus == errSecSuccess else {
      throw NativeBundleAddonContractError.loadFailed("native-bundle code signature did not satisfy requirement for \(url.path): \(securityErrorMessage(checkStatus))")
    }
#else
    throw NativeBundleAddonContractError.loadFailed("native-bundle code signature verification is unsupported on this platform")
#endif
  }
}

public actor NativeBundleLoadedPluginCache {
  private var handles: [NativeBundleCacheKey: any NativeBundlePluginHandle] = [:]

  public init() {}

  public func handle(for key: NativeBundleCacheKey) -> (any NativeBundlePluginHandle)? {
    handles[key]
  }

  public func store(_ handle: any NativeBundlePluginHandle, for key: NativeBundleCacheKey) {
    handles[key] = handle
  }
}

public struct NativeBundleCachedPluginLoader: NativeBundlePluginLoading {
  private let base: any NativeBundlePluginLoading
  private let cache: NativeBundleLoadedPluginCache

  public init(base: any NativeBundlePluginLoading, cache: NativeBundleLoadedPluginCache = NativeBundleLoadedPluginCache()) {
    self.base = base
    self.cache = cache
  }

  public func loadPlugin(for registration: NativeBundleAddonRegistration) async throws -> any NativeBundlePluginHandle {
    let key = registration.cacheKey
    if let cached = await cache.handle(for: key) {
      return cached
    }
    let handle = try await base.loadPlugin(for: registration)
    await cache.store(handle, for: key)
    return handle
  }
}

public protocol NativeBundleDynamicLibraryOpening: Sendable {
  func openLibrary(at url: URL) throws -> any NativeBundleDynamicLibrarySymbolResolving
}

public protocol NativeBundleDynamicLibrarySymbolResolving: Sendable {
  func symbol(named name: String) -> UnsafeMutableRawPointer?
}

public struct NativeBundleDynamicLibraryPluginLoader: NativeBundlePluginLoading {
  private let opener: any NativeBundleDynamicLibraryOpening
  private let snapshotValidator: any NativeBundleInstallSnapshotValidating
  private let codeSignatureVerifier: any NativeBundleCodeSignatureVerifying
  private let maxCStringBytes: Int

  public init(
    opener: any NativeBundleDynamicLibraryOpening = NativeBundleDLOpener(),
    snapshotValidator: any NativeBundleInstallSnapshotValidating = NativeBundleStaticInstallSnapshotValidator(),
    codeSignatureVerifier: any NativeBundleCodeSignatureVerifying = NativeBundleSecurityCodeSignatureVerifier(),
    maxCStringBytes: Int = NativeBundleCABIPluginHandle.defaultMaxCStringBytes
  ) {
    self.opener = opener
    self.snapshotValidator = snapshotValidator
    self.codeSignatureVerifier = codeSignatureVerifier
    self.maxCStringBytes = maxCStringBytes
  }

  public func loadPlugin(for registration: NativeBundleAddonRegistration) async throws -> any NativeBundlePluginHandle {
    try snapshotValidator.validateSnapshot(for: registration)
    try codeSignatureVerifier.verifyBundle(
      at: registration.bundleURL,
      requirement: registration.codeSignatureRequirement
    )
    let library = try opener.openLibrary(at: registration.bundleURL)
    guard let descriptor = library.symbol(named: NativeBundlePluginSymbolNames.descriptor) else {
      throw NativeBundleAddonContractError.loadFailed("native-bundle '\(registration.addonName)' is missing symbol \(NativeBundlePluginSymbolNames.descriptor)")
    }
    guard let execute = library.symbol(named: NativeBundlePluginSymbolNames.execute) else {
      throw NativeBundleAddonContractError.loadFailed("native-bundle '\(registration.addonName)' is missing symbol \(NativeBundlePluginSymbolNames.execute)")
    }
    guard let free = library.symbol(named: NativeBundlePluginSymbolNames.free) else {
      throw NativeBundleAddonContractError.loadFailed("native-bundle '\(registration.addonName)' is missing symbol \(NativeBundlePluginSymbolNames.free)")
    }

    return NativeBundleCABIPluginHandle(
      symbols: NativeBundlePluginSymbols(
        descriptor: unsafeBitCast(descriptor, to: NativeBundleDescriptorSymbol.self),
        execute: unsafeBitCast(execute, to: NativeBundleExecuteSymbol.self),
        free: unsafeBitCast(free, to: NativeBundleFreeSymbol.self)
      ),
      library: library,
      maxCStringBytes: maxCStringBytes
    )
  }
}

#if canImport(Security)
private func securityErrorMessage(_ status: OSStatus) -> String {
  if let message = SecCopyErrorMessageString(status, nil) as String? {
    return message
  }
  return "OSStatus \(status)"
}
#endif

public struct NativeBundleDLOpener: NativeBundleDynamicLibraryOpening {
  public init() {}

  public func openLibrary(at url: URL) throws -> any NativeBundleDynamicLibrarySymbolResolving {
#if canImport(Darwin) || canImport(Glibc)
    guard let handle = dlopen(url.path, RTLD_NOW | RTLD_LOCAL) else {
      let message = dlerror().map { String(cString: $0) } ?? "unknown dlopen failure"
      throw NativeBundleAddonContractError.loadFailed("failed to open native-bundle at \(url.path): \(message)")
    }
    return NativeBundleDLOpenedLibrary(handle: handle)
#else
    throw NativeBundleAddonContractError.loadFailed("native-bundle dynamic loading is unsupported on this platform")
#endif
  }
}

#if canImport(Darwin) || canImport(Glibc)
private final class NativeBundleDLOpenedLibrary: NativeBundleDynamicLibrarySymbolResolving, @unchecked Sendable {
  private let handle: UnsafeMutableRawPointer

  init(handle: UnsafeMutableRawPointer) {
    self.handle = handle
  }

  func symbol(named name: String) -> UnsafeMutableRawPointer? {
    dlsym(handle, name)
  }

  deinit {
    dlclose(handle)
  }
}
#endif

public struct NativeBundleCABIPluginHandle: NativeBundlePluginHandle {
  public static let defaultMaxCStringBytes = 16 * 1024 * 1024

  private let symbols: NativeBundlePluginSymbols
  private let library: (any NativeBundleDynamicLibrarySymbolResolving)?
  private let maxCStringBytes: Int

  public init(
    symbols: NativeBundlePluginSymbols,
    library: (any NativeBundleDynamicLibrarySymbolResolving)? = nil,
    maxCStringBytes: Int = Self.defaultMaxCStringBytes
  ) {
    self.symbols = symbols
    self.library = library
    self.maxCStringBytes = max(0, maxCStringBytes)
  }

  public func loadDescriptor() async throws -> NativeBundleAddonDescriptor {
    guard let pointer = symbols.descriptor() else {
      throw NativeBundleAddonContractError.invalidDescriptor("descriptor symbol returned null")
    }
    let descriptorText: String
    do {
      descriptorText = try copyReturnedCString(
        pointer,
        free: symbols.free,
        maxBytes: maxCStringBytes,
        context: "descriptor"
      )
    } catch let error as NativeBundleAddonContractError {
      throw NativeBundleAddonContractError.invalidDescriptor(error.message)
    }
    guard let data = descriptorText.data(using: .utf8) else {
      throw NativeBundleAddonContractError.invalidDescriptor("descriptor JSON was not UTF-8")
    }
    do {
      return try JSONDecoder().decode(NativeBundleAddonDescriptor.self, from: data)
    } catch {
      throw NativeBundleAddonContractError.invalidDescriptor("descriptor JSON was malformed: \(error.localizedDescription)")
    }
  }

  public func execute(_ envelope: NativeBundleInvocationEnvelope) async throws -> AddonExecutionOutput {
    let inputData: Data
    do {
      inputData = try JSONEncoder().encode(envelope)
    } catch {
      throw NativeBundleAddonContractError.executionFailed("failed to encode native-bundle invocation envelope: \(error.localizedDescription)")
    }

    let outputText: String = try inputData.withUnsafeBytes { rawBuffer in
      var bytes = Array(rawBuffer.bindMemory(to: UInt8.self))
      bytes.append(0)
      return try bytes.withUnsafeBufferPointer { buffer in
        guard let baseAddress = buffer.baseAddress else {
          throw NativeBundleAddonContractError.executionFailed("failed to encode native-bundle invocation envelope")
        }
        let inputPointer = UnsafeRawPointer(baseAddress).assumingMemoryBound(to: CChar.self)
        guard let outputPointer = symbols.execute(inputPointer) else {
          throw NativeBundleAddonContractError.executionFailed("execute symbol returned null")
        }
        return try copyReturnedCString(
          outputPointer,
          free: symbols.free,
          maxBytes: maxCStringBytes,
          context: "execute output"
        )
      }
    }

    guard let outputData = outputText.data(using: .utf8) else {
      throw NativeBundleAddonContractError.executionFailed("execute output JSON was not UTF-8")
    }
    do {
      return try JSONDecoder().decode(AddonExecutionOutput.self, from: outputData)
    } catch {
      throw NativeBundleAddonContractError.executionFailed("execute output JSON was malformed: \(error.localizedDescription)")
    }
  }
}

public enum NativeBundleAddonContractError: Error, Equatable, Sendable {
  case loadFailed(String)
  case invalidDescriptor(String)
  case executionFailed(String)

  public var message: String {
    switch self {
    case let .loadFailed(message), let .invalidDescriptor(message), let .executionFailed(message):
      message
    }
  }
}

private func copyReturnedCString(
  _ pointer: UnsafeMutablePointer<CChar>,
  free: NativeBundleFreeSymbol,
  maxBytes: Int,
  context: String
) throws -> String {
  defer {
    free(pointer)
  }

  var bytes: [UInt8] = []
  bytes.reserveCapacity(min(maxBytes, 4096))
  for offset in 0...maxBytes {
    let byte = pointer.advanced(by: offset).pointee
    if byte == 0 {
      guard let string = String(bytes: bytes, encoding: .utf8) else {
        throw NativeBundleAddonContractError.executionFailed("\(context) was not valid UTF-8")
      }
      return string
    }
    if offset == maxBytes {
      throw NativeBundleAddonContractError.executionFailed("\(context) exceeded \(maxBytes) bytes or was missing a NUL terminator")
    }
    bytes.append(UInt8(bitPattern: byte))
  }

  throw NativeBundleAddonContractError.executionFailed("\(context) exceeded \(maxBytes) bytes or was missing a NUL terminator")
}

private func isValidSHA256Digest(_ digest: String) -> Bool {
  digest.range(of: #"^sha256:[0-9a-f]{64}$"#, options: .regularExpression) != nil
}

private func isSafeBundleIdentifier(_ identifier: String) -> Bool {
  let pattern = #"^[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z][A-Za-z0-9-]*){2,}$"#
  return identifier.range(of: pattern, options: .regularExpression) != nil
}
