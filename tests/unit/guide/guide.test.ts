// The guide's pure side: st.say compiles narration into cues, labels, clips and the transcript, as functions of step time.
import { describe, expect, test } from 'bun:test'
import { circle, rect } from '../../../src/r2d/index.ts'
import { box } from '../../../src/r3d/index.ts'
import '../../../src/anim/index.ts'
import {
  GUIDE_DEFAULTS, guideConfig, guideStore, lightAt, lightDim, labelText, LEGIBLE_LUMINANCE, markColor, partColor, pulseRate, readSpans, resolveTarget, speechSeconds, stripSpans,
} from '../../../src/guide/index.ts'
import { allManifests, compile, luminance, ownerOf, scene, spanVerbs, type SceneModel } from '../../../src/core/index.ts'
import { parseNarration } from '../../../src/lib/guide/index.ts'

const build = (fn: (s: any) => void): SceneModel => compile(scene({ title: 'guide' }, fn))
const codes = (m: SceneModel): string[] => m.diagnostics.list.map((d) => d.code)
const manifest = (m: SceneModel): any => allManifests().find(([key]) => key === 'guide')![1](m, null)
const cuesOf = (m: SceneModel, step = 0) => guideStore(m).steps.get(step)!.cues

describe('st.say compiles narration into cues', () => {
  test('every verb becomes a cue on its part; flights are back-timed to land as the words start', () => {
    const m = build((s) => {
      rect({ id: 'a' }); rect({ id: 'b' }).at(3, 0); box({ id: 'c' })
      s.step('one', (st: any) => {
        st.say('Here is the [first](a), then a [ring](ring:a+b) and a [name](label:b).')
        st.say('An [arrow](arrow:a->b) goes across, the [solid](glow:c) lights, and [this](focus:a) stays.')
      })
    })
    expect(codes(m)).toEqual([])
    const cues = cuesOf(m)
    expect(cues.map((q) => q.verb)).toEqual(['point', 'ring', 'label', 'arrow', 'glow', 'focus'])
    expect(cues.map((q) => q.nodes.map((n) => n.id))).toEqual([['a'], ['a', 'b'], ['b'], ['a', 'b'], ['c'], ['a']])
    expect(cues.map((q) => q.pointer)).toEqual([true, true, true, true, false, false])
    const hop = GUIDE_DEFAULTS.hop
    for (const q of cues.filter((x) => x.pointer)) {
      expect(q.landAt - q.fireAt).toBeCloseTo(hop, 9) // one fixed hop
      expect(q.landAt).toBeGreaterThanOrEqual(q.wordAt - 1e-9) // never early …
      expect(q.late).toBe(false) // … and here never late
    }
    expect(cues[0]!.landAt).toBeCloseTo(cues[0]!.wordAt, 9) // the lead-in leaves room for the first flight
    // the pointer never leaves a perch early, and an arrow keeps it until the stroke is drawn
    const flights = cues.filter((x) => x.pointer)
    for (let i = 1; i < flights.length; i++) expect(flights[i]!.fireAt).toBeGreaterThanOrEqual(flights[i - 1]!.landAt + GUIDE_DEFAULTS.perch - 1e-9)
    // lifetimes: marks of the step stay, a glow expires, a point's mark ends when the pointer leaves
    expect(cues.filter((q) => ['ring', 'label', 'arrow'].includes(q.verb)).every((q) => q.markEnd === Infinity)).toBe(true)
    expect(cues[4]!.markEnd).toBeGreaterThanOrEqual(cues[4]!.landAt + GUIDE_DEFAULTS.glowTime - 1e-9)
    expect(Number.isFinite(cues[4]!.markEnd)).toBe(true)
    expect(cues[0]!.markEnd).toBeCloseTo(cues[1]!.fireAt, 9)
    // the step lasts as long as it speaks, plus the hold
    const rec = m.steps[0]!
    const said = guideStore(m).steps.get(0)!.says
    expect(rec.active).toBeGreaterThanOrEqual(said[1]!.at + said[1]!.timing.duration - 1e-9)
    expect(said[1]!.at).toBeCloseTo(said[0]!.at + said[0]!.timing.duration, 9) // sentences follow each other
  })

  test('a flight may start during the sentence before: an early word of the next sentence is not late', () => {
    const m = build((s) => {
      rect({ id: 'a' }); rect({ id: 'b' })
      s.step('one', (st: any) => { st.say('Some words about the [first](a) come here.'); st.say('The [second](label:b) follows at once.') })
    })
    const [first, second] = cuesOf(m)
    const at = guideStore(m).steps.get(0)!.says[1]!.at
    expect(second!.fireAt).toBeLessThan(at) // took off before its own sentence began
    expect(second!.landAt).toBeCloseTo(second!.wordAt, 9)
    expect(second!.fireAt).toBeGreaterThanOrEqual(first!.landAt + GUIDE_DEFAULTS.perch - 1e-9)
    // … and when two parts are named back to back the second one is late, and says so
    const tight = build((s) => { rect({ id: 'a' }); rect({ id: 'b' }); s.step('x', (st: any) => { st.say('[One](a) [two](b) done.') }) })
    const q = cuesOf(tight)[1]!
    expect(q.lateBy).toBeGreaterThan(GUIDE_DEFAULTS.maximumLate)
    expect(q.late).toBe(true)
  })

  test('targets: an id, id.anchor, a dotted id; the transcript names objects', () => {
    const m = build((s) => {
      const a = rect({ id: 'a' })
      a.define?.('tip', [1, 0, 0])
      rect({ id: 'a.b' })
      s.step('one', (st: any) => { st.say('The [top](a.top) and the [part](a.b).') })
    })
    expect(codes(m)).toEqual([])
    expect(resolveTarget(m, 'a.top')).toMatchObject({ anchor: 'top' })
    expect(resolveTarget(m, 'a.b')!.node.id).toBe('a.b') // an id wins over an anchor reading
    expect(resolveTarget(m, 'zzz')).toBeNull()
    const cues = cuesOf(m)
    expect(cues.map((q) => [q.nodes[0]!.id, q.anchors[0]])).toEqual([['a', 'top'], ['a.b', null]])
    const n = m.steps[0]!.narration[0]!
    expect(n.plain).toBe('The top and the part.')
    expect(n.spans.map((sp) => [sp.words, sp.verb, sp.targets, n.plain.slice(sp.start, sp.end)])).toEqual([['top', 'point', ['a'], 'top'], ['part', 'point', ['a.b'], 'part']])
    expect(n.duration).toBeGreaterThan(0)
    expect(() => JSON.stringify(m.steps[0]!.narration)).not.toThrow()
  })

  test('info().guide carries every cue and word with story times, and is the same every time', () => {
    const make = () => build((s) => {
      rect({ id: 'a' }); rect({ id: 'b' })
      s.step('one', (st: any) => { st.wait(1) })
      s.step('two', (st: any) => { st.say('Look at [this](ring:a), then at [that](label:b,hold).') })
    })
    const m = make(), g = manifest(m)
    expect(JSON.stringify(g)).toBe(JSON.stringify(manifest(make())))
    expect(() => JSON.parse(JSON.stringify(g))).not.toThrow()
    expect(g.steps).toHaveLength(1)
    const step = g.steps[0]
    expect(step.step).toBe(2)
    const t0 = m.steps[1]!.t0
    expect(step.cues.map((q: any) => [q.verb, q.targets, q.hold])).toEqual([['ring', ['a'], false], ['label', ['b'], true]])
    for (const q of step.cues) { expect(q.land).toBeGreaterThan(t0); expect(q.fire).toBeLessThan(q.land); expect(q.land).toBeLessThan(m.steps[1]!.t1) }
    expect(step.lines[0].text).toBe('Look at this, then at that.')
    expect(step.lines[0].words.map((w: any) => w.text)).toEqual(['Look', 'at', 'this,', 'then', 'at', 'that.'])
    expect(step.lines[0].words.map((w: any) => w.cue)).toEqual([-1, -1, 0, -1, -1, 1])
    const starts = step.lines[0].words.map((w: any) => w.t0)
    expect([...starts].sort((x: number, y: number) => x - y)).toEqual(starts)
  })

  test('a label span makes a label action with the spoken words; hold keeps it after the step', () => {
    const m = build((s) => {
      rect({ id: 'a' }); rect({ id: 'b' })
      s.step('one', (st: any) => { st.say('The [intake valve,](label:a) and the [other](label:b,hold).'); st.label('b', 'second name') })
      s.step('two', (st: any) => { st.wait(2) })
    })
    const labels = m.actions.filter((x) => x.type === 'label')
    expect(labels.map((x) => [x.data.node.id, x.data.text, x.scope])).toEqual(expect.arrayContaining([['b', 'second name', 'step'], ['a', 'intake valve', 'step'], ['b', 'other', 'persist']]))
    const late = m.state(m.steps[1]!.t0 + 1.5).actions('label').map((x) => x.data.text)
    expect(late).toEqual(['other']) // the held one is still there in the next step, the others have cleared
  })

  test('glow lights a 3D part and expires; focus dims the rest and lets go', () => {
    const m = build((s) => {
      box({ id: 'c' }); const other = box({ id: 'd' }).at(3, 0, 0)
      s.step('one', (st: any) => { st.say('First the [part](glow:c) lights up for a moment, and then we wait a good while longer.'); st.say('Now [only this](focus:c) matters, and then [that](focus:d).') })
    })
    expect(codes(m)).toEqual([])
    const c = m.byId.get('c')!, d = m.byId.get('d')!
    const [glow, f1, f2] = cuesOf(m)
    const at = (u: number) => m.state(m.steps[0]!.t0 + u)
    const rest = at(0).look(c).emissive
    expect(at(glow!.landAt + GUIDE_DEFAULTS.drawTime + 0.1).look(c).emissive).toBeCloseTo(Math.max(rest, GUIDE_DEFAULTS.glowEmissive), 6)
    expect(at(glow!.markEnd + 0.01).look(c).emissive).toBeCloseTo(rest, 6) // expired by itself
    expect(at(glow!.landAt + 0.6).look(d).emissive).toBeCloseTo(at(0).look(d).emissive, 6) // only the part named
    const mid = (f1!.landAt + f2!.landAt) / 2
    expect(at(mid).dim(d)).toBeGreaterThan(0.9)
    expect(at(mid).dim(c)).toBe(0)
    expect(f1!.markEnd).toBeCloseTo(f2!.landAt, 9) // a focus lasts until the next one
    expect(at(f2!.landAt + 0.5).dim(c)).toBeGreaterThan(0.9)
    expect(at(f2!.landAt + 0.5).dim(d)).toBeLessThan(0.05)
  })
})

