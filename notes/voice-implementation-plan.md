# Voice Features — Revised Implementation Plan

> Revised 2026-04-14 after design review. All decisions resolved.

## Design Decisions Log

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | STT host process | Electron `utilityProcess` | Zero-copy via Transferable, doesn't block main, native whisper.cpp speed |
| 2 | STT latency model | Hybrid batch-on-VAD-end | Listening animation during speech, batch transcribe on silence. 1-3s commands = ~800ms-1.5s |
| 3 | STT engines | Keep all three (Whisper + Vosk + Web Speech) | Different tools for different jobs. User selects in settings |
| 4 | Wake word engine | openWakeWord via ONNX (MIT) | Replaces Porcupine. No API key, no licensing issues |
| 5 | Wake word runtime | onnxruntime-node in utilityProcess | Same process as Whisper. Meyda for mel spectrogram DSP |
| 6 | LLM for Tier 3 intent | Local only — auto-discover LM Studio/Ollama | No Claude API. Probe localhost:1234 + 11434 on startup. Manual endpoint fallback |
| 7 | LLM output format | JSON mode + few-shot examples | Force valid JSON, 5-10 examples in system prompt |
| 8 | Canvas state access | Zustand store refactor (M0) | Extract allNodes, allEdges, focusedId, callbacks from Canvas.tsx |
| 9 | Audio routing | Dual-path MessagePort | Channel 1: continuous 80ms frames → wake word. Channel 2: batch speech → Whisper |
| 10 | Vosk process | Same utilityProcess | Single "voice engine" process hosts Whisper, Vosk, openWakeWord |
| 11 | Transcript normalization | Aggressive pipeline | lowercase → strip punctuation → remove fillers → collapse whitespace → trim |
| 12 | Agent command safety | Always confirm | Any command writing to another terminal shows target + message, requires Accept/Reject |
| 13 | Confirmation input | Voice + click, VAD gated | In CONFIRMING mode, only yes/no/cancel matched. VAD paused during any readback |
| 14 | TTS | CUT ENTIRELY | All feedback visual-only via VoiceIndicator pill. No echo cancellation needed |
| 15 | Dictation vs commands | Explicit mode toggle | "Start dictation" / "stop dictation" switches modes. DICTATING = all speech → notes |
| 16 | Command collision | Modal state machine | IDLE → LISTENING → CONFIRMING → DICTATING. Mode constrains active patterns |
| 17 | Agent lifecycle | Fire-and-forget + directed follow-ups | Voice spawns terminal and forgets. User explicitly directs follow-ups |
| 18 | Destructive action scope | Destructive = confirm, creative = immediate | close/kill/interrupt = confirm. spawn/navigate/zoom/rename = immediate |
| 19 | Undo scope | Only reversible actions | Undo: spawn, rename, navigate, zoom. No undo: close, agent input, approve |
| 20 | Mic permission | On first activation + settings retry | Request on first push-to-talk. Error with System Preferences link if denied |
| 21 | Broadcast scope | All workspaces with warning | Confirmation: "This will send to 5 terminals across 3 workspaces" |
| 22 | VoiceIndicator position | ReactFlow Panel, top-center | Consistent with existing overlay patterns |
| 23 | Number overlay | Spatial position, live | Ephemeral numbering left-to-right, top-to-bottom while overlay active |
| 24 | Ambient monitoring | Visual-only, user-configured per event type | Settings toggles for: waiting, error, exit, notification. No TTS |
| 25 | Workflow triggers | Extend WorkspaceTemplate | Add command, metadata, linkedTo, edges fields to existing template schema |
| 26 | Model storage | ~/AgentCanvas/models/, immutable | Download once, no auto-update. Versions pinned in code |
| 27 | Mel spectrogram | meyda library (~50KB) | Mature audio feature extraction, melSpectrogram out of the box |
| 28 | Testing | Unit tests + WAV audio fixtures | Unit test components independently. WAV fixtures for STT integration. Manual E2E |
| 29 | Ship strategy | M0 → alpha → M1-M12 → beta | Zustand refactor ships alone. All voice features ship together |
| 30 | Scope | Full M1-M12, no cuts | All milestones built and shipped as one beta release |

---

## Tech Stack (Revised)

