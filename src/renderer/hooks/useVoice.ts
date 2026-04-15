import { useState, useCallback, useRef, useEffect } from 'react'
import type { VoiceMode, VoiceSettings, VoiceAction } from '@/voice/types'
import { createVAD, type VADInstance } from '@/voice/vad'
import { matchCommand } from '@/voice/command-router'
import { executeAction } from '@/voice/action-executor'
import { buildContext } from '@/voice/context-builder'
import { useCanvasStore } from '@/store/canvas-store'
import { defaultTileWidth, defaultTileHeight } from '@/store/canvas-store'
import { createActivationController, type ActivationController } from '@/voice/activation-modes'
import { loadVoskModel, transcribeWithVosk, getVoskStatus } from '@/voice/vosk-stt'
import { createAmbientMonitor, type AmbientMonitor } from '@/voice/ambient-monitor'
import { createDictationNote, createStandupNote, appendToDictation, createVoiceAnnotation } from '@/voice/voice-notes'
import { createDictationStream, type DictationStreamInstance } from '@/voice/dictation-stream'
import { routeViaLLM } from '@/voice/llm-router'
import type { NumberedTile } from '@/components/VoiceNumberOverlay'

export interface UseVoiceReturn {
  mode: VoiceMode
  transcript: string | null
  error: string | null
  listeningSecondsLeft: number | null
  startListening: () => void
  stopListening: () => void
  confirm: () => void
  cancel: () => void
  // Overlay state
  numberOverlayActive: boolean
  gridOverlayActive: boolean
  numberedTiles: NumberedTile[]
  dismissOverlay: () => void
  selectGridRegion: (region: number) => void
  // Dictation stream state
  dictationStreamActive: boolean
  dictationStreamText: string
  dictationStreamSpeaking: boolean
  dictationStreamComplete: boolean
  dictationStreamConfirming: boolean
  dictationStreamConfirmMsg: string | null
  dictationStreamHeardText: string | null
  sendDictationStream: (text: string) => void
  cancelDictationStream: () => void
  stopDictationStream: () => void
  confirmDictationStream: () => void
  rejectDictationStream: () => void
}

