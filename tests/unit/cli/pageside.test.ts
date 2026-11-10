// The page-side expressions are JavaScript text. Here they run against small fake hosts, so their logic is tested
// without a browser; the e2e tests run them in the real viewer.
import { describe, expect, test } from 'bun:test'
import type { ParamInfo, SceneInfo } from '../../../src/cli/format.ts'
import { PARAM_SCAN_PRECISION, frameExpression, paramTimeExpression, queryExpression } from '../../../src/cli/pageside.ts'
import { checkSets, setProblem } from '../../../src/cli/params.ts'

/** Evaluate an expression with `window.__mimir = host` (and no bridge: the frame state is not reachable). */
const run = async <T>(expression: string, host: Record<string, unknown>): Promise<T> => {
  const window: Record<string, unknown> = { __mimir: host }
  const out = await (new Function('window', 'globalThis', `return ${expression}`)(window, {}) as Promise<string>)
  return JSON.parse(out) as T
}

/** A host whose one parameter is a function of story time. */
function timeline(value: (t: number) => unknown, duration = 10): Record<string, unknown> {
  let tau = 0
  return {
    info: () => ({ duration }),
    seek: (t: number) => { tau = t },
    state: () => ({ tau, params: { crank: value(tau) } }),
  }
}

describe('--at name=value: the first moment the story has the parameter there', () => {
  test('a ramp: found by bisection to the precision, at or just past the target', async () => {
    // 40 → 360 between t = 2 and t = 8
    const ramp = (t: number): number => 40 + 320 * Math.min(1, Math.max(0, (t - 2) / 6))
    const r = await run<{ found: boolean; t: number; actual: number }>(paramTimeExpression('crank', 200), timeline(ramp))
    expect(r.found).toBe(true)
    expect(r.t).toBeCloseTo(5, 2)
    expect(Math.abs(r.actual - 200)).toBeLessThan(320 / 6 * (PARAM_SCAN_PRECISION + 0.001))
    // a value the story starts at is found at t = 0; the last value at the end of the ramp
    expect((await run<{ t: number }>(paramTimeExpression('crank', 40), timeline(ramp))).t).toBe(0)
    expect((await run<{ t: number }>(paramTimeExpression('crank', 360), timeline(ramp))).t).toBeCloseTo(8, 1)
  })
  test('the FIRST crossing is returned when the value comes back', async () => {
    const wave = (t: number): number => 100 * Math.sin((t / 10) * Math.PI) // up to 100 at t = 5, back to 0 at 10
    const r = await run<{ t: number }>(paramTimeExpression('crank', 50), timeline(wave))
    expect(r.t).toBeCloseTo(10 / 6, 2)
  })
  test('a value the story never reaches reports the range it does cover', async () => {
    const r = await run<{ found: boolean; reason: string; from: number; to: number }>(paramTimeExpression('crank', 500), timeline((t) => 40 + t))
    expect(r).toMatchObject({ found: false, reason: 'never', from: 40, to: 50 })
  })
  test('toggles and choices: the first moment the value is the one asked for', async () => {
    const r = await run<{ found: boolean; t: number; actual: unknown }>(paramTimeExpression('crank', true), timeline((t) => t >= 3))
    expect(r.found).toBe(true)
    expect(r.t).toBeCloseTo(3, 2)
    expect(r.actual).toBe(true)
    const c = await run<{ t: number }>(paramTimeExpression('crank', 'fast'), timeline((t) => (t < 6 ? 'slow' : 'fast')))
    expect(c.t).toBeCloseTo(6, 2)
    const never = await run<{ found: boolean; seen: string[] }>(paramTimeExpression('crank', 'warp'), timeline((t) => (t < 6 ? 'slow' : 'fast')))
    expect(never).toMatchObject({ found: false, seen: ['slow', 'fast'] })
  })
  test('a viewer without state() says so instead of guessing', async () => {
    expect(await run(paramTimeExpression('crank', 1), { info: () => ({ duration: 5 }), seek: () => {} })).toEqual({ found: false, reason: 'no-state' })
  })
})

describe('frameExpression', () => {
  const host = (calls: string[]): Record<string, unknown> => ({
    seek: (t: number) => void calls.push(`seek ${t}`),
    setParam: (n: string, v: unknown) => void calls.push(`set ${n}=${v}`),
    setView: (v: unknown) => void calls.push(`view ${JSON.stringify(v)}`),
    frame: async () => void calls.push('frame'),
    probes: () => ({ h: 1 }),
    state: () => ({ params: { crank: 7 } }),
    info: () => ({ params: [] }),
  })
  test('a turntable view is a pose patch: only the azimuth', async () => {
    const calls: string[] = []
    expect(await run(frameExpression(2, [], { azimuth: 135 }), host(calls))).toEqual({ probes: { h: 1 }, params: { crank: 7 } })
    expect(calls).toEqual(['seek 2', 'view {"azimuth":135}', 'frame'])
  })
  test('the legend is asked for only with --debug ids, and is null when the viewer cannot be measured', async () => {
    const calls: string[] = []
    const r = await run<{ legend: unknown }>(frameExpression(2, [], null, { legend: true }), host(calls))
    expect(r.legend).toBeNull()
    expect(await run(frameExpression(2, [], null), host([]))).not.toHaveProperty('legend')
  })
})

