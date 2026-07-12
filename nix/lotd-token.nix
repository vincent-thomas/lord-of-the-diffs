# ── Token generator for GitHub App auth ──────────────────────────────
# Reads LOTD_CONFIG_FILE, builds a JWT, exchanges for installation token.
# Prints just the raw token to stdout.
{ pkgs }:

pkgs.writeShellScriptBin "lotd-token" ''
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
''
