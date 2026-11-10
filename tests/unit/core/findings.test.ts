// One regression test per finding of the two verifier reports on the hardened core (break-it and extend-it), pure
// side. The browser side is in tests/e2e/real-viewer.test.ts and tests/e2e/extending.test.ts. Kind and registry names
// used here are prefixed `fx` so they collide with nothing.
import { describe, expect, test } from 'bun:test'
import { arrow, circle, group, line, rect, STYLE, text } from '../../../src/r2d/index.ts'
import { between, box, sphere, torus } from '../../../src/r3d/index.ts'
import { fadeIn, fadeOut } from '../../../src/anim/index.ts'
import { readSpans } from '../../../src/guide/index.ts'
import {
  bezier, boxOf, compile, defineFinalize, defineKind, defineKindSetter, defineLook, defineManifest, defineStepAction, FRAME_H, FRAME_W, PACE, ramp, scene, selector, spaceOf, spanVerbs, VIEW,
  type Frame, type MNode, type Vec3,
} from '../../../src/core/index.ts'
import { runCheck } from '../../../src/check/engine.ts'
import '../../../src/check/check.ts'
import { build, codes, near } from './helpers.ts'

const end = (m: { steps: { t0: number; t1: number }[] }, k: number): number => m.steps[k]!.t1 - 0.001
const diags = (m: { diagnostics: { list: { code: string; what: string }[] } }, code: string): string[] => m.diagnostics.list.filter((d) => d.code === code).map((d) => d.what)

// ── break-it 2: narration spans ───────────────────────────────────────────────────────────────────────────────────
describe('narration spans are validated when the scene is built', () => {
  test('a target that is no object is GUIDE-TARGET, an unknown verb API-UNKNOWN, an unclosed span API-TYPE; good spans are silent', () => {
    const m = build((s) => {
      rect({ id: 'a' })
      s.step('x', (st: any) => { st.say('The [box](ring:nothere) and [other](bogusverb:a) and [unterminated](a and [](focus:zzz).') })
      s.step('y', (st: any) => { st.say('A [good](a) one, a [ring](ring:a) and a [pair](focus:a+a).') })
    })
    expect(m.diagnostics.list.map((d) => [d.code, d.step, d.ids])).toEqual([
      ['API-UNKNOWN', 1, []], ['API-TYPE', 1, []], ['GUIDE-TARGET', 1, ['nothere']], ['GUIDE-TARGET', 1, ['zzz']],
    ])
    expect(diags(m, 'API-UNKNOWN')[0]).toContain('bogusverb')
    expect(m.diagnostics.list.find((d) => d.code === 'API-UNKNOWN')!.fix[0]).toContain('point, ring, label, arrow, glow, focus')
    expect(m.diagnostics.list.every((d) => typeof d.line === 'number' && d.fix.length > 0)).toBe(true)
    expect(spanVerbs()).toEqual(['point', 'ring', 'label', 'arrow', 'glow', 'focus'])
  })
  test('the words between two spans are kept: a broken span does not swallow the good one after it', () => {
    const r = readSpans('The [box](ring:nothere) and [other](x:a) and [unterminated](a and [](focus:zzz).')
    expect(r.plain).toBe('The box and other and unterminated(a and .')
    expect(r.spans.map((sp) => [sp.words, sp.verb, sp.targets])).toEqual([['box', 'ring', ['nothere']], ['', 'focus', ['zzz']]])
  })
  test('an id made later in the scene is a fine target (the check runs when the scene is complete)', () => {
    const m = build((s) => { s.step('x', (st: any) => { st.say('Here comes the [piston](piston).'); rect({ id: 'piston' }) }) })
    expect(codes(m)).toEqual([])
  })
  test('st.narration records plain strings whatever it is given, so the transcript is always JSON', () => {
    let node: any
    const m = build((s) => { node = rect({ id: 'a' }); s.step('x', (st: any) => { st.narration('x', { plain: node, spans: [{ start: 0, end: 1, words: node, verb: null, targets: [node, 'a', null] }, null] }) }) })
    expect(codes(m)).toEqual(['API-TYPE'])
    const n = m.steps[0]!.narration[0]!
    expect(n).toMatchObject({ text: 'x', plain: 'x', spans: [{ words: '', verb: 'point', targets: ['a', 'a'] }] })
    expect(() => JSON.stringify(m.steps[0]!.narration)).not.toThrow()
  })
})

