import { useState, useCallback, useEffect, useRef } from 'react'
import type { DiffResult } from '../../main/diff-service'

export type { DiffResult, DiffFileChange, DiffChangeKind } from '../../main/diff-service'

interface UseDiffOptions {
  cwd: string | undefined
}

interface UseDiffReturn {
  data: DiffResult | null
  loading: boolean
  error: string | null
  refresh: () => void
  selectedFile: string | null
  selectFile: (path: string | null) => void
  viewMode: 'split' | 'unified'
  setViewMode: (mode: 'split' | 'unified') => void
}

export function useDiff({ cwd }: UseDiffOptions): UseDiffReturn {
  const [data, setData] = useState<DiffResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'split' | 'unified'>('split')
  const cwdRef = useRef(cwd)
  cwdRef.current = cwd

  const fetchDiff = useCallback(async () => {
    const currentCwd = cwdRef.current
    if (!currentCwd) return

    setLoading(true)
    setError(null)
    try {
      const result = await window.diff.compute(currentCwd)
      if (result.error) {
        setError(result.error)
      }
      setData(result)
      // Auto-select first file if nothing selected
      if (result.files.length > 0) {
        setSelectedFile((prev) => {
          if (prev && result.files.some((f) => f.newPath === prev)) return prev
          return result.files[0].newPath
        })
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch on mount and when cwd changes
  useEffect(() => {
    if (cwd) fetchDiff()
  }, [cwd, fetchDiff])

  return {
    data,
    loading,
    error,
    refresh: fetchDiff,
    selectedFile,
    selectFile: setSelectedFile,
    viewMode,
    setViewMode
  }
}
