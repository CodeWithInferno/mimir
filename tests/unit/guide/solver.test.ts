// The geometry of the guide, pure: names in two columns, outlines that hug, the side a pointer rests on.
import { describe, expect, test } from 'bun:test'
import {
  boxEdge, choosePerch, convexHull, ellipseEdge, glyphAlpha, hullOutline, outlinePoints, pointerBox, segmentsCross, solveLabels, spaced, wrapLabel,
  type Box, type LabelInput, type Pt,
} from '../../../src/guide/solver.ts'

const hits = (a: Box, b: Box): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
const textBox = (slot: { x: number; y: number; side: string; width: number; height: number }): Box => ({ x: slot.side === 'left' ? slot.x - slot.width : slot.x, y: slot.y - slot.height / 2, width: slot.width, height: slot.height })

/** a figure 200 wide in the middle of a 1000 x 600 stage, parts at the given points */
const input = (at: Record<string, Pt>, more: Partial<LabelInput> = {}): LabelInput => ({
  ids: Object.keys(at), at,
  size: Object.fromEntries(Object.keys(at).map((id) => [id, { width: 80, height: 20 }])),
  figure: { left: 400, right: 600, middle: 300 },
  bounds: { left: 20, right: 980, top: 20, bottom: 540 },
  ...more,
})

