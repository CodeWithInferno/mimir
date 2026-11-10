// What scene authors hit in their first hour with plots (they wrote scenes from the public reference only). Each case
// is the reduced scene of a report, kept as a regression test.
import { describe, expect, test } from 'bun:test'
import type { Handle } from '../../../src/core/index.ts'
import { build, codes } from '../core/helpers.ts'
import { axes } from '../../../src/plot/index.ts'
import '../../../src/plot/plot.chunk.ts'

describe('plots, as authors use them', () => {
  test('`opacity` is an option of every part of a plot, as the reference says (it was API-UNKNOWN on ax.plot, ax.dot and ax.mark)', () => {
    let curve!: Handle, dot!: Handle, mark!: Handle, live!: Handle
    const m = build((s) => {
      const dim = s.param('dim', { value: 0.25, min: 0, max: 1 })
      const ax = axes({ x: [0, 10], y: [0, 10] })
      curve = ax.plot((x: number) => x, { opacity: 0.5 })
      dot = ax.dot([2, 2], { opacity: 0.4 })
      mark = ax.mark(5, 'x', { opacity: 0.3 })
      live = ax.dot([4, 4], { opacity: () => dim() })
    })
    expect(codes(m)).toEqual([])
    const f = m.state(0)
    expect([f.prop(curve, 'opacity'), f.prop(dot, 'opacity'), f.prop(mark, 'opacity'), f.prop(live, 'opacity')]).toEqual([0.5, 0.4, 0.3, 0.25])
    expect(m.state(0, { dim: 0.75 }).prop(live, 'opacity')).toBe(0.75)
  })
})

describe('verbs on parts of a plot', () => {
  test('fadeIn / fadeOut with a scale change the size about the dot itself, not about the origin of its axes', async () => {
    const { fadeIn, fadeOut } = await import('../../../src/anim/index.ts')
    const { circle } = await import('../../../src/r2d/index.ts')
    let dot!: Handle, free!: Handle
    const m = build((s) => {
      const ax = axes({ x: [-6, 6], y: [-2, 2], width: 6, height: 2 }).at(-3.5, 1.5)
      dot = ax.dot([-4, 1], { radius: 0.15 })
      free = circle({ radius: 0.3 }).at(3, -2)
      s.step('in', (st: any) => { st.play(fadeIn(dot, { scale: 3 }), fadeIn(free, { scale: 3 }), { duration: 2 }) })
      s.step('out', (st: any) => { st.play(fadeOut(dot, { scale: 0.2, shift: [0, 1, 0] }), { duration: 2 }) })
    })
    expect(codes(m)).toEqual([])
    const centre = (tau: number, n: Handle): number[] => m.state(tau).anchor(n, 'center').map((v) => Math.round(v * 1e6) / 1e6)
    const rest = centre(2.5, dot), still = centre(2.5, free)
    // the dot was three times as far from the centre of the plot at the start and slid in sideways (it was hidden until 2.5 s)
    for (const tau of [0.01, 0.5, 1, 1.5, 1.99]) { expect([tau, centre(tau, dot)]).toEqual([tau, rest]); expect(centre(tau, free)).toEqual(still) }
    const size = (tau: number): number => { const b = m.state(tau).bounds(dot); return b.max[0] - b.min[0] }
    expect(size(0.01) / size(2.5)).toBeGreaterThan(2.5) // and it does start large
    // leaving: it shrinks about itself while it goes up by the shift
    const step2 = m.steps[1]!.t0
    const half = centre(step2 + 1, dot), gone = centre(step2 + 1.99, dot)
    expect(half[0]).toBeCloseTo(rest[0]!, 5)
    expect(gone[0]).toBeCloseTo(rest[0]!, 5)
    expect(gone[1]! - rest[1]!).toBeGreaterThan(0.9)
  })
})

describe('a part of a plot in a group()', () => {
  test('a curve grouped with its axes stays a part of them and is still drawn (it vanished, with only a TINY warning)', async () => {
    const { group } = await import('../../../src/r2d/index.ts')
    let curve!: Handle, free!: Handle, ax!: Handle, g!: Handle
    const m = build((s) => {
      ax = axes({ x: [0, 10], y: [0, 10], width: 5, height: 3 })
      curve = ax.plot([[0, 1], [5, 6], [10, 2]])
      free = ax.plot([[0, 2], [5, 3], [10, 8]])
      g = group([ax, curve])
      s.step('move', (st: any) => { st.play(g.to.shift(1, 0)) })
    })
    expect(codes(m)).toEqual([])
    expect([curve.parent, free.parent, ax.parent]).toEqual([ax, ax, g])
    const runs = (tau: number, n: Handle): unknown[] => (m.state(tau).props(n).geometry as { runs: unknown[] }).runs
    expect(runs(0, curve).length).toBe(1)
    // and it moves with the group, like the curve that was not named
    const left = (tau: number, n: Handle): number => m.state(tau).bounds(n).min[0]
    const end = m.duration - 0.01
    expect(left(end, curve) - left(0, curve)).toBeCloseTo(1, 3)
    expect(left(end, free) - left(0, free)).toBeCloseTo(1, 3)
  })

  test('a part grouped WITHOUT the object it belongs to is said, with the fix, and stays where it works', async () => {
    const { group, rect } = await import('../../../src/r2d/index.ts')
    let curve!: Handle, ax!: Handle
    const m = build(() => {
      ax = axes({ id: 'plot', x: [0, 10], y: [0, 10] })
      curve = ax.plot([[0, 1], [10, 2]], { id: 'line' })
      group([rect({ id: 'frame' }), curve])
    })
    expect(curve.parent).toBe(ax)
    const d = m.diagnostics.list.find((x) => x.code === 'API-TYPE')!
    expect(d.what).toBe('group(): #line is a part of #plot and stays inside it; a group cannot take it out.')
    expect(d.fix[0]).toBe('put #plot in the group: its parts come with it')
    expect((m.state(0).props(curve).geometry as { runs: unknown[] }).runs.length).toBe(1)
  })
})
