import { useEffect, useState, useCallback } from 'react'
import type { PlanDoc, PlanMeta, PlanState } from '../../preload/index'

/**
 * Subscribe to a single plan doc. Loads once on mount; re-loads on every
 * canvas:plan-* event for that planId.
 */
export function usePlan(planId: string): {
  doc: PlanDoc | null
  loading: boolean
  reload: () => Promise<void>
} {
  const [doc, setDoc] = useState<PlanDoc | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    const loaded = await window.plan.load(planId)
    setDoc(loaded)
    setLoading(false)
  }, [planId])

  useEffect(() => {
    reload()
  }, [reload])

  useEffect(() => {
    const offState = window.plan.onState((info) => {
      if (info.planId === planId) reload()
    })
    const offStep = window.plan.onStepUpdated((info) => {
      if (info.planId === planId) reload()
    })
    const offUpdated = window.plan.onUpdated((info) => {
      if (info.planId === planId) reload()
    })
    return () => {
      offState()
      offStep()
      offUpdated()
    }
  }, [planId, reload])

  return { doc, loading, reload }
}

/**
 * Helper for state → color/badge mapping. Used by the tile header + minimap.
 */
export function stateVisuals(state: PlanState): {
  label: string
  borderClass: string
  badgeClass: string
} {
  switch (state) {
    case 'draft':
      return { label: 'Draft', borderClass: 'border-zinc-500/40', badgeClass: 'bg-zinc-700 text-zinc-200' }
    case 'under_critique':
      return { label: 'Under critique', borderClass: 'border-amber-500/60', badgeClass: 'bg-amber-600 text-white' }
    case 'verified':
      return { label: 'Critiqued', borderClass: 'border-blue-500/60', badgeClass: 'bg-blue-600 text-white' }
    case 'needs_revision':
      return { label: 'Needs revision', borderClass: 'border-amber-500/60', badgeClass: 'bg-amber-700 text-white' }
    case 'approved':
      return { label: 'Approved', borderClass: 'border-green-500/60', badgeClass: 'bg-green-700 text-white' }
    case 'executing':
      return { label: 'Executing', borderClass: 'border-green-400/80 animate-pulse', badgeClass: 'bg-green-600 text-white' }
    case 'paused_needs_replan':
      return { label: 'Paused: replan', borderClass: 'border-amber-500/60', badgeClass: 'bg-amber-600 text-white' }
    case 'done':
      return { label: 'Done', borderClass: 'border-green-700/50', badgeClass: 'bg-green-800 text-green-100' }
    case 'archived':
      return { label: 'Archived', borderClass: 'border-zinc-700/40', badgeClass: 'bg-zinc-800 text-zinc-500' }
    case 'execution_failed':
      return { label: 'Execution failed', borderClass: 'border-red-500/60', badgeClass: 'bg-red-700 text-white' }
  }
}

export function latestVersion(doc: PlanDoc): PlanDoc['versions'][number] {
  return doc.versions[doc.versions.length - 1]
}

export function approvedVersion(doc: PlanDoc): PlanDoc['versions'][number] | null {
  if (!doc.meta.approvedVersion) return null
  return doc.versions.find((v) => v.version === doc.meta.approvedVersion) ?? null
}

export function displayVersion(doc: PlanDoc): PlanDoc['versions'][number] {
  return approvedVersion(doc) ?? latestVersion(doc)
}

export function unresolvedQuestionsCount(doc: PlanDoc): number {
  const v = latestVersion(doc)
  return v.plan.open_questions.filter((q) => !q.resolution || !q.resolution.trim()).length
}

export function stepsProgress(steps: PlanMeta extends never ? never : Array<{ status: string }>): { done: number; total: number } {
  const total = steps.length
  const done = steps.filter((s) => s.status === 'done' || s.status === 'skipped').length
  return { done, total }
}
