// The config store (src/core/config.ts): one place for every default that shapes output, one accessor, three layers
// (the registered default, the project's mimir.config.json, the scene), and diagnostics for what is wrong.
import { afterEach, describe, expect, test } from 'bun:test'
import {
  CAMERA_DEFAULTS, closeConfigGroup, compile, config, configDefault, declareConfig, defineConfig, flattenConfig, PACE, scene, setProjectConfig, TEXT_SIZES, VIEWS,
  type SceneModel,
} from '../../../src/core/index.ts'
import { build, codes } from './helpers.ts'
import { rect, text } from '../../../src/r2d/index.ts'
import { box } from '../../../src/r3d/index.ts'
import { fadeIn } from '../../../src/anim/index.ts'

const diags = (m: SceneModel) => m.diagnostics.list.map((d) => ({ code: d.code, severity: d.severity, what: d.what, fix: d.fix, file: d.file, line: d.line }))
const withDefaults = (defaults: unknown, fn: (s: any) => void = () => {}): SceneModel => compile(scene({ title: 'config', defaults } as never, fn))

afterEach(() => setProjectConfig(null))

describe('the config store', () => {
  test('nested groups and dotted keys are the same thing', () => {
    expect(flattenConfig({ pace: { play: 2 }, 'pace.hold': 0, look: { light: { key: [1, 2, 3] } } })).toEqual([['pace.play', 2], ['pace.hold', 0], ['look.light.key', [1, 2, 3]]])
  })

  test('every reader gets the default until somebody says otherwise; outside a scene the constants read the defaults', () => {
    expect(PACE.play).toBe(1)
    expect(PACE.camera).toBe(2)
    expect(TEXT_SIZES.title).toBe(72)
    expect(config('pace.hold')).toBe(1)
    expect(configDefault('pace.lag')).toBe(0.1)
    const m = build((s) => { s.step('one', (st: any) => { st.wait() }) })
    expect(m.config('pace.play')).toBe(1)
    expect(m.config('nobody.registered.this', 7)).toBe(7) // an unregistered key answers with the caller's fallback
    expect([m.steps[0]!.t0, m.steps[0]!.t1]).toEqual([0, 2]) // wait 1 + hold 1
  })

  test('scene({ defaults }): pacing reaches every module that reads PACE, without those modules knowing', () => {
    let a!: any, p!: any
    const m = withDefaults({ pace: { play: 2.5, hold: 0.25, enter: 3, camera: 4, lag: 0.5 } }, (s) => {
      a = rect()
      p = s.param('p', { value: 0, min: 0, max: 1 })
      s.step('play', (st: any) => { st.play(p.to(1)) })
      s.step('verb of another module', (st: any) => { st.play(fadeIn(a)) })
      s.step('camera', (st: any) => { box(); st.camera({ view: 'front' }) })
      s.step('default wait', (st: any) => { st.wait() })
    })
    expect(codes(m)).toEqual([])
    expect(m.steps.map((x) => +(x.t1 - x.t0).toFixed(6))).toEqual([2.75, 3.25, 4.25, 1.25])
    // the scene that follows starts from the defaults again: nothing leaks from one model into the next
    const next = build((s) => { s.step('play', (st: any) => { st.play(s.param('q', { value: 0, min: 0, max: 1 }).to(1)) }) })
    expect(next.steps[0]!.t1).toBe(2)
  })

  test('s.config({ … }) sets, s.config(key) reads; the type scale is a setting', () => {
    let big!: any, read: unknown
    const m = build((s) => {
      s.config({ 'text.size.title': 96, pace: { hold: 0 } })
      read = s.config('text.size.title')
      big = text('Title', { size: 'title' })
      s.step('x', (st: any) => { st.wait(1) })
    })
    expect(codes(m)).toEqual([])
    expect(read).toBe(96)
    expect(m.state(0).prop(big, 'size')).toBe(96)
    expect(m.steps[0]!.t1).toBe(1)
  })

  test('the default camera view, field of view and fill are settings', () => {
    const fit = (defaults: unknown) => { const m = withDefaults(defaults, () => { box({ width: 2, height: 1, depth: 1 }) }); return m.state(0).camera() }
    const iso = fit(undefined), front = fit({ camera: { view: 'front', fov: 40 } }), tight = fit({ 'camera.fill': 0.4 })
    expect([iso.azimuth, iso.elevation, iso.fov]).toEqual([VIEWS.iso!.azimuth, VIEWS.iso!.elevation, 30])
    expect([front.azimuth, front.elevation, front.fov]).toEqual([0, 0, 40])
    expect(tight.distance).toBeGreaterThan(iso.distance * 1.5) // half the fill: about twice as far
    expect(CAMERA_DEFAULTS.view).toBe('iso')
  })

  test('an unknown key in a group whose keys are all registered is reported where it is set, with the nearest name', () => {
    const m = withDefaults({ pace: { plya: 3 }, 'text.size.titel': 80 })
    expect(diags(m).map((d) => [d.code, d.what, d.fix[0]])).toEqual([
      ['API-UNKNOWN', 'scene({ defaults }): there is no setting "pace.plya".', 'use "pace.play"'],
      ['API-UNKNOWN', 'scene({ defaults }): there is no setting "text.size.titel".', 'use "text.size.title"'],
    ])
    expect(typeof m.diagnostics.list[0]!.line).toBe('number')
    expect(m.config('pace.play')).toBe(1)
  })

  test('a value of the wrong type, below the limit of its group, or not one of the allowed names: reported, the default stays', () => {
    const m = withDefaults({ pace: { play: 'fast', hold: -1, camera: Number.NaN, lag: () => 0.1 }, camera: { view: 'frnt' }, 'text.size.note': null })
    expect(diags(m).map((d) => d.code)).toEqual(['API-TYPE', 'NUM-INVALID', 'NUM-INVALID', 'API-TYPE', 'API-UNKNOWN', 'API-TYPE'])
    expect(m.diagnostics.list[0]!.what).toBe('scene({ defaults }): "pace.play" is a number, got the string "fast".')
    expect(m.diagnostics.list[0]!.fix[0]).toBe(`'pace.play': 1  (the default)`)
    expect(m.diagnostics.list[1]!.what).toContain('must not be below 0, got -1')
    expect(m.diagnostics.list[4]!.what).toContain('did you mean "front"?')
    expect([m.config('pace.play'), m.config('pace.hold'), m.config('pace.camera'), m.config('pace.lag'), m.config('camera.view'), m.config('text.size.note')]).toEqual([1, 1, 2, 0.1, 'iso', 24])
  })

  test('scene({ defaults }) that is not an object, and s.config() with nothing usable, are diagnostics, never exceptions', () => {
    expect(codes(withDefaults(5))).toEqual(['API-TYPE'])
    expect(codes(withDefaults(['pace']))).toEqual(['API-TYPE'])
    expect(codes(build((s) => { s.config(null); s.config(undefined) }))).toEqual(['API-TYPE', 'API-TYPE'])
  })

  test('a setting changed after it was used warns: what was built before keeps the old value', () => {
    const m = build((s) => {
      const p = s.param('p', { value: 0, min: 0, max: 1 })
      s.step('one', (st: any) => { st.play(p.to(1)) }) // reads pace.play (1) and pace.hold (1)
      s.config({ pace: { play: 3, wait: 5 } }) // pace.wait has not been read: no warning for it
      s.step('two', (st: any) => { st.play(p.to(0)) })
    })
    const d = diags(m)
    expect(d.map((x) => [x.code, x.severity])).toEqual([['API-TYPE', 'warn']])
    expect(d[0]!.what).toContain('"pace.play" was already used (as 1)')
    expect(d[0]!.fix[0]).toContain(`scene({ title, defaults: { 'pace.play': 3 } }`)
    expect(m.steps.map((x) => x.t1 - x.t0)).toEqual([2, 4]) // the first step kept 1 s, the second took the new 3 s
  })

  test('the project layer: under the scene, over the defaults; its mistakes are diagnostics of every scene, named after the file', () => {
    setProjectConfig({ pace: { play: 4, hold: 0.5, camera: 'slow' }, text: { size: { hero: 120 } } }, 'mimir.config.json')
    const plain = build((s) => { s.step('one', (st: any) => { st.play(s.param('p', { value: 0, min: 0, max: 1 }).to(1)) }) })
    expect(plain.steps[0]!.t1).toBe(4.5)
    expect(plain.config('text.size.hero')).toBe(120)
    expect(plain.config('pace.camera')).toBe(2) // the wrong value is not used
    expect(diags(plain).map((d) => [d.code, d.what, d.file, d.line])).toEqual([['API-TYPE', 'mimir.config.json: "pace.camera" is a number, got the string "slow".', 'mimir.config.json', null]])
    const own = withDefaults({ pace: { play: 1.5 } }, (s) => { s.step('one', (st: any) => { st.play(s.param('p', { value: 0, min: 0, max: 1 }).to(1)) }) })
    expect(own.steps[0]!.t1).toBe(2) // the scene's 1.5 over the project's 4, the project's hold 0.5
    expect(config('pace.play')).toBe(4) // outside a scene the project still counts
    setProjectConfig(null)
    expect(config('pace.play')).toBe(1)
    setProjectConfig('nonsense', 'mimir.config.json')
    expect(diags(build(() => {})).map((d) => d.what)).toEqual(['mimir.config.json: "defaults" must be an object of settings.'])
  })

  test('groups of another module: registered tables are documented keys, read as a whole or as overrides only', () => {
    defineConfig('cfgtest', {
      /** how wide */
      width: 3,
      deep: { tint: '#ffffff', list: [1, 2, 3], off: null },
    }, { min: 0 })
    closeConfigGroup('cfgtest')
    const m = withDefaults({ cfgtest: { width: 5, deep: { list: [9] } } })
    expect(codes(m)).toEqual([])
    expect(m.settings.group('cfgtest')).toEqual({ width: 5, deep: { tint: '#ffffff', list: [9], off: null } })
    expect(m.settings.overrides('cfgtest')).toEqual({ width: 5, deep: { list: [9] } })
    expect(m.settings.overrides('pace')).toBeNull()
    expect(m.settings.own()).toEqual({ 'cfgtest.width': 5, 'cfgtest.deep.list': [9] })
    // a list of numbers takes a list of numbers; null as a default takes any plain value
    const bad = withDefaults({ cfgtest: { deep: { list: ['a'], off: 4, tint: 7 } } })
    expect(diags(bad).map((d) => d.what)).toEqual(['scene({ defaults }): "cfgtest.deep.list" is a list of numbers.', 'scene({ defaults }): "cfgtest.deep.tint" is a string, got 7.'])
    expect(bad.settings.group('cfgtest')).toEqual({ width: 3, deep: { tint: '#ffffff', list: [1, 2, 3], off: 4 } })
  })

  test('a key of a module that is not loaded waits: it is judged when the module registers (recheck) or when every module is known (settle)', () => {
    const m = withDefaults({ cfglazy: { speed: 2, sped: 3 }, cfgnone: { x: 1 }, cfgopen: { limit: 9 } })
    expect(codes(m)).toEqual([]) // nobody has registered under these groups yet: no verdict
    expect(m.config('cfglazy.speed', 1)).toBe(2) // a reader with a fallback already gets the value
    expect(m.config('cfgopen.limit', 5)).toBe(9)
    // the module arrives (a lazy chunk), says its group is complete
    defineConfig('cfglazy', { speed: 1 })
    closeConfigGroup('cfglazy')
    m.settings.recheck()
    expect(diags(m).map((d) => [d.code, d.what, d.fix[0]])).toEqual([['API-UNKNOWN', 'scene({ defaults }): there is no setting "cfglazy.sped".', 'use "cfglazy.speed"']])
    expect(m.settings.overrides('cfglazy')).toEqual({ speed: 2 }) // the wrong key is not handed to the module
    // `check` knows every module of the build: a group nobody registers and nobody reads is a typo; one that code reads with a fallback is left alone
    m.settings.settle()
    expect(diags(m).slice(1).map((d) => [d.code, d.what])).toEqual([['API-UNKNOWN', 'scene({ defaults }): there is no setting "cfgnone.x" (no module has settings under "cfgnone").']])
    m.settings.settle()
    expect(m.diagnostics.list.length).toBe(2) // each key is reported once
  })

  test('the build tells the dev chunk the settings of every module: a key of a chunk that is not loaded is known, a typo beside it is not', () => {
    declareConfig({ 'cfgfar.gain': 1, 'cfgfar.tone': 'warm' })
    const m = withDefaults({ cfgfar: { gain: 2, gian: 3, tone: 5 } })
    m.settings.settle()
    expect(diags(m).map((d) => [d.code, d.what, d.fix[0]])).toEqual([
      ['API-TYPE', 'scene({ defaults }): "cfgfar.tone" is a string, got 5.', `'cfgfar.tone': "warm"  (the default)`],
      ['API-UNKNOWN', 'scene({ defaults }): there is no setting "cfgfar.gian".', 'use "cfgfar.gain"'],
    ])
    expect(m.config('cfgfar.gain', 1)).toBe(2)
  })

  test('a second module may not register a key that is taken (the build fails on the conflict); the first default stays', async () => {
    const { registryConflicts } = await import('../../../src/core/index.ts')
    const before = registryConflicts().length
    defineConfig('cfgowned', { a: 1 })
    const again = (): void => defineConfig('cfgowned', { a: 2 }) // another call site: another owner
    again()
    expect(registryConflicts().length).toBe(before + 1)
    expect(registryConflicts().at(-1)).toMatchObject({ registry: 'config', name: 'cfgowned.a' })
    expect(configDefault('cfgowned.a')).toBe(1)
    defineConfig('cfgowned', { a: 3 }, { override: true })
    expect(configDefault('cfgowned.a')).toBe(3)
  })

  test('the look and the guide read the store: a scene default reaches them like s.look() / s.guide()', async () => {
    const { lookOverrides } = await import('../../../src/r3d/index.ts')
    const { guideConfig, GUIDE_DEFAULTS } = await import('../../../src/guide/index.ts')
    await import('../../../src/r3d/look.ts') // the look table registers itself with the 3D side
    const m = withDefaults({ look: { line: { sigma: 3 }, cut: { soft: 0.5 } }, guide: { hop: 0.9, captions: false } }, (s) => { s.look({ line: { crease: 0.9 } }) })
    expect(codes(m)).toEqual([])
    expect(lookOverrides(m).overrides).toEqual({ line: { sigma: 3, crease: 0.9 }, cut: { soft: 0.5 } })
    expect(guideConfig(m).hop).toBe(0.9)
    expect(guideConfig(m).captions).toBe(false)
    expect(guideConfig(m).perch).toBe(GUIDE_DEFAULTS.perch)
    // s.guide() is said last and wins
    const g = withDefaults({ guide: { hop: 0.9 } }, (s) => { s.guide({ hop: 0.7 }) })
    expect(guideConfig(g).hop).toBe(0.7)
    // typos in either group are reported by the store, with the nearest name
    const bad = withDefaults({ guide: { hopp: 1 }, look: { line: { sigm: 2 } } })
    bad.settings.recheck()
    expect(diags(bad).map((d) => d.fix[0])).toEqual(['use "guide.hop"', 'use "look.line.sigma"'])
    expect(lookOverrides(bad).overrides).toBeNull()
  })
})
