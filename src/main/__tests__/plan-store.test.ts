/**
 * Unit tests for plan-store.
 *
 * Running:
 *   npm install -D vitest
 *   npx vitest run src/main/__tests__/plan-store.test.ts
 *
 * The tests override HOME so they write to a temp dir and don't
 * pollute the user's real ~/AgentCanvas/tmp.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Set HOME *before* importing plan-store so PLAN_DIR resolves into the tmp dir.
const tempHome = mkdtempSync(join(tmpdir(), 'plan-store-test-'))
process.env.HOME = tempHome

/* eslint-disable @typescript-eslint/no-require-imports */
const store = require('../plan-store') as typeof import('../plan-store')

afterAll(() => {
  try {
    rmSync(tempHome, { recursive: true, force: true })
  } catch {
    // ignore
  }
})

describe('plan-store state machine', () => {
  it('canTransition: allows legal transitions', () => {
    expect(store.canTransition('draft', 'under_critique')).toBe(true)
    expect(store.canTransition('under_critique', 'verified')).toBe(true)
    expect(store.canTransition('under_critique', 'needs_revision')).toBe(true)
    expect(store.canTransition('verified', 'approved')).toBe(true)
    expect(store.canTransition('approved', 'executing')).toBe(true)
    expect(store.canTransition('executing', 'done')).toBe(true)
    expect(store.canTransition('executing', 'paused_needs_replan')).toBe(true)
    expect(store.canTransition('executing', 'execution_failed')).toBe(true)
  })

  it('canTransition: rejects illegal transitions', () => {
    expect(store.canTransition('draft', 'approved')).toBe(false)
    expect(store.canTransition('draft', 'executing')).toBe(false)
    expect(store.canTransition('done', 'draft')).toBe(false)
    expect(store.canTransition('archived', 'executing')).toBe(false)
  })

  it('transition throws on illegal transition', async () => {
    const doc = await store.createPlan({ label: 'Test' })
    await expect(store.transition(doc.meta.planId, 'approved')).rejects.toThrow(/Illegal/)
  })
})

describe('plan-store create + versioning', () => {
  it('creates a plan with markdown content', async () => {
    const md = '## Problem\nThing is broken.\n\n## Approach\nFix it.\n\n## Steps\n- [ ] step one\n- [ ] step two\n'
    const doc = await store.createPlan({ label: 'P1', content: md })
    expect(doc.meta.state).toBe('draft')
    expect(doc.versions).toHaveLength(1)
    expect(doc.versions[0].plan.steps).toHaveLength(2)
    expect(doc.versions[0].plan.steps[0].text).toContain('step one')
    expect(doc.versions[0].plan.steps[0].status).toBe('pending')
    expect(doc.versions[0].plan.steps[0].id).toMatch(/^s_/)
  })

  it('appends a new version on update', async () => {
    const doc = await store.createPlan({ label: 'P2' })
    const updated = await store.updatePlan(doc.meta.planId, { risks: ['new risk'] })
    expect(updated.versions).toHaveLength(2)
    expect(updated.versions[1].plan.risks).toEqual(['new risk'])
    expect(updated.versions[0].plan.risks).toEqual([]) // older version untouched
  })

  it('reverts approved → draft on edit', async () => {
    const doc = await store.createPlan({
      label: 'P3',
      content: '## Steps\n- [ ] a\n## Acceptance Criteria\ndone'
    })
    await store.transition(doc.meta.planId, 'under_critique')
    await store.transition(doc.meta.planId, 'verified')
    const approved = await store.approvePlan(doc.meta.planId)
    expect(approved.meta.state).toBe('approved')
    expect(approved.meta.approvedVersion).toBe(1)

    const edited = await store.updatePlan(doc.meta.planId, { risks: ['r'] })
    expect(edited.meta.state).toBe('draft')
    // approvedVersion is retained so the running execution keeps its snapshot
    expect(edited.meta.approvedVersion).toBe(1)
  })
})

