// The kinds of the plot module, built into real scenes and sampled at times and param values: structure, geometry,
// boxes, text rectangles, purity, and what happens on bad input. No browser: the chunk's pure side (engine.ts) is
// imported the way the runtime loads it.
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { PALETTE, type Handle, type MNode, type SceneModel } from '../../../src/core/index.ts'
import { build, codes } from '../core/helpers.ts'
import { axes, badge, bars, guide, matrix, num, numberLine, readout } from '../../../src/plot/index.ts'
import '../../../src/plot/plot.chunk.ts'
import { barsOf, guideEnds, layoutOf, matrixOf, numLayout, readoutLayout, type BracketGeometry, type CurveGeometry, type DotGeometry, type LineGeometry, type MarkGeometry, type TrailGeometry } from '../../../src/plot/engine.ts'
import { MINUS, THIN_SPACE } from '../../../src/plot/scale.ts'

const { BLUE, GOLD, GREEN, GREY_B, RED } = PALETTE
const sine = (x: number): number => Math.sin((x * Math.PI) / 180)
const runs = (m: SceneModel, node: MNode, tau = 0, params = {}): CurveGeometry['runs'] => (m.state(tau, params).props(node).geometry as CurveGeometry).runs
const xs = (pts: readonly number[]): number[] => pts.filter((_, i) => i % 2 === 0)
const ys = (pts: readonly number[]): number[] => pts.filter((_, i) => i % 2 === 1)
const whats = (m: SceneModel): string => m.diagnostics.list.map((d) => `${d.code}: ${d.what} → ${d.fix.join(' | ')}`).join('\n')

