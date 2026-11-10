import { describe, expect, test } from 'bun:test'
import {
  arrangeColumn, arrangeGrid, arrangeRing, arrangeRow, fitInto, nextTo, rectFromCenter, rectIntersects,
  type Arrangement, type Size,
} from '../../../../src/lib/layout/index.ts'

const sizes: Size[] = [{ width: 2, height: 1 }, { width: 1, height: 3 }, { width: 3, height: 2 }]

function rects(arrangement: Arrangement, list: Size[]) {
  return arrangement.positions.map((p, i) => rectFromCenter(p[0], p[1], list[i]!.width, list[i]!.height))
}

function expectInsideAndApart(arrangement: Arrangement, list: Size[]): void {
  const boxes = rects(arrangement, list)
  const b = arrangement.bounds
  for (const r of boxes) {
    expect(r.x).toBeGreaterThanOrEqual(b.x - 1e-9)
    expect(r.y).toBeGreaterThanOrEqual(b.y - 1e-9)
    expect(r.x + r.width).toBeLessThanOrEqual(b.x + b.width + 1e-9)
    expect(r.y + r.height).toBeLessThanOrEqual(b.y + b.height + 1e-9)
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(rectIntersects(boxes[i]!, boxes[j]!, 1e-9)).toBe(false)
}

describe('arrangeRow', () => {
  test('flush left to right with the gap, centred on the origin', () => {
    const row = arrangeRow(sizes, { gap: 0.5 })
    expect(row.bounds).toEqual({ x: -3.5, y: -1.5, width: 7, height: 3 })
    expect(row.positions).toEqual([[-2.5, 0], [-0.5, 0], [2, 0]])
    expectInsideAndApart(row, sizes)
  })

  test('align top / bottom lines up that edge; yDown flips which way top is', () => {
    const top = arrangeRow(sizes, { gap: 0.5, align: 'top' })
    expect(top.positions.map((p, i) => p[1] + sizes[i]!.height / 2)).toEqual([1.5, 1.5, 1.5])
    const bottom = arrangeRow(sizes, { gap: 0.5, align: 'bottom' })
    expect(bottom.positions.map((p, i) => p[1] - sizes[i]!.height / 2)).toEqual([-1.5, -1.5, -1.5])
    const screen = arrangeRow(sizes, { gap: 0.5, align: 'top', yDown: true })
    expect(screen.positions.map((p, i) => p[1] - sizes[i]!.height / 2)).toEqual([-1.5, -1.5, -1.5])
    expectInsideAndApart(top, sizes)
    expectInsideAndApart(screen, sizes)
  })

  test('default gap is 0.25; empty and single inputs work', () => {
    expect(arrangeRow([{ width: 1, height: 1 }, { width: 1, height: 1 }]).bounds.width).toBe(2.25)
    expect(arrangeRow([])).toEqual({ positions: [], bounds: { x: -0, y: -0, width: 0, height: 0 } })
    expect(arrangeRow([{ width: 2, height: 1 }]).positions).toEqual([[0, 0]])
  })
})

describe('arrangeColumn', () => {
  test('first item on top in frame space, and on top (smaller y) in screen space', () => {
    const column = arrangeColumn(sizes, { gap: 0.5 })
    expect(column.bounds).toEqual({ x: -1.5, y: -3.5, width: 3, height: 7 })
    expect(column.positions).toEqual([[0, 3], [0, 0.5], [0, -2.5]])
    const screen = arrangeColumn(sizes, { gap: 0.5, yDown: true })
    expect(screen.positions).toEqual([[0, -3], [0, -0.5], [0, 2.5]])
    expectInsideAndApart(column, sizes)
  })

  test('align left / right', () => {
    const left = arrangeColumn(sizes, { align: 'left' })
    expect(left.positions.map((p, i) => p[0] - sizes[i]!.width / 2)).toEqual([-1.5, -1.5, -1.5])
    const right = arrangeColumn(sizes, { align: 'right' })
    expect(right.positions.map((p, i) => p[0] + sizes[i]!.width / 2)).toEqual([1.5, 1.5, 1.5])
  })
})

describe('arrangeGrid', () => {
  test('reading order, columns as wide as their widest item', () => {
    const five: Size[] = [{ width: 1, height: 1 }, { width: 2, height: 1 }, { width: 1, height: 2 }, { width: 3, height: 1 }, { width: 1, height: 1 }]
    const grid = arrangeGrid(five, { cols: 2, gap: 0.5 })
    // columns 1 and 3 wide, rows 1, 2 and 1 tall
    expect(grid.bounds).toEqual({ x: -2.25, y: -2.5, width: 4.5, height: 5 })
    expect(grid.positions).toEqual([[-1.75, 2], [0.75, 2], [-1.75, 0], [0.75, 0], [-1.75, -2]])
    expectInsideAndApart(grid, five)
    const left = arrangeGrid(five, { cols: 2, gap: 0.5, align: 'left' })
    expect(left.positions[1]).toEqual([0.25, 2])                       // the 2-wide item hugs the left of its 3-wide column
  })

  test('grid of equal cells: no overlaps, inside bounds, default cols is a square', () => {
    const cells: Size[] = Array.from({ length: 7 }, () => ({ width: 1, height: 0.5 }))
    const grid = arrangeGrid(cells, { gap: [0.2, 0.1] })
    expectInsideAndApart(grid, cells)
    expect(grid.bounds.width).toBeCloseTo(3 * 1 + 2 * 0.2, 12)       // 3 columns
    expect(grid.bounds.height).toBeCloseTo(3 * 0.5 + 2 * 0.1, 12)    // 3 rows
    expect(grid.positions[0]![1]).toBeGreaterThan(grid.positions[3]![1])
    expect(arrangeGrid(cells, { yDown: true }).positions[0]![1]).toBeLessThan(arrangeGrid(cells, { yDown: true }).positions[3]![1])
  })

  test('bad cols fall back instead of throwing', () => {
    const cells: Size[] = Array.from({ length: 4 }, () => ({ width: 1, height: 1 }))
    expect(arrangeGrid(cells, { cols: 0 }).positions).toHaveLength(4)
    expect(arrangeGrid(cells, { cols: NaN }).positions).toHaveLength(4)
    expect(arrangeGrid(cells, { cols: 99 }).bounds.height).toBe(1)
    expect(arrangeGrid([]).positions).toEqual([])
  })
})

describe('arrangeRing', () => {
  test('first item on top, then clockwise, all at the radius', () => {
    const four: Size[] = Array.from({ length: 4 }, () => ({ width: 1, height: 1 }))
    const ring = arrangeRing(four, { radius: 3 })
    expect(ring.positions[0]).toEqual([0, 3])
    expect(ring.positions[1]![0]).toBeCloseTo(3, 12)
    expect(ring.positions[1]![1]).toBe(0)
    expect(ring.positions[2]![1]).toBeCloseTo(-3, 12)
    expect(ring.positions[3]![0]).toBeCloseTo(-3, 12)
    expect(ring.bounds).toEqual({ x: -3.5, y: -3.5, width: 7, height: 7 })
    const screen = arrangeRing(four, { radius: 3, yDown: true })
    expect(screen.positions[0]).toEqual([0, -3])                       // still on top
    expect(screen.positions[1]![0]).toBeCloseTo(3, 12)                 // still clockwise as seen
    const counter = arrangeRing(four, { radius: 3, clockwise: false })
    expect(counter.positions[1]![0]).toBeCloseTo(-3, 12)
  })

  test('automatic radius keeps neighbours apart for any count', () => {
    for (const count of [1, 2, 3, 5, 8, 13]) {
      const items: Size[] = Array.from({ length: count }, (_, i) => ({ width: 1 + (i % 3) * 0.5, height: 0.6 }))
      const ring = arrangeRing(items, { gap: 0.3 })
      expectInsideAndApart(ring, items)
    }
    expect(arrangeRing([{ width: 1, height: 1 }]).positions).toEqual([[0, 0]])
    expect(arrangeRing([]).positions).toEqual([])
  })
})

describe('nextTo', () => {
  const target = { x: 1, y: 1, width: 4, height: 2 }
  const size = { width: 2, height: 1 }

  test('each side is flush plus the gap', () => {
    expect(nextTo(target, size, 'right', 0.5)).toEqual([6.5, 2])
    expect(nextTo(target, size, 'left', 0.5)).toEqual([-0.5, 2])
    expect(nextTo(target, size, 'up', 0.5)).toEqual([3, 4])
    expect(nextTo(target, size, 'down', 0.5)).toEqual([3, 0])
    expect(nextTo(target, size)).toEqual([6.25, 2])                    // defaults: right, 0.25
  })

  test('vectors work like names; diagonals sit at the corner', () => {
    expect(nextTo(target, size, [1, 0], 0.5)).toEqual(nextTo(target, size, 'right', 0.5))
    expect(nextTo(target, size, [0, -1, 0], 0.5)).toEqual(nextTo(target, size, 'down', 0.5))
    expect(nextTo(target, size, [1, 1], 0.5)).toEqual([6.5, 4])
    expect(nextTo(target, size, [0, 0], 0.5)).toEqual([6.5, 2])
  })

  test('align lines up an edge', () => {
    expect(nextTo(target, size, 'right', 0.5, 'top')).toEqual([6.5, 2.5])
    expect(nextTo(target, size, 'right', 0.5, 'bottom')).toEqual([6.5, 1.5])
    expect(nextTo(target, size, 'up', 0.5, 'left')).toEqual([2, 4])
    expect(nextTo(target, size, 'up', 0.5, 'right')).toEqual([4, 4])
  })

  test('yDown: up means smaller y and top is the smaller-y edge', () => {
    expect(nextTo(target, size, 'up', 0.5, 'center', true)).toEqual([3, 0])
    expect(nextTo(target, size, 'down', 0.5, 'center', true)).toEqual([3, 4])
    expect(nextTo(target, size, 'right', 0.5, 'top', true)).toEqual([6.5, 1.5])
  })

  test('the placed box never overlaps the target', () => {
    for (const dir of ['left', 'right', 'up', 'down', [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
      const p = nextTo(target, size, dir, 0.1)
      expect(rectIntersects(rectFromCenter(p[0], p[1], size.width, size.height), target)).toBe(false)
    }
  })
})

describe('fitInto', () => {
  const rect = { x: 2, y: 1, width: 8, height: 4 }

  test('content centred on the origin is scaled to fit and centred in the rect', () => {
    const fit = fitInto(rect, { width: 4, height: 4 })
    expect(fit.scale).toBe(1)
    expect(fit.offset).toEqual([6, 3])
    const wide = fitInto(rect, { width: 16, height: 2 })
    expect(wide.scale).toBe(0.5)
    expect(wide.offset).toEqual([6, 3])
  })

  test('padding and maxScale', () => {
    expect(fitInto(rect, { width: 2, height: 2 }).scale).toBe(2)
    expect(fitInto(rect, { width: 2, height: 2 }, { maxScale: 1 }).scale).toBe(1)
    expect(fitInto(rect, { width: 4, height: 4 }, { padding: 1 }).scale).toBe(0.5)
  })

  test('a content rect maps into the target rect', () => {
    const content = { x: 10, y: 20, width: 4, height: 1 }
    const { scale, offset } = fitInto(rect, content)
    expect(scale).toBe(2)
    const map = (x: number, y: number) => [x * scale + offset[0], y * scale + offset[1]]
    expect(map(10, 20)).toEqual([2, 2])          // left edge on the rect, centred vertically
    expect(map(14, 21)).toEqual([10, 4])
  })

  test('empty content does not divide by zero', () => {
    expect(fitInto(rect, { width: 0, height: 0 })).toEqual({ scale: 1, offset: [6, 3] })
    expect(fitInto(rect, { width: 0, height: 2 }).scale).toBe(2)
  })
})
