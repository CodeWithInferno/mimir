// What an author gets wrong in a sentence is absorbed, not reported: every sentence that leaves absorbNarration()
// passes the narration rules of `mimir check` (src/lib/guide/lint.ts), checked here with the linter itself.
import { describe, expect, test } from 'bun:test'
import { estimateTiming, lintNarration, parseNarration, scheduleCues } from '../../../src/lib/guide/index.ts'
import { GUIDE_DEFAULTS } from '../../../src/guide/index.ts'
import { compile } from '../../../src/core/index.ts'
import { absorbNarration } from '../../../src/quick/narration.ts'
import { cells, describeAccount, explain, flowBlock, quickAccount } from '../../../src/quick/index.ts'
import { last } from './real.ts'

const R = GUIDE_DEFAULTS
const lint = (say: string): string[] => {
  const parsed = parseNarration(say)
  const timing = estimateTiming(parsed, { charsPerSecond: R.charactersPerSecond, commaPause: R.commaPause, sentencePause: R.sentencePause, leadIn: R.leadIn })
  const schedule = scheduleCues(parsed, timing, { hop: R.hop, minPerch: R.perch, drawTime: R.drawTime, glowMin: R.glowTime, dockAfter: R.dockAfter, lateTolerance: R.maximumLate } as never)
  return lintNarration({ ...parsed, errors: [] }, schedule, parsed.spans.flatMap((s) => s.targets).map((id) => ({ id })) as never, { maxSentenceWords: R.maximumSentenceWords, maxMarksPerSentence: R.maximumMarksPerSentence, maxDeadAir: R.maximumDeadAir, maxLate: R.maximumLate }).map((f) => f.code).filter((c) => c !== 'GUIDE-DEAD-AIR')
}

describe('absorbNarration', () => {
  test('a clean sentence is left exactly as written', () => {
    const say = 'A [rod](rod) ties the [crank](crank) to a piston.'
    expect(absorbNarration(say, R)).toEqual({ say, changes: [] })
  })
  test('too many links in a sentence: the first three stay marks, the rest are plain words', () => {
    const bad = 'One job travels the line: [producer](a), [queue](b), a [worker](c), the [database](d).'
    expect(lint(bad)).toContain('GUIDE-CROWDED')
    const out = absorbNarration(bad, R)
    expect(out.say).toBe('One job travels the line: [producer](a), [queue](b), a [worker](c), the database.')
    expect(lint(out.say)).toEqual([])
    expect(out.changes.join(' ')).toContain('more than 3 links')
  })
  test('links back to back: the pointer cannot travel, so the later one glows; the same part twice in a row is said once', () => {
    expect(lint('[lo](lo) [hi](hi) meet.')).toContain('GUIDE-LATE')
    expect(absorbNarration('[lo](lo) [hi](hi) meet.', R).say).toBe('[lo](lo) [hi](glow:hi) meet.')
    expect(absorbNarration('The [row](row) is sorted and the [row](row) is long.', R).say).toBe('The [row](row) is sorted and the row is long.')
  })
  test('symbols and abbreviations are spoken as words, in the text and inside link words, never in a link target', () => {
    const out = absorbNarration('Nothing is lost: [in](sys.in) = [done](sys.done) + queued, e.g. 35% & more -> [dead](a->b).', R)
    expect(out.say).toBe('Nothing is lost: [in](sys.in) equals [done](sys.done) plus queued, for example 35 percent and more to [dead](a->b).')
    expect(lint(out.say)).toEqual([])
  })
  test('a sentence over the limit is spoken as two, cut at a comma or before a joining word', () => {
    const long = 'This is a very long sentence that keeps going on and on about the request, which travels from the client to the balancer, and then on to the server and the cache and the database where it finally rests.'
    expect(lint(long)).toContain('SAY-LONG')
    const out = absorbNarration(long, R)
    expect(lint(out.say)).toEqual([])
    expect(out.say.split('. ').length).toBe(2)
  })
  test('every bad sentence of a batch comes out clean', () => {
    for (const bad of ['[a](a) [b](b) [c](c) [d](d) [e](e) all at once.', 'x = y + z, i.e. 5 rpm -> 10 rpm', '[One](a), [two](b), [three](c), [four](d), [five](e) and [six](f).', 'The [in](a) = the [out](b) & 100% of [it](c) -> [done](d).'])
      expect(lint(absorbNarration(bad, R).say)).toEqual([])
  })
})

describe('the story absorbs instead of reporting', () => {
  test('a crowded, symbol-laden sentence compiles without a diagnostic and the account says what was adjusted', () => {
    const m = compile(explain({ stage: { row: cells([1, 2, 3, 4], { pointers: ['lo', 'hi'] }) }, story: [{ say: 'Four values: [one](row.0), [two](row.1), [three](row.2), [four](row.3) = 100%.', row: { lo: 0, hi: 3 } }] }) as never)
    expect(m.diagnostics.list.map((d) => `${d.code}: ${d.what}`)).toEqual([])
    const text = describeAccount(quickAccount(m)!)
    expect(text).toContain('says: Four values: one, two, three, four equals 100 percent.')
    expect(text).toContain('adjusted: symbols and abbreviations are spoken as words')
    expect(text).toContain('more than 3 links in one sentence')
    expect(m.steps[0]!.narration[0]!.spans.length).toBe(3)
  })
  test('a link is resolved after the step changed its block, so a step can point at what it has just placed', () => {
    const m = compile(explain({ stage: { row: cells([1, 2, 3], { pointers: ['mid'] }) }, story: [{ say: 'Look at the [middle](row.mid).', row: { mid: 1 } }] }) as never)
    expect(m.diagnostics.list).toEqual([])
    expect(quickAccount(m)!.steps[0]!.points).toEqual([{ words: 'middle', target: 'row.mid' }])
  })
  test('a narrated crash is made true: the fault lands when the node holds a job; a node idle all step long goes down idle and describe says so', () => {
    const story = (crash: string) => [{ say: 'Jobs run.', system: { until: 4 } }, { say: 'A worker crashes.', system: { crash, until: 12 } }]
    const system = () => flowBlock('producer -> queue[6] -> worker*3 -> database; worker -fail-> retry -> queue', { jobs: { count: 12, every: 1.5, service: [0.5, 0.7], seed: 3 } })
    for (const node of ['worker1', 'worker2', 'worker3']) {
      const m = compile(explain({ stage: { system: system() }, story: story(node) }) as never)
      expect(m.diagnostics.list.map((d) => d.what)).toEqual([])
      const line = last.handles.system!.describe(last.states.system)
      // either a job of its own failed, or the account says the node was idle: never a silent mismatch
      expect(/[1-9]\d* job\(s\) failed at least once/.test(line) || line.includes(`${node} (was idle when it went down`)).toBe(true)
    }
  })
})