describe('axes and their parts', () => {
  test('parts are children of the axes, named after it; an id given by the author is kept as it is', () => {
    let ax!: Handle, a!: Handle, b!: Handle, c!: Handle, d!: Handle
    const m = build(() => {
      ax = axes({ id: 'plot' })
      a = ax.plot(sine)
      b = ax.plot(sine, { id: 'wave' })
      c = ax.dot([1, 0.5])
      d = ax.plot([[0, 0], [10, 1]])
    })
    expect(codes(m)).toEqual([])
    expect([a.id, b.id, c.id, d.id]).toEqual(['plot.curve1', 'wave', 'plot.dot1', 'plot.curve2'])
    for (const n of [a, b, c, d]) expect(n.parent).toBe(ax)
    expect(m.chunksNeeded()).toEqual(['fonts', 'plot']) // 'fonts': the tick labels are set in the embedded faces (src/r2d)
  })

  test('a curve is drawn up to `to`, in step with the param that moves it', () => {
    let wave!: Handle
    const m = build((s) => {
      const angle = s.param('angle', { value: 0, min: 0, max: 720 })
      const ax = axes({ x: [0, 720], y: [-1.5, 1.5], width: 6, height: 3 })
      wave = ax.plot(sine, { to: angle })
      s.step('sweep', (st: any) => st.set(angle, 720, { duration: 4 }))
    })
    expect(runs(m, wave, 0)).toEqual([]) // nothing yet
    const half = runs(m, wave, 2)[0]!.pts, full = runs(m, wave, 4)[0]!.pts
    expect(Math.max(...xs(half))).toBeCloseTo(0, 3) // x = 360° is the middle of a plot 6 wide
    expect(Math.max(...xs(full))).toBeCloseTo(3, 6)
    // the part already drawn does not move while the curve grows: same samples, to the last digit
    expect(full.slice(0, half.length - 2)).toEqual(half.slice(0, -2))
    // and a slider dragged to a value gives the curve up to there, whatever the story time
    expect(Math.max(...xs(runs(m, wave, 0, { angle: 180 })[0]!.pts))).toBeCloseTo(-1.5, 6)
  })

  test('a function that leaves the range is cut on the edge of the plot, never drawn outside it', () => {
    let curve!: Handle, ax!: Handle
    const m = build(() => {
      ax = axes({ x: [-2, 2], y: [0, 1], width: 4, height: 2 })
      curve = ax.plot((x: number) => x * x) // above 1 for |x| > 1
    })
    const pieces = runs(m, curve)
    expect(pieces.length).toBe(1)
    const p = pieces[0]!.pts
    expect(Math.min(...xs(p))).toBeCloseTo(-1, 3)
    expect(Math.max(...xs(p))).toBeCloseTo(1, 3)
    expect(Math.max(...ys(p))).toBeLessThanOrEqual(1 + 1e-9)
    // the box the linter reads is the box of what is drawn
    const b = m.state(0).bounds(curve)
    expect(b.min[0]).toBeCloseTo(-1, 3)
    expect(b.max[1]).toBeCloseTo(1, 6)
  })

  test('where the function has no value the curve stops and starts again', () => {
    let curve!: Handle
    const m = build(() => {
      const ax = axes({ x: [-1, 1], y: [-5, 5], width: 4, height: 2 })
      curve = ax.plot((x: number) => (Math.abs(x) < 0.2 ? NaN : 1 / x), { samples: 100 })
    })
    const pieces = runs(m, curve)
    expect(pieces.length).toBe(2)
    for (const piece of pieces) expect(piece.pts.every(Number.isFinite)).toBe(true)
  })

  test('colorAt cuts the curve exactly where the colour changes', () => {
    let wave!: Handle
    const m = build(() => {
      const ax = axes({ x: [0, 720], y: [-1.5, 1.5], width: 7.2, height: 3 })
      wave = ax.plot(sine, { samples: 37, colorAt: (_x: number, y: number) => (y >= 0 ? BLUE : GOLD) })
    })
    const r = runs(m, wave)
    expect(r.map((x) => x.color)).toEqual([BLUE, GOLD, BLUE, GOLD])
    // 180° is 1.8 units from the left edge (x = −3.6): the cut is there to a thousandth, although the samples are 19° apart
    expect(r[0]!.pts.at(-2)!).toBeCloseTo(-1.8, 2)
    expect(r[1]!.pts[0]!).toBe(r[0]!.pts.at(-2)!) // the next run starts on the very same point
    expect(r[1]!.pts.at(-2)!).toBeCloseTo(0, 2)
  })

  test('a list of points, or a function that returns one, is a line through them', () => {
    let fixed!: Handle, live!: Handle, cut!: Handle
    const m = build((s) => {
      const k = s.param('k', { value: 1, min: 1, max: 3 })
      const ax = axes({ x: [0, 4], y: [0, 4], width: 4, height: 4 })
      fixed = ax.plot([[0, 0], [2, 2], [4, 0]])
      live = ax.plot(() => [[0, 0], [4, k()]])
      cut = ax.plot([[0, 0], [4, 4]], { from: 1, to: 3 })
    })
    expect(codes(m)).toEqual([])
    expect(runs(m, fixed)[0]!.pts).toEqual([-2, -2, 0, 0, 2, -2])
    expect(runs(m, live)[0]!.pts).toEqual([-2, -2, 2, -1])
    expect(runs(m, live, 0, { k: 3 })[0]!.pts).toEqual([-2, -2, 2, 1])
    expect(runs(m, cut)[0]!.pts).toEqual([-1, -1, 1, 1])
  })

  test('a param read only by the plotted function still changes the picture the linter compares', () => {
    const m = build((s) => {
      const f = s.param('f', { value: 1, min: 1, max: 3 })
      axes({ x: [0, 360], y: [-1, 1] }).plot((x: number) => sine(f() * x))
    })
    expect(m.state(0, { f: 1 }).signature()).not.toBe(m.state(0, { f: 3 }).signature())
    expect(m.state(0, { f: 2 }).signature()).toBe(m.state(0, { f: 2 }).signature())
  })

  test('a dot follows its value, hides outside the ranges, and is an object other things can end on', () => {
    let ax!: Handle, dot!: Handle, tie!: Handle
    const m = build((s) => {
      const x = s.param('x', { value: 5, min: 0, max: 20 })
      ax = axes({ x: [0, 10], y: [0, 1], width: 5, height: 2 }).at(2, 1)
      dot = ax.dot(() => [x(), 0.5], { radius: 0.1 })
      tie = guide([-5, 1], dot)
    })
    const f = m.state(0)
    expect((f.props(dot).geometry as DotGeometry)).toEqual({ x: 0, y: 0, shown: true })
    expect(f.anchor(dot, 'center')).toEqual([2, 1, 0]) // the axes sit at (2, 1)
    expect((m.state(0, { x: 20 }).props(dot).geometry as DotGeometry).shown).toBe(false)
    // the guide stops at the dot's edge (radius 0.1 + its gap), and starts exactly on the point it was given
    const g = guideEnds(tie, f.props(tie), f)
    expect(g.free).toBe(true) // a bare point: it gets the small dot
    expect(g.a).toEqual([-5, 1, 0])
    expect(g.b[0]).toBeCloseTo(2 - 0.1 - 0.03, 2)
    expect(g.b[1]).toBeCloseTo(1, 9)
  })

  test('vline and hline cross the plot at a value, or run between two values of the other axis', () => {
    let v!: Handle, h!: Handle, drop!: Handle
    const m = build(() => {
      const ax = axes({ x: [0, 10], y: [0, 2], width: 5, height: 2 })
      v = ax.vline(5)
      h = ax.hline(1.5)
      drop = ax.vline(2, { to: 1 })
      ax.vline(50) // outside: nothing
    })
    const geo = (n: MNode): LineGeometry => m.state(0).props(n).geometry as LineGeometry
    expect(geo(v)).toEqual({ x0: 0, y0: -1, x1: 0, y1: 1, shown: true })
    expect(geo(h)).toEqual({ x0: -2.5, y0: 0.5, x1: 2.5, y1: 0.5, shown: true })
    expect(geo(drop)).toEqual({ x0: -1.5, y0: -1, x1: -1.5, y1: 0, shown: true })
    expect(geo(m.byId.get('axes1.vline3')!).shown).toBe(false)
  })

  test('a line with only `to` starts on the axis, wherever the bottom of the range is', () => {
    let drop!: Handle, across!: Handle, two!: Handle
    const m = build(() => {
      const ax = axes({ x: [-2, 2], y: [-1, 3], width: 4, height: 4 })
      drop = ax.vline(1, { to: 2 }) // from y = 0, not from y = −1
      across = ax.hline(2, { to: 1 }) // from x = 0
      two = ax.dot(1, 2) // a slip with one right reading: the point [1, 2]
    })
    expect(codes(m)).toEqual([])
    const f = m.state(0)
    expect(f.props(drop).geometry).toEqual({ x0: 1, y0: -1, x1: 1, y1: 1, shown: true })
    expect(f.props(across).geometry).toEqual({ x0: 0, y0: 1, x1: 1, y1: 1, shown: true })
    expect(f.props(two).geometry).toEqual({ x: 1, y: 1, shown: true })
  })

  test('marks and brackets sit in rows under the axis, are text for the linter, and are inside the box of the axes', () => {
    let ax!: Handle, mark!: Handle, turn!: Handle, cycle!: Handle
    const m = build((s) => {
      const end = s.param('end', { value: 360, min: 90, max: 720 })
      ax = axes({ x: [0, 720], y: [0, 1], width: 6, height: 2, xUnit: '°' })
      mark = ax.mark(90, 'intake')
      turn = ax.bracket(0, end, 'one turn')
      cycle = ax.bracket(0, 720, 'cycle', { level: 1 })
    })
    const f = m.state(0)
    const L = layoutOf(ax, f)
    const mk = f.props(mark).geometry as MarkGeometry, t = f.props(turn).geometry as BracketGeometry, c = f.props(cycle).geometry as BracketGeometry
    expect(mk.label.x).toBeCloseTo(-3 + 0.75, 6)
    expect(mk.label.y).toBeCloseTo(L.markY, 4)
    expect(t.y).toBeCloseTo(L.bracketY(0), 4)
    expect(c.y).toBeLessThan(t.label!.y - t.label!.height / 2) // the outer bracket is under the name of the inner one
    expect(t.x1).toBeCloseTo(0 - 0.07, 3) // 360° is the middle; a bracket stays a little inside its span
    expect((m.state(0, { end: 720 }).props(turn).geometry as BracketGeometry).x1).toBeCloseTo(3 - 0.07, 3) // its end follows the param
    expect(f.textRects(mark).map((r) => r.text)).toEqual(['intake'])
    expect(f.textRects(turn).map((r) => r.text)).toEqual(['one turn'])
    const box = f.bounds(ax)
    for (const n of [mark, turn, cycle]) { const b = f.bounds(n); expect(b.min[1]).toBeGreaterThanOrEqual(box.min[1] - 1e-3); expect(b.max[1]).toBeLessThanOrEqual(box.max[1]) }
  })

  test('toFrame is a live point of the frame: it follows the position, the size and the ranges of the axes', () => {
    let ax!: Handle, p!: () => number[], q!: () => number[]
    const m = build((s) => {
      const top = s.param('top', { value: 1, min: 1, max: 4 })
      ax = axes({ x: [0, 10], y: () => [0, top()], width: 4, height: 2 }).at(1, -1)
      p = ax.toFrame(5, 1)
      q = ax.toFrame(() => [10, top()])
    })
    expect(m.state(0).run(p)).toEqual([1, 0, 0])
    expect(m.state(0, { top: 4 }).run(p)).toEqual([1, -1.5, 0]) // the same value is lower when the range grows
    expect(m.state(0, { top: 4 }).run(q)).toEqual([3, 0, 0])
  })

  test('fit fills a rectangle of the frame, labels included; ax.to.fit tweens there', () => {
    let ax!: Handle
    const m = build((s) => {
      ax = axes({ x: [0, 720], y: [0, 3], xUnit: '°', xLabel: 'crank angle', yLabel: 'height' }).fit({ x: 1, y: -3, width: 5, height: 4 })
      ax.bracket(0, 360, 'turn 1')
      s.step('move', (st: any) => st.play(ax.to.fit({ x: -6, y: 0, width: 4, height: 3 }), { duration: 2 }))
    })
    expect(codes(m)).toEqual([])
    const at = (tau: number): number[] => { const b = m.state(tau).bounds(ax); return [b.min[0], b.min[1], b.max[0], b.max[1]].map((v) => Math.round(v * 1e4) / 1e4) }
    expect(at(0)).toEqual([1, -3, 6, 1])
    expect(at(2)).toEqual([-6, 0, -2, 3])
    const mid = at(1) // halfway (smooth is symmetric): a rectangle halfway between the two
    expect(mid).toEqual([-2.5, -1.5, 2, 2])
  })

  test('a trail is the path the point took: the same at a time whatever was asked before', () => {
    let trail!: Handle
    const make = (): SceneModel => build((s) => {
      const a = s.param('a', { value: 0, min: 0, max: 360 })
      const ax = axes({ x: [-1.5, 1.5], y: [-1.5, 1.5], width: 3, height: 3 })
      trail = ax.trail(() => [Math.cos((a() * Math.PI) / 180), sine(a())])
      s.step('turn', (st: any) => st.set(a, 360, { duration: 4, rate: (u: number) => u }))
    })
    const m = make()
    const late = (m.state(3).props(trail).geometry as TrailGeometry).lines
    const early = (m.state(1).props(trail).geometry as TrailGeometry).lines
    const fresh = make()
    expect((fresh.state(1).props(trail).geometry as TrailGeometry).lines).toEqual(early) // asked first, or after t = 3: identical
    expect(late[0]!.length).toBeGreaterThan(early[0]!.length)
    expect(late[0]!.slice(0, 2)).toEqual([1, 0]) // it starts where the point was at t = 0 …
    expect(late[0]!.at(-2)!).toBeCloseTo(0, 3) // … and ends where it is now (270°)
    expect(late[0]!.at(-1)!).toBeCloseTo(-1, 3)
    expect((m.state(0).props(trail).geometry as TrailGeometry).lines).toEqual([])
    // only the last second of it
    let short!: Handle
    const w = build((s) => {
      const a = s.param('a', { value: 0, min: 0, max: 360 })
      short = axes({ x: [0, 360], y: [0, 1] }).trail(() => [a(), 0.5], { seconds: 1 })
      s.step('turn', (st: any) => st.set(a, 360, { duration: 4, rate: (u: number) => u }))
    })
    const line = (w.state(3).props(short).geometry as TrailGeometry).lines[0]!
    const L = layoutOf(short.parent!, w.state(3))
    expect(line[0]!).toBeCloseTo(L.toLocal(180, 0.5)[0], 3)
    expect(line.at(-2)!).toBeCloseTo(L.toLocal(270, 0.5)[0], 3)
  })
})

