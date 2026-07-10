# agent-lord's own packaging recipe: assembles piBase + this package's
# extensions/lib/skills/AGENTS.md into the final customized `pi` binary.
#
# piBase and workspaceDeps are built at the flake root — piBase from
# upstream pi's own source, workspaceDeps from an npm install spanning the
# whole monorepo (npm workspace dependency resolution is inherently
# whole-tree) — and threaded in here as arguments.
{
  pkgs,
  nodejs,
  piBase,
  workspaceDeps,
  git,
  gh,
  lotdCredentialHelper,
  lotdToken,
}:
let
  # ── Customizations from this repo (extensions, lib, skills, AGENTS.md) ──
  piCustomizations =
    pkgs.runCommand "pi-customizations"
      {
        nativeBuildInputs = [
          nodejs
          pkgs.git
        ];
      }
      ''
        mkdir -p $out/extensions $out/lib $out/skills $out/packages

        # Copy extensions + lib + packages so ../lib/ imports and
        # @vt-pi/command-policy imports both work
        cp -r ${./extensions}/. $out/extensions/
        cp -r ${./lib}/. $out/lib/
        cp -r ${../.}/. $out/packages/

        # Copy skills, AGENTS.md, and bin scripts
        cp -r ${./skills}/. $out/skills/
        cp ${./AGENTS.md} $out/AGENTS.md

        # Real npm deps (@mariozechner/pi-coding-agent, …) from
        # workspaceDeps. Its @vt-pi/command-policy, @vt-pi/agent-explorer,
        # and @vt-pi/agent-advisor entries were dereferenced from a
        # differently-shaped tree (this repo's own packages/* layout) so
        # they don't match this derivation's flattened
        # $out/{lib,extensions,packages}; replace them with symlinks
        # that do. Same story for @vt-pi/agent-lord — nothing resolves
        # it by package name (lib/ and extensions/* use relative
        # imports), so it's simply dropped rather than relinked.
        cp -r ${workspaceDeps}/node_modules $out/node_modules
        chmod -R u+w $out/node_modules
        rm -rf $out/node_modules/@vt-pi
        mkdir -p $out/node_modules/@vt-pi
        ln -s ../../packages/command-policy $out/node_modules/@vt-pi/command-policy
        ln -s ../../packages/agent-explorer $out/node_modules/@vt-pi/agent-explorer
        ln -s ../../packages/agent-advisor $out/node_modules/@vt-pi/agent-advisor
      '';

  # ── Final Pi package (base + customizations) ───────────────────────
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
        cp -r ${piCustomizations}/packages $out/share/pi/packages
        cp -r ${piCustomizations}/skills $out/share/pi/skills
        cp ${piCustomizations}/AGENTS.md $out/share/pi/AGENTS.md

        # Same node_modules (real deps + @vt-pi/* workspace symlinks) as
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
  inherit piCustomizations pi;
}
