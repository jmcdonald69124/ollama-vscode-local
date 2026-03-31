#!/bin/sh
set -eu

APP_PATH="/Applications/Visual Studio Code.app"
PRODUCT_JSON="$APP_PATH/Contents/Resources/app/product.json"
BACKUP_JSON="$APP_PATH/Contents/Resources/app/product.ollama-chat.backup.json"
CODE_BIN="$APP_PATH/Contents/Resources/app/bin/code"
EXTENSION_ID="ollama-chat.ollama-chat-local"
PROPOSAL="chatProvider"

copy_with_permissions() {
  source_path="$1"
  target_path="$2"

  if [ -w "$target_path" ]; then
    cp "$source_path" "$target_path"
  else
    sudo cp "$source_path" "$target_path"
  fi
}

usage() {
  cat <<EOF
Usage:
  ./launch-with-ollama.sh          Patch product.json if needed, fully quit VS Code, then relaunch
  ./launch-with-ollama.sh --patch  Apply the product.json workaround only
  ./launch-with-ollama.sh --status Show whether the workaround is active
  ./launch-with-ollama.sh --restore Restore the original product.json backup

This works around the proposed API flag by permanently allowlisting:
  ${EXTENSION_ID} -> ${PROPOSAL}

Notes:
  - Modifying ${PRODUCT_JSON} may require administrator privileges.
  - VS Code must be fully restarted after applying the workaround.
EOF
}

ensure_files_exist() {
  if [ ! -f "$PRODUCT_JSON" ]; then
    echo "VS Code product.json not found at: $PRODUCT_JSON" >&2
    exit 1
  fi
  if [ ! -x "$CODE_BIN" ]; then
    echo "VS Code launcher not found at: $CODE_BIN" >&2
    exit 1
  fi
}

workaround_status() {
  python3 - "$PRODUCT_JSON" "$EXTENSION_ID" "$PROPOSAL" <<'PY'
import json
import sys

product_json, extension_id, proposal = sys.argv[1:4]
with open(product_json, 'r', encoding='utf-8') as handle:
    data = json.load(handle)

enabled = data.get('extensionEnabledApiProposals', {})
proposals = enabled.get(extension_id, [])
print('enabled' if proposal in proposals else 'disabled')
PY
}

apply_workaround() {
  ensure_files_exist

  if [ "$(workaround_status)" = "enabled" ]; then
    echo "Workaround already active in product.json"
    return 0
  fi

  if [ ! -f "$BACKUP_JSON" ]; then
    echo "Creating backup: $BACKUP_JSON"
    copy_with_permissions "$PRODUCT_JSON" "$BACKUP_JSON"
  fi

  TMP_FILE=$(mktemp)
  python3 - "$PRODUCT_JSON" "$TMP_FILE" "$EXTENSION_ID" "$PROPOSAL" <<'PY'
import json
import sys

source_path, target_path, extension_id, proposal = sys.argv[1:5]
with open(source_path, 'r', encoding='utf-8') as handle:
    data = json.load(handle)

enabled = data.setdefault('extensionEnabledApiProposals', {})
proposals = list(enabled.get(extension_id, []))
if proposal not in proposals:
    proposals.append(proposal)
enabled[extension_id] = proposals

with open(target_path, 'w', encoding='utf-8') as handle:
    json.dump(data, handle, indent=2)
    handle.write('\n')
PY

  echo "Patching VS Code product.json to allow ${EXTENSION_ID} -> ${PROPOSAL}"
  copy_with_permissions "$TMP_FILE" "$PRODUCT_JSON"
  rm -f "$TMP_FILE"
  echo "Workaround applied"
}

restore_workaround() {
  ensure_files_exist

  if [ ! -f "$BACKUP_JSON" ]; then
    echo "No backup found at: $BACKUP_JSON" >&2
    exit 1
  fi

  echo "Restoring original VS Code product.json"
  copy_with_permissions "$BACKUP_JSON" "$PRODUCT_JSON"
  echo "Restore complete"
}

quit_vscode() {
  osascript <<'APPLESCRIPT' >/dev/null 2>&1 || true
tell application "Visual Studio Code"
  if it is running then
    quit
  end if
end tell
APPLESCRIPT

  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if ! pgrep -x "Code" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
}

launch_vscode() {
  echo "Launching a fresh VS Code process"
  exec "$CODE_BIN" "$@"
}

case "${1:-}" in
  --help|-h)
    usage
    ;;
  --status)
    ensure_files_exist
    echo "Workaround status: $(workaround_status)"
    ;;
  --patch)
    apply_workaround
    ;;
  --restore)
    restore_workaround
    ;;
  "")
    apply_workaround
    quit_vscode
    launch_vscode
    ;;
  *)
    apply_workaround
    quit_vscode
    launch_vscode "$@"
    ;;
esac