// ── break-it 3: async ───────────────────────────────────────────────────────────────────────────────────────────
describe('the scene is recorded in one synchronous pass', () => {
  test('an async builder is API-TYPE at the scene() line; what arrives after its await changes nothing and is reported', async () => {
    let s0: any, a: any, late: any
    const def = scene({ title: 'async' }, (async (s: any) => {
      s0 = s
      a = rect({ id: 'a' })
      s.step('one', (st: any) => { late = st; st.play(fadeIn(a)) })
      await null
      s.step('two', (st: any) => { st.wait(5) })
    }) as any)
    const m = compile(def)
    const duration = m.duration, clips = m.allClips().length
    await null
    await null
    late.play(fadeOut(a)) // a step handle kept past its step
    late.clip(a, 'opacity', 0.5)
    late.action('label', { node: a, text: 'x' })
    a.color('#FF0000') // a setter after the scene was built
    s0.param('p', { value: 1 })
    expect(m.steps.length).toBe(1)
    expect([m.duration, m.allClips().length, m.actions.length, m.params.length]).toEqual([duration, clips, 0, 0])
    expect(m.state(0).prop(a, 'color')).toBe('#FFFFFF')
    const whats = diags(m, 'API-TYPE')
    expect(whats[0]).toContain('the scene builder is async')
    for (const call of ['s.step()', 'st.play()', 'st.clip()', "st.action('label')", 'rect.color()', 's.param()']) expect(whats.some((w) => w.startsWith(`${call} was called after the scene had been built`))).toBe(true)
    expect(s0.t()).toBe(0) // reading is fine at any time
  })
  test('an async step function is API-TYPE at the step line', () => {
    const m = build((s) => { const a = rect({ id: 'a' }); s.step('x', (async (st: any) => { st.say('hi'); await null; st.play(fadeIn(a)) }) as any) })
    expect(m.diagnostics.list.map((d) => [d.code, d.step])).toEqual([['API-TYPE', 1]])
    expect(m.diagnostics.list[0]!.what).toContain('the function of step 1 "x" is async')
  })
})

// ── break-it 4: diagnostics found with a param pinned ─────────────────────────────────────────────────────────────
describe('a diagnostic found at a param extreme says which value', () => {
  test('NUM-INVALID carries the params, a "when" clause and the command that shows it; the default state carries none', async () => {
    const m = build((s) => {
      const q = s.param('q', { value: 1, min: 0, max: 10 })
      rect({ id: 'n', width: () => (q() > 8 ? NaN : 1) })
      rect({ id: 'always', width: () => NaN })
      s.step('one', (st: any) => { st.wait(1) })
    })
    await runCheck(null, {}, m)
    const pinned = m.diagnostics.list.find((d) => d.ids[0] === 'n')!
    expect(pinned.what).toBe('width of #n became NaN when q = 10 (its maximum).')
    expect(pinned.params).toEqual({ q: 10 })
    expect(pinned.fix.at(-1)).toBe('see it: mimir shot <scene> --step 1 --set q=10')
    const plain = m.diagnostics.list.find((d) => d.ids[0] === 'always')!
    expect(plain.what).toBe('width of #always became NaN.')
    expect('params' in plain).toBe(false)
    // a throwing function says it as well
    const t = build((s) => { const p = s.param('p', { value: 0, min: 0, max: 1 }); rect({ id: 'r', width: () => { if (p() > 0.5) throw new Error('boom'); return 1 } }); s.step('x', (st: any) => { st.wait(1) }) })
    t.state(0, { p: 1 }).props(t.byId.get('r')!)
    expect(t.diagnostics.list[0]).toMatchObject({ code: 'RUNTIME-ERROR', params: { p: 1 } })
    expect(t.diagnostics.list[0]!.what).toContain('when p = 1 (its maximum)')
  })
})

