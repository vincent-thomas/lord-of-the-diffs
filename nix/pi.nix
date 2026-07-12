# Pi coding agent base package (upstream, no customizations)
{ pkgs, nodejs, pi-mono }:

pkgs.buildNpmPackage {
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
}
