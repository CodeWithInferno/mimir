// machine(): the block against the contract of docs/QUICK.md, under bun (no browser) through the real explain(),
// then the four examples through the real CLI: check is clean, and frames at three steps differ.
import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { compile, Frame, type SceneModel } from '../../../src/core/index.ts'
import { box, cylinder, extrude } from '../../../src/r3d/index.ts'
import { crankSlider, kit } from '../../../src/kit/index.ts'
import '../../../src/kit/check.ts'
import '../../../src/guide/index.ts'
import { checkStore } from '../../../src/check/index.ts'
import { explain, last } from './real.ts'
import { machine, MACHINE_DEFAULTS } from '../../../src/quick/machine.ts'

interface Built { model: SceneModel; handle: any; state: any; reports: string[]; at<T>(values: Record<string, number>, fn: () => T): T; clips: (step: number) => string[] }
function build(spec: unknown, story: Record<string, unknown>[] = [], controls: Record<string, { from: number; to: number; cyclic?: boolean }> = { turn: { from: 0, to: 360 } }): Built {
  // a story needs a step; a machine with nothing to say gets one that only looks at it
  const model = compile(explain({ title: 'test', controls, stage: { m: machine(spec) }, story: story.length ? story : [{ say: 'A [machine](m).' }] }) as any)
  return {
    model, handle: last.handles.m, state: last.states.m,
    // everything reported so far (the block's own reports carry its name in front; laws and probes report when they are first read)
    get reports() { return model.diagnostics.list.map((d) => d.what.replace(/^machine "m": /, '')) },
    at: (values, fn) => new Frame(model, 0, values).run(fn),
    clips: () => [],
  }
}
const near = (a: readonly number[], b: readonly number[], digits = 9): void => { for (let k = 0; k < 3; k++) expect(a[k]!).toBeCloseTo(b[k]!, digits) }
const errors = (m: SceneModel): string[] => m.diagnostics.list.map((d) => `${d.code}: ${d.what}`)

