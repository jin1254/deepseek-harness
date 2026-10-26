/** Independent plugin content follows ordinary message admission without editing the draft. */
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { SubmitOutcome, DraftAttachmentId } from '../src/client/contract/input.ts'
import type { SessionInputDeps } from '../src/client/input/facade.ts'
import { SessionInputShell } from '../src/client/input/facade.ts'

function bench(send: SessionInputDeps['defaultSink'] = () => Promise.resolve({ kind: 'success' })) {
  const sink = vi.fn(send)
  const shell = new SessionInputShell({
    actx: {} as Context, defaultSink: sink,
    commandAttachments: { serialize: async () => [], release: () => {}, unsupportedNotice: () => 'unsupported' },
  })
  onTestFinished(() => { shell.dispose() })
  const pending = createSnapshotStore(true)
  const settle = vi.fn()
  const capture = vi.fn(() => { pending.set(false); return { text: 'quote + comment', settle } })
  const off = shell.registerContribution({ pending, capture })
  return { shell, sink, pending, settle, capture, off }
}

describe('composer contributions', () => {
  it('submits only annotations while keeping the editor genuinely empty', async () => {
    const b = bench()
    expect(b.shell.snapshot.hasContributions).toBe(true)
    expect(b.shell.snapshot.draft).toBe('')
    b.shell.submit('queue', 'enter')
    expect(b.sink).toHaveBeenCalledWith('quote + comment', [], 'queue', expect.any(AbortSignal))
    expect(b.shell.snapshot.draft).toBe('')
    expect(b.shell.snapshot.hasContributions).toBeUndefined()
    await vi.waitFor(() => { expect(b.settle).toHaveBeenCalledExactlyOnceWith('success') })
    b.shell.submit()
    expect(b.sink).toHaveBeenCalledTimes(1)
  })

  it('appends captured content after normal text and includes ordinary attachments', async () => {
    const b = bench()
    b.shell.setDraft('Main instruction')
    b.shell.addAttachments(['file' as DraftAttachmentId])
    b.shell.submit('steer')
    expect(b.sink).toHaveBeenCalledWith('Main instruction\n\nquote + comment', ['file'], 'steer', expect.any(AbortSignal))
    expect(b.shell.snapshot.draft).toBe('')
    await vi.waitFor(() => { expect(b.settle).toHaveBeenCalledWith('success') })
  })

  it('preserves native quote serialization before appending contributed text', async () => {
    const b = bench()
    b.shell.setDraft('Main instruction')
    b.shell.insertQuote('Original quoted text')
    b.shell.submit()
    await vi.waitFor(() => { expect(b.sink).toHaveBeenCalledOnce() })
    const text = b.sink.mock.calls[0]?.[0]
    expect(text).toContain('> Original quoted text')
    expect(text).toContain('Main instruction')
    expect(text).toMatch(/\n\nquote \+ comment$/u)
  })

  it('restores failed reservations without replacing new text or capturing a newer note', async () => {
    let finish: (outcome: SubmitOutcome) => void = () => { throw new Error('No pending admission') }
    const sink = vi.fn(() => new Promise<SubmitOutcome>((resolve) => { finish = resolve }))
    const b = bench(sink)
    b.shell.setDraft('original')
    b.shell.submit()
    b.shell.setDraft('new text')
    b.pending.set(true)
    finish({ kind: 'error' })
    await vi.waitFor(() => { expect(b.settle).toHaveBeenCalledWith('error') })
    expect(b.shell.snapshot.draft).toBe('new text')
    expect(b.shell.snapshot.hasContributions).toBe(true)
    expect(b.capture).toHaveBeenCalledTimes(1)
  })

  it('keeps command submission independent of pending annotations', async () => {
    const b = bench()
    const command = vi.fn(async () => ({ kind: 'success' as const }))
    b.shell.setDraft('/test')
    b.shell.beginCommand({ name: 'test', token: '/test ', submit: command }, { start: 0, end: 5, draftRev: b.shell.snapshot.draftRev })
    b.shell.submit()
    await vi.waitFor(() => { expect(command).toHaveBeenCalledOnce() })
    expect(b.capture).not.toHaveBeenCalled()
    expect(b.shell.snapshot.hasContributions).toBe(true)
  })

  it('removes readiness on unregister and never captures another Session producer', () => {
    const a = bench()
    const b = bench()
    a.off()
    a.pending.set(false)
    a.pending.set(true)
    a.shell.submit()
    expect(a.sink).not.toHaveBeenCalled()
    expect(b.capture).not.toHaveBeenCalled()
    expect(b.shell.snapshot.hasContributions).toBe(true)
  })

  it('rolls back earlier reservations when a later producer fails to capture', async () => {
    const b = bench()
    b.shell.registerContribution({ pending: createSnapshotStore(true), capture: () => { throw new Error('capture failed') } })
    b.shell.setDraft('keep this')
    b.shell.submit()
    await vi.waitFor(() => { expect(b.shell.snapshot.draft).toBe('keep this') })
    expect(b.sink).not.toHaveBeenCalled()
    expect(b.settle).toHaveBeenCalledExactlyOnceWith('error')
  })

  it('aborts admission and settles cancellation once when the Session is released', async () => {
    let finish: (outcome: SubmitOutcome) => void = () => {}
    const b = bench(vi.fn(() => new Promise<SubmitOutcome>((resolve) => { finish = resolve })))
    b.shell.submit()
    const signal = b.sink.mock.calls[0]?.[3]
    b.shell.dispose()
    expect(signal?.aborted).toBe(true)
    expect(b.settle).toHaveBeenCalledExactlyOnceWith('cancelled')
    finish({ kind: 'success' })
    await Promise.resolve()
    expect(b.settle).toHaveBeenCalledTimes(1)
  })

  it('contains a settlement failure without starving other producers', async () => {
    const b = bench()
    b.settle.mockImplementation(() => { throw new Error('note recovery failed') })
    const other = vi.fn()
    b.shell.registerContribution({ pending: createSnapshotStore(true), capture: () => ({ text: 'second', settle: other }) })
    b.shell.submit()
    await vi.waitFor(() => { expect(other).toHaveBeenCalledWith('success') })
    expect(b.shell.notices.getSnapshot()?.text).toBe('note recovery failed')
  })
})
