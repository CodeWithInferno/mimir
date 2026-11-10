import { describe, expect, test } from 'bun:test'
import type { Vec3 } from '../../../../src/lib/types.ts'
import {
  DEFAULT_SAMPLES, localSurfaceSamples, mat4Compose, primitiveProxy, sdfBox, sdfProxy, shapeSdf, surfaceSamples, transformPoint,
} from '../../../../src/lib/solids/index.ts'
import { ALL_SHAPES, lcg } from './helpers.ts'

describe('surface samples', () => {
  test('exactly n points, all on the surface, for every primitive', () => {
    for (const shape of ALL_SHAPES) {
      const sdf = shapeSdf(shape)
      for (const n of [1, 7, 64, 500]) {
        const samples = localSurfaceSamples(primitiveProxy('s', shape), n, 1)
        expect(samples.length).toBe(n)
        for (const s of samples) expect(Math.abs(sdf(s))).toBeLessThan(1e-9)
      }
    }
    expect(localSurfaceSamples(primitiveProxy('s', ALL_SHAPES[0]!)).length).toBe(DEFAULT_SAMPLES)
    expect(localSurfaceSamples(primitiveProxy('s', ALL_SHAPES[0]!), 0)).toEqual([])
    expect(localSurfaceSamples(primitiveProxy('s', ALL_SHAPES[0]!), Number.NaN)).toEqual([])
  })

  test('same seed -> same points; another seed -> other points', () => {
    for (const shape of ALL_SHAPES) {
      const a = localSurfaceSamples(primitiveProxy('a', shape), 64, 7)
      const b = localSurfaceSamples(primitiveProxy('b', { ...shape }), 64, 7)
      const c = localSurfaceSamples(primitiveProxy('c', shape), 64, 8)
      expect(a).toEqual(b)
      expect(a).not.toEqual(c)
    }
  })

  test('every face of a box gets points even with few samples', () => {
    const samples = localSurfaceSamples(primitiveProxy('b', { kind: 'box', width: 0.1, height: 3, depth: 3 }), 12, 1)
    const faces = new Set<string>()
    for (const s of samples) {
      if (Math.abs(Math.abs(s[0]) - 0.05) < 1e-12) faces.add(s[0] > 0 ? '+x' : '-x')
      else if (Math.abs(Math.abs(s[1]) - 1.5) < 1e-12) faces.add(s[1] > 0 ? '+y' : '-y')
      else faces.add(s[2] > 0 ? '+z' : '-z')
    }
    expect(faces.size).toBe(6)
  })

  test('points are spread in proportion to area', () => {
    // cylinder r = 1, h = 2: side 4*pi, each cap pi -> 2/3 on the side, 1/6 on each cap
    const cyl = localSurfaceSamples(primitiveProxy('c', { kind: 'cylinder', radius: 1, height: 2 }), 600, 1)
    expect(cyl.filter(s => s[1] === 1).length).toBe(100)
    expect(cyl.filter(s => s[1] === -1).length).toBe(100)
    // tube: the bore wall is sampled too
    const tubeSamples = localSurfaceSamples(primitiveProxy('t', { kind: 'tube', radius: 1, thickness: 0.25, height: 2 }), 400, 1)
    const onBore = tubeSamples.filter(s => Math.abs(Math.hypot(s[0], s[2]) - 0.75) < 1e-9 && Math.abs(s[1]) < 1).length
    const total = 2 * Math.PI * 2 * (1 + 0.75) + 2 * Math.PI * (1 - 0.75 ** 2)
    expect(Math.abs(onBore - 400 * (2 * Math.PI * 0.75 * 2) / total)).toBeLessThanOrEqual(1)
    // sphere: each octant holds 1/8 of the points, and the centroid is at the centre
    const ball = localSurfaceSamples(primitiveProxy('s', { kind: 'sphere', radius: 2 }), 800, 1)
    const octants = new Array<number>(8).fill(0)
    const mean = [0, 0, 0]
    for (const s of ball) { octants[(s[0] > 0 ? 1 : 0) + (s[1] > 0 ? 2 : 0) + (s[2] > 0 ? 4 : 0)]!++; mean[0]! += s[0]; mean[1]! += s[1]; mean[2]! += s[2] }
    for (const count of octants) expect(Math.abs(count - 100)).toBeLessThanOrEqual(8)
    expect(Math.hypot(mean[0]!, mean[1]!, mean[2]!) / 800).toBeLessThan(0.02)
    // torus: the outer half of the tube has more area than the inner half: (pi*R + 2r) : (pi*R - 2r)
    const torus = localSurfaceSamples(primitiveProxy('o', { kind: 'torus', radius: 1, tube: 0.4 }), 1000, 1)
    const outer = torus.filter(s => Math.hypot(s[0], s[2]) > 1).length
    expect(Math.abs(outer - 1000 * (Math.PI + 0.8) / (2 * Math.PI))).toBeLessThanOrEqual(4)
  })

  test('coverage: no large empty patch on any primitive at the default count', () => {
    const random = lcg(21)
    for (const shape of ALL_SHAPES) {
      const coarse = localSurfaceSamples(primitiveProxy('s', shape), DEFAULT_SAMPLES, 1)
      const dense = localSurfaceSamples(primitiveProxy('s', shape), 3000, 9)
      let worst = 0
      for (let i = 0; i < 400; i++) {
        const p = dense[Math.floor(random() * dense.length)]!
        let best = Infinity
        for (const s of coarse) best = Math.min(best, Math.hypot(s[0] - p[0], s[1] - p[1], s[2] - p[2]))
        worst = Math.max(worst, best)
      }
      // 64 points on these ~10-unit^2 surfaces are ~0.4 apart; any hole must stay well under one unit
      expect(worst).toBeLessThan(0.75)
    }
  })

  test('surfaceSamples returns the local points moved by the world matrix', () => {
    const world = mat4Compose({ position: [3, -2, 5], rotation: [20, 40, 60], scale: [1, 2, 0.5] })
    const proxy = primitiveProxy('c', { kind: 'cone', radius: 1, height: 2 }, world)
    const local = localSurfaceSamples(proxy, 50, 4), moved = surfaceSamples(proxy, 50, 4)
    expect(moved.length).toBe(50)
    for (let i = 0; i < 50; i++) {
      const expected = transformPoint(world, local[i]!)
      for (let d = 0; d < 3; d++) expect(Math.abs(moved[i]![d]! - expected[d]!)).toBeLessThan(1e-12)
    }
  })

  test('a custom sdf (block with a bore) is sampled on its zero set, including the hidden bore wall', () => {
    const block = sdfProxy('block', (p: Vec3) => Math.max(sdfBox(p, 2, 2, 2), 0.3 - Math.hypot(p[0], p[2])), { min: [-1, -1, -1], max: [1, 1, 1] })
    const samples = localSurfaceSamples(block, 200, 1)
    expect(samples.length).toBe(200)
    let bore = 0
    for (const s of samples) {
      expect(Math.abs(block.sdf!(s))).toBeLessThan(1e-3)
      if (Math.abs(Math.hypot(s[0], s[2]) - 0.3) < 1e-3 && Math.abs(s[1]) < 0.99) bore++
    }
    expect(bore).toBeGreaterThan(10)
    expect(localSurfaceSamples(block, 200, 1)).toEqual(samples)
  })

  test('a proxy with only bounds is treated as that box', () => {
    const samples = localSurfaceSamples({ id: 'b', localBounds: { min: [1, 1, 1], max: [3, 2, 5] }, world: mat4Compose() }, 60)
    expect(samples.length).toBe(60)
    for (const s of samples) expect(Math.abs(sdfBox([s[0] - 2, s[1] - 1.5, s[2] - 3], 2, 1, 4))).toBeLessThan(1e-12)
  })

  test('degenerate shapes give no samples instead of NaN', () => {
    expect(localSurfaceSamples(primitiveProxy('z', { kind: 'sphere', radius: 0 }), 10)).toEqual([])
    expect(localSurfaceSamples(primitiveProxy('n', { kind: 'box', width: Number.NaN, height: 1, depth: 1 }), 10)).toEqual([])
  })
})