describe('names in two columns', () => {
  test('each name goes to the nearer side, outside the figure, inside the free stage, and no two overlap', () => {
    const r = solveLabels(input({ a: { x: 420, y: 100 }, b: { x: 580, y: 110 }, c: { x: 430, y: 300 }, d: { x: 570, y: 305 }, e: { x: 500, y: 500 } }))
    expect(r.keep.sides).toMatchObject({ a: 'left', b: 'right', c: 'left', d: 'right' })
    expect(r.dropped).toEqual([])
    expect(r.crossings).toBe(0)
    const boxes = Object.values(r.slots).map(textBox)
    for (const b of boxes) {
      expect(b.x + b.width <= 400 || b.x >= 600).toBe(true) // beside the figure, never on it
      expect(b.x >= 20 && b.x + b.width <= 980 && b.y >= 20 && b.y + b.height <= 540).toBe(true)
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(hits(boxes[i]!, boxes[j]!)).toBe(false)
    // left names end at one line (right-aligned), right names start at one line
    expect(new Set(Object.values(r.slots).filter((s) => s.side === 'left').map((s) => s.x)).size).toBe(1)
    expect(new Set(Object.values(r.slots).filter((s) => s.side === 'right').map((s) => s.x)).size).toBe(1)
  })
  test('a leader does not pass over a coloured part when the other side is free of one', () => {
    const at = { a: { x: 560, y: 300 } }
    const free = solveLabels(input(at))
    expect(free.keep.sides.a).toBe('right')
    const blocked = solveLabels(input(at, { obstacles: [{ box: { x: 575, y: 250, width: 20, height: 120 }, ids: [], cost: 160, hued: true }] }))
    expect(blocked.keep.sides.a).toBe('left')
    expect(blocked.hued).toBe(0)
    // its own part is not an obstacle to its own leader
    const own = solveLabels(input(at, { obstacles: [{ box: { x: 575, y: 250, width: 20, height: 120 }, ids: ['a'], cost: 160, hued: true }] }))
    expect(own.keep.sides.a).toBe('right')
  })
  test('a side with no room for the text is avoided; a name that fits nowhere still stays inside the stage', () => {
    const at = { a: { x: 590, y: 300 } }
    const tight = solveLabels(input(at, { bounds: { left: 20, right: 650, top: 20, bottom: 540 } })) // 30 px to the right of the figure's gap
    expect(tight.keep.sides.a).toBe('left')
    const none = solveLabels(input(at, { bounds: { left: 380, right: 650, top: 20, bottom: 540 } }))
    const b = textBox(none.slots.a!)
    expect(b.x >= 380 && b.x + b.width <= 650).toBe(true)
  })
  test('leaders that would cross trade places: zero crossings', () => {
    // two parts on the same side whose heights are opposite to their depth in the figure
    const at = { deep: { x: 590, y: 200 }, near: { x: 410, y: 215 }, low: { x: 420, y: 205 } }
    const r = solveLabels(input(at, { tip: (id, to) => ({ x: at[id as keyof typeof at].x + Math.sign(to.x - at[id as keyof typeof at].x) * 4, y: at[id as keyof typeof at].y }) }))
    expect(r.crossings).toBe(0)
    const many: Record<string, Pt> = {}
    for (let i = 0; i < 9; i++) many['p' + i] = { x: 410 + ((i * 53) % 180), y: 80 + ((i * 97) % 400) }
    const m = solveLabels(input(many))
    expect(m.crossings).toBe(0)
    expect(Object.keys(m.slots).length).toBe(9)
  })
  test('more names than a column holds spill to the other; past both the least important are dropped', () => {
    const at: Record<string, Pt> = {}
    for (let i = 0; i < 8; i++) at['n' + i] = { x: 410, y: 100 + i * 10 }
    const r = solveLabels(input(at, { bounds: { left: 20, right: 980, top: 100, bottom: 200 } })) // room for 3 lines a side
    expect(Object.values(r.keep.sides).filter((s) => s === 'right').length).toBeGreaterThan(0)
    expect(r.dropped).toEqual(['n6', 'n7'])
    expect(Object.keys(r.slots).length).toBe(6)
  })
  test('with what was decided kept, a turning view moves the names continuously: no name changes side or jumps over another', () => {
    const pose = (turn: number): Record<string, Pt> => Object.fromEntries(Array.from({ length: 6 }, (_, i) => { const a = turn + i * 1.1; return ['p' + i, { x: 500 + 90 * Math.cos(a), y: 300 + 180 * Math.sin(a * 0.7 + i) }] }))
    const first = solveLabels(input(pose(0)))
    let before = first.slots
    let widest = 0
    for (let k = 1; k <= 200; k++) {
      const turn = k * 0.005
      const r = solveLabels(input(pose(turn), { keep: first.keep }))
      expect(r.keep).toBe(first.keep)
      for (const id of Object.keys(r.slots)) {
        expect(r.slots[id]!.side).toBe(first.slots[id]!.side)
        widest = Math.max(widest, Math.abs(r.slots[id]!.y - before[id]!.y))
      }
      before = r.slots
    }
    // the parts move at most 0.9 px per step here; a name never moves more than its part does (no hop of a line height)
    expect(widest).toBeLessThan(2)
    // the same geometry gives the same answer whatever was solved before (nothing is remembered)
    expect(solveLabels(input(pose(0.5), { keep: first.keep })).slots).toEqual(solveLabels(input(pose(0.5), { keep: first.keep })).slots)
    // at the reference pose the kept answer is the solved one
    expect(solveLabels(input(pose(0), { keep: first.keep })).slots).toEqual(first.slots)
  })
  test('spaced keeps order and distance with the least movement', () => {
    expect(spaced([0, 50, 100], [0, 27, 27])).toEqual([0, 50, 100])
    expect(spaced([10, 10], [0, 20])).toEqual([0, 20])
    const y = spaced([100, 90, 300], [0, 27, 27]) // out of order: pooled, in the order given
    expect(y[1]! - y[0]!).toBeCloseTo(27, 9)
    expect((y[0]! + y[1]!) / 2).toBeCloseTo(95, 9)
    expect(y[2]).toBe(300)
    expect(spaced([], [])).toEqual([])
  })
})

describe('a long name goes on two lines', () => {
  const measure = (s: string): number => s.length * 10
  test('short names and single words stay on one line', () => {
    expect(wrapLabel('piston', measure, 200)).toEqual({ lines: ['piston'], width: 60 })
    expect(wrapLabel('supercalifragilisticexpialidocious', measure, 200).lines.length).toBe(1)
  })
  test('a wide name is cut where the longer line is shortest', () => {
    const w = wrapLabel('exhaust valve rocker arm', measure, 200)
    expect(w.lines).toEqual(['exhaust valve', 'rocker arm'])
    expect(w.width).toBe(130)
  })
})

describe('an outline that hugs a part', () => {
  const box = (x: number, y: number, w: number, h: number): Pt[] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
  test('round a tall thin part it is a tall capsule as wide as the part, not an ellipse round its box', () => {
    const post = box(100, 100, 20, 300)
    const hug = hullOutline(post, 10)!
    expect(hug.box).toEqual({ x: 90, y: 90, width: 40, height: 320 })
    // an ellipse through the corners of that box would be 28 wide beyond the part on each side; this one is `pad` away
    expect(hug.box.width).toBeLessThan(20 * 1.22 + 20 + 1e-9)
    expect(hug.d.startsWith('M')).toBe(true)
    expect(hug.d.endsWith('Z')).toBe(true)
    expect((hug.d.match(/A/g) ?? []).length).toBe(4) // four round corners
    expect(hug.d).not.toContain('NaN')
  })
  test('a tilted part is hugged along its own direction', () => {
    const tilted = [{ x: 0, y: 0 }, { x: 20, y: -10 }, { x: 220, y: 390 }, { x: 200, y: 400 }]
    const hug = hullOutline(tilted, 10)!
    // far smaller than the box round it
    expect((hug.d.match(/A/g) ?? []).length).toBe(4)
    const corners = [...hug.d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }))
    for (const p of corners) expect(Math.min(...tilted.map((q) => Math.hypot(p.x - q.x, p.y - q.y)))).toBeCloseTo(10, 0) // every corner of the outline is `pad` from a corner of the part
  })
  test('points inside do not matter; one point is a circle, two a capsule; nothing gives nothing', () => {
    expect(convexHull([...box(0, 0, 10, 10), { x: 5, y: 5 }]).length).toBe(4)
    expect(hullOutline([{ x: 5, y: 5 }], 10)!.box).toEqual({ x: -5, y: -5, width: 20, height: 20 })
    expect(hullOutline([{ x: 0, y: 0 }, { x: 100, y: 0 }], 10)!.box).toEqual({ x: -10, y: -10, width: 120, height: 20 })
    expect(hullOutline([], 10)).toBeNull()
    expect(hullOutline([{ x: NaN, y: 0 }], 10)).toBeNull()
  })
})

