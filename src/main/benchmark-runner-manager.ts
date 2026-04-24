import { fork, type ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { loadBenchmark, loadRuntimeState, saveRuntimeState } from './benchmark-store'

// Max bytes of stderr to retain per benchmark; surfaced in append-result
// rationale and to the renderer's runner-status tile.
const STDERR_RING_BYTES = 4096

type RunnerAction = 'pause' | 'resume' | 'stop' | 'unfreeze'

interface RunnerEntry {
  child: ChildProcess
  stderrRing: string
  stdoutRing: string
  /** Cleared every time an iteration boundary is crossed (append-result posted). */
  iterationStderrTail: string
}

type Events = {
  stderr: (benchmarkId: string, chunk: string) => void
  stdout: (benchmarkId: string, chunk: string) => void
  exit: (benchmarkId: string, code: number | null) => void
}

class TypedEmitter extends EventEmitter {
  on<K extends keyof Events>(event: K, listener: Events[K]): this {
    return super.on(event, listener)
  }
  emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>): boolean {
    return super.emit(event, ...args)
  }
}

class BenchmarkRunnerManager extends TypedEmitter {
  private children = new Map<string, RunnerEntry>()

  has(benchmarkId: string): boolean {
    return this.children.has(benchmarkId)
  }

  pid(benchmarkId: string): number | undefined {
    return this.children.get(benchmarkId)?.child.pid ?? undefined
  }

  /**
   * Fork the runner as a managed child. Returns the pid on success, or
   * throws if the runner script cannot be located. Callers should first
   * flip runtime.status to 'running' and persist it — this method does not
   * touch benchmark metadata.
   */
  launch(benchmarkId: string): { pid: number; runnerPath: string } {
    if (this.children.has(benchmarkId)) {
      throw new Error(`runner already active for benchmark ${benchmarkId}`)
    }
    const b = loadBenchmark(benchmarkId)
    if (!b) throw new Error('benchmark not found')

    const runnerPath = resolveRunnerPath(b.meta.worktreePath)
    if (!runnerPath) {
      throw new Error('benchmark-runner.mjs not found in app bundle or worktree')
    }

    const child = fork(runnerPath, ['--benchmark-id', benchmarkId], {
      cwd: b.meta.worktreePath,
      env: process.env,
      // Pipe stderr/stdout so we can tap into them; keep the IPC channel for
      // pause/resume/stop signaling.
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    })

    const entry: RunnerEntry = {
      child,
      stderrRing: '',
      stdoutRing: '',
      iterationStderrTail: ''
    }
    this.children.set(benchmarkId, entry)

    child.stderr?.setEncoding('utf-8')
    child.stdout?.setEncoding('utf-8')
    child.stderr?.on('data', (chunk: string) => {
      entry.stderrRing = tail(entry.stderrRing + chunk, STDERR_RING_BYTES)
      entry.iterationStderrTail = tail(entry.iterationStderrTail + chunk, STDERR_RING_BYTES)
      this.emit('stderr', benchmarkId, chunk)
    })
    child.stdout?.on('data', (chunk: string) => {
      entry.stdoutRing = tail(entry.stdoutRing + chunk, STDERR_RING_BYTES)
      this.emit('stdout', benchmarkId, chunk)
    })

    child.on('exit', (code) => {
      this.children.delete(benchmarkId)
      this.handleExit(benchmarkId, code)
      this.emit('exit', benchmarkId, code)
    })

    child.on('error', (err) => {
      // Log but don't delete — the 'exit' handler will do that.
      console.error(`[benchmark-runner] child error for ${benchmarkId}:`, err)
    })

    return { pid: child.pid ?? -1, runnerPath }
  }

  /**
   * Send a control action to a live runner. pause/resume/stop are forwarded
   * as IPC messages to the child; unfreeze is informational only (the
   * caller is expected to have already cleared the frozen flag on
   * state.json and will re-launch the runner).
   */
  signal(benchmarkId: string, action: RunnerAction): boolean {
    const entry = this.children.get(benchmarkId)
    if (!entry) return false
    if (action === 'unfreeze') return true // frozen runners exit; re-launch.
    try {
      entry.child.send({ type: action })
      return true
    } catch {
      return false
    }
  }

  /** Consume and return the runner's stderr tail for the current iteration. */
  takeIterationStderr(benchmarkId: string): string {
    const entry = this.children.get(benchmarkId)
    if (!entry) return ''
    const tailStr = entry.iterationStderrTail
    entry.iterationStderrTail = ''
    return tailStr
  }

  /** Read-only view of the rolling stderr ring for the runner-status tile. */
  peekStderr(benchmarkId: string): string {
    return this.children.get(benchmarkId)?.stderrRing ?? ''
  }

  /**
   * Graceful shutdown of all live runners. SIGTERM first with a short grace;
   * SIGKILL any survivors. Called from app will-quit.
   */
  async killAll(graceMs = 5000): Promise<void> {
    const live = [...this.children.entries()]
    if (live.length === 0) return
    for (const [, entry] of live) {
      try { entry.child.kill('SIGTERM') } catch { /* noop */ }
    }
    // Race each child's exit against the grace period.
    await Promise.all(
      live.map(([benchmarkId, entry]) =>
        new Promise<void>((resolve) => {
          if (entry.child.exitCode !== null) return resolve()
          const timer = setTimeout(() => {
            try { entry.child.kill('SIGKILL') } catch { /* noop */ }
            resolve()
          }, graceMs)
          entry.child.once('exit', () => {
            clearTimeout(timer)
            resolve()
          })
          // Belt-and-braces: if the map cleanup already fired, still resolve.
          if (!this.children.has(benchmarkId)) {
            clearTimeout(timer)
            resolve()
          }
        })
      )
    )
  }

  private handleExit(benchmarkId: string, code: number | null): void {
    // Exit code semantics (mirror runner.mjs):
    //   0 = stop condition fired OR user stop
    //   1 = unrecoverable error
    //   2 = frozen awaiting human sign-off
    //   null/others = crash
    const b = loadBenchmark(benchmarkId)
    if (!b) return
    const state = loadRuntimeState(b.meta)
    // Don't overwrite a terminal status the main process set itself (e.g. the
    // comparator already moved us to 'done' via append-result).
    if (state.status === 'done' || state.status === 'stopped') return
    if (code === 2) {
      state.status = 'frozen'
      state.frozen = true
    } else if (code === 0) {
      // Runner exited cleanly without a stop reason on state — treat as user stop.
      state.status = state.stopReason ? 'stopped' : 'stopped'
    } else {
      state.status = 'stopped'
      state.stopReason = 'user'
      // Leave a breadcrumb so the UI shows WHY we're in stopped state.
      if (!state.frozenReason) {
        state.frozenReason = `runner exited with code ${code ?? 'null'} (crash)`
      }
    }
    saveRuntimeState(b.meta, state)
  }
}

function tail(s: string, n: number): string {
  return s.length <= n ? s : s.slice(s.length - n)
}

function resolveRunnerPath(worktreePath: string): string | null {
  const shipped = join(app.getAppPath(), 'scripts', 'benchmark-runner.mjs')
  if (existsSync(shipped)) return shipped
  const fallback = join(worktreePath, 'scripts', 'benchmark-runner.mjs')
  if (existsSync(fallback)) return fallback
  return null
}

// Singleton — main/index.ts and IPC handlers all talk to the same instance.
export const benchmarkRunnerManager = new BenchmarkRunnerManager()
