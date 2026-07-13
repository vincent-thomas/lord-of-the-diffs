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
        lotdToken = import ./nix/lotd-token.nix { inherit pkgs; };

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
        piBase = import ./nix/pi.nix { inherit pkgs nodejs pi-mono; };

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
            hash = "sha256-HQVoQWMbjtkTDsLEs8gFS7ebGeHRLTcy1auw2Mr1S0c=";
          };

          # git is needed on PATH for the checkPhase below — several tests
          # (git-commit, fix-ci) shell out to a real `git` binary.
          nativeBuildInputs = [
            nodejs
            pnpm
            pkgs.pnpmConfigHook
            pkgs.git
          ];

          buildPhase = ''
            runHook preBuild
            pnpm --reporter=append-only -r run build
            runHook postBuild
          '';

          doCheck = true;
          checkPhase = ''
            runHook preCheck
            pnpm --reporter=append-only -r test
            runHook postCheck
          '';
        };
        #

        # The planner. Wraps the Pi CLI with planner-specific extensions and system prompt.
        # Read-only agent that decomposes feature requests into tasks.
        planner =
          let
            # Build planner extensions and AGENTS.md
            plannerCustomizations = pkgs.stdenv.mkDerivation {
              pname = "planner-customizations";
              version = "0.1.0";
              src = ./.;

              nativeBuildInputs = [
                nodejs
                pnpm
                pkgs.pnpmConfigHook
              ];

              pnpmDeps = workspaceDeps.pnpmDeps;

              preConfigure = ''
                export PNPM_INSTALL_FLAGS="--frozen-lockfile --filter=@vt-pi/agent-planner... --include-workspace-root"
                export NODE_ENV="development"
              '';

              buildPhase = ''
                runHook preBuild
                pnpm --reporter=append-only --filter=@vt-pi/agent-planner... run build
                runHook postBuild
              '';

              installPhase = ''
                runHook preInstall
                mkdir -p $out
                pnpm --reporter=append-only --offline --filter=@vt-pi/agent-planner deploy $out/planner
                cp -r packages/agent-planner/dist $out/planner/
                cp packages/agent-planner/AGENTS.md $out/
                runHook postInstall
              '';
            };
          in
          pkgs.runCommand "planner"
            {
              nativeBuildInputs = [ pkgs.makeWrapper ];
              meta = {
                description = "Pi planner agent — decomposes requests into implementation tasks";
                mainProgram = "planner";
              };
            }
            ''
              mkdir -p $out/bin
              makeWrapper "${nodejs}/bin/node" "$out/bin/planner" \
                --add-flags "${piBase}/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js" \
                --add-flags "--extension ${plannerCustomizations}/planner/dist/extensions/submit-plan/index.js" \
                --add-flags "--extension ${plannerCustomizations}/planner/dist/extensions/explore.js" \
                --add-flags "--append-system-prompt ${plannerCustomizations}/AGENTS.md" \
                --add-flags "--tools read,grep,find,ls,explore,submit_plan"
            '';

        # The coder. Wraps the Pi CLI with coder-specific extensions and system prompt.
        # Hyper-specialized agent for implementing a single plan task.
        coder =
          let
            # Build coder extensions and AGENTS.md
            coderCustomizations = pkgs.stdenv.mkDerivation {
              pname = "coder-customizations";
              version = "0.1.0";
              src = ./.;

              nativeBuildInputs = [
                nodejs
                pnpm
                pkgs.pnpmConfigHook
              ];

              pnpmDeps = workspaceDeps.pnpmDeps;

              preConfigure = ''
                export PNPM_INSTALL_FLAGS="--frozen-lockfile --filter=@vt-pi/agent-coder... --include-workspace-root"
                export NODE_ENV="development"
              '';

              buildPhase = ''
                runHook preBuild
                pnpm --reporter=append-only --filter=@vt-pi/agent-coder... run build
                runHook postBuild
              '';

              installPhase = ''
                runHook preInstall
                mkdir -p $out
                pnpm --reporter=append-only --offline --filter=@vt-pi/agent-coder deploy $out/coder
                cp -r packages/agent-coder/dist $out/coder/
                cp packages/agent-coder/AGENTS.md $out/
                runHook postInstall
              '';
            };
          in
          pkgs.writeShellScriptBin "agent-coder" ''
            set -euo pipefail

            usage() {
              cat <<EOF
            Usage: agent-coder <plan.json> <task-index>

            Spawns a code-writing agent to implement exactly one task from a plan.

            Arguments:
              <plan.json>     Path to the plan file (from agent-planner)
              <task-index>    0-based index of the task to implement

            Example:
              agent-coder ./plan.json 0
              agent-coder ./plan.json 1
            EOF
              exit 1
            }

            # Parse arguments
            if [ $# -lt 2 ]; then
              usage
            fi

            PLAN_PATH="$1"
            TASK_INDEX="$2"

            if [ ! -f "$PLAN_PATH" ]; then
              echo "Error: Plan file not found: $PLAN_PATH" >&2
              exit 1
            fi

            # Validate task index
            if ! [[ "$TASK_INDEX" =~ ^[0-9]+$ ]]; then
              echo "Error: Task index must be a non-negative integer: $TASK_INDEX" >&2
              exit 1
            fi

            # Extract plan fields using jq
            PLAN_WHAT=$(${pkgs.jq}/bin/jq -r '.what' "$PLAN_PATH")
            PLAN_WHY=$(${pkgs.jq}/bin/jq -r '.why' "$PLAN_PATH")
            TASK_COUNT=$(${pkgs.jq}/bin/jq -r '.tasks | length' "$PLAN_PATH")

            # Validate task index
            if [ "$TASK_INDEX" -ge "$TASK_COUNT" ]; then
              echo "Error: Task index $TASK_INDEX out of range (plan has $TASK_COUNT tasks)" >&2
              exit 1
            fi

            # Extract current task
            TASK_TITLE=$(${pkgs.jq}/bin/jq -r ".tasks[$TASK_INDEX].title" "$PLAN_PATH")
            TASK_GOAL=$(${pkgs.jq}/bin/jq -r ".tasks[$TASK_INDEX].goal" "$PLAN_PATH")
            TASK_ACCEPTANCE=$(${pkgs.jq}/bin/jq -r ".tasks[$TASK_INDEX].acceptance" "$PLAN_PATH")
            TASK_CONSTRAINTS=$(${pkgs.jq}/bin/jq -r ".tasks[$TASK_INDEX].constraints" "$PLAN_PATH")

            # Build acceptance criteria checklist
            ACCEPTANCE_CHECKLIST=$(echo "$TASK_ACCEPTANCE" | ${pkgs.gnused}/bin/sed 's/\. /\n/g' | ${pkgs.gnused}/bin/sed '/^$/d' | ${pkgs.gnused}/bin/sed 's/^/- [ ] /')

            # Extract plan motivation (first sentence)
            PLAN_MOTIVATION=$(echo "$PLAN_WHY" | ${pkgs.gnused}/bin/sed 's/\([.!?]\).*/\1/')

            # Build previous tasks section
            PREVIOUS_SECTION=""
            if [ "$TASK_INDEX" -gt 0 ]; then
              PREVIOUS_SECTION="## Previous Tasks Completed\n\n"
              for ((i=0; i<TASK_INDEX; i++)); do
                PREV_TITLE=$(${pkgs.jq}/bin/jq -r ".tasks[$i].title" "$PLAN_PATH")
                COMMIT_INDEX=$((TASK_INDEX - i - 1))
                if COMMIT_HASH=$(${pkgs.git}/bin/git log --format=%h --skip="$COMMIT_INDEX" -n1 2>/dev/null); then
                  if [ -n "$COMMIT_HASH" ]; then
                    FILES=$(${pkgs.git}/bin/git show --name-only --format= "$COMMIT_HASH" 2>/dev/null | tr '\n' ', ' | ${pkgs.gnused}/bin/sed 's/,$//')
                    PREVIOUS_SECTION="$PREVIOUS_SECTION$((i+1)). $PREV_TITLE\n   Files: $FILES\n   Commit: $COMMIT_HASH\n\n"
                  else
                    PREVIOUS_SECTION="$PREVIOUS_SECTION$((i+1)). $PREV_TITLE\n\n"
                  fi
                else
                  PREVIOUS_SECTION="$PREVIOUS_SECTION$((i+1)). $PREV_TITLE\n\n"
                fi
              done
              PREVIOUS_SECTION="$${PREVIOUS_SECTION}These tasks are already committed. Build on their changes.\n"
            fi

            # Build the complete prompt
            read -r -d "" PROMPT <<EOF || true
            # Implementation Task $((TASK_INDEX + 1))/$TASK_COUNT

            ## Overall Goal

            **What:** $PLAN_WHAT

            **Why:** $PLAN_WHY
            $(echo -e "$PREVIOUS_SECTION")
            ## Your Task: $TASK_TITLE

            **Goal:** $TASK_GOAL

            **Acceptance Criteria:**
            $ACCEPTANCE_CHECKLIST

            **Constraints:** $TASK_CONSTRAINTS

            ## Instructions

            1. **Read first** — Understand the current codebase state before making changes
            2. **Implement** — Make the changes described in "Goal"
            3. **Verify** — Ensure all acceptance criteria are satisfied
            4. **Commit** — Use the \`commit_task\` tool with this structure:

            \`\`\`
            commit_task({
              subject: "$TASK_TITLE",
              what: "[2-3 sentences describing the concrete changes you made]",
              why: "$PLAN_MOTIVATION [add task-specific context if needed]"
            })
            \`\`\`

            5. **Stop** — After committing, your session ends. Do NOT continue.

            ## Commit Message Guidelines

            **What:** Describe your actual implementation
            - Be specific about functions, classes, files modified
            - Include important details: defaults, edge cases, tradeoffs

            **Why:** Explain the motivation
            - Start with: "$PLAN_MOTIVATION"
            - Add task-specific context if relevant
            - Focus on the problem solved

            ---

            Begin implementing. Read the relevant code first.
            EOF

            echo -e "\n┌─ Task $((TASK_INDEX + 1))/$TASK_COUNT"
            echo "│  $TASK_TITLE"
            echo -e "└─ Starting agent...\n"

            # Call Pi with the prompt and extensions
            exec ${nodejs}/bin/node ${piBase}/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js \
              --extension ${coderCustomizations}/coder/dist/extensions/commit-task \
              --append-system-prompt ${coderCustomizations}/AGENTS.md \
              --tools read,write,edit,bash,grep,glob,find,ls,commit_task \
              "$PROMPT"
          '';
      in
      {
        packages = {
          # piBase = piBase;
          planner = planner;
          coder = coder;
          # lotd-credential-helper = lotdCredentialHelper;
          # lotd-token = lotdToken;
          # git = git;
          # gh = gh;
        };

        # apps.default = {
        #   type = "app";
        #   program = "${pi}/bin/pi";
        # };
        # apps.pi = {
        #   type = "app";
        #   program = "${pi}/bin/pi";
        # };
        apps.planner = {
          type = "app";
          program = "${planner}/bin/planner";
        };
        apps.coder = {
          type = "app";
          program = "${coder}/bin/agent-coder";
        };
      }
    );
}
# # ── 2. Customizations from this repo (extensions, lib, skills, AGENTS.md) ──
# # workspaceDeps already deployed @vt-pi/agent-lord as a self-contained
# # tree (extensions/lib/skills/AGENTS.md + a node_modules with every
# # @vt-pi/* and real dependency fully materialized) — just copy it.
# piCustomizations = pkgs.runCommand "pi-customizations" { } ''
#   cp -r ${workspaceDeps}/agent-lord $out
#   chmod -R u+w $out
# '';

# # ── 3. Final Pi package (base + customizations) ───────────────────────
# pi =
#   pkgs.runCommand "pi-with-customizations"
#     {
#       nativeBuildInputs = [ pkgs.makeWrapper ];
#       passthru = {
#         inherit piBase piCustomizations;
#       };
#       meta = piBase.meta // {
#         description = "Pi coding agent with custom extensions and configuration";
#       };
#     }
#     ''
#       # Copy the base pi package
#       cp -r ${piBase} $out
#       chmod -R u+w $out
#
#       # Add customizations to share/pi/
#       mkdir -p $out/share/pi
#       cp -r ${piCustomizations}/extensions $out/share/pi/extensions
#       cp -r ${piCustomizations}/lib $out/share/pi/lib
#       cp -r ${piCustomizations}/skills $out/share/pi/skills
#       cp ${piCustomizations}/AGENTS.md $out/share/pi/AGENTS.md
#
#       # Same node_modules (real deps + @vt-pi/* deployed packages) as
#       # piCustomizations, so extensions can resolve them at runtime too.
#       cp -r ${piCustomizations}/node_modules $out/share/pi/node_modules
#       chmod -R u+w $out/share/pi/node_modules
#
#       # Build --extension / --skill flags for every bundled item.
#       # Skip test files (*.test.ts) - they're for build-time validation only.
#       extra_flags=""
#       for ext in $out/share/pi/extensions/*; do
#         case "$(basename "$ext")" in
#           *.test.ts) ;; # Skip test files
#           *) extra_flags="$extra_flags --extension $ext" ;;
#         esac
#       done
#       for skill in $out/share/pi/skills/*; do
#         extra_flags="$extra_flags --skill $skill"
#       done
#
#       # Include the credential helper binary
#       cp ${lotdCredentialHelper}/bin/lotd-credential-helper $out/bin/lotd-credential-helper
#       cp ${lotdToken}/bin/lotd-token $out/bin/lotd-token
#
#       # Replace the wrapper: go back to node directly.
#       rm $out/bin/pi
#       makeWrapper "${nodejs}/bin/node" "$out/bin/pi" \
#         --run '[ -n "$LOTD_CONFIG_FILE" ] || { echo "pi: LOTD_CONFIG_FILE must be set" >&2; exit 1; }' \
#         --run '[ -f "$LOTD_CONFIG_FILE" ] || { echo "pi: config file not found: $LOTD_CONFIG_FILE" >&2; exit 1; }' \
#         --run 'export LOTD_CONFIG_FILE="$(cd "$(dirname "$LOTD_CONFIG_FILE")" && pwd)/$(basename "$LOTD_CONFIG_FILE")"' \
#         --prefix PATH : ${git}/bin \
#         --prefix PATH : ${gh}/bin \
#         --add-flags "$out/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js $extra_flags --append-system-prompt $out/share/pi/AGENTS.md"
#     '';

# # The code-writer (default). Full toolset, agent-lord's extensions.
# pi = mkPiAgent {
#   name = "pi-with-customizations";
#   tree = piCustomizations;
#   description = "Pi coding agent with custom extensions and configuration";
# };
