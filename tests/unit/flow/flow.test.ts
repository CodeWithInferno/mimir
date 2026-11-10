// The flow module (src/flow): the particle maths of the lazy chunk, the pure side of every kind (bounds, options,
// diagnostics) and the colour helpers. What is drawn is checked by shots of tests/unit/flow/scenes/*.scene.js.
import { describe, expect, test } from 'bun:test'
import { compile, kindOf, scene, type MNode, type SceneModel } from '../../../src/core/index.ts'
import '../../../src/anim/index.ts'
import '../../../src/guide/index.ts'
import { arrow, circle, rect } from '../../../src/r2d/index.ts'
import { between, box, cylinder, sphere, tube } from '../../../src/r3d/index.ts'
import { burst, burstProgress, colorScale, field, fillLevel, filledBox, filledSpan, flow, FLOW_DEFAULTS, gas, isRound, RAMPS, slots, trail, trailPoints } from '../../../src/flow/index.ts'
import '../../../src/flow/flow.chunk.ts'
import { burstParticles, curveThrough, fieldArrows, gasParticles, seedsFor, stream, toDisc, type StreamSpec } from '../../../src/flow/particles.ts'

const build = (fn: (s: any) => void): SceneModel => compile(scene({ title: 'flow test' }, fn))
const codes = (m: SceneModel): string[] => m.diagnostics.list.map((d) => d.code)
const spec = (over: Partial<StreamSpec> = {}): StreamSpec => ({ count: 40, seed: 1, time: 0, phase: null, speedAt: () => 1, spreadAt: () => 0, fade: 0, active: 1, samples: 96, round: false, ...over })
const state = (node: any, m: SceneModel, tau: number, params = {}): ReturnType<NonNullable<typeof slots.flowState>> => slots.flowState!(node as MNode, m.state(tau, params))

describe('curveThrough', () => {
  test('arc length, direction and a left normal in the plane', () => {
    const c = curveThrough([[0, 0, 0], [4, 0, 0], [4, 3, 0]])
    expect(c.length).toBe(7)
    expect(c.at(0.25).p).toEqual([1.75, 0, 0])
    expect(c.at(0.25).dir).toEqual([1, 0, 0])
    expect(c.at(0.25).side).toEqual([0, 1, 0]) // left of the direction of travel
    expect(c.at(1).p).toEqual([4, 3, 0])
    expect(c.at(1).side[0]).toBeCloseTo(-1, 12)
  })
  test('in space the frame never twists: side stays square to the direction and turns smoothly', () => {
    const pts = Array.from({ length: 60 }, (_, i) => [Math.cos(i * 0.2) * 2, i * 0.1, Math.sin(i * 0.2) * 2] as [number, number, number])
    const c = curveThrough(pts)
    let prev = c.at(0)
    for (let k = 1; k <= 200; k++) {
      const f = c.at(k / 200)
      expect(Math.abs(f.side[0] * f.dir[0] + f.side[1] * f.dir[1] + f.side[2] * f.dir[2])).toBeLessThan(1e-9)
      expect(Math.hypot(f.up[0], f.up[1], f.up[2])).toBeCloseTo(1, 9)
      expect(f.side[0] * prev.side[0] + f.side[1] * prev.side[1] + f.side[2] * prev.side[2]).toBeGreaterThan(0.95) // no flip
      prev = f
    }
  })
  test('degenerate input gives a curve of no length instead of NaN', () => {
    for (const pts of [[], [[1, 2, 3]], [[1, 1, 0], [1, 1, 0]], [[NaN, 0, 0], [0, 0, 0]]] as [number, number, number][][]) {
      const c = curveThrough(pts)
      expect(c.length).toBe(0)
      expect(c.at(0.5).p.every(Number.isFinite)).toBe(true)
    }
  })
})

