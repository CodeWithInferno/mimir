// M0.5 hardening: one regression test per finding of the build review notes (pure side; the browser side is
// in tests/e2e/extending.test.ts). Kind and registry names used here are prefixed `hx` so they collide with nothing.
import { describe, expect, test } from 'bun:test'
import { arrow, circle, exitPoint, group, line, pointOnOutline, rect, text } from '../../../src/r2d/index.ts'
import { box, sphere } from '../../../src/r3d/index.ts'
import { fadeIn } from '../../../src/anim/index.ts'
import {
  allFinalizers, allManifests, anim, boxOf, CAMERA2D, CHAPTER_CLEAR, claim, FRAME_W, defineFinalize, defineInterp, defineKind, defineKindBackend, defineLook, defineManifest, defineOverlay,
  defineRule, defineSetter, defineStepAction, defineVerb, kindOf, linear, overlayLayoutOrder, ownerOf, registryConflicts, selector, spaceOf, validateOptions, VIEW,
  type MNode, type Vec3,
} from '../../../src/core/index.ts'
import { build, codes, near } from './helpers.ts'

const end = (m: { steps: { t0: number; t1: number }[] }, k: number): number => m.steps[k]!.t1 - 0.001

describe('finding 1: a 2D object that refers to a 3D part resolves to where that part is drawn', () => {
  test('at(part), at(part.anchor()), nextTo(part), line(text, part) and a pinned label use the projection', () => {
    let part: any, t1: any, t2: any, t3: any, ln: any, pinned: any
    const m = build((s) => {
      s.viewport('right', 0.5)
      part = box({ id: 'part', width: 2, height: 2, depth: 2 }).at(3, 5, -2)
      t1 = text('a').at(part)
      t2 = text('b').at(part.anchor('top'))
      t3 = text('c').nextTo(part, 'left', 0.25)
      ln = line(t3, part.anchor('top'))
      pinned = text('d').pin(part, 'top', { offset: [0, 0.4] })
    })
    expect(codes(m)).toEqual([])
    const f = m.state(0)
    const centre = f.project(part), top = f.project(part.anchor('top'))
    expect(centre.visible).toBe(true)
    // not the 3D coordinates [3, 5, -2] taken as frame coordinates
    expect(near(f.world(t1).p, [centre.x, centre.y, 0], 1e-9)).toBe(true)
    expect(Math.abs(f.world(t1).p[1] - 5)).toBeGreaterThan(1)
    expect(near(f.world(t2).p, [top.x, top.y, 0], 1e-9)).toBe(true)
    // nextTo sits beside the rectangle the part covers on screen
    const r = f.frameRect(part)!
    expect(f.bounds(t3).max[0]).toBeCloseTo(r.x - 0.25, 9)
    expect(f.world(t3).p[1]).toBeCloseTo(r.y + r.height / 2, 9)
    // the resolved end of the line is a 2D point, and project() knows it (it does not guess from the length 3)
    const rl = f.props(ln)
    expect(near(rl.b, [top.x, top.y, 0], 1e-9)).toBe(true)
    expect(rl.b.length).toBe(3)
    const again = f.project(rl.b)
    expect([again.x, again.y]).toEqual([rl.b[0], rl.b[1]])
    expect(f.project([1, 2, 3], '2d')).toMatchObject({ x: 1, y: 2, depth: 0 })
    // pin = the anchor's projection + the offset
    expect(near(f.world(pinned).p, [top.x, top.y + 0.4, 0], 1e-9)).toBe(true)
  })
  test('an arrow from a 2D object to a 3D part stops at the edge of what the part covers; the part moving moves it', () => {
    let part: any, tag: any, ar: any
    const m = build((s) => {
      s.viewport('right', 0.5)
      const x = s.param('x', { value: 0, min: -2, max: 2 })
      part = sphere({ id: 'ball', radius: 1 }).at(() => [x(), 0, 0])
      tag = text('ball').at(-5, 0)
      ar = arrow(tag, part)
    })
    expect(codes(m)).toEqual([])
    const tip = (v: number): Vec3 => { const f = m.state(0, { x: v }); return f.props(ar).b && exitPoint(ar, part, f, f.props(ar).a, 0.15) }
    const f = m.state(0)
    const r = f.frameRect(part)!
    // the arrow comes from the left: it ends 0.15 before the left edge of the ball's rectangle
    expect(tip(0)[0]).toBeCloseTo(r.x - 0.15, 6)
    expect(tip(2)[0]).not.toBeCloseTo(tip(0)[0], 2)
  })
  test('the other way round is reported: a 3D part cannot follow a 2D object', () => {
    const m = build((s) => { s.viewport('full'); const t = text('flat', { id: 'flat' }); box({ id: 'solid' }).at(t) })
    m.state(0).world(m.byId.get('solid')!)
    const d = m.diagnostics.list.find((x) => x.code === 'API-TYPE')!
    expect(d.ids).toEqual(['solid', 'flat'])
    expect(d.fix[0]).toContain('flat.pin(solid)')
  })
})

