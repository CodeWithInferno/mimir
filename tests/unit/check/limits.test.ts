// The limits of `mimir check` are named defaults in one place, each with a configuration key, and nothing about a
// scene's vocabulary decides what is sampled (docs/OSS-HYGIENE.md, rules 4 and 5).
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { rect } from '../../../src/r2d/index.ts'
import { LIMITS, LIMIT_RULE, configKey, configuredLimits, settingsOf, type LimitName } from '../../../src/check/limits.ts'
import { insideShares, isCyclic, planSamples } from '../../../src/check/plan.ts'
import { ruleCodes } from '../../../src/check/engine.ts'
import type { ParamDef, SceneModel } from '../../../src/core/index.ts'
import { build, check } from './helpers.ts'

const CHECK_DIR = join(import.meta.dir, '..', '..', '..', 'src', 'check')
const NAMES = Object.keys(LIMITS) as LimitName[]
/** a model whose config store answers from `values` (what the core's store will do), built from a small scene */
const withConfig = (values: Record<string, unknown>, fn: (s: any) => void = (s) => { rect({ id: 'a' }); s.step('one', (st: any) => { st.wait(1) }) }): SceneModel => {
  const model = build(fn)
  ;(model as unknown as { config: (key: string, fallback: unknown) => unknown }).config = (key, fallback) => (key in values ? values[key] : fallback)
  return model
}

describe('limits', () => {
  test('every limit is a number that is not negative, belongs to a rule (or the plan, or the engine) and has a key check.<CODE>.<name>', () => {
    const codes = new Set([...ruleCodes(), 'PLAN', 'ENGINE'])
    expect(Object.keys(LIMIT_RULE).sort()).toEqual([...NAMES].sort())
    for (const name of NAMES) {
      expect([name, typeof LIMITS[name] === 'number' && LIMITS[name] >= 0]).toEqual([name, true])
      expect([name, codes.has(LIMIT_RULE[name])]).toEqual([name, true])
      expect(configKey(name)).toBe(`check.${LIMIT_RULE[name]}.${name}`)
    }
    expect(configKey('occludedVisible')).toBe('check.OCCLUDED.occludedVisible')
  })

  test('RULES.md names every limit, so the document cannot fall behind the code', () => {
    const doc = readFileSync(join(CHECK_DIR, 'RULES.md'), 'utf8')
    const missing = NAMES.filter((name) => !doc.includes('`' + name + '`'))
    expect(missing).toEqual([])
    for (const name of NAMES) expect([name, doc.includes(`| \`${name}\` | \`${LIMIT_RULE[name]}\` | ${LIMITS[name]} |`)]).toEqual([name, true])
  })

  test('the typed reference (api.d.ts) declares every limit with its default in brackets', () => {
    const dts = readFileSync(join(CHECK_DIR, 'api.d.ts'), 'utf8')
    const body = dts.slice(dts.indexOf('interface CheckLimits {'), dts.indexOf('/** Claims about the scene'))
    const declared = [...body.matchAll(/\[([\d.]+)\]\. \*\/\n  ([a-zA-Z]+)\?: number/g)].map((m) => [m[2]!, Number(m[1])])
    expect(declared.map(([n]) => n).sort()).toEqual([...NAMES].sort())
    for (const [name, value] of declared) expect([name, value]).toEqual([name, LIMITS[name as LimitName]])
  })

  test('no rule file holds a threshold of its own: the numbers the audit listed are read from the limits', () => {
    const check = readFileSync(join(CHECK_DIR, 'check.ts'), 'utf8')
    for (const literal of ['GX = 96', '> 50 * rest', 'past <= 1.5', '[0.25, 0.5, 0.75]', '0.137', 'digits: 2']) expect([literal, check.includes(literal)]).toEqual([literal, false])
    const plan = readFileSync(join(CHECK_DIR, 'plan.ts'), 'utf8')
    expect(plan).not.toMatch(/angle\|crank\|phase\|theta\|rotation/)
    expect(plan).not.toMatch(/p\.name\)/) // nothing tests the name of a param
  })

  test('without a config store the defaults are used; with one, check.<CODE>.<name> overrides a default and s.check() overrides both', () => {
    const plain = build((s) => { rect({ id: 'a' }); s.step('one', (st: any) => { st.wait(1) }) })
    expect(configuredLimits(plain)).toEqual(LIMITS)
    const model = withConfig({ 'check.OCCLUDED.occludedVisible': 0.45, 'check.PLAN.planPhases': 4 })
    expect(configuredLimits(model)).toEqual({ ...LIMITS, occludedVisible: 0.45, planPhases: 4 })
    const scene = withConfig({ 'check.OCCLUDED.occludedVisible': 0.45, 'check.TINY.tinyPixels': 9 }, (s) => {
      rect({ id: 'a' })
      s.check({ limits: { occludedVisible: 0.5 } })
      s.step('one', (st: any) => { st.wait(1) })
    })
    const limits = settingsOf(scene, ruleCodes()).limits
    expect([limits.occludedVisible, limits.tinyPixels, limits.textTiny]).toEqual([0.5, 9, LIMITS.textTiny])
  })

  test('a configured value that is not a usable number is reported with its key and the default stays', () => {
    const model = withConfig({ 'check.TINY.tinyPixels': -3, 'check.TEXT-TINY.textTiny': 'small' })
    const limits = configuredLimits(model)
    expect([limits.tinyPixels, limits.textTiny]).toEqual([LIMITS.tinyPixels, LIMITS.textTiny])
    const said = [...model.diagnostics.byCode('NUM-INVALID'), ...model.diagnostics.byCode('API-TYPE')].map((d) => d.what)
    expect(said).toEqual([
      'the configuration value check.TINY.tinyPixels must be a number that is not negative, got -3.',
      'the configuration value check.TEXT-TINY.textTiny must be a number that is not negative, got small.',
    ])
  })

  test('one visibility threshold: OCCLUDED uses the share the guide documents for GUIDE-TARGET', async () => {
    const { guideConfig } = await import('../../../src/guide/index.ts')
    const model = build((s) => { rect({ id: 'a' }); s.step('one', (st: any) => { st.wait(1) }) })
    // while the guide still carries a number of its own it must be this one; once it reads check's limit it has none
    const own = (guideConfig(model) as { minimumVisibleShare?: number }).minimumVisibleShare
    if (own !== undefined) expect(own).toBe(LIMITS.occludedVisible)
    expect(LIMITS.occludedVisible).toBe(0.3)
  })
})

