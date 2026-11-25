import { expect, mock, test } from 'claude-code/testing'

const MIN = 60 * 1000
const FILE = '/home/me/.claude/idle-compact/sid:'

async function setup(on: any, tokens: number, ok = false, options: any = {}) {
  // options.slept: the machine slept, so once the clock has moved, wall time runs ahead of the due time
  const clock: any = mock.clock(((event: string, ...rest: any[]) =>
    options.slept && event === 'clock.now'
      ? on(event, () => ({ value: clock.now() + (clock.now() > 0 ? options.slept : 0) }))
      : on(event, ...rest)) as any)
  let compacted = 0
  const notes: unknown[] = []
  on('session.usage', async ($: any) => {
    await options.onUsage?.($)
    return { value: { startedAt: 0, rateLimits: [], context: { tokens, window: 200000, breakdown: { totalTokens: options.breakdownTokens ?? tokens } } } }
  })
  on('session.compact', async (_: any, e: any) => {
    compacted++
    notes.push(e.instructions)
    return ok ? { messages: [{ role: 'user', text: 'summary', toolUses: [] }] } : { skip: 'test' }
  })
  const shown: string[] = []
  on('ui.toast', (_: any, e: any) => (shown.push('toast:' + e.text), { value: undefined }))
  // what smart-compact's open offer holds
  on('state.get', async (_: any, e: any) => {
    await options.onState?.()
    if (options.stateFails) return { deny: 'no state' } // a throw here would only skip this hook
    return { value: { value: e.plugin === 'smart-compact' && e.key === 'suggestion' ? options.offer : undefined, version: 1 } }
  })
  mock.env(on, options.noHome ? {} : { HOME: '/home/me' })
  on('session.id', () => ({ value: 'sid' }))
  on('ui.status', (_: any, e: any) => (shown.push('status:' + e.text), { value: undefined }))
  on('fs.write', async (_: any, e: any) => {
    await options.onWrite?.(e.text)
    if (options.writeFails) return { deny: 'disk full' }
    shown.push(e.path.replace(/^[A-Za-z]:/, '').replaceAll('\\', '/') + ':' + e.text) // Windows paths too
    return { value: undefined }
  })
  on('turn.complete', () => ({ text: '' }))
  on('turn.start', (_: any, e: any) => e)
  on('prompt.submit', async (_: any, e: any) => (await options.onPrompt?.(), options.dropPrompt) ? { drop: 'test' } : { text: e.text })
  return { clock, count: () => compacted, shown, notes }
}

test('compacts after 55 min idle when context is big', async ($, on) => {
  const { clock, count } = await setup(on, 150_000)
  // @ts-ignore: fire the end of a main turn
  await $.turn.complete?.({ reason: 'end_turn', answer: 'x' })
  await clock.advance(54 * MIN)
  expect(count()).toBe(0)
  await clock.advance(2 * MIN)
  expect(count()).toBe(1)
})

test('a prompt and its turn inside the window cancel it', async ($, on) => {
  const { clock, count } = await setup(on, 150_000)
  // @ts-ignore
  await $.turn.complete?.({ reason: 'end_turn', answer: 'x' })
  await clock.advance(30 * MIN)
  // @ts-ignore
  await $.prompt.submit?.({ text: 'hi' })
  // @ts-ignore
  await $.turn.start?.({ turnId: 't1' })
  await clock.advance(60 * MIN)
  expect(count()).toBe(0)
})

test('small context is left alone', async ($, on) => {
  const { clock, count } = await setup(on, 50_000)
  // @ts-ignore
  await $.turn.complete?.({ reason: 'end_turn', answer: 'x' })
  await clock.advance(60 * MIN)
  expect(count()).toBe(0)
})

test('compacts at exactly 100,000 tokens', async ($, on) => {
  const { clock, count } = await setup(on, 100_000, true)
  // @ts-ignore
  await $.turn.complete?.({ reason: 'end_turn', answer: 'x' })
  await clock.advance(56 * MIN)
  expect(count()).toBe(1)
})

test('does not compact at 99,999 tokens', async ($, on) => {
  const { clock, count } = await setup(on, 99_999, true)
  // @ts-ignore
  await $.turn.complete?.({ reason: 'end_turn', answer: 'x' })
  await clock.advance(56 * MIN)
  expect(count()).toBe(0)
})

