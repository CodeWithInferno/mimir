import { describe, expect, test } from 'bun:test'
import type { Rect } from '../../../../src/lib/types.ts'
import { placeLabels, type PlaceLabelsInput, type PlacedLabel } from '../../../../src/lib/layout/index.ts'
import { labelRect, leaderCrossings, onBorder, overlaps, seeded, withoutClockOrRandom } from './helpers.ts'

const safeArea: Rect = { x: -6.6, y: -3.5, width: 13.2, height: 7 }

/** Everything a placement must satisfy; an empty list means it does. */
function labelProblems(input: PlaceLabelsInput, labels: PlacedLabel[]): string[] {
  const problems: string[] = []
  if (labels.length !== input.anchors.length) return [`${labels.length} labels for ${input.anchors.length} anchors`]
  const rects = labels.map(label => labelRect(label, input.sizes))
  const b = input.bounds
  labels.forEach((label, i) => {
    const anchor = input.anchors[i]!, r = rects[i]!
    if (label.id !== anchor.id) problems.push(`label ${i} is ${label.id}, expected ${anchor.id}`)
    if (r.x < b.x - 1e-9 || r.y < b.y - 1e-9 || r.x + r.width > b.x + b.width + 1e-9 || r.y + r.height > b.y + b.height + 1e-9) problems.push(`${label.id} is outside the bounds`)
    if (anchor.avoid && overlaps(r, anchor.avoid)) problems.push(`${label.id} covers its own part`)
    if (anchor.x > r.x + 1e-9 && anchor.x < r.x + r.width - 1e-9 && anchor.y > r.y + 1e-9 && anchor.y < r.y + r.height - 1e-9) problems.push(`${label.id} covers its own anchor`)
    if (label.leader[0][0] !== anchor.x || label.leader[0][1] !== anchor.y) problems.push(`${label.id} leader does not start at the anchor`)
    if (!onBorder(label.leader[1], r)) problems.push(`${label.id} leader does not end on the label border`)
    const yDown = input.yDown === true
    const ok = label.side === 'right' ? r.x >= anchor.x - 1e-9
      : label.side === 'left' ? r.x + r.width <= anchor.x + 1e-9
        : (label.side === 'top') !== yDown ? label.y >= anchor.y : label.y <= anchor.y
    if (!ok) problems.push(`${label.id} says ${label.side} but is not there`)
    for (let j = i + 1; j < labels.length; j++) if (overlaps(r, rects[j]!)) problems.push(`${label.id} overlaps ${labels[j]!.id}`)
  })
  return problems
}

/** A cutaway engine: parts stacked inside a block, anchors at the part centres. */
function engineScene(pistonShift = 0): PlaceLabelsInput {
  const parts: [string, number, number, number, number, string][] = [
    ['plug', -0.15, 1.9, 0.3, 0.7, 'spark plug'], ['intake', -0.9, 1.5, 0.5, 0.6, 'intake valve'],
    ['exhaust', 0.4, 1.5, 0.5, 0.6, 'exhaust valve'], ['piston', -0.8, 0.2 + pistonShift, 1.6, 0.9, 'piston'],
    ['rod', -0.2, -1.2 + pistonShift / 2, 0.4, 1.5, 'connecting rod'], ['crank', -0.9, -2.4, 1.8, 1.2, 'crankshaft'],
    ['block', -1.2, -2.6, 2.4, 4.6, 'cylinder block'],
  ]
  const sizes: Record<string, { width: number; height: number }> = {}
  const anchors = parts.map(([id, x, y, width, height, text]) => {
    sizes[id] = { width: 0.35 + text.length * 0.13, height: 0.42 }
    return { id, x: x + width / 2, y: y + height / 2, avoid: { x, y, width, height } }
  })
  return { anchors, sizes, bounds: safeArea }
}

function ringScene(count: number, radius = 2.2): PlaceLabelsInput {
  const anchors = Array.from({ length: count }, (_, i) => ({ id: `p${i}`, x: radius * Math.cos(i * 2 * Math.PI / count + 0.1), y: radius * Math.sin(i * 2 * Math.PI / count + 0.1) }))
  const sizes: Record<string, { width: number; height: number }> = {}
  anchors.forEach((anchor, i) => { sizes[anchor.id] = { width: 1.2 + (i % 3) * 0.4, height: 0.42 } })
  return { anchors, sizes, bounds: safeArea }
}