describe('where the pointer rests', () => {
  const part: Box = { x: 400, y: 300, width: 100, height: 60 }
  const base = { center: { x: 450, y: 330 }, edge: (dir: Pt) => boxEdge(part, dir), length: 20, halfWidth: 7, bounds: { x: 0, y: 0, width: 1280, height: 720 }, prefer: -35 }
  test('on free space it hangs below right of its part, tip on the edge, body outside', () => {
    const p = choosePerch({ ...base, texts: [] })
    expect(p.angle).toBe(-35)
    expect(p.covers).toBe(false)
    expect(p.tip.y).toBeCloseTo(360, 6) // on the bottom edge
    expect(hits(pointerBox({ x: p.tip.x + p.dir.x, y: p.tip.y + p.dir.y }, p.dir, 20, 7), part)).toBe(false)
  })
  test('text below the part: it rests on another side and covers no text', () => {
    const text: Box = { x: 380, y: 362, width: 160, height: 24 }
    const p = choosePerch({ ...base, texts: [text] })
    expect(p.covers).toBe(false)
    expect(p.angle).not.toBe(-35)
    expect(hits(pointerBox(p.tip, p.dir, 20, 7), text)).toBe(false)
  })
  test('the part is text itself: the pointer stands beside the words, not on them', () => {
    const p = choosePerch({ ...base, texts: [part] })
    expect(p.covers).toBe(false)
    expect(hits(pointerBox({ x: p.tip.x + p.dir.x * 0.01, y: p.tip.y + p.dir.y * 0.01 }, p.dir, 20, 7), part)).toBe(false)
  })
  test('it stays on the stage, and prefers a side with no other object', () => {
    const corner: Box = { x: 1200, y: 660, width: 70, height: 50 }
    const p = choosePerch({ ...base, center: { x: 1235, y: 685 }, edge: (dir) => boxEdge(corner, dir), texts: [] })
    const b = pointerBox(p.tip, p.dir, 20, 7)
    expect(b.x >= 0 && b.y >= 0 && b.x + b.width <= 1280 && b.y + b.height <= 720).toBe(true)
    const crowded = choosePerch({ ...base, texts: [], others: [{ x: 440, y: 362, width: 120, height: 60 }] })
    expect(hits(pointerBox(crowded.tip, crowded.dir, 20, 7), { x: 440, y: 362, width: 120, height: 60 })).toBe(false)
  })
  test('text on every side: the side that covers least, and it says so', () => {
    const wall: Box = { x: 0, y: 0, width: 1280, height: 720 }
    const p = choosePerch({ ...base, texts: [wall] })
    expect(p.covers).toBe(true)
    expect(Number.isFinite(p.tip.x + p.tip.y)).toBe(true)
  })
  test('edges of a box and of the ellipse inside it', () => {
    expect(boxEdge(part, { x: 1, y: 0 })).toEqual({ x: 500, y: 330 })
    expect(ellipseEdge(part, { x: 0, y: -1 })).toEqual({ x: 450, y: 300 })
    const d = { x: Math.SQRT1_2, y: Math.SQRT1_2 }, e = ellipseEdge(part, d)
    expect(((e.x - 450) / 50) ** 2 + ((e.y - 330) / 30) ** 2).toBeCloseTo(1, 9)
  })
})

