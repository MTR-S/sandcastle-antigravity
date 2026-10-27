#!/bin/bash
set -e

# 1. Initialize D-Bus session bus if not already active
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/tmp/dbus-session.sock}"
DBUS_SOCKET_PATH="${DBUS_SESSION_BUS_ADDRESS#unix:path=}"

rm -f "$DBUS_SOCKET_PATH"
dbus-daemon --session --address="$DBUS_SESSION_BUS_ADDRESS" --fork --nopidfile

# Wait for D-Bus socket to become available
for i in $(seq 1 30); do
  [ -S "$DBUS_SOCKET_PATH" ] && break
  sleep 0.1
done

# 2. Ensure keyring directories exist and provision default blank login keyring if missing
mkdir -p "$HOME/.local/share/keyrings" "$HOME/.cache"
if [ ! -f "$HOME/.local/share/keyrings/login.keyring" ]; then
  cat <<'EOF' | base64 -d > "$HOME/.local/share/keyrings/login.keyring"
R25vbWVLZXlyaW5nCg0ACgAAAAAAAAAFTG9naW4AAAAAAAAAAAAAAABqrZxvAAAAAAAAAAAAAA8n
6V77zmJg8NQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABA4s+TSntR6uFMIx7D55Z4+
EOF
  chmod 600 "$HOME/.local/share/keyrings/login.keyring"
  echo "login" > "$HOME/.local/share/keyrings/default"
fi

# 3. Unlock login keyring with empty password, start secrets daemon, and unlock active collection
eval "$(echo '' | gnome-keyring-daemon --unlock 2>/dev/null || true)"
eval "$(gnome-keyring-daemon --start --components=secrets 2>/dev/null || true)"
eval "$(echo '' | gnome-keyring-daemon --unlock 2>/dev/null || true)"

# 4. Clean up API key overrides from container settings, ensuring clean consumer OAuth defaults
SETTINGS_FILE="$HOME/.gemini/antigravity-cli/settings.json"
mkdir -p "$(dirname "$SETTINGS_FILE")"
if [ -f "$SETTINGS_FILE" ]; then
  if grep -q '"modelProvider"' "$SETTINGS_FILE" 2>/dev/null; then
    jq 'del(.modelProvider)' "$SETTINGS_FILE" > "${SETTINGS_FILE}.tmp" 2>/dev/null && mv "${SETTINGS_FILE}.tmp" "$SETTINGS_FILE"
  fi
else
  echo '{}' > "$SETTINGS_FILE"
fi

# 5. If SANDCASTLE_OAUTH_PAYLOAD is present, store it into the Secret Service keyring and token cache, then unset
if [ -n "$SANDCASTLE_OAUTH_PAYLOAD" ]; then
  mkdir -p "$HOME/.gemini/antigravity-cli"
  printf "%s" "$SANDCASTLE_OAUTH_PAYLOAD" > "$HOME/.gemini/antigravity-cli/antigravity-oauth-token"
  chmod 600 "$HOME/.gemini/antigravity-cli/antigravity-oauth-token"

  # Store into Secret Service keyring with retry in case daemon is still binding
  for i in $(seq 1 15); do
    if printf "%s" "$SANDCASTLE_OAUTH_PAYLOAD" | secret-tool store --label="gemini:antigravity" service gemini username antigravity 2>/dev/null; then
      break
    fi
    sleep 0.2
  done

  unset SANDCASTLE_OAUTH_PAYLOAD
fi

# 6. Dynamic Git identity configuration from environment variables
if [ -n "$GIT_USER_NAME" ]; then
  git config --global user.name "$GIT_USER_NAME"
  export GIT_AUTHOR_NAME="$GIT_USER_NAME"
  export GIT_COMMITTER_NAME="$GIT_USER_NAME"
fi
if [ -n "$GIT_USER_EMAIL" ]; then
  git config --global user.email "$GIT_USER_EMAIL"
  export GIT_AUTHOR_EMAIL="$GIT_USER_EMAIL"
  export GIT_COMMITTER_EMAIL="$GIT_USER_EMAIL"
fi

# 7. Default command if none provided
if [ $# -eq 0 ]; then
  set -- sleep infinity
fi

# 8. Execute container command
exec "$@"