describe('queryExpression', () => {
  const base = {
    info: () => ({ steps: [{ index: 2, title: 'Push', chapter: 1 }] }),
    state: () => ({ tau: 5.25, step: 2, u: 0.25, duration: 20, params: { push: 1 }, overridden: ['push'], caption: 'Push down.' }),
    probes: () => ({ rise: 0.11 }),
    frame: async () => {},
  }
  test('state and probes come straight from the host protocol', async () => {
    expect(await run(queryExpression({ what: 'state', ids: [], tolerance: 0.01 }), base)).toEqual({
      source: 'viewer',
      result: { t: 5.25, duration: 20, step: 2, step_title: 'Push', chapter: 1, u: 0.25, params: { push: 1 }, overridden: ['push'], caption: 'Push down.', camera: null },
    })
    expect(await run(queryExpression({ what: 'probes', ids: [], tolerance: 0.01 }), base)).toEqual({
      source: 'viewer', result: { t: 5.25, step: 2, params: { push: 1 }, probes: { rise: 0.11 } },
    })
  })
  test('the viewer\'s own query() is used when it has one, with the ids and the tolerance', async () => {
    const seen: unknown[] = []
    const host = { ...base, query: async (what: string, ids: string[], opts: unknown) => { seen.push([what, ids, opts]); return { distance: 4.2 } } }
    expect(await run(queryExpression({ what: 'distance', ids: ['a', 'b'], tolerance: 0.5 }), host)).toEqual({ source: 'viewer', result: { distance: 4.2 } })
    expect(seen).toEqual([['distance', ['a', 'b'], { tolerance: 0.5 }]])
    const broken = { ...base, query: () => { throw new Error('no such part') } }
    expect(await run<{ unavailable: string }>(queryExpression({ what: 'bounds', ids: ['a'], tolerance: 0 }), broken)).toEqual({ unavailable: 'the viewer threw in __mimir.query(): no such part' })
  })
  test('a viewer that offers neither query() nor its frame state gets "unavailable", never a number', async () => {
    for (const what of ['distance', 'bounds', 'visible', 'contacts']) {
      const r = await run<{ unavailable?: string; result?: unknown }>(queryExpression({ what, ids: ['a', 'b'], tolerance: 0.01 }), base)
      expect(r.unavailable).toContain('neither __mimir.query() nor its frame state')
      expect(r.result).toBeUndefined()
    }
  })
})

describe('--set is checked against what the scene declares', () => {
  const param = (over: Partial<ParamInfo>): ParamInfo => ({ name: 'p', min: 0, max: 10, value: 5, kind: 'number', options: [], ...over })
  const info = (params: ParamInfo[]): SceneInfo => ({ title: '', duration: 1, steps: [], params, parts: [], views: null, problems: null, fatal: null })
  test('setProblem: range, kind, options; an unknown kind is not judged', () => {
    expect(setProblem(param({}), 11)).toBe('"p" goes from 0 to 10')
    expect(setProblem(param({}), 'x')).toBe('"p" is a number from 0 to 10')
    expect(setProblem(param({}), 10)).toBeNull()
    expect(setProblem(param({ kind: 'toggle' }), 1)).toBe('"p" is a toggle: true or false')
    expect(setProblem(param({ kind: 'choice', options: ['a', 'b'] }), 'c')).toBe('"p" is one of: a, b')
    expect(setProblem(param({ kind: null }), 'anything')).toBeNull()
  })
  test('checkSets names the command, suggests the nearest parameter and lists them', () => {
    const i = info([param({ name: 'crank' }), param({ name: 'bore' })])
    expect(() => checkSets(i, [{ name: 'crank', value: 3 }], 'query')).not.toThrow()
    expect(() => checkSets(i, [{ name: 'crnk', value: 3 }], 'query')).toThrow('--set crnk: the scene has no parameter "crnk"; did you mean crank? (parameters: crank, bore)')
    expect(() => checkSets(i, [{ name: 'bore', value: 99 }], 'export')).toThrow('--set bore=99: "bore" goes from 0 to 10')
    expect(() => checkSets(info([]), [{ name: 'x', value: 1 }], 'shot')).toThrow('(parameters: none)')
  })
})