describe('finding 2: registries record their owner and refuse a second registration', () => {
  test('a second defineKind / setter / verb / step action / overlay / rule of the same name is a recorded conflict; the first stays', () => {
    const before = registryConflicts().length
    const first = defineKind({ name: 'hxOnce', space: '2d', schema: { width: { type: 'positive', default: 2 } }, bounds: (_n, r) => boxOf(r.width / 2, 1, 0) })
    const second = defineKind({ name: 'hxOnce', space: '2d', schema: { width: { type: 'positive', default: 2 } }, bounds: () => boxOf(9, 9, 0) })
    expect(second).toBe(first)
    let n: MNode
    const m = build(() => { n = first({ width: 4 }) })
    expect(m.state(0).bounds(n!).max[0]).toBe(2) // the first definition is in force
    defineSetter('2d', 'hxTint', () => ({ color: '#ff0000' }))
    defineSetter('2d', 'hxTint', () => ({ color: '#00ff00' }))
    defineVerb('hxVerb', () => anim('hxVerb', 1, () => {}))
    defineVerb('hxVerb', () => anim('hxVerb', 2, () => {}))
    defineStepAction('hxAct', () => {})
    defineStepAction('hxAct', () => {})
    defineOverlay({ name: 'hx.overlay', create: () => ({ paint() {} }) })
    defineOverlay({ name: 'hx.overlay', create: () => ({ paint() {} }) })
    defineRule({ code: 'HX-RULE', phase: 'static', run() {} })
    defineRule({ code: 'HX-RULE', phase: 'static', run() {} })
    const added = registryConflicts().slice(before)
    expect(added.map((c) => `${c.registry}:${c.name}`)).toEqual(['kind:hxOnce', 'setter:2d:hxTint', 'verb:hxVerb', 'stepAction:hxAct', 'overlay:hx.overlay', 'rule:HX-RULE'])
    for (const c of added) { expect(c.first).toBe('core/hardening.test.ts'); expect(c.second).toBe('core/hardening.test.ts') }
  })
  test('override: true replaces on purpose and is not a conflict; owners are recorded', () => {
    const before = registryConflicts().length
    defineKind({ name: 'hxSeed', space: '2d', schema: {}, bounds: () => boxOf(1, 1, 0) })
    const better = defineKind({ name: 'hxSeed', space: '2d', schema: {}, bounds: () => boxOf(3, 3, 0), override: true })
    let n: MNode
    const m = build(() => { n = better() })
    expect(m.state(0).bounds(n!).max[0]).toBe(3)
    defineKindBackend('hxSeed', { build: () => null })
    defineKindBackend('hxSeed', { build: () => null }, { override: true })
    expect(registryConflicts().length).toBe(before)
    expect(ownerOf('kind', 'rect')).toBe('r2d/kinds.ts')
    expect(ownerOf('stepAction', 'say')).toBe('guide/index.ts')
    expect(ownerOf('kind', 'box')).toBe('r3d/index.ts')
    expect(ownerOf('setter', '*:at')).toBe('core/setters.ts')
    // the same define* call running again (the same line) is the same registration, not a clash
    const again: boolean[] = []
    for (let i = 0; i < 2; i++) again.push(claim('hxRegistry', 'same-line'))
    expect(again).toEqual([true, true])
    expect(registryConflicts().length).toBe(before)
  })
})

