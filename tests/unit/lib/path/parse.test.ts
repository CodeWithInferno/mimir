import { describe, expect, test } from 'bun:test'
import {
  circlePath, parsePath, pathLength, pointAt, rectPath, toPathString, validatePath,
} from '../../../../src/lib/path/index.ts'
import type { Subpath } from '../../../../src/lib/path/index.ts'
import { anchors, dist, rng, samplePoints } from './helpers.ts'
import type { Vec2 } from '../../../../src/lib/types.ts'

const near = (a: number[], b: number[], eps = 1e-9): void => {
  expect(a.length).toBe(b.length)
  for (let i = 0; i < a.length; i++) expect(Math.abs(a[i] - b[i])).toBeLessThanOrEqual(eps)
}
const line = (x0: number, y0: number, x1: number, y1: number): number[] =>
  [x0 + (x1 - x0) / 3, y0 + (y1 - y0) / 3, x0 + ((x1 - x0) * 2) / 3, y0 + ((y1 - y0) * 2) / 3, x1, y1]

describe('parsePath: commands', () => {
  test('M L H V, absolute', () => {
    const p = parsePath('M 1 2 L 4 2 H 6 V 5')
    expect(p.length).toBe(1)
    expect(p[0].closed).toBe(false)
    near(p[0].coords, [1, 2, ...line(1, 2, 4, 2), ...line(4, 2, 6, 2), ...line(6, 2, 6, 5)])
  })

  test('m l h v, relative, and the first m is absolute', () => {
    const p = parsePath('m 1 2 l 3 0 h 2 v 3')
    near(p[0].coords, [1, 2, ...line(1, 2, 4, 2), ...line(4, 2, 6, 2), ...line(6, 2, 6, 5)])
  })

  test('extra pairs after M are implicit L (after m: implicit l), and commands repeat', () => {
    expect(anchors(parsePath('M 0 0 1 0 1 1')[0])).toEqual([[0, 0], [1, 0], [1, 1]])
    expect(anchors(parsePath('m 1 1 1 0 0 1')[0])).toEqual([[1, 1], [2, 1], [2, 2]])
    expect(anchors(parsePath('M0 0 L 1 0 2 0 3 5')[0])).toEqual([[0, 0], [1, 0], [2, 0], [3, 5]])
    expect(anchors(parsePath('M0 0 h 1 1 1')[0])).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]])
  })

  test('C is copied verbatim; c is relative to the current point', () => {
    expect(parsePath('M 1 1 C 2 3 4 5 6 7')[0].coords).toEqual([1, 1, 2, 3, 4, 5, 6, 7])
    expect(parsePath('M 1 1 c 1 2 3 4 5 6')[0].coords).toEqual([1, 1, 2, 3, 4, 5, 6, 7])
  })

  test('S reflects the previous cubic handle, or uses the current point when there is none', () => {
    const p = parsePath('M0 0 C 0 1 1 1 1 0 S 2 -1 2 0')[0].coords
    expect(p.slice(8)).toEqual([1, -1, 2, -1, 2, 0])
    const q = parsePath('M0 0 L 1 0 S 2 -1 2 0')[0].coords
    expect(q.slice(8)).toEqual([1, 0, 2, -1, 2, 0])
    const r = parsePath('M0 0 c 0 1 1 1 1 0 s 1 -1 1 0')[0].coords
    expect(r.slice(8)).toEqual([1, -1, 2, -1, 2, 0])
  })

  test('Q is raised to the identical cubic; T reflects the previous quadratic handle', () => {
    const p = parsePath('M0 0 Q 1 2 2 0 T 4 0')
    const c = p[0].coords
    near(c, [0, 0, 2 / 3, 4 / 3, 4 / 3, 4 / 3, 2, 0, 8 / 3, -4 / 3, 10 / 3, -4 / 3, 4, 0])
    // the quadratic's midpoint is (P0 + 2Q + P2) / 4 = (1, 1)
    const mid = samplePoints([{ coords: c.slice(0, 8), closed: false }], 2)[1]
    near(mid, [1, 1])
    // T after a line: the quadratic handle is the current point (1, 0), so c1 = (1, 0) and c2 = 3 + (1 - 3)·2/3
    const t = parsePath('M0 0 L 1 0 T 3 0')[0].coords
    near(t.slice(8), [1, 0, 5 / 3, 0, 3, 0])
    // relative forms
    near(parsePath('M1 1 q 1 2 2 0 t 2 0')[0].coords, c.map((v) => v + 1))
  })

  test('Z closes with a straight edge and later commands start again from the subpath start', () => {
    const p = parsePath('M1 1 L2 1 L2 2 Z L0 0')
    expect(p.length).toBe(2)
    expect(p[0].closed).toBe(true)
    expect(anchors(p[0])).toEqual([[1, 1], [2, 1], [2, 2], [1, 1]])
    expect(p[1].closed).toBe(false)
    expect(anchors(p[1])).toEqual([[1, 1], [0, 0]])
  })

  test('Z on a subpath that already returned to its start adds nothing', () => {
    const p = parsePath('M0 0 L1 0 L1 1 L0 0 Z')
    expect(anchors(p[0]).length).toBe(4)
    expect(p[0].closed).toBe(true)
    // and a start that is off by float noise is snapped, not bridged with a sliver
    const q = parsePath('M0 0 L1 0 L1 1 L0 1e-13 Z')
    expect(anchors(q[0])).toEqual([[0, 0], [1, 0], [1, 1], [0, 0]])
  })

  test('several subpaths; a lone M draws nothing', () => {
    const p = parsePath('M0 0 L1 0 M5 5 M2 2 L3 3 z m1 0 l1 0')
    expect(p.length).toBe(3)
    expect(anchors(p[1])).toEqual([[2, 2], [3, 3], [2, 2]])
    expect(anchors(p[2])).toEqual([[3, 2], [4, 2]])
  })
})

