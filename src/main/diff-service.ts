import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export type DiffChangeKind = 'added' | 'deleted' | 'modified' | 'renamed'

export interface DiffFileChange {
  changeKind: DiffChangeKind
  oldPath: string
  newPath: string
  additions: number
  deletions: number
  rawDiff: string
}

export interface DiffResult {
  files: DiffFileChange[]
  summary: { additions: number; deletions: number; filesChanged: number }
  branch?: string
  isWorktree: boolean
  error?: string
}

async function execGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024, // 10MB
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  })
  return stdout
}

function parseNumstat(numstat: string): Map<string, { additions: number; deletions: number }> {
  const result = new Map<string, { additions: number; deletions: number }>()
  for (const line of numstat.split('\n')) {
    if (!line.trim()) continue
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const [addStr, delStr, ...pathParts] = parts
    const filePath = pathParts.join('\t') // handle filenames with tabs
    const additions = addStr === '-' ? 0 : parseInt(addStr, 10)
    const deletions = delStr === '-' ? 0 : parseInt(delStr, 10)
    result.set(filePath, { additions, deletions })
  }
  return result
}

function parseUnifiedDiff(diffText: string): Map<string, { rawDiff: string; changeKind: DiffChangeKind; oldPath: string; newPath: string }> {
  const files = new Map<string, { rawDiff: string; changeKind: DiffChangeKind; oldPath: string; newPath: string }>()
  // Split on "diff --git" boundaries
  const chunks = diffText.split(/^diff --git /m).filter(Boolean)

  for (const chunk of chunks) {
    const fullChunk = 'diff --git ' + chunk
    const lines = chunk.split('\n')
    const firstLine = lines[0] || ''

    // Parse "a/path b/path"
    const match = firstLine.match(/^a\/(.+?) b\/(.+?)$/)
    if (!match) continue
    const oldPath = match[1]
    const newPath = match[2]

    // Determine change kind from the diff header
    let changeKind: DiffChangeKind = 'modified'
    if (chunk.includes('new file mode')) {
      changeKind = 'added'
    } else if (chunk.includes('deleted file mode')) {
      changeKind = 'deleted'
    } else if (chunk.includes('rename from') || chunk.includes('similarity index')) {
      changeKind = 'renamed'
    }

    // Use newPath as the key (it's the current filename)
    const key = changeKind === 'renamed' ? `${oldPath} => ${newPath}` : newPath
    files.set(key, { rawDiff: fullChunk, changeKind, oldPath, newPath })
  }

  return files
}