describe('finding 4: overlays are laid out in a declared order', () => {
  test('`after` puts an overlay behind the ones it reads, whatever its z; a cycle is reported', () => {
    const mk = (name: string, z: number, after?: string[]) => ({ name, z, after, create: () => ({ paint() {} }) })
    const defs = [mk('a.marks', 5, ['c.caption', 'b.labels']), mk('b.labels', 10), mk('c.caption', 20)]
    expect(overlayLayoutOrder(defs).order.map((d) => d.name)).toEqual(['c.caption', 'b.labels', 'a.marks'])
    expect(overlayLayoutOrder(defs).cycles).toEqual([])
    const loop = overlayLayoutOrder([mk('x', 1, ['y']), mk('y', 2, ['x'])])
    expect(loop.cycles.length).toBe(1)
    expect(loop.order.map((d) => d.name).sort()).toEqual(['x', 'y'])
  })
})

describe('finding 5: composite kinds are first class', () => {
  const lamp = defineKind({
    name: 'hxLamp', space: '2d', schema: { size: { type: 'positive', default: 1 }, caption: { type: 'text', default: 'lamp' } },
    bounds: (_n, r) => boxOf(r.size, r.size, 0),
    // the caption is drawn by the kind itself, not by a text() child: the text rules learn about it here
    textRects: (_n, r) => [{ text: r.caption, rect: { x: -r.size, y: -r.size - 0.5, width: 2 * r.size, height: 0.4 } }],
    init(node, model) {
      model.child(node, 'bulb', circle, { radius: 0.4, id: 'ignored' })
      model.child(node, 'stand', rect, { width: 0.2, height: 1 }).at(0, -0.7)
    },
  })
  test('model.child names parts parent.child and leaves the counters alone', () => {
    let a: any, b: any, c1: any
    const m = build(() => { a = lamp(); b = lamp({ id: 'desk' }); c1 = circle() })
    expect(codes(m)).toEqual([])
    expect(a.children.map((c: MNode) => c.id)).toEqual(['hxLamp1.bulb', 'hxLamp1.stand'])
    expect(b.children.map((c: MNode) => c.id)).toEqual(['desk.bulb', 'desk.stand'])
    expect(c1.id).toBe('circle1') // the author's first circle is still circle1
    expect(m.byId.get('desk.bulb')!.parent).toBe(b)
    expect(m.state(0).world(m.byId.get('desk.stand')!).p).toEqual([0, -0.7, 0])
  })
  test('a style setter on an object without that option reaches the parts that have it, or is reported', () => {
    let l: any, g: any, t: any, a: any, b: any
    const m = build((s) => {
      l = lamp({ id: 'l' }).color('#FF0000')
      a = rect({ id: 'a' }); b = circle({ id: 'b' })
      g = group([a, b]).fill('#00FF00', 0.5)
      t = text('x', { id: 't' }).fill('#0000FF') // text has no fill, and nothing inside it
      s.step('tween', (st: any) => { st.play(g.to.color('#FFFF00'), { duration: 1, rate: linear }) })
    })
    const f = m.state(0)
    expect(f.prop(m.byId.get('l.bulb')!, 'color')).toBe('#FF0000')
    expect(f.prop(m.byId.get('l.stand')!, 'color')).toBe('#FF0000')
    expect([f.prop(a, 'fill'), f.prop(a, 'fillOpacity'), f.prop(b, 'fill')]).toEqual(['#00FF00', 0.5, '#00FF00'])
    expect(m.state(1).prop(a, 'color')).toBe('#FFFF00') // m.to on the group tweens its shapes
    expect(m.state(1).prop(b, 'color')).toBe('#FFFF00')
    const d = m.diagnostics.list
    expect(d.map((x) => x.code)).toEqual(['API-UNKNOWN'])
    expect(d[0]!.ids).toEqual(['t'])
    expect(d[0]!.what).toContain('has no fill')
    expect(d[0]!.fix[0]).toBe('a text has: opacity, text, size, color, weight, italic, font, align, backstroke, scaleWithZoom, dim, scale, shift, offset, z, rotate')
    void t
  })
  test('textRects: text a kind draws itself is located on screen (transform, 2D camera)', () => {
    let l: any
    const m = build((s) => {
      l = lamp({ size: 1, caption: 'RPM x1000' }).at(2, 1).scale(2)
      s.step('zoom', (st: any) => { st.zoom([2, 1], { zoom: 2, duration: 0 }) })
    })
    expect(spaceOf(l)).toBe('2d')
    // before the zoom clip (it is instant at t = 0, so sample a frame with the identity camera through a hud copy)
    const r = m.state(0).textRects(l)
    expect(r.length).toBe(1)
    expect(r[0]!.text).toBe('RPM x1000')
    // local box x −1..1, y −1.5..−1.1; scaled by 2 about (2, 1): x 0..4, y −2..−1.2; the camera centres (2, 1) and doubles it
    expect(near([r[0]!.rect.x, r[0]!.rect.y, r[0]!.rect.width, r[0]!.rect.height], [-4, -6, 8, 1.6], 1e-9)).toBe(true)
    expect(kindOf('text')!.text).toBe(true)
  })
})

