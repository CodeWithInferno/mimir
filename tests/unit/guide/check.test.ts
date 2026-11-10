// The guide's check rules without a browser: what can be known from the recorded story alone.
import { describe, expect, test } from 'bun:test'
import { rect } from '../../../src/r2d/index.ts'
import { fadeIn } from '../../../src/anim/index.ts'
import '../../../src/guide/index.ts'
import '../../../src/check/check.ts'
import '../../../src/guide/check.ts'
import { runCheck } from '../../../src/check/engine.ts'
import { allRules, compile, ownerOf, scene } from '../../../src/core/index.ts'

const check = async (fn: (s: any) => void) => runCheck(null, {}, compile(scene({ title: 'guide check' }, fn)))
const of = (out: { code: string }[], code: string) => out.filter((d) => d.code === code) as any[]

describe('guide rules', () => {
  test('the rules are registered, and GUIDE-TARGET replaces the seed rule on purpose', () => {
    const codes = allRules().map((r) => r.code)
    for (const c of ['GUIDE-TARGET', 'SAY-LONG', 'GUIDE-CROWDED', 'GUIDE-DEAD-AIR', 'GUIDE-LATE', 'SAY-SYMBOL', 'GUIDE-REPEAT', 'NO-VISUAL-BEAT', 'TEXT-LONG']) expect(codes).toContain(c)
    expect(ownerOf('rule', 'GUIDE-TARGET')).toBe('guide/check.ts')
  })
  test('GUIDE-TARGET: an unknown part with a did-you-mean; a part that is hidden when its mark lands', async () => {
    const out = await check((s) => {
      rect({ id: 'piston' })
      const late = rect({ id: 'valve' }).at(3, 0)
      s.step('one', (st: any) => { st.say('The [piston](pistn) moves, and the [valve](ring:valve) opens.'); st.wait(6); st.play(fadeIn(late)) })
      s.step('two', (st: any) => { st.say('Now the [valve](ring:valve) is there.') })
    })
    const found = of(out, 'GUIDE-TARGET')
    expect(found.map((d) => [d.severity, d.step, d.ids])).toEqual([['error', 1, ['pistn']], ['error', 1, ['valve']]])
    expect(found[0].fix[0]).toContain('piston')
    expect(found[1].what).toContain('is not shown then')
    expect(found[1].fix[0]).toContain('fadeIn(valve)')
    expect(typeof found[1].t).toBe('number')
    expect(found.every((d) => typeof d.line === 'number')).toBe(true)
  })
  test('narration lint: a long sentence, too many marks, a late pointer, dead air, a symbol, a repeat', async () => {
    const out = await check((s) => {
      s.guide({ maximumSentenceWords: 14, maximumMarksPerSentence: 2, maximumDeadAir: 3 }) // stricter than the defaults (25 words, 3 marks, 10 s)
      rect({ id: 'a' }); rect({ id: 'b' }); rect({ id: 'c' })
      s.step('long', (st: any) => { st.say('This single sentence about the [part](a) simply goes on and on and on for far too many words to follow by ear.') })
      s.step('crowded', (st: any) => { st.say('The [first](a) part, the [second](ring:b) part and the [third](label:c) part are all here.') })
      s.step('late', (st: any) => { st.say('[One](a) [two](b) done.') })
      s.step('quiet', (st: any) => { st.say('Nothing at all is pointed at while these words are slowly spoken aloud.') })
      s.step('symbols', (st: any) => { st.say('The [part](a) is 50% done & the [part](a) waits.') })
    })
    expect(of(out, 'SAY-LONG').map((d) => [d.step, d.measured, d.limit, d.severity])).toEqual([[1, 22, 14, 'warn']])
    expect(of(out, 'GUIDE-CROWDED').map((d) => [d.step, d.measured, d.limit])).toEqual([[2, 3, 2]])
    const late = of(out, 'GUIDE-LATE')
    expect(late.map((d) => d.step)).toEqual([3])
    expect(late[0].measured).toBeGreaterThan(0.25)
    expect(late[0].fix.length).toBeGreaterThan(0)
    expect(of(out, 'GUIDE-DEAD-AIR').map((d) => d.step)).toContain(4)
    expect(of(out, 'SAY-SYMBOL').map((d) => d.step)).toEqual([5, 5])
    expect(of(out, 'GUIDE-REPEAT').map((d) => d.step)).toEqual([5])
    expect(out.filter((d) => d.code.startsWith('SAY-') || d.code.startsWith('GUIDE-')).every((d: any) => d.fix.length > 0 && typeof d.line === 'number')).toBe(true)
  })
  test('a clean guided step reports nothing; dead air is not reported while something else happens on screen', async () => {
    const out = await check((s) => {
      const a = rect({ id: 'a' }); rect({ id: 'b' }).at(3, 0)
      s.step('one', (st: any) => { st.say('The [first](a) part sits beside the [second](ring:b).') })
      s.step('two', (st: any) => { st.say('For a good long while the first part slowly slides over to the right.'); st.play(a.to.shift(1, 0), { duration: 4 }) })
    })
    expect(out.filter((d) => /^(GUIDE|SAY|NO-VISUAL|TEXT-LONG)/.test(d.code))).toEqual([])
  })
  test('NO-VISUAL-BEAT: a step that only talks; TEXT-LONG (owned by src/check) reads the labels this module records', async () => {
    const out = await check((s) => {
      const a = rect({ id: 'a' })
      s.step('first', (st: any) => { st.say('Here is a part.') }) // the stage itself appears: that is the visual beat of a first step
      s.step('talk', (st: any) => { st.say('Engines are interesting.') })
      s.step('show', (st: any) => { st.say('This one moves.'); st.play(a.to.shift(1, 0)) })
      s.step('labels', (st: any) => { st.label(a, 'this label is far too long'); st.say('And [a name that is a whole sentence](label:a) too.'); st.label(a, 'short name') })
    })
    expect(of(out, 'NO-VISUAL-BEAT').map((d) => [d.step, d.measured, d.severity])).toEqual([[2, 3, 'warn']])
    const long = of(out, 'TEXT-LONG')
    expect(long.map((d) => [d.step, d.measured, d.limit, d.ids])).toEqual([[4, 6, 4, ['a']], [4, 7, 4, ['a']]])
    expect(long[0].fix[0]).toContain("st.label(a, 'this label')")
    expect(long[1].fix[0]).toContain('(label:a)')
  })
  test('the limits come from s.guide(); those of labels from s.check()', async () => {
    const out = await check((s) => {
      s.guide({ maximumSentenceWords: 30 })
      s.check({ limits: { labelWords: 8 } })
      const a = rect({ id: 'a' })
      s.step('x', (st: any) => { st.say('This single sentence about the [part](a) simply goes on and on and on for far too many words to follow by ear.'); st.label(a, 'this label is far too long') })
    })
    expect(of(out, 'SAY-LONG')).toEqual([])
    expect(of(out, 'TEXT-LONG')).toEqual([])
  })
})
