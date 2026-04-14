{

  description = "no";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/release-24.11";
    nixpkgs-unstable.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      nixpkgs-unstable,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        pkgs-unstable = import nixpkgs-unstable { inherit system; };

        devPackages = with pkgs; [
          # Bun runtime
          pkgs-unstable.bun

          # Real Node.js runtime for repository tooling
          nodejs_22

          # TypeScript tooling
          pkgs-unstable.typescript
          pkgs-unstable.typescript-language-server
          nodePackages.prettier

          # Development tools
          fd
          gnused
          gh
          go-task
          podman

        ];

        divedraCli = pkgs.writeShellApplication {
          name = "divedra";
          runtimeInputs = devPackages;
          text = ''
            set -euo pipefail

            source_dir="${self}"
            cache_root="''${XDG_CACHE_HOME:-$HOME/.cache}/divedra/nix"
            runtime_root="$cache_root/$(basename "$source_dir")"
            runtime_src="$runtime_root/src"
            ready_file="$runtime_root/.bun-ready"

            mkdir -p "$cache_root"

            if [ ! -f "$ready_file" ]; then
              rm -rf "$runtime_root"
              mkdir -p "$runtime_src"
              cp -R "$source_dir"/. "$runtime_src"
              chmod -R u+w "$runtime_root"
              (
                cd "$runtime_src"
                bun install --frozen-lockfile
              )
              touch "$ready_file"
            fi

            cd "$runtime_src"
            exec bun run src/main.ts "$@"
          '';
          meta = {
            description = "TypeScript/Bun workflow runtime for cooperative multi-agent execution";
            homepage = "https://github.com/tacogips/divedra";
            mainProgram = "divedra";
            license = pkgs.lib.licenses.mit;
            platforms = pkgs.lib.platforms.unix;
          };
        };

      in
      {
        packages.default = divedraCli;

        packages.dev-tools = pkgs.buildEnv {
          name = "divedra-dev-tools";
          paths = devPackages;
          pathsToLink = [ "/bin" ];
        };

        apps.default = {
          type = "app";
          program = "${divedraCli}/bin/divedra";
        };

        devShells.default = pkgs.mkShell {
          packages = devPackages;

          shellHook = ''
            # Dev-only: fixed root data dir for this checkout (production default is ~/.divedra/project/<cwd-encoded>/divedra-artifact).
            export DIVEDRA_ARTIFACT_DIR="/tmp/divedra-artifact-dev"
            echo "TypeScript development environment ready"
            echo "Bun version: $(bun --version)"
            echo "TypeScript version: $(tsc --version)"
            echo "Task version: $(task --version 2>/dev/null || echo 'not available')"
          '';
        };
      }
    );
}