describe('finding 7: one outline hook for 2D geometry', () => {
  test('edge exit points, pointAt and start / end come from the outline, for any kind', () => {
    const diamond = defineKind({
      name: 'hxDiamond', space: '2d', schema: { radius: { type: 'positive', default: 1 } },
      bounds: (_n, r) => boxOf(r.radius, r.radius, 0),
      outline: (_n, r) => {
        const p = [[r.radius, 0], [0, r.radius], [-r.radius, 0], [0, -r.radius], [r.radius, 0]]
        const coords = [p[0]![0]!, p[0]![1]!]
        for (let i = 1; i < p.length; i++) { const a = p[i - 1]!, b = p[i]!; coords.push(a[0]! + (b[0]! - a[0]!) / 3, a[1]! + (b[1]! - a[1]!) / 3, a[0]! + ((b[0]! - a[0]!) * 2) / 3, a[1]! + ((b[1]! - a[1]!) * 2) / 3, b[0]!, b[1]!) }
        return [{ coords, closed: true }]
      },
    })
    let d: any, c: any, r: any, toD: any, toC: any, toR: any, bent: any
    const m = build(() => {
      d = diamond({ radius: 1 }).at(4, 4)
      c = circle({ radius: 1 }).at(4, 0)
      r = rect({ width: 2, height: 2 }).at(4, -4)
      toD = line([0, 0], d, { buff: 0 }); toC = line([0, -4], c, { buff: 0 }); toR = line([0, -8], r, { buff: 0 })
      bent = line([0, 0], [4, 0], { bend: 90 })
    })
    const f = m.state(0)
    // along the diagonal a diamond is cut at |x| + |y| = 1: half a unit short of the centre on each axis
    expect(near(f.props(toD).b, [4, 4, 0], 1e-9)).toBe(true)
    expect(near(exitPoint(toD, d, f, [0, 0, 0], 0), [3.5, 3.5, 0], 1e-6)).toBe(true)
    // a circle is left at its radius, a square on its side: no kind names anywhere
    expect(near(exitPoint(toC, c, f, [0, -4, 0], 0), [4 - Math.SQRT1_2, -Math.SQRT1_2, 0], 2e-3)).toBe(true)
    expect(near(exitPoint(toR, r, f, [0, -8, 0], 0), [3, -5, 0], 1e-6)).toBe(true)
    // pointAt walks the outline by length: a quarter of a circle's outline is its top
    expect(near(pointOnOutline(c, f, 0.25).point, [4, 1, 0], 1e-3)).toBe(true)
    expect(near(f.run(() => d.pointAt(0.5)()), [3, 4, 0], 1e-9)).toBe(true)
    const mid = pointOnOutline(bent, f, 0.5)
    expect(mid.point[0]).toBeCloseTo(2, 6)
    expect(Math.abs(mid.tangentDeg)).toBeLessThan(1e-6)
    // start / end: the ends of an open outline, the left / right edge of a closed one
    expect(f.run(() => bent.start())).toEqual([0, 0, 0])
    expect(f.run(() => bent.end())).toEqual([4, 0, 0])
    expect(f.run(() => r.start())).toEqual([3, -4, 0])
    expect(f.run(() => r.end())).toEqual([5, -4, 0])
    // every node has an outline (the box when the kind gives none), in the coordinates it lives in
    expect(f.outline(d)[0]!.coords.slice(0, 2)).toEqual([5, 4])
    expect(f.outline(r)[0]!.closed).toBe(true)
  })
})

