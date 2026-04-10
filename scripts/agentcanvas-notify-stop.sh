#!/bin/bash
# ============================================================
# AgentCanvas Stop Hook
# ============================================================
# Sends a toast notification to the AgentCanvas UI when Claude
# Code finishes working. Only fires when running inside an
# AgentCanvas terminal tile (AGENT_CANVAS_API is set).
#
# Installed by scripts/setup-claude-hook.sh into:
#   ~/.claude/scripts/agentcanvas-notify-stop.sh
# ============================================================

# Always consume stdin so we don't break the hook pipeline
cat > /dev/null 2>&1

# No-op outside AgentCanvas
[[ -z "$AGENT_CANVAS_API" ]] && exit 0

# Build JSON payload via python3 for safe escaping
payload=$(python3 -c "
import json, os
print(json.dumps({
    'title': f'Claude finished — {os.path.basename(os.getcwd())}',
    'body': f'Task complete in {os.getcwd()}',
    'level': 'success',
    'terminalId': os.environ.get('AGENT_CANVAS_TERMINAL_ID', '')
}))
" 2>/dev/null)

# Fall back to a minimal hand-built payload if python3 is unavailable
if [[ -z "$payload" ]]; then
    payload="{\"title\":\"Claude finished\",\"body\":\"Task complete\",\"level\":\"success\",\"terminalId\":\"${AGENT_CANVAS_TERMINAL_ID:-}\"}"
fi

curl -s -m 2 -X POST "$AGENT_CANVAS_API/api/notify" \
    -H 'Content-Type: application/json' \
    -d "$payload" > /dev/null 2>&1 || true

exit 0
