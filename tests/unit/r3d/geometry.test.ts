// Line work and shape builders of the 3D look (src/r3d/edges.ts, src/r3d/shapes.ts): plain arrays, no GPU.
import { describe, expect, test } from 'bun:test'
import { creaseEdges, creasedSoup, meshLines, sectionSegments, segmentGaps, xorSegments } from '../../../src/r3d/edges.ts'
import { cleanLoop, extrudeMesh, latheMesh, outward, soupVolume, sweepMesh } from '../../../src/r3d/shapes.ts'

// a unit cube: 8 points, 12 triangles, faces outwards
const CUBE = {
  positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1],
  indices: [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3],
}
const square: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
const hole: [number, number][] = [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]]
const closed = (m: { positions: number[]; indices: number[] }): boolean => creaseEdges(m.positions, m.indices, 38).closed

describe('crease edges', () => {
  test('a cube has 12 edges, each with its two face normals, and is closed', () => {
    const e = creaseEdges(CUBE.positions, CUBE.indices, 38)
    expect(e.segs.length / 6).toBe(12)
    expect(e.closed).toBe(true)
    for (let i = 0; i < 12; i++) {
      const n = e.norms.slice(6 * i, 6 * i + 6)
      expect(Math.hypot(n[0]!, n[1]!, n[2]!)).toBeCloseTo(1)
      expect(n[0]! * n[3]! + n[1]! * n[4]! + n[2]! * n[5]!).toBeCloseTo(0) // the two faces of a cube edge are at right angles
    }
  })
  test('the diagonal of a flat face is not an edge; a lower threshold does not invent one', () => {
    expect(creaseEdges(CUBE.positions, CUBE.indices, 1).segs.length / 6).toBe(12)
    expect(creaseEdges(CUBE.positions, CUBE.indices, 100).segs.length / 6).toBe(0) // 90 degrees is under a 100 degree threshold
  })
  test('an open mesh: every boundary edge is a contour (n and -n) and it is not closed', () => {
    const e = creaseEdges(CUBE.positions, CUBE.indices.slice(0, 30), 38) // one face missing
    expect(e.closed).toBe(false)
    const boundary = []
    for (let i = 0; i < e.norms.length; i += 6) if (e.norms[i]! === -e.norms[i + 3]! && e.norms[i + 1]! === -e.norms[i + 4]! && e.norms[i + 2]! === -e.norms[i + 5]!) boundary.push(i)
    expect(boundary.length).toBe(4)
  })
  test('a triangle soup is welded by position', () => {
    const soup: number[] = []
    for (const i of CUBE.indices) soup.push(CUBE.positions[3 * i]!, CUBE.positions[3 * i + 1]!, CUBE.positions[3 * i + 2]!)
    const e = creaseEdges(soup, null, 38)
    expect(e.segs.length / 6).toBe(12)
    expect(e.closed).toBe(true)
  })
  test('empty and degenerate input', () => {
    expect(creaseEdges([], null, 38)).toEqual({ segs: [], norms: [], closed: false })
    expect(creaseEdges([0, 0, 0, 1, 0, 0, 2, 0, 0], null, 38).segs.length).toBe(0)
  })
})

describe('seam removal and crowding', () => {
  test('coincident collinear segments cancel; collinear runs merge', () => {
    const twice = [0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0]
    expect(xorSegments(twice, null).segs.length).toBe(0)
    const run = xorSegments([0, 0, 0, 1, 0, 0, 1, 0, 0, 2, 0, 0, 2, 0, 0, 3, 0, 0], null).segs
    expect(run.length).toBe(6)
    expect([run[0], run[3]].sort()).toEqual([0, 3])
    // an overlap leaves the parts covered once
    const partial = xorSegments([0, 0, 0, 2, 0, 0, 1, 0, 0, 3, 0, 0], null).segs
    expect(partial.length).toBe(12)
  })
  test('normals travel with their segment', () => {
    const out = xorSegments([0, 0, 0, 1, 0, 0, 5, 5, 5, 5, 6, 5], [0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1])
    expect(out.segs.length).toBe(12)
    const i = out.segs[0] === 0 ? 0 : 6
    expect(out.norms.slice(i, i + 6)).toEqual([0, 1, 0, 0, 0, 1])
  })
  test('the gap is the distance to the nearest parallel neighbour, capped', () => {
    const g = segmentGaps([0, 0, 0, 1, 0, 0, 0, 0.1, 0, 1, 0.1, 0, 0, 5, 0, 1, 5, 0], 0.3)
    expect(g[0]).toBeCloseTo(0.1)
    expect(g[1]).toBeCloseTo(0.1)
    expect(g[2]).toBeCloseTo(0.3)
    // a chain neighbour (end to end) and a perpendicular one do not count
    const chain = segmentGaps([0, 0, 0, 1, 0, 0, 1, 0, 0, 2, 0, 0, 0.5, 0, 0, 0.5, 1, 0], 0.3)
    expect(Array.from(chain)).toEqual([0.3, 0.3, 0.3].map((x) => Math.fround(x)))
  })
  test('meshLines of a cube: 12 segments at full gap', () => {
    const l = meshLines(CUBE.positions, CUBE.indices, 38, 0.3)
    expect(l.segs.length / 6).toBe(12)
    expect(l.closed).toBe(true)
    expect(Array.from(l.gaps).every((x) => Math.abs(x - 0.3) < 1e-6)).toBe(true)
  })
})

