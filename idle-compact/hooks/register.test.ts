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
  on('session.usage', async ($: any) => {
    await options.onUsage?.($)
    return { value: { startedAt: 0, rateLimits: [], context: { tokens, window: 200000, breakdown: { totalTokens: options.breakdownTokens ?? tokens } } } }
  })
  on('session.compact', async (_: any, e: any) => {
    compacted++
    return ok ? { messages: [{ role: 'user', text: 'summary', toolUses: [] }] } : { skip: 'test' }
  })
  const shown: string[] = []
  on('ui.toast', (_: any, e: any) => (shown.push('toast:' + e.text), { value: undefined }))
  mock.env(on, options.noHome ? {} : { HOME: '/home/me' })
  on('session.id', () => ({ value: 'sid' }))
  on('ui.status', (_: any, e: any) => (shown.push('status:' + e.text), { value: undefined }))
  on('fs.write', async (_: any, e: any) => {
    await options.onWrite?.(e.text)
    if (options.writeFails) throw new Error('disk full')
    shown.push(e.path.replace(/^[A-Za-z]:/, '').replaceAll('\\', '/') + ':' + e.text) // Windows paths too
    return { value: undefined }
  })
  on('turn.complete', () => ({ text: '' }))
  on('turn.start', (_: any, e: any) => e)
  on('prompt.submit', async (_: any, e: any) => (await options.onPrompt?.(), options.dropPrompt) ? { drop: 'test' } : { text: e.text })
  return { clock, count: () => compacted, shown }
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
  expect(shown.at(-1)).toBe(deadline())
  // @ts-ignore
  await $.turn.start?.({ turnId: 't1' })
  expect(shown.at(-1)).toBe(FILE + 'active 55')
  await clock.advance(10 * MIN)
  // @ts-ignore
  await $.turn.complete?.({ reason: 'end_turn', answer: 'y' })
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
  await clock.settle()
  release()
  await Promise.all([ended, started])
  expect(shown.at(-1)).toBe(FILE + 'active 55')
})

test('one failed write does not stop the next one', async ($, on) => {
  const options = { writeFails: true }
  const { shown } = await setup(on, 150_000, true, options)
  // @ts-ignore
  await $.turn.complete?.({ reason: 'end_turn', answer: 'x' })
  options.writeFails = false
  // @ts-ignore
  await $.turn.start?.({ turnId: 't1' })
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

for (const [slept, want] of [[4, 1], [5, 0], [120, 0]] as const)
  test(`a timer that fires ${slept} min late ${want ? 'still compacts' : 'finds the cache gone and does not compact'}`, async ($, on) => {
    const { clock, count } = await setup(on, 150_000, true, { slept: slept * MIN })
    // @ts-ignore
    await $.turn.complete?.({ reason: 'end_turn', answer: 'x' })
    await clock.advance(56 * MIN)
    expect(count()).toBe(want)
  })
