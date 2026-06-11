import Foundation
import RielflowCore

public typealias NodeAdapterFactory = @Sendable () async throws -> any NodeAdapter
public typealias NodeAdapterRegistry = [NodeExecutionBackend: NodeAdapterFactory]

public actor DispatchingNodeAdapter: NodeAdapter {
  private let registry: NodeAdapterRegistry
  private var adapters: [NodeExecutionBackend: any NodeAdapter] = [:]

  public init(registry: NodeAdapterRegistry) {
    self.registry = registry
  }

  public func execute(_ input: AdapterExecutionInput, context: AdapterExecutionContext) async throws -> AdapterExecutionOutput {
    let backend = try resolveNodeExecutionBackend(input.node)
    let adapter = try await loadAdapter(for: backend)
    return try await adapter.execute(input, context: context)
  }

  private func loadAdapter(for backend: NodeExecutionBackend) async throws -> any NodeAdapter {
    if let adapter = adapters[backend] {
      return adapter
    }
    guard let factory = registry[backend] else {
      throw AdapterExecutionError(.providerError, "node execution backend '\(backend.rawValue)' has no registered adapter")
    }
    let adapter = try await factory()
    adapters[backend] = adapter
    return adapter
  }
}