describe('number line', () => {
  test('dots, marks and brackets take one value', () => {
    let nl!: Handle, dot!: Handle
    const m = build(() => {
      nl = numberLine({ range: [0, 10], width: 5 }).at(0, 2)
      dot = nl.dot(7.5)
      nl.mark(5, 'half')
      nl.bracket(0, 5, 'first half')
    })
    expect(codes(m)).toEqual([])
    const f = m.state(0)
    expect(f.anchor(dot, 'center')).toEqual([1.25, 2, 0])
    expect(f.run(nl.toFrame(10))).toEqual([2.5, 2, 0])
    expect(f.textRects(nl).map((t) => t.text)).toEqual(['0', '2', '4', '6', '8', '10'])
  })
})

describe('numbers', () => {
  test('num follows its value, with the decimals of the slider step and its unit', () => {
    let n!: Handle, plain!: Handle
    const m = build((s) => {
      const v = s.param('v', { value: 2, min: 0, max: 100, step: 0.5 })
      n = num(v, { unit: 'V' })
      plain = num(() => -v() / 3)
    })
    const f = m.state(0)
    expect(numLayout(n, f.props(n)).text).toBe('2.0' + THIN_SPACE + 'V')
    expect(numLayout(plain, f.props(plain)).text).toBe(MINUS + '0.67')
    expect(numLayout(n, m.state(0, { v: 37.5 }).props(n)).text).toBe('37.5' + THIN_SPACE + 'V')
  })

  test('a number keeps room for its widest value, so nothing beside it shifts while it counts', () => {
    let n!: Handle, label!: Handle
    const m = build((s) => {
      const angle = s.param('angle', { value: 0, min: 0, max: 720, unit: '°' })
      n = num(angle, { unit: '°' })
      label = readout('angle', angle, { unit: '°' })
      s.step('sweep', (st: any) => st.set(angle, 720, { duration: 3 }))
    })
    const width = (node: MNode, tau: number): number => { const b = m.state(tau).bounds(node); return b.max[0] - b.min[0] }
    expect(width(n, 0)).toBe(width(n, 3)) // "0°" and "720°" take the same box
    expect(width(label, 0)).toBe(width(label, 3))
    const a = readoutLayout(label, m.state(0).props(label)), b = readoutLayout(label, m.state(3).props(label))
    expect(a.value).toBe('0°')
    expect(b.value).toBe('720°')
    expect(a.x0).toBe(b.x0) // the name starts at the same place …
    expect(a.valueX).toBe(b.valueX) // … and so does the value
    expect(m.state(0).textRects(label)[0]!.text).toBe('angle = 0°')
  })

  test('n.to.value counts to a value', () => {
    let n!: Handle
    const m = build((s) => {
      n = num(0)
      s.step('count', (st: any) => st.play(n.to.value(100), { duration: 2, rate: (u: number) => u }))
    })
    expect(codes(m)).toEqual([])
    const text = (tau: number): string => numLayout(n, m.state(tau).props(n)).text
    expect(text(0)).toBe('0.00')
    expect(text(1)).toBe('50.00')
    expect(text(2)).toBe('100.00')
  })

  test('a readout shows text values as they are; a badge takes the colour of its state', () => {
    let r!: Handle, b!: Handle
    const m = build((s) => {
      const k = s.param('k', { value: 0, min: 0, max: 2, step: 1 })
      const state = (): string => ['idle', 'running', 'failed'][k()]!
      r = readout('state', state)
      b = badge(state, { colors: { idle: GREY_B, running: GREEN, failed: RED } })
    })
    expect(codes(m)).toEqual([])
    expect(m.state(0, { k: 1 }).textRects(r)[0]!.text).toBe('state = running')
    expect(m.state(0, { k: 2 }).textRects(b)[0]!.text).toBe('failed')
    const box = (k: number): number[] => { const x = m.state(0, { k }).bounds(b); return [x.min[0], x.max[0]] }
    expect(box(0)).toEqual(box(1)) // room for the longest state name: the dot does not move when the state changes
  })
})