describe('finding 10: chapters, notes and the transcript', () => {
  test('s.chapter clears the stage except `keep`, resets the cameras, and groups the steps that follow', () => {
    let title: any, a: any, b: any, c: any, late: any
    const m = build((s) => {
      s.viewport('right', 0.5)
      title = text('How it works', { id: 'title' }).at(0, 3)
      s.chapter('Parts')
      a = rect({ id: 'a' }).at(-3, 0)
      b = box({ id: 'b' })
      s.step('one', (st: any) => { st.say('A [box](b) and a rectangle.'); st.note('Extra *depth* for read mode.'); st.wait(1) })
      s.step('two', (st: any) => { st.camera({ view: 'front' }); st.zoom(a); st.wait(1) })
      s.chapter('Motion', { keep: [title] })
      c = rect({ id: 'c' }).at(3, 0)
      late = text('late', { id: 'late' })
      s.step('three', (st: any) => { st.play(fadeIn(late)) })
      s.step('four', (st: any) => { st.wait(1) })
    })
    expect(codes(m)).toEqual([])
    expect(m.chapters.map((ch) => [ch.title, ch.firstStep, ch.clear])).toEqual([['Parts', 0, 0], ['Motion', 2, CHAPTER_CLEAR]])
    expect(m.steps.map((s) => s.chapter)).toEqual([0, 0, 1, 1])
    // chapter 1 opens at t = 0 with nothing to clear: its objects are there from the start
    expect(m.state(0).visible(a)).toBe(true)
    expect(m.state(0).visible(c)).toBe(false) // belongs to chapter 2 although it has no enter verb
    const t2 = m.steps[2]!.t0
    expect(m.state(t2 - 0.01).visible(a)).toBe(true)
    // after the clear: the old objects are gone, the kept one stays, the new chapter's objects are there
    const after = m.state(t2 + CHAPTER_CLEAR + 0.5)
    expect([after.visible(a), after.visible(b), after.visible(title), after.visible(c)]).toEqual([false, false, true, true])
    expect(after.reveal(c).p).toBe(1)
    expect(m.state(t2 + CHAPTER_CLEAR / 2).reveal(a).p).toBeGreaterThan(0)
    expect(m.state(t2 + CHAPTER_CLEAR / 2).reveal(a).p).toBeLessThan(1)
    // the step's own content starts after the clear
    expect(m.state(t2 + CHAPTER_CLEAR - 0.01).visible(late)).toBe(false)
    expect(m.state(end(m, 2)).visible(late)).toBe(true)
    // cameras: the 3D view that step two turned to the front is back to the default, the 2D zoom is back to the frame
    expect(m.state(end(m, 1)).camera().azimuth).toBe(0)
    expect(m.state(end(m, 1)).camera2d().zoom).toBeGreaterThan(1)
    expect(m.state(after.tau).camera().azimuth).toBe(35)
    expect(m.state(after.tau).camera2d()).toEqual({ center: [0, 0], zoom: 1 })
    // the transcript data: narration with its spans, notes
    expect(m.steps[0]!.narration.map((n) => [n.plain, n.spans])).toEqual([['A box and a rectangle.', [{ start: 2, end: 5, words: 'box', verb: 'point', targets: ['b'], options: [] }]]])
    expect(m.steps[0]!.notes).toEqual(['Extra *depth* for read mode.'])
  })
  test('misuse is reported: a chapter inside a step, a chapter without steps, an empty note', () => {
    const m = build((s) => {
      s.chapter('Empty')
      s.chapter('Real')
      s.step('x', (st: any) => { s.chapter('Inside'); st.note(''); st.wait(1) })
    })
    expect(codes(m)).toEqual(['API-TYPE', 'API-TYPE', 'API-TYPE'])
    expect(m.diagnostics.list.map((d) => d.what.slice(0, 26))).toEqual(['chapter "Empty" has no step', 's.chapter("Inside") was ca', 'st.note() expects markdown'].map((x) => x.slice(0, 26)))
    expect(m.steps[0]!.chapter).toBe(1)
  })
  test('defineFinalize runs before lifetimes are fixed; defineManifest adds a field', () => {
    let seen = 0
    defineFinalize('hx.finalize', (model) => {
      seen++
      // a hook can still record: hide everything tagged in the store until t = 1
      for (const n of model.store<MNode[]>('hx.later', () => [])) model.addClip({ target: n, prop: 'present', to: 1, t0: 1, t1: 1, rate: (t) => t, scope: 'persist', step: 0, src: n.src, seq: 0 })
    })
    defineManifest('hxCount', (model) => model.nodes.length)
    let a: any
    const m = build((s) => { a = rect(); s.model.store('hx.later', () => [a]); s.step('x', (st: any) => { st.wait(2) }) })
    expect(seen).toBe(1)
    expect(m.state(0.5).visible(a)).toBe(false)
    expect(m.state(1.5).visible(a)).toBe(true)
    expect(allFinalizers().map(([n]) => n)).toContain('hx.finalize')
    expect(allManifests().find(([k]) => k === 'hxCount')![1](m, null)).toBe(1)
  })
})

