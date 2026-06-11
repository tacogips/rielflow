// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "rielflow",
  platforms: [
    .macOS(.v14)
  ],
  products: [
    .library(name: "RielflowCore", targets: ["RielflowCore"]),
    .library(name: "RielflowAddons", targets: ["RielflowAddons"]),
    .library(name: "RielflowAdapters", targets: ["RielflowAdapters"]),
    .library(name: "RielflowEvents", targets: ["RielflowEvents"]),
    .library(name: "RielflowGraphQL", targets: ["RielflowGraphQL"]),
    .library(name: "RielflowServer", targets: ["RielflowServer"]),
    .library(name: "RielflowHook", targets: ["RielflowHook"]),
    .library(name: "CodexAgent", targets: ["CodexAgent"]),
    .library(name: "ClaudeCodeAgent", targets: ["ClaudeCodeAgent"]),
    .library(name: "CursorCLIAgent", targets: ["CursorCLIAgent"]),
    .executable(name: "rielflow", targets: ["RielflowCLI"])
  ],
  targets: [
    .target(name: "RielflowCore"),
    .target(name: "RielflowAddons", dependencies: ["RielflowCore"]),
    .target(name: "RielflowEvents", dependencies: ["RielflowCore"]),
    .target(name: "RielflowGraphQL", dependencies: ["RielflowCore"]),
    .target(name: "RielflowServer", dependencies: ["RielflowCore", "RielflowGraphQL"]),
    .target(name: "RielflowHook", dependencies: ["RielflowCore"]),
    .target(name: "CodexAgent", dependencies: ["RielflowCore", "RielflowAdapters"]),
    .target(name: "ClaudeCodeAgent", dependencies: ["RielflowCore", "RielflowAdapters"]),
    .target(name: "CursorCLIAgent", dependencies: ["RielflowCore", "RielflowAdapters"]),
    .target(
      name: "RielflowAdapters",
      dependencies: ["RielflowCore"]
    ),
    .executableTarget(
      name: "RielflowCLI",
      dependencies: [
        "RielflowCore",
        "RielflowAdapters",
        "RielflowAddons",
        "RielflowEvents",
        "RielflowGraphQL",
        "RielflowServer",
        "RielflowHook",
        "CodexAgent",
        "ClaudeCodeAgent",
        "CursorCLIAgent"
      ]
    ),
    .testTarget(name: "RielflowCoreTests", dependencies: ["RielflowCore"]),
    .testTarget(name: "RielflowAdaptersTests", dependencies: ["RielflowCore", "RielflowAdapters"]),
    .testTarget(
      name: "AgentAdapterTests",
      dependencies: ["RielflowCore", "RielflowAdapters", "CodexAgent", "ClaudeCodeAgent", "CursorCLIAgent"]
    )
  ],
  swiftLanguageModes: [.v6]
)
