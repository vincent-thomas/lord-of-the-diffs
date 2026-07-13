# ── Git with credential helper + HTTPS enforcement ──────────────────
# Wraps `git` so commits use the GitHub App identity (from LOTD_CONFIG_FILE)
# and all remotes are forced over HTTPS with a token-based credential helper.
{ pkgs, lotdToken, gh }:

let
  # ── Git credential helper (calls lotd-token) ─────────────────────────
  # Git invokes this on-demand; wraps the raw token in credential protocol.
  lotdCredentialHelper = pkgs.writeShellScriptBin "lotd-credential-helper" ''
    set -eu
    printf 'username=x-access-token\npassword=%s\n' "$(${lotdToken}/bin/lotd-token)"
  '';

  gitconfig = pkgs.writeText "gitconfig" ''
    [credential]
        helper = ${lotdCredentialHelper}/bin/lotd-credential-helper
    [url "https://"]
        insteadOf = git://
    [url "https://github.com/"]
        insteadOf = git@github.com:
        insteadOf = ssh://git@github.com/
  '';
in
pkgs.writeShellScriptBin "git" ''
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
''
