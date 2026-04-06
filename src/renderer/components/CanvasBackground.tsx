import { useEffect, useRef, useCallback } from 'react'
import type { BackgroundRenderer } from './backgrounds/types'
import type { BackgroundMode } from '../types/settings'
import { matrixRenderer } from './backgrounds/matrix'
import { starfieldRenderer } from './backgrounds/starfield'
import { circuitRenderer } from './backgrounds/circuit'
import { topographicRenderer } from './backgrounds/topographic'
import { oceanRenderer } from './backgrounds/ocean'
import { constellationRenderer } from './backgrounds/constellation'
import { firefliesRenderer } from './backgrounds/fireflies'
import { snowRenderer } from './backgrounds/snow'

const renderers: Record<string, BackgroundRenderer> = {
  matrix: matrixRenderer,
  starfield: starfieldRenderer,
  circuit: circuitRenderer,
  topographic: topographicRenderer,
  ocean: oceanRenderer,
  constellation: constellationRenderer,
  fireflies: firefliesRenderer,
  snow: snowRenderer
}

export function CanvasBackground({ mode }: { mode: Exclude<BackgroundMode, 'dots'> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef<unknown>(null)
  const frameRef = useRef<number>(0)
  const sizeRef = useRef({ w: 0, h: 0 })

  const renderer = renderers[mode] ?? null

  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !renderer) return
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    const w = rect.width
    const h = rect.height
    canvas.width = w * dpr
    canvas.height = h * dpr
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    sizeRef.current = { w, h }
    stateRef.current = renderer.init(w, h)
  }, [renderer])

  useEffect(() => {
    if (!renderer) return
    initCanvas()

    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const loop = (time: number) => {
      const { w, h } = sizeRef.current
      renderer.draw(ctx, w, h, time, stateRef.current)
      frameRef.current = requestAnimationFrame(loop)
    }
    frameRef.current = requestAnimationFrame(loop)

    const onResize = () => {
      initCanvas()
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(frameRef.current)
      window.removeEventListener('resize', onResize)
    }
  }, [renderer, initCanvas])

  if (!renderer) return null

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
        pointerEvents: 'none'
      }}
    />
  )
}
