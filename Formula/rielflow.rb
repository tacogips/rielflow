class Rielflow < Formula
  desc "TypeScript/Bun workflow runtime for cooperative multi-agent execution"
  homepage "https://github.com/tacogips/rielflow"
  version "0.1.4"
  license "MIT"

  livecheck do
    url :stable
    strategy :github_latest
  end

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/tacogips/rielflow/releases/download/v0.1.4/rielflow-0.1.4-darwin-arm64.tar.gz"
      sha256 "61f86586f3973c5ffcee085e16b5a0c245b5fc9bea9d5d34400436fb6ffecda6"
    else
      url "https://github.com/tacogips/rielflow/releases/download/v0.1.4/rielflow-0.1.4-darwin-x64.tar.gz"
      sha256 "129504b9cdab8ac88c373c75546fde100df1d3c53b3c96440c62aca51786c125"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/tacogips/rielflow/releases/download/v0.1.4/rielflow-0.1.4-linux-arm64.tar.gz"
      sha256 "cae9f0bb291f0ad0b010646ecc258e60bdfdd887c1d515eb2db4c3ab2ead1cc1"
    else
      url "https://github.com/tacogips/rielflow/releases/download/v0.1.4/rielflow-0.1.4-linux-x64.tar.gz"
      sha256 "4b44700913395ad715fcfe11c0bfb5774dfae838c49f0c689aceb1d9dc4926c2"
    end
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
          "maxLoopIterations": 1,
          "nodeTimeoutMs": 60000
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
    assert_match '"workflowId": "addon-smoke"', usage
  end
end