| Component | Choice | Size | Why |
|---|---|---|---|
| **Audio Capture** | Web Audio API + AudioWorklet | 0 | Native to Electron's Chromium |
| **VAD** | @ricky0123/vad-web (Silero) | ~2 MB | Best accuracy, runs in renderer, fires onSpeechStart/End |
| **Wake Word** | openWakeWord ONNX models | ~5 MB | MIT license, runs via onnxruntime-node in utilityProcess |
| **STT (primary)** | whisper.cpp via whisper-node | 75 MB (tiny) | Best accuracy/size, offline, MIT, prompt biasing |
| **STT (fast path)** | vosk (npm) | 50 MB | Streaming + custom grammars for known commands |
| **STT (fallback)** | Web Speech API | 0 | Zero-dep fallback, needs internet |
| **Mel Spectrogram** | meyda | ~50 KB | Audio feature extraction for openWakeWord preprocessing |
| **Intent (Tier 1)** | Regex pattern matching | 0 | <50ms, handles 80% of commands |
| **Intent (Tier 2)** | Levenshtein fuzzy matching | 0 | <5ms, near-miss matching against known command corpus |
| **Intent (Tier 3)** | Local LLM (Ollama/LM Studio) | 0 (external) | 1-3s, complex/compound commands, fully local |
| **ONNX Runtime** | onnxruntime-node | ~15 MB | Shared runtime for wake word model |

### npm packages to install

```bash
# Core audio
npm install @ricky0123/vad-web

# STT
npm install whisper-node
npm install vosk

# ONNX runtime (wake word + future models)
npm install onnxruntime-node

# Audio DSP (mel spectrogram for wake word)
npm install meyda

# State management (M0 refactor)
npm install zustand
```

**Removed from original plan:**
- ~~@picovoice/porcupine-node~~ → replaced by openWakeWord ONNX
- ~~Piper~~ → TTS cut entirely
- ~~@anthropic-ai/sdk (for voice)~~ → local LLMs only

---

## Architecture

```
┌─ Renderer Process ──────────────────────────────────────┐
│                                                         │
│  getUserMedia → AudioWorklet (16kHz PCM)                │
│       │                                                 │
│       ├── Continuous 80ms frames ──→ MessagePort 1      │
│       │                             (wake word)         │
│       │                                                 │
│       └── Silero VAD                                    │
│            onSpeechEnd(Float32Array) → MessagePort 2    │
│                                       (STT batch)       │
│                                                         │
│  Zustand Store (useCanvasStore)                          │
│    ├── allNodes, allEdges, focusedId, tileWorkspaceMap  │
│    ├── spawn/kill/rename/navigate callbacks             │
│    └── consumed by Canvas.tsx + voice system            │
│                                                         │
│  Modal State Machine                                    │
│    IDLE → LISTENING → CONFIRMING → DICTATING            │
│                                                         │
│  Command Pipeline:                                      │
│    normalize(transcript)                                │
│      → regex match (Tier 1, <50ms)                      │
│      → Levenshtein fuzzy (Tier 2, <5ms)                 │
│      → local LLM via Ollama/LM Studio (Tier 3, 1-3s)   │
│                                                         │
│  VoiceIndicator (ReactFlow Panel, top-center)           │
│  VoiceNumberOverlay (spatial, ephemeral)                │
│  VoiceGridOverlay (3x3 recursive)                       │
│                                                         │
└─────────────────────────────────────────────────────────┘
          │ MessagePort (Transferable ArrayBuffers)
          ▼
┌─ utilityProcess ("voice engine") ───────────────────────┐
│                                                         │
│  openWakeWord (ONNX via onnxruntime-node + meyda)       │
│    ← 80ms frames via MessagePort 1                      │
│    → "wake" event when detected                         │
│                                                         │
│  Whisper (whisper-node / whisper.cpp)                    │
│    ← batch audio via MessagePort 2                      │
│    → transcript string                                  │
│                                                         │
│  Vosk (vosk npm, grammar-constrained)                   │
│    ← same audio path as Whisper                         │
│    → fast-path recognition for known commands            │
│                                                         │
│  Models: ~/AgentCanvas/models/ (immutable, pinned)      │
│                                                         │
└─────────────────────────────────────────────────────────┘

┌─ Main Process ──────────────────────────────────────────┐
│                                                         │
│  Spawns/manages utilityProcess on voice enable           │
│  Routes wake/transcript events to renderer via IPC      │
│  Local LLM discovery (probe :1234, :11434 on startup)   │
│  Model download management (~/AgentCanvas/models/)       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Milestone 0: Zustand Store Refactor (PREREQUISITE)

### Goal
Extract all tile state and callbacks from Canvas.tsx into a Zustand store so both Canvas rendering and the voice system can access canvas state cleanly.

### New Files

**`src/renderer/store/canvas-store.ts`** — Zustand store
```typescript
interface CanvasStore {
  // State
  allNodes: Node[]
  allEdges: Edge[]
  focusedId: string | null
  tileWorkspaceMap: Map<string, string>
  activeWorkspaceId: string