describe('bars and heat grids', () => {
  test('bars follow their values against a fixed range; one can be highlighted', () => {
    let chart!: Handle
    const m = build((s) => {
      const k = s.param('k', { value: 2, min: 0, max: 10 })
      chart = bars(() => [k(), 5, -5], { labels: ['a', 'b', 'c'], range: [-10, 10], width: 3, height: 2, highlight: 1 }).at(0, 1)
    })
    expect(codes(m)).toEqual([])
    const f = m.state(0)
    const L = barsOf(chart, f)
    expect(L.base.y).toBeCloseTo(0, 9) // zero is the middle of −10..10
    expect(L.bars.map((b) => [Math.round(b.y0 * 100) / 100, Math.round(b.y1 * 100) / 100])).toEqual([[0, 0.2], [0, 0.5], [-0.5, 0]])
    expect(L.bars.map((b) => b.dim)).toEqual([true, false, true])
    expect(f.textRects(chart).map((t) => t.text).sort()).toEqual(['2', '5', 'a', 'b', 'c', MINUS + '5'].sort())
    expect(barsOf(chart, m.state(0, { k: 10 })).bars[0]!.y1).toBeCloseTo(1, 9)
    expect(f.run(chart.bar(1))).toEqual([0, 1.5, 0]) // on top of the middle bar, in frame coordinates
  })

  test('a heat grid colours cells by value, labels rows and columns, and outlines what is highlighted', () => {
    let grid!: Handle
    const m = build((s) => {
      const row = s.param('row', { value: 0, min: 0, max: 1, step: 1 })
      grid = matrix([[0, 1], [0.5, 1]], { rows: ['r0', 'r1'], columns: ['c0', 'c1'], colors: ['#000000', '#FFFFFF'], showValues: true, cellSize: 1, gap: 0, highlight: () => ({ row: row() }) })
    })
    expect(codes(m)).toEqual([])
    const f = m.state(0)
    const L = matrixOf(grid, f)
    expect(L.cells.map((c) => c.color.slice(0, 7).toUpperCase())).toEqual(['#000000', '#FFFFFF', '#B4B4B4', '#FFFFFF']) // squared-RGB mix at 0.5
    expect(L.cells.map((c) => c.dim)).toEqual([false, false, true, true])
    expect(L.highlight).toEqual({ x0: -1, x1: 1, y0: 0, y1: 1 })
    expect(matrixOf(grid, m.state(0, { row: 1 })).highlight).toEqual({ x0: -1, x1: 1, y0: -1, y1: 0 })
    expect(f.run(grid.cell(1, 0))).toEqual([-0.5, -0.5, 0])
    expect(f.textRects(grid).map((t) => t.text).sort()).toEqual(['0.00', '0.50', '1.00', '1.00', 'c0', 'c1', 'r0', 'r1'])
    // numbers on a light cell are dark, on a dark cell light
    expect(L.cells[0]!.number!.color).toBe('#FFFFFF')
    expect(L.cells[1]!.number!.color).toBe('#000000')
  })
})

