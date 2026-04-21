import type { DerivedTaskState } from '../../preload/index'

export interface UnsatisfiedDep {
  taskId: string
  label: string
  state: DerivedTaskState
}

export async function unsatisfiedDependencies(taskId: string): Promise<UnsatisfiedDep[]> {
  const edges = await window.edges.load()
  const dependsOnTargets = edges
    .filter((e) => e.kind === 'depends-on' && e.source === taskId)
    .map((e) => e.target)

  if (dependsOnTargets.length === 0) return []

  const results = await Promise.all(
    dependsOnTargets.map(async (targetId) => {
      const [file, derived] = await Promise.all([
        window.task.load(targetId),
        window.task.deriveState(targetId)
      ])
      if (!file || !derived) return null
      if (derived.state === 'done') return null
      return { taskId: targetId, label: file.meta.label, state: derived.state }
    })
  )

  return results.filter((r): r is UnsatisfiedDep => r !== null)
}
