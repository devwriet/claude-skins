import type { Register, Timer } from 'claude-code'

const IDLE_MS = 55 * 60 * 1000 // backstop: native idle compaction fires ~54 min, so only act if it missed
const CACHE_TTL_MS = 60 * 60 * 1000 // past this the cache is gone and compacting re-reads everything at full price
const MIN_TOKENS = 100_000 // native's own floor; below this a compaction is not worth the call

const ACTIVE = `active ${IDLE_MS / 60_000}` // status text while a turn runs

let timer: Timer | undefined
let generation = 0
let submitting = 0 // prompts between Enter and their turn starting
function stop() {
  generation++
  timer?.cancel()
  timer = undefined
}

// The status line script reads this file: "armed <deadline epoch s>", "active <min>" while a
// turn runs, or "done <idle min> <K tokens>". Writes run in order and a stale one is skipped.
let writes: Promise<void> = Promise.resolve()
function show($: any, text: string) {
  const id = generation
  writes = writes.then(async () => {
    const home = await $.env.get('HOME')
    if (!home || id !== generation) return
    const sid = await $.session.id()
    if (id === generation) await $.fs.write(`${home}/.claude/idle-compact/${sid}`, text)
  }).catch(() => {}) // display only: a failed write must not block a turn or the countdown
  return writes
}

async function arm($: any) {
  stop()
  const id = generation
  const endedAt = await $.clock.now()
  if (id !== generation) return
  timer = $.clock.after(IDLE_MS, async () => {
    if (id !== generation) return
    try {
      const { context } = await $.session.usage({ breakdown: 'summary' })
      if (id !== generation) return
      const tokens = context.breakdown?.totalTokens ?? context.tokens
      if (tokens === undefined || tokens < MIN_TOKENS) return
      const firedAt = await $.clock.now()
      if (id !== generation || submitting > 0) return
      if (firedAt - endedAt >= CACHE_TTL_MS) return // the machine slept through the deadline
      const r = await $.session.compact()
      if (id !== generation) return
      if ('skip' in r && r.skip) return
      const mins = Math.round((firedAt - endedAt) / 60000)
      const msg = `idle-compact: compacted after ${mins} min idle (${Math.round(tokens / 1000)}K tokens)`
      $.ui.toast(msg, { timeoutMs: 30_000 })
      await show($, `done ${mins} ${Math.round(tokens / 1000)}`) // stays until the next turn, so a missed toast is still visible
    } catch {
      // a turn started meanwhile: compact rejects while one runs, so do nothing
    }
  })
  await show($, `armed ${Math.floor((endedAt + IDLE_MS) / 1000)}`)
}

export const register: Register = on => {
  // A prompt on its way in blocks the compaction but keeps the countdown: it may be dropped.
  // next resolves once its turn started, and turn.start is what cancels.
  on('prompt.submit', async ($, e, next) => {
    submitting++
    try {
      return await next(e)
    } finally {
      submitting--
    }
  })
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      stop()
      await show($, ACTIVE)
    }
    return next(e)
  })

  // A reload (any edit to this mod) wipes the timer, and the turn that ended before it never
  // fires turn.complete again. Re-arm on load; the size gate makes a fresh session a no-op.
  on('session.start', async ($, e, next) => {
    $.ui.status(undefined) // a pinned status outlives a reload; older builds used one
    await arm($)
    return next(e)
  })

  // Main turn ended: start the idle countdown. Subagent ends are ignored.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await arm($)
    return next(e)
  })
}