describe('section outline', () => {
  test('a plane through a cube gives a closed square of 4 merged segments', () => {
    const raw = sectionSegments(CUBE.positions, CUBE.indices, [0, 0, 1, -0.5])
    const { segs } = xorSegments(raw, null)
    expect(segs.length / 6).toBe(4)
    let length = 0
    for (let i = 0; i < segs.length; i += 6) { length += Math.hypot(segs[i + 3]! - segs[i]!, segs[i + 4]! - segs[i + 1]!, segs[i + 5]! - segs[i + 2]!); expect(segs[i + 2]).toBeCloseTo(0.5); expect(segs[i + 5]).toBeCloseTo(0.5) }
    expect(length).toBeCloseTo(4)
  })
  test('a plane that misses gives nothing', () => {
    expect(sectionSegments(CUBE.positions, CUBE.indices, [0, 0, 1, -2]).length).toBe(0)
  })
})

describe('creased normals', () => {
  test('a cube keeps flat faces', () => {
    const s = creasedSoup(CUBE.positions, CUBE.indices, 38)
    expect(s.positions.length).toBe(12 * 9)
    for (let i = 0; i < s.normals.length; i += 3) {
      const n = [s.normals[i]!, s.normals[i + 1]!, s.normals[i + 2]!].map(Math.abs).sort()
      expect(n[0]).toBeCloseTo(0); expect(n[1]).toBeCloseTo(0); expect(n[2]).toBeCloseTo(1)
    }
  })
  test('a turned shape is smooth around and creased at its rims', () => {
    const m = latheMesh([[0, 0], [1, 0], [1, 2], [0, 2]], 48)!
    const s = creasedSoup(m.positions, m.indices, 38)
    let radial = 0, axial = 0
    for (let i = 0; i < s.normals.length; i += 3) {
      const y = Math.abs(s.normals[i + 1]!)
      if (y < 1e-3) radial++
      else if (y > 0.999) axial++
      else throw new Error(`a normal that is neither radial nor axial: ${y}`)
      if (y < 1e-3) { // radial normals point straight out from the axis at their own vertex (smooth across the 7.5 degree facets)
        const r = Math.hypot(s.positions[i]!, s.positions[i + 2]!)
        expect(s.normals[i]! * s.positions[i]! + s.normals[i + 2]! * s.positions[i + 2]!).toBeCloseTo(r, 4)
      }
    }
    expect(radial).toBeGreaterThan(0)
    expect(axial).toBeGreaterThan(0)
  })
  test('crease 0 is flat shading', () => {
    const m = latheMesh([[0, 0], [1, 0], [1, 2], [0, 2]], 12)!
    const s = creasedSoup(m.positions, m.indices, 0)
    for (let t = 0; t < s.normals.length; t += 9) for (let k = 3; k < 9; k++) expect(s.normals[t + k]).toBeCloseTo(s.normals[t + (k % 3)]!)
  })
})