describe('small things', () => {
  test('glyphs are written in reading order, each a little after the one before, all whole at the end', () => {
    const n = 8
    const at = (p: number): number[] => Array.from({ length: n }, (_, i) => glyphAlpha(p, i, n))
    expect(at(0)).toEqual(new Array(n).fill(0))
    expect(at(1)).toEqual(new Array(n).fill(1))
    const mid = at(0.4)
    for (let i = 1; i < n; i++) expect(mid[i]!).toBeLessThanOrEqual(mid[i - 1]!)
    expect(mid[0]!).toBeGreaterThan(mid[n - 1]!)
    expect(glyphAlpha(0.5, 0, 1)).toBeCloseTo(0.5, 9)
  })
  test('segments cross only when they really do', () => {
    expect(segmentsCross({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(true)
    expect(segmentsCross({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 })).toBe(false)
    expect(segmentsCross({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 5 })).toBe(false) // a shared end is not a crossing
  })
})

describe('a column stands beside the figure at the heights of its names', () => {
  // a machine with a narrow head (100 wide) on a wide base plate (600 wide) low down
  const head: Box = { x: 450, y: 60, width: 100, height: 300 }, base: Box = { x: 200, y: 420, width: 600, height: 60 }
  const corners = (b: Box): Pt[] => [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height }]
  const machine = (at: Record<string, Pt>, parts: Box[] | undefined): LabelInput => ({ ...input(at), figure: { left: 200, right: 800, middle: 270 }, silhouette: parts?.flatMap((b) => outlinePoints(corners(b), 5)) })
  test('names of the head are not pushed out by the base plate', () => {
    const at = { a: { x: 470, y: 100 }, b: { x: 530, y: 160 } }
    const wide = solveLabels(machine(at, undefined)), near = solveLabels(machine(at, [head, base]))
    expect(wide.slots.a!.x).toBe(180) // beside the whole silhouette
    expect(near.slots.a!.x).toBe(430) // beside the head
    expect(near.slots.b!.x).toBe(570)
    for (const s of Object.values(near.slots)) expect(hits(textBox(s), head) || hits(textBox(s), base)).toBe(false)
  })
  test('a name at the height of the base stands outside the base', () => {
    const r = solveLabels(machine({ plate: { x: 300, y: 450 } }, [head, base]))
    expect(r.slots.plate!.side).toBe('left')
    expect(r.slots.plate!.x).toBe(180)
  })
  test('a tilted plate keeps names away only where it is: the outline counts, not the box round it', () => {
    // a plate seen from above right: its box reaches up to y 300 on the left, the plate itself is far lower there
    const plate: Pt[] = [{ x: 100, y: 420 }, { x: 500, y: 300 }, { x: 800, y: 380 }, { x: 400, y: 520 }]
    const solve = (plateOutline: Pt[]) => solveLabels({ ...input({ a: { x: 470, y: 150 } }), figure: { left: 100, right: 800, middle: 300 }, silhouette: [...outlinePoints(corners(head), 5), ...plateOutline], keep: { sides: { a: 'left' }, rank: { a: 0 }, offset: { a: 0 } } })
    const outline = solve(outlinePoints(plate, 5)), boxed = solve(outlinePoints(corners({ x: 100, y: 300, width: 700, height: 220 }), 5))
    expect(boxed.slots.a!.x).toBeCloseTo(100 + (300 - 160) - 20, 6) // the box of the plate reaches up to y 300 at its left edge
    expect(outline.slots.a!.x).toBeGreaterThan(boxed.slots.a!.x + 100) // the plate itself is far lower there
  })
  test('the column moves continuously as its names come down toward the base', () => {
    let before = NaN
    const keep = solveLabels(machine({ a: { x: 470, y: 100 } }, [head, base])).keep
    for (let y = 100; y <= 400; y += 1) {
      const x = solveLabels({ ...machine({ a: { x: 470, y } }, [head, base]), keep }).slots.a!.x
      if (!Number.isNaN(before)) expect(Math.abs(x - before)).toBeLessThanOrEqual(1 + 1e-9) // never faster than its name moves
      before = x
    }
    expect(before).toBeLessThan(430)
  })
})
