// The verbs of src/anim (pure side): what each one records, read back through model.state(τ).
import { describe, expect, test } from 'bun:test'
import { arrow, circle, group, line, rect, row, text } from '../../../src/r2d/index.ts'
import { box } from '../../../src/r3d/index.ts'
import {
  count, create, fadeIn, fadeOut, grow, growArrow, indicate, moveAlong, rotate, timed, uncreate, vary, VERB_DEFAULTS, windows, write,
} from '../../../src/anim/index.ts'
import { api, lagged, linear, PACE, smooth, thereAndBack, wiggle, type SceneModel } from '../../../src/core/index.ts'
import { build, codes, near } from '../core/helpers.ts'

const { YELLOW, BLUE } = api
const diag = (m: SceneModel, code: string) => m.diagnostics.list.filter((d) => d.code === code)

describe('options: duration, rate, lag, span', () => {
  test('an unknown option, a span that is no stretch of time and an endless duration are reported, and the verb still plays', () => {
    let a: any
    const m = build((s) => {
      a = rect({ id: 'a' })
      s.step('x', (st: any) => { st.play(fadeIn(a, { durration: 2 } as any), fadeIn(a, { span: [2, 1] }), fadeIn(a, { duration: 1e9 })) })
    })
    expect(codes(m).sort()).toEqual(['API-UNKNOWN', 'NUM-INVALID', 'NUM-INVALID'])
    expect(diag(m, 'API-UNKNOWN')[0]!.fix[0]).toContain('"duration"')
    expect(m.steps[0]!.active).toBe(1)
    expect(m.state(1).reveal(a).p).toBe(1)
  })
  test('span: the verb occupies only that stretch of the play, and the play lasts until its end', () => {
    let a: any, b: any
    const m = build((s) => {
      a = rect(); b = rect()
      s.step('x', (st: any) => { st.play(fadeIn(a), fadeIn(b, { span: [1, 3], rate: linear })) })
    })
    expect(m.steps[0]!.active).toBe(3)
    expect(m.state(0.5).reveal(a).p).toBeCloseTo(0.5, 12) // the other members of the play keep their own length
    expect(m.state(0.99).visible(b)).toBe(false)
    expect(m.state(2).reveal(b).p).toBeCloseTo(0.5, 12)
    expect(m.state(3).reveal(b).p).toBe(1)
  })
  test('manim spellings are accepted silently', () => {
    let a: any
    const m = build((s) => { a = rect(); s.step('x', (st: any) => { st.play(fadeIn(a, { run_time: 2, rate_func: linear, time_span: [0, 2] } as any)) }) })
    expect(codes(m)).toEqual([])
    expect(m.state(1).reveal(a).p).toBeCloseTo(0.5, 12)
  })
  test('timed(): a span, a duration and a rate for what takes no options (m.to, lagged)', () => {
    let a: any, b: any
    const m = build((s) => {
      a = rect(); b = rect()
      s.step('x', (st: any) => { st.play(timed(a.to.shift(2, 0), { span: [1, 2], rate: linear }), timed(lagged([b.to.shift(1, 0), b.to.color(YELLOW)], { lag: 1 }), { duration: 4, rate: linear })) })
    })
    expect(codes(m)).toEqual([])
    expect(m.steps[0]!.active).toBe(4)
    expect(m.state(0.99).world(a).p[0]).toBe(0)
    expect(m.state(1.5).world(a).p[0]).toBeCloseTo(1, 12)
    expect(m.state(2).world(a).p[0]).toBe(2)
    expect(m.state(1).world(b).p[0]).toBeCloseTo(0.5, 12) // the lagged pair is stretched from 2 s to 4 s
    expect(m.state(2).world(b).p[0]).toBe(1)
    expect(m.state(2).prop(b, 'color')).toBe('#FFFFFF')
    expect(m.state(4).prop(b, 'color')).toBe(YELLOW)
    const bad = build((s) => { s.step('x', (st: any) => { st.play(timed(rect() as any), timed(undefined as any), timed(rect().to.shift(1, 0), { lag: 0.1 } as any)) }) })
    expect(codes(bad).sort()).toEqual(['API-TYPE', 'API-UNKNOWN', 'REF-MISSING'])
  })
  test('windows: manim lag_ratio inside one animation', () => {
    expect(windows(3, 0, 2, 1)).toEqual([[2, 1], [2, 1], [2, 1]])
    const w = windows(3, 0.5, 0, 2) // full = 2: each part takes 1 s and starts 0.5 s after the one before
    expect(w.map(([t, d]) => [t, d])).toEqual([[0, 1], [0.5, 1], [1, 1]])
    expect(windows(4, 1, 0, 4).map((x) => x[0])).toEqual([0, 1, 2, 3])
  })
})