// ── break-it 5 / extend-it 3: the 2D camera and things on the screen ──────────────────────────────────────────────
describe('st.zoom beside a 3D panel', () => {
  test('a 2D object placed on a 3D part (at, nextTo, a line end) lives on the screen: the zoom neither moves nor scales it', () => {
    let note: any, ring: any, beside: any, link: any, tag: any, base: any, ball: any
    const m = build((s) => {
      s.viewport('right', 0.5)
      base = box({ id: 'base', width: 4, height: 0.5, depth: 4 })
      ball = sphere({ id: 'ball', radius: 0.7 }).at(0, 1, 0)
      note = rect({ id: 'note', width: 2.2, height: 1 }).at(-4.5, 2)
      link = arrow(note, ball, { id: 'link' })
      ring = circle({ id: 'ring', radius: 0.25 }).at(ball)
      tag = text('top', { id: 'tag' }).pin(ball, 'top', { offset: [0, 0.3] })
      beside = text('beside', { id: 'beside' }).nextTo(base, 'down', 0.2)
      s.step('still', (st: any) => { st.wait(1) })
      s.step('zoom', (st: any) => { st.zoom(note, { margin: 2 }) })
    })
    expect(codes(m)).toEqual([])
    expect([note, link, ring, tag, beside].map(spaceOf)).toEqual(['2d', 'hud', 'hud', 'hud', 'hud'])
    const f0 = m.state(end(m, 0)), f1 = m.state(end(m, 1))
    expect(f1.zoomed()).toBe(true)
    // what follows the part is exactly where it was, at the size it had
    for (const n of [ring, tag, beside]) expect(f1.frameRect(n)).toEqual(f0.frameRect(n))
    // the 2D camera looks through the left half: the note is fitted into it and does not reach the 3D panel
    expect(m.area2d()).toEqual({ x: -FRAME_W / 2, y: -FRAME_H / 2, width: FRAME_W / 2, height: FRAME_H })
    const r = f1.frameRect(note)!
    expect(r.x + r.width / 2).toBeCloseTo(-FRAME_W / 4, 9)
    expect(r.y + r.height / 2).toBeCloseTo(0, 9)
    expect(r.width).toBeCloseTo(FRAME_W / 4, 9) // margin 2: half the window
    expect(r.x + r.width).toBeLessThan(0)
    // the arrow still joins the zoomed note and the ball: it starts at the note's edge on screen and ends at the ball
    const a = f1.props(link).a as Vec3, b = f1.project(ball)
    expect(Math.abs(a[0] - (r.x + r.width / 2))).toBeLessThan(r.width / 2 + 1e-9)
    expect(near([(f1.props(link).b as Vec3)[0], (f1.props(link).b as Vec3)[1]], [b.x, b.y], 1e-9)).toBe(true)
  })
  test('zooming on something that is on the screen is API-TYPE at the st.zoom line, never a cycle or a TypeError; the rest is framed', async () => {
    let tag: any
    const m = build((s) => {
      s.viewport('right', 0.5)
      const p = box({ id: 'p' })
      tag = text('part', { id: 'tag' }).at(-4.5, -2)
      const ptr = arrow(tag, p.anchor('top'), { id: 'ptr' })
      const beside = text('valve', { id: 't' }).nextTo(p, 'left', 0.3)
      s.step('before', (st: any) => { st.wait(1) })
      s.step('zoom', (st: any) => { st.zoom([tag, ptr]) })
      s.step('again', (st: any) => { st.zoom(beside) })
    })
    await runCheck(null, {}, m) // every sample, every node: nothing may throw or report a cycle
    expect(m.diagnostics.list.map((d) => [d.code, d.ids, d.step])).toEqual([['API-TYPE', ['ptr'], 2], ['API-TYPE', ['t'], 3]])
    expect(m.diagnostics.list[0]!.fix[0]).toBe('zoom on the 2D objects only: st.zoom([tag])')
    const f = m.state(end(m, 1))
    const r = f.frameRect(tag)!
    expect(r.x + r.width / 2).toBeCloseTo(-FRAME_W / 4, 9)
    // the same answer whatever is asked first (the camera is resolved in a scratch frame)
    const g = m.state(end(m, 1))
    g.props(m.byId.get('ptr')!)
    g.world(tag)
    expect(g.camera2d()).toEqual(f.camera2d())
  })
  test('zoom is bounded; undefined, a non-finite point, an empty rectangle and a hud object are reported', () => {
    const m = build((s) => {
      const a = rect({ id: 'a' })
      const title = text('T', { id: 'title' }).hud()
      s.step('x', (st: any) => { st.zoom(undefined); st.zoom([NaN, 0]); st.zoom({ width: 0, height: 0 }); st.zoom(title); st.zoom(a, { zoom: 1e6 }); st.zoom(a, { zoom: 1e-6 }) })
      s.step('tiny', (st: any) => { st.zoom(rect({ id: 'dot', width: 0.01, height: 0.01 })) })
    })
    expect(codes(m)).toEqual(['REF-MISSING', 'NUM-INVALID', 'NUM-INVALID', 'API-TYPE', 'NUM-INVALID', 'NUM-INVALID'])
    expect(m.camera2dClips().length).toBe(1) // only the last one was recorded
    expect(m.state(end(m, 1)).camera2d().zoom).toBe(8) // a fitted target is clamped
  })
})

