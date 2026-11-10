// cells(): the reducer (pure), the geometry inside the rectangle, and what a step records.
import { describe, expect, test } from 'bun:test'
import { compile, type MNode, type SceneModel } from '../../../src/core/index.ts'
import '../../../src/r2d/index.ts'
import '../../../src/anim/index.ts'
import '../../../src/guide/index.ts'
import '../../../src/check/index.ts'
import { cells, CELLS_DEFAULTS, describeCells, explain, pointerLevels, quickAccount, reduceCells, slotsOf, type CellsState, type ExplainSpec } from '../../../src/quick/index.ts'

const build = (spec: unknown): SceneModel => compile(explain(spec as ExplainSpec))
const diags = (m: SceneModel): string[] => m.diagnostics.list.map((d) => `${d.code}: ${d.what} | ${d.fix.join(' | ')}`)
const start = (values: (number | string)[], pointers: string[] = []): CellsState => ({ values: values.slice(), items: values.map((_, i) => i), pointers: Object.fromEntries(pointers.map((p) => [p, null])), dim: [], found: [], done: [], compare: null })
const keys = (from: number): (() => number) => () => from++

describe('cells reducer', () => {
  test('slots: a pair is a range, a number is one slot, a longer list is a list', () => {
    expect(slotsOf([2, 4], 8)).toEqual([2, 3, 4])
    expect(slotsOf([4, 2], 8)).toEqual([2, 3, 4])
    expect(slotsOf(3, 8)).toEqual([3])
    expect(slotsOf([0, 3, 5], 8)).toEqual([0, 3, 5])
    expect(slotsOf([2, 4], 8, false)).toEqual([2, 4])
    expect(slotsOf([-3, 99], 4)).toEqual([0, 1, 2, 3])
    expect(slotsOf(null, 8)).toEqual([])
    expect(slotsOf('x', 8)).toBeNull()
  })
  test('swap moves values and keeps their keys; marks travel with the value', () => {
    const a = reduceCells(start([5, 2, 9]), { done: 0 }, [], keys(3)).next
    const b = reduceCells(a, { compare: [0, 1], swap: [0, 1] }, [], keys(3)).next
    expect(b.values).toEqual([2, 5, 9])
    expect(b.items).toEqual([1, 0, 2])
    expect(b.done).toEqual([0])
    expect(b.compare).toEqual([0, 1])
    expect(describeCells(b)).toBe('[2 5 9] · compares slots 0 and 1 (2 and 5) · settled 5')
    // compare belongs to the step that made it
    expect(reduceCells(b, {}, [], keys(3)).next.compare).toBeNull()
  })
  test('insert and remove renumber what stands behind them', () => {
    const a = reduceCells(start([1, 2, 3], ['p']), { p: 2, dim: [2, 2] }, ['p'], keys(3)).next
    const ins = reduceCells(a, { insert: { at: 1, value: 9 } }, ['p'], keys(3))
    expect(ins.next.values).toEqual([1, 9, 2, 3])
    expect(ins.inserted).toEqual([3])
    expect(ins.next.dim).toEqual([3])
    const rem = reduceCells(ins.next, { remove: 0 }, ['p'], keys(4))
    expect(rem.next.values).toEqual([9, 2, 3])
    expect(rem.removed).toEqual([0])
    expect(rem.next.pointers.p).toBe(1)
    expect(rem.next.dim).toEqual([2])
    expect(reduceCells(a, { insert: { value: 'z' } }, ['p'], keys(3)).next.values).toEqual([1, 2, 3, 'z'])
  })
  test('pointers: a slot, one past either end, or null; lit dims the rest; found replaces, done accumulates', () => {
    let s = reduceCells(start([1, 2, 3, 4], ['lo', 'hi']), { lo: 0, hi: 4, lit: [1, 2] }, ['lo', 'hi'], keys(4)).next
    expect(s.pointers).toEqual({ lo: 0, hi: 4 })
    expect(s.dim).toEqual([0, 3])
    s = reduceCells(s, { lo: null, lit: null, found: 1, done: [0, 3] }, ['lo', 'hi'], keys(4)).next
    expect(s.pointers.lo).toBeNull()
    expect(s.dim).toEqual([])
    s = reduceCells(s, { found: 2, done: 1 }, ['lo', 'hi'], keys(4)).next
    expect(s.found).toEqual([2])
    expect(s.done).toEqual([0, 3, 1])
    expect(reduceCells(s, { found: null, done: null }, ['lo', 'hi'], keys(4)).next).toMatchObject({ found: [], done: [] })
  })
  test('bad values are problems with a fix, and the rest of the change still applies', () => {
    const r = reduceCells(start([1, 2, 3], ['p']), { swap: [0, 7], p: 99, remove: 'x', insert: 3, lit: 'all', found: 1 }, ['p'], keys(3))
    expect(r.problems.length).toBe(5)
    expect(r.problems.every((p) => p.what.length > 10 && !!p.fix)).toBe(true)
    expect(r.next.values).toEqual([1, 2, 3])
    expect(r.next.found).toEqual([1])
  })
  test('pointers that share a slot stack in the order they were named', () => {
    expect(pointerLevels({ lo: 2, mid: 2, hi: 5, off: null }, ['lo', 'mid', 'hi', 'off'])).toEqual({ lo: 0, mid: 1, hi: 0 })
  })
})