describe('enter and exit', () => {
  test('fadeIn: shift is the way it arrives, scale the size it starts at; fadeOut: the way it leaves and the size it ends at', () => {
    let a: any
    const m = build((s) => {
      a = rect().at(1, 1)
      s.step('in', (st: any) => { st.play(fadeIn(a, { shift: [0, 1], scale: 0.5, rate: linear })) })
      s.step('out', (st: any) => { st.play(fadeOut(a, { shift: [2, 0], scale: 2, rate: linear })) })
      s.step('back', (st: any) => { st.play(fadeIn(a)) })
    })
    expect(m.state(0.5).world(a).p).toEqual([1, 0.5, 0])
    expect(m.state(0.5).world(a).s).toBeCloseTo(0.75, 12)
    const t = m.steps[1]!.t0
    expect(m.state(t + 0.5).world(a).p).toEqual([2, 1, 0])
    expect(m.state(t + 0.5).world(a).s).toBeCloseTo(1.5, 12)
    expect(m.state(t + 1).visible(a)).toBe(false)
    // fadeIn brings it back where it belongs, at its size
    const end = m.state(m.duration)
    expect(end.world(a).p).toEqual([1, 1, 0])
    expect(end.world(a).s).toBe(1)
    expect(end.visible(a)).toBe(true)
  })
  test('lag staggers the members of a group; a later fadeIn of the group brings every member back', () => {
    let a: any, b: any, c: any, g: any
    const m = build((s) => {
      a = rect(); b = rect(); c = rect(); g = row([a, b, c])
      s.step('in', (st: any) => { st.play(fadeIn(g, { lag: 0.5, rate: linear, duration: 2 })) }) // each member 1 s, 0.5 s apart
      s.step('out', (st: any) => { st.play(fadeOut(g, { lag: 1, rate: linear, duration: 3 })) })
      s.step('back', (st: any) => { st.play(fadeIn(g)) })
    })
    expect([a, b, c].map((n) => m.state(0.75).reveal(n).p)).toEqual([0.75, 0.25, 0])
    expect(m.state(0).visible(a)).toBe(false)
    const t = m.steps[1]!.t0
    expect([a, b, c].map((n) => m.state(t + 1.5).reveal(n).p)).toEqual([0, 0.5, 1])
    expect(m.state(t + 3).visible(g)).toBe(false)
    expect([a, b, c].every((n) => m.state(m.duration).reveal(n).p === 1)).toBe(true)
  })
  test('create draws the members of a group one after another; uncreate takes them back in reverse', () => {
    let a: any, b: any, g: any
    const m = build((s) => {
      a = rect(); b = circle(); g = group([a, b])
      s.step('in', (st: any) => { st.play(create(g, { rate: linear, duration: 2 })) })
      s.step('out', (st: any) => { st.play(uncreate(g, { rate: linear, duration: 2 })) })
    })
    expect(m.state(0.5).reveal(a)).toEqual({ p: 0.5, mode: 'create' })
    expect(m.state(0.5).visible(b)).toBe(false)
    expect(m.state(1.5).reveal(b)).toEqual({ p: 0.5, mode: 'create' })
    const t = m.steps[1]!.t0
    expect(m.state(t + 0.5).reveal(b)).toEqual({ p: 0.5, mode: 'create' })
    expect(m.state(t + 0.5).reveal(a).p).toBe(1)
    expect(m.state(t + 2).visible(a)).toBe(false)
    expect(VERB_DEFAULTS.createLag).toBe(1)
  })
  test('write: 1 s under 15 glyphs, else 2 s; linear; the text backend staggers the glyphs, so no lazy chunk is asked for', () => {
    let short: any, long: any
    const m = build((s) => {
      short = text('piston'); long = text('a crank turns the shaft')
      s.step('x', (st: any) => { st.play(write(short)); st.play(write(long, { lag: 0.05 })) })
    })
    expect(m.steps[0]!.active).toBe(3)
    expect(m.state(0.25).reveal(short)).toEqual({ p: 0.25, mode: 'write' })
    expect(m.state(2).reveal(long).p).toBeCloseTo(0.5, 12)
    // the glyph-by-glyph reveal is the text backend's (WRITE in src/r2d/svg.ts): the verb records the reveal and nothing else
    expect(m.state(1.5).reveal(long)).toEqual({ p: 0.25, mode: 'write' })
    expect(m.chunksNeeded()).not.toContain('anim')
  })
  test('write on a group: its glyphs are one run, each object occupying its own glyphs', () => {
    let a: any, b: any, g: any
    const m = build((s) => {
      a = text('ab'); b = text('cde'); g = group([a, b])
      s.step('x', (st: any) => { st.play(write(g, { lag: 0.5, duration: 3 })) }) // 5 glyphs: full = 3, each glyph 1 s, 0.5 s apart
    })
    // a: glyphs 0 and 1, [0, 1] and [0.5, 1.5] → written over 0 … 1.5 s; b: glyphs 2, 3, 4, [1, 2] … [2, 3] → over 1 … 3 s
    expect(m.state(1.5 - 1e-9).reveal(a).p).toBeCloseTo(1, 6)
    expect(m.state(2).reveal(b).p).toBeCloseTo(0.5, 12)
    expect(m.state(0.75).reveal(a).p).toBeCloseTo(0.5, 12)
    expect(m.state(0.99).visible(b)).toBe(false)
  })
  test('outline verbs on a 3D part: its edge lines are drawn on, then the body fills (the 3D renderer reads the reveal mode)', () => {
    let p: any
    const m = build((s) => { p = box({ id: 'p' }); s.step('x', (st: any) => { st.play(create(p)); st.play(write(p)); st.play(uncreate(p)) }) })
    expect(codes(m)).toEqual([])
    expect(m.state(0.5).reveal(p).mode).toBe('create')
    expect(m.state(1.5).reveal(p).mode).toBe('write')
    expect(m.state(2.5).reveal(p).mode).toBe('create')
  })
  test('every enter and exit verb takes a 3D part: it grows from nothing, slides in, comes in small, and leaves the way it came', () => {
    let a: any, b: any, c: any, d: any
    const m = build((s) => {
      a = box({ id: 'a' }).at(-3, 0, 0); b = box({ id: 'b' }).at(0, 0, 0); c = box({ id: 'c' }).at(3, 0, 0); d = box({ id: 'd' }).at(6, 0, 0)
      s.step('in', (st: any) => { st.play(grow(a, { rate: linear }), fadeIn(b, { shift: [0, 2, 0], rate: linear }), fadeIn(c, { scale: 0.5, rate: linear }), fadeIn(d, { rate: linear })) })
      s.step('out', (st: any) => { st.play(fadeOut(b, { shift: [0, 2, 0], rate: linear }), fadeOut(d, { rate: linear })) })
    })
    expect(codes(m)).toEqual([])
    // before: not there; half way: half size / half way down / between the two sizes / half faded; after: as declared
    for (const part of [b, c, d]) expect(m.state(0).visible(part)).toBe(false)
    expect(m.state(0).world(a).s).toBeCloseTo(VERB_DEFAULTS.growStart, 12)
    const mid = m.state(0.5), end = m.state(1)
    expect(mid.world(a).s).toBeGreaterThan(0)
    expect(mid.world(a).s).toBeLessThan(1)
    expect(mid.look(a).opacity).toBe(1) // it grows at full strength, it does not fade
    expect(mid.world(b).p[1]).toBeCloseTo(-1, 6)
    expect(mid.look(b).opacity).toBeCloseTo(0.5, 6)
    expect(mid.world(c).s).toBeCloseTo(0.75, 6)
    expect(mid.look(d).opacity).toBeCloseTo(0.5, 6)
    for (const part of [a, b, c, d]) { expect(end.world(part).s).toBeCloseTo(1, 9); expect(end.look(part).opacity).toBe(1) }
    expect(end.world(b).p[1]).toBeCloseTo(0, 9)
    const t0 = m.steps[1]!.t0
    expect(m.state(t0 + 0.5).world(b).p[1]).toBeCloseTo(1, 6)
    expect(m.state(t0 + 0.5).look(d).opacity).toBeCloseTo(0.5, 6)
    expect(m.state(t0 + 1.01).visible(b)).toBe(false)
    expect(m.state(t0 + 1.01).visible(a)).toBe(true)
  })
})

