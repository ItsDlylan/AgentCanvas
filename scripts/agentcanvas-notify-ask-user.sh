#!/bin/bash
# ============================================================
# AgentCanvas PreToolUse Hook — AskUserQuestion
# ============================================================
# Sends a warning toast to the AgentCanvas UI when Claude Code
# invokes the AskUserQuestion tool and is blocked waiting on
# the user. Only fires when running inside an AgentCanvas
# terminal tile (AGENT_CANVAS_API is set).
#
# Because PreToolUse is synchronous, the curl call is
# backgrounded so the picker UI is not delayed by a slow or
# unresponsive canvas server.
#
# Installed by scripts/setup-claude-hook.sh into:
#   ~/.claude/scripts/agentcanvas-notify-ask-user.sh
# ============================================================

# Capture stdin (PreToolUse payload) so python3 can extract the
# question text. If stdin is empty or malformed we fall back to
# a generic body.
payload_in=$(cat)

# No-op outside AgentCanvas
[[ -z "$AGENT_CANVAS_API" ]] && exit 0

# Build JSON payload via python3 for safe escaping and to extract
# the question/header from the PreToolUse input envelope.
payload=$(AGENT_CANVAS_TERMINAL_ID="${AGENT_CANVAS_TERMINAL_ID:-}" \
          HOOK_STDIN="$payload_in" \
          python3 -c "
import json, os

raw = os.environ.get('HOOK_STDIN', '')
question = ''
header = ''
try:
    data = json.loads(raw) if raw else {}
    tool_input = data.get('tool_input') or {}
    question = (tool_input.get('question') or '').strip()
    header = (tool_input.get('header') or '').strip()
except Exception:
    pass

cwd = os.getcwd()
base = os.path.basename(cwd) or cwd
title = f'Claude needs input — {base}'

if header and question:
    body = f'{header}: {question}'
elif question:
    body = question
elif header:
    body = header
else:
    body = f'Question pending in {cwd}'

# Keep the toast body readable — truncate overly long questions.
if len(body) > 280:
    body = body[:277] + '...'

print(json.dumps({
    'title': title,
    'body': body,
    'level': 'warning',
    'terminalId': os.environ.get('AGENT_CANVAS_TERMINAL_ID', ''),
}))
" 2>/dev/null)

# Fall back to a minimal hand-built payload if python3 failed
if [[ -z "$payload" ]]; then
    payload="{\"title\":\"Claude needs input\",\"body\":\"Question pending\",\"level\":\"warning\",\"terminalId\":\"${AGENT_CANVAS_TERMINAL_ID:-}\"}"
fi

# Background the POST so the PreToolUse hook returns immediately
# and the picker UI is not delayed by a slow canvas server.
(curl -s -m 2 -X POST "$AGENT_CANVAS_API/api/notify" \
    -H 'Content-Type: application/json' \
    -d "$payload" > /dev/null 2>&1 || true) &

exit 0
