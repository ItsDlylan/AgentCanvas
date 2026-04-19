#!/bin/bash
# ============================================================
# AgentCanvas PreToolUse Hook — ExitPlanMode
# ============================================================
# When Claude Code invokes ExitPlanMode (meaning plan mode just
# produced a plan), this hook captures the plan markdown and
# creates a Plan Tile on the canvas, linked to the current
# terminal.
#
# Only fires inside an AgentCanvas terminal tile
# (AGENT_CANVAS_API is set). Runs synchronously but backgrounds
# the POST so the tool call is not delayed.
#
# Installed by scripts/setup-claude-hook.sh into:
#   ~/.claude/scripts/agentcanvas-capture-plan.sh
# ============================================================

payload_in=$(cat)

# No-op outside AgentCanvas
[[ -z "$AGENT_CANVAS_API" ]] && exit 0

# Extract plan markdown from the PreToolUse envelope.
# ExitPlanMode's tool_input looks like: { "plan": "...markdown..." }
plan_payload=$(AGENT_CANVAS_TERMINAL_ID="${AGENT_CANVAS_TERMINAL_ID:-}" \
          HOOK_STDIN="$payload_in" \
          python3 -c "
import json, os

raw = os.environ.get('HOOK_STDIN', '')
plan_text = ''
try:
    data = json.loads(raw) if raw else {}
    tool_input = data.get('tool_input') or {}
    plan_text = (tool_input.get('plan') or '').strip()
except Exception:
    pass

if not plan_text:
    # Nothing to capture.
    print('')
else:
    # Derive a reasonable label from the first heading or first non-empty line.
    label = 'Plan'
    for line in plan_text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        # Strip markdown heading chars
        while stripped.startswith('#'):
            stripped = stripped[1:].lstrip()
        if stripped:
            label = stripped[:80]
            break

    print(json.dumps({
        'label': label,
        'content': plan_text,
        'linkedTerminalId': os.environ.get('AGENT_CANVAS_TERMINAL_ID', ''),
        'author': 'capture-hook'
    }))
" 2>/dev/null)

# If extraction failed or there was no plan text, exit cleanly.
[[ -z "$plan_payload" ]] && exit 0

# POST to /api/plan/open in the background so the tool call isn't delayed.
(
    resp=$(curl -s -m 3 -X POST "$AGENT_CANVAS_API/api/plan/open" \
        -H 'Content-Type: application/json' \
        -d "$plan_payload" 2>/dev/null)
    plan_id=$(echo "$resp" | python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    print(d.get('planId') or '')
except Exception:
    pass
" 2>/dev/null)

    # Toast the user that the plan was captured.
    notify_body="Plan captured as tile. Open the Plan Tile to review, verify, approve, and execute."
    [[ -n "$plan_id" ]] && notify_body="$notify_body (planId: ${plan_id:0:8}...)"
    curl -s -m 2 -X POST "$AGENT_CANVAS_API/api/notify" \
        -H 'Content-Type: application/json' \
        -d "{\"title\":\"Plan captured\",\"body\":\"$notify_body\",\"level\":\"success\",\"terminalId\":\"${AGENT_CANVAS_TERMINAL_ID:-}\"}" > /dev/null 2>&1 || true
) &

exit 0