describe('grow, growArrow', () => {
  test('grow: from nothing to full size about the centre, at full opacity', () => {
    let a: any
    const m = build((s) => { a = rect({ width: 2, height: 1 }).at(1, 1); s.step('x', (st: any) => { st.play(grow(a, { rate: linear })) }) })
    expect(m.state(0).world(a).s).toBeCloseTo(VERB_DEFAULTS.growStart, 12)
    expect(m.state(0).reveal(a).p).toBe(1)
    expect(m.state(0.5).world(a).s).toBeCloseTo((1 + VERB_DEFAULTS.growStart) / 2, 12)
    expect(m.state(0.5).world(a).p).toEqual([1, 1, 0])
    expect(m.state(1).world(a).s).toBe(1)
  })
  test('grow from an edge keeps that edge where it is; from a point keeps that point', () => {
    let a: any, b: any, pin: any
    const m = build((s) => {
      a = rect({ width: 2, height: 1 }).at(1, 1)
      pin = circle({ radius: 0.1 }).at(-3, 2)
      b = rect({ width: 2, height: 1 }).at(0, -2)
      s.step('x', (st: any) => { st.play(grow(a, { from: 'left' }), grow(b, { from: pin }), { rate: linear }) })
    })
    expect(codes(m)).toEqual([])
    for (const t of [0, 0.3, 0.7, 1]) expect(m.state(t).bounds(a).min[0]).toBeCloseTo(0, 9)
    expect(m.state(0.5).bounds(a).max[0]).toBeCloseTo(1 + VERB_DEFAULTS.growStart, 9)
    // b grows out of the pin: at the start it sits on it, at the end it is where it was placed
    expect(near(m.state(0).world(b).p, [-3 + 3 * VERB_DEFAULTS.growStart, 2 - 4 * VERB_DEFAULTS.growStart, 0], 1e-9)).toBe(true)
    expect(m.state(1).world(b).p).toEqual([0, -2, 0])
  })
  test('a wrong edge name has a did-you-mean; a line grows from its start; growArrow on a shape is reported', () => {
    let l: any, r: any
    const m = build((s) => {
      l = line([0, 0], [2, 0]); r = rect({ id: 'r' })
      s.step('x', (st: any) => { st.play(grow(rect(), { from: 'lefft' } as any), grow(l), growArrow(r)) })
    })
    expect(codes(m).sort()).toEqual(['API-TYPE', 'API-UNKNOWN'])
    expect(diag(m, 'API-UNKNOWN')[0]!.fix[0]).toBe("use 'left'")
    expect(diag(m, 'API-TYPE')[0]!.fix[0]).toBe('grow(r)')
    expect(m.state(0.5).reveal(l).mode).toBe('create')
    const ok = build((s) => { const a = arrow([0, 0], [2, 0]); s.step('x', (st: any) => { st.play(growArrow(a)) }) })
    expect(codes(ok)).toEqual([])
  })
})