describe('parsePath: number syntax', () => {
  test('no separators, signs, leading dots, exponents, commas, newlines', () => {
    expect(anchors(parsePath('M.5.5L-1-1e1')[0])).toEqual([[0.5, 0.5], [-1, -10]])
    expect(anchors(parsePath('M1e-2,2E+1\n\tL+3,4.')[0])).toEqual([[0.01, 20], [3, 4]])
    expect(anchors(parsePath('M10-20L30.5.25')[0])).toEqual([[10, -20], [30.5, 0.25]])
  })

  test('arc flags may be glued together and to the next number', () => {
    const spaced = parsePath('M0 0 a 1 1 0 0 1 1 1')
    expect(parsePath('M0 0a1 1 0 011 1')).toEqual(spaced)
    expect(parsePath('M0 0a1,1,0,0,1,1,1')).toEqual(spaced)
    expect(parsePath('M0 0a1 1 0 01 1 1')).toEqual(spaced)
  })
})

describe('parsePath: arcs', () => {
  // M0 0 → (1, 1) with r = 1 has two candidate centres, (1, 0) and (0, 1). "sweep" means increasing angle
  // in the raw coordinates (clockwise on a y-down screen, counter-clockwise in the y-up frame).
  const cases: [large: number, sweep: number, centre: Vec2, length: number, mid: Vec2][] = [
    [0, 1, [0, 1], Math.PI / 2, [Math.SQRT1_2, 1 - Math.SQRT1_2]],
    [1, 1, [1, 0], (3 * Math.PI) / 2, [1 + Math.SQRT1_2, -Math.SQRT1_2]],
    [0, 0, [1, 0], Math.PI / 2, [1 - Math.SQRT1_2, Math.SQRT1_2]],
    [1, 0, [0, 1], (3 * Math.PI) / 2, [-Math.SQRT1_2, 1 + Math.SQRT1_2]],
  ]
  for (const [large, sweep, centre, length, mid] of cases) {
    test(`flags large=${large} sweep=${sweep}`, () => {
      const p = parsePath(`M0 0 A 1 1 0 ${large} ${sweep} 1 1`)
      expect(p.length).toBe(1)
      const c = p[0].coords
      expect([c[0], c[1]]).toEqual([0, 0])
      expect(c.slice(-2)).toEqual([1, 1])
      expect((c.length - 2) / 6).toBe(large ? 3 : 1)
      for (const q of samplePoints(p, 16)) expect(Math.abs(dist(q, centre) - 1)).toBeLessThan(3e-4)
      expect(Math.abs(pathLength(p) / length - 1)).toBeLessThan(1e-3)
      const m = pointAt(p, 0.5).point
      expect(dist(m, mid)).toBeLessThan(1e-3)
    })
  }

  test('relative arc equals the absolute one', () => {
    expect(parsePath('M2 3 a 1 1 0 1 0 1 1')).toEqual(parsePath('M2 3 A 1 1 0 1 0 3 4'))
  })

  test('rotated ellipse: every point is on the ellipse, endpoints are exact', () => {
    const rx = 2, ry = 1, phi = (30 * Math.PI) / 180
    const p = parsePath('M 0 0 A 2 1 30 1 1 1 1.5')
    const c = p[0].coords
    expect([c[0], c[1]]).toEqual([0, 0])
    expect(c.slice(-2)).toEqual([1, 1.5])
    // undo the rotation and the radii: the arc must become part of a unit circle
    const unit = samplePoints(p, 12).map(([x, y]): Vec2 => [
      (Math.cos(phi) * x + Math.sin(phi) * y) / rx, (-Math.sin(phi) * x + Math.cos(phi) * y) / ry,
    ])
    const [a, b, d] = [unit[0], unit[Math.floor(unit.length / 2)], unit[unit.length - 1]]
    const k = 2 * (a[0] * (b[1] - d[1]) + b[0] * (d[1] - a[1]) + d[0] * (a[1] - b[1]))
    const centre: Vec2 = [
      ((a[0] ** 2 + a[1] ** 2) * (b[1] - d[1]) + (b[0] ** 2 + b[1] ** 2) * (d[1] - a[1]) + (d[0] ** 2 + d[1] ** 2) * (a[1] - b[1])) / k,
      ((a[0] ** 2 + a[1] ** 2) * (d[0] - b[0]) + (b[0] ** 2 + b[1] ** 2) * (a[0] - d[0]) + (d[0] ** 2 + d[1] ** 2) * (b[0] - a[0])) / k,
    ]
    for (const q of unit) expect(Math.abs(dist(q, centre) - 1)).toBeLessThan(1e-3)
  })

  test('radii too small for the chord are scaled up to a half turn', () => {
    const p = parsePath('M0 0 A 1 1 0 0 1 4 0')
    expect(Math.abs(pathLength(p) / (2 * Math.PI) - 1)).toBeLessThan(1e-3)
    for (const q of samplePoints(p, 8)) expect(Math.abs(dist(q, [2, 0]) - 2)).toBeLessThan(1e-3)
    // increasing angle from 180°: through (2, -2)
    expect(dist(pointAt(p, 0.5).point, [2, -2])).toBeLessThan(1e-9)
  })

  test('a zero radius is a straight line; identical endpoints draw nothing', () => {
    near(parsePath('M0 0 A 0 5 0 0 1 3 4')[0].coords, [0, 0, ...line(0, 0, 3, 4)])
    expect(parsePath('M1 1 A 5 5 0 0 1 1 1')).toEqual([])
    expect(anchors(parsePath('M1 1 A 5 5 0 0 1 1 1 L 2 2')[0])).toEqual([[1, 1], [2, 2]])
  })

  test('negative radii are taken as positive', () => {
    expect(parsePath('M0 0 A -1 -1 0 0 1 1 1')).toEqual(parsePath('M0 0 A 1 1 0 0 1 1 1'))
  })
})