function stressScene(seed: number, count = 40): PlaceLabelsInput {
  const random = seeded(seed)
  const anchors = Array.from({ length: count }, (_, i) => ({ id: `L${i}`, x: (random() - 0.5) * 8, y: (random() - 0.5) * 5 }))
  const sizes: Record<string, { width: number; height: number }> = {}
  for (const anchor of anchors) sizes[anchor.id] = { width: 1.0 + random() * 0.8, height: 0.36 }
  return { anchors, sizes, bounds: safeArea }
}

describe('placeLabels: the rules', () => {
  test('a single label sits just right of its anchor', () => {
    const input: PlaceLabelsInput = { anchors: [{ id: 'a', x: 1, y: 2 }], sizes: { a: { width: 2, height: 0.5 } }, bounds: safeArea, gap: 0.3 }
    const [label] = placeLabels(input)
    expect(label!.id).toBe('a')
    expect(label!.side).toBe('right')
    expect(label!.x).toBeCloseTo(1 + 0.3 + 1, 12)                  // anchor + gap + half the width
    expect(label!.y).toBe(2)
    expect(label!.leader[0]).toEqual([1, 2])
    expect(label!.leader[1][0]).toBeCloseTo(1.3, 12)
    expect(label!.leader[1][1]).toBe(2)
    expect(labelProblems(input, [label!])).toEqual([])
  })

  test('a label stays outside its part, flush plus the gap', () => {
    const avoid = { x: -1, y: -1, width: 2, height: 2 }
    const input: PlaceLabelsInput = { anchors: [{ id: 'a', x: 0, y: 0, avoid }], sizes: { a: { width: 2, height: 0.5 } }, bounds: safeArea, gap: 0.25 }
    const [label] = placeLabels(input)
    expect(label!.side).toBe('right')
    expect(label!.x - 1).toBeCloseTo(1 + 0.25, 12)                 // left edge = part edge + gap
    expect(label!.leader[1]).toEqual([1.25, 0])
    expect(labelProblems(input, [label!])).toEqual([])
  })

  test('engine cutaway: outside every own part, no overlaps, no crossed leaders, inside the safe area', () => {
    const input = engineScene()
    const labels = placeLabels(input)
    expect(labelProblems(input, labels)).toEqual([])
    expect(leaderCrossings(labels)).toBe(0)
    // inner parts leave the housing too: nothing but the block's own label may touch the block
    const block = input.anchors.find(a => a.id === 'block')!.avoid!
    for (const label of labels) expect({ id: label.id, onBlock: overlaps(labelRect(label, input.sizes), block) }).toEqual({ id: label.id, onBlock: false })
  })

  test('labels around a ring point outwards and never cross', () => {
    for (const count of [3, 6, 10, 14]) {
      const input = ringScene(count)
      const labels = placeLabels(input)
      expect({ count, problems: labelProblems(input, labels) }).toEqual({ count, problems: [] })
      expect({ count, crossings: leaderCrossings(labels) }).toEqual({ count, crossings: 0 })
      for (let i = 0; i < count; i++) {
        const anchor = input.anchors[i]!, label = labels[i]!
        // further from the centre than its anchor
        expect(Math.hypot(label.x, label.y)).toBeGreaterThan(Math.hypot(anchor.x, anchor.y))
      }
    }
  })

  test('a tight column of anchors fans out into one tidy stack with no crossings', () => {
    const anchors = Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, x: -1 + (i % 2) * 0.3, y: -1.2 + i * 0.4 }))
    const sizes = Object.fromEntries(anchors.map(a => [a.id, { width: 1.5, height: 0.42 }]))
    const input: PlaceLabelsInput = { anchors, sizes, bounds: safeArea, obstacles: [{ x: -6.6, y: -3.5, width: 5.2, height: 7 }] }
    const labels = placeLabels(input)
    expect(labelProblems(input, labels)).toEqual([])
    expect(leaderCrossings(labels)).toBe(0)
    expect(labels.map(l => l.side)).toEqual(Array(7).fill('right'))   // the left half is an obstacle
    // stacked in anchor order, bottom to top
    const ys = labels.map(l => l.y)
    for (let i = 1; i < ys.length; i++) expect(ys[i]!).toBeGreaterThan(ys[i - 1]!)
    for (const label of labels) expect(overlaps(labelRect(label, sizes), input.obstacles![0]!)).toBe(false)
  })

  test('obstacles are avoided when there is room elsewhere', () => {
    const anchor = { id: 'a', x: 0, y: 0 }
    const sizes = { a: { width: 2, height: 0.5 } }
    const right = { x: 0.1, y: -2, width: 6, height: 4 }
    const labels = placeLabels({ anchors: [anchor], sizes, bounds: safeArea, obstacles: [right] })
    expect(labels[0]!.side).toBe('left')
    const both = placeLabels({ anchors: [anchor], sizes, bounds: safeArea, obstacles: [right, { x: -6.1, y: -2, width: 6, height: 4 }] })
    expect(['top', 'bottom']).toContain(both[0]!.side)
    expect(overlaps(labelRect(both[0]!, sizes), right)).toBe(false)
  })

  test('labels near the edge of the bounds turn inwards', () => {
    const sizes = { a: { width: 2, height: 0.5 } }
    const right = placeLabels({ anchors: [{ id: 'a', x: 6.2, y: 0 }], sizes, bounds: safeArea })
    expect(right[0]!.side).not.toBe('right')
    const corner: PlaceLabelsInput = { anchors: [{ id: 'a', x: 6.5, y: 3.4 }], sizes, bounds: safeArea }
    expect(labelProblems(corner, placeLabels(corner))).toEqual([])
  })

  test("'top' follows the screen in both spaces", () => {
    const sizes = { a: { width: 2, height: 0.5 } }
    const walls = [{ x: 1.2, y: -3.5, width: 5.4, height: 7 }, { x: -6.6, y: -3.5, width: 5.4, height: 7 }]   // a corridor 2.4 wide
    // frame space: only the space above (larger y) is free
    const frame = placeLabels({ anchors: [{ id: 'a', x: 0, y: 0 }], sizes, bounds: safeArea, obstacles: [...walls, { x: -6.6, y: -3.5, width: 13.2, height: 3.4 }] })
    expect(frame[0]!.side).toBe('top')
    expect(frame[0]!.y).toBeGreaterThan(0)
    // screen space: smaller y is the top; block the larger-y half
    const screen = placeLabels({ anchors: [{ id: 'a', x: 0, y: 0 }], sizes, bounds: safeArea, yDown: true, obstacles: [...walls, { x: -6.6, y: 0.1, width: 13.2, height: 3.4 }] })
    expect(screen[0]!.side).toBe('top')
    expect(screen[0]!.y).toBeLessThan(0)
  })

  test('order: the label named first gets the spot both want', () => {
    const anchors = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 0, y: 0.1 }]
    const sizes = { a: { width: 2, height: 0.5 }, b: { width: 2, height: 0.5 } }
    const walls = [{ x: -6.6, y: -3.5, width: 6.5, height: 7 }]
    const aFirst = placeLabels({ anchors, sizes, bounds: safeArea, obstacles: walls, order: ['a', 'b'] })
    const bFirst = placeLabels({ anchors, sizes, bounds: safeArea, obstacles: walls, order: ['b', 'a'] })
    expect(aFirst[0]!.y).toBeCloseTo(0, 12)                         // a level with its anchor
    expect(bFirst[1]!.y).toBeCloseTo(0.1, 12)                       // b level with its anchor
    expect(aFirst.map(l => l.id)).toEqual(['a', 'b'])               // output order is always the input order
    expect(bFirst.map(l => l.id)).toEqual(['a', 'b'])
  })
})

