import type { Settings } from '@/types/settings'

export type TutorialCategory =
  | 'getting-started'
  | 'terminals'
  | 'browser'
  | 'notes'
  | 'tasks'
  | 'workflow'

export type TutorialMedia =
  | { type: 'video'; src: string; posterSrc?: string; durationSec: number }
  | { type: 'image'; src: string; alt?: string }
  | { type: 'image-series'; srcs: string[]; alt?: string }

export interface Tutorial {
  id: string
  category: TutorialCategory
  title: string
  description: string
  media: TutorialMedia
  tags?: string[]
  publishedAt: string
  status?: 'live' | 'comingSoon'
}

export const CATEGORY_LABELS: Record<TutorialCategory, string> = {
  'getting-started': 'Getting Started',
  terminals: 'Terminals',
  browser: 'Browser Tiles',
  notes: 'Notes',
  tasks: 'Task Tiles',
  workflow: 'Workflow & Shortcuts'
}

export const CATEGORY_ORDER: TutorialCategory[] = [
  'getting-started',
  'terminals',
  'browser',
  'notes',
  'tasks',
  'workflow'
]

export const TUTORIALS: Tutorial[] = [
  {
    id: 'welcome',
    category: 'getting-started',
    title: 'Welcome to AgentCanvas',
    description:
      'A quick tour of the infinite canvas, tiles, and the workflow AgentCanvas is built around.',
    media: {
      type: 'video',
      // Query param busts Electron/Chromium's aggressive mp4 URL cache —
      // bump when re-rendering welcome.mp4.
      src: '/tutorials/welcome.mp4?v=5',
      posterSrc: '/tutorials/welcome.jpg?v=5',
      durationSec: 22
    },
    tags: ['intro', 'tour', 'onboarding'],
    publishedAt: '2026-04-21',
    status: 'live'
  },
  {
    id: 'canvas-navigation',
    category: 'getting-started',
    title: 'Navigating the canvas',
    description: 'Pan, zoom, minimap, and jump-to-tile shortcuts for moving around.',
    media: { type: 'video', src: '/tutorials/canvas-navigation.mp4', durationSec: 60 },
    tags: ['pan', 'zoom', 'navigation'],
    publishedAt: '2026-04-21',
    status: 'comingSoon'
  },
  {
    id: 'spawn-terminal',
    category: 'terminals',
    title: 'Spawning your first terminal',
    description: 'Create a terminal tile, run Claude Code, and move the tile around the canvas.',
    media: { type: 'video', src: '/tutorials/spawn-terminal.mp4', durationSec: 75 },
    tags: ['terminal', 'claude', 'spawn'],
    publishedAt: '2026-04-21',
    status: 'comingSoon'
  },
  {
    id: 'team-mode',
    category: 'terminals',
    title: 'Team mode: orchestrating agents',
    description: 'Spawn linked worker terminals with roles and watch a code-review team run in parallel.',
    media: { type: 'video', src: '/tutorials/team-mode.mp4', durationSec: 90 },
    tags: ['team', 'orchestration', 'agents'],
    publishedAt: '2026-04-21',
    status: 'comingSoon'
  },
  {
    id: 'browser-tiles',
    category: 'browser',
    title: 'Browser tiles and CDP',
    description: 'Open a browser tile on the canvas and drive it programmatically with agent-browser.',
    media: { type: 'video', src: '/tutorials/browser-tiles.mp4', durationSec: 80 },
    tags: ['browser', 'cdp', 'agent-browser'],
    publishedAt: '2026-04-21',
    status: 'comingSoon'
  },
  {
    id: 'notes-basics',
    category: 'notes',
    title: 'Writing notes on the canvas',
    description: 'Create a note tile, use markdown, and link notes to terminals or tasks.',
    media: { type: 'video', src: '/tutorials/notes-basics.mp4', durationSec: 55 },
    tags: ['notes', 'markdown', 'tiptap'],
    publishedAt: '2026-04-21',
    status: 'comingSoon'
  },
  {
    id: 'task-tiles',
    category: 'tasks',
    title: 'Task tiles and derived state',
    description:
      'Capture a task, let the classifier pick a type, and watch derived state flow from raw → review.',
    media: { type: 'video', src: '/tutorials/task-tiles.mp4', durationSec: 95 },
    tags: ['tasks', 'classification', 'state'],
    publishedAt: '2026-04-21',
    status: 'comingSoon'
  },
  {
    id: 'command-palette',
    category: 'workflow',
    title: 'The ⌘K command palette',
    description: 'Jump anywhere with fuzzy search, workspace tokens, and inline task filters.',
    media: { type: 'video', src: '/tutorials/command-palette.mp4', durationSec: 70 },
    tags: ['palette', 'shortcuts', 'search'],
    publishedAt: '2026-04-21',
    status: 'comingSoon'
  },
  {
    id: 'task-lens',
    category: 'workflow',
    title: 'Task Lens for triage',
    description: 'Use ⌘⇧T to slice the task backlog by morning quick-bursts or deep-focus work.',
    media: { type: 'video', src: '/tutorials/task-lens.mp4', durationSec: 65 },
    tags: ['tasks', 'triage', 'lens'],
    publishedAt: '2026-04-21',
    status: 'comingSoon'
  }
]

// ── Selectors ────────────────────────────────────────────

export function getTutorialById(id: string): Tutorial | undefined {
  return TUTORIALS.find((t) => t.id === id)
}

export function groupTutorialsByCategory(
  tutorials: readonly Tutorial[]
): Map<TutorialCategory, Tutorial[]> {
  const grouped = new Map<TutorialCategory, Tutorial[]>()
  for (const cat of CATEGORY_ORDER) grouped.set(cat, [])
  for (const t of tutorials) {
    const list = grouped.get(t.category)
    if (list) list.push(t)
  }
  return grouped
}

export function filterTutorials(query: string, activeTags: readonly string[] = []): Tutorial[] {
  const q = query.trim().toLowerCase()
  const tagSet = new Set(activeTags.map((t) => t.toLowerCase()))
  return TUTORIALS.filter((t) => {
    if (tagSet.size > 0) {
      const tutorialTags = (t.tags ?? []).map((tag) => tag.toLowerCase())
      const anyMatch = tutorialTags.some((tag) => tagSet.has(tag))
      if (!anyMatch) return false
    }
    if (!q) return true
    if (t.title.toLowerCase().includes(q)) return true
    if (t.description.toLowerCase().includes(q)) return true
    if (t.tags?.some((tag) => tag.toLowerCase().includes(q))) return true
    if (CATEGORY_LABELS[t.category].toLowerCase().includes(q)) return true
    return false
  })
}

export function getAllTags(): string[] {
  const counts = new Map<string, number>()
  for (const t of TUTORIALS) {
    for (const tag of t.tags ?? []) {
      const key = tag.toLowerCase()
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag)
}

// ── Seen / watched helpers ───────────────────────────────

export function isWatched(id: string, settings: Settings): boolean {
  return settings.tutorials?.seenIds?.includes(id) ?? false
}

export function isNew(tutorial: Tutorial, settings: Settings): boolean {
  if (tutorial.status !== 'live') return false
  if (isWatched(tutorial.id, settings)) return false
  const published = new Date(tutorial.publishedAt).getTime()
  if (Number.isNaN(published)) return false
  const ageDays = (Date.now() - published) / 86_400_000
  return ageDays <= 14
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