describe('bad input is reported, never thrown', () => {
  test('every wrong call leaves a diagnostic with a fix and an object that can still be used', () => {
    const made: Handle[] = []
    const m = build((s) => {
      const ax = axes({ x: [0, 10], y: [0, 1], colour: RED, ticks: 'many' } as never)
      made.push(ax, ax.plot(5), ax.plot(sine, { colour: RED }), ax.plot(() => 'text'), ax.dot('here'), ax.vline(null), ax.mark(), ax.bracket('a', 'b', 'x'), ax.trail([1, 2]), ax.area({}))
      ax.fit(null)
      ax.fit({ x: 0, y: 0, width: -1, height: 2 })
      ax.toFrame({})
      made.push(num('abc' as never), bars('x' as never), matrix(5 as never), readout(), badge(), guide(undefined, [0, 0]), numberLine({ ticks: { x: 1 } }))
      made.push(ax.plot((x: number) => { if (x > 5) throw new Error('boom'); return x / 10 }))
      s.step('still runs', (st: any) => st.wait(1))
    })
    const text = whats(m)
    for (const needle of ['axes() has no option "colour"', 'ticks cannot be read', 'ax.plot() needs a function of x or a list', 'ax.plot() has no option "colour"', 'use "color"', 'the function returned a string', 'ax.dot() needs a point', 'ax.vline() needs a value', 'ax.mark() needs a value', 'ax.bracket() needs the two values', 'ax.trail() needs a function', 'ax.area() needs a function', 'ax.fit() needs a rectangle', 'ax.toFrame() needs x and y', 'num(): value expects a number', 'bars(): values expects a list', 'matrix(): values expects a list', 'readout() needs label', 'badge() needs state', 'guide(): a is undefined']) expect(text).toContain(needle)
    for (const d of m.diagnostics.list) expect(d.fix.length).toBeGreaterThan(0)
    // every state is still total: boxes are finite, nothing throws
    for (const tau of [0, 0.5, m.duration]) {
      const f = m.state(tau)
      for (const n of m.nodes) { const b = f.bounds(n); expect([...b.min, ...b.max].every(Number.isFinite)).toBe(true); f.textRects(n) }
    }
    // the function that throws is reported once, with the object it belongs to, and the part before the throw is still drawn
    const errors = m.diagnostics.byCode('RUNTIME-ERROR')
    expect(errors.length).toBe(1)
    expect(errors[0]!.what).toContain('boom')
    expect(errors[0]!.ids).toEqual([made.at(-1)!.id])
    expect(runs(m, made.at(-1)!)[0]!.pts.length).toBeGreaterThan(20)
  })

  test('a slip that has one right reading is taken silently or named exactly', () => {
    const m = build(() => {
      axes({ y: [0, 10], yScale: 'log' }) // a log axis from zero: named, with the range to use
      const ax = axes({ xRange: [0, 4], ylabel: 'height' } as never) // accepted spellings
      ax.plot(sine, { samples: 2.5 } as never)
    })
    const text = whats(m)
    expect(text).not.toContain('xRange')
    expect(text).not.toContain('ylabel')
    expect(text).toContain('samples')
    expect(text).toContain("yScale is 'log' but the y range starts at 0")
    expect(text).toContain('y: [0.01, 10]')
  })
})