export function useVoice(settings: VoiceSettings): UseVoiceReturn {
  const [mode, setMode] = useState<VoiceMode>('idle')
  const [transcript, setTranscript] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [listeningSecondsLeft, setListeningSecondsLeft] = useState<number | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Overlay state
  const [numberOverlayActive, setNumberOverlayActive] = useState(false)
  const [gridOverlayActive, setGridOverlayActive] = useState(false)
  const [numberedTiles, setNumberedTiles] = useState<NumberedTile[]>([])
  const numberMapRef = useRef<Map<number, string>>(new Map())

  // Activation controller (manages VAD + audio stream lifecycle per mode)
  const controllerRef = useRef<ActivationController | null>(null)
  // Fallback VAD ref for push-to-talk (backward compat)
  const vadRef = useRef<VADInstance | null>(null)
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const modelReady = useRef(false)
  const modeRef = useRef<VoiceMode>(mode)
  modeRef.current = mode

  // Pending destructive action waiting for confirmation
  const pendingAction = useRef<VoiceAction | null>(null)

  // Dictation state (note-based)
  const dictationNoteId = useRef<string | null>(null)

  // Dictation stream state
  const [dsActive, setDsActive] = useState(false)
  const [dsText, setDsText] = useState('')
  const [dsSpeaking, setDsSpeaking] = useState(false)
  const [dsComplete, setDsComplete] = useState(false)
  const [dsConfirming, setDsConfirming] = useState(false)
  const [dsConfirmMsg, setDsConfirmMsg] = useState<string | null>(null)
  const [dsHeardText, setDsHeardText] = useState<string | null>(null)
  const dsRef = useRef<DictationStreamInstance | null>(null)
  const baseModelReady = useRef(false)

  // Wake word verified flag — stays true until system returns to wake monitoring
  const wakeWordVerifiedRef = useRef(false)

  // Track activation mode to detect changes
  const activationModeRef = useRef(settings.activationMode)

  // Ensure Whisper model is downloaded before first transcription
  useEffect(() => {
    if (!settings.enabled) return
    window.voice.getModelStatus().then((models) => {
      const target = models.find((m) => m.model === settings.whisperModel)
      if (target?.downloaded) {
        modelReady.current = true
      }
    })
  }, [settings.enabled, settings.whisperModel])

  // Listening countdown timer (5 min max)
  useEffect(() => {
    if (mode === 'listening') {
      setListeningSecondsLeft(300)
      countdownRef.current = setInterval(() => {
        setListeningSecondsLeft((prev) => (prev !== null && prev > 0 ? prev - 1 : null))
      }, 1000)
    } else {
      setListeningSecondsLeft(null)
      if (countdownRef.current) {
        clearInterval(countdownRef.current)
        countdownRef.current = null
      }
    }
    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current)
        countdownRef.current = null
      }
    }
  }, [mode])

  // Clear error/transcript after display; reset wake word verification on idle
  useEffect(() => {
    if (mode === 'idle') {
      wakeWordVerifiedRef.current = false
      if (transcript || error) {
        cleanupTimerRef.current = setTimeout(() => {
          setTranscript(null)
          setError(null)
        }, 4000)
      }
    }
    return () => {
      if (cleanupTimerRef.current) clearTimeout(cleanupTimerRef.current)
    }
  }, [mode, transcript, error])

  // ── Wake word event listener ──
  useEffect(() => {
    if (!settings.enabled || settings.activationMode !== 'wake-word') return

    const unsubscribe = window.voice.onWakeWordDetected(() => {
      setMode('listening')
      setTranscript(null)
      setError(null)
      wakeWordVerifiedRef.current = true  // ONNX model already verified the wake word
      // The activation controller handles starting VAD on wake
      controllerRef.current?.handleWakeEvent()
    })

    return unsubscribe
  }, [settings.enabled, settings.activationMode])

  // ── Initialize activation controller for wake-word and always-on modes ──
  useEffect(() => {
    if (!settings.enabled) return
    if (settings.activationMode === 'push-to-talk') return

    // Activation mode changed — rebuild controller
    if (controllerRef.current && activationModeRef.current !== settings.activationMode) {
      controllerRef.current.destroy()
      controllerRef.current = null
    }
    activationModeRef.current = settings.activationMode

    const initController = async () => {
      // For wake-word mode, ensure models are loaded
      if (settings.activationMode === 'wake-word') {
        const result = await window.voice.startWakeWordEngine(settings.wakeWord)
        if (!result.ok) {
          setError(result.error ?? 'Wake word engine failed to start')
          return
        }
      }

      const controller = createActivationController(settings.activationMode, {
        onSpeechStart: () => {},
        onSpeechEnd: (audio) => {
          transcribeAudio(audio)
        },
        onVADMisfire: () => {},
        onWakeWordDetected: () => {
          setMode('listening')
          setTranscript(null)
        }
      }, settings.inputDeviceId)

      controllerRef.current = controller

      try {
        await controller.start()
        if (settings.activationMode === 'always') {
          setMode('listening')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start voice')
      }
    }

    initController()

    return () => {
      if (controllerRef.current) {
        controllerRef.current.destroy()
        controllerRef.current = null
      }
      if (settings.activationMode === 'wake-word') {
        window.voice.stopWakeWordEngine()
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.enabled, settings.activationMode, settings.wakeWord])

  const dismissOverlay = useCallback(() => {
    setNumberOverlayActive(false)
    setGridOverlayActive(false)
    setNumberedTiles([])
    numberMapRef.current.clear()
  }, [])

  const activateNumberOverlay = useCallback(() => {
    const store = useCanvasStore.getState()
    const visible = store.getVisibleNodes()

    // Sort spatially: top-to-bottom, left-to-right
    const sorted = [...visible].sort((a, b) => {
      const rowDiff = a.position.y - b.position.y
      if (Math.abs(rowDiff) > 50) return rowDiff
      return a.position.x - b.position.x
    })

    const tiles: NumberedTile[] = sorted.map((node, i) => {
      const data = node.data as Record<string, unknown>
      const sessionId = data.sessionId as string
      return {
        number: i + 1,
        sessionId,
        label: (data.label as string) ?? '',
        position: node.position,
        width: (node.style?.width as number) ?? defaultTileWidth(node.type),
        height: (node.style?.height as number) ?? defaultTileHeight(node.type)
      }
    })

    const map = new Map<number, string>()
    for (const t of tiles) map.set(t.number, t.sessionId)
    numberMapRef.current = map

    setNumberedTiles(tiles)
    setNumberOverlayActive(true)
    setGridOverlayActive(false)
  }, [])

  const handleNumberSelection = useCallback((num: number) => {
    const sessionId = numberMapRef.current.get(num)
    if (sessionId) {
      useCanvasStore.getState().focusTile(sessionId)
      setTranscript(`Focused #${num}`)
    } else {
      setError(`No tile #${num}`)
    }
    dismissOverlay()
    setMode('idle')
  }, [dismissOverlay])

  const selectGridRegion = useCallback((region: number) => {
    if (region < 1 || region > 9) return
    const store = useCanvasStore.getState()
    const instance = store.reactFlowInstance
    if (!instance) return

    const viewport = instance.getViewport()
    const flowEl = document.querySelector('.react-flow') as HTMLElement
    if (!flowEl) return
    const { width, height } = flowEl.getBoundingClientRect()

    const visibleWidth = width / viewport.zoom
    const visibleHeight = height / viewport.zoom
    const flowLeft = -viewport.x / viewport.zoom
    const flowTop = -viewport.y / viewport.zoom

    const col = ((region - 1) % 3)
    const row = Math.floor((region - 1) / 3)
    const cellWidth = visibleWidth / 3
    const cellHeight = visibleHeight / 3

    const centerX = flowLeft + cellWidth * col + cellWidth / 2
    const centerY = flowTop + cellHeight * row + cellHeight / 2

    instance.setCenter(centerX, centerY, { duration: 400, zoom: viewport.zoom })
    setTranscript(`Grid ${region}`)
    dismissOverlay()
    setMode('idle')
  }, [dismissOverlay])

  const processCommand = useCallback(async (text: string) => {
    // Use dictationNoteId to detect dictation — modeRef may be 'processing' during transcription
    const isDictating = !!dictationNoteId.current
    const effectiveMode: VoiceMode = isDictating ? 'dictating' : modeRef.current

    const context = buildContext()
    const result = await matchCommand(text, effectiveMode, context, settings.wakeWord)

    if (!result) {
      // In dictating mode, append speech to the dictation note (use raw text)
      if (isDictating && dictationNoteId.current) {
        appendToDictation(dictationNoteId.current, text)
        setTranscript(text)
        setMode('dictating')
        // Restart VAD for next utterance
        if (vadRef.current) vadRef.current.start()
        return
      }

      setTranscript(text)
      setMode('idle')
      controllerRef.current?.handleTranscriptionComplete()
      return
    }

    // Handle confirmation responses
    if (result.action.type === 'confirm.yes') {
      const pending = pendingAction.current
      pendingAction.current = null
      if (pending) {
        const execResult = executeAction(pending)
        setTranscript(execResult.message)
      }
      setMode('idle')
      controllerRef.current?.handleTranscriptionComplete()
      return
    }
    if (result.action.type === 'confirm.no') {
      pendingAction.current = null
      setTranscript('Cancelled')
      setMode('idle')
      controllerRef.current?.handleTranscriptionComplete()
      return
    }

    // Tier 3 LLM multi-step plans — always confirm
    if (result.plan && result.plan.steps.length > 0) {
      // Store the full plan as a single "execute plan" action
      const planAction: VoiceAction = {
        type: '__plan',
        params: { plan: result.plan },
        destructive: result.plan.destructive
      }
      pendingAction.current = planAction
      setTranscript(result.plan.confirmation || `${result.plan.steps.length} steps?`)
      setMode('confirming')
      return
    }

    // Destructive actions need confirmation
    if (result.action.destructive) {
      pendingAction.current = result.action
      // Broadcast gets a detailed warning
      if (result.action.type === 'agent.broadcastTo' && result.action.targets?.length) {
        const count = result.action.targets.length
        const label = (result.action.params.resolvedLabel as string) ?? ''
        setTranscript(`Send to ${count} terminal${count !== 1 ? 's' : ''}${label ? `: ${label}` : ''}?`)
      } else {
        setTranscript(`${result.normalized}?`)
      }
      setMode('confirming')
      return
    }

    // Non-destructive: execute immediately
    const execResult = executeAction(result.action)

    // Handle mode signals (dictation/standup)
    if (execResult.modeSignal === 'startDictation') {
      // Guard against double-start
      if (dsRef.current?.active) return

      // Pause regular VAD — dictation stream manages its own audio
      if (vadRef.current) vadRef.current.pause()
      controllerRef.current?.stop()

      setMode('dictationStream')
      setDsActive(true)
      setDsText('')
      setDsComplete(false)
      setTranscript('Dictation stream')

      // Ensure base model is downloaded
      const startStream = async () => {
        if (!baseModelReady.current) {
          const models = await window.voice.getModelStatus()
          const base = models.find(m => m.model === 'base')
          if (!base?.downloaded) {
            setTranscript('Downloading base model...')
            const dl = await window.voice.loadModel('base')
            if (!dl.ok) {
              setError(dl.error ?? 'Base model download failed')
              setMode('idle')
              setDsActive(false)
              controllerRef.current?.handleTranscriptionComplete()
              return
            }
          }
          baseModelReady.current = true
        }

        const stream = await createDictationStream(
          {
            chunkMaxMs: 7000,
            overlapMs: 2000,
            silenceTimeoutMs: 3000,
            whisperModel: 'base',
            deviceId: settings.inputDeviceId
          },
          {
            onChunkTranscribed: (_newWords, fullText) => {
              setDsText(fullText)
            },
            onDictationComplete: (fullText) => {
              setDsText(fullText)
              setDsComplete(true)
              setTranscript('Edit & send')
            },
            onError: (err) => {
              setError(err)
              cleanupDictationStream()
              setMode('idle')
              controllerRef.current?.handleTranscriptionComplete()
            },
            onSpeechActivity: (speaking) => {
              setDsSpeaking(speaking)
            }
          }
        )

        dsRef.current = stream
        await stream.start()
      }

      startStream()
      return
    }
    if (execResult.modeSignal === 'startStandup') {
      const noteId = createStandupNote()
      dictationNoteId.current = noteId
      setTranscript('Standup started')
      setMode('dictating')
      // Keep VAD running continuously for dictation
      if (vadRef.current) vadRef.current.start()
      return
    }
    if (execResult.modeSignal === 'stopDictation') {
      // Dictation stream stop — flush and transition to editing
      if (dsRef.current?.active) {
        dsRef.current.stop()
        return
      }
      // Note-based dictation stop (backward compat)
      dictationNoteId.current = null
      setTranscript('Dictation stopped')
      setMode('idle')
      // Pause VAD — back to push-to-talk
      if (vadRef.current) vadRef.current.pause()
      controllerRef.current?.handleTranscriptionComplete()
      return
    }

    // Handle overlay signals
    if (execResult.overlay === 'numbers') {
      activateNumberOverlay()
      setTranscript(execResult.message)
      setMode('idle')
      controllerRef.current?.handleTranscriptionComplete()
      return
    }
    if (execResult.overlay === 'grid') {
      setGridOverlayActive(true)
      setNumberOverlayActive(false)
      setTranscript(execResult.message)
      setMode('idle')
      controllerRef.current?.handleTranscriptionComplete()
      return
    }
    if (execResult.selectedNumber !== undefined) {
      if (numberOverlayActive) {
        handleNumberSelection(execResult.selectedNumber)
      } else if (gridOverlayActive) {
        selectGridRegion(execResult.selectedNumber)
      }
      controllerRef.current?.handleTranscriptionComplete()
      return
    }

    setTranscript(execResult.message)
    if (!execResult.ok) {
      setError(execResult.message)
      setTranscript(null)
    }
    setMode('idle')
    controllerRef.current?.handleTranscriptionComplete()
  }, [activateNumberOverlay, handleNumberSelection, selectGridRegion, numberOverlayActive, gridOverlayActive])

  const transcribeAudio = useCallback(async (audio: Float32Array) => {
    // Don't overwrite 'dictating' mode — keep the indicator showing dictation state
    if (!dictationNoteId.current) setMode('processing')
    try {
      // ── Vosk fast path: try grammar-constrained recognition first ──
      if (settings.sttProvider === 'vosk') {
        // Auto-load Vosk model on first use
        const voskStatus = getVoskStatus()
        if (voskStatus.status === 'unloaded') {
          setTranscript('Loading Vosk model...')
          const dl = await loadVoskModel()
          if (!dl.ok) {
            // Fall through to Whisper
            console.warn('[vosk] Load failed, falling back to Whisper:', dl.error)
          }
        }

        if (getVoskStatus().status === 'ready') {
          const voskResult = await transcribeWithVosk(audio)
          if (voskResult && voskResult.text) {
            console.log(`[vosk] Fast path hit: "${voskResult.text}" (conf=${voskResult.confidence.toFixed(2)})`)
            processCommand(voskResult.text)
            return
          }
          // Not in grammar → fall through to Whisper
          console.log('[vosk] Not in grammar, falling back to Whisper')
        }
      }

      // ── Whisper path (default, or Vosk fallback) ──
      // Auto-download Whisper model on first use
      if (!modelReady.current) {
        setTranscript(`Downloading ${settings.whisperModel} model...`)
        const dl = await window.voice.loadModel(settings.whisperModel)
        if (!dl.ok) {
          setError(dl.error ?? 'Model download failed')
          setMode('idle')
          controllerRef.current?.handleTranscriptionComplete()
          return
        }
        modelReady.current = true
      }

      setTranscript('Transcribing...')
      const result = await window.voice.transcribe(audio, settings.sttProvider)
      const text = result.text.trim()
      if (!text) {
        setTranscript(null)
        setMode('idle')
        controllerRef.current?.handleTranscriptionComplete()
        return
      }

      // Wake word verification: if in wake-word mode, confirm the transcript
      // actually contains the wake word. Rejects false triggers (coughs, noise).
      // Skip if wake word was already verified in a prior utterance (same activation).
      if (settings.activationMode === 'wake-word' && settings.wakeWord && !wakeWordVerifiedRef.current) {
        const wakePhrase = settings.wakeWord.replace(/_/g, ' ').toLowerCase()
        const wakeName = wakePhrase.split(' ').pop() ?? wakePhrase
        const lower = text.toLowerCase()
        if (!lower.includes(wakePhrase) && !lower.includes(wakeName)) {
          console.log(`[voice] Wake word verification failed — transcript "${text}" does not contain "${wakeName}"`)
          setTranscript(null)
          setMode('idle')
          controllerRef.current?.handleTranscriptionComplete()
          return
        }

        // Wake word found — check if transcript is ONLY the wake word (no command)
        wakeWordVerifiedRef.current = true
        const stripped = lower.replace(wakePhrase, '').replace(wakeName, '').trim()
        if (!stripped || stripped.length < 3) {
          // Just the wake word, no command — keep VAD listening for the follow-up
          console.log('[voice] Wake word only — waiting for command...')
          setTranscript(null)
          setMode('listening')
          return
        }
      }

      // Route through command system
      processCommand(text)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transcription failed')
      setMode('idle')
      controllerRef.current?.handleTranscriptionComplete()
    }
  }, [settings.sttProvider, settings.whisperModel, processCommand])

  // ── Push-to-talk start/stop (original behavior) ──
  const startListening = useCallback(async () => {
    // If dictation stream is active, hotkey stops it
    if (mode === 'dictationStream' && dsRef.current?.active) {
      dsRef.current.stop()
      return
    }

    if (mode !== 'idle' && mode !== 'confirming') return

    setError(null)
    if (mode !== 'confirming') setTranscript(null)
    setMode(mode === 'confirming' ? 'confirming' : 'listening')

    if (mode === 'confirming') {
      setMode('listening')
    }

    // Hotkey always works as manual push-to-talk regardless of activation mode
    wakeWordVerifiedRef.current = true  // Skip wake word verification for manual trigger
    try {
      if (!vadRef.current) {
        vadRef.current = await createVAD({
          onSpeechStart: () => {},
          onSpeechEnd: (audio) => {
            transcribeAudio(audio)
          },
          onVADMisfire: () => {}
        }, {}, settings.inputDeviceId)
      }
      vadRef.current.start()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start voice capture')
      setMode('idle')
    }
  }, [mode, transcribeAudio])

  const stopListening = useCallback(() => {
    if (vadRef.current) {
      vadRef.current.pause()
    }
    if (mode === 'listening') {
      setMode(pendingAction.current ? 'confirming' : 'idle')
    }
  }, [mode])

  const confirm = useCallback(() => {
    if (mode === 'confirming') {
      const pending = pendingAction.current
      pendingAction.current = null
      if (pending) {
        const result = executeAction(pending)
        setTranscript(result.message)
      }
      setMode('idle')
      controllerRef.current?.handleTranscriptionComplete()
    }
  }, [mode])

  const cancel = useCallback(() => {
    if (mode === 'confirming') {
      pendingAction.current = null
      setTranscript('Cancelled')
      setMode('idle')
      controllerRef.current?.handleTranscriptionComplete()
    }
  }, [mode])

  // ── Dictation stream handlers ──

  function cleanupDictationStream() {
    if (dsRef.current) {
      dsRef.current.destroy()
      dsRef.current = null
    }
    setDsActive(false)
    setDsText('')
    setDsSpeaking(false)
    setDsComplete(false)
    setDsConfirming(false)
    setDsConfirmMsg(null)
    setDsHeardText(null)
  }

  const sendDictationStream = useCallback(async (text: string) => {
    // Keep the panel active but show a processing state
    setDsComplete(false)
    setDsConfirming(false)
    setDsText('Processing...')
    setDsSpeaking(false)
    setTranscript('Processing...')
    setMode('dictationStream')

    const context = buildContext()
    try {
      const plan = await routeViaLLM(text, context)
      if (plan && plan.steps.length > 0) {
        const planAction: VoiceAction = {
          type: '__plan',
          params: { plan },
          destructive: plan.destructive
        }
        pendingAction.current = planAction
        // Show confirmation in the DictationPanel
        setDsHeardText(text)
        setDsConfirmMsg(plan.confirmation || `${plan.steps.length} step${plan.steps.length !== 1 ? 's' : ''} planned`)
        setDsConfirming(true)
        setDsComplete(true)
        setDsText('')
        setTranscript(null)
      } else {
        setTranscript('No actions recognized')
        cleanupDictationStream()
        setMode('idle')
        controllerRef.current?.handleTranscriptionComplete()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'LLM routing failed')
      cleanupDictationStream()
      setMode('idle')
      controllerRef.current?.handleTranscriptionComplete()
    }
  }, [])

  const confirmDictationStream = useCallback(() => {
    const pending = pendingAction.current
    pendingAction.current = null
    cleanupDictationStream()
    if (pending) {
      const result = executeAction(pending)
      setTranscript(result.message)
    }
    setMode('idle')
    controllerRef.current?.handleTranscriptionComplete()
  }, [])

  const rejectDictationStream = useCallback(() => {
    pendingAction.current = null
    cleanupDictationStream()
    setTranscript('Cancelled')
    setMode('idle')
    controllerRef.current?.handleTranscriptionComplete()
  }, [])

  const cancelDictationStream = useCallback(() => {
    pendingAction.current = null
    cleanupDictationStream()
    setTranscript('Dictation cancelled')
    setMode('idle')
    controllerRef.current?.handleTranscriptionComplete()
  }, [])

  const stopDictationStream = useCallback(() => {
    // Manual stop — stream's onDictationComplete callback transitions to editing
    dsRef.current?.stop()
  }, [])

  // ── Ambient monitoring ──
  useEffect(() => {
    if (!settings.enabled) return
    const monitoring = settings.ambientMonitoring
    if (!monitoring.onWaiting && !monitoring.onError && !monitoring.onExit && !monitoring.onNotification) return

    const monitor = createAmbientMonitor(monitoring, (event) => {
      // Only flash when idle — don't interrupt active voice commands
      if (modeRef.current !== 'idle') return
      setTranscript(event.message)
      // Auto-clear will happen via the existing cleanup timer
    })

    return () => monitor.destroy()
  }, [
    settings.enabled,
    settings.ambientMonitoring.onWaiting,
    settings.ambientMonitoring.onError,
    settings.ambientMonitoring.onExit,
    settings.ambientMonitoring.onNotification
  ])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (vadRef.current) {
        vadRef.current.destroy()
        vadRef.current = null
      }
      if (controllerRef.current) {
        controllerRef.current.destroy()
        controllerRef.current = null
      }
      if (dsRef.current) {
        dsRef.current.destroy()
        dsRef.current = null
      }
    }
  }, [])

  return {
    mode, transcript, error, listeningSecondsLeft,
    startListening, stopListening, confirm, cancel,
    numberOverlayActive, gridOverlayActive, numberedTiles,
    dismissOverlay, selectGridRegion,
    // Dictation stream
    dictationStreamActive: dsActive,
    dictationStreamText: dsText,
    dictationStreamSpeaking: dsSpeaking,
    dictationStreamComplete: dsComplete,
    dictationStreamConfirming: dsConfirming,
    dictationStreamConfirmMsg: dsConfirmMsg,
    dictationStreamHeardText: dsHeardText,
    sendDictationStream,
    cancelDictationStream,
    stopDictationStream,
    confirmDictationStream,
    rejectDictationStream
  }
}
