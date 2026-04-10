#!/bin/bash
# ============================================================
# AgentCanvas — Notification System Test Helper
# ============================================================
# Fires a curated sequence of notifications through the Canvas
# API so you can exercise every code path without needing a
# Claude Code stop hook.
#
# Run this from inside an AgentCanvas terminal tile so that
# $AGENT_CANVAS_API and $AGENT_CANVAS_TERMINAL_ID are set.
#
# Usage:
#   ./scripts/test-notifications.sh              # run all tests
#   ./scripts/test-notifications.sh basic        # one of each level
#   ./scripts/test-notifications.sh burst        # stacking cap test
#   ./scripts/test-notifications.sh other        # notify another tile
#   ./scripts/test-notifications.sh background   # test native OS notif
# ============================================================

set -e

if [[ -z "$AGENT_CANVAS_API" ]]; then
    echo "error: AGENT_CANVAS_API is not set — run this from an AgentCanvas terminal tile"
    exit 1
fi

if ! command -v python3 &>/dev/null; then
    echo "error: python3 is required"
    exit 1
fi

# Helper: post a notification with python3-built JSON (safe escaping)
notify() {
    local title="$1"
    local body="$2"
    local level="${3:-info}"
    local terminal_id="${4:-}"

    local payload
    payload=$(TITLE="$title" BODY="$body" LEVEL="$level" TID="$terminal_id" python3 -c "
import json, os
print(json.dumps({
    'title': os.environ['TITLE'],
    'body': os.environ['BODY'],
    'level': os.environ['LEVEL'],
    'terminalId': os.environ['TID'] or None,
}))
")

    curl -s -X POST "$AGENT_CANVAS_API/api/notify" \
        -H 'Content-Type: application/json' \
        -d "$payload" > /dev/null
    echo "  sent: [$level] $title — $body"
}

# ── Test scenarios ──────────────────────────────────────

test_basic() {
    echo "→ Basic: one notification of each level"
    notify "Info test" "general information message" info "$AGENT_CANVAS_TERMINAL_ID"
    sleep 0.3
    notify "Success test" "task completed successfully" success "$AGENT_CANVAS_TERMINAL_ID"
    sleep 0.3
    notify "Warning test" "something looks off" warning "$AGENT_CANVAS_TERMINAL_ID"
    sleep 0.3
    notify "Error test" "this one is sticky" error "$AGENT_CANVAS_TERMINAL_ID"
    echo "  ✓ expect: 4 toasts stacked, bell badge = 4, red '4' on this tile"
}

test_burst() {
    echo "→ Burst: 8 notifications rapidly (stacking cap is 5)"
    for i in 1 2 3 4 5 6 7 8; do
        notify "Burst $i" "rapid notification $i" success "$AGENT_CANVAS_TERMINAL_ID"
    done
    echo "  ✓ expect: max 5 visible toasts, older ones auto-dismissed"
}

test_other() {
    echo "→ Cross-tile: notify a different terminal tile"
    local other_id
    other_id=$(curl -s "$AGENT_CANVAS_API/api/status" | TID="$AGENT_CANVAS_TERMINAL_ID" python3 -c "
import json, sys, os
d = json.load(sys.stdin)
me = os.environ['TID']
others = [t['id'] for t in d.get('terminals', []) if t['id'] != me]
print(others[0] if others else '')
")
    if [[ -z "$other_id" ]]; then
        echo "  ⚠ no other terminal tile found — open a second terminal with Cmd+T and retry"
        return
    fi
    notify "Attention here" "red badge should appear on a different tile" warning "$other_id"
    echo "  ✓ expect: red badge on the OTHER terminal tile, not this one"
}

test_background() {
    echo "→ Background: fires in 3s — switch focus away from AgentCanvas"
    sleep 3
    notify "Background task done" "should also fire a native OS notification" success "$AGENT_CANVAS_TERMINAL_ID"
    echo "  ✓ expect: in-app toast + native macOS notification"
}

test_no_terminal() {
    echo "→ No terminalId: toast without click-to-focus"
    notify "Orphan notification" "no terminalId — not clickable for focus" info ""
    echo "  ✓ expect: toast shows but clicking it won't navigate"
}

test_long_content() {
    echo "→ Long content: verify wrapping"
    notify "A fairly long title that tests wrap behavior" \
        "This is a longer body message. It should wrap across multiple lines inside the toast and look reasonable without overflowing the container. Lorem ipsum dolor sit amet." \
        info "$AGENT_CANVAS_TERMINAL_ID"
    echo "  ✓ expect: toast expands vertically, text wraps cleanly"
}

# ── Main ────────────────────────────────────────────────

case "${1:-all}" in
    basic)      test_basic ;;
    burst)      test_burst ;;
    other)      test_other ;;
    background) test_background ;;
    orphan)     test_no_terminal ;;
    long)       test_long_content ;;
    all)
        test_basic
        echo
        sleep 1
        test_no_terminal
        echo
        sleep 1
        test_long_content
        echo
        sleep 1
        test_burst
        echo
        sleep 1
        test_other
        echo
        echo "→ Skipped 'background' (run separately: $0 background)"
        echo
        echo "All tests fired. Check:"
        echo "  • bell badge count in the titlebar"
        echo "  • red unread badges on tile entries in Process Panel"
        echo "  • red unread badges on tile entries in Workspace Panel"
        echo "  • red aggregate badge on the workspace header"
        echo "  • click the bell to see the full list"
        echo "  • click a tile to clear its unread count"
        ;;
    *)
        echo "Usage: $0 [all|basic|burst|other|background|orphan|long]"
        exit 1
        ;;
esac
