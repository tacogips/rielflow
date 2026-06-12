public enum SwiftHomebrewReadinessTarget: String, CaseIterable, Codable, Equatable, Sendable {
  case darwinArm64 = "darwin-arm64"
  case darwinX64 = "darwin-x64"

  public var arch: String {
    switch self {
    case .darwinArm64:
      "arm64"
    case .darwinX64:
      "x64"
    }
  }
}

public struct SwiftHomebrewReadinessArchivePlan: Codable, Equatable, Sendable {
  public var version: String
  public var target: SwiftHomebrewReadinessTarget
  public var executableProduct: String
  public var releaseBinPathCommand: [String]
  public var stagedBinaryPath: String
  public var archivePath: String
  public var checksumPath: String
  public var publishSideEffects: Bool

  public init(
    version: String,
    target: SwiftHomebrewReadinessTarget,
    executableProduct: String,
    releaseBinPathCommand: [String],
    stagedBinaryPath: String,
    archivePath: String,
    checksumPath: String,
    publishSideEffects: Bool
  ) {
    self.version = version
    self.target = target
    self.executableProduct = executableProduct
    self.releaseBinPathCommand = releaseBinPathCommand
    self.stagedBinaryPath = stagedBinaryPath
    self.archivePath = archivePath
    self.checksumPath = checksumPath
    self.publishSideEffects = publishSideEffects
  }
}

public let swiftHomebrewReadinessReleaseBinPathCommand: [String] = [
  "env",
  "DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer",
  "SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk",
  "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift",
  "build",
  "-c",
  "release",
  "--product",
  "rielflow",
  "--show-bin-path",
]

public func makeSwiftHomebrewReadinessArchivePlan(
  version: String,
  target: SwiftHomebrewReadinessTarget,
  releaseDirectory: String = "dist/swift-homebrew"
) -> SwiftHomebrewReadinessArchivePlan {
  let packageName = "rielflow-\(version)-\(target.rawValue)"
  let archivePath = "\(releaseDirectory)/rielflow-swift-\(version)-\(target.rawValue).tar.gz"
  return SwiftHomebrewReadinessArchivePlan(
    version: version,
    target: target,
    executableProduct: "rielflow",
    releaseBinPathCommand: swiftHomebrewReadinessReleaseBinPathCommand,
    stagedBinaryPath: "\(releaseDirectory)/work/\(packageName)/bin/rielflow",
    archivePath: archivePath,
    checksumPath: "\(archivePath).sha256",
    publishSideEffects: false
  )
}