  // Tile management
  addTerminalAt: (position, width?, height?) => void
  addBrowserAt: (position, preset?) => void
  addNoteAt: (position) => void
  killTile: (sessionId: string) => void
  renameTile: (sessionId: string, label: string) => void
  focusTile: (sessionId: string) => void

  // Navigation
  setActiveWorkspace: (workspaceId: string) => void
  fitView: () => void
  setCenter: (x: number, y: number, zoom?: number) => void
  zoomIn: () => void
  zoomOut: () => void

  // Agent orchestration
  addTerminalForTerminal: (info: SpawnInfo) => void
  writeToTerminal: (sessionId: string, data: string) => void

  // Computed
  visibleNodes: () => Node[]
  getNodesByType: (type: string) => Node[]
  getNodesByStatus: (status: string) => Node[]
  getNodeByLabel: (label: string) => Node | null
}
```

### Existing Files to Modify

**`src/renderer/components/Canvas.tsx`** — Replace local state with `useCanvasStore()`. Canvas becomes a thin rendering layer that reads from the store and delegates mutations to store actions.

### Ship as alpha after this milestone.

---

## Milestone 1: Audio Infrastructure & Push-to-Talk

### Goal
Capture mic audio, detect speech boundaries, transcribe with Whisper in a utilityProcess, display transcript in a floating UI pill.

### New Files

**`src/renderer/voice/types.ts`** — Shared types
```typescript
// Voice state machine modes
type VoiceMode = 'idle' | 'listening' | 'processing' | 'confirming' | 'dictating'

interface VoiceSettings {
  enabled: boolean
  activationMode: 'push-to-talk' | 'wake-word' | 'always'
  sttProvider: 'whisper' | 'vosk' | 'web-speech'
  whisperModel: 'tiny' | 'base' | 'small'
  pushToTalkHotkey: string      // default 'Mod+Shift+V'
  wakeWord: string              // default 'canvas'
  audioFeedback: boolean
  language: string              // default 'en-US'
  // Local LLM
  llmEndpoint: string | null    // null = auto-discover
  llmModel: string | null       // null = use default
  // Ambient monitoring (per-event toggles)
  ambientMonitoring: {
    onWaiting: boolean
    onError: boolean
    onExit: boolean
    onNotification: boolean
  }
}

interface VoiceAction {
  type: string                  // e.g. 'tile.spawnTerminal'
  params: Record<string, any>
  destructive: boolean          // requires confirmation
  targets?: string[]            // sessionIds for agent commands
}

interface VoiceCommandPattern {
  patterns: RegExp[]
  action: string
  extract?: (match: RegExpMatchArray) => Record<string, any>
  destructive?: boolean
}

interface VoiceContext {
  focusedTileId: string | null
  focusedTileType: string | null
  focusedTileLabel: string | null
  visibleTiles: TileInfo[]
  allTiles: TileInfo[]
  workspaces: WorkspaceInfo[]
  activeWorkspace: string
  recentNotifications: NotificationInfo[]
  unreadCount: number
}

