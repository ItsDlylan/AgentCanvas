/**
 * State management hook for the Draw tile.
 * Handles drawing state, undo/redo, and persistence.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DrawingState, Shape, Arrow, FreehandStroke, Camera } from '@/lib/draw-types'
import { createEmptyDrawingState } from '@/lib/draw-types'

const SAVE_DEBOUNCE_MS = 500
const MAX_HISTORY = 50

export function useDraw({ drawId }: { drawId: string }) {
  const [state, setState] = useState<DrawingState>(createEmptyDrawingState)
  const [loaded, setLoaded] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const drawIdRef = useRef(drawId)
  drawIdRef.current = drawId
  const stateRef = useRef(state)
  stateRef.current = state
  const cameraRef = useRef(state.camera)

  // Undo/redo
  const historyRef = useRef<DrawingState[]>([])
  const historyIndexRef = useRef(-1)

  const pushHistory = useCallback((newState: DrawingState) => {
    const history = historyRef.current
    const idx = historyIndexRef.current
    // Truncate future states
    historyRef.current = history.slice(0, idx + 1)
    historyRef.current.push(newState)
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.shift()
    }
    historyIndexRef.current = historyRef.current.length - 1
  }, [])

  const undo = useCallback(() => {
    const idx = historyIndexRef.current
    if (idx <= 0) return
    historyIndexRef.current = idx - 1
    const prev = historyRef.current[idx - 1]
    setState(prev)
    scheduleSave(prev)
  }, [])

  const redo = useCallback(() => {
    const idx = historyIndexRef.current
    if (idx >= historyRef.current.length - 1) return
    historyIndexRef.current = idx + 1
    const next = historyRef.current[idx + 1]
    setState(next)
    scheduleSave(next)
  }, [])

  // Debounced persistence
  const scheduleSave = useCallback((toSave: DrawingState) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      const { shapes, arrows, freehand, camera } = toSave
      window.draw.save(drawIdRef.current, {}, [...shapes, ...arrows, ...freehand] as unknown[], { camera } as Record<string, unknown>)
    }, SAVE_DEBOUNCE_MS)
  }, [])

  // Update state with history tracking
  const updateState = useCallback((updater: (prev: DrawingState) => DrawingState) => {
    setState((prev) => {
      const next = updater(prev)
      pushHistory(next)
      scheduleSave(next)
      return next
    })
  }, [pushHistory, scheduleSave])

  // Load persisted data on mount
  useEffect(() => {
    window.draw.load(drawId).then((drawFile) => {
      if (drawFile) {
        const elements = drawFile.elements || []
        const appState = drawFile.appState || {}
        const shapes = elements.filter((e: unknown) => {
          const el = e as { type?: string }
          return el.type && el.type !== 'arrow' && el.type !== 'freehand'
        }) as unknown as Shape[]
        const arrows = elements.filter((e: unknown) => (e as { type?: string }).type === 'arrow') as unknown as Arrow[]
        const freehand = elements.filter((e: unknown) => (e as { type?: string }).type === 'freehand') as unknown as FreehandStroke[]
        const camera = (appState.camera as Camera) || { x: 0, y: 0, zoom: 1 }

        const loadedState: DrawingState = { shapes, arrows, freehand, camera }
        setState(loadedState)
        historyRef.current = [loadedState]
        historyIndexRef.current = 0
      } else {
        const empty = createEmptyDrawingState()
        historyRef.current = [empty]
        historyIndexRef.current = 0
      }
      setLoaded(true)
    })
  }, [drawId])

  // Flush save on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        const { shapes, arrows, freehand, camera } = state
        window.draw.save(drawIdRef.current, {}, [...shapes, ...arrows, ...freehand] as unknown[], { camera } as Record<string, unknown>)
      }
    }
  }, [state])

  // Listen for agent-driven scene updates
  useEffect(() => {
    const unsub = window.draw.onSceneUpdate((updatedDrawId, elements, appState) => {
      if (updatedDrawId !== drawIdRef.current) return
      const shapes = (elements || []).filter((e: unknown) => {
        const el = e as { type?: string }
        return el.type && el.type !== 'arrow' && el.type !== 'freehand'
      }) as unknown as Shape[]
      const arrows = (elements || []).filter((e: unknown) => (e as { type?: string }).type === 'arrow') as unknown as Arrow[]
      const freehand = (elements || []).filter((e: unknown) => (e as { type?: string }).type === 'freehand') as unknown as FreehandStroke[]
      const camera = (appState?.camera as Camera) || state.camera

      const newState: DrawingState = { shapes, arrows, freehand, camera }
      setState(newState)
      pushHistory(newState)
    })
    return unsub
  }, [pushHistory, state.camera])

  // CRUD operations
  const addShape = useCallback((shape: Shape) => {
    updateState((prev) => ({ ...prev, shapes: [...prev.shapes, shape] }))
  }, [updateState])

  const updateShape = useCallback((id: string, updates: Partial<Shape>) => {
    updateState((prev) => ({
      ...prev,
      shapes: prev.shapes.map((s) => (s.id === id ? { ...s, ...updates } as Shape : s))
    }))
  }, [updateState])

  const addArrow = useCallback((arrow: Arrow) => {
    updateState((prev) => ({ ...prev, arrows: [...prev.arrows, arrow] }))
  }, [updateState])

  const addFreehand = useCallback((stroke: FreehandStroke) => {
    updateState((prev) => ({ ...prev, freehand: [...prev.freehand, stroke] }))
  }, [updateState])

  const deleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return
    updateState((prev) => ({
      ...prev,
      shapes: prev.shapes.filter((s) => !selectedIds.has(s.id)),
      arrows: prev.arrows.filter((a) => !selectedIds.has(a.id)),
      freehand: prev.freehand.filter((f) => !selectedIds.has(f.id))
    }))
    setSelectedIds(new Set())
  }, [selectedIds, updateState])

  const updateCamera = useCallback((camera: Camera) => {
    // Only persist — don't trigger React re-render.
    // The DrawCanvas applies camera transforms imperatively.
    cameraRef.current = camera
    scheduleSave({ ...stateRef.current, camera })
  }, [scheduleSave])

  const clearCanvas = useCallback(() => {
    updateState(() => createEmptyDrawingState())
    setSelectedIds(new Set())
  }, [updateState])

  // Bulk add (for Mermaid import)
  const addElements = useCallback((shapes: Shape[], arrows: Arrow[], mode: 'append' | 'replace' = 'append') => {
    updateState((prev) => {
      if (mode === 'replace') {
        return { ...prev, shapes, arrows, freehand: [] }
      }
      return {
        ...prev,
        shapes: [...prev.shapes, ...shapes],
        arrows: [...prev.arrows, ...arrows]
      }
    })
  }, [updateState])

  return {
    state,
    loaded,
    selectedIds,
    setSelectedIds,
    addShape,
    updateShape,
    addArrow,
    addFreehand,
    deleteSelected,
    updateCamera,
    clearCanvas,
    addElements,
    undo,
    redo
  }
}