describe('the light: lit and dim are separate channels', () => {
  const three = (story: (s: any) => void) => build((s) => { box({ id: 'a' }); box({ id: 'b' }).at(3, 0, 0); box({ id: 'c' }).at(6, 0, 0); rect({ id: 'flat' }); story(s) })
  test('the pointer lights the part it names; when it moves on only the lit part changes, the dim of everything else does not move', () => {
    const m = three((s) => { s.step('one', (st: any) => { st.say('First [this part](a) is named, then after a good long while [that part](b) is named too.'); st.wait(14) }) })
    expect(codes(m)).toEqual([])
    const [p1, p2] = cuesOf(m)
    const a = m.byId.get('a')!, b = m.byId.get('b')!, c = m.byId.get('c')!, flat = m.byId.get('flat')!
    const at = (u: number) => m.state(m.steps[0]!.t0 + u)
    // before the first landing nothing is dim; after it everything but the named part is
    expect(at(p1!.landAt - GUIDE_DEFAULTS.highlightBefore - 0.01).dim(c)).toBe(0)
    expect(at(p1!.landAt + GUIDE_DEFAULTS.highlightAfter + 0.01).dim(c)).toBeCloseTo(GUIDE_DEFAULTS.highlightDim, 9)
    expect(at(p1!.landAt + GUIDE_DEFAULTS.highlightAfter + 0.01).dim(a)).toBe(0)
    // across the hop: the bystander holds exactly (one channel would dip here), a falls as b rises
    const hop: number[] = [], seen: number[] = []
    for (let u = p2!.landAt - GUIDE_DEFAULTS.handBefore - 0.05; u <= p2!.landAt + GUIDE_DEFAULTS.handAfter + 0.05; u += 0.01) { hop.push(at(u).dim(c)); seen.push(at(u).dim(a) + at(u).dim(b)) }
    for (const v of hop) expect(v).toBeCloseTo(GUIDE_DEFAULTS.highlightDim, 9)
    for (const v of seen) expect(v).toBeCloseTo(GUIDE_DEFAULTS.highlightDim, 9) // what one loses the other gains: the light is handed over
    expect(at(p2!.landAt + 0.3).dim(a)).toBeCloseTo(GUIDE_DEFAULTS.highlightDim, 9)
    expect(at(p2!.landAt + 0.3).dim(b)).toBe(0)
    // a lit 3D part gets the focus highlight of the 3D look, by the same amount
    const mid = lightAt(m, m.steps[0]!.t0 + p2!.landAt - 0.03)
    expect(mid.lit.get(a)! + mid.lit.get(b)!).toBeCloseTo(1, 9)
    expect(mid.lit.get(a)!).toBeGreaterThan(0)
    expect(mid.lit.get(b)!).toBeGreaterThan(0)
    // the flat stage keeps its light by default
    expect(at(p2!.landAt + 0.3).dim(flat)).toBe(0)
    expect(lightDim(flat, at(p2!.landAt + 0.3))).toBe(0)
    // it holds after the last landing, then lets go
    expect(at(p2!.landAt + GUIDE_DEFAULTS.highlightHold - 0.1).dim(c)).toBeCloseTo(GUIDE_DEFAULTS.highlightDim, 9)
    expect(at(p2!.landAt + GUIDE_DEFAULTS.highlightHold + GUIDE_DEFAULTS.highlightOut + 0.01).dim(c)).toBe(0)
  })
  test('st.highlight({ lit, dim }) is the same thing by hand: a second call hands the light over under a dim that stays', () => {
    const m = three((s) => {
      s.step('one', (st: any) => { st.highlight({ lit: 'a', dim: 0.6 }); st.wait(2); st.highlight({ lit: { b: 0.5 }, dim: 0.6 }); st.wait(2); st.highlight(false); st.wait(1) })
      s.step('two', (st: any) => { st.wait(1) })
    })
    expect(codes(m)).toEqual([])
    const a = m.byId.get('a')!, b = m.byId.get('b')!, c = m.byId.get('c')!, flat = m.byId.get('flat')!
    const at = (u: number) => m.state(m.steps[0]!.t0 + u)
    expect(at(1).dim(c)).toBeCloseTo(0.6, 9)
    expect(at(1).dim(flat)).toBeCloseTo(0.6, 9) // what the scene declares itself dims the flat stage too
    expect(at(1).dim(a)).toBe(0)
    for (let u = 1.7; u <= 2.3; u += 0.02) expect(at(u).dim(c)).toBeCloseTo(0.6, 9)
    expect(at(3).dim(a)).toBeCloseTo(0.6, 9)
    expect(at(3).dim(b)).toBeCloseTo(0.3, 9) // half in the light
    expect(at(4 + GUIDE_DEFAULTS.highlightOut + 0.01).dim(c)).toBe(0) // st.highlight(false) ends it
    expect(m.state(m.steps[1]!.t0 + 0.5).dim(c)).toBe(0)
  })
  test('a step that declares st.focus keeps its focus: the pointer adds no light there; s.guide sets the amounts', () => {
    const focus = three((s) => { s.step('one', (st: any) => { st.focus('a', 'b'); st.say('Now [this](a) is pointed at for a while.') }) })
    const [p] = cuesOf(focus)
    const f = focus.state(focus.steps[0]!.t0 + p!.landAt + 1)
    expect(f.dim(focus.byId.get('b')!)).toBe(0) // focused, and not dimmed by the pointer naming a
    expect(f.dim(focus.byId.get('c')!)).toBe(1)
    const flatToo = build((s) => { s.guide({ highlightDim: 0.5, highlightDim2d: 0.4 }); box({ id: 'a' }); box({ id: 'c' }).at(3, 0, 0); rect({ id: 'flat' }); s.step('one', (st: any) => { st.say('Here [it](a) is, said slowly enough.') }) })
    const [q] = cuesOf(flatToo)
    const g = flatToo.state(flatToo.steps[0]!.t0 + q!.landAt + 1)
    expect(g.dim(flatToo.byId.get('c')!)).toBeCloseTo(0.5, 9)
    expect(g.dim(flatToo.byId.get('flat')!)).toBeCloseTo(0.4, 9)
  })
  test('bad input to st.highlight is reported and changes nothing', () => {
    const m = three((s) => { s.step('one', (st: any) => { st.highlight(7); st.highlight({ lit: 'a', dim: 'dark' }); st.highlight({ lit: 'nothere' }); st.highlight({ glow: 1 }); st.wait(1) }) })
    expect(codes(m)).toEqual(expect.arrayContaining(['API-TYPE', 'REF-MISSING', 'API-UNKNOWN']))
    expect(m.diagnostics.list.every((d) => d.fix.length > 0)).toBe(true)
  })
})

