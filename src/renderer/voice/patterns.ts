// ── Voice command patterns (Tier 1 regex) ─────────────────
// All patterns operate on normalized transcripts (lowercase, no punctuation, no fillers).
// Patterns are checked in order — first match wins.

import type { VoiceCommandPattern } from './types'

export const patterns: VoiceCommandPattern[] = [
  // ── Mode switching (highest priority) ──
  { patterns: [/^start dictation$/], action: 'mode.startDictation' },
  { patterns: [/^stop dictation$/, /^end dictation$/], action: 'mode.stopDictation' },
  { patterns: [/^start standup$/], action: 'mode.startStandup' },
  { patterns: [/^end standup$/], action: 'mode.stopDictation' },

  // ── Undo ──
  { patterns: [/^undo$/], action: 'undo' },

  // ── Overlays ──
  { patterns: [/^show numbers$/], action: 'overlay.showNumbers' },
  { patterns: [/^show grid$/], action: 'overlay.showGrid' },
  { patterns: [/^focus (\d+)$/], action: 'overlay.focusNumber', extract: (m) => ({ number: parseInt(m[1], 10) }) },

  // ── Navigation ──
  { patterns: [/^go to workspace (.+)$/], action: 'navigate.workspace', extract: (m) => ({ name: m[1] }) },
  { patterns: [/^go to (.+)$/], action: 'navigate.tile', extract: (m) => ({ label: m[1] }) },
  { patterns: [/^zoom (in|out)$/], action: 'navigate.zoom', extract: (m) => ({ direction: m[1] }) },
  { patterns: [/^zoom to fit$/, /^show everything$/, /^fit view$/], action: 'navigate.fitAll' },

  // ── Tile spawning (creative = immediate) ──
  {
    patterns: [/^(?:spawn|new|open) (\d+) terminals?$/, /^(?:spawn|new|open) terminals? (\d+)$/],
    action: 'tile.spawnTerminal',
    extract: (m) => ({ count: parseInt(m[1], 10) })
  },
  {
    patterns: [/^spawn terminal$/, /^new terminal$/, /^open terminal$/],
    action: 'tile.spawnTerminal'
  },
  {
    patterns: [/^(?:spawn|new|open) (\d+) browsers?$/, /^(?:spawn|new|open) browsers? (\d+)$/],
    action: 'tile.spawnBrowser',
    extract: (m) => ({ count: parseInt(m[1], 10) })
  },
  {
    patterns: [/^(?:open|spawn) browser(?: to (.+))?$/, /^new browser(?: to (.+))?$/],
    action: 'tile.spawnBrowser',
    extract: (m) => (m[1] ? { url: m[1] } : {})
  },
  {
    patterns: [/^(?:create|new|open) (\d+) notes?$/, /^(?:create|new|open) notes? (\d+)$/],
    action: 'tile.spawnNote',
    extract: (m) => ({ count: parseInt(m[1], 10) })
  },
  {
    patterns: [/^create note$/, /^new note$/, /^open note$/],
    action: 'tile.spawnNote'
  },
  {
    patterns: [/^create draw$/, /^new draw$/, /^open draw$/],
    action: 'tile.spawnDraw'
  },
  {
    patterns: [/^rename (?:this )?to (.+)$/],
    action: 'tile.rename',
    extract: (m) => ({ label: m[1] })
  },

  // ── Tile destruction (destructive = confirm) ──
  {
    patterns: [/^close this$/, /^kill this$/, /^close focused$/],
    action: 'tile.closeFocused',
    destructive: true
  },
  {
    patterns: [/^close (.+)$/, /^kill (.+)$/],
    action: 'tile.closeByLabel',
    extract: (m) => ({ label: m[1] }),
    destructive: true
  },

  // ── Agent control ──
  {
    patterns: [/^start claude (?:code )?to (.+)$/],
    action: 'agent.startClaude',
    extract: (m) => ({ prompt: m[1] })
  },
  { patterns: [/^approve$/, /^yes$/, /^accept$/], action: 'agent.approve' },
  { patterns: [/^reject$/, /^no$/, /^deny$/], action: 'agent.reject' },
  {
    patterns: [/^(?:stop|interrupt|cancel)$/],
    action: 'agent.interrupt',
    destructive: true
  },
  {
    patterns: [/^send (.+) to (.+)$/],
    action: 'agent.sendTo',
    extract: (m) => ({ text: m[1], target: m[2] }),
    destructive: true
  },
  {
    patterns: [/^send (.+)$/],
    action: 'agent.sendInput',
    extract: (m) => ({ text: m[1] })
  },

  // ── Multi-agent (always confirm) ──
  {
    patterns: [/^tell all (.+) to (.+)$/],
    action: 'agent.broadcastTo',
    extract: (m) => ({ target: m[1], message: m[2] }),
    destructive: true
  },
  {
    patterns: [/^tell (.+) to (.+)$/],
    action: 'agent.tellTo',
    extract: (m) => ({ target: m[1], message: m[2] }),
    destructive: true
  },

  // ── Workflow triggers ──
  {
    patterns: [/^start (.+)$/, /^set up (.+)$/, /^launch (.+)$/],
    action: 'workflow.trigger',
    extract: (m) => ({ name: m[1] })
  },

  // ── Queries (always immediate) ──
  { patterns: [/^(?:whats|show) status$/, /^status$/], action: 'query.status' },
  {
    patterns: [/^whats (.+) doing$/],
    action: 'query.tileStatus',
    extract: (m) => ({ label: m[1] })
  },
  { patterns: [/^(?:any|are there) errors$/], action: 'query.errors' },

  // ── Notifications ──
  { patterns: [/^(?:go to )?(?:last )?unread$/], action: 'notify.goToUnread' },
  { patterns: [/^mark (?:all )?(?:notifications )?read$/], action: 'notify.markAllRead' },

  // ── Bare number (for overlay selection, lowest priority) ──
  { patterns: [/^(\d+)$/], action: 'overlay.focusNumber', extract: (m) => ({ number: parseInt(m[1]) }) },
]