describe('finding 11: a 2D camera', () => {
  test('st.zoom folds into frame.camera2d(); project and frameRect use it; hud objects ignore it; null resets', () => {
    let a: any, hud: any, tag: any
    const m = build((s) => {
      a = rect({ id: 'a', width: 2, height: 1 }).at(3, 2)
      hud = text('fps', { id: 'hud' }).at(-6, 3.5).hud()
      tag = text('tag').nextTo(hud, 'right', 0.2) // a 2D object placed next to a hud one is on the screen too
      s.step('in', (st: any) => { st.zoom(a, { margin: 2, duration: 1, rate: linear }) })
      s.step('point', (st: any) => { st.zoom([1, 1], { zoom: 4, duration: 0 }) })
      s.step('out', (st: any) => { st.zoom(null, { duration: 0 }) })
    })
    expect(codes(m)).toEqual([])
    expect(m.state(0).camera2d()).toEqual({ center: [0, 0], zoom: 1 })
    // fit a 2 × 1 box with margin 2: zoom = min(14.2222 / 4, 8 / 2) = 3.5556
    const zoomed = m.state(end(m, 0))
    expect(zoomed.camera2d().center).toEqual([3, 2])
    expect(zoomed.camera2d().zoom).toBeCloseTo(FRAME_W / 4, 9)
    // half way: the centre moves linearly, the zoom geometrically
    const half = m.state(0.5).camera2d()
    expect(half.center).toEqual([1.5, 1])
    expect(half.zoom).toBeCloseTo(Math.sqrt(FRAME_W / 4), 9)
    // the object is in the middle of the screen and fills half of it
    expect(zoomed.project(a)).toMatchObject({ x: 0, y: 0, visible: true })
    const r = zoomed.frameRect(a)!
    expect(r.width).toBeCloseTo(FRAME_W / 2, 9)
    expect(near(zoomed.fromScreen(zoomed.toScreen([5, -1])), [5, -1, 0], 1e-12)).toBe(true)
    // hud: same place on screen whatever the camera does
    expect(spaceOf(hud)).toBe('hud')
    expect(zoomed.project(hud)).toMatchObject({ x: -6, y: 3.5 })
    expect(zoomed.frameRect(hud)).toEqual(m.state(0).frameRect(hud))
    // the tag is placed beside a screen-space object, so it lives on the screen as well: same gap, same size, zoomed or not
    const gap = (f: ReturnType<typeof m.state>): number => f.frameRect(tag)!.x - (f.frameRect(hud)!.x + f.frameRect(hud)!.width)
    expect(spaceOf(tag)).toBe('hud')
    expect(gap(m.state(0))).toBeCloseTo(0.2, 9)
    expect(gap(zoomed)).toBeCloseTo(0.2, 9)
    expect(zoomed.frameRect(tag)).toEqual(m.state(0).frameRect(tag))
    expect(m.state(end(m, 1)).camera2d()).toEqual({ center: [1, 1], zoom: 4 })
    expect(m.state(end(m, 2)).camera2d()).toEqual({ center: [0, 0], zoom: 1 })
    expect(m.camera2dClips().every((c) => c.target === CAMERA2D)).toBe(true)
  })
  test('st.zoom on a 3D part is reported with the 3D way to do it', () => {
    const m = build((s) => { const p = box({ id: 'p' }); s.step('x', (st: any) => { st.zoom(p) }) })
    expect(m.diagnostics.list.map((d) => [d.code, d.fix[0]])).toEqual([['API-TYPE', 'st.camera({ fit: [p] })']])
  })
})