describe('rotate, moveAlong', () => {
  test('rotate adds degrees to where the object is; about a point it also travels round that point', () => {
    let a: any, b: any
    const m = build((s) => {
      a = rect().at(1, 0).rotate(10)
      b = rect().at(2, 0)
      s.step('x', (st: any) => { st.play(rotate(a, 90), rotate(b, 180, { about: [0, 0] }), { rate: linear }) })
      s.step('y', (st: any) => { st.play(rotate(b, 90, { about: [0, 0] }), { rate: linear }) })
    })
    expect(codes(m)).toEqual([])
    expect(m.state(0.5).prop(a, 'rotate')).toBeCloseTo(55, 12)
    expect(m.state(1).world(a).p).toEqual([1, 0, 0])
    expect(near(m.state(0.5).world(b).p, [0, 2, 0], 1e-9)).toBe(true) // a quarter of the way round, not half-way along the chord
    expect(near(m.state(1).world(b).p, [-2, 0, 0], 1e-9)).toBe(true)
    expect(near(m.state(m.duration).world(b).p, [0, -2, 0], 1e-9)).toBe(true)
    expect(m.state(m.duration).prop(b, 'rotate')).toBeCloseTo(270, 9)
  })
  test('rotate a 3D part about an axis; a second rotate about the same axis adds up', () => {
    let p: any
    const m = build((s) => {
      p = box()
      s.step('x', (st: any) => { st.play(rotate(p, 90, { about: 'y' })); st.play(rotate(p, 90, { about: 'y' })); st.play(rotate(p, 30, { about: 'x' })) })
    })
    expect(codes(m)).toEqual([])
    expect(m.state(3).prop(p, 'rotate')).toEqual([{ about: 'y', deg: 180 }, { about: 'x', deg: 30 }])
  })
  test('rotate: a line, a missing angle and a bad pivot are reported', () => {
    const m = build((s) => { const l = line([0, 0], [1, 0]); const a = rect(); s.step('x', (st: any) => { st.play(rotate(l, 90), rotate(a, NaN), rotate(a, 'far' as any), rotate(a, 90, { about: 'x' } as any)) }) })
    expect(codes(m).sort()).toEqual(['API-TYPE', 'API-TYPE', 'API-TYPE', 'NUM-INVALID'])
  })
  test('moveAlong: the centre is on the path at the eased share of its length, and stays at the end', () => {
    let d: any, ring: any, e: any
    const m = build((s) => {
      ring = circle({ radius: 2 }).at(1, 0)
      d = circle({ radius: 0.1 }).at(ring.right)
      e = circle({ radius: 0.1 })
      s.step('x', (st: any) => { st.play(moveAlong(d, ring), moveAlong(e, [[0, 0], [4, 0], [4, 2]]), { rate: linear, duration: 2 }) })
      s.step('y', (st: any) => { st.play(e.to.shift(1, 0)) })
    })
    expect(codes(m)).toEqual([])
    for (const t of [0, 0.3, 1, 1.7, 2]) { const p = m.state(t).world(d).p; expect(Math.hypot(p[0] - 1, p[1])).toBeCloseTo(2, 3) } // (a circle's outline is four cubic arcs)
    expect(near(m.state(0.5).world(d).p, [1, 2, 0], 1e-3)).toBe(true) // a quarter of the way round, counter-clockwise
    expect(near(m.state(2).world(d).p, [3, 0, 0], 1e-6)).toBe(true)
    expect(near(m.state(1).world(e).p, [3, 0, 0], 1e-9)).toBe(true) // half of 6 units
    expect(near(m.state(2).world(e).p, [4, 2, 0], 1e-9)).toBe(true)
    expect(near(m.state(m.duration).world(e).p, [5, 2, 0], 1e-9)).toBe(true) // a later shift starts from the end of the path
  })
  test('moveAlong: a line as the mover, a 3D part as the path and a path that is no path are reported', () => {
    const m = build((s) => {
      const a = rect({ id: 'a' }), l = line([0, 0], [1, 0]), p = box()
      s.step('x', (st: any) => { st.play(moveAlong(l, a), moveAlong(a, p), moveAlong(a, [[0, 0]] as any), moveAlong(a, undefined as any), moveAlong(a, a)) })
    })
    expect(codes(m).sort()).toEqual(['API-TYPE', 'API-TYPE', 'API-TYPE', 'API-TYPE', 'REF-MISSING'])
  })
})

