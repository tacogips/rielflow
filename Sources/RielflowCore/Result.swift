public enum RielflowResult<Success: Sendable, Failure: Error & Sendable>: Sendable {
  case success(Success)
  case failure(Failure)

  public var value: Success? {
    switch self {
    case let .success(value):
      value
    case .failure:
      nil
    }
  }

  public var error: Failure? {
    switch self {
    case .success:
      nil
    case let .failure(error):
      error
    }
  }
}
