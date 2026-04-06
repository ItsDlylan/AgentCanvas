// Each background renderer manages its own state and draws frames onto a 2D canvas.
// Colors should be very subtle against the #09090b dark background.
// Use the zinc palette: #18181b, #27272a, #3f3f46 for subtle elements.

export interface BackgroundRenderer {
  /** Create initial state (particle positions, columns, etc.) */
  init(width: number, height: number): unknown
  /** Draw one frame. Called via requestAnimationFrame (~60fps). */
  draw(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    time: number,
    state: unknown
  ): void
}