test('a veto does not show a toast or status', async ($, on) => {
  const { clock, count, shown } = await setup(on, 150_000)
  // @ts-ignore
  await $.turn.complete?.({ reason: 'end_turn', answer: 'x' })
  await clock.advance(56 * MIN)
  expect(count()).toBe(1)
  expect(shown.filter(t => t.startsWith('toast:') || t.includes(':done'))).toEqual([])
})

test('a subagent turn ending does not start the countdown', async ($, on) => {
  const { clock, count } = await setup(on, 150_000)
  // @ts-ignore
  await $.turn.complete?.({ reason: 'end_turn', answer: 'x', agentId: 'sub-1' })
  await clock.advance(120 * MIN)
  expect(count()).toBe(0)
})

test('a new turn start cancels the countdown', async ($, on) => {
  const { clock, count } = await setup(on, 150_000)
  // @ts-ignore
  await $.turn.complete?.({ reason: 'end_turn', answer: 'x' })
  await clock.advance(30 * MIN)
  // @ts-ignore
  await $.turn.start?.({ turnId: 't1' })
  await clock.advance(120 * MIN)
  expect(count()).toBe(0)
})

test('a subagent turn start does not cancel the countdown', async ($, on) => {
  const { clock, count } = await setup(on, 150_000, true)
  // @ts-ignore
  await $.turn.complete?.({ reason: 'end_turn', answer: 'x' })
  await clock.advance(20 * MIN)
  // @ts-ignore
  await $.turn.start?.({ turnId: 't2', agentId: 'sub-1' })
  await clock.advance(40 * MIN)
  expect(count()).toBe(1)
})

test('a dropped prompt keeps the original deadline', async ($, on) => {
  const { clock, count } = await setup(on, 150_000, true, { dropPrompt: true })
  // @ts-ignore
  await $.turn.complete?.({ reason: 'end_turn', answer: 'x' })
  await clock.advance(40 * MIN)
  // @ts-ignore
  await $.prompt.submit?.({ text: 'hi' })
  await clock.advance(14 * MIN)
  expect(count()).toBe(0)
  await clock.advance(2 * MIN)
  expect(count()).toBe(1)
})

test('a prompt still being submitted at the deadline prevents compaction', async ($, on) => {
  let release: () => void = () => {}
  const gate = new Promise<void>(r => (release = r))
  const { clock, count } = await setup(on, 150_000, true, { onPrompt: () => gate })
  // @ts-ignore
  await $.turn.complete?.({ reason: 'end_turn', answer: 'x' })
  await clock.advance(54 * MIN)
  // @ts-ignore
  const submitted = $.prompt.submit?.({ text: 'hi' })
  await clock.settle()
  await clock.advance(2 * MIN)
  release()
  await submitted
  expect(count()).toBe(0)
})

test('a turn that starts while the timer awaits usage prevents compaction', async ($, on) => {
  let release: () => void = () => {}
  const gate = new Promise<void>(r => (release = r))
  let entered: () => void = () => {}
  const inUsage = new Promise<void>(r => (entered = r))
  const { clock, count } = await setup(on, 150_000, true, { onUsage: () => (entered(), gate) })
  // @ts-ignore
  await $.turn.complete?.({ reason: 'end_turn', answer: 'x' })
  const fired = clock.advance(56 * MIN) // the timer fires and parks on the usage read
  await inUsage
  // @ts-ignore
  await $.turn.start?.({ turnId: 't1' })
  release()
  await fired
  expect(count()).toBe(0)
})

test('back-to-back turns compact once, measured from the last one', async ($, on) => {
  const { clock, count } = await setup(on, 150_000)
  // @ts-ignore
  await $.turn.complete?.({ reason: 'end_turn', answer: 'x' })
  await clock.advance(40 * MIN)
  // @ts-ignore
  await $.turn.complete?.({ reason: 'end_turn', answer: 'y' })
  await clock.advance(40 * MIN)
  expect(count()).toBe(0)
  await clock.advance(20 * MIN)
  expect(count()).toBe(1)
})