describe('stream', () => {
  const line = curveThrough([[0, 0, 0], [10, 0, 0]])
  test('a particle is a function of (seed, phase): the same inputs give the same particles, in any order of asking', () => {
    const a = stream(line, spec({ time: 3.7, spreadAt: () => 0.5 })).particles
    stream(line, spec({ time: 99 }))
    stream(line, spec({ time: 0.1, count: 7 }))
    const b = stream(line, spec({ time: 3.7, spreadAt: () => 0.5 })).particles
    expect(b).toEqual(a)
    expect(a.length).toBe(40)
  })
  test('every particle moves at the speed asked for, and wraps to the start', () => {
    const dt = 0.01
    const a = stream(line, spec({ time: 2, speedAt: () => 2 })).particles, b = stream(line, spec({ time: 2 + dt, speedAt: () => 2 })).particles
    for (let i = 0; i < a.length; i++) {
      const moved = b[i]!.p[0] - a[i]!.p[0]
      expect(moved > 0 ? moved : moved + 10).toBeCloseTo(2 * dt, 9)
    }
    expect(stream(line, spec({ speedAt: () => 2 })).transit).toBeCloseTo(5, 9)
  })
  test('a speed that varies along the path: time through each part, and particles bunch up where it is slow', () => {
    // 1 unit/s over the first half, 4 units/s over the second (a narrower pipe)
    const speedAt = (u: number): number => (u < 0.5 ? 1 : 4)
    const s = stream(line, spec({ count: 2000, speedAt, samples: 400 }))
    expect(s.transit).toBeCloseTo(5 + 1.25, 1)
    const slow = s.particles.filter((p) => p.u < 0.5).length
    expect(slow / 2000).toBeCloseTo(0.8, 1) // 5 of 6.25 seconds are spent in the slow half
    for (const p of s.particles.slice(0, 50)) expect(p.speed).toBeCloseTo(p.u < 0.49 ? 1 : p.u > 0.51 ? 4 : p.speed, 6)
  })
  test('phase replaces speed × time; a stream that does not move stays where it is', () => {
    const still = stream(line, spec({ speedAt: () => 0, time: 50 })).particles
    expect(still).toEqual(stream(line, spec({ speedAt: () => 0, time: 0 })).particles)
    const half = stream(line, spec({ phase: 0.5, time: 123 })).particles, zero = stream(line, spec({ phase: 0 })).particles
    for (let i = 0; i < zero.length; i++) expect(Math.abs(Math.abs(half[i]!.p[0] - zero[i]!.p[0]) - 5)).toBeLessThan(1e-9)
  })
  test('spread keeps particles inside the band, evenly across it; a round stream fills a disc', () => {
    const flat = stream(line, spec({ count: 400, spreadAt: () => 0.5 })).particles
    expect(flat.every((p) => Math.abs(p.p[1]) <= 0.5 && p.p[2] === 0)).toBe(true)
    expect(flat.filter((p) => p.p[1] > 0).length).toBeGreaterThan(170)
    expect(flat.filter((p) => p.p[1] > 0).length).toBeLessThan(230)
    const round = stream(curveThrough([[0, 0, 0], [0, 10, 0]]), spec({ count: 400, spreadAt: () => 0.5, round: true })).particles
    expect(round.every((p) => Math.hypot(p.p[0], p.p[2]) <= 0.5 + 1e-9)).toBe(true)
    expect(round.some((p) => Math.abs(p.p[2]) > 0.3)).toBe(true)
  })
  test('where the stream narrows the particles really move inwards (the tail points along the lane, not the axis)', () => {
    const s = stream(line, spec({ count: 300, spreadAt: (u) => 1 - 0.8 * u })).particles
    const upper = s.filter((p) => p.p[1] > 0.2 && p.u > 0.1 && p.u < 0.9)
    expect(upper.length).toBeGreaterThan(20)
    expect(upper.every((p) => p.dir[0] > 0 && p.dir[1] < 0)).toBe(true)
  })
  test('single file is evenly spaced; particles fade at the ends of an open path and not on a closed one', () => {
    const file = stream(line, spec({ count: 10 })).particles.map((p) => p.p[0]).sort((x, y) => x - y)
    for (let i = 1; i < file.length; i++) expect(file[i]! - file[i - 1]!).toBeGreaterThan(0.6)
    const open = stream(line, spec({ count: 200, fade: 0.1 })).particles
    expect(open.filter((p) => p.u < 0.02).every((p) => p.alpha < 0.2)).toBe(true)
    expect(open.filter((p) => p.u > 0.2 && p.u < 0.8).every((p) => p.alpha === 1)).toBe(true)
    const ring = curveThrough([[1, 0, 0], [0, 1, 0], [-1, 0, 0], [0, -1, 0]], true)
    expect(ring.closed).toBe(true)
    expect(stream(ring, spec({ fade: 0.1, active: 0.5 })).particles.every((p) => p.alpha === 0.5)).toBe(true)
  })
  test('seeds: the same seed is the same pattern, another seed another, and the pattern is even', () => {
    expect(seedsFor(3, 50)).toEqual(seedsFor(3, 50))
    expect(seedsFor(3, 50)[0]).not.toEqual(seedsFor(4, 50)[0])
    // 400 points in a 4 × 4 grid of the unit square: every cell gets its share (25) within a few
    const cells = new Array<number>(16).fill(0)
    for (const s of seedsFor('even', 400)) cells[Math.floor(s.offset * 4) * 4 + Math.floor(s.lane * 4)]!++
    expect(Math.min(...cells)).toBeGreaterThan(17)
    expect(Math.max(...cells)).toBeLessThan(33)
    expect(seedsFor(1, -5)).toEqual([])
    expect(seedsFor(1, NaN)).toEqual([])
    const [x, y] = toDisc(1, 1)
    expect(Math.hypot(x, y)).toBeCloseTo(1, 12)
  })
})