describe('placeLabels: stress and odd input', () => {
  test('40 random labels: no overlaps, all inside, for ten different seeds', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const input = stressScene(seed)
      const labels = placeLabels(input)
      expect({ seed, problems: labelProblems(input, labels) }).toEqual({ seed, problems: [] })
      expect(leaderCrossings(labels)).toBeLessThanOrEqual(2)
    }
  })

  // The target of the library is 5 ms. A wall clock on a shared machine (other suites, a CI runner) cannot hold a
  // test to that, so the target itself is asserted with MIMIR_PERF=1 on a quiet machine; every run asserts it with
  // PERF_SLACK times the room, which still catches an algorithm that has gone quadratic.
  const PERF_SLACK = process.env.MIMIR_PERF === '1' ? 1 : 20
  test(`40 labels finish under 5 ms (asserted as ${5 * PERF_SLACK} ms${PERF_SLACK === 1 ? '' : '; MIMIR_PERF=1 asserts the target'})`, () => {
    const input = stressScene(5)
    for (let i = 0; i < 20; i++) placeLabels(input)                 // let the JIT settle
    const times: number[] = []
    for (let i = 0; i < 31; i++) {
      const start = performance.now()
      placeLabels(input)
      times.push(performance.now() - start)
    }
    times.sort((a, b) => a - b)
    expect(times[0]!).toBeLessThan(5 * PERF_SLACK)                  // the best run: what the work costs when nothing interrupts it
  })

  test('deterministic, no clock, no Math.random, input untouched', () => {
    const input = stressScene(3)
    const before = JSON.stringify(input)
    const first = withoutClockOrRandom(() => placeLabels(input))
    const second = withoutClockOrRandom(() => placeLabels(JSON.parse(before) as PlaceLabelsInput))
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    expect(JSON.stringify(input)).toBe(before)
  })

  test('crowded beyond what fits still returns a finite spot for every label', () => {
    const anchors = Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, x: (i % 6) * 0.1, y: Math.floor(i / 6) * 0.1 }))
    const sizes = Object.fromEntries(anchors.map(a => [a.id, { width: 1.5, height: 0.5 }]))
    const tiny = { x: -1.5, y: -1, width: 3.5, height: 2.5 }
    const labels = placeLabels({ anchors, sizes, bounds: tiny })
    expect(labels).toHaveLength(30)
    for (const label of labels) {
      expect(Number.isFinite(label.x + label.y + label.leader[1][0] + label.leader[1][1])).toBe(true)
      const r = labelRect(label, sizes)
      expect(r.x).toBeGreaterThanOrEqual(tiny.x - 1e-9)
      expect(r.x + r.width).toBeLessThanOrEqual(tiny.x + tiny.width + 1e-9)
      expect(r.y).toBeGreaterThanOrEqual(tiny.y - 1e-9)
      expect(r.y + r.height).toBeLessThanOrEqual(tiny.y + tiny.height + 1e-9)
    }
  })

  test('missing sizes, missing bounds, labels larger than the bounds, part filling the bounds', () => {
    expect(placeLabels({ anchors: [], sizes: {}, bounds: safeArea })).toEqual([])
    const noSize = placeLabels({ anchors: [{ id: 'a', x: 0, y: 0 }], sizes: {}, bounds: safeArea })
    expect(Number.isFinite(noSize[0]!.x + noSize[0]!.y)).toBe(true)
    const noBounds = placeLabels({ anchors: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 0.1, y: 0 }], sizes: { a: { width: 2, height: 0.5 }, b: { width: 2, height: 0.5 } }, bounds: undefined as unknown as Rect })
    expect(overlaps(labelRect(noBounds[0]!, { a: { width: 2, height: 0.5 } }), labelRect(noBounds[1]!, { b: { width: 2, height: 0.5 } }))).toBe(false)
    const huge = placeLabels({ anchors: [{ id: 'a', x: 0, y: 0 }], sizes: { a: { width: 50, height: 0.5 } }, bounds: safeArea })
    expect(Number.isFinite(huge[0]!.x + huge[0]!.y)).toBe(true)
    const filled = placeLabels({ anchors: [{ id: 'a', x: 0, y: 0, avoid: safeArea }], sizes: { a: { width: 2, height: 0.5 } }, bounds: safeArea })
    const r = labelRect(filled[0]!, { a: { width: 2, height: 0.5 } })
    expect(r.x >= safeArea.x && r.x + r.width <= safeArea.x + safeArea.width).toBe(true)   // inside wins when outside is impossible
  })

  test('pixel units work the same as frame units', () => {
    const frame = engineScene()
    const scale = 90
    const px: PlaceLabelsInput = {
      anchors: frame.anchors.map(a => ({ id: a.id, x: a.x * scale, y: a.y * scale, avoid: { x: a.avoid!.x * scale, y: a.avoid!.y * scale, width: a.avoid!.width * scale, height: a.avoid!.height * scale } })),
      sizes: Object.fromEntries(Object.entries(frame.sizes).map(([id, s]) => [id, { width: s.width * scale, height: s.height * scale }])),
      bounds: { x: safeArea.x * scale, y: safeArea.y * scale, width: safeArea.width * scale, height: safeArea.height * scale },
    }
    const a = placeLabels(frame), b = placeLabels(px)
    expect(b.map(l => l.side)).toEqual(a.map(l => l.side))
    b.forEach((label, i) => { expect(label.x / scale).toBeCloseTo(a[i]!.x, 6); expect(label.y / scale).toBeCloseTo(a[i]!.y, 6) })
  })
})