describe('placement from joints', () => {
  test('spins, on and at: parts go where the joints say, at every control value, with no coordinates for the riders', () => {
    const b = build({
      parts: { arm: box({ width: 2, height: 0.2, depth: 0.2 }).define('tip', [1, 0, 0]), pin: cylinder({ radius: 0.1, height: 0.4 }), wheel: cylinder({ radius: 0.5, height: 0.2 }) },
      joints: [['arm', 'spins', { by: 'turn' }], ['pin', 'on', 'arm.tip'], ['wheel', 'spins', { by: (c: any) => -c.turn / 2, at: [3, 0, 0] }]],
    })
    expect(b.reports).toEqual([])
    expect(errors(b.model)).toEqual([])
    for (const turn of [0, 30, 90, 215, 360]) {
      const a = (turn * Math.PI) / 180
      near(b.at({ turn }, () => b.handle.api.point('pin')), [Math.cos(a), Math.sin(a), 0])
      near(b.at({ turn }, () => b.handle.api.point('wheel')), [3, 0, 0])
      expect(b.at({ turn }, () => b.handle.api.probe('arm.angle')())).toBeCloseTo(turn > 180 ? turn - 360 : turn, 9)
    }
    expect(b.model.byId.get('m.pin')?.label).toBe('pin') // the names of the record are the ids and the labels
    expect(b.handle.target('pin')?.id).toBe('m.pin')
    expect(b.handle.target('')?.id).toBe('m')
    expect(b.handle.targets()).toEqual(['', 'arm', 'pin', 'wheel'])
  })
  test('follows, slides, between: a law, a slide on top of it, and a link that stays on both points', () => {
    const b = build({
      parts: { block: box({ width: 0.4, height: 0.4, depth: 0.4 }), crank: box({ width: 0.2, height: 0.2, depth: 0.2 }).define('pin', [1, 0, 0]), link: cylinder({ radius: 0.05, height: 2 }) },
      joints: [['crank', 'spins', { by: 'turn' }], ['block', 'follows', (c: any) => ({ at: [0, 3, 0], turn: c.turn })], ['block', 'slides', { along: 'x', by: (c: any) => c.turn / 360 }], ['link', 'between', 'crank.pin', 'block']],
    })
    expect(b.reports).toEqual([])
    for (const turn of [0, 77, 180, 290]) {
      const a = (turn * Math.PI) / 180
      near(b.at({ turn }, () => b.handle.api.point('block')), [turn / 360, 3, 0])
      near(b.at({ turn }, () => b.handle.api.point('link.bottom')), [Math.cos(a), Math.sin(a), 0])
      // the link's far end lies on the line from the pin to the block
      const [top, pin, blk] = b.at({ turn }, () => [b.handle.api.point('link.top'), b.handle.api.point('crank.pin'), b.handle.api.point('block')])
      const d = [blk[0] - pin[0], blk[1] - pin[1], blk[2] - pin[2]], n = Math.hypot(...d)
      near(top, [pin[0] + (2 * d[0]) / n, pin[1] + (2 * d[1]) / n, pin[2] + (2 * d[2]) / n])
    }
  })
  test("a mechanism of the engine named by part names is built on the machine's parts and controls", () => {
    const b = build({
      parts: { crank: kit.crankshaft({ throw: 0.86, overhung: true }), rod: kit.conRod({ length: 2.78 }), piston: kit.piston({ bore: 1.72 }), liner: kit.liner({ bore: 1.72 }) },
      joints: [crankSlider({ crank: 'crank', rod: 'rod', slider: 'piston', angle: 'turn' } as any), ['liner', 'around', 'piston']],
    })
    expect(b.reports).toEqual([])
    expect(errors(b.model)).toEqual([])
    const pinY = (turn: number): number => b.at({ turn }, () => b.handle.api.point('piston.pin')[1])
    expect(pinY(0)).toBeCloseTo(0.86 + 2.78, 9) // top dead centre: throw + rod
    expect(pinY(180)).toBeCloseTo(2.78 - 0.86, 9)
    expect(b.at({ turn: 90 }, () => b.handle.api.probe('crankSlider.fraction')())).toBeCloseTo(0.5 + 0.86 / (4 * 2.78) + 0.0037, 2) // past the middle after a quarter turn
    expect(b.at({ turn: 180 }, () => b.handle.api.probe('piston.travel')())).toBeCloseTo(1.72, 9)
    // the housing: placed round the whole travel of the piston, its height taken from that travel, seen through
    const liner = b.model.byId.get('m.liner')!, piston = b.model.byId.get('m.piston')!
    const inside = (turn: number): boolean => b.at({ turn }, () => { const f = b.model.now(), l = f.bounds(liner), p = f.bounds(piston); return l.min[1] <= p.min[1] + 1e-9 && l.max[1] >= p.max[1] - 1e-9 })
    expect([0, 45, 90, 180, 270].every(inside)).toBe(true)
    expect(liner.props.shell).toBe(true)
    expect(b.state.view).toBe('ghost')
  })
  test('a housing that does not stand between the camera and what it holds stays solid and where it is', () => {
    const ring = [[2, 2], [-2, 2], [-2, -2], [2, -2]], hole = [[1.5, 1.5], [-1.5, 1.5], [-1.5, -1.5], [1.5, -1.5]]
    const b = build({ parts: { case: extrude(ring, { depth: 0.4, holes: [hole] }), rotor: box({ width: 1, height: 1, depth: 0.4 }) }, joints: [['rotor', 'spins', { by: 'turn' }], ['case', 'around', 'rotor']] })
    expect(b.reports).toEqual([])
    expect(b.state.view).toBe('solid')
    near(b.at({ turn: 40 }, () => b.handle.api.point('case')), [0, 0, 0])
  })
})

