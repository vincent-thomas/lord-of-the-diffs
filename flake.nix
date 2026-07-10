{
  description = "pi - AI coding agent CLI";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    pi-mono = {
      url = "github:earendil-works/pi";
      flake = false;
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      pi-mono,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        lib = pkgs.lib;
        nodejs = pkgs.nodejs_24;
        pnpm = pkgs.pnpm_10;

        # ── Token generator for GitHub App auth ──────────────────────────────
        # Reads LOTD_CONFIG_FILE, builds a JWT, exchanges for installation token.
        # Prints just the raw token to stdout.
        lotdToken = pkgs.writeShellScriptBin "lotd-token" ''
          set -eu

          CONFIG=''${LOTD_CONFIG_FILE:-}
          if [ -z "$CONFIG" ] || [ ! -f "$CONFIG" ]; then
            echo "lotd-token: LOTD_CONFIG_FILE not set or file not found: '$CONFIG'" >&2
            exit 1
          fi

          APP_ID=$(${pkgs.jq}/bin/jq -r '.appId' "$CONFIG")
          INSTALL_ID=$(${pkgs.jq}/bin/jq -r '.installId' "$CONFIG")
          KEY_PATH=$(${pkgs.jq}/bin/jq -r '.privateKeyPath' "$CONFIG")

          if [ -z "$APP_ID" ] || [ "$APP_ID" = "null" ] || \
             [ -z "$INSTALL_ID" ] || [ "$INSTALL_ID" = "null" ] || \
             [ -z "$KEY_PATH" ] || [ "$KEY_PATH" = "null" ]; then
            echo "lotd-token: missing or null field(s) in config (need appId, installId, privateKeyPath)" >&2
            exit 1
          fi

          if [ ! -f "$KEY_PATH" ]; then
            echo "lotd-token: private key file not found: $KEY_PATH" >&2
            exit 1
          fi

          # Build RS256 JWT (valid 10 minutes)
          b64() { ${pkgs.coreutils}/bin/base64 -w 0 | tr -d '=' | tr '/+' '_-' ; }
          header=$(printf '{"alg":"RS256","typ":"JWT"}' | b64)
          now=$(date +%s)
          payload=$(printf '{"iat":%d,"exp":%d,"iss":"%s"}' "$now" $((now + 600)) "$APP_ID" | b64)
          signed_input="''${header}.''${payload}"
          sig=$(printf '%s' "$signed_input" | ${pkgs.openssl}/bin/openssl dgst -sha256 -sign "$KEY_PATH" -binary | b64)
          jwt="''${signed_input}.''${sig}"

          # Exchange JWT for installation token
          RESPONSE=$(${pkgs.curl}/bin/curl -s -X POST \
            -H "Authorization: Bearer $jwt" \
            -H "Accept: application/vnd.github+json" \
            -H "User-Agent: vt-pi-agent" \
            "https://api.github.com/app/installations/''${INSTALL_ID}/access_tokens")
          TOKEN=$(printf '%s' "$RESPONSE" | ${pkgs.jq}/bin/jq -r '.token')

          if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
            echo "lotd-token: failed to obtain installation token from GitHub API" >&2
            echo "GitHub response: $RESPONSE" >&2
            exit 1
          fi

          printf '%s' "$TOKEN"
        '';

        # ── Git credential helper (calls lotd-token) ─────────────────────────
        # Git invokes this on-demand; wraps the raw token in credential protocol.
        lotdCredentialHelper = pkgs.writeShellScriptBin "lotd-credential-helper" ''
          set -eu
          printf 'username=x-access-token\npassword=%s\n' "$(${lotdToken}/bin/lotd-token)"
        '';

        # ── Git with credential helper + HTTPS enforcement ──────────────────
        gitconfig = pkgs.writeText "gitconfig" ''
          [credential]
              helper = ${lotdCredentialHelper}/bin/lotd-credential-helper
          [url "https://"]
              insteadOf = git://
          [url "https://github.com/"]
              insteadOf = git@github.com:
              insteadOf = ssh://git@github.com/
        '';

        git = pkgs.writeShellScriptBin "git" ''
          set -eu

          CONFIG=''${LOTD_CONFIG_FILE:-}
          if [ -z "$CONFIG" ]; then
            echo "git: LOTD_CONFIG_FILE not set" >&2
            exit 1
          fi

          LOGIN=$(${pkgs.jq}/bin/jq -r '.login' "$CONFIG")
          if [ -z "$LOGIN" ] || [ "$LOGIN" = "null" ]; then
            echo "git: missing or null 'login' in config" >&2
            exit 1
          fi

          USER_ID=$(${gh}/bin/gh api "/users/$LOGIN" --jq '.id')
          if [ -z "$USER_ID" ] || [ "$USER_ID" = "null" ]; then
            echo "git: failed to get user ID for '$LOGIN'" >&2
            exit 1
          fi

          export GIT_AUTHOR_NAME="$LOGIN"
          export GIT_AUTHOR_EMAIL="$USER_ID+$LOGIN@users.noreply.github.com"
          export GIT_COMMITTER_NAME="$LOGIN"
          export GIT_COMMITTER_EMAIL="$USER_ID+$LOGIN@users.noreply.github.com"
          export GIT_CONFIG_SYSTEM=${gitconfig}

          exec ${pkgs.git}/bin/git "$@"
        '';

        # ── gh wrapper with automated GitHub App auth ────────────────────────
        gh = pkgs.writeShellScriptBin "gh" ''
          set -eu
          export GH_TOKEN=$(${lotdToken}/bin/lotd-token)
          exec ${pkgs.gh}/bin/gh "$@"
        '';

        # ── 1. Base Pi package (upstream, no customizations) ─────────────────────
        piBase = pkgs.buildNpmPackage {
          pname = "pi-coding-agent";
          version = "0.80.3";

          src = pi-mono;

          # Hash covers all npm deps declared in the root package-lock.json.
          # Regenerate with:  nix build 2>&1 | awk '/got:/{print $2}'
          npmDepsHash = "sha256-geh8LH88OZybFXkR/jDeTdew6TNMdFM6jhCSYKn//dU=";

          inherit nodejs;

          # canvas is a dev-only test dep in packages/ai — skip native compilation.
          # tsgo and shx both ship as prebuilt/pure-JS so --ignore-scripts is safe.
          npmFlags = [ "--ignore-scripts" ];

          buildPhase = ''
            runHook preBuild

            # Expose node_modules/.bin (tsgo, shx, …) to npm run scripts.
            export PATH="$PWD/node_modules/.bin:$PATH"

            # packages/ai normally runs two network-fetching generate-* scripts
            # before tsc; strip them — the generated files are pre-committed.
            substituteInPlace packages/ai/package.json \
              --replace "npm run generate-models && npm run generate-image-models && " ""

            # Build all workspaces in order (tui → ai → agent → coding-agent).
            # The root build script also handles chmod and copy-assets for us.
            npm run build

            # ── Post-build npm audit ────────────────────────────────────────
            # Check the full dependency tree for known CVEs. The lockfile pins
            # tarball hashes (npmDepsHash), but a CVE can exist in a hash-verified
            # dependency — only a registry query catches those.
            #
            # Nix's sandbox may block network; if so, skip gracefully.
            echo ""
            echo "--- npm audit ---"
            # Capture exit code via || (works even with shell -e: the ||
            # chain means set -e never kills the build). Exit 0 = no vulns
            # at audit_level, 1 = vulns found, 2+ = error (no network).
            audit_exit=0
            npm audit --audit-level=high --json 2>&1 >/tmp/npm-audit.json || audit_exit=$?
            if [ -f /tmp/npm-audit.json ] && [ -s /tmp/npm-audit.json ]; then
              if [ "$audit_exit" -eq 0 ]; then
                echo "npm audit: no high/critical vulnerabilities"
              elif [ "$audit_exit" -eq 1 ]; then
                HIGH=$(${pkgs.jq}/bin/jq -r '.metadata.vulnerabilities.high // 0' /tmp/npm-audit.json)
                CRITICAL=$(${pkgs.jq}/bin/jq -r '.metadata.vulnerabilities.critical // 0' /tmp/npm-audit.json)
                echo "⚠  npm audit: $HIGH high, $CRITICAL critical vulnerabilities found"
                echo ""
                echo "  Run locally to inspect:  npm audit --audit-level=high"
              fi
            else
              echo "npm audit: registry unreachable (no network in Nix sandbox)"
              echo "  Run locally to check:  npm audit --audit-level=high"
            fi

            runHook postBuild
          '';

          doCheck = false; # Tests run in workspaceDeps derivation

          installPhase = ''
            runHook preInstall

            out_pkg="$out/lib/node_modules/@earendil-works/pi-coding-agent"
            mkdir -p "$out_pkg"

            cp packages/coding-agent/package.json \
               packages/coding-agent/CHANGELOG.md \
               "$out_pkg/"
            cp -r packages/coding-agent/dist \
                  packages/coding-agent/docs \
                  packages/coding-agent/examples \
                  "$out_pkg/"

            # -L dereferences every workspace symlink on copy so $out contains
            # no dangling symlinks and needs no manual fixup.
            cp -rL node_modules "$out_pkg/"

            # Create a simple wrapper (no customizations yet)
            mkdir -p "$out/bin"
            makeWrapper "${nodejs}/bin/node" "$out/bin/pi" \
              --add-flags "$out_pkg/dist/cli.js"

            runHook postInstall
          '';

          nativeBuildInputs = [
            pkgs.makeWrapper
            pkgs.git
          ];

          meta = with pkgs.lib; {
            description = "Base Pi coding agent package (upstream, no customizations)";
            homepage = "https://github.com/badlogic/pi-mono";
            license = licenses.mit;
            mainProgram = "pi";
            platforms = platforms.unix;
          };
        };

        # ── pnpm dependencies for the workspace (real deps like @mariozechner/pi-coding-agent,
        # ── plus the @vt-pi/* workspace links pnpm sets up via shamefully-hoist) ──
        workspaceDeps = pkgs.stdenv.mkDerivation {
          pname = "vt-pi-workspace-deps";
          version = "0.0.0";

          src = ./.;

          # Hash covers all pnpm deps declared in the root pnpm-lock.yaml.
          # Regenerate with:  nix build 2>&1 | awk '/got:/{print $2}'
          pnpmDeps = pkgs.fetchPnpmDeps {
            pname = "vt-pi-workspace-deps";
            version = "0.0.0";
            src = ./.;
            inherit pnpm;
            fetcherVersion = 4;
            hash = "sha256-o/hjmTOxdir4MMvL9Qq6f1pP2OWN+h0GK7q6ksliYRc=";
          };

          # git is needed on PATH for the checkPhase below — several tests
          # (git-commit, fix-ci) shell out to a real `git` binary.
          nativeBuildInputs = [
            nodejs
            pnpm
            pkgs.pnpmConfigHook
            pkgs.git
          ];

          # No build step for these workspace members — just install deps.
          # pnpmConfigHook's `pnpm install` already passes --ignore-scripts,
          # avoiding native compilation for transitive deps (e.g. photon-node),
          # same reasoning as piBase above.
          #
          # dontBuild skips stdenv's generic buildPhase outright, so it never
          # notices this repo's own root Makefile (copied in via `src = ./.`)
          # and runs `make` (which runs `nix build`, recursively — not
          # available inside this derivation's sandbox).
          dontBuild = true;

          # Run the workspace test suite here, where the repo's real
          # layout (root package.json + packages/*) and freshly
          # installed node_modules already match up — no copying needed.
          # --reporter=append-only: pnpm's default reporter redraws its
          # progress tree in place via cursor control, which only works
          # attached to a real TTY. Nix's build sandbox has none, so without
          # this every redraw frame gets captured as its own log line —
          # burying whatever a failing `node --test` actually printed under
          # a wall of near-blank lines.
          doCheck = true;
          checkPhase = ''
            runHook preCheck
            pnpm --reporter=append-only -r test
            runHook postCheck
          '';

          installPhase = ''
            runHook preInstall
            mkdir -p $out

            # @vt-pi/command-policy, @vt-pi/agent-explorer, and
            # @vt-pi/agent-advisor are plain, build-step-free TypeScript
            # everywhere *except* here: Node refuses to type-strip a .ts
            # file whose real path resolves under any node_modules
            # directory, and `pnpm deploy` (below) always materializes
            # workspace dependencies through its node_modules/.pnpm store.
            # Compile them to plain .js first so the deployed tree has no
            # raw .ts sitting inside node_modules.
            pnpm --reporter=append-only -r run build

            # Deploy @vt-pi/agent-lord as a self-contained tree: its own
            # extensions/lib/skills/AGENTS.md alongside a node_modules
            # where every @vt-pi/* dependency (and all real deps like
            # @mariozechner/pi-coding-agent) are fully materialized —
            # no symlinks back into this build's own (different) tree.
            pnpm --reporter=append-only --offline --filter=@vt-pi/agent-lord deploy $out/agent-lord

            runHook postInstall
          '';
        };

        # ── 2. Customizations from this repo (extensions, lib, skills, AGENTS.md) ──
        # workspaceDeps already deployed @vt-pi/agent-lord as a self-contained
        # tree (extensions/lib/skills/AGENTS.md + a node_modules with every
        # @vt-pi/* and real dependency fully materialized) — just copy it.
        piCustomizations =
          pkgs.runCommand "pi-customizations" { } ''
            cp -r ${workspaceDeps}/agent-lord $out
            chmod -R u+w $out
          '';

        # ── 3. Final Pi package (base + customizations) ───────────────────────
        pi =
          pkgs.runCommand "pi-with-customizations"
            {
              nativeBuildInputs = [ pkgs.makeWrapper ];
              passthru = {
                inherit piBase piCustomizations;
              };
              meta = piBase.meta // {
                description = "Pi coding agent with custom extensions and configuration";
              };
            }
            ''
              # Copy the base pi package
              cp -r ${piBase} $out
              chmod -R u+w $out

              # Add customizations to share/pi/
              mkdir -p $out/share/pi
              cp -r ${piCustomizations}/extensions $out/share/pi/extensions
              cp -r ${piCustomizations}/lib $out/share/pi/lib
              cp -r ${piCustomizations}/skills $out/share/pi/skills
              cp ${piCustomizations}/AGENTS.md $out/share/pi/AGENTS.md

              # Same node_modules (real deps + @vt-pi/* deployed packages) as
              # piCustomizations, so extensions can resolve them at runtime too.
              cp -r ${piCustomizations}/node_modules $out/share/pi/node_modules
              chmod -R u+w $out/share/pi/node_modules

              # Build --extension / --skill flags for every bundled item.
              # Skip test files (*.test.ts) - they're for build-time validation only.
              extra_flags=""
              for ext in $out/share/pi/extensions/*; do
                case "$(basename "$ext")" in
                  *.test.ts) ;; # Skip test files
                  *) extra_flags="$extra_flags --extension $ext" ;;
                esac
              done
              for skill in $out/share/pi/skills/*; do
                extra_flags="$extra_flags --skill $skill"
              done

              # Include the credential helper binary
              cp ${lotdCredentialHelper}/bin/lotd-credential-helper $out/bin/lotd-credential-helper
              cp ${lotdToken}/bin/lotd-token $out/bin/lotd-token

              # Replace the wrapper: go back to node directly.
              rm $out/bin/pi
              makeWrapper "${nodejs}/bin/node" "$out/bin/pi" \
                --run '[ -n "$LOTD_CONFIG_FILE" ] || { echo "pi: LOTD_CONFIG_FILE must be set" >&2; exit 1; }' \
                --run '[ -f "$LOTD_CONFIG_FILE" ] || { echo "pi: config file not found: $LOTD_CONFIG_FILE" >&2; exit 1; }' \
                --run 'export LOTD_CONFIG_FILE="$(cd "$(dirname "$LOTD_CONFIG_FILE")" && pwd)/$(basename "$LOTD_CONFIG_FILE")"' \
                --prefix PATH : ${git}/bin \
                --prefix PATH : ${gh}/bin \
                --add-flags "$out/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js $extra_flags --append-system-prompt $out/share/pi/AGENTS.md"
            '';
      in
      {
        packages = {
          default = pi;
          pi = pi;
          piBase = piBase;
          piCustomizations = piCustomizations;
          lotd-credential-helper = lotdCredentialHelper;
          lotd-token = lotdToken;
          git = git;
          gh = gh;
        };

        apps.default = {
          type = "app";
          program = "${pi}/bin/pi";
        };
        apps.pi = {
          type = "app";
          program = "${pi}/bin/pi";
        };
      }
    );
}
