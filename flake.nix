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
          podman

        ];

        devOnlyPackages = with pkgs; [
          gitleaks
        ];

        rielflowCli = pkgs.writeShellApplication {
          name = "rielflow";
          runtimeInputs = runtimePackages;
          text = ''
            set -euo pipefail

            invocation_cwd="$PWD"
            source_dir="${self}"
            cache_root="''${XDG_CACHE_HOME:-$HOME/.cache}/rielflow/nix"
            source_key="''${source_dir##*/}"
            runtime_root="$cache_root/$source_key"
            runtime_src="$runtime_root/src"
            ready_file="$runtime_root/.bun-ready"
            source_file="$runtime_root/.source-path"

            cached_source=""
            if [ -f "$source_file" ]; then
              IFS= read -r cached_source < "$source_file" || cached_source=""
            fi

            mkdir -p "$cache_root"

            if [ ! -f "$ready_file" ] || [ "$cached_source" != "$source_dir" ]; then
              if [ -d "$runtime_root" ]; then
                chmod -R u+w "$runtime_root" 2>/dev/null || true
              fi
              rm -rf "$runtime_root"
              mkdir -p "$runtime_src"
              cp -R "$source_dir"/. "$runtime_src"
              chmod -R u+w "$runtime_root"
              (
                cd "$runtime_src"
                bun install --frozen-lockfile
              )
              printf '%s\n' "$source_dir" > "$source_file"
              touch "$ready_file"
            fi

            cd "$invocation_cwd"
            exec bun run "$runtime_src/packages/rielflow/src/bin.ts" "$@"
          '';
          meta = {
            description = "TypeScript/Bun workflow runtime for cooperative multi-agent execution";
            homepage = "https://github.com/tacogips/rielflow";
            mainProgram = "rielflow";
            license = pkgs.lib.licenses.mit;
            platforms = pkgs.lib.platforms.unix;
          };
        };

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

        devPackages = runtimePackages ++ devOnlyPackages ++ [ rielflowCli ] ++ preCommitCheck.enabledPackages;

      in
      {
        packages.default = rielflowCli;

        packages.dev-tools = pkgs.buildEnv {
          name = "rielflow-dev-tools";
          paths = devPackages;
          pathsToLink = [ "/bin" ];
        };

        apps.default = {
          type = "app";
          program = "${rielflowCli}/bin/rielflow";
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
          '';
        };
      }
    );
}