describe('the main chunk on its own', () => {
  test('without the lazy chunk the constructors still work and every box is finite (the state while a scene is being built)', async () => {
    const root = join(import.meta.dir, '..', '..', '..')
    const code = `
      import { compile, scene } from './src/core/index.ts'
      import './src/r2d/index.ts'
      import { axes, num, bars, matrix, readout, badge, guide, numberLine, impl } from './src/plot/index.ts'
      const m = compile(scene({ title: 't' }, (s) => {
        const ax = axes({ x: [0, 10], y: [0, 1] }).fit({ x: 0, y: 0, width: 4, height: 3 })
        const d = ax.dot([1, 1]); ax.plot((x) => x / 10); ax.bracket(0, 5, 'half'); guide([0, 0], d); guide(ax.toFrame(1, 1), d.anchor('center'))
        num(3); bars([1, 2]); matrix([[1]]); readout('a', 1); badge('on'); numberLine().dot(3)
      }))
      const f = m.state(0)
      const ok = m.nodes.every((n) => { const b = f.bounds(n); return [...b.min, ...b.max].every(Number.isFinite) })
      console.log(JSON.stringify({ loaded: Object.keys(impl).length, codes: m.diagnostics.list.map((d) => d.code), ok, chunks: m.chunksNeeded(), box: f.bounds(m.byId.get('axes1')) }))
    `
    const run = Bun.spawnSync(['bun', '-e', code], { cwd: root })
    const out = JSON.parse(run.stdout.toString().trim().split('\n').at(-1) ?? '{}')
    expect(out).toEqual({ loaded: 0, codes: [], ok: true, chunks: ['fonts', 'plot'], box: { min: [0, 0, 0], max: [4, 3, 0] } })
  })
})
