#!/bin/bash
# ============================================================
# AgentCanvas Stop Hook — Plan Verifier Verdict Parser
# ============================================================
# Runs on every Claude Code Stop event. No-ops unless the
# session is a plan-verifier (AGENT_CANVAS_PLAN_ROLE=verifier and
# AGENT_CANVAS_PLAN_ID set). When active, reads the session
# transcript from the Stop payload, extracts the last assistant
# message, parses a <verdict>...</verdict> JSON block, and POSTs
# the verdict to /api/plan/verify/complete.
#
# Installed by scripts/setup-claude-hook.sh into:
#   ~/.claude/scripts/agentcanvas-verify-stop.sh
# ============================================================

payload_in=$(cat)

# No-op outside AgentCanvas
[[ -z "$AGENT_CANVAS_API" ]] && exit 0

# No-op unless this is a verifier session
[[ "${AGENT_CANVAS_PLAN_ROLE:-}" != "verifier" ]] && exit 0
[[ -z "${AGENT_CANVAS_PLAN_ID:-}" ]] && exit 0

# Extract transcript path from Stop payload, load last assistant message,
# find <verdict>JSON</verdict>, POST to the canvas API.
AGENT_CANVAS_API="$AGENT_CANVAS_API" \
AGENT_CANVAS_PLAN_ID="$AGENT_CANVAS_PLAN_ID" \
HOOK_STDIN="$payload_in" \
python3 - <<'PYEOF' &
import json, os, re, sys, urllib.request

raw = os.environ.get('HOOK_STDIN', '')
plan_id = os.environ.get('AGENT_CANVAS_PLAN_ID', '')
api_base = os.environ.get('AGENT_CANVAS_API', '').rstrip('/')

if not plan_id or not api_base:
    sys.exit(0)

try:
    payload = json.loads(raw) if raw else {}
except Exception:
    payload = {}

transcript_path = payload.get('transcript_path') or ''
if not transcript_path or not os.path.exists(transcript_path):
    sys.exit(0)

# JSONL transcript — walk backward for the last assistant message content.
last_assistant_text = ''
try:
    with open(transcript_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    for line in reversed(lines):
        try:
            entry = json.loads(line)
        except Exception:
            continue
        # Transcript format: {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}} or similar.
        role = entry.get('role') or entry.get('type') or ''
        if role != 'assistant':
            # Some transcripts nest under "message"
            msg = entry.get('message') or {}
            if msg.get('role') != 'assistant':
                continue
            entry = msg
        content = entry.get('content')
        if isinstance(content, str):
            last_assistant_text = content
            break
        if isinstance(content, list):
            texts = []
            for part in content:
                if isinstance(part, dict) and part.get('type') == 'text' and 'text' in part:
                    texts.append(part['text'])
            if texts:
                last_assistant_text = '\n'.join(texts)
                break
except Exception:
    sys.exit(0)

if not last_assistant_text:
    sys.exit(0)

# Extract <verdict>{...}</verdict> JSON block.
m = re.search(r'<verdict>\s*(\{.*?\})\s*</verdict>', last_assistant_text, re.DOTALL)
if not m:
    # Post a warning back to the canvas so the user knows.
    warn_body = {
        'title': 'Plan verifier: no verdict block',
        'body': f'The verifier for plan {plan_id[:8]} did not emit a <verdict> block. Plan state unchanged.',
        'level': 'warning',
        'terminalId': ''
    }
    try:
        req = urllib.request.Request(
            f'{api_base}/api/notify',
            data=json.dumps(warn_body).encode('utf-8'),
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        urllib.request.urlopen(req, timeout=3).read()
    except Exception:
        pass
    sys.exit(0)

try:
    verdict = json.loads(m.group(1))
except Exception:
    sys.exit(0)

# Validate verdict shape.
if verdict.get('severity') not in ('none', 'minor', 'major'):
    sys.exit(0)

# The critique is everything before the verdict block.
critique_md = last_assistant_text[:m.start()].strip()
if not critique_md:
    critique_md = verdict.get('summary', '')

body = {
    'planId': plan_id,
    'verdict': verdict,
    'critiqueMarkdown': critique_md
}
try:
    req = urllib.request.Request(
        f'{api_base}/api/plan/verify/complete',
        data=json.dumps(body).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    urllib.request.urlopen(req, timeout=5).read()
except Exception:
    pass
PYEOF

exit 0
