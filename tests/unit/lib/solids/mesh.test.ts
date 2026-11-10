import { describe, expect, test } from 'bun:test'
import { BoxGeometry, CylinderGeometry, PlaneGeometry, SphereGeometry, TorusGeometry } from 'three'
import type { Vec3 } from '../../../../src/lib/types.ts'
import {
  type MeshData, localSurfaceSamples, meshArea, meshBounds, meshData, meshDistance, meshIsClosed, meshProxy, meshSdf,
  meshSignedDistance, meshVolume, pointInMesh, sdfBox, sdfCylinder, sdfSphere, sdfTorus,
} from '../../../../src/lib/solids/index.ts'
import { boxMesh, fromGeometry, lcg } from './helpers.ts'

describe('mesh queries', () => {
  test('box mesh: bounds, area, volume, closed', () => {
    const mesh = boxMesh(2, 3, 4)
    expect(meshBounds(mesh)).toEqual({ min: [-1, -1.5, -2], max: [1, 1.5, 2] })
    expect(meshArea(mesh)).toBeCloseTo(2 * (6 + 12 + 8), 12)
    expect(meshVolume(mesh)).toBeCloseTo(24, 12)
    expect(meshIsClosed(mesh)).toBe(true)
  })

  test('meshData accepts nested triples', () => {
    const flat = boxMesh(1, 1, 1)
    const positions: number[][] = [], indices: number[][] = []
    for (let i = 0; i < flat.positions.length; i += 3) positions.push([flat.positions[i]!, flat.positions[i + 1]!, flat.positions[i + 2]!])
    for (let i = 0; i < flat.indices.length; i += 3) indices.push([flat.indices[i]!, flat.indices[i + 1]!, flat.indices[i + 2]!])
    const nested = meshData(positions, indices)
    expect(Array.from(nested.positions)).toEqual(Array.from(flat.positions))
    expect(Array.from(nested.indices)).toEqual(Array.from(flat.indices))
    expect(meshVolume(nested)).toBeCloseTo(1, 12)
  })

  test('three.js geometries with duplicated seam vertices are recognised as closed', () => {
    expect(meshIsClosed(fromGeometry(new BoxGeometry(1, 2, 3)))).toBe(true) // 24 unshared vertices
    expect(meshIsClosed(fromGeometry(new SphereGeometry(1, 16, 12)))).toBe(true) // seam + collapsed pole triangles
    expect(meshIsClosed(fromGeometry(new CylinderGeometry(0.5, 0.5, 2, 16)))).toBe(true)
    expect(meshIsClosed(fromGeometry(new TorusGeometry(1, 0.25, 12, 24)))).toBe(true)
  })

  test('open surfaces are recognised as open', () => {
    expect(meshIsClosed(fromGeometry(new PlaneGeometry(2, 2)))).toBe(false)
    expect(meshIsClosed(fromGeometry(new CylinderGeometry(0.5, 0.5, 2, 16, 1, true)))).toBe(false)
    const holed = boxMesh(1, 1, 1)
    expect(meshIsClosed({ positions: holed.positions, indices: Array.from(holed.indices).slice(3) })).toBe(false)
  })

  test('distance to a box mesh is exact and signed like the analytic box', () => {
    const mesh = boxMesh(2, 3, 4)
    const sdf = meshSdf(mesh)
    const random = lcg(11)
    const closest: Vec3 = [0, 0, 0]
    for (let i = 0; i < 500; i++) {
      const p: Vec3 = [random() * 6 - 3, random() * 6 - 3, random() * 6 - 3]
      const expected = sdfBox(p, 2, 3, 4)
      expect(Math.abs(sdf(p) - expected)).toBeLessThan(1e-9)
      expect(Math.abs(meshDistance(mesh, p, closest) - Math.abs(expected))).toBeLessThan(1e-9)
      // the reported closest point is on the box surface and at the reported distance
      expect(Math.abs(sdfBox(closest, 2, 3, 4))).toBeLessThan(1e-9)
      expect(Math.abs(Math.hypot(p[0] - closest[0], p[1] - closest[1], p[2] - closest[2]) - Math.abs(expected))).toBeLessThan(1e-9)
    }
  })

  test('pointInMesh matches the analytic solid for sphere, cylinder and torus meshes', () => {
    const random = lcg(12)
    const cases: [MeshData, (p: Vec3) => number][] = [
      [fromGeometry(new SphereGeometry(1, 32, 24)), p => sdfSphere(p, 1)],
      [fromGeometry(new CylinderGeometry(0.7, 0.7, 1.6, 48)), p => sdfCylinder(p, 0.7, 1.6)],
      // three's torus is around Z: swap y and z to compare with the Y-axis analytic torus
      [fromGeometry(new TorusGeometry(0.9, 0.3, 24, 48)), p => sdfTorus([p[0], p[2], p[1]], 0.9, 0.3)],
    ]
    for (const [mesh, analytic] of cases) {
      let inside = 0, checked = 0
      for (let i = 0; i < 1500; i++) {
        const p: Vec3 = [random() * 2.6 - 1.3, random() * 2.6 - 1.3, random() * 2.6 - 1.3]
        const d = analytic(p)
        if (Math.abs(d) < 0.02) continue // within the tessellation error of the facets
        checked++
        if (d < 0) inside++
        expect(pointInMesh(mesh, p)).toBe(d < 0)
        expect(Math.abs(meshSignedDistance(mesh, p) - d)).toBeLessThan(0.02)
      }
      expect(checked).toBeGreaterThan(1000)
      expect(inside).toBeGreaterThan(80)
    }
  })

  test('points exactly on vertices, edges and axis-aligned planes of the mesh do not confuse the parity test', () => {
    const mesh = boxMesh(2, 2, 2)
    // rays from these points pass near edges/vertices if the directions were axis-aligned or diagonal
    for (const p of [[0, 0, 0], [0.5, 0.5, 0.5], [0.999, 0, 0], [0, 0.999, 0.999], [-0.5, 0.25, 0.125]] as Vec3[]) expect(pointInMesh(mesh, p)).toBe(true)
    for (const p of [[1.001, 0, 0], [0, 1.5, 0], [2, 2, 2], [-1.001, -1.001, -1.001], [0, 0, 50]] as Vec3[]) expect(pointInMesh(mesh, p)).toBe(false)
  })

  test('an open mesh has an unsigned distance and a hollow proxy by default', () => {
    const plane = fromGeometry(new PlaneGeometry(2, 2)) // in the XY plane
    expect(meshSignedDistance(plane, [0, 0, 0.5])).toBeCloseTo(0.5, 12)
    expect(meshSignedDistance(plane, [0, 0, -0.5])).toBeCloseTo(0.5, 12)
    expect(meshProxy('sheet', plane).hollow).toBe(true)
    expect(meshProxy('solid', boxMesh(1, 1, 1)).hollow).toBe(false)
    expect(meshProxy('shell', boxMesh(1, 1, 1), undefined, { hollow: true }).hollow).toBe(true)
  })

  test('surface samples lie on the mesh and follow triangle area', () => {
    const mesh = boxMesh(1, 1, 4)
    const samples = localSurfaceSamples(meshProxy('m', mesh), 900, 5)
    expect(samples.length).toBe(900)
    let ends = 0
    for (const s of samples) {
      expect(meshDistance(mesh, s)).toBeLessThan(1e-9)
      if (Math.abs(Math.abs(s[2]) - 2) < 1e-9) ends++
    }
    // the two 1x1 end faces are 2 of 18 square units = 100 of 900 samples (stratified, so nearly exact)
    expect(Math.abs(ends - 100)).toBeLessThanOrEqual(2)
  })

  test('broken input never throws', () => {
    const empty: MeshData = { positions: [], indices: [] }
    expect(meshIsClosed(empty)).toBe(false)
    expect(meshArea(empty)).toBe(0)
    expect(meshBounds(empty)).toEqual({ min: [0, 0, 0], max: [0, 0, 0] })
    expect(pointInMesh(empty, [0, 0, 0])).toBe(false)
    expect(meshDistance(empty, [0, 0, 0])).toBe(Infinity)
    expect(localSurfaceSamples(meshProxy('e', empty), 10)).toEqual([])
    const bad: MeshData = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, Number.NaN, 0, 0], indices: [0, 1, 2, 0, 1, 3, 0, 1, 99, 0, 1] }
    expect(meshArea(bad)).toBeCloseTo(0.5, 12) // only the one valid triangle counts
    expect(meshDistance(bad, [0, 0, 2])).toBeCloseTo(2, 12)
    expect(meshIsClosed(bad)).toBe(false)
  })
})