describe('placeLabels: stability', () => {
  test('without a hint, a tiny anchor move does not flip any side', () => {
    const base = placeLabels(engineScene())
    for (const shift of [1e-4, -1e-4, 1e-3, -1e-3]) {
      const moved = placeLabels(engineScene(shift))
      expect(moved.map(l => l.side)).toEqual(base.map(l => l.side))
      moved.forEach((label, i) => expect(Math.hypot(label.x - base[i]!.x, label.y - base[i]!.y)).toBeLessThan(0.01))
    }
  })

  test('with the previous result as a hint, labels stay exactly where they were while the part moves a little', () => {
    let previous = placeLabels(engineScene())
    const start = previous
    for (let frame = 1; frame <= 20; frame++) {
      const shift = 0.1 * Math.sin(frame / 20 * 2 * Math.PI)        // piston bobs +-0.1
      const input = { ...engineScene(shift), previous }
      const labels = placeLabels(input)
      expect(labelProblems(input, labels)).toEqual([])
      expect(labels.map(l => l.side)).toEqual(start.map(l => l.side))
      labels.forEach((label, i) => { expect(label.x).toBe(start[i]!.x); expect(label.y).toBe(start[i]!.y) })
      // the leader follows the moving anchor
      expect(labels[3]!.leader[0][1]).toBeCloseTo(0.65 + shift, 12)
      previous = labels
    }
  })

  test('over a full stroke the labels never flip sides and stay legal in every frame', () => {
    let previous = placeLabels(engineScene(0))
    const start = previous
    let moves = 0
    for (let frame = 1; frame <= 60; frame++) {
      const shift = 0.6 * Math.sin(frame / 60 * 2 * Math.PI)        // a real stroke: +-0.6
      const input = { ...engineScene(shift), previous }
      const labels = placeLabels(input)
      expect({ frame, problems: labelProblems(input, labels) }).toEqual({ frame, problems: [] })
      expect({ frame, sides: labels.map(l => l.side) }).toEqual({ frame, sides: start.map(l => l.side) })
      expect(leaderCrossings(labels)).toBe(0)
      labels.forEach((label, i) => { if (label.x !== previous[i]!.x || label.y !== previous[i]!.y) moves++ })
      previous = labels
    }
    expect(moves).toBeLessThanOrEqual(8)                            // labels sit still; a few repositions at most
  })

  test('a hint that is no longer legal is dropped, not obeyed', () => {
    const input = engineScene()
    const bad = input.anchors.map(a => ({ id: a.id, x: a.x, y: a.y, side: 'left' as const }))   // every label on its own anchor
    const labels = placeLabels({ ...input, previous: bad })
    expect(labelProblems(input, labels)).toEqual([])
  })

  test('the hint keeps a side that a fresh solve would not pick', () => {
    const anchors = [{ id: 'a', x: 0, y: 0 }]
    const sizes = { a: { width: 2, height: 0.5 } }
    const fresh = placeLabels({ anchors, sizes, bounds: safeArea })
    expect(fresh[0]!.side).toBe('right')
    const hinted = placeLabels({ anchors, sizes, bounds: safeArea, previous: [{ id: 'a', x: -1.3, y: 0, side: 'left' }] })
    expect(hinted[0]!.side).toBe('left')
    expect(hinted[0]!.x).toBe(-1.3)
    // and when the old spot itself is gone (anchor jumped far away), the old side still wins
    const jumped = placeLabels({ anchors: [{ id: 'a', x: 3, y: 1 }], sizes, bounds: safeArea, previous: [{ id: 'a', x: -1.3, y: 0, side: 'left' }] })
    expect(jumped[0]!.side).toBe('left')
    expect(Math.abs(jumped[0]!.y - 1)).toBeLessThan(1e-9)
  })
})