describe('invariants and probes', () => {
  test('a declared invariant is measured at many control values and handed to check', () => {
    const b = build({
      parts: { arm: box({ width: 2, height: 0.2, depth: 0.2 }).define('tip', [1, 0, 0]), pin: cylinder({ radius: 0.1, height: 0.4 }) },
      joints: [['arm', 'spins', { by: 'turn' }], ['pin', 'on', 'arm.tip']],
      checks: { 'the pin stays one unit from the axle': (_c: any, m: any) => Math.abs(m.distance('pin', [0, 0, 0]) - 1), 'the pin never moves': (_c: any, m: any) => m.distance('pin', [1, 0, 0]) },
    })
    const [holds, fails] = b.handle.api.checks()
    expect(holds.ok).toBe(true)
    expect(holds.worst).toBeLessThan(1e-12)
    expect(holds.samples).toBe(MACHINE_DEFAULTS.sweepSamples + 1)
    expect(fails.ok).toBe(false)
    expect(fails.worst).toBeCloseTo(2, 2) // the far side of the circle
    expect(Math.abs(fails.at.turn - 180)).toBeLessThan(360 / MACHINE_DEFAULTS.sweepSamples) // found on the sweep's grid
    expect(b.reports).toEqual([]) // one owner per finding: check reports it (MECH-OPEN), not the block
    const declared = checkStore(b.model).invariants
    expect(declared.map((i) => i.name)).toEqual(['the pin stays one unit from the axle', 'the pin never moves'])
    expect(declared[1]!.residual(new Frame(b.model, 0))).toBeCloseTo(2, 2) // the measured worst, wherever the story is
    expect(declared[1]!.what).toContain('worst at turn = ')
    expect([...b.model.probes.keys()]).toEqual(expect.arrayContaining(['m.check.1', 'm.check.2'])) // the residuals show in `mimir shot`
    expect(b.handle.describe(b.state)).toContain('FAILS')
  })
  test('probes: quantities of parts, named probes, distances; an unknown one is one report with the nearest name', () => {
    const b = build({
      parts: { arm: box({ width: 2, height: 0.2, depth: 0.2 }).define('tip', [1, 0, 0]) },
      joints: [['arm', 'spins', { by: 'turn' }]],
      probes: { double: (c: any) => 2 * c.turn },
    })
    const p = b.handle.api.probe
    expect(b.at({ turn: 90 }, () => [p('arm.tip.y')(), p('arm.tip.x')(), p('double')(), p('arm.tip', 'arm')()].map((x) => Math.round(x * 1e9) / 1e9))).toEqual([1, 0, 180, 1])
    expect(b.at({ turn: 90 }, () => p('arm.tipp.y')())).toBe(0)
    expect(b.reports.join(' ')).toContain('"arm" has no point "tipp"')
    expect(b.at({ turn: 90 }, () => p('arm.heigth')())).toBe(0)
    expect(b.reports.join(' ')).toContain('there is no probe "arm.heigth"')
  })
})

describe('state', () => {
  const spec = () => ({ parts: { wheel: cylinder({ radius: 1, height: 0.3 }), case: box({ width: 3, height: 3, depth: 3 }) }, joints: [['wheel', 'spins', { by: 'turn' }], ['case', 'around', 'wheel']] })
  test('apply returns the next state, keeps unspecified keys, and records engine transitions', () => {
    const b = build(spec(), [
      { say: 'one', m: { view: 'cutaway', camera: 'front' } },
      { say: 'two', m: { highlight: ['wheel'], label: { wheel: 'the wheel' } } },
      { say: 'three', m: { view: 'ghost', spin: true } },
      { say: 'four', m: { view: 'solid', explode: 0, camera: 'wheel' } },
    ])
    expect(b.reports).toEqual([])
    expect(errors(b.model)).toEqual([])
    expect(b.handle.initial).toMatchObject({ view: 'ghost', explode: 0, camera: 'iso' })
    expect(b.state).toMatchObject({ view: 'solid', explode: 0, camera: 'wheel', highlight: ['wheel'], spin: true })
    expect(b.model.cameraClips().length).toBeGreaterThanOrEqual(3)
    expect(b.model.steps.length).toBe(4)
    expect(b.model.steps.every((s) => s.t1 > s.t0)).toBe(true)
  })
  test('bad state never throws: unknown key, view, camera and part are each one report with did-you-mean', () => {
    const b = build(spec(), [{ say: 'one', m: { veiw: 'ghost', view: 'cutawy', camera: 'frnt', highlight: ['wheal'], explode: 7 } }])
    const text = b.reports.join('\n')
    expect(text).toContain('"veiw"')
    expect(text).toContain('"cutawy" is not a view')
    expect(text).toContain('"frnt"')
    expect(text).toContain('"wheal" is not a part')
    expect(text).toContain('explode: 7')
    expect(b.state).toMatchObject({ view: 'ghost', camera: 'iso', explode: 0 })
  })
  test("'exploded' is not available yet: it is one report, and the machine stays as it is", () => {
    const b = build(spec(), [{ say: 'one', m: { view: 'exploded' } }, { say: 'two', m: { explode: 1 } }])
    expect(b.reports.length).toBe(1)
    expect(b.reports[0]).toContain("'exploded' view is not available")
    expect(b.state).toMatchObject({ view: 'ghost', explode: 0 })
    expect(errors(b.model).filter((e) => !e.includes('exploded'))).toEqual([])
  })
})

