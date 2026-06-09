import { describe, it, expect } from 'vitest'
import { createPendingStore } from './pending-store'

const A = { rowIndex: 1, columnId: 'c1' }
const B = { rowIndex: 2, columnId: 'c1' }

describe('pendingStore', () => {
  it('starts empty', () => {
    const s = createPendingStore()
    expect(s.getSnapshot().size).toBe(0)
  })

  it('setPending adds an optimistic entry', () => {
    const s = createPendingStore()
    s.setPending(A, 'new')
    expect(s.has(A)).toBe(true)
    expect(s.getSnapshot().get('1:c1')).toEqual({ cell: A, value: 'new', status: 'pending' })
  })

  it('setError flips status to error and keeps the value', () => {
    const s = createPendingStore()
    s.setPending(A, 'new')
    s.setError(A)
    expect(s.getSnapshot().get('1:c1')).toMatchObject({ status: 'error', value: 'new' })
  })

  it('clear removes one entry without touching others', () => {
    const s = createPendingStore()
    s.setPending(A, 'a')
    s.setPending(B, 'b')
    s.clear(A)
    expect(s.has(A)).toBe(false)
    expect(s.has(B)).toBe(true)
  })

  it('supports multiple concurrent pending cells', () => {
    const s = createPendingStore()
    s.setPending(A, 'a')
    s.setPending(B, 'b')
    expect(s.getSnapshot().size).toBe(2)
  })

  it('clear is a no-op (no churn) when the cell is absent', () => {
    const s = createPendingStore()
    const snap = s.getSnapshot()
    s.clear(A)
    expect(s.getSnapshot()).toBe(snap)
  })

  it('produces a fresh Map identity on mutation (immutable snapshots)', () => {
    const s = createPendingStore()
    const before = s.getSnapshot()
    s.setPending(A, 'x')
    expect(s.getSnapshot()).not.toBe(before)
    expect(before.size).toBe(0) // old snapshot untouched
  })

  it('notifies subscribers and stops after unsubscribe', () => {
    const s = createPendingStore()
    let calls = 0
    const unsub = s.subscribe(() => { calls++ })
    s.setPending(A, 'x')
    expect(calls).toBe(1)
    unsub()
    s.clear(A)
    expect(calls).toBe(1)
  })
})