describe('cells block', () => {
  const box = (m: SceneModel, node: MNode, tau: number): [number, number, number, number] => { const b = m.state(tau).bounds(node); return [b.min[0], b.min[1], b.max[0], b.max[1]] }
  test('everything stays inside the rectangle the stage gave it, for short and long rows, alone and beside others', () => {
    for (const n of [1, 3, 8, 20, 40]) for (const others of [0, 2]) {
      const stage: Record<string, unknown> = { row: cells(Array.from({ length: n }, (_, i) => i * 7), { pointers: ['lo', 'mid', 'hi'], index: true }) }
      for (let k = 0; k < others; k++) stage[`x${k}`] = cells([1, 2])
      const m = build({ title: 'T', stage, story: [{ say: 'A [row](row).', row: { lo: 0, mid: 0, hi: n } }, { say: 'On.', row: { lo: -1, mid: null, lit: [0, 0] } }] })
      const r = quickAccount(m)!.blocks[0]!.rect
      for (const node of m.nodes.filter((x) => x.id.startsWith('row') && !x.parent)) for (const st of m.steps) {
        if (m.state(st.t1 - 0.01).opacity(node) <= 0) continue
        const [x0, y0, x1, y1] = box(m, node, st.t1 - 0.01)
        expect(x0).toBeGreaterThanOrEqual(r[0] - 1e-6)
        expect(x1).toBeLessThanOrEqual(r[0] + r[2] + 1e-6)
        expect(y0).toBeGreaterThanOrEqual(r[1] - 1e-6)
        expect(y1).toBeLessThanOrEqual(r[1] + r[3] + 1e-6)
      }
      // a row too long to read says so instead of drawing unreadable values silently
      const tooSmall = diags(m).some((d) => d.includes('smallest size that is still read'))
      if (n === 40) expect(tooSmall).toBe(true)
      if (n <= 8 && others === 0) expect(tooSmall).toBe(false)
    }
  })
  test('a swap ends with the two values in each other\'s place; a pointer glides; a dimmed value is still readable', () => {
    const m = build({ stage: { row: cells([5, 2, 9], { pointers: ['p'] }) }, story: [{ say: 'A [row](row).', row: { p: 0 } }, { row: { compare: [0, 1], swap: [0, 1], p: 2, lit: [1, 2] } }] })
    expect(diags(m)).toEqual([])
    const x = (id: string, tau: number): number => m.state(tau).world(m.byId.get(id)!).p[0]
    const end = m.duration - 0.01, before = m.steps[0]!.t1 - 0.01
    expect(x('row.cell0', end)).toBeCloseTo(x('row.cell1', before), 6)
    expect(x('row.cell1', end)).toBeCloseTo(x('row.cell0', before), 6)
    expect(x('row.p', before)).toBeCloseTo(x('row.cell0', before), 6)
    expect(x('row.p', end)).toBeCloseTo(x('row.cell2', before), 6)
    // half way through the swap the two values are off the row line, on opposite sides
    const mid = m.steps[1]!.t0 + CELLS_DEFAULTS.markSeconds + CELLS_DEFAULTS.moveSeconds / 2
    const y = (id: string): number => m.state(mid).world(m.byId.get(id)!).p[1]
    expect((y('row.cell0') - y('row.cell2')) * (y('row.cell1') - y('row.cell2'))).toBeLessThan(0)
    expect(m.state(end).opacity(m.byId.get('row.value1')!)).toBeCloseTo(CELLS_DEFAULTS.dimInk, 6)
    expect(m.state(end).opacity(m.byId.get('row.box1')!)).toBeCloseTo(CELLS_DEFAULTS.dimOpacity, 6)
    expect(CELLS_DEFAULTS.dimInk).toBeGreaterThanOrEqual(0.5)
  })
  test('a pointer that is not placed is not shown; options that do not exist are reported with the valid ones', () => {
    const m = build({ stage: { row: cells([1, 2], { pointers: ['p', 'swap'], indx: true } as never) }, story: [{ say: 'A [row](row).' }] })
    expect(m.state(m.duration - 0.01).opacity(m.byId.get('row.p')!)).toBe(0)
    expect(diags(m).join('\n')).toContain('cells() has no option "indx"')
    expect(diags(m).join('\n')).toContain('did you mean "index"? options: pointers, labels, index, style')
    expect(diags(m).join('\n')).toContain('a pointer cannot be called "swap"')
  })
})