test('a real compaction reports the minutes idle in a toast and the status line', async ($, on) => {
  const { clock, count, shown } = await setup(on, 150_000, true)
  // @ts-ignore
  await $.turn.complete?.({ reason: 'end_turn', answer: 'x' })
  await clock.advance(56 * MIN)
  expect(count()).toBe(1)
  expect(shown).toContain('toast:idle-compact: compacted after 55 min idle (150K tokens)')
  expect(shown).toContain(FILE + 'done 55 150')
})

test('a reload mid-idle re-arms the countdown', async ($, on) => {
  const { clock, count, shown } = await setup(on, 150_000)
  // @ts-ignore: a reload runs session.start again with no turn.complete after it
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  await $.session.start?.({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  expect(shown).toContain('status:undefined') // clears what an older build pinned
  await clock.advance(56 * MIN)
  expect(count()).toBe(1)
})

test('the gate reads the current breakdown, not the stale last-request count', async ($, on) => {
  const { clock, count } = await setup(on, 50_000, false, { breakdownTokens: 150_000 })
  // @ts-ignore
  await $.turn.complete?.({ reason: 'end_turn', answer: 'x' })
  await clock.advance(56 * MIN)
  expect(count()).toBe(1)
})

test('the status file holds the deadline, and a new turn marks it active', async ($, on) => {
  const { clock, shown } = await setup(on, 150_000)
  const deadline = () => FILE + 'armed ' + (clock.now() + 55 * MIN) / 1000
  // @ts-ignore
  await $.turn.complete?.({ reason: 'end_turn', answer: 'x' })
  await clock.settle()
  expect(shown.at(-1)).toBe(deadline())
  // @ts-ignore
  await $.turn.start?.({ turnId: 't1' })
  await clock.settle()
  expect(shown.at(-1)).toBe(FILE + 'active 55')
  await clock.advance(10 * MIN)
  // @ts-ignore
  await $.turn.complete?.({ reason: 'end_turn', answer: 'y' })
  await clock.settle()
  expect(shown.at(-1)).toBe(deadline())
})

test('a slow old write cannot land after a newer one', async ($, on) => {
  let release: () => void = () => {}
  const gate = new Promise<void>(r => (release = r))
  const { clock, shown } = await setup(on, 150_000, true, { onWrite: (t: string) => t.startsWith('armed') ? gate : undefined })
  // @ts-ignore
  const ended = $.turn.complete?.({ reason: 'end_turn', answer: 'x' })
  await clock.settle()
  // @ts-ignore
  const started = $.turn.start?.({ turnId: 't1' })
  let turnsDone = false
  void Promise.all([ended, started]).then(() => { turnsDone = true })
  await clock.settle()
  const doneBeforeWrite = turnsDone // a slow disk must not hold up either turn
  release()
  await Promise.all([ended, started])
  expect(doneBeforeWrite).toBe(true)
  await clock.settle()
  expect(shown.at(-1)).toBe(FILE + 'active 55')
})

test('one failed write does not stop the next one', async ($, on) => {
  const options = { writeFails: true }
  const { clock, shown } = await setup(on, 150_000, true, options)
  // @ts-ignore
  await $.turn.complete?.({ reason: 'end_turn', answer: 'x' })
  await clock.settle()
  options.writeFails = false
  // @ts-ignore
  await $.turn.start?.({ turnId: 't1' })
  await clock.settle()
  expect(shown).toEqual([FILE + 'active 55'])
})

test('without HOME it still compacts and writes nothing', async ($, on) => {
  const { clock, count, shown } = await setup(on, 150_000, true, { noHome: true })
  // @ts-ignore
  await $.turn.complete?.({ reason: 'end_turn', answer: 'x' })
  await clock.advance(56 * MIN)
  expect(count()).toBe(1)
  expect(shown.filter(t => !t.startsWith('toast:'))).toEqual([])
})

test('a failing status write does not stop the compaction', async ($, on) => {
  const { clock, count, shown } = await setup(on, 150_000, true, { writeFails: true })
  // @ts-ignore
  await $.turn.complete?.({ reason: 'end_turn', answer: 'x' })
  await clock.advance(56 * MIN)
  expect(count()).toBe(1)
  expect(shown).toContain('toast:idle-compact: compacted after 55 min idle (150K tokens)')
})

for (const [slept, want] of [[4, 1], [5, 0], [120, 0], [-56, 0]] as const)
  test(`a timer that fires ${slept} min late ${want ? 'still compacts' : 'does not compact'}`, async ($, on) => {
    const { clock, count } = await setup(on, 150_000, true, { slept: slept * MIN })
    // @ts-ignore
    await $.turn.complete?.({ reason: 'end_turn', answer: 'x' })
    await clock.advance(56 * MIN)
    expect(count()).toBe(want)
  })

for (const [name, offer, want] of [
  ['an unanswered request with a note', { source: 'claude', reason: 'done', instructions: 'keep the TODOs', percent: 70 }, 'keep the TODOs'],
  ['a request without a note', { source: 'claude', reason: 'done', percent: 70 }, undefined],
  ['a note that is not text', { source: 'claude', instructions: { a: 1 } }, undefined],
  ['an answered offer', null, undefined],
  ['smart-compact not installed', undefined, undefined],
] as const)
  test(`smart-compact: ${name} compacts ${want ? 'with the note' : 'plainly'}`, async ($, on) => {
    const { clock, notes } = await setup(on, 150_000, true, { offer })
    // @ts-ignore
    await $.turn.complete?.({ reason: 'end_turn', answer: 'x' })
    await clock.advance(56 * MIN)
    expect(notes).toEqual([want])
  })

test('smart-compact: the note is read at the deadline, not when the turn ended', async ($, on) => {
  const options: any = { offer: { source: 'claude', instructions: 'old' } }
  const { clock, notes } = await setup(on, 150_000, true, options)
  // @ts-ignore
  await $.turn.complete?.({ reason: 'end_turn', answer: 'x' })
  await clock.advance(30 * MIN)
  options.offer = null // the person pressed "Not now"
  await clock.advance(26 * MIN)
  expect(notes).toEqual([undefined])
})

test('smart-compact: a failing read of the note does not stop the compaction', async ($, on) => {
  const { clock, notes } = await setup(on, 150_000, true, { stateFails: true })
  // @ts-ignore
  await $.turn.complete?.({ reason: 'end_turn', answer: 'x' })
  await clock.advance(56 * MIN)
  expect(notes).toEqual([undefined])
})

test('a turn that starts while the timer awaits the note prevents compaction', async ($, on) => {
  let release: () => void = () => {}
  const gate = new Promise<void>(r => (release = r))
  let entered: () => void = () => {}
  const inState = new Promise<void>(r => (entered = r))
  const { clock, count } = await setup(on, 150_000, true, { onState: () => (entered(), gate) })
  // @ts-ignore
  await $.turn.complete?.({ reason: 'end_turn', answer: 'x' })
  const fired = clock.advance(56 * MIN)
  await inState
  // @ts-ignore
  await $.turn.start?.({ turnId: 't1' })
  release()
  await fired
  expect(count()).toBe(0)
})

test('cache expiry during a smart-compact note read prevents compaction', async ($, on) => {
  const options = { slept: 1, onState: () => { options.slept = 5 * MIN } }
  const { clock, count } = await setup(on, 150_000, true, options)
  // @ts-ignore
  await $.turn.complete?.({ reason: 'end_turn', answer: 'x' })
  await clock.advance(55 * MIN)
  expect(count()).toBe(0)
})

test('another successful compact invalidates the idle usage snapshot', async ($, on) => {
  let entered!: () => void
  let release!: () => void
  const reading = new Promise<void>(resolve => { entered = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  const options = { onState: () => { entered(); return gate }, breakdownTokens: 150_000 }
  const { clock, notes } = await setup(on, 150_000, true, options)
  // @ts-ignore
  await $.turn.complete?.({ reason: 'end_turn', answer: 'x' })
  const firing = clock.advance(55 * MIN)
  await reading
  await $.session.compact({
    trigger: 'plugin',
    messages: [{ role: 'user', text: 'prior context', toolUses: [] }],
    instructions: 'other compact',
  })
  options.breakdownTokens = 10_000
  release()
  await firing
  expect(notes).toEqual(['other compact'])
})