describe('plan-store open-questions gate', () => {
  it('blocks approval when an open question is unresolved', async () => {
    const md = '## Open Questions\n- what about the cache?'
    const doc = await store.createPlan({ label: 'P4', content: md })
    await store.transition(doc.meta.planId, 'under_critique')
    await store.transition(doc.meta.planId, 'verified')
    await expect(store.approvePlan(doc.meta.planId)).rejects.toThrow(/unresolved/)
  })

  it('allows approval once every question has a resolution', async () => {
    const md = '## Open Questions\n- what about the cache?'
    const doc = await store.createPlan({ label: 'P5', content: md })
    const qs = doc.versions[0].plan.open_questions.map((q) => ({ ...q, resolution: 'LRU, bounded' }))
    await store.updatePlan(doc.meta.planId, { open_questions: qs })
    await store.transition(doc.meta.planId, 'under_critique')
    await store.transition(doc.meta.planId, 'verified')
    const approved = await store.approvePlan(doc.meta.planId)
    expect(approved.meta.state).toBe('approved')
  })
})

describe('plan-store execution', () => {
  it('marks a step done only while executing, against the approved version', async () => {
    const md = '## Steps\n- [ ] first\n- [ ] second'
    const doc = await store.createPlan({ label: 'P6', content: md })
    await store.transition(doc.meta.planId, 'under_critique')
    await store.transition(doc.meta.planId, 'verified')
    await store.approvePlan(doc.meta.planId)

    const approvedDoc = store.loadPlan(doc.meta.planId)!
    const firstStepId = approvedDoc.versions[approvedDoc.meta.approvedVersion!! - 1].plan.steps[0].id

    // Cannot complete a step before execution starts
    await expect(store.completeStep(doc.meta.planId, firstStepId)).rejects.toThrow(/Cannot complete/)

    await store.transition(doc.meta.planId, 'executing')
    const done = await store.completeStep(doc.meta.planId, firstStepId, 'did it')
    const approvedV = done.versions.find((v) => v.version === done.meta.approvedVersion)!
    expect(approvedV.plan.steps[0].status).toBe('done')
    expect(approvedV.plan.steps[0].notes).toBe('did it')
  })

  it('deviation flips plan → paused_needs_replan', async () => {
    const md = '## Steps\n- [ ] the only step'
    const doc = await store.createPlan({ label: 'P7', content: md })
    await store.transition(doc.meta.planId, 'under_critique')
    await store.transition(doc.meta.planId, 'verified')
    await store.approvePlan(doc.meta.planId)
    await store.transition(doc.meta.planId, 'executing')

    const approved = store.loadPlan(doc.meta.planId)!
    const stepId = approved.versions[0].plan.steps[0].id
    const updated = await store.addDeviation(doc.meta.planId, stepId, 'file missing', 'create it first')
    expect(updated.meta.state).toBe('paused_needs_replan')
    expect(updated.deviations).toHaveLength(1)
    expect(updated.deviations[0].stepId).toBe(stepId)
  })
})

describe('plan-store archive', () => {
  it('cannot archive an executing plan', async () => {
    const doc = await store.createPlan({ label: 'P8' })
    await store.transition(doc.meta.planId, 'under_critique')
    await store.transition(doc.meta.planId, 'verified')
    await store.approvePlan(doc.meta.planId)
    await store.transition(doc.meta.planId, 'executing')
    await expect(store.archivePlan(doc.meta.planId)).rejects.toThrow(/executing/)
  })

  it('archiving a draft is idempotent if re-archived from archived state is illegal', async () => {
    const doc = await store.createPlan({ label: 'P9' })
    await store.archivePlan(doc.meta.planId)
    // Can go from archived → draft
    await store.transition(doc.meta.planId, 'draft')
    // But cannot go from archived → executing
    await store.archivePlan(doc.meta.planId)
    await expect(store.transition(doc.meta.planId, 'executing')).rejects.toThrow(/Illegal/)
  })
})