describe('bad input is reported, never thrown', () => {
  test('junk arguments', () => {
    const m = build((s) => {
      rect({ id: 'a' })
      s.step('x', (st: any) => { st.say(42); st.say(''); st.say('[](a)'); st.label(undefined); st.label('a', {}); st.focus(null); st.say('Fine [words](a).') })
      s.guide({ hop: -1, nonsense: true }); s.guide(7)
    })
    expect(codes(m).length).toBeGreaterThan(0)
    expect(m.diagnostics.list.every((d) => d.fix.length > 0)).toBe(true)
    expect(cuesOf(m).map((q) => q.words)).toEqual(['words']) // the good sentence still works
    expect(guideConfig(m).hop).toBe(GUIDE_DEFAULTS.hop) // a bad option changes nothing
  })
  test('an unknown verb is API-UNKNOWN with the verb list, an unclosed span API-TYPE, an unknown part GUIDE-TARGET; all at the st.say line', () => {
    const m = build((s) => {
      rect({ id: 'a' })
      s.step('x', (st: any) => { st.say('The [box](ring:nothere) and [other](bogusverb:a) and [unterminated](a and [](focus:zzz).') })
      s.step('y', (st: any) => { st.say('A [good](a) one, a [ring](ring:a) and a [pair](focus:a+a).') })
    })
    expect(m.diagnostics.list.map((d) => [d.code, d.step, d.ids])).toEqual([['API-UNKNOWN', 1, []], ['API-TYPE', 1, []], ['GUIDE-TARGET', 1, ['nothere']], ['GUIDE-TARGET', 1, ['zzz']]])
    const unknown = m.diagnostics.list.find((d) => d.code === 'API-UNKNOWN')!
    expect(unknown.what).toContain('bogusverb')
    expect(unknown.fix[0]).toContain('point, ring, label, arrow, glow, focus')
    expect(m.diagnostics.list.every((d) => typeof d.line === 'number' && d.fix.length > 0)).toBe(true)
    expect(spanVerbs()).toEqual(['point', 'ring', 'label', 'arrow', 'glow', 'focus'])
    expect(ownerOf('stepAction', 'say')).toBe('guide/index.ts')
    // a cue whose part does not exist moves nothing
    expect(cuesOf(m, 0).map((q) => [q.verb, q.nodes.length, q.pointer])).toEqual([['ring', 0, false], ['focus', 0, false]])
  })
  test('library: a "(" that is never closed does not swallow the span after it', () => {
    const p = parseNarration('The [box](ring:a) and [unterminated](a and [](focus:zzz).')
    expect(p.plain).toBe('The box and unterminated(a and .')
    expect(p.spans.map((sp) => [sp.words, sp.verb, sp.targets])).toEqual([['box', 'ring', ['a']], ['', 'focus', ['zzz']]])
    expect(p.errors.map((e) => e.code)).toEqual(['GUIDE-SYNTAX'])
    expect(readSpans('The [box](ring:a) and [x](a and [](focus:zzz).').spans).toHaveLength(2)
  })
})

