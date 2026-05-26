class Rielflow < Formula
  desc "TypeScript/Bun workflow runtime for cooperative multi-agent execution"
  homepage "https://github.com/tacogips/rielflow"
  version "0.1.0"
  license "MIT"

  livecheck do
    url :stable
    strategy :github_latest
  end

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/tacogips/rielflow/releases/download/v0.1.0/rielflow-0.1.0-darwin-arm64.tar.gz"
      sha256 "411823e1e3fb32d7d4377991b35682b3c482cc11f3010e008d55f67b984db860"
    else
      url "https://github.com/tacogips/rielflow/releases/download/v0.1.0/rielflow-0.1.0-darwin-x64.tar.gz"
      sha256 "a82bce12d2310e207f33026c17b8f60859c0401717f21fb109605963a484a30b"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/tacogips/rielflow/releases/download/v0.1.0/rielflow-0.1.0-linux-arm64.tar.gz"
      sha256 "8dae57c84bd16863932af2480c3996bad3388e8cdf63170e63728484cce7392f"
    else
      url "https://github.com/tacogips/rielflow/releases/download/v0.1.0/rielflow-0.1.0-linux-x64.tar.gz"
      sha256 "ca84064c91a32276cfc45b25b98bcf2425f8e96c646b383de8abfaead228da01"
    end
  end

  def install
    bin.install "bin/rielflow"
  end

  test do
    assert_match "Usage:", shell_output("#{bin}/rielflow --help")
  end
end