describe('indicate, count, vary', () => {
  test('indicate: swells, takes the colour and comes back; nothing is left behind, whatever the rate of the play', () => {
    let a: any, t: any
    const m = build((s) => {
      a = rect({ color: BLUE }); t = text('x')
      s.step('x', (st: any) => { st.play(indicate(a), indicate(t, { scale: 2, color: null }), { rate: linear }) })
    })
    expect(codes(m)).toEqual([])
    expect(m.state(0.5).world(a).s).toBeCloseTo(1.2, 12)
    expect(m.state(0.5).prop(a, 'color')).toBe(YELLOW)
    expect(m.state(0.25).world(a).s).toBeCloseTo(1 + 0.2 * thereAndBack(0.25), 12)
    expect(m.state(1).world(a).s).toBe(1)
    expect(m.state(1).prop(a, 'color')).toBe(BLUE)
    expect(m.state(0.5).world(t).s).toBeCloseTo(2, 12)
    expect(m.state(0.5).prop(t, 'color')).toBe('#FFFFFF')
  })
  test('indicate: a rate that does not come back to 0 is reported; wiggle is fine', () => {
    const m = build((s) => { const a = rect(); s.step('x', (st: any) => { st.play(indicate(a, { rate: smooth })); st.play(indicate(a, { rate: wiggle })) }) })
    expect(codes(m)).toEqual(['API-TYPE'])
    expect(m.diagnostics.list[0]!.what).toContain('must come back to 0')
  })
  test('count: the first number in a text runs and what is around it stays', () => {
    let t: any, u: any
    const m = build((s) => {
      t = text('0°'); u = text('about 2.5 kg')
      s.step('x', (st: any) => { st.play(count(t, 360, { rate: linear }), count(u, 4, { rate: linear }), { duration: 2 }) })
    })
    expect(codes(m)).toEqual([])
    expect(m.state(0).prop(t, 'text')).toBe('0°')
    expect(m.state(1).prop(t, 'text')).toBe('180°')
    expect(m.state(2).prop(t, 'text')).toBe('360°')
    expect(m.state(m.duration).prop(t, 'text')).toBe('360°')
    expect(m.state(1).prop(u, 'text')).toBe('about 3.3 kg') // 3.25, one decimal like the number it started from
    expect(m.state(2).prop(u, 'text')).toBe('about 4.0 kg')
  })
  test('count: a param; from and decimals; something that shows no number is reported', () => {
    let p: any, t: any
    const m = build((s) => {
      p = s.param('p', { value: 0, min: 0, max: 10 })
      t = text('n')
      const r = rect({ id: 'r' })
      s.step('x', (st: any) => { st.play(count(p, 10, { rate: linear }), count(t, 1, { from: 0, decimals: 2, rate: linear }), count(r, 5), count(t, NaN)) })
    })
    expect(codes(m).sort()).toEqual(['API-TYPE', 'NUM-INVALID'])
    expect(m.state(0.5).param(p.def)).toBeCloseTo(5, 12)
    expect(m.state(0.5).prop(t, 'text')).toBe('0.50')
  })
  test('vary: a param runs through its stops, easing in and out of each, resting at the stops on the way', () => {
    let p: any
    const m = build((s) => {
      p = s.param('p', { value: 0, min: 0, max: 10 })
      s.step('x', (st: any) => { st.play(vary(p, [10, 4], { duration: 2, hold: 1 })) })
    })
    expect(codes(m)).toEqual([])
    expect(m.steps[0]!.active).toBe(5)
    expect(m.state(1).param(p.def)).toBeCloseTo(5, 12) // smooth(0.5) = 0.5
    expect(m.state(0.5).param(p.def)).toBeCloseTo(10 * smooth(0.25), 12)
    expect(m.state(2.5).param(p.def)).toBe(10)
    expect(m.state(4).param(p.def)).toBeCloseTo(7, 12)
    expect(m.state(5).param(p.def)).toBe(4)
    expect(PACE.sweep).toBe(3)
  })
  test('vary: not a number param, or stops that are not numbers', () => {
    const m = build((s) => {
      const p = s.param('p', { value: 0, min: 0, max: 10 }), on = s.toggle('on', { value: true })
      s.step('x', (st: any) => { st.play(vary(on, 1), vary(p, ['a'] as any), vary(undefined as any, 1), vary(p, [1, NaN])) })
    })
    expect(codes(m).sort()).toEqual(['API-TYPE', 'API-TYPE', 'NUM-INVALID', 'REF-MISSING'])
  })
})

describe('never throws', () => {
  test('every verb takes nonsense and answers with a diagnostic and something that can be played', () => {
    const verbs: ((...a: any[]) => any)[] = [write, create, uncreate, fadeIn, fadeOut, grow, growArrow, rotate, moveAlong, indicate, count, vary, timed]
    const junk: unknown[] = [undefined, null, 7, 'nope', {}, [], () => 1, NaN]
    const m = build((s) => {
      s.step('x', (st: any) => {
        for (const v of verbs) for (const j of junk) { const a = v(j, j, j); expect(a.isAnim).toBe(true); st.play(a) }
      })
    })
    expect(m.diagnostics.list.length).toBeGreaterThan(verbs.length)
    expect(codes(m).includes('RUNTIME-ERROR')).toBe(false)
    expect(() => m.state(0.5).signature()).not.toThrow()
  })
})