interface UndoableAction {
  action: VoiceAction
  undo: () => void
  timestamp: number
}
```

**`src/renderer/voice/audio-capture.ts`** — AudioWorklet mic capture
- `startMicCapture()` → returns MediaStream + AudioWorklet
- Captures 16kHz mono PCM (what Whisper/Vosk/openWakeWord expect)
- Handles getUserMedia permissions
- On permission denied: returns error with instructions for System Preferences

**`src/renderer/voice/vad.ts`** — VAD wrapper
- Wraps @ricky0123/vad-web MicVAD
- Fires `onSpeechStart` / `onSpeechEnd(audio: Float32Array)`
- Configurable thresholds (positiveSpeechThreshold, preSpeechPadFrames)
- Returns clean speech segments ready for STT

**`src/renderer/hooks/useVoice.ts`** — Main voice hook
- Manages modal state machine: IDLE → LISTENING → PROCESSING → CONFIRMING → DICTATING
- Push-to-talk: hold hotkey → start VAD → release → send to STT
- In CONFIRMING mode: only yes/no/cancel patterns matched
- In DICTATING mode: all speech → notes tile
- Exposes: `{ mode, transcript, startListening, stopListening, confirm, cancel }`
- Sends audio to utilityProcess via MessagePort for Whisper transcription

**`src/renderer/components/VoiceIndicator.tsx`** — Floating UI pill
- Positioned in ReactFlow Panel (top-center)
- States: dormant (mic icon), listening (pulsing blue), processing (spinner),
  success (green check + transcript), error (red X), confirming (amber + Accept/Reject buttons)
- Confirmation supports both voice (yes/no) and click
- Auto-dismisses after 3s on success

**`src/main/voice/utility-process.ts`** — Voice engine utilityProcess entry point
- Hosts Whisper, Vosk, and openWakeWord
- Dual MessagePort channels: wake word (continuous) + STT (batch)
- `transcribe(audioBuffer: Float32Array) → Promise<string>`
- Accepts initial prompt for domain biasing
- Model download on first use with progress callback
- Models stored at ~/AgentCanvas/models/ (immutable, pinned versions)

**`src/main/voice/whisper-stt.ts`** — Whisper integration (runs inside utilityProcess)
- Loads whisper-node with tiny/base/small model
- Batch transcription on VAD-end audio segments

### Existing Files to Modify

**`src/renderer/types/settings.ts`** — Add VoiceSettings to settings interface

**`src/renderer/hooks/useHotkeys.ts`** — Add `toggleVoice` hotkey action

**`src/preload/index.ts`** — Add voice IPC bridge
```typescript
voice: {
  transcribe: (audio: Float32Array) => ipcRenderer.invoke('voice:transcribe', audio),
  loadModel: (model: string) => ipcRenderer.invoke('voice:load-model', model),
  getModelStatus: () => ipcRenderer.invoke('voice:model-status'),
  discoverLLM: () => ipcRenderer.invoke('voice:discover-llm')
}
```

**`src/main/index.ts`** — Spawn utilityProcess, add voice IPC handlers

**`src/renderer/components/Canvas.tsx`** — Mount VoiceIndicator in ReactFlow Panel

### Data Flow
```
Mic (renderer) → AudioWorklet (16kHz PCM) → Silero VAD
  → onSpeechEnd(Float32Array) → MessagePort 2 to utilityProcess
  → whisper.cpp transcribe → transcript string back to renderer
  → normalize(transcript) → VoiceIndicator shows transcript
