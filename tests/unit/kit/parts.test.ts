// Kit parts, pure side: every kind is registered for the lazy chunk, sized by its options, anchored where the
// mechanisms expect, solid where it claims to be, and what the backend draws stays inside the box the linter is told.
import { describe, expect, test } from 'bun:test'
import { compile, kindOf, scene, type Frame, type MNode, type SceneModel, type Vec3 } from '../../../src/core/index.ts'
import { box } from '../../../src/r3d/index.ts'
import { kit, KIT, camShape, conRodDims, gearDims, pistonDims } from '../../../src/kit/index.ts'
import { soups } from '../../../src/kit/kit.chunk.ts'
import type { Soup } from '../../../src/kit/geometry.ts'
import { meshData, meshIsClosed, meshVolume } from '../../../src/lib/solids/mesh.ts'

const build = (fn: (s: any) => void): SceneModel => compile(scene({ title: 'kit parts' }, fn))
const codes = (m: SceneModel): string[] => m.diagnostics.list.map((d) => d.code)
const sdf = (f: Frame, n: MNode, p: Vec3): number => kindOf(n.kind)!.sdf!(n, f.props(n), p)
/** indexed mesh of a soup: vertices at the same place are one vertex */
function weld(s: Soup) {
  const at = new Map<string, number>(), pos: number[] = [], idx: number[] = []
  let size = 0
  for (const v of s) size = Math.max(size, Math.abs(v))
  const grid = 1 / (size * 1e-6)
  for (let i = 0; i < s.length; i += 3) {
    const key = `${Math.round(s[i]! * grid)},${Math.round(s[i + 1]! * grid)},${Math.round(s[i + 2]! * grid)}`
    let j = at.get(key)
    if (j === undefined) { j = pos.length / 3; at.set(key, j); pos.push(s[i]!, s[i + 1]!, s[i + 2]!) }
    idx.push(j)
  }
  const tris: number[] = []
  for (let i = 0; i < idx.length; i += 3) if (idx[i] !== idx[i + 1] && idx[i + 1] !== idx[i + 2] && idx[i] !== idx[i + 2]) tris.push(idx[i]!, idx[i + 1]!, idx[i + 2]!)
  return meshData(pos, tris)
}

const ALL = ['gear', 'rack', 'shaft', 'bearing', 'spring', 'coil', 'piston', 'conRod', 'crankshaft', 'valve', 'cam', 'camshaft', 'pulley', 'flywheel', 'fan', 'pipe', 'bolt', 'liner', 'block', 'belt']
/** one of every part, at its defaults and with every option that changes its shape */
const variants = (): Record<string, any[]> => ({
  gear: [kit.gear(), kit.gear({ teeth: 31, module: 0.2, bore: 0.6, hub: 1.4, hubWidth: 1.2 }), kit.gear({ teeth: 40, internal: true, rim: 0.4 })],
  rack: [kit.rack(), kit.rack({ teeth: 5, module: 0.5, height: 0.2 })],
  shaft: [kit.shaft(), kit.shaft({ radius: 1, length: 0.5 })],
  spring: [kit.spring(), kit.spring({ length: 0.7, turns: 3.5, wire: 0.15 })],
  coil: [kit.coil(), kit.coil({ leads: 0, turns: 4 })],
  piston: [kit.piston(), kit.piston({ bore: 1.72, crown: 0.15, rings: 2 }), kit.piston({ crown: -0.12, height: 2.2, pinHeight: 0.9 })],
  conRod: [kit.conRod(), kit.conRod({ length: 1.2, bigEnd: 0.9, smallEnd: 0.6, thickness: 0.2 })],
  crankshaft: [kit.crankshaft(), kit.crankshaft({ throw: 0.4, counterweight: 0 }), kit.crankshaft({ throw: 2, length: 6 }), kit.crankshaft({ overhung: true })],
  valve: [kit.valve(), kit.valve({ head: 2, length: 3, stem: 0.5 })],
  cam: [kit.cam(), kit.cam({ bore: 0.3, lift: 0.3, baseRadius: 0.6, duration: 150 })],
  camshaft: [kit.camshaft(), kit.camshaft({ lobes: [{ offset: 0, angle: 45 }], length: 2 })],
  pulley: [kit.pulley(), kit.pulley({ bore: 0.4, holes: 0 }), kit.pulley({ radius: 0.3, width: 0.2 })],
  flywheel: [kit.flywheel(), kit.flywheel({ bore: 0.6, holes: 0 }), kit.flywheel({ holes: 12, rim: 0.7 })],
  fan: [kit.fan(), kit.fan({ blades: 3, pitch: 60, hub: 1.2 })],
  bolt: [kit.bolt(), kit.bolt({ diameter: 1, length: 0.5, head: 2.4 })],
  liner: [kit.liner(), kit.liner({ cut: 'half' }), kit.liner({ cut: 'quarter', wall: 0.4 })],
  block: [kit.block(), kit.block({ cut: 'half' }), kit.block({ cut: 'quarter', width: 5, depth: 2.4 })],
  pipe: [kit.pipe([[0, 0, 0], [0, 2, 0], [3, 2, 0], [3, 2, 2]]), kit.pipe([[0, 0, 0], [1, 1, 1]], { thickness: 0, bend: 0 })],
})