describe('findings 13, 14, 16, 17', () => {
  test('13: a clip on a channel the target does not have is API-UNKNOWN with a did-you-mean, and records nothing', () => {
    let t: any
    const m = build((s) => {
      t = text('x', { id: 't' })
      s.step('x', (st: any) => { st.clip(t, 'opacty', 0.2, { duration: 1 }); st.clip(t, 'radius', 3, { duration: 1 }); st.clip(selector(() => true), 'dimm', 1); st.wait(1) })
    })
    expect(m.diagnostics.list.map((d) => [d.code, d.fix[0]])).toEqual([['API-UNKNOWN', 'use opacity'], ['API-UNKNOWN', expect.stringContaining('a text has:')], ['API-UNKNOWN', 'use "dim"']])
    expect(m.clipsFor(t, 'opacty')).toBeUndefined()
    expect(m.state(0.5).signature()).toBe(m.state(0).signature())
  })
  test('14: a function used as the target of a clip receives (node, frame), so one selector clip moves each node differently', () => {
    let a: any, b: any
    const got: unknown[][] = []
    const m = build((s) => {
      a = rect({ id: 'a' }).at(-2, 0); b = rect({ id: 'b' }).at(3, 0)
      s.step('explode', (st: any) => {
        // every object moves away from the origin by half its distance
        st.clip(selector(() => true), 'offset', (node: MNode, frame: any) => { got.push([node.id, typeof frame.tau]); const p = frame.world(node).p; return [p[0] * 0.5, 0, 0] }, { duration: 0 })
      })
    })
    const f = m.state(0.5)
    expect(f.prop(a, 'offset')).toEqual([-1, 0, 0])
    expect(f.prop(b, 'offset')).toEqual([1.5, 0, 0])
    expect(got.map((g) => g.join(':')).sort()).toEqual(['a:number', 'b:number'])
  })
  test('16: an exception inside the engine is reported at the line of the object it was drawing', () => {
    let a: any
    const m = build(() => { a = rect({ id: 'boom' }) })
    const e = new Error('cannot read x')
    e.stack = 'Error: cannot read x\n    at update (/Users/x/sideprojects/mimir/node_modules/three/build/three.core.js:10:5)'
    m.reportError(e, 'drawing #boom', { ids: ['boom'], t: 1 })
    const d = m.diagnostics.list[0]!
    expect(d.code).toBe('RUNTIME-ERROR')
    expect(d.line).toBe(a.src.line)
    expect(typeof d.line).toBe('number')
    expect(d.fix[0]).toContain('the rect created on this line could not be drawn')
  })
  test('17: interpolation per kind; array / record / object option types', () => {
    const k = defineKind({
      name: 'hxPoly', space: '2d', worldGeometry: true,
      schema: {
        points: { type: { array: 'point', min: 2 }, default: [] },
        labels: { type: { record: 'string' }, default: {} },
        ticks: { type: { object: { count: { type: 'int', default: 5 }, color: 'color' } }, default: {} },
        phase: { type: 'number', default: 0 },
      },
      bounds: () => boxOf(1, 1, 0),
    })
    const other = defineKind({ name: 'hxOther', space: '2d', schema: { phase: { type: 'number', default: 0 } }, bounds: () => boxOf(1, 1, 0) })
    defineInterp('hxPoly', 'phase', (a2: number, b2: number, u: number) => (u < 1 ? a2 : b2)) // steps at the end, for this kind only
    let p: any, o: any, anchor: any
    const m = build((s) => {
      anchor = rect().at(2, 3)
      p = k({ points: [[0, 0], anchor, anchor.top, () => [5, 5]], labels: { a: 'first' }, ticks: { count: 3 } })
      o = other()
      k({ id: 'short', points: [[0, 0]] })
      k({ id: 'badItem', points: [[0, 0], 'nope'] })
      k({ id: 'badRecord', labels: { a: 3 } })
      k({ id: 'badObject', ticks: { cuont: 3 } })
      s.step('x', (st: any) => { st.play(p.to.set({ phase: 10 }), o.to.set({ phase: 10 }), { duration: 1, rate: linear }) })
    })
    const f = m.state(0)
    expect(f.props(p).points).toEqual([[0, 0, 0], [2, 3, 0], [2, 3.5, 0], [5, 5, 0]])
    expect(f.props(p).labels).toEqual({ a: 'first' })
    expect(f.props(p).ticks).toEqual({ count: 3 })
    expect(m.diagnostics.list.map((d) => [d.ids[0], d.code])).toEqual([['short', 'API-TYPE'], ['badItem', 'REF-MISSING'], ['badRecord', 'API-TYPE'], ['badObject', 'API-UNKNOWN']])
    expect(m.diagnostics.list[0]!.what).toContain('needs at least 2 items')
    expect(m.diagnostics.list[3]!.fix[0]).toContain('"count"')
    expect(m.state(0.5).prop(p, 'phase')).toBe(0) // the kind's own blend
    expect(m.state(0.5).prop(o, 'phase')).toBe(5) // everyone else: linear
    const v = validateOptions('x()', { pts: [[1, 2]] }, { pts: { array: 'vec2' } }, undefined, m)
    expect(v.props.pts).toEqual([[1, 2]])
  })
})

