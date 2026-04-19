#!/bin/bash
# ============================================================
# AgentCanvas — Claude Code Notification Hooks Installer
# ============================================================
# Installs the AgentCanvas notification hooks into the user's
# global Claude Code config so that any Claude Code instance
# running inside an AgentCanvas terminal tile will send toast
# notifications to the canvas on notable events.
#
# What it installs:
#   1. agentcanvas-notify-stop.sh
#      - Registered as a `Stop` hook
#      - Fires when Claude finishes a task
#
#   2. agentcanvas-notify-ask-user.sh
#      - Registered as a `PreToolUse` hook with
#        matcher="AskUserQuestion"
#      - Fires when Claude invokes the AskUserQuestion tool and
#        is blocked waiting on the user
#
# Both hook scripts are copied to ~/.claude/scripts/ and wired
# into ~/.claude/settings.json (idempotent — safe to re-run).
# The existing settings.json is backed up once per invocation
# before any modifications.
#
# The hooks themselves are no-ops outside AgentCanvas (they
# check for the AGENT_CANVAS_API env var), so installing them
# globally has zero effect on Claude Code instances run from
# any other shell.
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

# Allow override via CLAUDE_CONFIG_DIR; default to ~/.claude
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
TARGET_SCRIPTS_DIR="$CLAUDE_DIR/scripts"
SETTINGS_FILE="$CLAUDE_DIR/settings.json"

# Hook scripts to install — filename basenames (resolved against
# SCRIPT_DIR for the source and TARGET_SCRIPTS_DIR for the target).
HOOK_SCRIPTS=(
    "agentcanvas-notify-stop.sh"
    "agentcanvas-notify-ask-user.sh"
)

echo -e "${BOLD}AgentCanvas — Claude Code Notification Hooks Installer${RESET}"
echo

# ── Preflight ────────────────────────────────────────────

for script in "${HOOK_SCRIPTS[@]}"; do
    if [[ ! -f "$SCRIPT_DIR/$script" ]]; then
        error "Source hook not found: $SCRIPT_DIR/$script"
        error "Run this script from the AgentCanvas repo root or via 'npm run setup:claude-hook'."
        exit 1
    fi
done

if ! command -v python3 &>/dev/null; then
    error "python3 is required but not installed."
    exit 1
fi

# ── Step 1: Install the hook scripts ─────────────────────

mkdir -p "$TARGET_SCRIPTS_DIR"

for script in "${HOOK_SCRIPTS[@]}"; do
    src="$SCRIPT_DIR/$script"
    dst="$TARGET_SCRIPTS_DIR/$script"

    info "Installing hook script to: $dst"

    if [[ -f "$dst" ]]; then
        if cmp -s "$src" "$dst"; then
            ok "Hook script already up to date: $script"
        else
            backup="$dst.backup.$(date +%Y%m%d-%H%M%S)"
            warn "Existing hook script differs — backing up to: $backup"
            cp "$dst" "$backup"
            cp "$src" "$dst"
            chmod +x "$dst"
            ok "Hook script updated: $script"
        fi
    else
        cp "$src" "$dst"
        chmod +x "$dst"
        ok "Hook script installed: $script"
    fi
done

# ── Step 2: Update settings.json ─────────────────────────

info "Updating $SETTINGS_FILE"

# The python script does the actual JSON manipulation. It is
# idempotent: hooks that are already registered are skipped.
# Registrations are driven by a single list so adding future
# hooks is a one-liner.
SETTINGS_FILE="$SETTINGS_FILE" python3 <<'PYEOF'
import json
import os
import shutil
import sys
from datetime import datetime

settings_path = os.environ["SETTINGS_FILE"]

# Each registration describes one hook command to ensure is
# present under settings.hooks[event]. `matcher` is the string to
# match against a group's "matcher" field; None means "catch-all
# group" (no matcher key, or an empty/missing matcher).
registrations = [
    {
        "event": "Stop",
        "matcher": None,
        "command": "~/.claude/scripts/agentcanvas-notify-stop.sh",
        "label": "Stop → agentcanvas-notify-stop.sh",
    },
    {
        "event": "PreToolUse",
        "matcher": "AskUserQuestion",
        "command": "~/.claude/scripts/agentcanvas-notify-ask-user.sh",
        "label": "PreToolUse[AskUserQuestion] → agentcanvas-notify-ask-user.sh",
    },
]

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


def find_group(groups, matcher):
    """Return the existing group matching `matcher`, or None.

    When matcher is None, we look for a catch-all group (no
    matcher key, or empty matcher). When matcher is a string, we
    look for a group whose "matcher" field equals that string.
    """
    for group in groups:
        group_matcher = group.get("matcher")
        if matcher is None:
            if not group_matcher:
                return group
        else:
            if group_matcher == matcher:
                return group
    return None


# Plan the changes first so we only back up / write when
# something actually needs to happen.
changes = []  # list of (registration, target_group_will_be_created)
for reg in registrations:
    event_groups = settings.get("hooks", {}).get(reg["event"], [])
    group = find_group(event_groups, reg["matcher"])
    if group is None:
        changes.append((reg, True))
        continue
    existing_commands = [h.get("command") for h in group.get("hooks", [])]
    if reg["command"] in existing_commands:
        print(f"ok    Already registered: {reg['label']}")
        continue
    changes.append((reg, False))

if not changes:
    print("ok    All hooks already registered; no changes needed.")
    sys.exit(0)

# Backup before modifying (once per invocation)
if os.path.exists(settings_path):
    backup_path = f"{settings_path}.backup.{datetime.now():%Y%m%d-%H%M%S}"
    shutil.copy2(settings_path, backup_path)
    print(f"info  Backed up existing settings.json to: {backup_path}")

# Apply the changes
hooks = settings.setdefault("hooks", {})
for reg, _create in changes:
    event_groups = hooks.setdefault(reg["event"], [])
    group = find_group(event_groups, reg["matcher"])
    if group is None:
        group = {"hooks": []}
        if reg["matcher"] is not None:
            group["matcher"] = reg["matcher"]
        event_groups.append(group)

    group.setdefault("hooks", [])
    group["hooks"].append({
        "type": "command",
        "command": reg["command"],
    })
    print(f"ok    Registered: {reg['label']}")

# Write back with pretty formatting
os.makedirs(os.path.dirname(settings_path), exist_ok=True)
with open(settings_path, "w") as f:
    json.dump(settings, f, indent=2)
    f.write("\n")

print(f"ok    Wrote {settings_path}.")
PYEOF

echo
ok "${BOLD}Setup complete.${RESET}"
echo
echo "  The hooks are no-ops outside AgentCanvas, so they're safe to keep"
echo "  installed globally. Inside an AgentCanvas terminal tile:"
echo "    - Stop events post a success toast to the canvas."
echo "    - AskUserQuestion calls post a warning toast so you know the"
echo "      terminal is waiting on your input."
echo
echo "  Test from inside an AgentCanvas terminal:"
echo "    curl -s -X POST \$AGENT_CANVAS_API/api/notify \\"
echo "      -H 'Content-Type: application/json' \\"
echo "      -d '{\"body\":\"Hello from setup\",\"level\":\"success\"}'"
echo