export class DiffService {
  async computeDiff(cwd: string): Promise<DiffResult> {
    if (!cwd) {
      return {
        files: [],
        summary: { additions: 0, deletions: 0, filesChanged: 0 },
        isWorktree: false,
        error: 'No working directory provided'
      }
    }

    // Resolve to the git toplevel so we always diff the whole repo/worktree,
    // even if cwd is a subdirectory.
    let resolvedCwd = cwd
    try {
      resolvedCwd = (await execGit(cwd, ['rev-parse', '--show-toplevel'])).trim()
    } catch (err) {
      console.error(`[DiffService] Not a git repo at "${cwd}":`, (err as Error).message)
      return {
        files: [],
        summary: { additions: 0, deletions: 0, filesChanged: 0 },
        isWorktree: false,
        error: `Not a git repository: ${cwd}`
      }
    }

    try {
      // Get branch name
      let branch: string | undefined
      try {
        branch = (await execGit(resolvedCwd, ['branch', '--show-current'])).trim() || undefined
      } catch { /* detached HEAD */ }

      // Check if this is a worktree
      let isWorktree = false
      try {
        const gitDir = (await execGit(resolvedCwd, ['rev-parse', '--git-dir'])).trim()
        const commonDir = (await execGit(resolvedCwd, ['rev-parse', '--git-common-dir'])).trim()
        isWorktree = gitDir !== commonDir
      } catch { /* ignore */ }

      // Determine diff target
      // For worktrees (or any branch with commits ahead), diff against the
      // merge-base with the upstream tracking branch, falling back to common
      // base branch names.
      let diffRef = 'HEAD'
      console.log(`[DiffService] resolvedCwd="${resolvedCwd}" branch="${branch}" isWorktree=${isWorktree}`)

      if (isWorktree || branch) {
        let foundBase = false

        // 1. Try the upstream tracking branch, but only if it's a different
        //    branch (e.g. origin/develop). If upstream is just the remote copy
        //    of the same branch (origin/feature/xxx), skip it — that's not the
        //    PR base, it's the push target.
        if (branch) {
          try {
            const upstream = (await execGit(resolvedCwd, ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`])).trim()
            const upstreamBranchName = upstream.replace(/^[^/]+\//, '') // strip remote prefix
            console.log(`[DiffService] upstream="${upstream}" upstreamBranch="${upstreamBranchName}" localBranch="${branch}"`)
            if (upstream && upstreamBranchName !== branch) {
              const mergeBase = (await execGit(resolvedCwd, ['merge-base', upstream, 'HEAD'])).trim()
              if (mergeBase) {
                diffRef = mergeBase
                foundBase = true
                console.log(`[DiffService] Using upstream merge-base: ${upstream} -> ${mergeBase}`)
              }
            } else {
              console.log(`[DiffService] Upstream tracks same branch, skipping`)
            }
          } catch (err) {
            console.log(`[DiffService] No upstream: ${(err as Error).message}`)
          }
        }

        // 2. Fall back to common base branch names
        if (!foundBase) {
          // Also list available remote refs to help debug
          try {
            const refs = (await execGit(resolvedCwd, ['branch', '-r'])).trim()
            console.log(`[DiffService] Available remote refs:\n${refs}`)
          } catch { /* ignore */ }

          for (const base of ['origin/dev', 'origin/develop', 'origin/main', 'origin/master', 'dev', 'develop', 'main', 'master']) {
            try {
              const mergeBase = (await execGit(resolvedCwd, ['merge-base', base, 'HEAD'])).trim()
              if (mergeBase) {
                diffRef = mergeBase
                foundBase = true
                console.log(`[DiffService] Using fallback merge-base: ${base} -> ${mergeBase}`)
                break
              }
            } catch (err) {
              console.log(`[DiffService] merge-base ${base} failed: ${(err as Error).message}`)
            }
          }
        }

        if (!foundBase) {
          console.log(`[DiffService] WARNING: No base branch found, diffRef remains HEAD`)
        }
      }

      console.log(`[DiffService] Final diffRef="${diffRef}"`)


      // Get numstat for line counts
      const [numstatOutput, diffOutput] = await Promise.all([
        execGit(resolvedCwd, ['diff', diffRef, '--numstat', '--no-color']).catch(() => ''),
        execGit(resolvedCwd, ['diff', diffRef, '--unified=5', '--no-color', '--no-ext-diff']).catch(() => '')
      ])

      // Also include untracked files for non-worktree (working directory changes)
      // and staged changes
      let stagedNumstat = ''
      let stagedDiff = ''
      if (!isWorktree) {
        ;[stagedNumstat, stagedDiff] = await Promise.all([
          execGit(resolvedCwd, ['diff', '--cached', '--numstat', '--no-color']).catch(() => ''),
          execGit(resolvedCwd, ['diff', '--cached', '--unified=5', '--no-color', '--no-ext-diff']).catch(() => '')
        ])
      }

      const numstatMap = parseNumstat(numstatOutput + '\n' + stagedNumstat)
      const diffMap = parseUnifiedDiff(diffOutput + '\n' + stagedDiff)

      // Merge numstat and diff data
      const files: DiffFileChange[] = []
      const seenPaths = new Set<string>()

      for (const [key, diffInfo] of diffMap) {
        seenPaths.add(key)
        const stats = numstatMap.get(diffInfo.newPath) || numstatMap.get(key) || { additions: 0, deletions: 0 }
        files.push({
          changeKind: diffInfo.changeKind,
          oldPath: diffInfo.oldPath,
          newPath: diffInfo.newPath,
          additions: stats.additions,
          deletions: stats.deletions,
          rawDiff: diffInfo.rawDiff
        })
      }

      // Any numstat entries without a diff chunk (e.g., binary files)
      for (const [path, stats] of numstatMap) {
        if (!seenPaths.has(path)) {
          files.push({
            changeKind: 'modified',
            oldPath: path,
            newPath: path,
            additions: stats.additions,
            deletions: stats.deletions,
            rawDiff: ''
          })
        }
      }

      const summary = {
        additions: files.reduce((s, f) => s + f.additions, 0),
        deletions: files.reduce((s, f) => s + f.deletions, 0),
        filesChanged: files.length
      }

      return { files, summary, branch, isWorktree }
    } catch (err) {
      return {
        files: [],
        summary: { additions: 0, deletions: 0, filesChanged: 0 },
        isWorktree: false,
        error: (err as Error).message
      }
    }
  }
}
