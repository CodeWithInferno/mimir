// The kit's two example scenes through the real CLI and the real viewer (headless browser): `check` is clean,
// the probes carry the numbers of the mechanisms, the kit chunk is loaded only because the scene uses kit parts, and
// the same time gives the same pixels in any order. Skipped, visibly, when the CLI or the examples are not in the tree.
import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..', '..', '..')
const BIN = join(ROOT, 'bin', 'mimir')
const example = (name: string): string => join(ROOT, 'examples', `${name}.scene.js`)
const HAVE = existsSync(BIN) && existsSync(join(ROOT, 'scripts', 'build.ts')) && ['slider-crank', 'gear-train'].every((n) => existsSync(example(n)))
const WORK = mkdtempSync(join(tmpdir(), 'mimir-kit-'))
const TMP = join(WORK, 'tmp')
mkdirSync(TMP)
const ENV: Record<string, string> = { ...(process.env as Record<string, string>), TMPDIR: TMP, MIMIR_LAUNCH_DEPTH: '0' }
for (const k of ['MIMIR_VIEWER_ROOT', 'MIMIR_TIMEOUT', 'MIMIR_TYPES', 'MIMIR_CHROME_ARGS']) delete ENV[k]
let dirs = 0
const freshDir = (): string => { const d = join(WORK, `d${++dirs}`); mkdirSync(d); return d }
async function mimir(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([BIN, ...args], { cwd: ROOT, env: ENV, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { code, stdout, stderr }
}
interface Shot { path: string; step: number | null; t: number | null; sha256: string }
const probesOf = (shot: Shot): Record<string, number> => JSON.parse(readFileSync(shot.path.replace(/\.png$/, '.probes.json'), 'utf8')).probes
afterAll(() => rmSync(WORK, { recursive: true, force: true }))

describe.skipIf(!HAVE)('kit examples through the real viewer', () => {
  test('slider-crank: check is clean (MECH-OPEN measured at every sample), 57.9 % of the stroke after a quarter turn', async () => {
    const check = await mimir(['check', example('slider-crank'), '--json'])
    expect(JSON.parse(check.stdout)).toMatchObject({ ok: true, errors: 0, warnings: 0 })
    expect(check.code).toBe(0)
    const shots = JSON.parse((await mimir(['shot', '--json', example('slider-crank'), '--steps', '--out', freshDir()])).stdout) as Shot[]
    const steps = shots.filter((s) => s.step !== null)
    expect(steps.length).toBe(4)
    const quarter = probesOf(steps[1]!), bottom = probesOf(steps[2]!), top = probesOf(steps[3]!)
    expect(quarter.travelPercent).toBeCloseTo(57.93, 2) // the project research notes: bore = stroke = 86, rod 139
    expect(quarter['slide.fraction']).toBeCloseTo(0.5793, 4)
    expect(bottom.travelPercent).toBeCloseTo(100, 9)
    expect(top.travelPercent).toBeCloseTo(0, 9)
    // 1 unit = 50 mm: the stroke is 86 mm, the pin is 182 mm above the crank axis at the top and 96 mm at the bottom
    expect(bottom['slide.travel']! / 0.02).toBeCloseTo(86, 9)
    expect(top.pistonHeight! / 0.02).toBeCloseTo(182, 9)
    expect(bottom.pistonHeight! / 0.02).toBeCloseTo(96, 9)
  }, 60_000)

  test('gear-train: check is clean, the ratio is 3 and the gears have turned 3, −1.5 and 1 times', async () => {
    const check = await mimir(['check', example('gear-train'), '--json'])
    expect(JSON.parse(check.stdout)).toMatchObject({ ok: true, errors: 0, warnings: 0 })
    const shots = JSON.parse((await mimir(['shot', '--json', example('gear-train'), '--steps', '--out', freshDir()])).stdout) as Shot[]
    const last = probesOf(shots.filter((s) => s.step !== null)[2]!)
    expect(last.ratio).toBe(3)
    expect(last['train.1.ratio']).toBe(2)
    expect(last['train.2.ratio']).toBe(1.5)
    expect(last.idlerTurned).toBeCloseTo(-540, 9)
    expect(last.outputTurned).toBeCloseTo(360, 9)
    // 8 phases of one tooth of the driver, as a slider position: still clean (the mesh invariant holds at each)
    for (let i = 1; i < 8; i++) {
      const out = JSON.parse((await mimir(['shot', '--json', example('gear-train'), '--step', '1', '--set', `turn=${(i * 30) / 8}`, '--out', freshDir()])).stdout) as Shot[]
      expect(probesOf(out[0]!).outputTurned).toBeCloseTo((i * 30) / 8 / 3, 9)
    }
  }, 120_000)

  test('a mechanism that does not close is an error of check, with the scene line', async () => {
    const dir = freshDir(), file = join(dir, 'open.scene.js')
    await Bun.write(file, [
      "import { scene, kit, crankSlider } from 'mimir'",
      "export default scene({ title: 'open' }, (s) => {",
      "  const a = s.param('a', { value: 0, min: 0, max: 360, unit: '°' })",
      "  crankSlider({ crank: kit.crankshaft({ id: 'crank', throw: 2 }), rod: kit.conRod({ id: 'rod', length: 1.5 }), slider: kit.piston({ id: 'piston' }), angle: a })",
      "  s.step('turn', (st) => { st.set(a, 90) })",
      '})', '',
    ].join('\n'))
    const r = await mimir(['check', file, '--json'])
    const out = JSON.parse(r.stdout)
    expect(r.code).toBe(1)
    const open = out.diagnostics.filter((d: { code: string }) => d.code === 'MECH-OPEN')
    expect(open.length).toBeGreaterThanOrEqual(1)
    expect(open[0]).toMatchObject({ severity: 'error', line: 4, ids: ['crank', 'rod', 'piston'] })
    expect(open[0].what).toContain('too short to reach round the crank')
  }, 60_000)

  test('the kit chunk is loaded for a scene with kit parts, and exported with it', async () => {
    const out = join(freshDir(), 'gears.html')
    const exp = JSON.parse((await mimir(['export', example('gear-train'), '-o', out])).stdout)
    expect(exp.verified).toBe(true)
    expect(exp.modules).toEqual(expect.arrayContaining(['/mimir.3d.js', '/mimir.kit.js']))
    const plain = JSON.parse((await mimir(['export', join(ROOT, 'examples', 'hello-3d.scene.js'), '-o', join(freshDir(), 'plain.html')])).stdout)
    expect(plain.modules).not.toContain('/mimir.kit.js') // a 3D scene without kit parts does not pay for the kit
  }, 60_000)

  test('determinism: times inside one step and across steps, in two orders, also at 2×', async () => {
    const times = ['9.7', '12.4', '13.1', '19.5', '26.2']
    for (const scale of ['1', '2']) {
      const run = async (order: string[]): Promise<Map<number, string>> => {
        const shots = JSON.parse((await mimir(['shot', '--json', example('slider-crank'), '--at', order.join(','), '--scale', scale, '--out', freshDir()])).stdout) as Shot[]
        return new Map(shots.filter((s) => s.t !== null).map((s) => [s.t!, s.sha256]))
      }
      const a = await run(times), b = await run([...times].reverse())
      expect(a.size).toBe(times.length)
      for (const [t, sha] of a) expect(b.get(t), `t = ${t} at ${scale}×`).toBe(sha)
      expect(new Set(a.values()).size).toBe(times.length) // and the frames really differ
    }
  }, 120_000)
})