describe('finding 8 (pure side): view modes are looks', () => {
  test('defineLook edits a part look when its channel is on for the scene or for that part', () => {
    defineLook('hxCut', (look, value: { at: number }, _node, _frame) => { look.clip.push({ normal: [-1, 0, 0], constant: value.at }) })
    defineLook('hxGhost', (look, amount: number) => { look.opacity *= 1 - 0.9 * amount; look.shell = look.shell || amount > 0.5 }, { rest: 0 })
    let a: any, b: any
    const m = build((s) => {
      s.viewport('full')
      a = box({ id: 'a', color: '#ff0000' }); b = box({ id: 'b', material: 'glass' }).at(3, 0, 0)
      s.model.view.hxCut = null
      s.step('cut', (st: any) => { st.clip(VIEW, 'hxCut', { at: 0.5 }, { duration: 0 }); st.clip(a, 'hxGhost', 1, { duration: 1, rate: linear }); st.wait(1) })
    })
    expect(codes(m)).toEqual([])
    const base = m.state(0)
    expect(m.state(0, {}).viewValue('hxCut')).toEqual({ at: 0.5 }) // instant at t = 0
    const before = build((s) => { s.viewport('full'); a = box({ color: '#ff0000' }) }).state(0).look(a)
    expect(before).toMatchObject({ color: '#ff0000', opacity: 1, shell: false, clip: [], dim: 0, edges: 1 })
    const la = m.state(0.5).look(m.byId.get('a')!), lb = m.state(0.5).look(m.byId.get('b')!)
    expect(la.clip).toEqual([{ normal: [-1, 0, 0], constant: 0.5 }]) // scene-level channel: every part
    expect(lb.clip.length).toBe(1)
    expect(la.opacity).toBeCloseTo(1 - 0.9 * 0.5, 9) // per-part channel: only a
    expect(lb.opacity).toBeCloseTo(0.2, 9) // glass, untouched by the ghost of a
    expect(lb.shell).toBe(true)
    expect(m.state(end(m, 0)).look(m.byId.get('a')!).shell).toBe(true)
    // a view mode changes what is seen: the signature knows
    expect(base.signature()).not.toBe(build((s) => { s.viewport('full'); box({ id: 'a', color: '#ff0000' }); box({ id: 'b', material: 'glass' }).at(3, 0, 0) }).state(0).signature())
  })
})

describe('finding 1 (pure side): kinds name the lazy chunk they need', () => {
  test('model.chunksNeeded lists exactly the chunks of the kinds in use, 3D first', () => {
    const tex = defineKind({ name: 'hxTex', space: '2d', chunk: 'hxmath', schema: {}, bounds: () => boxOf(1, 1, 0) })
    expect(build(() => { rect() }).chunksNeeded()).toEqual([])
    expect(build(() => { box() }).chunksNeeded()).toEqual(['3d'])
    expect(build(() => { tex(); box() }).chunksNeeded()).toEqual(['3d', 'hxmath'])
    expect(build((s) => { rect(); s.model.requireChunk('guide') }).chunksNeeded()).toEqual(['guide'])
    expect(kindOf('box')!.chunks).toEqual(['3d'])
    expect(kindOf('rect')!.chunks).toEqual([])
    // a 3D kind with a chunk of its own needs the 3D chunk as well, and first (finding E8: `chunk` used to replace '3d')
    const part = defineKind({ name: 'hxKitPart', space: '3d', chunk: 'hxkit', schema: {}, bounds: () => boxOf(1, 1, 1) })
    const both = defineKind({ name: 'hxKitBoth', space: '3d', chunk: ['hxkit', 'hxmath'], schema: {}, bounds: () => boxOf(1, 1, 1) })
    expect(kindOf('hxKitPart')!.chunks).toEqual(['3d', 'hxkit'])
    expect(build(() => { part() }).chunksNeeded()).toEqual(['3d', 'hxkit'])
    expect(build(() => { both() }).chunksNeeded()).toEqual(['3d', 'hxkit', 'hxmath'])
  })
})
