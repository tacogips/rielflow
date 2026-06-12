class Rielflow < Formula
  desc "Swift-native workflow runtime for cooperative multi-agent execution"
  homepage "https://github.com/tacogips/rielflow"
  version "0.1.15"
  license "MIT"

  livecheck do
    url :stable
    strategy :github_latest
  end

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/tacogips/rielflow/releases/download/v0.1.15/rielflow-0.1.15-darwin-arm64.tar.gz"
      sha256 "08bc9c49e1bae879237b398ef6174045187da1a7eeb70ae2931ef6f23179d224"
    else
      url "https://github.com/tacogips/rielflow/releases/download/v0.1.15/rielflow-0.1.15-darwin-x64.tar.gz"
      sha256 "ac4d3683e5a77a51b0808ab93badcc548b452893ca1ea147f01dcf8715908e40"
    end
  end

  on_linux do
    odie "rielflow Swift Homebrew archives are currently macOS-only; Linux requires a reviewed Swift Linux build contract"
  end

  def install
    bin.install "bin/rielflow"
  end

  test do
    assert_match "Usage:", shell_output("#{bin}/rielflow --help")
    (testpath/"addon-smoke").mkpath
    (testpath/"addon-smoke/workflow.json").write <<~JSON
      {
        "workflowId": "addon-smoke",
        "description": "Smoke workflow that requires built-in add-on package resolution.",
        "defaults": {
          "maxLoopIterations": 3,
          "nodeTimeoutMs": 120000
        },
        "entryStepId": "send-reply",
        "nodes": [
          {
            "id": "send-reply",
            "addon": {
              "name": "rielflow/chat-reply-worker",
              "version": "1",
              "config": {
                "textTemplate": "ok",
                "visibility": "public",
                "threadPolicy": "same-thread",
                "onMissingTarget": "dry-run"
              }
            }
          }
        ],
        "steps": [
          {
            "id": "send-reply",
            "nodeId": "send-reply",
            "role": "worker"
          }
        ]
      }
    JSON
    usage = shell_output(
      "#{bin}/rielflow workflow usage addon-smoke --workflow-definition-dir #{testpath} --output json",
    )
    assert_match '"workflowId":"addon-smoke"', usage
    assert_match %r{rielflow\\?/chat-reply-worker}, usage
  end
end