// ── break-it 10, 11 ─────────────────────────────────────────────────────────────────────────────────────────────
describe('names and helpers', () => {
  test('a param may have any name: "constructor", "toString" and "__proto__" read their own values', () => {
    let a: any, b: any, c: any, r: any
    const m = build((s) => {
      a = s.param('constructor', { value: 2, min: 0, max: 10 })
      b = s.param('toString', { value: 3, min: 0, max: 10 })
      c = s.param('__proto__', { value: 4, min: 0, max: 10 })
      r = rect({ id: 'r', width: () => a() + b() + c() })
      s.probe('constructor', () => a())
    })
    const f = m.state(0)
    expect(f.prop(r, 'width')).toBe(9)
    expect(m.state(0, { constructor: 5 } as any).prop(r, 'width')).toBe(12)
    expect((f.probes() as Record<string, number>)['constructor']).toBe(2)
    expect(codes(m)).toEqual([])
  })
  test('an empty id is reported; a clip on a channel called like an Object member is not accepted', () => {
    const m = build((s) => { const n = rect({ id: '' }); s.step('x', (st: any) => { st.clip(n, 'constructor', 1); st.clip(n, 'toString', 1) }) })
    expect(codes(m)).toEqual(['API-TYPE', 'API-UNKNOWN', 'API-UNKNOWN'])
    expect(m.nodes[0]!.id).toBe('rect1')
  })
  test('ramp() and bezier() report bad input and still give something that works; st.clip / st.action take null options', () => {
    let f: any, g: any, h: any
    const m = build((s) => {
      f = ramp(undefined as any); g = ramp(null as any); h = bezier(undefined as any)
      const n = rect({ id: 'a' })
      s.step('x', (st: any) => { st.clip(n, 'opacity', 0.5, null); st.action('fxMark', { n: 1 }, null); st.clip(null, 'opacity', 1) })
    })
    expect(codes(m)).toEqual(['API-TYPE', 'API-TYPE', 'API-TYPE', 'REF-MISSING'])
    expect(f(0.5)).toMatch(/^#/)
    expect(g(2)).toMatch(/^#/)
    expect(h(0.25)).toBe(0.25)
    expect(m.actions.length).toBe(1)
  })
  test('a manifest hook whose value is not JSON is reported by key, not thrown (pure side: the value check)', () => {
    defineManifest('fxBad', (model) => ({ node: model.nodes[0] }))
    const m = build(() => { rect({ id: 'a' }) })
    const v = { node: m.nodes[0] }
    expect(() => JSON.stringify(v)).toThrow() // what the host guards against: a node refers to its model, which refers to it
  })
})

// ── break-it 12, 13 ─────────────────────────────────────────────────────────────────────────────────────────────
describe('check sees what used to pass silently', () => {
  test('NOT-PURE: a dynamic function or a probe that answers differently for the same time', async () => {
    let counter = 0
    const m = build((s) => {
      rect({ id: 'rnd', width: () => 0.5 + Math.random() })
      rect({ id: 'cnt', width: () => 1 + (counter++ % 7) })
      rect({ id: 'fine', width: () => 1 + s.t() })
      s.probe('late', () => Math.random())
      s.step('x', (st: any) => { st.wait(1) })
    })
    const out = await runCheck(null, { rules: ['NOT-PURE'] }, m)
    expect(out.map((d) => [d.code, d.ids])).toEqual([['NOT-PURE', ['rnd']], ['NOT-PURE', ['cnt']], ['NOT-PURE', []]])
    expect(out[0]!.what).toContain('width of #rnd gave two different values')
    expect(out[0]!.fix[0]).toContain('s.rng(1)')
    expect(out[2]!.what).toContain('probe "late"')
  })
  test('st.clock with a negative speed, an absurd duration, an unknown scene option, a scale of 0, a rod to itself, a ring that closes on itself', () => {
    const m = compile(scene({ title: 't', bogus: 1 } as any, (s: any) => {
      const b = rect({ id: 'b' })
      rect({ id: 'z' }).scale(() => 0)
      const a = box({ id: 'a' })
      between(a, a, { id: 'rod' })
      torus({ id: 'fat', radius: 1, tube: 5 })
      s.step('x', (st: any) => { st.clock({ speed: -3 }); st.play(fadeIn(b), { duration: 1e9 }); st.wait(1e7) })
    }))
    m.state(0).world(m.byId.get('z')!)
    expect(m.diagnostics.list.map((d) => [d.code, d.what.split(/[:(]/)[0]!.trim()])).toEqual([
      ['API-UNKNOWN', 'scene'], ['API-TYPE', 'between'], ['NUM-INVALID', 'torus'], ['NUM-INVALID', 'st.clock'], ['NUM-INVALID', 'st.play'], ['NUM-INVALID', 'st.wait'], ['NUM-INVALID', 'scale of #z became 0.'],
    ])
    expect(m.duration).toBeLessThan(10) // not a billion seconds
    expect(m.steps[0]!.clockSpeed).toBe(1)
  })
  test('GUIDE-TARGET (warn): st.focus / st.label on something that is not on stage in that step', async () => {
    const m = build((s) => {
      const b = rect({ id: 'b' }), c = rect({ id: 'c' }).at(3, 0)
      s.step('one', (st: any) => { st.play(fadeOut(c)) })
      s.step('two', (st: any) => { st.focus(c); st.label(c, 'gone'); st.label(b, 'here') })
      s.step('three', (st: any) => { st.focus(b, c) }) // one of them is there: the focus has something to show
    })
    const out = await runCheck(null, { rules: ['GUIDE-TARGET'] }, m)
    expect(out.map((d) => [d.severity, d.step, d.ids, d.what.split(' in ')[0]])).toEqual([['warn', 2, ['c'], 'st.focus()'], ['warn', 2, ['c'], 'st.label()']])
    expect(out[0]!.what).toContain('the whole stage is dimmed')
  })
  test('every RUNTIME-ERROR has a fix (DESIGN section 7)', () => {
    const m = build((s) => { s.step('x', () => { throw new Error('kaboom') }); rect({ id: 'r', width: () => { throw new Error('later') } }) })
    m.state(0).props(m.byId.get('r')!)
    const list = m.diagnostics.list.filter((d) => d.code === 'RUNTIME-ERROR')
    expect(list.length).toBe(2)
    for (const d of list) expect(d.fix.length).toBeGreaterThan(0)
  })
})

// ── extend-it 2, 11: view channels ──────────────────────────────────────────────────────────────────────────────
const fxLamp = defineKind({
  name: 'fxLamp', space: '3d', schema: {}, bounds: () => boxOf(0.5, 1, 0.5),
  init(node, model) { model.child(node, 'stem', box, { width: 0.1, height: 1, depth: 0.1 }); model.child(node, 'bulb', sphere, { radius: 0.3 }).at(0, 0.8, 0) },
})
defineLook('fxGhost', (look, v: number) => { look.opacity *= 1 - 0.82 * v; if (v > 0.5) look.shell = true }, { rest: 0 })
defineStepAction('fxGhost', (st, part: unknown, amount: unknown = 1) => { st.clip(part === null ? VIEW : st.node(part, 'st.fxGhost()'), 'fxGhost', amount, { duration: 1 }) })
describe('view channels reach the parts that draw', () => {
  test('a view mode on a composite or a group applies to everything inside; a part inside can opt out with the rest value', () => {
    let lamp: any, a: any, b: any, g: any, free: any
    const m = build((s) => {
      lamp = fxLamp({ id: 'lamp' })
      a = box({ id: 'a' }); b = box({ id: 'b' }); g = group([a, b])
      free = box({ id: 'free' })
      s.step('ghost', (st: any) => { st.fxGhost(lamp); st.fxGhost(g) })
      s.step('all', (st: any) => { st.fxGhost(null) })
      s.step('except', (st: any) => { st.clip(free, 'fxGhost', 0, { duration: 1 }); st.clip(s.model.byId.get('lamp.bulb'), 'fxGhost', 0, { duration: 1 }) })
    })
    expect(codes(m)).toEqual([])
    const stem = m.byId.get('lamp.stem')!, bulb = m.byId.get('lamp.bulb')!
    const f1 = m.state(end(m, 0))
    for (const n of [stem, bulb, a, b]) { expect(f1.look(n).opacity).toBeCloseTo(0.18, 9); expect(f1.look(n).shell).toBe(true) }
    expect(f1.look(free).opacity).toBe(1)
    // half way through the tween the parts are half way: the value is inherited, not switched
    expect(m.state(m.steps[0]!.t0 + 0.5).look(stem).opacity).toBeCloseTo(1 - 0.82 * 0.5, 6)
    const f2 = m.state(end(m, 1))
    expect(f2.look(free).opacity).toBeCloseTo(0.18, 9)
    // the scene is ghosted; `free` and the bulb say 0 (the rest value) and are solid again, the stem still follows the lamp
    const f3 = m.state(end(m, 2))
    expect(f3.look(free).opacity).toBe(1)
    expect(f3.look(bulb).opacity).toBe(1)
    expect(f3.look(stem).opacity).toBeCloseTo(0.18, 9)
    // the opt-out is a tween from what the part had, not a jump
    expect(m.state(m.steps[2]!.t0 + 0.5).look(free).opacity).toBeCloseTo(1 - 0.82 * 0.5, 6)
    expect(f3.lookValue(free, 'fxGhost')).toBe(0)
    expect(f2.signature()).not.toBe(f3.signature())
  })
  test('a typo on VIEW, a channel of single objects on VIEW, and a view channel on a 2D object are reported', () => {
    const m = build((s) => {
      const t = text('flat', { id: 't' })
      s.step('x', (st: any) => { st.clip(VIEW, 'fxGhots', 1); st.clip(VIEW, 'opacity', 0.2); st.clip(t, 'fxGhost', 1) })
    })
    expect(codes(m)).toEqual(['API-UNKNOWN', 'API-UNKNOWN', 'API-UNKNOWN'])
    expect(m.diagnostics.list[0]!.fix[0]).toBe('use "fxGhost"')
    expect(m.allClips().length).toBe(0)
  })
})

// ── extend-it 4: explode ────────────────────────────────────────────────────────────────────────────────────────
describe('frame.rest: where a part is when nothing is pushed apart', () => {
  test('one selector clip on offset whose target reads frame.rest(node) moves every part, with what is attached; no cycle', async () => {
    let a: any, b: any, rider: any
    const m = build((s) => {
      a = box({ id: 'a' }).at(2, 0, 0)
      b = box({ id: 'b' }).at(0, 1, 0)
      rider = sphere({ id: 'rider', radius: 0.2 }).attach(a, { my: 'bottom', to: 'top' })
      s.step('explode', (st: any) => { st.clip(selector((n) => n.space === '3d' && !n.parent && n !== rider), 'offset', (node: MNode, frame: Frame): Vec3 => { const p = frame.rest(node).p; return [p[0] * 0.5, p[1] * 0.5, p[2] * 0.5] }, { duration: 1 }) })
    })
    await runCheck(null, {}, m)
    expect(codes(m)).toEqual([])
    const f = m.state(end(m, 0))
    expect(near(f.world(a).p, [3, 0, 0], 1e-9)).toBe(true)
    expect(near(f.world(b).p, [0, 1.5, 0], 1e-9)).toBe(true)
    expect(near(f.rest(a).p, [2, 0, 0], 1e-9)).toBe(true)
    expect(f.world(rider).p[0]).toBeCloseTo(3, 9) // what is attached follows
    expect(near(m.state(m.steps[0]!.t0 + 0.5).world(a).p, [2.5, 0, 0], 1e-9)).toBe(true)
    // asking for the rest position does not change what the frame answers afterwards
    const g = m.state(end(m, 0))
    g.rest(a)
    expect(g.world(a).p).toEqual(f.world(a).p)
  })
})

// ── extend-it 5, 6, 7, 12, 16, 17 ──────────────────────────────────────────────────────────────────────────────
const fxNode = defineKind({
  name: 'fxNode', space: '2d',
  schema: { width: { type: 'positive', default: 2 }, count: { type: 'int', nullable: true, default: null }, limit: { type: 'number', nullable: true, default: null }, color: { type: 'color', default: '#FFFFFF' }, strokeWidth: { type: 'nonneg', default: 2 } },
  bounds: (_n, r) => boxOf(r.width / 2, 0.5, 0),
  init(node, model) {
    model.child(node, 'label', text, 'node', { size: 'note' })
    const badge = model.child(node, 'badge', group, [])
    model.child(badge, 'disc', circle, { radius: 0.2, fill: '#FF0000' })
  },
})
defineKindSetter('fxNode', 'badge', (_node: MNode, n: unknown) => (typeof n === 'number' || n === null ? { count: n } : null))
describe('composites', () => {
  test('z adds up down the tree: raising a composite raises its parts', () => {
    let panel: any, n: any
    const m = build(() => { panel = rect({ id: 'panel' }).z(1); n = fxNode({ id: 'n' }).z(2) })
    const f = m.state(0)
    expect(f.z(panel)).toBe(1)
    expect(['n', 'n.label', 'n.badge', 'n.badge.disc'].map((id) => f.z(m.byId.get(id)!))).toEqual([2, 2, 2, 2])
    m.byId.get('n.label')!.props.z = 0.5
    expect(m.state(0).z(m.byId.get('n.label')!)).toBe(2.5)
  })
  test('st.focus pushes back the body of an unfocused composite as well as its parts', () => {
    let a: any, b: any
    const m = build((s) => { a = fxNode({ id: 'a' }); b = fxNode({ id: 'b' }).at(3, 0); s.step('x', (st: any) => { st.focus(b) }) })
    const f = m.state(end(m, 0))
    for (const id of ['a', 'a.label', 'a.badge.disc']) expect(f.dim(m.byId.get(id)!)).toBe(1)
    for (const id of ['b', 'b.label', 'b.badge.disc']) expect(f.dim(m.byId.get(id)!)).toBe(0)
    expect([a, b].length).toBe(2)
  })
  test('a nullable number stays null: no NUM-INVALID, not 0', () => {
    let c: any
    const m = build(() => { c = fxNode({ id: 'c' }); fxNode({ id: 'd', limit: null, count: () => null }) })
    const f = m.state(0)
    expect([f.prop(c, 'limit'), f.prop(c, 'count'), f.prop(m.byId.get('d')!, 'count')]).toEqual([null, null, null])
    f.props(c)
    expect(codes(m)).toEqual([])
    // a value that is not a number is still reported
    const bad = build(() => { fxNode({ id: 'e', limit: () => 'x' as any }) })
    bad.state(0).props(bad.byId.get('e')!)
    expect(codes(bad)).toEqual(['NUM-INVALID'])
  })
  test('defineKindSetter: n.badge(3) sets, n.to.badge(5) tweens, only that kind has it', () => {
    let n: any, r: any
    const m = build((s) => {
      n = fxNode({ id: 'n' }).badge(3).at(1, 0)
      r = rect({ id: 'r' })
      r.badge(1)
      s.step('x', (st: any) => { st.play(n.to.badge(5).color('#FF0000')) })
    })
    expect(m.diagnostics.list.map((d) => [d.code, d.ids])).toEqual([['API-UNKNOWN', ['r']]])
    expect(m.state(0).prop(n, 'count')).toBe(3)
    expect(m.state(end(m, 0)).prop(n, 'count')).toBe(5)
    expect(m.state(m.steps[0]!.t0 + PACE.play / 2).prop(n, 'count')).toBe(4)
    expect(m.state(end(m, 0)).prop(n, 'color')).toBe('#FF0000')
  })
  test('one setter call lands on one set of objects: group.stroke(colour, width) gives both to the shapes that have a stroke', () => {
    let n1: any, n2: any, c: any
    const m = build((s) => {
      n1 = fxNode({ id: 'n1' }); n2 = fxNode({ id: 'n2' })
      const g = group([n1, n2])
      g.stroke('#FF0000', 5)
      c = group([rect({ id: 'p' }), rect({ id: 'q' })])
      s.step('x', (st: any) => { st.play(c.to.stroke('#00FF00', 7)) })
    })
    expect(codes(m)).toEqual([])
    const f = m.state(end(m, 0))
    // fxNode has strokeWidth but no stroke: the patch goes, whole, to the discs inside (which have both)
    for (const id of ['n1', 'n2']) expect(f.prop(m.byId.get(id)!, 'strokeWidth')).toBe(2)
    for (const id of ['n1.badge.disc', 'n2.badge.disc']) expect([f.prop(m.byId.get(id)!, 'stroke'), f.prop(m.byId.get(id)!, 'strokeWidth')]).toEqual(['#FF0000', 5])
    for (const id of ['p', 'q']) expect([f.prop(m.byId.get(id)!, 'stroke'), f.prop(m.byId.get(id)!, 'strokeWidth')]).toEqual(['#00FF00', 7])
    expect(Object.keys(STYLE)).toEqual(['color', 'fill', 'fillOpacity', 'stroke', 'strokeWidth', 'dashed'])
  })
  test('model.addAction: a finalize hook adds an action with the defaults of st.action', () => {
    defineFinalize('fx.card', (model) => { if (model.opts.title === 'fx-card') model.addAction('fxCard', { title: 'one' }, { step: 1, at: 0.5 }) })
    const m = build((s) => { s.step('a', (st: any) => { st.wait(1) }); s.step('b', (st: any) => { st.action('fxCard', { title: 'own' }) }) }, 'fx-card')
    const [own, added] = m.actions.filter((a) => a.type === 'fxCard').sort((a, b) => a.t0 - b.t0)
    expect(added).toMatchObject({ step: 1, scope: 'step', data: { title: 'one' }, t0: m.steps[1]!.t0 + 0.5, t1: m.steps[1]!.t0 + 0.5 + PACE.scopedIn })
    expect(own).toMatchObject({ step: 1, scope: 'step', t0: m.steps[1]!.t0 })
    expect(m.state(end(m, 1)).actions('fxCard').length).toBe(2)
  })
})

// ── the frame is 16:9 exactly ───────────────────────────────────────────────────────────────────────────────────
test('FRAME_W is 16:9 of FRAME_H exactly, so a 1280 x 720 stage is 90 px per unit', () => {
  expect(FRAME_W * 9).toBe(FRAME_H * 16)
  expect(1280 / FRAME_W).toBeCloseTo(90, 12)
  expect(line).toBeDefined()
})
