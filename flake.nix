{

  description = "no";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/release-24.11";
    nixpkgs-unstable.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    git-hooks.url = "github:cachix/git-hooks.nix";
  };

  outputs =
    {
      self,
      nixpkgs,
      nixpkgs-unstable,
      flake-utils,
      git-hooks,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        pkgs-unstable = import nixpkgs-unstable { inherit system; };
        lib = pkgs.lib;
        runtimePackages = with pkgs; [
          # Bun runtime
          pkgs-unstable.bun

          # Real Node.js runtime for repository tooling
          nodejs_22

          # TypeScript tooling
          pkgs-unstable.typescript
          pkgs-unstable.typescript-language-server

          # Rust-based JS/TS linter used by repository lint tasks.
          pkgs-unstable.biome

          # Development tools
          fd
          gnused
          gh
          go-task

        ] ++ lib.optionals pkgs.stdenv.isLinux [
          podman
          podman-compose

        ];

        devOnlyPackages = with pkgs; [
          gitleaks
        ];

        preCommitCheck = git-hooks.lib.${system}.run {
          src = ./.;
          hooks = {
            gitleaks = {
              enable = true;
              name = "gitleaks";
              entry = "${pkgs.lib.getExe pkgs.gitleaks} git --pre-commit --redact --staged --verbose";
              language = "system";
              pass_filenames = false;
            };
          };
        };

        devPackages = runtimePackages ++ devOnlyPackages ++ preCommitCheck.enabledPackages;

      in
      {
        packages.dev-tools = pkgs.buildEnv {
          name = "rielflow-dev-tools";
          paths = devPackages;
          pathsToLink = [ "/bin" ];
        };

        checks.pre-commit-check = preCommitCheck;

        devShells.default = pkgs.mkShell {
          packages = devPackages;

          shellHook = ''
            # Dev-only: fixed root data dir for this checkout (production default is ~/.rielflow/project/<cwd-encoded>/rielflow-artifact).
            export RIEL_ARTIFACT_DIR="/tmp/rielflow-artifact-dev"
            ${preCommitCheck.shellHook}

            echo "TypeScript development environment ready"
            echo "Bun version: $(bun --version)"
            echo "TypeScript version: $(tsc --version)"
            echo "Biome version: $(biome --version 2>/dev/null || echo 'not available')"
            echo "Task version: $(task --version 2>/dev/null || echo 'not available')"
            echo "Gitleaks version: $(gitleaks version 2>/dev/null || echo 'not available')"
            ${lib.optionalString pkgs.stdenv.isLinux ''
            echo "Podman version: $(podman --version 2>/dev/null || echo 'not available')"
            echo "Podman Compose version: $(podman-compose --version 2>/dev/null || echo 'not available')"
            ''}
          '';
        };
      }
    );
}