describe('the sampling plan', () => {
  const param = (over: Partial<ParamDef> & { cyclic?: boolean }): ParamDef => ({ name: 'p', kind: 'number', value: 0, min: 0, max: 360, step: 0, unit: '', label: 'p', options: [], src: { line: 1, file: null } as ParamDef['src'], ...over }) as ParamDef

  test('the NAME of a param never makes it cyclic (it did: angle, crank, phase, theta, rotation)', () => {
    for (const name of ['angle', 'crank', 'crankAngle', 'phase', 'theta', 'rotation']) expect([name, isCyclic(param({ name }))]).toEqual([name, false])
    expect(isCyclic(param({ name: 'crank', min: 0, max: 90, unit: '°' }))).toBe(false) // a quarter turn does not go round
  })

  test('declared: `cyclic` says so either way; without it, a unit of degrees over whole turns goes round', () => {
    expect(isCyclic(param({ name: 'speed', unit: '°' }))).toBe(true)
    expect(isCyclic(param({ name: 'speed', unit: 'deg', max: 720 }))).toBe(true)
    expect(isCyclic(param({ name: 'speed', unit: 'degrees', max: 540 }))).toBe(false) // one and a half turns
    expect(isCyclic(param({ name: 'speed', unit: 'mm' }))).toBe(false)
    expect(isCyclic(param({ name: 'speed', unit: 'mm', max: 12, cyclic: true }))).toBe(true)
    expect(isCyclic(param({ name: 'angle', unit: '°', cyclic: false }))).toBe(false)
    expect(isCyclic(param({ kind: 'toggle', cyclic: true }))).toBe(false)
  })

  test('a slider called "crank" without a unit gets no phase samples; one declared in degrees over a turn gets planPhases of them', () => {
    const scene = (unit: string) => (s: any) => {
      const crank = s.param('crank', { value: 0, min: 0, max: 360, ...(unit ? { unit } : {}) })
      rect({ id: 'a' }).rotate(() => crank())
      s.step('turn', (st: any) => { st.set(crank, 180) })
    }
    expect(planSamples(build(scene(''))).filter((x) => x.kind === 'phase')).toEqual([])
    expect(planSamples(build(scene('°'))).filter((x) => x.kind === 'phase').map((x) => x.params.crank)).toEqual([0, 45, 90, 135, 180, 225, 270, 315])
    const few = planSamples(build(scene('°')), { planTransitions: 1, planPhases: 4 })
    expect(few.filter((x) => x.kind === 'phase').map((x) => x.params.crank)).toEqual([0, 90, 180, 270])
    expect(few.filter((x) => x.kind === 'transition').map((x) => x.label)).toEqual(['step 1 at 50%'])
  })

  test('insideShares: evenly spaced moments strictly inside a span', () => {
    expect(insideShares(3)).toEqual([0.25, 0.5, 0.75])
    expect(insideShares(1)).toEqual([0.5])
    expect(insideShares(0)).toEqual([])
  })

  test('s.check({ limits }) reaches the plan: the engine samples with the scene\'s own counts', async () => {
    const r = await check((s) => {
      const crank = s.param('crank', { value: 0, min: 0, max: 360, unit: '°' })
      rect({ id: 'a' }).rotate(() => crank())
      s.check({ limits: { planPhases: 3, planTransitions: 1 } })
      s.step('turn', (st: any) => { st.set(crank, 180) })
    })
    // 1 transition + 1 step end + min / default / max + 3 phases
    expect(r.stats.samples).toBe(8)
  })
})