```

---

## Milestone 2: Command Pattern Matching (Tier 1)

### Goal
Parse transcripts into executable actions using fast regex patterns with aggressive normalization. Handle 80% of commands with <50ms latency.

### New Files

**`src/renderer/voice/normalize.ts`** — Transcript normalization pipeline
```typescript
function normalize(transcript: string): string {
  return transcript
    .toLowerCase()
    .replace(/[.,!?;:'"()\[\]{}]/g, '')     // strip punctuation
    .replace(/\b(uh|um|like|the|a|an|please|okay|so|well|just)\b/g, '') // remove fillers
    .replace(/\s+/g, ' ')                     // collapse whitespace
    .trim()
}
```

**`src/renderer/voice/patterns.ts`** — Command pattern definitions
```typescript
const patterns: VoiceCommandPattern[] = [
  // Navigation
  { patterns: [/^go to workspace (.+)/], action: 'navigate.workspace', extract: m => ({ name: m[1] }) },
  { patterns: [/^go to (.+)/], action: 'navigate.tile', extract: m => ({ label: m[1] }) },
  { patterns: [/^zoom (in|out)/], action: 'navigate.zoom', extract: m => ({ direction: m[1] }) },
  { patterns: [/^zoom to fit$/, /^show everything$/], action: 'navigate.fitAll' },

  // Tile management (creative = immediate)
  { patterns: [/^spawn terminal$/, /^new terminal$/], action: 'tile.spawnTerminal' },
  { patterns: [/^(?:open|spawn) browser(?: to (.+))?$/], action: 'tile.spawnBrowser' },
  { patterns: [/^create note$/, /^new note$/], action: 'tile.spawnNote' },
  { patterns: [/^rename (?:this )?to (.+)/], action: 'tile.rename', extract: m => ({ label: m[1] }) },

  // Tile management (destructive = confirm)
  { patterns: [/^close this$/, /^kill this$/], action: 'tile.closeFocused', destructive: true },
  { patterns: [/^close (.+)/, /^kill (.+)/], action: 'tile.closeByLabel', destructive: true },

  // Agent control (always confirm for writes)
  { patterns: [/^start claude (?:code )?to (.+)/], action: 'agent.startClaude', extract: m => ({ prompt: m[1] }) },
  { patterns: [/^approve$/, /^yes$/, /^accept$/], action: 'agent.approve' },
  { patterns: [/^reject$/, /^no$/, /^deny$/], action: 'agent.reject' },
  { patterns: [/^(?:stop|interrupt|cancel)$/], action: 'agent.interrupt', destructive: true },
  { patterns: [/^send (.+)/], action: 'agent.sendInput', extract: m => ({ text: m[1] }) },

  // Queries (always immediate)
  { patterns: [/^(?:whats|show) (?:the )?status$/, /^status$/], action: 'query.status' },
  { patterns: [/^whats? (?:is )?(.+) doing/], action: 'query.tileStatus', extract: m => ({ label: m[1] }) },
  { patterns: [/^(?:any|are there) errors/], action: 'query.errors' },

  // Notifications
  { patterns: [/^(?:go to )?(?:last )?unread/], action: 'notify.goToUnread' },
  { patterns: [/^mark (?:all )?(?:notifications )?read$/], action: 'notify.markAllRead' },

  // Multi-agent (always confirm)
  { patterns: [/^tell (.+) to (.+)/], action: 'agent.tellTo', destructive: true },

  // Overlays
  { patterns: [/^show numbers$/], action: 'overlay.showNumbers' },
  { patterns: [/^show grid$/], action: 'overlay.showGrid' },
  { patterns: [/^focus (\d+)$/], action: 'overlay.focusNumber', extract: m => ({ number: parseInt(m[1]) }) },

  // Mode switching
  { patterns: [/^start dictation$/], action: 'mode.startDictation' },
  { patterns: [/^stop dictation$/], action: 'mode.stopDictation' },

  // Undo (only reversible actions)
  { patterns: [/^undo$/], action: 'undo' },
]
```

**NOTE:** All patterns operate on normalized transcripts (lowercase, no punctuation, no fillers).

**`src/renderer/voice/command-router.ts`** — Routes transcript → action
- `matchCommand(transcript, context) → VoiceAction | null`
- Falls through tiers: regex match (Tier 1) → Levenshtein fuzzy (Tier 2) → local LLM (Tier 3)
- Respects modal state: in CONFIRMING, only yes/no/cancel. In DICTATING, route to notes.
- Builds VoiceContext from Zustand store for disambiguation

**`src/renderer/voice/action-executor.ts`** — Executes VoiceActions
- Maps action types to Zustand store callbacks
- Manages confirmation flow for destructive actions (sets mode to CONFIRMING)
- Pushes reversible actions to undo stack (spawn, rename, navigate, zoom)
- Returns visual feedback state for VoiceIndicator

### Existing Files to Modify

**`src/renderer/hooks/useVoice.ts`** — Wire up command router after transcription

---

## Milestone 3: Context-Aware Disambiguation

### Goal
Use canvas state (from Zustand store) to resolve ambiguous references ("this", "that one", "the waiting terminal").

### New Files

**`src/renderer/voice/context-builder.ts`** — Builds VoiceContext from Zustand store
- Resolves "this" → focusedId from store
- Resolves "the waiting one" → `store.getNodesByStatus('waiting')`
- Resolves "the browser" → if only one visible, unambiguous
- Resolves tile labels with Levenshtein distance fuzzy matching
- Falls back to "Which one?" → shows number overlay for disambiguation

**`src/renderer/voice/agent-resolver.ts`** — Multi-agent addressing
- Resolve by role: `metadata.team.role`
- Resolve by label: tile header text (fuzzy match)
- Resolve by team: `metadata.team.teamName`
- Resolve by state: idle/running/waiting
- Resolve by position: spatial queries on node coordinates

---

## Milestone 4: "Show Numbers" Overlay & Grid Navigation

### Goal
Overlay numbered badges on tiles for voice targeting. Grid overlay for canvas navigation.

### New Files

**`src/renderer/components/VoiceNumberOverlay.tsx`**
- When active, renders numbered badges on each visible tile
- Numbers assigned by spatial position: left-to-right, top-to-bottom
- Numbers are ephemeral — only exist while overlay is active
- User says "focus 3" → targets tile 3
- Dismisses after selection or 10s timeout

**`src/renderer/components/VoiceGridOverlay.tsx`**
- 3x3 numbered grid overlay on the canvas viewport
- "Show grid" activates, "5" pans to center, "1" to top-left
- Can repeat to zoom into sub-regions (recursive grid)
- "Cancel" or timeout dismisses

### Existing Files to Modify

**`src/renderer/components/Canvas.tsx`** — Mount overlay components

---

## Milestone 5: Wake Word + Always-On Mode

### Goal
Hands-free activation via "Hey Canvas" wake word using openWakeWord ONNX.

### New Files

**`src/main/voice/wake-word.ts`** — openWakeWord ONNX integration (runs in utilityProcess)
- Loads openWakeWord .onnx model via onnxruntime-node
- Audio preprocessing: 80ms frames → mel spectrogram via meyda → ONNX inference
- Emits 'wake' event when probability exceeds threshold
- Continuous processing via MessagePort 1 (12KB/s bandwidth)

**`src/renderer/voice/activation-modes.ts`** — Manages activation state machine
- Push-to-talk: hotkey hold → LISTENING → release → PROCESSING
- Wake word: continuous monitoring → wake detected → LISTENING for 10s → PROCESSING → back to monitoring
- Always-on: VAD triggers → LISTENING → silence → PROCESSING → repeat

### Architecture
```
Always-on audio stream (16kHz PCM)
  → MessagePort 1 → utilityProcess
  → meyda mel spectrogram → openWakeWord ONNX inference
  → "Hey Canvas" detected (probability > threshold)
  → IPC wake event to renderer
  → Activate Silero VAD + visual indicator
  → User speaks command
  → VAD detects end of speech → MessagePort 2 → Whisper
  → Transcript → command router → execute
  → Return to wake-word-only monitoring
```

### Existing Files to Modify

**`src/renderer/hooks/useVoice.ts`** — Handle activation mode switching

---

## Milestone 6: Vosk Fast Path + Custom Grammars

### Goal
Ultra-low-latency (~200ms) recognition for structured commands via Vosk in the utilityProcess.

### New Files

**`src/main/voice/vosk-stt.ts`** — Vosk streaming STT (runs in utilityProcess)
- Loads small English model (50 MB) from ~/AgentCanvas/models/
- Custom grammar mode: restrict to known command phrases
- Streaming: returns partial results as user speaks
- Falls back to Whisper for unrecognized speech

### Grammar Definition
```json
["spawn terminal", "open browser", "create note", "close this",
 "zoom in", "zoom out", "zoom to fit", "show numbers", "show grid",
 "go to workspace", "approve", "reject", "stop", "interrupt",
 "status", "whats running", "mark all read",
 "undo", "cancel", "start dictation", "stop dictation",
 "yes", "no"]
```

### Routing Logic
```
Audio → Vosk (grammar mode, streaming, 200ms)
  → Recognized from grammar? Execute immediately
  → Not in grammar? Route to Whisper (full transcription, 800ms-1.5s)
  → Whisper transcript → normalize → regex → Levenshtein → local LLM
```

---

## Milestone 7: Multi-Agent Voice Routing

### Goal
Direct commands to specific agents by name, role, team, or state. All agent-directed commands require confirmation.

### Command Examples
```
"Tell the security reviewer to also check API endpoints"
  → resolve "security reviewer" by label/role
  → confirm: "Send to Security Reviewer: 'also check API endpoints'?"
  → write "Also check API endpoints\n" to that terminal

"Send yes to the waiting terminal"
  → find terminal with status === 'waiting'
  → confirm: "Send 'y' to [terminal label]?"
  → write "y\n"

"Tell all code-review agents to wrap up"
  → find all terminals with metadata.team.teamName === 'code-review'
  → confirm: "This will send to 3 terminals across 2 workspaces. Proceed?"
  → write instruction to each
```

### New Files

**`src/renderer/voice/multi-agent.ts`** — Agent routing logic
- `resolveAgentRef(reference, context) → sessionId[]`
- `routeToAgent(sessionId, text)` — writes to terminal via Zustand store
- `broadcastToAgents(sessionIds, text)` — writes to multiple
- All agent commands require confirmation (always-confirm rule)
- Broadcast crosses workspace boundaries with explicit warning

---

## Milestone 8: Ambient Visual Monitoring

### Goal
Visual monitoring of canvas status changes. No TTS — all feedback via VoiceIndicator pill and existing status badges.

### New Files

**`src/renderer/voice/ambient-monitor.ts`** — Watches for status changes
- Monitors notification store for new notifications
- Monitors terminal status changes (idle → running, running → waiting)
- Surfaces events via VoiceIndicator pill (brief flash notification)
- User-configured per event type in settings:
  - `onWaiting`: flash when terminal enters 'waiting' state
  - `onError`: flash when error notification arrives
  - `onExit`: flash when terminal exits
  - `onNotification`: flash for any notification

---

## Milestone 9: Local LLM Complex Commands (Tier 3)

### Goal
Handle compound, multi-step, and ambiguous commands via local LLM (Ollama/LM Studio). Fully offline.

### New Files

**`src/renderer/voice/llm-router.ts`** — Local LLM integration
- Auto-discovers LM Studio (localhost:1234) and Ollama (localhost:11434) on startup
- Manual endpoint override in settings
- Uses OpenAI-compatible API (both LM Studio and Ollama support it)
- JSON mode enabled (`format: "json"`) to force valid JSON output
- System prompt with 5-10 few-shot examples covering common compound commands
- Returns structured VoiceAction[] with steps

**`src/main/voice/llm-discovery.ts`** — LLM endpoint discovery (runs in main process)
- Probes localhost:1234/v1/models (LM Studio) and localhost:11434/api/tags (Ollama) on startup
- Returns available models and endpoints
- Caches result, re-probes on settings change or manual refresh

### System Prompt Structure
```
You are the voice command interpreter for AgentCanvas, an infinite canvas app
with terminal, browser, and note tiles.

Given a voice transcript and the current canvas state, return a JSON action plan.

Available actions:
- tile.spawnTerminal: { label?: string }
- tile.spawnBrowser: { url?: string }
- tile.closeFocused: {}
- agent.startClaude: { prompt: string }
- navigate.workspace: { name: string }
- ... [all action types]

## Examples

Transcript: "set up a code review team for auth"
State: { activeWorkspace: "default", focusedTileId: "term-1" }
Response:
{
  "steps": [
    { "type": "tile.spawnTerminal", "params": { "label": "Security Reviewer", "command": "claude -p 'Review src/auth for security vulnerabilities'" } },
    { "type": "tile.spawnTerminal", "params": { "label": "Performance Reviewer", "command": "claude -p 'Review src/auth for performance issues'" } },
    { "type": "tile.spawnTerminal", "params": { "label": "Test Coverage", "command": "claude -p 'Check test coverage for src/auth'" } }
  ],
  "confirmation": "Spawn 3 review agents for auth?",
  "destructive": false
}

[... 4-9 more examples ...]

Current state: {VoiceContext JSON}
Transcript: "{user's speech}"
```

---

## Milestone 10: Voice Annotations & Rubber Duck Mode

### Goal
Voice notes linked to tiles, continuous transcription for debugging narration. Uses explicit mode toggle to avoid command/dictation conflicts.

### New Features

**Voice Annotations**
- Hold annotation hotkey (e.g., `Mod+Shift+N`) + speak
- Transcribed text spawns as a NotesTile linked to the focused terminal
- Note includes timestamp and source tile label
- Single utterance → single note

**Rubber Duck Mode** (uses DICTATING mode from state machine)
- "Start dictation" → switches to DICTATING mode
- Creates or targets a notes tile for continuous transcription
- ALL speech goes to the notes tile, no command matching
- Everything spoken is appended as timestamped entries
- "Stop dictation" → switches back to IDLE mode, note persists

**Voice Standup**
- "Start standup" → creates a new note titled "Standup — [date]", enters DICTATING mode
- Speak status updates, transcribed into the note
- "End standup" → finalizes note, returns to IDLE

---

## Milestone 11: Voice Workflow Triggers

### Goal
Trigger pre-configured workspace templates by voice. Extends existing WorkspaceTemplate schema.

### Examples
```
"Start code review team" → spawns template with 3 linked agents
"Start security audit" → spawns security-focused agent team
"Set up debugging workspace" → spawns terminal + browser + devtools
```

### Schema Extension
```typescript
interface WorkspaceTemplate {
  // Existing fields
  tiles: TemplateTile[]

  // New fields for voice triggers
  voiceTrigger?: string           // phrase that activates this template
  tiles: (TemplateTile & {
    command?: string              // auto-run command after shell init
    metadata?: Record<string, any> // team metadata, role, etc.
    linkedTo?: string             // reference to another tile in template (by index or label)
  })[]
}
```

### Integration
- Voice command "start [template name]" matches against voiceTrigger fields
- Uses existing terminal spawn API with linkedTerminalId
- Leverages radial fan layout for team visualization

---

## Milestone 12: Settings UI & Model Management

### Goal
Full settings panel for voice configuration.

### New Files

**`src/renderer/components/settings/VoiceSettingsPanel.tsx`**
- Enable/disable voice
- Activation mode toggle (push-to-talk / wake word / always)
- STT provider selection (Whisper / Vosk / Web Speech)
- Whisper model size selector with download progress bar
- Wake word sensitivity slider
- Push-to-talk hotkey binding
- Ambient monitoring toggles (per-event: waiting, error, exit, notification)
- Local LLM endpoint configuration (auto-discovered + manual override)
- Local LLM model selection (from discovered models)
- Language selection
- Test button (speak and see transcript + matched command)

**Model management in main process:**
- Download Whisper models on demand with progress bar
- Download Vosk model on demand
- Download openWakeWord ONNX model on demand
- Store at ~/AgentCanvas/models/ (immutable, versions pinned in code)
- Show model status (downloaded, size, current)

---

## Build Order (Revised Dependency Graph)

```
M0: Zustand Store Refactor ← SHIP AS ALPHA
 │
 └──→ M1-M12: All voice features (ship together as beta)
       │
       │  Build order (internal dependencies):
       │
       M1: Audio + Push-to-Talk + Whisper utilityProcess + Indicator
       │
       ├─→ M2: Pattern Matching + Normalization
       │    │
       │    ├─→ M3: Context Disambiguation
       │    │    │
       │    │    ├─→ M7: Multi-Agent Routing
       │    │    └─→ M9: Local LLM Commands (Tier 3)
       │    │
       │    ├─→ M4: Number Overlay + Grid Nav
       │    │
       │    ├─→ M10: Voice Annotations + Rubber Duck
       │    │
       │    └─→ M11: Workflow Triggers
       │
       ├─→ M5: Wake Word (openWakeWord ONNX + meyda)
       │
       ├─→ M6: Vosk Fast Path
       │
       ├─→ M8: Ambient Visual Monitoring
       │
       └─→ M12: Settings UI + Model Management (depends on all features being defined)
```

---

## File Summary (Revised)

### New files (20)
```
src/renderer/store/canvas-store.ts              — M0: Zustand store
src/renderer/voice/types.ts                     — M1: Shared types
src/renderer/voice/audio-capture.ts             — M1: AudioWorklet mic capture
src/renderer/voice/vad.ts                       — M1: VAD wrapper
src/renderer/voice/normalize.ts                 — M2: Transcript normalization
src/renderer/voice/patterns.ts                  — M2: Regex command patterns
src/renderer/voice/command-router.ts            — M2: Tier 1/2/3 routing
src/renderer/voice/action-executor.ts           — M2: Execute actions via Zustand store
src/renderer/voice/context-builder.ts           — M3: Build VoiceContext from store
src/renderer/voice/agent-resolver.ts            — M3: Multi-agent addressing
src/renderer/voice/multi-agent.ts               — M7: Agent routing + broadcast
src/renderer/voice/activation-modes.ts          — M5: PTT / wake word / always-on
src/renderer/voice/ambient-monitor.ts           — M8: Visual status monitoring
src/renderer/voice/llm-router.ts                — M9: Local LLM integration
src/renderer/hooks/useVoice.ts                  — M1: Main voice hook
src/renderer/components/VoiceIndicator.tsx       — M1: Floating UI pill
src/renderer/components/VoiceNumberOverlay.tsx   — M4: Number overlay
src/renderer/components/VoiceGridOverlay.tsx     — M4: Grid overlay
src/renderer/components/settings/VoiceSettingsPanel.tsx — M12: Voice settings
src/main/voice/utility-process.ts               — M1: Voice engine entry point
src/main/voice/whisper-stt.ts                   — M1: Whisper (in utilityProcess)
src/main/voice/vosk-stt.ts                      — M6: Vosk (in utilityProcess)
src/main/voice/wake-word.ts                     — M5: openWakeWord ONNX (in utilityProcess)
src/main/voice/llm-discovery.ts                 — M9: LLM endpoint discovery
```

### Existing files to modify (7)
```
src/renderer/types/settings.ts        — Add VoiceSettings
src/renderer/hooks/useHotkeys.ts      — Add voice hotkey actions
src/renderer/hooks/useSettings.tsx     — Voice settings defaults
src/renderer/components/Canvas.tsx     — M0: Zustand refactor + mount voice components
src/preload/index.ts                   — Add voice IPC bridge
src/main/index.ts                      — Spawn utilityProcess, add voice IPC handlers
src/main/canvas-api.ts                 — Optional voice endpoints
```

### Removed from original plan
```
src/renderer/voice/tts.ts             — TTS cut entirely
```