describe('burst, gas and field maths', () => {
  test('a burst flies out, slows, fades; a cone keeps it within its angle', () => {
    const at = (progress: number) => burstParticles({ count: 30, seed: 1, progress, radius: 2, round: false, direction: null, cone: 360 })
    const reach = (p: number): number => Math.max(...at(p).map((s) => Math.hypot(s.p[0], s.p[1])))
    expect(reach(0)).toBe(0)
    expect(reach(0.3)).toBeGreaterThan(reach(0.1))
    expect(reach(0.3) - reach(0.2)).toBeGreaterThan(reach(0.9) - reach(0.8)) // slowing down
    expect(reach(1)).toBeCloseTo(2, 1)
    expect(at(0.5)[0]!.alpha).toBeGreaterThan(at(0.95)[0]!.alpha)
    const aimed = burstParticles({ count: 60, seed: 1, progress: 0.5, radius: 1, round: true, direction: [0, 1, 0], cone: 60 })
    expect(aimed.every((s) => s.dir[1] >= Math.cos((30 * Math.PI) / 180) - 1e-9)).toBe(true)
    const flat = burstParticles({ count: 60, seed: 1, progress: 0.5, radius: 1, round: false, direction: [1, 0, 0], cone: 90 })
    expect(flat.every((s) => s.dir[0] >= Math.cos(Math.PI / 4) - 1e-9 && s.dir[2] === 0)).toBe(true)
  })
  test('gas particles stay inside the volume and are squeezed with it', () => {
    const tall = gasParticles({ count: 80, seed: 2, time: 1.3, half: [1, 2, 1], round: true, agitation: 0.1 })
    expect(tall.every((p) => Math.hypot(p[0], p[2]) <= 1 + 1e-9 && Math.abs(p[1]) <= 2)).toBe(true)
    const short = gasParticles({ count: 80, seed: 2, time: 1.3, half: [1, 0.5, 1], round: true, agitation: 0.1 })
    for (let i = 0; i < 80; i++) { expect(short[i]![1]).toBeCloseTo(tall[i]![1] / 4, 12); expect(short[i]![0]).toBe(tall[i]![0]) }
    expect(gasParticles({ count: 80, seed: 2, time: 1.4, half: [1, 2, 1], round: true, agitation: 0.1 })).not.toEqual(tall)
    expect(gasParticles({ count: 80, seed: 2, time: 9, half: [1, 2, 1], round: false, agitation: 0 })).toEqual(gasParticles({ count: 80, seed: 2, time: 0, half: [1, 2, 1], round: false, agitation: 0 }))
  })
  test('field arrows: one per cell, the strongest fills its cell, a scale gives real lengths', () => {
    const arrows = fieldArrows({ x: 0, y: 0, width: 4, height: 2, density: 1, scale: null, reach: 0.8, vector: (x) => [x, 0] })
    expect(arrows.length).toBe(8)
    expect(Math.max(...arrows.map((a) => a.dx))).toBeCloseTo(0.8, 12)
    expect(arrows.find((a) => a.x === 0.5)!.strength).toBeCloseTo(0.5 / 3.5, 12)
    const scaled = fieldArrows({ x: 0, y: 0, width: 4, height: 2, density: 1, scale: 0.1, reach: 0.8, vector: () => [3, 4] })
    expect(Math.hypot(scaled[0]!.dx, scaled[0]!.dy)).toBeCloseTo(0.5, 12)
    expect(fieldArrows({ x: 0, y: 0, width: 2, height: 2, density: 1, scale: null, reach: 0.8, vector: () => null }).every((a) => a.dx === 0 && a.dy === 0)).toBe(true)
  })
})