describe('parsePath: errors never throw', () => {
  test('keeps everything before the error', () => {
    expect(anchors(parsePath('M0 0 L1 1 L 2')[0])).toEqual([[0, 0], [1, 1]])
    expect(anchors(parsePath('M0 0 L1 1 X 5 5')[0])).toEqual([[0, 0], [1, 1]])
    expect(anchors(parsePath('M0 0 L1 1 Z 5 5')[0])).toEqual([[0, 0], [1, 1], [0, 0]])
    expect(anchors(parsePath('M0 0 L1 1 A 1 1 0 2 1 3 3')[0])).toEqual([[0, 0], [1, 1]])
  })

  test('nothing usable gives an empty path', () => {
    expect(parsePath('')).toEqual([])
    expect(parsePath('   ')).toEqual([])
    expect(parsePath('L 1 1')).toEqual([])
    expect(parsePath('1 2 3')).toEqual([])
    expect(parsePath('M 1 2')).toEqual([])
    expect(parsePath('hello')).toEqual([])
    expect(parsePath(undefined as unknown as string)).toEqual([])
    expect(parsePath(42 as unknown as string)).toEqual([])
    expect(parsePath('M0 0 L1e999 0')).toEqual([])
  })

  test('validatePath explains the first problem, or returns null', () => {
    expect(validatePath('M0 0 L1 1 Z')).toBeNull()
    expect(validatePath('')).toBeNull()
    expect(validatePath('M0 0a1 1 0 011 1')).toBeNull()
    expect(validatePath('M 1 2 L 3')).toBe('expected a number for "L" at position 9')
    expect(validatePath('L 1 2')).toBe('path data must start with M, found "L"')
    expect(validatePath('1 2')).toBe('path data must start with M')
    expect(validatePath('M1 2 X')).toBe('unknown command "X" at position 5')
    expect(validatePath('M0 0 Z 1 1')).toBe('expected a command at position 7')
    expect(validatePath('M0 0 A 1 1 0 2 1 3 3')).toContain('arc arguments')
    expect(validatePath('M0 0 L1e999 0')).toContain('out of range')
    expect(validatePath(null as unknown as string)).toBe('path data must be a string')
  })
})

