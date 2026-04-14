import { EventEmitter } from 'events'
import { watch, readFileSync, existsSync, readdirSync, mkdirSync, type FSWatcher } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface TeamMember {
  name: string
  agentId: string
  agentType?: string
}

export interface TeamConfig {
  teamName: string
  members: TeamMember[]
}

/**
 * Watches ~/.claude/teams/ for Claude Code Agent Teams config changes.
 * Emits events when teammates are added or removed so AgentCanvas can
 * auto-spawn terminal tiles for them.
 *
 * Best-effort: tolerant of format changes — logs warnings instead of crashing.
 */
export class TeamWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null
  private knownMembers = new Map<string, Set<string>>() // teamName → Set<agentId>
  private teamsDir: string
  private debounceTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    super()
    this.teamsDir = join(homedir(), '.claude', 'teams')
  }

  start(): void {
    // Ensure the directory exists so we can watch it
    if (!existsSync(this.teamsDir)) {
      try {
        mkdirSync(this.teamsDir, { recursive: true })
      } catch {
        console.warn('[TeamWatcher] Could not create teams directory:', this.teamsDir)
        return
      }
    }

    try {
      this.watcher = watch(this.teamsDir, { recursive: true }, () => {
        // Debounce 500ms to coalesce rapid writes
        if (this.debounceTimer) clearTimeout(this.debounceTimer)
        this.debounceTimer = setTimeout(() => this.scan(), 500)
      })
    } catch (err) {
      console.warn('[TeamWatcher] Could not watch teams directory:', err)
      return
    }

    // Initial scan
    this.scan()
  }

  private scan(): void {
    try {
      if (!existsSync(this.teamsDir)) return

      const entries = readdirSync(this.teamsDir, { withFileTypes: true })
      const teamDirs = entries.filter((e) => e.isDirectory())

      for (const dir of teamDirs) {
        const configPath = join(this.teamsDir, dir.name, 'config.json')
        if (!existsSync(configPath)) continue

        try {
          const raw = readFileSync(configPath, 'utf-8')
          const config = JSON.parse(raw) as { members?: TeamMember[] }
          if (!Array.isArray(config.members)) continue

          const teamName = dir.name
          const known = this.knownMembers.get(teamName) ?? new Set<string>()
          const current = new Set<string>()

          for (const member of config.members) {
            if (!member.agentId || !member.name) continue
            current.add(member.agentId)

            if (!known.has(member.agentId)) {
              this.emit('teammate-added', { teamName, member })
            }
          }

          // Detect removals
          for (const agentId of known) {
            if (!current.has(agentId)) {
              this.emit('teammate-removed', { teamName, agentId })
            }
          }

          this.knownMembers.set(teamName, current)
        } catch {
          // Malformed config — skip silently
          console.warn(`[TeamWatcher] Could not parse config for team: ${dir.name}`)
        }
      }
    } catch (err) {
      console.warn('[TeamWatcher] Scan error:', err)
    }
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = null
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }
}