describe('flow()', () => {
  test('2D from points, 3D from points with z or from a part; the kind names its chunks', () => {
    let a: any, b: any, c: any, d: any
    const m = build((s) => {
      s.viewport('right', 0.5)
      a = flow([[-3, 0], [3, 0]], { count: 12 })
      b = flow([[0, 0, 0], [0, 2, 0]], { count: 12 })
      const pipe = tube({ radius: 0.5, height: 4 }).rotate({ about: 'z', deg: 90 })
      c = flow(pipe)
      d = flow(arrow([-3, 2], [3, 2]))
    })
    expect(codes(m)).toEqual([])
    expect([a.kind, b.kind, c.kind, d.kind]).toEqual(['flow', 'flow3d', 'flow3d', 'flow'])
    expect(kindOf('flow')!.chunks).toEqual(['flow'])
    expect(kindOf('flow3d')!.chunks).toEqual(['3d', 'flow', 'flow3d'])
    expect(m.chunksNeeded()).toEqual(['3d', 'flow', 'flow3d'])
    // along the tube's axis, turned to x
    const ps = state(c, m, 0).particles
    expect(ps.length).toBe(FLOW_DEFAULTS.count)
    expect(ps.every((p) => Math.abs(p.p[1]) < 1e-9 && Math.abs(p.p[0]) <= 2 + 1e-9)).toBe(true)
  })
  test('bounds hold the path plus the widest spread; functions of the position along the path are called with it', () => {
    let f: any
    const seen: number[] = []
    const m = build(() => {
      f = flow([[-3, 0], [3, 0]], { size: 0.1, spread: (along: number) => { seen.push(along); return 0.2 + 0.6 * along }, speed: (along: number) => 1 + along, color: (along: number) => (along < 0.5 ? '#FF0000' : '#00FF00') })
    })
    expect(codes(m)).toEqual([])
    const b = m.state(0).bounds(f)
    expect(b.min[0]).toBeCloseTo(-3.9, 9)
    expect(b.max[1]).toBeCloseTo(0.9, 9)
    const st = state(f, m, 1)
    expect(st.colorAt(0.2)).toBe('#FF0000')
    expect(st.colorAt(0.8)).toBe('#00FF00')
    expect(st.length).toBe(6)
    expect(seen.every((u) => u >= 0 && u <= 1)).toBe(true)
  })
  test('the same story time gives the same particles after any history, with a param pinned or not', () => {
    let f: any, rate: any
    const m = build((s) => {
      rate = s.param('rate', { value: 1, min: 0, max: 3 })
      f = flow([[-3, 0], [3, 0]], { count: 30, speed: () => rate(), spread: 0.3 })
      s.step('one', (st: any) => { st.wait(3) })
      s.step('two', (st: any) => { st.set(rate, 3); st.wait(3) })
    })
    const first = [5.2, 0.4, 2.9].map((t) => state(f, m, t).particles)
    state(f, m, 6, { rate: 0 })
    const again = [2.9, 0.4, 5.2].map((t) => state(f, m, t).particles)
    expect(again[0]).toEqual(first[2])
    expect(again[1]).toEqual(first[1])
    expect(again[2]).toEqual(first[0])
    // time moves it, and so does the param: both are visible in the frame's signature (what check compares)
    expect(m.state(1).signature()).not.toBe(m.state(1.5).signature())
    expect(m.state(1, { rate: 0 }).signature()).not.toBe(m.state(1, { rate: 2 }).signature())
  })
  test('a 2D flow along a closed shape goes round it; active fades it', () => {
    let f: any, on: any
    const m = build((s) => {
      on = s.toggle('on', { value: true })
      f = flow(circle({ radius: 2 }).at(1, 1), { count: 16, active: () => on() })
    })
    const st = state(f, m, 0.5)
    expect(st.length).toBeCloseTo(2 * Math.PI * 2, 1)
    expect(st.particles.every((p) => Math.abs(Math.hypot(p.p[0] - 1, p.p[1] - 1) - 2) < 0.01 && p.alpha === 1)).toBe(true)
    expect(state(f, m, 0.5, { on: false }).particles.every((p) => p.alpha === 0)).toBe(true)
  })
  test('bad input is a diagnostic and an inert object, never an exception', () => {
    let a: any, b: any, c: any, d: any
    const m = build(() => {
      a = (flow as any)()
      b = flow([[0, 0]] as any, { cuont: 3 } as any)
      c = flow([[0, 0], [1, 1]], { count: 'many' as any, speed: () => NaN, spread: () => { throw new Error('no') }, color: () => 42 as any })
      d = (flow as any)(7, 8)
    })
    for (const n of [a, b, c, d]) { expect(typeof n.id).toBe('string'); expect(() => m.state(1).bounds(n)).not.toThrow() }
    expect(state(c, m, 1).particles.length).toBe(FLOW_DEFAULTS.count)
    expect(state(c, m, 1).colorAt(0.5)).toBe('#FF3B30') // drawn in the colour of mistakes
    expect(state(a, m, 1).particles.every((p) => p.p.every(Number.isFinite))).toBe(true)
    expect(codes(m)).toContain('API-TYPE')
    expect(codes(m)).toContain('API-UNKNOWN')
    expect(codes(m)).toContain('RUNTIME-ERROR')
    // the message names the function the author called and the options an author can pass, not the kinds behind it
    const typo = m.diagnostics.byCode('API-UNKNOWN')[0]!
    expect(typo.what).toBe('flow() has no option "cuont".')
    expect(typo.fix[0]).toContain('use "count"')
    expect(typo.fix[0]).not.toMatch(/speedAlong|state|target/)
    expect(m.diagnostics.list.every((x) => !/flow3d\(|fill3d\(|burst3d\(/.test(x.what) && x.line !== null)).toBe(true)
    expect(m.diagnostics.list.find((x) => x.what.includes('needs a path'))).toBeDefined()
  })
})

describe('burst(), trail(), field()', () => {
  test('a burst fires at each time in `when`, or follows `progress`', () => {
    expect(burstProgress({ when: [1, 4], time: 0.5, duration: 1, progress: null })).toBeNull()
    expect(burstProgress({ when: [1, 4], time: 1.25, duration: 1, progress: null })).toBeCloseTo(0.25, 12)
    expect(burstProgress({ when: [1, 4], time: 2.5, duration: 1, progress: null })).toBeNull()
    expect(burstProgress({ when: [1, 4], time: 4.5, duration: 1, progress: null })).toBeCloseTo(0.5, 12)
    expect(burstProgress({ when: 2, time: 2, duration: 0.5, progress: null })).toBe(0)
    expect(burstProgress({ when: null, time: 9, duration: 1, progress: 0.4 })).toBe(0.4)
    expect(burstProgress({ when: null, time: 9, duration: 1, progress: 1.2 })).toBeNull()
  })
  test('2D or 3D by its point; a burst that can never fire is reported', () => {
    let a: any, b: any
    const m = build((s) => {
      s.viewport('right', 0.5)
      a = burst([1, 2], { when: () => 2, direction: [1, 0] })
      b = burst(sphere({ radius: 1 }), { when: [1, 2] })
      burst([0, 0])
      burst([0, 0], { when: 'soon' as any })
    })
    expect([a.kind, b.kind]).toEqual(['burst', 'burst3d'])
    expect(codes(m)).toEqual(['API-TYPE', 'API-TYPE'])
    expect(m.state(0).bounds(a).max[0]).toBeGreaterThan(2)
  })
  test('a trail is the points of the last `duration` seconds on a fixed grid, so old points do not move', () => {
    let t2: any, t3: any
    const m = build((s) => {
      s.viewport('right', 0.5)
      t2 = trail((t: number) => [t, 2 * t], { duration: 1, every: 0.1 })
      t3 = trail((t: number) => [t, 0, t], { every: 0.25 })
      s.step('run', (st: any) => { st.wait(5) })
    })
    expect(codes(m)).toEqual([])
    expect([t2.kind, t3.kind]).toEqual(['trail', 'trail3d'])
    const a = trailPoints(t2, m.state(2.03)), b = trailPoints(t2, m.state(2.07))
    expect(a[0]![0]).toBeCloseTo(1.03, 9) // the oldest point is exactly `duration` ago …
    expect(a[a.length - 1]![0]).toBeCloseTo(2.03, 9) // … the newest is now …
    expect(a.slice(1, -1).map((p) => p[0].toFixed(6))).toEqual(b.slice(1, -1).map((p) => p[0].toFixed(6))) // … and those between sit on the grid
    expect(trailPoints(t3, m.state(1))[0]).toEqual([0, 0, 0])
    expect(m.state(2).bounds(t2).max[1]).toBeCloseTo(4, 1)
    expect(m.state(1).signature()).not.toBe(m.state(2).signature())
  })
  test('diagnostics of every effect name the public function, whichever kind is behind it', () => {
    const m = build((s) => {
      s.viewport('right', 0.5)
      burst([0, 0, 0], { when: 1, colr: 'red' } as any)
      trail((t: number) => [t, 0, 0], { duraton: 2 } as any)
      fillLevel(box({}), { levle: 1 } as any)
      fillLevel('nothing')
      gas(sphere({}), 3 as any)
      ;(trail as any)()
    })
    const whats = m.diagnostics.list.map((d) => d.what)
    expect(whats).toContain('burst() has no option "colr".')
    expect(whats).toContain('trail() has no option "duraton".')
    expect(whats).toContain('fillLevel() has no option "levle".')
    expect(whats.find((w) => w.startsWith('fillLevel(): "nothing"'))).toBeDefined()
    expect(whats.find((w) => w.startsWith('gas() expects an options object'))).toBeDefined()
    expect(whats.find((w) => w.startsWith('trail() needs a function'))).toBeDefined()
    expect(m.diagnostics.list.every((d) => d.fix.length > 0 && d.line !== null)).toBe(true)
  })
  test('a field needs a function and a region; a param read only by the field still changes the signature', () => {
    let f: any
    const m = build((s) => {
      const k = s.param('k', { value: 1, min: -1, max: 1 })
      f = field((x: number, y: number) => [-y * k(), x * k()], { region: { x: -2, y: -1, width: 4, height: 2 }, color: (strength: number) => (strength > 0.5 ? '#FFFF00' : '#58C4DD') })
      field((x: number) => [x, 0], { region: 'everywhere' as any })
      ;(field as any)('wind')
    })
    expect(codes(m)).toEqual(['API-TYPE', 'API-TYPE'])
    expect(m.state(0).bounds(f)).toEqual({ min: [-2, -1, 0], max: [2, 1, 0] })
    expect(m.state(0, { k: 1 }).signature()).not.toBe(m.state(0, { k: -1 }).signature())
  })
})

describe('fillLevel() and gas()', () => {
  test('a 2D shape fills from a side; the level is clamped', () => {
    const b = { min: [0, 0, 0] as [number, number, number], max: [4, 2, 0] as [number, number, number] }
    expect(filledBox(b, 0.25, 'bottom').max[1]).toBe(0.5)
    expect(filledBox(b, 0.25, 'top').min[1]).toBe(1.5)
    expect(filledBox(b, 0.25, 'left').max[0]).toBe(1)
    expect(filledBox(b, 0.25, 'right').min[0]).toBe(3)
    expect(filledBox(b, 7, 'bottom')).toEqual(b)
    expect(filledBox(b, NaN, 'bottom').max[1]).toBe(0)
    let fill: any
    const m = build((s) => {
      const level = s.param('level', { value: 0.5, min: 0, max: 1 })
      fill = fillLevel(rect({ width: 2, height: 4 }).at(1, 1), { level, opacity: 0.3 })
    })
    expect(codes(m)).toEqual([])
    expect(fill.kind).toBe('fill')
    expect(m.state(0).bounds(fill)).toEqual({ min: [0, -1, 0], max: [2, 1, 0] })
    expect(m.state(0, { level: 1 }).bounds(fill).max[1]).toBe(3)
    expect(m.state(0).prop(fill, 'fillOpacity')).toBe(0.3)
  })
  test('a 3D part gets a liquid inside its walls, round when the part is round', () => {
    let liquid: any, tank: any, drum: any
    const m = build(() => {
      tank = box({ width: 2, height: 4, depth: 2 }).at(0, 2, 0)
      drum = cylinder({ radius: 1, height: 2 })
      liquid = fillLevel(tank, { level: 0.5, inset: 0 })
      fillLevel(drum, { level: 0.2 })
    })
    expect(codes(m)).toEqual([])
    expect(liquid.kind).toBe('fill3d')
    const f = m.state(0)
    expect(f.bounds(liquid)).toEqual({ min: [-1, 0, -1], max: [1, 2, 1] })
    expect(isRound(tank, f)).toBe(false)
    expect(isRound(drum, f)).toBe(true)
  })
  test('gas turns the volume into a body whose colour is its temperature and whose opacity is its density', () => {
    let chamber: any, g: any
    const m = build((s) => {
      const squeeze = s.param('squeeze', { value: 0, min: 0, max: 1 })
      const lid = cylinder({ radius: 1, height: 0.2 }).at(0, 3, 0)
      const piston = cylinder({ radius: 1, height: 0.2 }).at(0, () => 2 * squeeze(), 0)
      chamber = between(piston.anchor('top'), lid.anchor('bottom'), { radius: 1 })
      g = gas(chamber, { density: () => 0.2 + 0.8 * squeeze(), temperature: () => squeeze() })
      gas(rect({ width: 1, height: 1 }) as any)
      gas(box({}), { ramp: 'plasma' as any })
    })
    expect(codes(m)).toEqual(['API-TYPE', 'API-UNKNOWN'])
    const cold = m.state(0, { squeeze: 0 }), hot = m.state(0, { squeeze: 1 })
    expect((cold.prop(chamber, 'color') as string).toUpperCase()).toBe(RAMPS.temperature![0]!)
    expect((hot.prop(chamber, 'color') as string).toUpperCase()).toBe(RAMPS.temperature![4]!.toUpperCase())
    expect(hot.look(chamber).opacity).toBeGreaterThan(cold.look(chamber).opacity)
    expect(hot.look(chamber).shell).toBe(true)
    // the cloud covers the volume, and the volume shrinks
    expect(cold.bounds(g).max[1] - cold.bounds(g).min[1]).toBeCloseTo(2.8, 9)
    expect(hot.bounds(g).max[1] - hot.bounds(g).min[1]).toBeCloseTo(0.8, 9)
    expect(isRound(chamber, cold)).toBe(true)
  })
})

describe('colour by scalar', () => {
  test('colorScale maps real units through a named ramp and clamps', () => {
    let heat: any, own: any, bad: any, flat: any
    const m = build(() => {
      heat = colorScale('temperature', { min: 300, max: 2300 })
      own = colorScale(['#000000', '#FFFFFF'])
      bad = colorScale('rainbow' as any, { mx: 3 } as any)
      flat = colorScale('speed', { min: 2, max: 2 })
    })
    expect(heat(300).toUpperCase()).toBe(RAMPS.temperature![0]!)
    expect(heat(-50).toUpperCase()).toBe(RAMPS.temperature![0]!)
    expect(heat(9999).toUpperCase()).toBe(RAMPS.temperature![4]!.toUpperCase())
    expect(heat(1300).toUpperCase()).toBe(RAMPS.temperature![2]!.toUpperCase())
    expect(own(0.5)).toBe('#b4b4b4') // squared-RGB mix, like mix()
    expect(typeof bad(0.5)).toBe('string')
    expect(typeof flat(2)).toBe('string')
    expect(heat(NaN).toUpperCase()).toBe(RAMPS.temperature![0]!)
    expect(codes(m)).toEqual(['API-UNKNOWN', 'API-UNKNOWN', 'NUM-INVALID'])
  })
})

describe('a volume that follows a moving part', () => {
  const press = (story?: (s: any, p: any) => void) => {
    const p: any = {}
    const m = build((s) => {
      p.up = s.param('up', { value: 0, min: 0, max: 1 })
      p.housing = tube({ id: 'housing', radius: 1, thickness: 0.1, height: 4 })
      p.piston = cylinder({ id: 'piston', radius: 0.85, height: 0.4 }).at(0, () => -1 + 2 * p.up(), 0)
      p.above = fillLevel(p.housing, { id: 'above', from: p.piston.anchor('top'), inset: 0 })
      p.below = fillLevel(p.housing, { id: 'below', to: p.piston.anchor('bottom'), inset: 0, role: 'fluid' })
      if (story) story(s, p); else s.step('rise', (st: any) => { st.set(p.up, 1) })
    })
    return { m, p }
  }
  test('fillLevel(housing, { from }) fills from a part to the top, { to } from the bottom up to a part, and both follow it', () => {
    const { m, p } = press()
    expect(codes(m)).toEqual([])
    const clear = FLOW_DEFAULTS.fillClear * 2 // of the smallest inside (the bore, 2 wide)
    for (const up of [0, 0.25, 0.5, 1]) {
      const f = m.state(0, { up })
      const top = -1 + 2 * up + 0.2, bottom = -1 + 2 * up - 0.2
      const a = f.bounds(p.above), b = f.bounds(p.below)
      expect(a.min[1]).toBeCloseTo(top + clear, 9) // just off the crown: the two faces never share a pixel
      expect(a.max[1]).toBeCloseTo(2, 9)
      expect(b.min[1]).toBeCloseTo(-2, 9)
      expect(b.max[1]).toBeCloseTo(bottom - clear, 9)
      expect(filledSpan(p.housing, f, { level: 0.5, inset: 0, from: [0, top, 0] }).min[1]).toBeCloseTo(top + clear, 9)
    }
    // a point outside the housing gives an empty volume, never a negative one
    const out = filledSpan(p.housing, m.state(0), { level: 1, inset: 0, from: [0, 9, 0] })
    expect(out.max[1] - out.min[1]).toBe(0)
    // without from / to it is the level it always was
    expect(filledSpan(p.housing, m.state(0), { level: 0.25, inset: 0 }).max[1]).toBeCloseTo(-1, 9)
  })
  test('pulled apart, the liquid stays in its housing and keeps the height it has in the mechanism', () => {
    const { m, p } = press((s, q) => { q.piston.explode({ axis: 'up', distance: 5 }); q.housing.explode({ axis: 'right', distance: 3 }); s.step('apart', (st: any) => { st.explode(1) }) })
    expect(codes(m)).toEqual([])
    const f = m.state(m.steps[0]!.t1)
    expect(f.world(p.piston).p[1]).toBeCloseTo(4, 6) // the piston has left
    const b = f.bounds(p.below)
    expect(b.max[1] - b.min[1]).toBeCloseTo(0.8 - FLOW_DEFAULTS.fillClear * 2, 6) // not stretched after it
    expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(3, 6) // moved with the housing
    expect(f.world(p.below).p).toEqual([0, 0, 0]) // no push of its own
  })
  test('gas() of such a volume: round like its housing, a fluid in the 3D look, brighter as it gets hot and dense', () => {
    let heat: any, charge: any, cloud: any, housing: any
    const m = build((s) => {
      heat = s.param('heat', { value: 0, min: 0, max: 1 })
      housing = tube({ id: 'housing', radius: 1, thickness: 0.1, height: 4 })
      const piston = cylinder({ id: 'piston', radius: 0.85, height: 0.4 }).at(0, -1, 0)
      charge = fillLevel(housing, { id: 'charge', from: piston.anchor('top') })
      cloud = gas(charge, { id: 'cloud', temperature: heat, density: heat })
      s.step('x', (st: any) => { st.wait(1) })
    })
    expect(codes(m)).toEqual([])
    const cold = m.state(0, { heat: 0 }), hot = m.state(0, { heat: 1 })
    expect(isRound(charge, cold)).toBe(true)
    expect(cold.prop(charge, 'role')).toBe('fluid')
    expect(cold.prop<number>(charge, 'energy')).toBeCloseTo(FLOW_DEFAULTS.gasEnergy[0], 9)
    expect(hot.prop<number>(charge, 'energy')).toBeCloseTo(FLOW_DEFAULTS.gasEnergy[1], 9)
    expect(cloud.placement?.type).toBe('flow.inside')
  })
})
