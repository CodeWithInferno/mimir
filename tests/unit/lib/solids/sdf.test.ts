import { describe, expect, test } from 'bun:test'
import { BoxGeometry, CapsuleGeometry, ConeGeometry, CylinderGeometry, SphereGeometry, TorusGeometry } from 'three'
import type { Vec3 } from '../../../../src/lib/types.ts'
import {
  type Shape, localSurfaceSamples, mat4AlignY, mat4Invert, primitiveProxy, sdfBox, sdfCapsule, sdfCone, sdfCylinder, sdfSphere,
  sdfTorus, sdfTube, shapeBounds, shapeMinExtent, shapeSdf, shapeVolume, transformPoint,
} from '../../../../src/lib/solids/index.ts'
import { ALL_SHAPES, fromGeometry, lcg } from './helpers.ts'

const near = (actual: number, expected: number, eps = 1e-12): void => { expect(Math.abs(actual - expected)).toBeLessThan(eps) }

describe('primitive signed distance functions', () => {
  test('box: faces, edges, corners and the inside', () => {
    near(sdfBox([0, 0, 0], 2, 4, 6), -1)
    near(sdfBox([0.5, 0, 0], 2, 4, 6), -0.5)
    near(sdfBox([1, 2, 3], 2, 4, 6), 0)
    near(sdfBox([3, 0, 0], 2, 4, 6), 2)
    near(sdfBox([2, 3, 0], 2, 4, 6), Math.SQRT2)
    near(sdfBox([2, 3, 4], 2, 4, 6), Math.sqrt(3))
    near(sdfBox([0, -2.5, 0], 2, 4, 6), 0.5)
  })

  test('sphere', () => {
    near(sdfSphere([0, 0, 0], 2), -2)
    near(sdfSphere([3, 4, 0], 2), 3)
    near(sdfSphere([0, 2, 0], 2), 0)
  })

  test('cylinder: axis is Y, height is the full height', () => {
    near(sdfCylinder([0, 0, 0], 1, 4), -1)
    near(sdfCylinder([0, 1.5, 0], 1, 4), -0.5)
    near(sdfCylinder([3, 0, 0], 1, 4), 2)
    near(sdfCylinder([0, 5, 0], 1, 4), 3)
    near(sdfCylinder([0, 0, 2], 1, 4), 1)
    near(sdfCylinder([4, 6, 0], 1, 4), 5)
    near(sdfCylinder([1, 2, 0], 1, 4), 0)
  })

  test('cone: base at -height/2, apex at +height/2, optional top radius', () => {
    near(sdfCone([0, 1, 0], 1, 2), 0)
    near(sdfCone([0, 3, 0], 1, 2), 2)
    near(sdfCone([1, -1, 0], 1, 2), 0)
    near(sdfCone([0, -2, 0], 1, 2), 1)
    near(sdfCone([0.5, 0, 0], 1, 2), 0)
    near(sdfCone([0, 0, 0], 1, 2), -0.5 * Math.cos(Math.atan(0.5)))
    near(sdfCone([0, -0.9, 0], 1, 2), -0.1)
    // a frustum with equal radii is a cylinder
    const random = lcg(5)
    for (let i = 0; i < 200; i++) {
      const p: Vec3 = [random() * 4 - 2, random() * 4 - 2, random() * 4 - 2]
      near(sdfCone(p, 0.7, 1.9, 0.7), sdfCylinder(p, 0.7, 1.9), 1e-9)
    }
    near(sdfCone([0, 1, 0], 1, 2, 0.4), 0)
    near(sdfCone([0.4, 1, 0], 1, 2, 0.4), 0)
    near(sdfCone([0, 1.25, 0], 1, 2, 0.4), 0.25)
  })

  test('torus: ring in the XZ plane around the Y axis', () => {
    near(sdfTorus([2, 0, 0], 2, 0.5), -0.5)
    near(sdfTorus([0, 0, 2.5], 2, 0.5), 0)
    near(sdfTorus([0, 0, 0], 2, 0.5), 1.5)
    near(sdfTorus([2, 1.5, 0], 2, 0.5), 1)
  })

  test('tube: radius is the OUTER radius, the bore is empty, a bore-less tube is a cylinder', () => {
    near(sdfTube([0, 0, 0], 1, 0.2, 4), 0.8)
    near(sdfTube([0.9, 0, 0], 1, 0.2, 4), -0.1)
    near(sdfTube([0.8, 0, 0], 1, 0.2, 4), 0)
    near(sdfTube([1, 0, 0], 1, 0.2, 4), 0)
    near(sdfTube([1.5, 0, 0], 1, 0.2, 4), 0.5)
    near(sdfTube([0.9, 2.5, 0], 1, 0.2, 4), 0.5)
    near(sdfTube([0, 0, 0], 1, 1, 4), -1)
    near(sdfTube([0, 0, 0], 1, 5, 4), sdfCylinder([0, 0, 0], 1, 4))
  })

  test('capsule: height is the total end-to-end height', () => {
    near(sdfCapsule([0, 1.5, 0], 0.5, 3), 0)
    near(sdfCapsule([0, 2, 0], 0.5, 3), 0.5)
    near(sdfCapsule([0.5, 0.7, 0], 0.5, 3), 0)
    near(sdfCapsule([0, 0, 0], 0.5, 3), -0.5)
    near(sdfCapsule([0.3, 1.4, 0], 0.5, 3), Math.hypot(0.3, 0.4) - 0.5)
    // shorter than its own diameter: degenerates to a sphere
    near(sdfCapsule([0, 1, 0], 0.5, 0.2), 0.5)
  })

  test('every primitive is 1-Lipschitz (a true distance never changes faster than the point moves)', () => {
    const random = lcg(6)
    for (const shape of ALL_SHAPES) {
      const sdf = shapeSdf(shape)
      for (let i = 0; i < 400; i++) {
        const p: Vec3 = [random() * 5 - 2.5, random() * 5 - 2.5, random() * 5 - 2.5]
        const q: Vec3 = [p[0] + random() - 0.5, p[1] + random() - 0.5, p[2] + random() - 0.5]
        expect(Math.abs(sdf(p) - sdf(q))).toBeLessThanOrEqual(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) + 1e-12)
      }
    }
  })

  test('|sdf| equals the brute-force distance to a dense surface sampling', () => {
    const random = lcg(7)
    for (const shape of ALL_SHAPES) {
      const sdf = shapeSdf(shape)
      const surface = localSurfaceSamples(primitiveProxy('s', shape), 20000, 3)
      expect(surface.length).toBe(20000)
      let worst = 0
      for (let i = 0; i < 60; i++) {
        const p: Vec3 = [random() * 4 - 2, random() * 4 - 2, random() * 4 - 2]
        let best = Infinity
        for (const s of surface) {
          const d = (s[0] - p[0]) ** 2 + (s[1] - p[1]) ** 2 + (s[2] - p[2]) ** 2
          if (d < best) best = d
        }
        worst = Math.max(worst, Math.abs(Math.abs(sdf(p)) - Math.sqrt(best)))
      }
      // 20000 samples on a surface of ~10 square units leave holes of ~0.03
      expect(worst).toBeLessThan(0.04)
    }
  })

  test('the sign agrees with an independent inside test', () => {
    const random = lcg(8)
    const inside: Record<Shape['kind'], (shape: any, p: Vec3) => boolean> = {
      box: (s, p) => Math.abs(p[0]) < s.width / 2 && Math.abs(p[1]) < s.height / 2 && Math.abs(p[2]) < s.depth / 2,
      sphere: (s, p) => Math.hypot(...p) < s.radius,
      cylinder: (s, p) => Math.hypot(p[0], p[2]) < s.radius && Math.abs(p[1]) < s.height / 2,
      cone: (s, p) => {
        const t = p[1] / s.height + 0.5
        return t > 0 && t < 1 && Math.hypot(p[0], p[2]) < s.radius + ((s.topRadius ?? 0) - s.radius) * t
      },
      torus: (s, p) => Math.hypot(Math.hypot(p[0], p[2]) - s.radius, p[1]) < s.tube,
      tube: (s, p) => { const r = Math.hypot(p[0], p[2]); return r < s.radius && r > s.radius - s.thickness && Math.abs(p[1]) < s.height / 2 },
      capsule: (s, p) => { const half = s.height / 2 - s.radius; const y = Math.max(-half, Math.min(half, p[1])); return Math.hypot(p[0], p[1] - y, p[2]) < s.radius },
    }
    for (const shape of ALL_SHAPES) {
      const sdf = shapeSdf(shape)
      let insideCount = 0
      for (let i = 0; i < 2000; i++) {
        const p: Vec3 = [random() * 3 - 1.5, random() * 3 - 1.5, random() * 3 - 1.5]
        const d = sdf(p)
        if (Math.abs(d) < 1e-9) continue
        const isInside = inside[shape.kind](shape, p)
        if (isInside) insideCount++
        expect(d < 0).toBe(isInside)
      }
      expect(insideCount).toBeGreaterThan(20)
    }
  })

  test('bounds are tight and volumes are right', () => {
    for (const shape of ALL_SHAPES) {
      const bounds = shapeBounds(shape)
      const sdf = shapeSdf(shape)
      const samples = localSurfaceSamples(primitiveProxy('s', shape), 4000, 1)
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
      for (const s of samples) for (let d = 0; d < 3; d++) { min[d] = Math.min(min[d]!, s[d]!); max[d] = Math.max(max[d]!, s[d]!) }
      for (let d = 0; d < 3; d++) {
        expect(min[d]!).toBeGreaterThanOrEqual(bounds.min[d]! - 1e-9)
        expect(max[d]!).toBeLessThanOrEqual(bounds.max[d]! + 1e-9)
        expect(min[d]! - bounds.min[d]!).toBeLessThan(0.06)
        expect(bounds.max[d]! - max[d]!).toBeLessThan(0.06)
      }
      // midpoint-rule volume over the bounds
      const n = 60
      let hits = 0
      const size = [bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]]
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
        if (sdf([bounds.min[0] + ((i + 0.5) / n) * size[0]!, bounds.min[1] + ((j + 0.5) / n) * size[1]!, bounds.min[2] + ((k + 0.5) / n) * size[2]!]) < 0) hits++
      }
      const numeric = (hits / n ** 3) * size[0]! * size[1]! * size[2]!
      expect(Math.abs(numeric - shapeVolume(shape)) / shapeVolume(shape)).toBeLessThan(0.03)
      expect(shapeMinExtent(shape)).toBeCloseTo(Math.min(size[0]!, size[1]!, size[2]!), 12)
    }
  })

  test('conventions match the three.js geometries the renderer will draw', () => {
    const onSurface = (shape: Shape, positions: ArrayLike<number>, toLocal?: number[]): number => {
      const sdf = shapeSdf(shape)
      let worst = 0
      for (let i = 0; i < positions.length; i += 3) {
        let p: Vec3 = [positions[i]!, positions[i + 1]!, positions[i + 2]!]
        if (toLocal) p = transformPoint(toLocal, p)
        worst = Math.max(worst, Math.abs(sdf(p)))
      }
      return worst
    }
    expect(onSurface({ kind: 'box', width: 1, height: 2, depth: 3 }, fromGeometry(new BoxGeometry(1, 2, 3)).positions)).toBeLessThan(1e-6)
    expect(onSurface({ kind: 'sphere', radius: 1.5 }, fromGeometry(new SphereGeometry(1.5, 16, 12)).positions)).toBeLessThan(1e-6)
    expect(onSurface({ kind: 'cylinder', radius: 0.5, height: 2 }, fromGeometry(new CylinderGeometry(0.5, 0.5, 2, 16)).positions)).toBeLessThan(1e-6)
    expect(onSurface({ kind: 'cone', radius: 0.5, height: 2 }, fromGeometry(new ConeGeometry(0.5, 2, 16)).positions)).toBeLessThan(1e-6)
    expect(onSurface({ kind: 'cone', radius: 0.5, height: 2, topRadius: 0.2 }, fromGeometry(new CylinderGeometry(0.2, 0.5, 2, 16)).positions)).toBeLessThan(1e-6)
    // three's CapsuleGeometry takes the length of the straight section: total height = length + 2 * radius
    expect(onSurface({ kind: 'capsule', radius: 0.4, height: 1.2 + 0.8 }, fromGeometry(new CapsuleGeometry(0.4, 1.2, 8, 16)).positions)).toBeLessThan(1e-6)
    // three's TorusGeometry lies in the XY plane (axis Z); ours is around Y, so the proxy needs mat4AlignY('z')
    const torus = fromGeometry(new TorusGeometry(1, 0.25, 12, 24)).positions
    expect(onSurface({ kind: 'torus', radius: 1, tube: 0.25 }, torus)).toBeGreaterThan(0.1)
    expect(onSurface({ kind: 'torus', radius: 1, tube: 0.25 }, torus, mat4Invert(mat4AlignY('z'))!)).toBeLessThan(1e-6)
  })
})