describe('toPathString', () => {
  test('lines become L, the closing edge is left to Z, curves stay C', () => {
    expect(toPathString(rectPath({ width: 2, height: 2 }))).toBe('M1 1 L-1 1 L-1 -1 L1 -1 Z')
    expect(toPathString(parsePath('M0 0 C 0 1 1 1 1 0'))).toBe('M0 0 C0 1 1 1 1 0')
    expect(toPathString(parsePath('M0 0 L1 0 M2 2 L3 3'))).toBe('M0 0 L1 0 M2 2 L3 3')
    expect(toPathString(circlePath({ radius: 1 }))).toBe(
      'M1 0 C1 0.552 0.552 1 0 1 C-0.552 1 -1 0.552 -1 0 C-1 -0.552 -0.552 -1 0 -1 C0.552 -1 1 -0.552 1 0 Z',
    )
  })

  test('precision, no negative zero, no exponent noise, bad numbers become 0', () => {
    const p: Subpath[] = [{ coords: [1 / 3, -1e-9, ...line(1 / 3, -1e-9, 2 / 3, 1e-7)], closed: false }]
    expect(toPathString(p, 2)).toBe('M0.33 0 L0.67 0')
    expect(toPathString(p, 0)).toBe('M0 0 L1 0')
    expect(toPathString(p)).toBe('M0.333 0 L0.667 0')
    expect(toPathString([{ coords: [NaN, Infinity], closed: false }])).toBe('M0 0')
  })

  test('empty and malformed input give an empty string', () => {
    expect(toPathString([])).toBe('')
    expect(toPathString(null as unknown as Subpath[])).toBe('')
    expect(toPathString([{ coords: [], closed: false }, null as unknown as Subpath])).toBe('')
  })
})

describe('round trips', () => {
  const samples = [
    'M10 10 h 80 v 80 h -80 Z',
    'M0 0 C 0 1 1 1 1 0 S 2 -1 2 0 Q 3 1 4 0 T 6 0',
    'M0 0 A 2 1 30 1 1 1 1.5 L 5 5 Z M 1 1 a 1 1 0 0 0 2 0 z',
    'm 1 1 l 2 0 l 0 2 z m 5 0 l 1 0 l 0 1 z',
  ]
  for (const d of samples) {
    test(`string → path → string is stable: ${d}`, () => {
      const once = toPathString(parsePath(d), 6)
      expect(toPathString(parsePath(once), 6)).toBe(once)
      expect(validatePath(once)).toBeNull()
    })
    test(`path → string → path keeps every number: ${d}`, () => {
      const p = parsePath(d)
      const q = parsePath(toPathString(p, 12))
      expect(q.length).toBe(p.length)
      for (let k = 0; k < p.length; k++) {
        expect(q[k].closed).toBe(p[k].closed)
        near(q[k].coords, p[k].coords, 1e-9)
      }
    })
  }

  test('200 random cubic paths survive the round trip', () => {
    const random = rng(7)
    for (let n = 0; n < 200; n++) {
      const subpaths: Subpath[] = []
      const count = 1 + Math.floor(random() * 3)
      for (let s = 0; s < count; s++) {
        const coords = [random() * 20 - 10, random() * 20 - 10]
        const segments = 1 + Math.floor(random() * 5)
        for (let j = 0; j < segments; j++) for (let q = 0; q < 6; q++) coords.push(random() * 20 - 10)
        const closed = random() < 0.5
        if (closed) { coords[coords.length - 2] = coords[0]; coords[coords.length - 1] = coords[1] }
        subpaths.push({ coords, closed })
      }
      const back = parsePath(toPathString(subpaths, 12))
      expect(back.length).toBe(subpaths.length)
      for (let k = 0; k < back.length; k++) {
        expect(back[k].closed).toBe(subpaths[k].closed)
        near(back[k].coords, subpaths[k].coords, 1e-9)
      }
    }
  })
})