describe('kit parts', () => {
  test('every kind is registered, solid or not as documented, and names the lazy chunk', () => {
    for (const name of ALL) {
      const k = kindOf(name)
      expect(k, name).toBeDefined()
      expect(k!.space).toBe('3d')
      expect(k!.chunks).toEqual(['3d', 'kit'])
      expect(typeof k!.bounds).toBe('function')
    }
    for (const name of ['spring', 'coil', 'fan', 'pipe', 'belt']) expect(kindOf(name)!.solid).toBeFalsy()
    for (const name of ['gear', 'piston', 'liner', 'block', 'conRod', 'crankshaft']) expect(typeof kindOf(name)!.sdf).toBe('function')
    expect(Object.keys(kit).sort()).toEqual([...ALL.filter((n) => n !== 'belt'), 'defaults'].sort())
    expect(kit.defaults).toBe(KIT)
  })

  test('what the backend draws is closed, right side out, and inside the bounds the linter is given', () => {
    let made: Record<string, any[]> = {}
    const m = build(() => { made = variants() })
    expect(codes(m)).toEqual([])
    const f = m.state(0)
    for (const [kind, nodes] of Object.entries(made)) {
      for (const node of nodes) {
        const soup = soups[kind]!(f.props(node), node)
        expect(soup.length, `${kind} draws something`).toBeGreaterThan(9 * 12)
        const b = f.localBounds(node), size = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]), eps = 1e-6 * size
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
        for (let i = 0; i < soup.length; i++) { lo[i % 3] = Math.min(lo[i % 3]!, soup[i]!); hi[i % 3] = Math.max(hi[i % 3]!, soup[i]!) }
        for (let k = 0; k < 3; k++) {
          // never outside the box, and the box is not loose: every side is reached to within 8% of the part's size
          expect(lo[k]!, `${node.id} min ${'xyz'[k]}`).toBeGreaterThanOrEqual(b.min[k]! - eps)
          expect(hi[k]!, `${node.id} max ${'xyz'[k]}`).toBeLessThanOrEqual(b.max[k]! + eps)
          // (the box of a camshaft or a fan is round on purpose: lobes and blades may point anywhere)
          if ((kind === 'camshaft' || kind === 'fan') && k < 2) continue
          // a housing cut in half keeps its box on the bore axis (so 'center' is the bore); its silhouette follows the cut
          if ((kind === 'liner' || kind === 'block') && f.props(node).cut === 'half' && k === 2) { expect(Math.max(...f.hull(node).map((p) => p[2]))).toBe(0); expect(hi[2]!).toBeLessThanOrEqual(eps); continue }
          expect(lo[k]! - b.min[k]!, `${node.id} box loose at min ${'xyz'[k]}`).toBeLessThan(0.08 * size)
          expect(b.max[k]! - hi[k]!, `${node.id} box loose at max ${'xyz'[k]}`).toBeLessThan(0.08 * size)
        }
        // every single shell is closed; a part merged from overlapping shells is a set of closed shells, so its
        // signed volume is positive (inside-out triangles would make it negative)
        const mesh = weld(soup)
        expect(meshVolume(mesh), `${node.id} volume`).toBeGreaterThan(0)
        if (['shaft', 'rack', 'conRod', 'valve', 'cam', 'liner', 'block', 'spring', 'coil', 'pipe'].includes(kind)) expect(meshIsClosed(mesh), `${node.id} closed`).toBe(true)
      }
    }
  })

  test('the defaults mate: a piston runs in a liner of the same bore, the rod fits the crank pin and the wrist pin', () => {
    let piston: MNode, liner: MNode, rod: MNode, crank: MNode, blk: MNode
    const m = build(() => { piston = kit.piston(); liner = kit.liner(); rod = kit.conRod(); crank = kit.crankshaft(); blk = kit.block() })
    const f = m.state(0)
    const p = pistonDims(f.props(piston!))
    expect(p.radius).toBeLessThan(1)
    expect(p.radius).toBeGreaterThan(0.95)
    // a point on the piston's skirt is in the open bore of the liner and of the block
    expect(sdf(f, liner!, [p.radius, 0, 0])).toBeGreaterThan(0)
    expect(sdf(f, blk!, [p.radius, 0, 0])).toBeGreaterThan(0)
    expect(sdf(f, liner!, [1.05, 0, 0])).toBeLessThan(0) // the wall itself
    expect(sdf(f, piston!, [p.radius - 0.01, -0.3, 0])).toBeLessThan(0) // the skirt
    expect(sdf(f, piston!, [0, -0.3, 0])).toBeGreaterThan(0) // hollow underneath: the rod's small end lives there
    // rod eyes are a little wider than the pins they hold
    const eyes = conRodDims(f.props(rod!))
    expect(2 * eyes.bigBore).toBeGreaterThan(f.props(crank!).crankpin)
    expect(2 * eyes.bigBore).toBeLessThan(f.props(crank!).crankpin * 1.05)
    expect(eyes.smallBore).toBeGreaterThan(p.pinRadius)
    expect(eyes.smallBore).toBeLessThan(p.pinRadius * 1.05)
    expect(sdf(f, rod!, [0, -3.25 / 2, 0])).toBeGreaterThan(0) // the big-end bore is open
    expect(sdf(f, rod!, [0, 0, 0])).toBeLessThan(0) // the beam
    // the rod is narrower than the gap between the crank webs
    expect(f.props(rod!).thickness).toBeLessThan(f.props(crank!).pinLength)
  })

  test('anchors are where the mechanisms look for them', () => {
    let piston: MNode, rod: MNode, crank: MNode, valve: MNode, g: MNode, cs: MNode, bolt: MNode, coil: MNode, pipe: MNode
    const m = build(() => {
      piston = kit.piston({ bore: 2, height: 1.4, pinHeight: 0.7 }).at(0, 5, 0)
      rod = kit.conRod({ length: 3 })
      crank = kit.crankshaft({ throw: 0.8, length: 3 }).at(1, 0, 0)
      valve = kit.valve({ head: 1, length: 3 })
      g = kit.gear({ teeth: 20, module: 0.25 })
      cs = kit.camshaft({ lobes: [{ offset: -1, angle: 0 }, { offset: 1, angle: 90 }] })
      bolt = kit.bolt({ diameter: 0.5, length: 2, headHeight: 0.4 })
      coil = kit.coil({ radius: 0.5, length: 2, leads: 0.3, wire: 0.1 })
      pipe = kit.pipe([[0, 0, 0], [0, 2, 0], [3, 2, 0]])
    })
    const f = m.state(0)
    expect(f.anchor(piston!, 'pin')).toEqual([0, 5, 0]) // pinY = 1.4 / 2 − 0.7
    expect(f.anchor(piston!, 'crown')).toEqual([0, 5.7, 0])
    expect(f.anchor(piston!, 'skirt')).toEqual([0, 4.3, 0])
    expect(f.anchor(rod!, 'bigEnd')).toEqual([0, -1.5, 0])
    expect(f.anchor(rod!, 'smallEnd')).toEqual([0, 1.5, 0])
    expect(f.anchor(crank!, 'main')).toEqual([1, 0, 0])
    expect(f.anchor(crank!, 'pin')).toEqual([1, 0.8, 0])
    expect(f.anchor(crank!, 'nose')).toEqual([1, 0, 1.5])
    expect(f.anchor(crank!, 'tail')).toEqual([1, 0, -1.5])
    expect(f.anchor(valve!, 'tip')).toEqual([0, 1.5, 0])
    expect(f.anchor(valve!, 'head')).toEqual([0, -1.5, 0])
    expect(f.anchor(valve!, 'seat')[1]).toBeCloseTo(-1.44, 10)
    expect(f.anchor(g!, 'pitch')).toEqual([2.5, 0, 0])
    expect(f.anchor(cs!, 'lobe2')).toEqual([0, 0, 1])
    expect(f.anchor(bolt!, 'seat')[1] - f.anchor(bolt!, 'tip')[1]).toBeCloseTo(2, 12)
    expect(f.anchor(bolt!, 'head')[1] - f.anchor(bolt!, 'seat')[1]).toBeCloseTo(0.4, 12)
    expect(f.anchor(coil!, 'start')).toEqual([0.8, -0.95, 0])
    expect(f.anchor(pipe!, 'end')).toEqual([3, 2, 0])
    expect(f.anchorNames(crank!)).toEqual(expect.arrayContaining(['main', 'pin', 'nose', 'tail', 'top', 'center']))
  })

  test('gears: the pitch cylinder is the solid, so two meshing gears touch without being inside each other', () => {
    let a: MNode, ring: MNode
    const m = build(() => { a = kit.gear({ teeth: 20, module: 0.25, bore: 0.5 }); ring = kit.gear({ teeth: 40, module: 0.25, internal: true }) })
    const f = m.state(0), d = gearDims(f.props(a!))
    expect(d.pitchRadius).toBe(2.5)
    expect(d.tipRadius).toBe(2.75)
    expect(sdf(f, a!, [2.5, 0, 0])).toBeCloseTo(0, 12)
    expect(sdf(f, a!, [2.7, 0, 0])).toBeCloseTo(0.2, 12) // a tooth tip is outside the solid the linter sees
    expect(sdf(f, a!, [0, 0, 0])).toBeCloseTo(0.25, 12) // the bore is open
    expect(sdf(f, ring!, [0, 0, 0])).toBeCloseTo(5, 12) // a ring gear is empty inside its pitch circle
    expect(sdf(f, ring!, [5.2, 0, 0])).toBeLessThan(0)
    expect(f.localBounds(ring!).max[0]).toBeCloseTo(5 + 1.25 * 0.25 + KIT.gear.rim * 0.25, 12)
  })

  test('cam: the lobe is derived from lift and duration; an impossible lobe is reported with the fix', () => {
    const s = camShape(0.32, 0.18, 120)
    expect(s.valid).toBe(true)
    expect(s.distance).toBeCloseTo(0.36, 12) // lift / (1 − cos 60°)
    expect(s.noseRadius).toBeCloseTo(0.14, 12) // base − distance × cos 60°
    expect(s.distance + s.noseRadius - s.baseRadius).toBeCloseTo(0.18, 12) // the nose reaches base + lift
    let ok: MNode, bad: MNode
    const m = build(() => { ok = kit.cam(); bad = kit.cam({ id: 'steep', baseRadius: 0.1, lift: 0.3, duration: 100 }) })
    const d = m.diagnostics.list
    expect(d.map((x) => x.code)).toEqual(['NUM-INVALID'])
    expect(d[0]!.ids).toEqual(['steep'])
    expect(d[0]!.what).toContain('no lobe on a base circle of radius 0.1 lifts 0.3 in 100°')
    expect(d[0]!.fix[0]).toMatch(/^baseRadius: /)
    const f = m.state(0)
    expect(f.anchor(ok!, 'nose')[0]).toBeCloseTo(0.5, 12)
    // the impossible lobe is still drawn, with the lift that was asked for
    const drawn = camShape(0.1, 0.3, 100)
    expect(drawn.valid).toBe(false)
    expect(drawn.distance + drawn.noseRadius - drawn.baseRadius).toBeCloseTo(0.3, 12)
    expect(soups.cam!(f.props(bad!), bad!).length).toBeGreaterThan(100)
  })

  test('bad input never throws: a diagnostic with a did-you-mean, and a part that still exists', () => {
    let g: MNode, p: MNode, b: MNode, l: MNode
    const m = build(() => {
      g = kit.gear({ tooth: 12 } as any)
      p = kit.piston({ bore: -2 })
      b = kit.bearing({ bore: 2, radius: 0.5 })
      l = kit.liner({ cut: 'hlaf' } as any)
      kit.gear({ teeth: 4 })
      kit.pipe([[0, 0, 0]] as any)
    })
    expect(codes(m)).toEqual(['API-UNKNOWN', 'NUM-INVALID', 'NUM-INVALID', 'API-UNKNOWN', 'NUM-INVALID', 'API-TYPE'])
    const d = m.diagnostics.list
    expect(d[0]!.fix[0]).toContain('teeth')
    expect(d[2]!.what).toContain('the bore (2, a diameter) is not smaller than the outside (radius 0.5)')
    expect(d[3]!.fix[0]).toContain('half')
    expect(d[4]!.what).toContain('4 teeth is too few')
    const f = m.state(0)
    for (const n of [g!, p!, b!, l!]) { expect(n.kind).toBeTruthy(); expect(f.localBounds(n).max.every(Number.isFinite)).toBe(true) }
    expect(g!.invalid).toBe(true)
    expect(f.props(p!).bore).toBe(2) // the bad value is dropped, the default stands
  })

  test('a dynamic option follows a param: bounds and anchors move with it', () => {
    let sp: MNode, pi: MNode
    const m = build((s) => {
      const k = s.param('k', { value: 1, min: 0.5, max: 2 })
      sp = kit.spring({ length: () => 2 * k() })
      pi = kit.piston({ bore: () => 2 * k() })
    })
    expect(m.state(0).localBounds(sp!).max[1]).toBe(1)
    expect(m.state(0, { k: 0.5 }).localBounds(sp!).max[1]).toBe(0.5)
    expect(m.state(0, { k: 2 }).anchor(pi!, 'crown')[1]).toBeCloseTo(0.72 * 4 / 2, 12)
  })

  test('spring.span(a, b): stands between two points and its length is their distance', () => {
    let sp: any, lid: MNode
    const m = build((s) => {
      const h = s.param('h', { value: 3, min: 1, max: 5 })
      const base = box({ id: 'base', width: 2, height: 0.2, depth: 2 })
      lid = box({ id: 'lid', width: 2, height: 0.2, depth: 2 }).at(0, h, 0)
      sp = kit.spring({ id: 'sp' }).span(base.anchor('top'), (lid as any).anchor('bottom'))
    })
    expect(codes(m)).toEqual([])
    for (const h of [1, 3, 5]) {
      const f = m.state(0, { h })
      expect(f.props(sp).length).toBeCloseTo(h - 0.2, 12)
      expect(f.anchor(sp, 'bottom')[1]).toBeCloseTo(0.1, 12)
      expect(f.anchor(sp, 'top')[1]).toBeCloseTo(h - 0.1, 12)
    }
    const again = build(() => { const a = kit.spring().at(0, 1, 0); (a as any).span([0, 0, 0], [0, 2, 0]) })
    expect(codes(again)).toEqual(['PLACE-CONFLICT'])
  })

  test('p.on(target) and p.under(target): centred, boxes touching, with an optional gap', () => {
    let a: MNode, b: MNode, c: MNode, d: MNode
    const m = build(() => {
      a = box({ id: 'a', width: 2, height: 1, depth: 2 }).at(1, 2, 3)
      b = (kit.bolt({ id: 'b', diameter: 0.5, length: 1, headHeight: 0.3 }) as any).on(a)
      c = (box({ id: 'c', width: 1, height: 0.4, depth: 1 }) as any).under(a, 0.25)
      d = (box({ id: 'd' }) as any).on('a', 0.5)
      ;(box({ id: 'e' }) as any).on('nothing')
      ;(box({ id: 'f' }) as any).under(a, NaN)
    })
    const f = m.state(0)
    expect(f.bounds(b!).min[1]).toBeCloseTo(2.5, 12)
    expect(f.world(b!).p[0]).toBeCloseTo(1, 12)
    expect(f.world(b!).p[2]).toBeCloseTo(3, 12)
    expect(f.bounds(c!).max[1]).toBeCloseTo(1.25, 12)
    expect(f.bounds(d!).min[1]).toBeCloseTo(3, 12)
    expect(codes(m)).toEqual(['REF-MISSING', 'NUM-INVALID'])
  })
})
