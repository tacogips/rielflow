class Rielflow < Formula
  desc "TypeScript/Bun workflow runtime for cooperative multi-agent execution"
  homepage "https://github.com/tacogips/rielflow"
  version "0.1.1"
  license "MIT"

  livecheck do
    url :stable
    strategy :github_latest
  end

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/tacogips/rielflow/releases/download/v0.1.1/rielflow-0.1.1-darwin-arm64.tar.gz"
      sha256 "9d7a75097a53681a9bd77f7a2533dfdb5c9eb48bd541c01c3241793cb43d9ab0"
    else
      url "https://github.com/tacogips/rielflow/releases/download/v0.1.1/rielflow-0.1.1-darwin-x64.tar.gz"
      sha256 "c48a36427a1322c2c06311519413c7be7ef602699de231a46d5757959bd0c781"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/tacogips/rielflow/releases/download/v0.1.1/rielflow-0.1.1-linux-arm64.tar.gz"
      sha256 "03578fd767b3169c0b5b3e3d36866bb1cb7c144a72e93386d9c7f617b3d608cc"
    else
      url "https://github.com/tacogips/rielflow/releases/download/v0.1.1/rielflow-0.1.1-linux-x64.tar.gz"
      sha256 "33c97c312b8ad169ba332238784630a421630474923075e01d483913c573b6aa"
    end
  end

  def install
    bin.install "bin/rielflow"
  end

  test do
    assert_match "Usage:", shell_output("#{bin}/rielflow --help")
  end
end