describe('what a writer does not declare', () => {
  const allowed = (b: Built, code: string, a: string, c: string): boolean => checkStore(b.model).allows.some((x) => x.code === code && ((x.node.id === `m.${a}` && (x.other === undefined || x.other?.id === `m.${c}`)) || (x.node.id === `m.${c}` && x.other?.id === `m.${a}`)))
  const ring = (r: number, n = 24): number[][] => Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)])
  test('a part in no joint is a fixed part: nothing is said, and what rests on it may touch it', () => {
    const b = build({ parts: { pivot: box({ width: 0.6, height: 0.6, depth: 0.6 }), bar: box({ width: 6, height: 0.2, depth: 0.5 }) }, joints: [['bar', 'spins', { by: 'turn', at: 'pivot.top' }]] })
    expect(b.reports).toEqual([])
    expect(allowed(b, 'INTERPENETRATE', 'pivot', 'bar')).toBe(true)
  })
  test('the parts of one machine fit in each other by design (a pin in its slot): every pair is a declared fit', () => {
    const b = build({ parts: { arm: box({ width: 2, height: 0.2, depth: 0.2 }).define('tip', [1, 0, 0]), pin: cylinder({ radius: 0.1, height: 0.4 }), far: box({ width: 0.3, height: 0.3, depth: 0.3 }) }, joints: [['arm', 'spins', { by: 'turn' }], ['pin', 'on', 'arm.tip'], ['far', 'spins', { by: 'turn', at: [5, 0, 0] }]] })
    expect(allowed(b, 'INTERPENETRATE', 'pin', 'arm')).toBe(true)
    expect(allowed(b, 'INTERPENETRATE', 'far', 'arm')).toBe(true)
    expect(allowed(b, 'OCCLUDED', 'far', 'pin')).toBe(true)
  })
  test('a solid block that holds a part as large as a rotor is its housing: seen through from the first frame, and never cut', () => {
    const b = build(
      { parts: { casing: extrude(ring(3), { depth: 1.2 }), rotor: extrude(ring(2.2, 3), { depth: 0.8 }) }, joints: [['rotor', 'spins', { by: 'turn' }]] },
      [{ say: 'A [rotor](m.rotor) in a [casing](m.casing).' }, { say: 'Cut it open.', m: { view: 'cutaway' } }],
    )
    expect(b.reports).toEqual([])
    expect(b.model.byId.get('m.casing')!.props.shell).toBe(true)
    expect(allowed(b, 'CONTAINED', 'casing', 'rotor')).toBe(true)
    // seen through from the start, and the cutaway of step two cuts nothing: a solid has no hollow to show, it stays seen through
    expect(b.state.view).toBe('cutaway')
    for (const step of b.model.steps) {
      const look = b.model.state(step.t1 - 0.01).look(b.model.byId.get('m.casing')!) as { ghost?: number; cut?: unknown }
      expect(look.ghost).toBe(1)
      expect(look.cut).toBeUndefined()
    }
  })
  test('a small part inside a large one is hidden by design, and the large one is not made a ghost for it', () => {
    const b = build({ parts: { wheel: cylinder({ radius: 2, height: 1 }), pin: cylinder({ radius: 0.2, height: 0.5 }) }, joints: [['wheel', 'spins', { by: 'turn' }], ['pin', 'on', 'wheel']] })
    expect(b.model.byId.get('m.wheel')!.props.shell).not.toBe(true)
    expect(allowed(b, 'CONTAINED', 'wheel', 'pin')).toBe(true)
  })
  test('a housing with a hollow is still cut open', () => {
    const b = build(
      { parts: { casing: extrude(ring(3), { depth: 1.2, holes: [ring(2.6)] }), rotor: extrude(ring(2.2, 3), { depth: 0.8 }) }, joints: [['rotor', 'spins', { by: 'turn' }], ['casing', 'around', 'rotor']] },
      [{ say: 'A [rotor](m.rotor).' }, { say: 'Cut it open.', m: { view: 'cutaway' } }],
    )
    expect(b.reports).toEqual([])
    const lookAt = (k: number) => b.model.state(b.model.steps[k]!.t1 - 0.01).look(b.model.byId.get('m.casing')!) as { ghost?: number; cut?: unknown }
    expect(lookAt(0).ghost).toBeUndefined() // a ring is open toward the camera: what it holds shows through the hole, so it stays solid
    expect(lookAt(1).cut).toBeDefined()
    expect(lookAt(1).ghost).toBeUndefined()
  })
})

