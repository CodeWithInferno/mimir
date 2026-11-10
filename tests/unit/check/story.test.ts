// What the author declares (s.expect, expect.*, part.allow, s.check) and the story rules, without a browser.
import { describe, expect, test } from 'bun:test'
import { box, cylinder } from '../../../src/r3d/index.ts'
import { rect, text, row } from '../../../src/r2d/index.ts'
import { fadeIn, fadeOut } from '../../../src/anim/index.ts'
import { expect as claim } from '../../../src/check/index.ts'
import { LIMITS } from '../../../src/check/limits.ts'
import { build, check } from './helpers.ts'

describe('EXPECT-FAILED', () => {
  const engine = (camRatio: number, valveY: number, rod: (crank: number) => number) => (s: any) => {
    const crank = s.param('crank', { value: 0, min: 0, max: 720, unit: '°' })
    const lift = () => 0.4 + crank() / 360
    const floor = box({ id: 'floor', width: 5, height: 0.2, depth: 2 }).at(0, -0.1, 0)
    const piston = box({ id: 'piston', width: 1.6, height: 1, depth: 1.6 }).at(() => [0, 0.5 + lift() * 0.4, 0])
    const valve = box({ id: 'valve', width: 0.5, height: 0.3, depth: 0.5 }).nextTo(floor, 'up', valveY).shift(2, 0, 0)
    s.probe('crankAngle', () => crank())
    s.probe('camAngle', () => crank() * camRatio)
    s.probe('rodLength', () => rod(crank()))
    claim.above(valve, piston)
    claim.ratio('camAngle', 'crankAngle', 0.5)
    claim.conserved('rodLength')
    s.step('Rest', (st: any) => { st.wait(1) })
    s.step('Rise', (st: any) => { st.set(crank, 360) })
  }
  test('a relation that breaks: the measured values of both objects, the difference, where it starts, how often, where it is worst', async () => {
    const r = await check(engine(0.5, 1.3, () => 3), ['EXPECT-FAILED'])
    expect(r.codes).toEqual(['EXPECT-FAILED error'])
    const d = r.diags[0]!
    expect(d).toMatchObject({ ids: ['valve', 'piston'], step: 2, measured: 1.3 })
    expect(d.what).toMatch(/^expect\.above\(valve, piston\) is false \d+% of the way through step 2 \(t = [\d.]+ s\): the lowest point of #valve \(y = 1\.3\) is [\d.]+ below the top of #piston \(y = [\d.]+\)\. It fails in \d+ of the \d+ states it was checked in\. Worst when crank = 720 \(its maximum\)/)
    expect(d.fix[0]).toBe("put it on top by a relation: valve.nextTo(piston, 'up', 0)")
    expect(typeof d.line).toBe('number')
  })
  test('a cam that turns at crank speed: geometry cannot see it, expect.ratio does (a four-stroke cam must turn at half the crank speed)', async () => {
    const r = await check(engine(1, 3, () => 3), ['EXPECT-FAILED'])
    expect(r.codes).toEqual(['EXPECT-FAILED error'])
    expect(r.diags[0]!.what).toMatch(/expect\.ratio\('camAngle', 'crankAngle', 0\.5\) is false .*a ratio of 1, expected 0\.5/)
    expect(r.diags[0]!.measured).toBe(1)
    expect(r.diags[0]!.limit).toBe(0.5)
  })
  test('a probe that should not change: the two extremes and where they are', async () => {
    const r = await check(engine(0.5, 3, (c) => 3 + c / 720), ['EXPECT-FAILED'])
    expect(r.codes).toEqual(['EXPECT-FAILED error'])
    expect(r.diags[0]!.what).toMatch(/expect\.conserved\('rodLength'\) is false: "rodLength" goes from 3 at the end of step 1 to 4 when crank = 720 \(its maximum\), a change of 25% \(limit 1%\)/)
  })
  test('claims that hold are silent; a claim scoped to a step is only checked there', async () => {
    expect((await check(engine(0.5, 3, () => 3), ['EXPECT-FAILED'])).codes).toEqual([])
    const scoped = await check((s) => {
      const p = s.param('p', { value: 0, min: 0, max: 1 })
      rect({ id: 'a' }).at(() => [p() * 3, 0])
      claim.during('Still', () => p() === 0)
      claim.during(2, () => p() > 0)
      s.step('Still', (st: any) => { st.wait(1) })
      s.step('Moves', (st: any) => { st.set(p, 1, { duration: 1 }); st.wait(1) })
    }, ['EXPECT-FAILED'])
    expect(scoped.diags.map((d) => [d.code, d.step])).toEqual([['EXPECT-FAILED', 2]]) // p is still 0 at the first sampled moment of step 2
    expect(scoped.diags[0]!.what).toContain('during step 2')
  })
  test('s.expect: a named condition; the message carries the probes of the moment it fails', async () => {
    const r = await check((s) => {
      const p = s.param('load', { value: 0, min: 0, max: 100 })
      rect({ id: 'bar', width: () => 0.1 + p() / 20 })
      s.probe('load', () => p())
      s.expect('the queue never overflows', () => p() <= 80)
      s.step('Fill', (st: any) => { st.set(p, 60) })
    }, ['EXPECT-FAILED'])
    expect(r.codes).toEqual(['EXPECT-FAILED error'])
    expect(r.diags[0]!.what).toBe('"the queue never overflows" is false when load = 100 (its maximum): the probes there: load = 100. It fails in 1 of the 55 states it was checked in.')
    expect(r.diags[0]!.params).toEqual({ load: 100 })
  })
  test('bad input never throws: a missing probe, a step that does not exist, a function that returns nothing, an unknown member', async () => {
    const m = build((s) => {
      const a = rect({ id: 'a' })
      claim.conserved('nope')
      claim.ratio('x', 3 as any, 'half' as any)
      claim.above(a, 'ghost')
      claim.above(a, a)
      ;(claim as any).below(a, a)
      s.expect('no function' as any)
      s.step('One', (st: any) => { st.play(a.to.shift(1, 0)) })
    })
    expect(m.diagnostics.list.map((d) => d.code).sort()).toEqual(['API-TYPE', 'API-TYPE', 'API-TYPE', 'API-UNKNOWN', 'REF-MISSING', 'REF-MISSING'])
    expect(m.diagnostics.list.find((d) => d.code === 'API-UNKNOWN')!.fix[0]).toContain('above')
    const r = await check((s) => {
      const a = rect({ id: 'a' })
      claim.during('Nowhere', () => true)
      s.expect('returns nothing', (() => {}) as any)
      s.step('One', (st: any) => { st.play(a.to.shift(1, 0)) })
    }, ['EXPECT-FAILED'])
    expect(r.diags.map((d) => d.what)).toEqual([
      "expect.during('Nowhere', …): there is no such step (the scene has 1).",
      'the function of "returns nothing" returned nothing: an expectation answers true or false.',
    ])
  })
  test('a claim about two objects that are never on stage together is unknown, not passed', async () => {
    const r = await check((s) => {
      const a = rect({ id: 'a' }), b = rect({ id: 'b' }).at(3, 0)
      claim.touching(a, b)
      s.step('One', (st: any) => { st.play(fadeOut(a)) })
      s.step('Two', (st: any) => { st.play(fadeIn(b)) })
    }, ['EXPECT-FAILED'])
    expect(r.codes).toEqual([])
    expect(r.stats.unknown['EXPECT-FAILED']![0]!.why).toBe('expect.touching(a, b) was never evaluated: #a and #b are never on stage together')
  })
  test('inside and touching in 2D and 3D give the excess and the gap', async () => {
    const r = await check((s) => {
      const tray = rect({ id: 'tray', width: 4, height: 2 })
      const coin = rect({ id: 'coin', width: 1, height: 1 }).at(1.8, 0)
      const plate = box({ id: 'plate', width: 4, height: 0.2, depth: 4 })
      const cup = cylinder({ id: 'cup', radius: 0.5, height: 1 }).at(0, 0.85, 0)
      claim.inside(coin, tray)
      claim.touching(cup, plate)
      s.viewport('right', 0.5)
      s.step('One', (st: any) => { st.wait(1) })
    }, ['EXPECT-FAILED'])
    expect(r.diags.map((d) => [d.ids, d.measured])).toEqual([[['coin', 'tray'], 0.3], [['cup', 'plate'], 0.25]])
    expect(r.diags[0]!.what).toContain('#coin reaches 0.3 units outside #tray (along x)')
    expect(r.diags[1]!.what).toContain('there is a gap of 0.25 units between #cup and #plate (along -Y)')
    expect(r.diags[1]!.fix[0]).toBe("close it with a relation: cup.nextTo(plate, 'up', 0)")
  })
})

describe('PLACE-NONE', () => {
  test('objects that were never placed and pile up at the origin, per kind of thing; the fix is a relation', async () => {
    const r = await check((s) => {
      s.viewport('right', 0.5)
      cylinder({ id: 'spring', radius: 0.5, height: 2 })
      box({ id: 'retainer', width: 1.4, height: 0.4, depth: 1.4 })
      rect({ id: 'a' }); rect({ id: 'b' }); rect({ id: 'c', width: 2.2 })
      s.step('One', (st: any) => { st.wait(1) })
    })
    expect(r.codes).toEqual(['PLACE-NONE error', 'PLACE-NONE error']) // not also INTERPENETRATE: the cause is reported, not its effects
    expect(r.diags.map((d) => d.ids)).toEqual([['spring', 'retainer'], ['a', 'b', 'c']])
    expect(r.diags[0]!.fix[0]).toBe("place each on the one it belongs to: retainer.attach(spring, { my: 'bottom', to: 'top' })")
    expect(r.diags[1]!.fix).toEqual(["place each relative to another: b.nextTo(a, 'right')", 'or lay them out together: row([a, b, c])'])
  })
  test('one object at the origin, a caption on a box, a small shape in a large one, things in a row: clean', async () => {
    const r = await check((s) => {
      rect({ id: 'frame', width: 4, height: 2 })
      text('frame', { id: 'name' })
      rect({ id: 'dot', width: 0.3, height: 0.3 })
      row([rect({ id: 'x' }), rect({ id: 'y' })]).at(0, -2.5)
      s.step('One', (st: any) => { st.wait(1) })
    }, ['PLACE-NONE'])
    expect(r.codes).toEqual([])
  })
})

describe('TEXT-LONG, CHAPTER-LONG, COLOR-COUNT, HATCH-USE', () => {
  test('a label that is a sentence and a caption that is a paragraph; the limits are in the message', async () => {
    const r = await check((s) => {
      const q = rect({ id: 'queue' })
      s.step('One', (st: any) => {
        st.say('x'.repeat(100) + '. ' + 'y'.repeat(100) + '.')
        st.label(q, 'the queue where requests wait for a free worker')
        st.label(q, 'waiting requests')
        st.play(q.to.shift(1, 0))
      })
    }, ['TEXT-LONG'])
    expect(r.codes).toEqual(['TEXT-LONG warn', 'TEXT-LONG warn'])
    expect(r.diags.map((d) => [d.measured, d.limit])).toEqual([[203, LIMITS.captionChars], [9, LIMITS.labelWords]])
    expect(r.diags[1]!.fix[0]).toContain("st.label(queue, 'the queue')")
  })
  test('a chapter over the limit names the step to split at; a story without chapters is held to the same length', async () => {
    const r = await check((s) => {
      const a = rect({ id: 'a' })
      s.chapter('Everything at once')
      s.step('First half', (st: any) => { st.say('On.'); st.play(a.to.shift(1, 0)); st.wait(50) })
      s.step('Second half', (st: any) => { st.say('And on.'); st.play(a.to.shift(-1, 0)); st.wait(50) })
    }, ['CHAPTER-LONG'])
    expect(r.codes).toEqual(['CHAPTER-LONG warn'])
    expect(r.diags[0]!).toMatchObject({ measured: 104, limit: 90 })
    expect(r.diags[0]!.fix[0]).toBe("start a new chapter before step 2: s.chapter('…') above s.step('Second half', …)")
    const none = await check((s) => { const a = rect({ id: 'a' }); s.step('Long', (st: any) => { st.say('On.'); st.play(a.to.shift(1, 0)); st.wait(100) }) }, ['CHAPTER-LONG'])
    expect(none.diags[0]!.what).toMatch(/^the story runs 10\d s without a chapter/)
  })
  test('s.check({ limits, off }) changes a threshold or switches a rule off; a wrong name is reported with the right one', async () => {
    const story = (opts: unknown) => (s: any) => { const a = rect({ id: 'a' }); s.check(opts); s.step('Long', (st: any) => { st.say('On.'); st.play(a.to.shift(1, 0)); st.wait(100) }) }
    expect((await check(story({ limits: { chapterSeconds: 120 } }))).codes).toEqual([])
    expect((await check(story({ off: ['CHAPTER-LONG'] }))).codes).toEqual([])
    const bad = await check(story({ limits: { chapterSecs: 120 }, of: [], off: ['CHAPTER'] }))
    expect(bad.codes).toEqual(['API-UNKNOWN error', 'API-UNKNOWN error', 'API-UNKNOWN error', 'CHAPTER-LONG warn'])
    expect(bad.of('API-UNKNOWN').map((d) => d.fix[0])).toEqual(['use "chapterSeconds"', 'use "off"', 'use "CHAPTER-LONG"'])
  })
  test('part.allow() with a code that is no rule is reported', async () => {
    const r = await check((s) => { const a = rect({ id: 'a' }).allow('FLOTING'); a.allow(); s.step('One', (st: any) => { st.play(a.to.shift(1, 0)) }) })
    expect(r.codes).toEqual(['API-UNKNOWN error', 'API-TYPE error'])
    expect(r.of('API-UNKNOWN')[0]!.fix[0]).toBe("use 'FLOATING'")
  })
  test('more hues than a viewer tracks; neighbours on the colour wheel and greys do not count', async () => {
    const boxes = (colours: string[]) => (s: any) => { row(colours.map((c, i) => rect({ id: `box${i + 1}`, color: c }))); s.step('One', (st: any) => { st.wait(1) }) }
    const r = await check(boxes(['#FC6255', '#58C4DD', '#83C167', '#FFFF00', '#9A72AC']), ['COLOR-COUNT'])
    expect(r.codes).toEqual(['COLOR-COUNT warn'])
    expect(r.diags[0]!).toMatchObject({ measured: 5, limit: 3 })
    expect(r.diags[0]!.what).toContain('purple (#box5), red (#box1), yellow (#box4), green (#box3), blue (#box2)')
    expect((await check(boxes(['#58C4DD', '#5CD0B3', '#BBBBBB', '#FFFF00', '#888888']), ['COLOR-COUNT'])).codes).toEqual([])
  })
  test('HATCH-USE speaks only when typed-in coordinates are behind a finding about solids', async () => {
    const r = await check((s) => {
      box({ id: 'base', width: 3, height: 0.4, depth: 3 }).at(0, 0.2, 0)
      box({ id: 'post', width: 0.5, height: 2, depth: 0.5 }).at(0, 1.4, 0)
      box({ id: 'cap', width: 1.2, height: 0.3, depth: 1.2 }).at(0, 2.85, 0)
      s.step('One', (st: any) => { st.wait(1) })
    })
    expect(r.codes).toEqual(['FLOATING error', 'HATCH-USE info'])
    expect(r.of('HATCH-USE')[0]!.what).toBe('3 of 3 placed objects use literal coordinates (.at(x, y, z)); 1 of them is behind FLOATING: #cap.')
    const clean = await check((s) => { rect({ id: 'a' }).at(1, 1); rect({ id: 'b' }).at(-2, 1); s.step('One', (st: any) => { st.wait(1) }) })
    expect(clean.codes).toEqual([])
  })
})
