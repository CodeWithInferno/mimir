// The layout of axes and number lines: ticks, labels, the rows under the axis, the box, and fit.
import { describe, expect, test } from 'bun:test'
import { layoutAxes, textEdges, type AxesLayout, type PlotText } from '../../../src/plot/layout.ts'
import { PLOT } from '../../../src/plot/defaults.ts'

const NONE = { marks: false, brackets: 0 }
const base = { x: [0, 10], y: [0, 1], width: 6, height: 3, xScale: 'linear', yScale: 'linear', axis: 'edge', ticks: true, tickLabelSize: 20, labelSize: 24, color: '#BBBBBB' }
const labels = (L: AxesLayout, axis: 'x' | 'y'): string[] => (axis === 'x' ? L.xTicks : L.yTicks).map((t) => t.label?.text ?? '')
const texts = (L: AxesLayout): PlotText[] => [...L.xTicks.map((t) => t.label), ...L.yTicks.map((t) => t.label), L.xLabel, L.yLabel].filter((t): t is PlotText => !!t)
const overlaps = (a: PlotText, b: PlotText): boolean => { const p = textEdges(a), q = textEdges(b); return p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1 }

describe('axes layout', () => {
  test('the plot rectangle is width × height, centred on the origin', () => {
    const L = layoutAxes(base, false, NONE)
    expect(L.plot).toEqual({ x0: -3, x1: 3, y0: -1.5, y1: 1.5 })
    expect(L.toLocal(0, 0)).toEqual([-3, -1.5])
    expect(L.toLocal(10, 1)).toEqual([3, 1.5])
    expect(L.toLocal(5, 0.5)).toEqual([0, 0])
  })
  test('automatic ticks are round numbers at a readable spacing', () => {
    const L = layoutAxes(base, false, NONE)
    expect(labels(L, 'x')).toEqual(['0', '2', '4', '6', '8', '10'])
    expect(labels(L, 'y')).toEqual(['0.0', '0.5', '1.0'])
  })
  test('a unit is written after every number, and degrees step in half turns', () => {
    const L = layoutAxes({ ...base, x: [0, 720], xUnit: '°', yUnit: 'V' }, false, NONE)
    expect(labels(L, 'x')).toEqual(['0°', '180°', '360°', '540°', '720°'])
    expect(labels(L, 'y')[1]).toBe('0.5 V')
  })
  test('tick labels never touch: a narrow plot gets fewer of them', () => {
    for (const width of [1, 1.6, 2.5, 4, 9]) {
      const L = layoutAxes({ ...base, x: [0, 100000], width }, false, NONE)
      const row = L.xTicks.map((t) => t.label!).filter(Boolean)
      for (let i = 1; i < row.length; i++) expect(overlaps(row[i - 1]!, row[i]!)).toBe(false)
      expect(row.length).toBeGreaterThanOrEqual(1)
    }
  })
  test('ticks given by the author: a step, a list, labelled values, none', () => {
    expect(labels(layoutAxes({ ...base, ticks: { x: 2.5 } }, false, NONE), 'x')).toEqual(['0.0', '2.5', '5.0', '7.5', '10.0'])
    expect(labels(layoutAxes({ ...base, ticks: { x: [0, 3, 30] } }, false, NONE), 'x')).toEqual(['0', '3']) // 30 is outside the range
    expect(labels(layoutAxes({ ...base, ticks: { x: [[0, 'start'], [10, 'end']] } }, false, NONE), 'x')).toEqual(['start', 'end'])
    const none = layoutAxes({ ...base, ticks: false }, false, NONE)
    expect(none.xTicks.length + none.yTicks.length).toBe(0)
    const half = layoutAxes({ ...base, ticks: { y: false } }, false, NONE)
    expect(half.yTicks.length).toBe(0)
    expect(half.xTicks.length).toBeGreaterThan(0)
  })
  test('a log axis has a tick at every power of ten', () => {
    const L = layoutAxes({ ...base, y: [0.01, 100], yScale: 'log' }, false, NONE)
    expect(labels(L, 'y')).toEqual(['0.01', '0.1', '1', '10', '100'])
    const gaps = L.yTicks.slice(1).map((t, i) => t.at - L.yTicks[i]!.at)
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0]!, 9)
  })
  test('no two texts of the axes overlap, and the box contains all of them', () => {
    for (const axis of ['edge', 'zero']) {
      const L = layoutAxes({ ...base, x: [-4, 4], y: [-2, 2], axis, xLabel: 'time in seconds', yLabel: 'voltage', xUnit: 's' }, false, { marks: true, brackets: 2 })
      const all = texts(L)
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlaps(all[i]!, all[j]!)).toBe(false)
      for (const t of all) { const e = textEdges(t); expect(e.x0).toBeGreaterThanOrEqual(L.box.x0 - 1e-9); expect(e.x1).toBeLessThanOrEqual(L.box.x1 + 1e-9); expect(e.y0).toBeGreaterThanOrEqual(L.box.y0 - 1e-9); expect(e.y1).toBeLessThanOrEqual(L.box.y1 + 1e-9) }
    }
  })
  test('the labels sit where no curve can be: y beside the part of its axis above the data, x under the tick labels', () => {
    const L = layoutAxes({ ...base, xLabel: 'time', yLabel: 'height' }, false, NONE)
    expect(textEdges(L.yLabel!).y0).toBeGreaterThanOrEqual(L.plot.y1)
    expect(textEdges(L.xLabel!).y1).toBeLessThanOrEqual(Math.min(...L.xTicks.map((t) => textEdges(t.label!).y0)))
    expect(L.yLine![1]).toBeGreaterThanOrEqual(textEdges(L.yLabel!).y1 - 1e-9) // the axis runs up past its label
  })
  test("axis: 'zero' puts the lines through 0 and leaves out the two numbers at the crossing", () => {
    const L = layoutAxes({ ...base, x: [-4, 4], y: [-1, 3], axis: 'zero' }, false, NONE)
    expect(L.axisX).toBeCloseTo(0, 12)
    expect(L.axisY).toBeCloseTo(-1.5 + 0.75, 12)
    expect(labels(L, 'x')).not.toContain('0')
    expect(labels(L, 'y')).not.toContain('0')
    // zero outside a range: that axis stays on the edge and keeps all its numbers
    const E = layoutAxes({ ...base, x: [1, 5], y: [-1, 1], axis: 'zero' }, false, NONE)
    expect(E.axisX).toBe(E.plot.x0)
    expect(labels(E, 'y')).toContain('0.0')
  })
  test('rows under the axis: marks first, then one row per bracket level, all inside the box', () => {
    const plain = layoutAxes(base, false, NONE)
    const rows = layoutAxes(base, false, { marks: true, brackets: 2 })
    expect(rows.markY).toBeLessThan(Math.min(...rows.xTicks.map((t) => textEdges(t.label!).y0)))
    expect(rows.bracketY(0)).toBeLessThan(rows.markY)
    expect(rows.bracketY(1)).toBeLessThan(rows.bracketY(0) - PLOT.bracketHook)
    expect(rows.box.y0).toBeLessThan(rows.bracketY(1))
    expect(rows.box.y0).toBeLessThan(plain.box.y0)
    // without marks the brackets move up into their row
    expect(layoutAxes(base, false, { marks: false, brackets: 1 }).bracketY(0)).toBeGreaterThan(rows.bracketY(0))
  })
})

