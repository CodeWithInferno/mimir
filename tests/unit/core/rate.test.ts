// Rate functions against the python reference (the project research notes): 201 sample points per function.
import { describe, expect, test } from 'bun:test'
import ref from './fixtures/rate_ref.json'
import * as R from '../../../src/core/rate.ts'

const fns: Record<string, (t: number) => number> = {
  ...R.RATES,
  smoothBezier: R.bezier([0, 0, 0, 1, 1, 1]),
  squishSmooth: R.squish(R.smooth),
  notQuiteThere: R.notQuiteThere(),
}
describe('rate functions', () => {
  const table = ref as Record<string, number[]>
  for (const [name, want] of Object.entries(table)) {
    const f = fns[name]
    if (name === 'smoothCE') continue // ManimCE's logistic variant is deliberately not ported
    test(`${name} matches the reference at ${want.length} points`, () => {
      expect(f).toBeDefined()
      let worst = 0
      for (let i = 0; i < want.length; i++) worst = Math.max(worst, Math.abs(f!(i / (want.length - 1)) - want[i]!))
      expect(worst).toBeLessThan(1e-12)
    })
  }
  test('every ported function is covered by the reference or a landmark below', () => {
    const covered = new Set([...Object.keys(table), 'lingering'])
    for (const name of Object.keys(R.RATES)) expect(covered.has(name)).toBe(true)
  })
  test('landmarks', () => {
    const scan = (f: (t: number) => number, better: (a: number, b: number) => boolean): { t: number; v: number } => {
      let best = { t: 0, v: f(0) }
      for (let i = 0; i <= 100000; i++) { const t = i / 100000, v = f(t); if (better(v, best.v)) best = { t, v } }
      return best
    }
    const peak = scan(R.overshoot, (a, b) => a > b)
    expect(peak.v).toBeCloseTo(1.2058, 4)
    expect(peak.t).toBeCloseTo(0.634, 3)
    const dip = scan(R.runningStart, (a, b) => a < b)
    expect(dip.v).toBeCloseTo(-0.1848, 4)
    expect(dip.t).toBeCloseTo(0.29, 2)
    expect(scan(R.wiggle, (a, b) => a > b).v).toBeCloseTo(0.684, 3)
    expect(R.exponentialDecay(1)).toBeCloseTo(0.99995, 5)
    for (const t of [0, 0.2, 0.4, 0.8, 0.9, 1]) expect(R.lingering(t)).toBeCloseTo(Math.min(1, t / 0.8), 14)
    expect(R.smooth(0)).toBe(0)
    expect(R.smooth(1)).toBe(1)
    expect(R.smooth(0.5)).toBeCloseTo(0.5, 14)
    expect(R.thereAndBack(0)).toBe(0)
    expect(R.thereAndBack(0.5)).toBe(1)
    expect(R.thereAndBack(1)).toBe(0)
  })
  test('timing helpers', () => {
    expect(R.laggedTimings([1, 1, 1, 1], 0.5)).toEqual([[0, 1], [0.5, 1.5], [1, 2], [1.5, 2.5]])
    // alpha 0.5 over 5 parts with lag 0.1: part i is at smooth(0.5 * 1.4 - 0.1 * i)
    const got = [0, 1, 2, 3, 4].map((i) => R.subAlpha(0.5, i, 5, 0.1))
    ;[0.7, 0.6, 0.5, 0.4, 0.3].forEach((x, i) => expect(got[i]!).toBeCloseTo(R.smooth(x), 14))
    expect(got[2]!).toBeCloseTo(0.5, 14)
    expect(R.subAlpha(1, 4, 5, 0.1)).toBe(1)
    expect(R.subAlpha(0, 0, 5, 0.1)).toBe(0)
    expect(R.spanAlpha(0.5, 4, 1, 3)).toBe(0.5)
  })
  test('snake_case aliases point at the same functions', () => {
    expect(R.RATE_ALIASES.rush_into).toBe(R.rushInto)
    expect(R.RATE_ALIASES.there_and_back).toBe(R.thereAndBack)
  })
  test('pacing defaults', () => {
    expect(R.PACE.enter).toBe(1)
    expect(R.PACE.play).toBe(1) // DESIGN §3.3: "play 1 s" (m.to…, param.to)
    expect(R.PACE.sweep).toBe(3)
    expect(R.PACE.wait).toBe(1)
    expect(R.PACE.lag).toBe(0.1)
  })
})
