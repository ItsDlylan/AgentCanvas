#!/bin/bash
# ============================================================
# AgentCanvas — Claude Code Stop Hook Installer
# ============================================================
# Installs the AgentCanvas notification hook into the user's
# global Claude Code config so that any Claude Code instance
# running inside an AgentCanvas terminal tile will send a toast
# notification to the canvas when it finishes a task.
#
# What it does:
#   1. Copies scripts/agentcanvas-notify-stop.sh to
#      ~/.claude/scripts/agentcanvas-notify-stop.sh
#   2. Adds the hook to the Stop array in
#      ~/.claude/settings.json (idempotent — safe to re-run)
#   3. Backs up the original settings.json before modifying
#
# The hook itself is a no-op outside AgentCanvas (it checks for
# the AGENT_CANVAS_API env var), so installing it globally has
# zero effect on Claude Code instances run from any other shell.
# ============================================================

set -euo pipefail

# Colors for output
if [[ -t 1 ]]; then
    GREEN='\033[0;32m'
    YELLOW='\033[0;33m'
    RED='\033[0;31m'
    BLUE='\033[0;34m'
    BOLD='\033[1m'
    RESET='\033[0m'
else
    GREEN=''
    YELLOW=''
    RED=''
    BLUE=''
    BOLD=''
    RESET=''
fi

info()    { echo -e "${BLUE}info${RESET}  $*"; }
ok()      { echo -e "${GREEN}ok${RESET}    $*"; }
warn()    { echo -e "${YELLOW}warn${RESET}  $*"; }
error()   { echo -e "${RED}error${RESET} $*" >&2; }

# Resolve script directory (works when invoked from anywhere)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_HOOK="$SCRIPT_DIR/agentcanvas-notify-stop.sh"

# Allow override via CLAUDE_CONFIG_DIR; default to ~/.claude
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
TARGET_SCRIPTS_DIR="$CLAUDE_DIR/scripts"
TARGET_HOOK="$TARGET_SCRIPTS_DIR/agentcanvas-notify-stop.sh"
SETTINGS_FILE="$CLAUDE_DIR/settings.json"

echo -e "${BOLD}AgentCanvas — Claude Code Stop Hook Installer${RESET}"
echo

# ── Preflight ────────────────────────────────────────────

if [[ ! -f "$SOURCE_HOOK" ]]; then
    error "Source hook not found: $SOURCE_HOOK"
    error "Run this script from the AgentCanvas repo root or via 'npm run setup:claude-hook'."
    exit 1
fi

if ! command -v python3 &>/dev/null; then
    error "python3 is required but not installed."
    exit 1
fi

# ── Step 1: Install the hook script ──────────────────────

info "Installing hook script to: $TARGET_HOOK"

mkdir -p "$TARGET_SCRIPTS_DIR"

if [[ -f "$TARGET_HOOK" ]]; then
    if cmp -s "$SOURCE_HOOK" "$TARGET_HOOK"; then
        ok "Hook script already up to date."
    else
        backup="$TARGET_HOOK.backup.$(date +%Y%m%d-%H%M%S)"
        warn "Existing hook script differs — backing up to: $backup"
        cp "$TARGET_HOOK" "$backup"
        cp "$SOURCE_HOOK" "$TARGET_HOOK"
        chmod +x "$TARGET_HOOK"
        ok "Hook script updated."
    fi
else
    cp "$SOURCE_HOOK" "$TARGET_HOOK"
    chmod +x "$TARGET_HOOK"
    ok "Hook script installed."
fi

# ── Step 2: Update settings.json ─────────────────────────

info "Updating $SETTINGS_FILE"

# The python script does the actual JSON manipulation. It is idempotent:
# if the hook is already registered, it makes no changes.
SETTINGS_FILE="$SETTINGS_FILE" python3 <<'PYEOF'
import json
import os
import shutil
import sys
from datetime import datetime

settings_path = os.environ["SETTINGS_FILE"]
hook_command = "~/.claude/scripts/agentcanvas-notify-stop.sh"

# Load existing settings, or start fresh
if os.path.exists(settings_path):
    try:
        with open(settings_path, "r") as f:
            settings = json.load(f)
    except json.JSONDecodeError as e:
        print(f"error  Failed to parse {settings_path}: {e}", file=sys.stderr)
        sys.exit(1)
else:
    settings = {}

# Walk down to hooks.Stop, creating intermediate keys
hooks = settings.setdefault("hooks", {})
stop_groups = hooks.setdefault("Stop", [])

# Find an existing catch-all matcher group (no matcher key, or empty matcher).
# If none exists, we will create one.
target_group = None
for group in stop_groups:
    if not group.get("matcher"):
        target_group = group
        break

if target_group is None:
    target_group = {"hooks": []}
    stop_groups.append(target_group)

target_group.setdefault("hooks", [])

# Idempotency: bail out if the command is already registered
existing_commands = [h.get("command") for h in target_group["hooks"]]
if hook_command in existing_commands:
    print(f"ok    Stop hook already registered in settings.json.")
    sys.exit(0)

# Backup before modifying
if os.path.exists(settings_path):
    backup_path = f"{settings_path}.backup.{datetime.now():%Y%m%d-%H%M%S}"
    shutil.copy2(settings_path, backup_path)
    print(f"info  Backed up existing settings.json to: {backup_path}")

# Append the new hook entry
target_group["hooks"].append({
    "type": "command",
    "command": hook_command,
})

# Write back with pretty formatting
os.makedirs(os.path.dirname(settings_path), exist_ok=True)
with open(settings_path, "w") as f:
    json.dump(settings, f, indent=2)
    f.write("\n")

print(f"ok    Stop hook registered in {settings_path}.")
PYEOF

echo
ok "${BOLD}Setup complete.${RESET}"
echo
echo "  The hook is a no-op outside AgentCanvas, so it's safe to keep installed"
echo "  globally. Inside an AgentCanvas terminal tile, every Claude Code Stop"
echo "  event will now post a toast notification to the canvas."
echo
echo "  Test it from inside an AgentCanvas terminal:"
echo "    curl -s -X POST \$AGENT_CANVAS_API/api/notify \\"
echo "      -H 'Content-Type: application/json' \\"
echo "      -d '{\"body\":\"Hello from setup\",\"level\":\"success\"}'"
echo