describe('shape builders', () => {
  test('extrude: volume = area x depth, closed, faces outwards; a hole takes its volume out', () => {
    const solid = extrudeMesh(square, [], 2)!
    expect(soupVolume(solid)).toBeCloseTo(8)
    expect(closed(solid)).toBe(true)
    const holed = extrudeMesh(square, [hole], 2)!
    expect(soupVolume(holed)).toBeCloseTo(8 - 0.36 * 2)
    expect(closed(holed)).toBe(true)
    const z = holed.positions.filter((_, i) => i % 3 === 2)
    expect(Math.min(...z)).toBe(-1)
    expect(Math.max(...z)).toBe(1)
  })
  test('extrude: the winding of the outline and of the holes does not matter', () => {
    const a = extrudeMesh([...square].reverse(), [[...hole].reverse()], 1)!
    expect(soupVolume(a)).toBeCloseTo(4 - 0.36)
    expect(closed(a)).toBe(true)
  })
  test('extrude: a bevel chamfers both faces and stays closed', () => {
    const b = extrudeMesh(square, [hole], 2, 0.1)!
    expect(closed(b)).toBe(true)
    expect(soupVolume(b)).toBeLessThan(8 - 0.72)
    expect(soupVolume(b)).toBeGreaterThan(7)
    // too large a bevel is clamped, not a broken mesh
    const big = extrudeMesh(square, [], 0.2, 5)!
    expect(closed(big)).toBe(true)
    expect(soupVolume(big)).toBeGreaterThan(0)
  })
  test('extrude: bad input gives null, never a throw', () => {
    expect(extrudeMesh([[0, 0], [1, 0]], [], 1)).toBeNull()
    expect(extrudeMesh([[0, 0], [1, 0], [2, 0]], [], 1)).toBeNull()
    expect(extrudeMesh(square, [], 0)).toBeNull()
    expect(extrudeMesh(square, [], NaN)).toBeNull()
    expect(extrudeMesh([[0, 0], [NaN, 0], [1, 0], [1, 1]] as [number, number][], [], 1)).not.toBeNull()
  })
  test('lathe: a cylinder profile has the volume of a cylinder and is closed', () => {
    const m = latheMesh([[0, 0], [1, 0], [1, 2], [0, 2]], 96)!
    expect(soupVolume(m)).toBeCloseTo(Math.PI * 2, 1)
    expect(soupVolume(m)).toBeGreaterThan(0)
    expect(closed(m)).toBe(true)
  })
  test('lathe: a closed profile off the axis is a ring-shaped solid; an open one is a surface', () => {
    const ring = latheMesh([[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]], 64)!
    expect(closed(ring)).toBe(true)
    expect(soupVolume(ring)).toBeCloseTo(Math.PI * 3, 1)
    const vase = latheMesh([[1, 0], [1.5, 1], [1, 2]], 32)!
    expect(closed(vase)).toBe(false)
    expect(latheMesh([[1, 0]], 32)).toBeNull()
  })
  test('sweep: a straight tube has the volume of a cylinder, is closed, faces outwards', () => {
    const m = sweepMesh([[0, 0, 0], [0, 3, 0]], 0.5, 64)!
    expect(soupVolume(m)).toBeCloseTo(Math.PI * 0.25 * 3, 1)
    expect(closed(m)).toBe(true)
  })
  test('sweep: the section does not twist round a bend, and a closed path is a closed ring', () => {
    const bent = sweepMesh([[0, 0, 0], [0, 2, 0], [2, 2, 0], [2, 2, 2]], 0.2, 12)!
    expect(closed(bent)).toBe(true)
    expect(soupVolume(bent)).toBeGreaterThan(0)
    const loop = sweepMesh([[0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0]], 0.2, 12, true)!
    expect(closed(loop)).toBe(true)
    expect(sweepMesh([[0, 0, 0]], 0.2)).toBeNull()
    expect(sweepMesh([[0, 0, 0], [1, 0, 0]], 0)).toBeNull()
  })
  test('outward turns an inside-out mesh', () => {
    const flipped = { positions: CUBE.positions, indices: CUBE.indices.map((_, i, a) => a[i - (i % 3) + [0, 2, 1][i % 3]!]!) }
    expect(soupVolume(flipped)).toBeCloseTo(-1)
    expect(soupVolume(outward(flipped))).toBeCloseTo(1)
    expect(outward(CUBE)).toBe(CUBE)
  })
  test('cleanLoop drops repeats and fixes the winding', () => {
    expect(cleanLoop([[0, 0], [0, 0], [1, 0], [1, 1], [0, 0]], true)).toEqual([[0, 0], [1, 0], [1, 1]])
    expect(cleanLoop([[0, 0], [1, 1], [1, 0]], true)).toEqual([[1, 0], [1, 1], [0, 0]])
  })
})