describe('s.guide and the helpers', () => {
  test('s.guide changes the pace and the look for one scene only', () => {
    const run = (opts?: object) => build((s) => { if (opts) s.guide(opts); rect({ id: 'a' }); s.step('x', (st: any) => { st.say('Ten words are spoken here at whatever pace is set.') }) })
    const base = run(), fast = run({ charactersPerSecond: 33, leadIn: 0, numbered: true, labelColor: '#DDDDDD' })
    expect(codes(fast)).toEqual([])
    const d0 = guideStore(base).steps.get(0)!.says[0]!.timing, d1 = guideStore(fast).steps.get(0)!.says[0]!.timing
    expect(d1.duration).toBeLessThan(d0.duration * 0.6)
    expect(fast.steps[0]!.t1).toBeLessThan(base.steps[0]!.t1)
    expect(guideConfig(fast)).toMatchObject({ numbered: true, labelColor: '#DDDDDD', charactersPerSecond: 33 })
    expect(guideConfig(base)).toEqual({ ...GUIDE_DEFAULTS })
    const late = build((s) => { rect({ id: 'a' }); s.step('x', (st: any) => { st.say('Words.') }); s.guide({ hop: 1 }) })
    expect(codes(late)).toEqual(['API-TYPE']) // after narration was timed: said, not silently half-applied
  })
  test('stripSpans, speechSeconds, labelText, pulseRate', () => {
    expect(stripSpans('The [piston](piston) slides down and the [intake valve](ring:intakeValve) opens.')).toBe('The piston slides down and the intake valve opens.')
    expect(stripSpans('Look [](focus:x) here.')).toBe('Look here.')
    expect(speechSeconds('Hello.')).toBeCloseTo(6 / 16.5 + 0.36, 12)
    expect(speechSeconds('One, two.')).toBeGreaterThan(speechSeconds('Three.'))
    expect(labelText('intake valve,')).toBe('intake valve')
    const r = pulseRate(0.25, 0.25)
    expect([r(0), r(0.25), r(0.5), r(1)]).toEqual([0, 1, 1, 0])
    expect(r(0.125)).toBeCloseTo(0.5, 9)
    expect(pulseRate(1, 0)(1)).toBe(1)
  })
  test('colours: a mark takes the colour of its part when that reads on black, else ink', () => {
    const m = build((s) => { rect({ id: 'blue', color: '#58C4DD' }); rect({ id: 'dark', color: '#111111' }); circle({ id: 'ring' }); box({ id: 'solid', color: '#FC6255' }); s.step('x', (st: any) => { st.wait(1) }) })
    const f = m.state(0)
    expect(partColor(f, m.byId.get('blue')!)).toBe('#58C4DD')
    expect(markColor(f, m.byId.get('blue')!, null, '#DDDDDD')).toBe('#58C4DD')
    expect(luminance('#111111')).toBeLessThan(LEGIBLE_LUMINANCE)
    expect(markColor(f, m.byId.get('dark')!, null, '#DDDDDD')).toBe('#DDDDDD')
    expect(markColor(f, m.byId.get('blue')!, '#FFFF00', '#DDDDDD')).toBe('#FFFF00') // a configured colour wins
    expect(markColor(f, undefined, null, '#DDDDDD')).toBe('#DDDDDD')
    expect(markColor(f, m.byId.get('solid')!, null, '#DDDDDD').toUpperCase()).toBe('#FC6255')
  })
})