describe('fit', () => {
  test('everything, labels and rows included, fills exactly the rectangle it is given', () => {
    for (const [width, height] of [[6, 4], [3, 2.5], [9, 3], [2.2, 6]] as const) {
      const L = layoutAxes({ ...base, x: [0, 720], xUnit: '°', xLabel: 'crank angle', yLabel: 'height', fit: { width, height } }, false, { marks: true, brackets: 1 })
      expect(L.box.x0).toBeCloseTo(-width / 2, 6)
      expect(L.box.x1).toBeCloseTo(width / 2, 6)
      expect(L.box.y0).toBeCloseTo(-height / 2, 6)
      expect(L.box.y1).toBeCloseTo(height / 2, 6)
      expect(L.plot.x1 - L.plot.x0).toBeGreaterThan(0)
      expect(L.plot.y1 - L.plot.y0).toBeGreaterThan(0)
    }
  })
  test('a rectangle too small for the labels still gives a plot, never NaN', () => {
    const L = layoutAxes({ ...base, xLabel: 'a very long label for a small plot', fit: { width: 0.5, height: 0.4 } }, false, { marks: true, brackets: 3 })
    for (const v of [L.plot.x0, L.plot.x1, L.plot.y0, L.plot.y1, L.box.x0, L.box.y0]) expect(Number.isFinite(v)).toBe(true)
    expect(L.plot.x1).toBeGreaterThan(L.plot.x0)
  })
})

describe('number line', () => {
  test('one axis: ticks along the range, the name beyond its end, no y', () => {
    const L = layoutAxes({ range: [-2, 8], width: 5, label: 'x', ticks: 2, tickLabelSize: 20, labelSize: 24 }, true, NONE)
    expect(L.line).toBe(true)
    expect(L.yLine).toBeNull()
    expect(L.yTicks).toEqual([])
    expect(labels(L, 'x')).toEqual(['−2', '0', '2', '4', '6', '8'])
    expect(L.toLocal(3, 99)).toEqual([0, 0]) // y is ignored
    expect(textEdges(L.xLabel!).x0).toBeGreaterThan(L.xLine[1])
    const F = layoutAxes({ range: [0, 1], fit: { width: 4, height: 2 }, tickLabelSize: 20, labelSize: 24 }, true, NONE)
    expect(F.box.x0).toBeCloseTo(-2, 6)
    expect(F.box.x1).toBeCloseTo(2, 6)
    expect((F.box.y0 + F.box.y1) / 2).toBeCloseTo(0, 6) // centred in the height it was given
  })
})

describe('bad options', () => {
  test('missing or broken options never produce NaN', () => {
    for (const r of [{}, { x: [3, 3], y: [NaN, 1] }, { width: -1, height: 0 }, { x: 'nonsense', ticks: 'nonsense' }, { ticks: { x: -5, y: [NaN, 'a'] } }, { xScale: 'log', x: [-1, 1] }]) {
      const L = layoutAxes(r, false, NONE)
      for (const v of [L.plot.x0, L.plot.x1, L.plot.y0, L.plot.y1, L.box.x0, L.box.x1, L.box.y0, L.box.y1, L.axisX, L.axisY]) expect(Number.isFinite(v)).toBe(true)
      for (const t of [...L.xTicks, ...L.yTicks]) expect(Number.isFinite(t.at)).toBe(true)
    }
  })
})
