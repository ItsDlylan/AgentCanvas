// NOTE: vitest is not wired up yet in this project — these tests are written in
// vitest style so they can be run once `vitest` is added to devDependencies.
// For now they exist as executable documentation of the contract.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ScrollbackIndex, redactSecrets } from '../scrollback-index'

describe('ScrollbackIndex', () => {
  let index: ScrollbackIndex

  beforeEach(() => {
    index = new ScrollbackIndex(':memory:')
  })

  afterEach(() => {
    index.close()
  })

  it('append → flush → MATCH returns row', () => {
    index.appendPtyData('t1', 'hello BANANA world\n')
    index.flush('t1')
    const results = index.searchScrollback({ query: 'BANANA' })
    expect(results.length).toBe(1)
    expect(results[0].terminalId).toBe('t1')
    expect(results[0].lineNo).toBe(1)
    expect(results[0].snippet).toContain('BANANA')
  })

  it('redacts AWS access key before insert', () => {
    index.appendPtyData('t1', 'key=AKIAIOSFODNN7EXAMPLE now\n')
    index.flush('t1')
    const hits = index.searchScrollback({ query: 'AKIAIOSFODNN7EXAMPLE' })
    expect(hits.length).toBe(0)
    const redactedHits = index.searchScrollback({ query: 'REDACTED' })
    expect(redactedHits.length).toBe(1)
  })

  it('dropTerminal clears all rows for that id', () => {
    index.appendPtyData('t1', 'one BANANA\n')
    index.appendPtyData('t2', 'two BANANA\n')
    index.flush('t1')
    index.flush('t2')
    expect(index.searchScrollback({ query: 'BANANA' }).length).toBe(2)
    index.dropTerminal('t1')
    const after = index.searchScrollback({ query: 'BANANA' })
    expect(after.length).toBe(1)
    expect(after[0].terminalId).toBe('t2')
  })

  it('filters results by terminalIds', () => {
    index.appendPtyData('t1', 'alpha\n')
    index.appendPtyData('t2', 'alpha\n')
    index.flush('t1')
    index.flush('t2')
    const scoped = index.searchScrollback({ query: 'alpha', terminalIds: ['t1'] })
    expect(scoped.length).toBe(1)
    expect(scoped[0].terminalId).toBe('t1')
  })

  it('splits input on newlines and increments line numbers', () => {
    index.appendPtyData('t1', 'line1 apple\nline2 banana\nline3 cherry\n')
    index.flush('t1')
    const apple = index.searchScrollback({ query: 'apple' })
    const banana = index.searchScrollback({ query: 'banana' })
    const cherry = index.searchScrollback({ query: 'cherry' })
    expect(apple[0].lineNo).toBe(1)
    expect(banana[0].lineNo).toBe(2)
    expect(cherry[0].lineNo).toBe(3)
  })

  it('keeps partial line pending until newline arrives', () => {
    index.appendPtyData('t1', 'partial ')
    index.flush('t1')
    expect(index.searchScrollback({ query: 'partial' }).length).toBe(0)
    index.appendPtyData('t1', 'pineapple\n')
    index.flush('t1')
    const hits = index.searchScrollback({ query: 'pineapple' })
    expect(hits.length).toBe(1)
    expect(hits[0].lineNo).toBe(1)
  })
})

describe('redactSecrets', () => {
  it('redacts AWS access keys', () => {
    expect(redactSecrets('AKIAIOSFODNN7EXAMPLE')).toBe('[REDACTED:AWS_ACCESS_KEY]')
  })

  it('redacts GitHub PAT tokens', () => {
    const pat = 'ghp_' + 'a'.repeat(36)
    expect(redactSecrets(pat)).toBe('[REDACTED:GITHUB_PAT]')
  })

  it('redacts Stripe keys', () => {
    expect(redactSecrets('sk_live_' + 'a'.repeat(24))).toBe('[REDACTED:STRIPE_KEY]')
    expect(redactSecrets('sk_test_' + 'b'.repeat(24))).toBe('[REDACTED:STRIPE_KEY]')
  })

  it('redacts JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0MTIzNDU2Nzg5MCJ9.abcdefghij1234567890'
    expect(redactSecrets(jwt)).toBe('[REDACTED:JWT]')
  })

  it('redacts Bearer auth', () => {
    expect(redactSecrets('Authorization: Bearer abcdef1234567890xyz')).toContain('[REDACTED:BEARER]')
  })

  it('redacts dotenv-style secrets while preserving the key', () => {
    expect(redactSecrets('MY_API_KEY=abcdef1234')).toBe('MY_API_KEY=[REDACTED:ENV]')
    expect(redactSecrets('FOO_SECRET=supersecret')).toBe('FOO_SECRET=[REDACTED:ENV]')
    expect(redactSecrets('DB_PASSWORD=hunter2')).toBe('DB_PASSWORD=[REDACTED:ENV]')
  })
})