describe('bad input', () => {
  test('nothing throws: wrong spec, wrong parts, unknown control, a law that throws, a circle; a part in no joint is a fixed part', () => {
    for (const bad of [undefined, null, 7, 'engine', [], { parts: 5 }, { parts: { a: 'not a part' }, joints: 'x' }]) expect(() => build(bad)).not.toThrow()
    const b = build({
      parts: { a: box(), b: box(), c: box(), lonely: box() },
      joints: [['a', 'on', 'b.top'], ['b', 'on', 'a.top'], ['c', 'spins', { by: 'trun' }], ['c', 'follows', () => { throw new Error('boom') }]],
      veiw: 'ghost',
    })
    b.at({}, () => b.handle.api.point('c')) // laws and controls are read when the machine is drawn
    const text = b.reports.join('\n')
    expect(text).toContain('no option "veiw"')
    expect(text).toContain('depend on each other in a circle')
    // a part in no joint is a fixed part (a base, a pivot): it is not a mistake and nothing is said about it
    expect(text).not.toContain('"lonely"')
    expect(text).toContain('no control is called "trun"')
    expect(text).toContain('threw: boom')
    near(b.at({}, () => b.handle.api.point('lonely')), [0, 0, 0])
  })
})

// ── the examples, through the real CLI and a headless browser ────────────────────────────────────────
const ROOT = resolve(import.meta.dir, '..', '..', '..')
const BIN = join(ROOT, 'bin', 'mimir')
const EXAMPLES = ['quick-slider-crank', 'quick-four-stroke', 'quick-geneva-drive', 'quick-wankel']
const HAVE = existsSync(BIN) && EXAMPLES.every((n) => existsSync(join(ROOT, 'examples', `${n}.scene.js`))) && existsSync(join(ROOT, 'src', 'quick', 'index.ts'))
async function mimir(args: string[]): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn([BIN, ...args], { cwd: ROOT, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited, new Response(proc.stderr).text()])
  return { code, stdout }
}
describe.skipIf(!HAVE)('examples', () => {
  for (const name of EXAMPLES) {
    test(`${name}: check is clean and three steps give three different frames`, async () => {
      const file = join(ROOT, 'examples', `${name}.scene.js`)
      const check = await mimir(['check', file, '--json', '--all'])
      const report = JSON.parse(check.stdout)
      expect({ errors: report.errors ?? report.summary?.errors, warnings: report.warnings ?? report.summary?.warnings, code: check.code }).toEqual({ errors: 0, warnings: 0, code: 0 })
      const out = mkdtempSync(join(tmpdir(), 'mimir-quick-'))
      try {
        const shots = JSON.parse((await mimir(['shot', file, '--steps', '--json', '--out', out])).stdout) as { sha256: string }[]
        expect(new Set(shots.slice(0, 3).map((s) => s.sha256)).size).toBe(3)
      } finally { rmSync(out, { recursive: true, force: true }) }
    }, 60_000)
  }
})
