/**
 * Unit tests for palette-search. Written in vitest-compatible syntax.
 * No test runner is wired in the project yet; when one is added these tests run as-is.
 */

import { describe, it, expect } from 'vitest'
import { parseQuery, rank, filterCorpus } from '../palette-search'
import type { PaletteTile } from '../palette-corpus'

const tile = (overrides: Partial<PaletteTile>): PaletteTile => ({
  id: overrides.id ?? 't1',
  type: overrides.type ?? 'terminal',
  label: overrides.label ?? '',
  metadata: overrides.metadata ?? {},
  workspaceId: overrides.workspaceId ?? 'default',
  cwd: overrides.cwd,
  url: overrides.url,
  status: overrides.status,
  foregroundProcess: overrides.foregroundProcess
})

const noCtx = { recencyList: [], activeWorkspaceId: 'default' }

describe('parseQuery', () => {
  it('returns null prefix for plain text', () => {
    expect(parseQuery('hello')).toEqual({ prefix: null, terms: 'hello' })
  })

  it('parses > prefix without arg', () => {
    expect(parseQuery('>toggle minimap')).toEqual({ prefix: '>', terms: 'toggle minimap' })
  })

  it('parses ? prefix as scrollback search', () => {
    expect(parseQuery('?TypeError foo')).toEqual({ prefix: '?', terms: 'TypeError foo' })
  })

  it('parses @workspace with remainder terms', () => {
    expect(parseQuery('@acme term build')).toEqual({
      prefix: '@',
      prefixArg: 'acme',
      terms: 'term build'
    })
  })

  it('parses :running as state filter', () => {
    expect(parseQuery(':running foo')).toEqual({
      prefix: ':',
      prefixArg: 'running',
      terms: 'foo'
    })
  })

  it('treats second prefix after @ as part of terms', () => {
    const parsed = parseQuery('@acme >build')
    expect(parsed.prefix).toBe('@')
    expect(parsed.prefixArg).toBe('acme')
    expect(parsed.terms).toBe('>build')
  })

  it('returns empty terms for empty input', () => {
    expect(parseQuery('')).toEqual({ prefix: null, terms: '' })
  })
})

describe('rank', () => {
  it('pins exact label match to top with Infinity score', () => {
    const corpus = [
      tile({ id: 'a', label: 'build' }),
      tile({ id: 'b', label: 'builder' }),
      tile({ id: 'c', label: 'xbuildx' })
    ]
    const r = rank(corpus, parseQuery('build'), noCtx)
    expect(r[0].tile.id).toBe('a')
    expect(r[0].score).toBe(Number.POSITIVE_INFINITY)
  })

  it('boosts recent tile above older tile with same fzf score', () => {
    const corpus = [
      tile({ id: 'old', label: 'alpha beta' }),
      tile({ id: 'new', label: 'alpha beta' })
    ]
    const r = rank(corpus, parseQuery('alpha'), { recencyList: ['new', 'old'], activeWorkspaceId: 'default' })
    expect(r[0].tile.id).toBe('new')
  })

  it('@workspace narrows to that workspace', () => {
    const corpus = [
      tile({ id: 'x', label: 'server', workspaceId: 'acme' }),
      tile({ id: 'y', label: 'server', workspaceId: 'other' })
    ]
    const r = rank(corpus, parseQuery('@acme server'), noCtx)
    expect(r.map((m) => m.tile.id)).toEqual(['x'])
  })

  it(':running filters to terminals with status running', () => {
    const corpus = [
      tile({ id: 'r', label: 'build', status: 'running' }),
      tile({ id: 'i', label: 'build', status: 'idle' }),
      tile({ id: 'n', label: 'build', type: 'notes' })
    ]
    const r = rank(corpus, parseQuery(':running build'), noCtx)
    expect(r.map((m) => m.tile.id)).toEqual(['r'])
  })
})

describe('filterCorpus', () => {
  it('returns corpus unchanged with no prefix', () => {
    const corpus = [tile({ id: 'a' }), tile({ id: 'b' })]
    expect(filterCorpus(corpus, parseQuery('foo'))).toEqual(corpus)
  })

  it('#team filters by metadata.team', () => {
    const corpus = [
      tile({ id: 'a', metadata: { team: 'auth' } }),
      tile({ id: 'b', metadata: { team: 'ingest' } })
    ]
    expect(filterCorpus(corpus, parseQuery('#auth')).map((t) => t.id)).toEqual(['a'])
  })
})
