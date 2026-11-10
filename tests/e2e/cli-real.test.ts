// End-to-end, third file: the real viewer (dist, built on demand) and the real launcher on a scene with chapters,
// narration cues, a parameter the story sweeps and 3D parts (examples/hydraulic-press.scene.js). This is where
// the story sheet, the cue frames, parameter addressing, the turntable, the legend of --debug ids, query, the
// article and the video are proven against real pixels and real geometry.
// After EVERY test: no browser started by the CLI may still be running.
import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launchChrome } from '../../src/cli/chrome.ts'
import { SHEET_HEADER, sha256Hex, sheetLayout, type ManifestEntry } from '../../src/cli/manifest.ts'
import { queryExpression } from '../../src/cli/pageside.ts'
import { pngSize } from '../../src/cli/png.ts'
import { waitReady } from '../../src/cli/session.ts'
import { ffmpegForTests, testEnv, videoEnv } from '../support/env.ts'

const ROOT = resolve(import.meta.dir, '..', '..')
const BIN = join(ROOT, 'bin', 'mimir')
const PRESS = join(ROOT, 'examples', 'hydraulic-press.scene.js')
const HAVE = existsSync(join(ROOT, 'scripts', 'build.ts')) && existsSync(join(ROOT, 'node_modules', 'three')) && existsSync(PRESS)

const WORK = mkdtempSync(join(realpathSync(tmpdir()), 'mimir-e2e-real-cli-'))
const TMP = join(WORK, 'tmp')
mkdirSync(TMP)
const ENV: Record<string, string> = { ...(process.env as Record<string, string>), TMPDIR: TMP, MIMIR_LAUNCH_DEPTH: '0' }
testEnv(ENV, ['MIMIR_VIEWER_ROOT', 'MIMIR_EXAMPLES', 'MIMIR_TOPICS'])

let dirCount = 0
const freshDir = (): string => {
  const d = join(WORK, `d${++dirCount}`)
  mkdirSync(d)
  return d
}
interface Result { code: number; stdout: string; stderr: string }
async function mimir(args: string[], opts: { env?: Record<string, string>; cwd?: string } = {}): Promise<Result> {
  const proc = Bun.spawn([BIN, ...args], { cwd: opts.cwd ?? ROOT, env: { ...ENV, ...opts.env }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { code, stdout, stderr }
}
function browsersRunning(): string[] {
  return Bun.spawnSync(['ps', '-axo', 'command=']).stdout.toString().split('\n').filter((l) => l.includes(WORK) && l.includes('--user-data-dir'))
}
async function expectNoBrowser(): Promise<void> {
  for (let i = 0; i < 40 && browsersRunning().length > 0; i++) await Bun.sleep(50)
  const processes = browsersRunning()
  const profiles = readdirSync(TMP).filter((n) => n.startsWith('mimir-chrome-'))
  for (const line of Bun.spawnSync(['ps', '-axo', 'pid=,command=']).stdout.toString().split('\n')) {
    if (line.includes(WORK) && line.includes('--user-data-dir')) { try { process.kill(Number(line.trim().split(/\s+/)[0]), 'SIGKILL') } catch { /* gone */ } }
  }
  for (const p of profiles) rmSync(join(TMP, p), { recursive: true, force: true })
  expect(processes).toEqual([])
  expect(profiles).toEqual([])
}
const manifest = (r: Result): ManifestEntry[] => JSON.parse(r.stdout) as ManifestEntry[]
const png = (path: string): Uint8Array => new Uint8Array(readFileSync(path))
const json = async (args: string[]): Promise<Record<string, any>> => {
  const r = await mimir(args, args.includes('--mp4') ? { env: videoEnv(FFMPEG) } : {})
  if (r.code !== 0) throw new Error(`mimir ${args.join(' ')} exited ${r.code}: ${r.stderr}`)
  return JSON.parse(r.stdout) as Record<string, any>
}

afterEach(expectNoBrowser)
afterAll(() => rmSync(WORK, { recursive: true, force: true }))
const T = 120_000
// the ffmpeg the CLI itself would find (MIMIR_FFMPEG, else PATH): the video test needs one and is skipped without
const FFMPEG = ffmpegForTests()

describe.skipIf(!HAVE)('the example scene of the CLI (hydraulic press)', () => {
  test('check is clean; the numbers it shows are computed from the two areas', async () => {
    const r = await mimir(['check', PRESS, '--all'])
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, errors: 0, warnings: 0 })
    expect(r.code).toBe(0)
    // pushed all the way (2 units) with the default bore: area ratio (1.8 / 0.6)^2 = 9, so the large piston rises 2 / 9 and gives 900 N
    const pushed = await json(['query', PRESS, 'probes', '--at', 'push=2'])
    expect(pushed.at).toEqual({ push: 2 })
    expect(pushed.params.push).toBeCloseTo(2, 2)
    expect(pushed.probes.areaRatio).toBeCloseTo(9, 6)
    expect(pushed.probes.rise).toBeCloseTo(2 / 9, 3)
    expect(pushed.probes.forceOut).toBeCloseTo(900, 4)
    // the other slider recomputes everything: bore 2.4 → ratio 16
    const wide = await json(['query', PRESS, 'probes', '--step', '2', '--set', 'bore=2.4'])
    expect(wide.probes.areaRatio).toBeCloseTo(16, 6)
    expect(wide.probes.rise).toBeCloseTo(2 / 16, 3)
    expect(wide.set).toEqual({ bore: 2.4 })
  }, T)
})

describe.skipIf(!HAVE)('mimir shot on the real viewer', () => {
  test('--sheet: a story sheet with a row per chapter; frames carry their chapter; the sheet has the promised size', async () => {
    const out = freshDir()
    const r = await mimir(['shot', '--json', PRESS, '--sheet', '--out', out])
    expect(r.code).toBe(0)
    const m = manifest(r)
    const frames = m.filter((e) => !e.sheet)
    expect(frames.map((e) => [e.step, e.title, e.chapter])).toEqual([[1, 'The parts', 1], [2, 'Push down', 1], [3, 'Same pressure everywhere', 2], [4, 'A wider piston', 2]])
    expect(Object.keys(frames[0]!)).toEqual(['path', 'step', 'title', 't', 'camera', 'width', 'height', 'sha256', 'chapter'])
    expect(new Set(frames.map((e) => e.sha256)).size).toBe(4)
    const sheets = m.filter((e) => e.sheet)
    expect(sheets.length).toBe(1)
    const sheet = sheets[0]!
    // two chapters of two steps: two columns, two rows, a heading above each row
    const cell = sheetLayout(2, 1280, 720, 1280, 400, 2)
    expect(sheet.sheet).toMatchObject({ cols: 2, rows: 2, frames: 4 })
    expect(sheet.height).toBe(2 * cell.pad + 2 * (SHEET_HEADER + cell.cellHeight + cell.captionHeight) + cell.gap)
    expect(sheet.width).toBe(cell.width)
    expect(pngSize(png(sheet.path))).toEqual({ width: sheet.width, height: sheet.height })
    expect(sheet.sheet!.tokens).toBeLessThan(2000) // what looking at it costs
    expect(sheet.title).toBe('story sheet')
    // probes beside every frame, with the chapter
    expect(JSON.parse(readFileSync(join(out, 'step-03.probes.json'), 'utf8'))).toMatchObject({ step: 3, chapter: 2, params: { bore: 1.8 }, probes: { areaRatio: expect.any(Number) } })
    // the same command again: every file has the same bytes, the sheet included
    const again = manifest(await mimir(['shot', '--json', PRESS, '--sheet', '--out', freshDir()]))
    expect(again.map((e) => e.sha256)).toEqual(m.map((e) => e.sha256))
  }, T)

  test('--cues: one frame per span of the narration, at the time its mark has landed, in story order', async () => {
    const out = freshDir()
    const r = await mimir(['shot', '--json', PRESS, '--cues', '--out', out])
    expect(r.code).toBe(0)
    const m = manifest(r)
    const frames = m.filter((e) => !e.sheet)
    expect(frames.map((e) => [e.cue!.index, e.step, e.cue!.verb, e.cue!.targets.join('+'), e.cue!.words])).toEqual([
      [1, 1, 'point', 'small', 'small piston'], [2, 1, 'point', 'large', 'large piston'], [3, 1, 'ring', 'oil', 'oil'],
      [4, 2, 'point', 'small', 'small piston'], [5, 2, 'ring', 'large', 'large one'],
      [6, 3, 'ring', 'large', 'nine times the area'], [7, 4, 'point', 'large', 'large piston'],
    ])
    expect(frames.map((e) => e.path.slice(out.length + 1))).toEqual([1, 2, 3, 4, 5, 6, 7].map((n) => `cue-0${n}.png`))
    // each frame is taken inside its own step, at or after the cue lands, and time only moves forward
    const info = (await json(['query', PRESS, 'state'])).duration as number
    let last = -1
    for (const e of frames) {
      expect(e.t!).toBeGreaterThanOrEqual(e.cue!.land)
      expect(e.t!).toBeGreaterThan(last)
      expect(e.t!).toBeLessThan(info)
      last = e.t!
    }
    expect(JSON.parse(readFileSync(join(out, 'cue-05.probes.json'), 'utf8')).cue).toEqual(frames[4]!.cue)
    const sheet = m[m.length - 1]!
    expect(sheet).toMatchObject({ title: 'cue sheet', sheet: { frames: 7 } })
    expect(r.stderr).toContain('cue times are scheduled by the CLI from the narration text')
  }, T)

  test('--at name=value finds the moment the story has the parameter there; the frame is the frame of that time', async () => {
    const out = freshDir()
    const m = manifest(await mimir(['shot', '--json', PRESS, '--at', 'push=1,push=2', '--out', out]))
    expect(m.map((e) => [e.path.slice(out.length + 1), e.step, e.param])).toEqual([['at-push-1.png', 2, { name: 'push', value: 1 }], ['at-push-2.png', 2, { name: 'push', value: 2 }]])
    expect(m[0]!.t!).toBeLessThan(m[1]!.t!)
    const probes = JSON.parse(readFileSync(join(out, 'at-push-1.probes.json'), 'utf8'))
    expect(probes.params.push).toBeCloseTo(1, 2)
    expect(probes.probes.rise).toBeCloseTo(1 / 9, 2)
    // shooting that time directly gives the same picture
    const direct = manifest(await mimir(['shot', '--json', PRESS, '--at', String(m[0]!.t), '--out', freshDir()]))
    expect(direct[0]!.sha256).toBe(m[0]!.sha256)
    // a value the story never reaches, and one outside the slider
    const never = await mimir(['shot', '--json', PRESS, '--at', 'bore=1.5', '--out', freshDir()])
    expect(never.code).toBe(2)
    expect(never.stderr).toContain('--at bore=1.5: the story never brings "bore" to 1.5 (the story takes it from 1.8 to 2.4')
    expect(never.stderr).toContain('--set bore=1.5')
    const outside = await mimir(['shot', '--json', PRESS, '--at', 'push=9', '--out', freshDir()])
    expect(outside.code).toBe(2)
    expect(outside.stderr).toContain('--at push=9: "push" goes from 0 to 2')
  }, T)

  test('--fine: the in-between frames of a motion all differ, and any of them shot alone is the same picture', async () => {
    const m = manifest(await mimir(['shot', '--json', PRESS, '--fine', '6:10:9', '--out', freshDir()]))
    const frames = m.filter((e) => !e.sheet)
    expect(frames.map((e) => e.t)).toEqual([6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10])
    expect(new Set(frames.map((e) => e.sha256)).size).toBe(9) // the piston moves in every one
    expect(m[m.length - 1]).toMatchObject({ title: 'filmstrip', sheet: { cols: 4, rows: 3, frames: 9 } })
    // time is an input: frames 3 and 7 shot alone, in the other order, are the same bytes
    const alone = manifest(await mimir(['shot', '--json', PRESS, '--at', '9,7', '--out', freshDir()]))
    expect(alone.map((e) => e.sha256)).toEqual([frames[6]!.sha256, frames[2]!.sha256])
  }, T)

  test('--turntable: the camera goes round the model, the story camera keeps its height; a 2D scene has no camera to turn', async () => {
    const out = freshDir()
    const m = manifest(await mimir(['shot', '--json', PRESS, '--step', '1', '--turntable=4', '--sheet', '--out', out]))
    const frames = m.filter((e) => !e.sheet)
    expect(frames.map((e) => e.camera)).toEqual(['az000', 'az090', 'az180', 'az270'])
    expect(new Set(frames.map((e) => e.sha256)).size).toBe(4)
    expect(m[m.length - 1]!.sheet).toMatchObject({ cols: 4, rows: 1, frames: 4 })
    // az000 is the front: the same picture as the named view at the same elevation would need the story's height, so compare with itself
    const again = manifest(await mimir(['shot', '--json', PRESS, '--step', '1', '--turntable=4', '--out', freshDir()]))
    expect(again.map((e) => e.sha256)).toEqual(frames.map((e) => e.sha256))
    const flat = await mimir(['shot', '--json', join(ROOT, 'examples', 'hello-2d.scene.js'), '--turntable', '--out', freshDir()])
    expect(flat.code).toBe(2)
    expect(flat.stderr).toContain('--turntable: this scene has no 3D panel')
  }, T)

  test('--debug ids: every part on screen outlined in its own colour, numbered, and listed in a legend under the frame', async () => {
    const out = freshDir()
    const r = await mimir(['shot', '--json', PRESS, '--step', '3', '--debug', 'ids', '--out', out])
    expect(r.code).toBe(0)
    const m = manifest(r)
    // the frame keeps its width; the legend adds rows below it
    expect(m[0]!.width).toBe(1280)
    expect(m[0]!.height).toBeGreaterThan(720)
    expect(pngSize(png(m[0]!.path))).toEqual({ width: m[0]!.width, height: m[0]!.height })
    const probes = JSON.parse(readFileSync(join(out, 'step-03.debug-ids.probes.json'), 'utf8'))
    const legend = probes.legend as Array<{ n: number; id: string; color: string; space: string; rect: { x: number; y: number; width: number; height: number }; at: { x: number; y: number } | null }>
    const ids = legend.map((l) => l.id)
    for (const id of ['base', 'pipe', 'oil', 'small', 'large', 'load', 'heading', 'forceLine']) expect(ids).toContain(id)
    expect(new Set(legend.map((l) => l.color)).size).toBe(legend.length) // a colour per part
    expect(new Set(legend.map((l) => l.n)).size).toBe(legend.length)
    for (const l of legend) {
      expect(l.rect.width).toBeGreaterThan(0)
      expect(l.rect.x).toBeGreaterThanOrEqual(-1)
      expect(l.rect.x + l.rect.width).toBeLessThanOrEqual(1281)
    }
    // 3D parts sit in the left panel, the numbers on the right; a 3D part that shows has a visible point inside its box
    const load = legend.find((l) => l.id === 'load')!
    const force = legend.find((l) => l.id === 'forceLine')!
    expect(load.space).toBe('3d')
    expect(force.space).toBe('2d')
    expect(load.rect.x + load.rect.width).toBeLessThan(force.rect.x)
    expect(load.at!.x).toBeGreaterThanOrEqual(load.rect.x)
    expect(load.at!.x).toBeLessThanOrEqual(load.rect.x + load.rect.width)
    // every step in one run (the legend page and the scene page render in turn), with the sheet of the annotated frames
    const other = freshDir()
    const all = manifest(await mimir(['shot', '--json', PRESS, '--debug', 'ids', '--sheet', '--out', other]))
    expect(all.map((e) => e.path.slice(other.length + 1))).toEqual(['step-01.debug-ids.png', 'step-02.debug-ids.png', 'step-03.debug-ids.png', 'step-04.debug-ids.png', 'sheet.debug-ids.png'])
    expect(all[2]!.sha256).toBe(m[0]!.sha256) // step 3 in the run of four is the picture of step 3 shot alone
    // the same part has the same number and colour in another frame
    const first = JSON.parse(readFileSync(join(other, 'step-01.debug-ids.probes.json'), 'utf8')).legend as typeof legend
    const pick = (list: typeof legend, id: string) => { const l = list.find((x) => x.id === id)!; return [l.n, l.color] }
    for (const id of ['base', 'load', 'small']) expect(pick(first, id)).toEqual(pick(legend, id))
    expect(first.map((l) => l.id)).not.toContain('forceLine') // not on stage in chapter 1
    // the plain frame is untouched by the debug run that came before it in other tests: plain step 3 differs from the debug one
    const plain = manifest(await mimir(['shot', '--json', PRESS, '--step', '3', '--out', freshDir()]))
    expect(plain[0]).toMatchObject({ width: 1280, height: 720 })
    expect(plain[0]!.sha256).not.toBe(m[0]!.sha256)
  }, T)
})

// The page side of `mimir query` is the viewer's own __mimir.query() (src/check/query.ts): solids measured surface to
// surface, pixels from the id pass. The CLI seeks, pins the params, wraps the answer and turns a refusal into a usage error.
describe.skipIf(!HAVE)('mimir query on the real viewer: measured, with its basis', () => {
  test('bounds: the box in world units and the rectangle on screen', async () => {
    const b = await json(['query', PRESS, 'bounds', 'load', '--step', '1'])
    expect(b).toMatchObject({ query: 'bounds', ids: ['load'], step: 1, source: 'viewer' })
    const box = b.bounds[0]
    expect(box).toMatchObject({ id: 'load', kind: 'box', space: '3d', onStage: true })
    // the load is 2.2 x 1.3 x 2.2 and rides on the large piston, which rides on the oil (2.2 high from the floor at y = -2)
    expect(box.size).toEqual([2.2, 1.3, 2.2])
    expect(box.min[1]).toBeCloseTo(-2 + 2.2 + 0.3, 3)
    expect(box.center[0]).toBeCloseTo(2.1, 3)
    expect(box.screen.width).toBeGreaterThan(20)
    // pushed: the load is higher by the rise
    const up = await json(['query', PRESS, 'bounds', 'load', '--at', 'push=2'])
    expect(up.bounds[0].min[1] - box.min[1]).toBeCloseTo(2 / 9, 2)
  }, T)

  test('distance: between surfaces, between named points; 2D and 3D share no space', async () => {
    const d = await json(['query', PRESS, 'distance', 'small', 'large', '--step', '1'])
    // the two cylinders stand 4.2 apart and their pistons are level before the push
    expect(d).toMatchObject({ a: 'small', b: 'large', relation: 'apart', along: '+X', measured: 'solids' })
    expect(d.centres).toBeCloseTo(4.2, 3)
    expect(d.pointB[1] - d.pointA[1]).toBeCloseTo(0, 3)
    expect(d.gap).toBeCloseTo(4.2 - 0.6 * 0.94 - 1.8 * 0.97, 3) // surface to surface: the two radii off
    expect(d.depth).toBe(0)
    // the hand rests on the small piston: its bottom is the piston's top
    const touch = await json(['query', PRESS, 'distance', 'hand.bottom', 'small.top', '--step', '2'])
    expect(touch.distance).toBeCloseTo(0, 4)
    expect(touch.measured).toBe('point to point')
    // after the push the small piston is 2 lower and the large one 2 / 9 higher
    const pushed = await json(['query', PRESS, 'distance', 'small', 'large', '--at', 'push=2'])
    expect(pushed.centres).toBeCloseTo(Math.hypot(4.2, 2 + 2 / 9), 2)
    const mixed = await json(['query', PRESS, 'distance', 'load', 'forceLine', '--step', '3'])
    expect(mixed).toMatchObject({ space: 'mixed', distance: null })
    expect(mixed.reason).toContain('share no space')
  }, T)

  test('contacts: which solids touch or overlap, measured on their surfaces', async () => {
    const c = await json(['query', PRESS, 'contacts', 'load', '--step', '1'])
    // the load sits on the large piston (touching); the glass wall round it is a quarter of a unit away, not in it
    expect(c.contacts).toHaveLength(1)
    expect(c.contacts[0]).toMatchObject({ id: 'load', touching: ['large'], overlapping: [], floating: false })
    expect(c.contacts[0].nearest.id).toBe('wallLarge')
    expect(c.contacts[0].nearest.gap).toBeGreaterThan(0.2)
    const all = await json(['query', PRESS, 'contacts', '--step', '1'])
    expect(all.contacts.map((x: { id: string }) => x.id)).toEqual(['base', 'pipe', 'oilSmall', 'oil', 'small', 'large', 'hand', 'load', 'wallSmall', 'wallLarge'])
    // a wider tolerance calls more things touching
    const wide = await json(['query', PRESS, 'contacts', 'load', '--step', '1', '--tolerance', '1'])
    expect(wide.contacts[0].touching.length).toBeGreaterThan(c.contacts[0].touching.length)
  }, T)

  test('visible: pixels from the id pass for 3D parts, the layout box for 2D ones, and "not on stage" when it is not', async () => {
    const load = (await json(['query', PRESS, 'visible', 'load', '--step', '1'])).visible[0]
    expect(load).toMatchObject({ id: 'load', visible: true, onStage: true, inPanel: true, hiddenBy: [] })
    expect(load.pixels).toBeGreaterThan(1000)
    expect(load.total).toBeGreaterThanOrEqual(load.pixels)
    expect(load.ratio).toBeGreaterThan(0.5)
    // the oil of the small column is behind its piston, hand and wall: less of it shows than of the load
    const oil = (await json(['query', PRESS, 'visible', 'oilSmall', '--step', '1'])).visible[0]
    expect(oil.ratio).toBeLessThan(1)
    expect(oil.hiddenBy).toContain('small')
    // a 2D line of text: on stage only in chapter 2
    const before = (await json(['query', PRESS, 'visible', 'forceLine', '--step', '2'])).visible[0]
    expect(before).toMatchObject({ visible: false, onStage: false })
    const after = (await json(['query', PRESS, 'visible', 'forceLine', '--step', '3'])).visible[0]
    expect(after).toMatchObject({ visible: true, onStage: true, inFrame: true, opacity: 1, pixels: 'unknown' })
    expect(after.reason).toContain('not counted by the id pass') // said, never passed off as measured
  }, T)

  test('state: where the story is, with the camera; an unknown part or point is a usage error with the nearest names', async () => {
    const s = await json(['query', PRESS, 'state', '--step', '2'])
    expect(s).toMatchObject({ step: 2, step_title: 'Push down', chapter: 1, params: { bore: 1.8 }, caption: expect.stringContaining('Oil cannot be squeezed') })
    expect(s.params.push).toBeCloseTo(2, 2)
    // step 2 looks from the front: azimuth 0, elevation 0
    expect(s.camera.azimuth).toBeCloseTo(0, 3)
    expect(s.camera.elevation).toBeCloseTo(0, 3)
    const part = await mimir(['query', PRESS, 'bounds', 'lod'])
    expect(part.code).toBe(2)
    expect(part.stderr).toContain('query bounds: no object has the id "lod". use "load"')
    expect(part.stdout).toBe('')
    const point = await mimir(['query', PRESS, 'distance', 'load.topp', 'small'])
    expect(point.code).toBe(2)
    expect(point.stderr).toContain('#load has no point "topp". use "load.top"')
    const needs = await mimir(['query', PRESS, 'bounds', 'load.top'])
    expect(needs.code).toBe(2)
    expect(needs.stderr).toContain('takes an object, not a point of one')
  }, T)
})

describe.skipIf(!HAVE)('mimir export on the real viewer', () => {
  test('--md --frames: chapters, steps, narration without its guide spans, notes as written, a frame per step', async () => {
    const dir = freshDir()
    const out = await json(['export', PRESS, '--md', join(dir, 'press.md'), '--frames'])
    expect(out.md).toMatchObject({ steps: 4, chapters: 2 })
    expect(out.md.words).toBeGreaterThan(50)
    const text = readFileSync(join(dir, 'press.md'), 'utf8')
    expect(text).toStartWith('# How a hydraulic press multiplies force\n\n## One fluid, two pistons\n\n### 1. The parts\n\n![The parts](press-frames/step-01.png)\n\nA small piston and a large piston sit on the same oil.\n')
    expect(text).toContain('## Trading distance for force\n\n### 3. Same pressure everywhere\n')
    expect(text).toContain('The volume that leaves the narrow column is the volume the wide one gains: `A1 × d1 = A2 × d2`.') // st.note, as written
    expect(text).not.toMatch(/\]\((?!press-frames\/)/) // no guide span survived
    expect(readdirSync(join(dir, 'press-frames')).sort()).toEqual(['step-01.png', 'step-02.png', 'step-03.png', 'step-04.png'])
    // the images are the step frames of `shot`
    const shots = manifest(await mimir(['shot', '--json', PRESS, '--out', freshDir()]))
    expect((out.md.frames as Array<{ sha256: string }>).map((f) => f.sha256)).toEqual(shots.map((e) => e.sha256))
  }, T)

  test('-o: the example exports to one verified offline file with only the chunks it uses', async () => {
    const dir = freshDir()
    const out = await json(['export', PRESS, '-o', join(dir, 'press.html')])
    expect(out).toMatchObject({ path: join(dir, 'press.html'), verified: true, warnings: [] })
    expect(out.modules).toContain('/mimir.3d.js')
    expect(out.modules.some((p: string) => /mimir\.check/.test(p))).toBe(false)
    const html = readFileSync(join(dir, 'press.html'), 'utf8')
    expect(html).toContain(`http-equiv="Content-Security-Policy" content="default-src 'none'`)
    expect(html).not.toMatch(/<script[^>]+\bsrc=/)
    expect(html).not.toMatch(/<link[^>]+href=/)
  }, T)

  test.skipIf(!FFMPEG)('--mp4: the frames of the video are the frames of the story, whatever the number of pages', async () => {
    const dir = freshDir()
    const args = ['--fps', '6', '--size', '640x360', '--from', '5', '--to', '10']
    const one = (await json(['export', PRESS, '--mp4', join(dir, 'a.mp4'), ...args, '--jobs', '1'])).mp4
    const four = (await json(['export', PRESS, '--mp4', join(dir, 'b.mp4'), ...args, '--jobs', '4'])).mp4
    expect(one).toMatchObject({ frames: 30, fps: 6, width: 640, height: 360, from: 5, to: 10 })
    expect(four.frames_sha256).toBe(one.frames_sha256)
    if (one.probe) expect(one.probe).toMatchObject({ frames: 30, width: 640, height: 360, codec: 'h264' })
    expect(one.bytes).toBeGreaterThan(5000)
    // pinning a parameter changes the frames
    const pinned = (await json(['export', PRESS, '--mp4', join(dir, 'c.mp4'), ...args, '--set', 'bore=2.4'])).mp4
    expect(pinned.frames_sha256).not.toBe(one.frames_sha256)
  }, T)
})

describe.skipIf(!HAVE)('mimir init and mimir open on the real viewer', () => {
  test('the starter scene passes check and gives a different picture for each of its steps', async () => {
    const dir = freshDir()
    expect((await mimir(['init', 'starter'], { cwd: dir })).code).toBe(0)
    const check = await mimir(['check', 'starter.scene.js', '--all'], { cwd: dir })
    expect(JSON.parse(check.stdout)).toEqual({ ok: true, errors: 0, warnings: 0, total: 0, shown: 0, diagnostics: [] })
    const m = manifest(await mimir(['shot', '--json', 'starter.scene.js', '--out', 'shots'], { cwd: dir }))
    expect(m.map((e) => e.title)).toEqual(['Two parts', 'One feeds the other'])
    expect(m[0]!.sha256).not.toBe(m[1]!.sha256)
    // its narration has guide spans, so the cue frames exist too
    const cues = manifest(await mimir(['shot', '--json', 'starter.scene.js', '--cues', '--out', 'cues'], { cwd: dir }))
    expect(cues.filter((e) => e.cue).map((e) => e.cue!.targets[0])).toEqual(['source', 'target', 'target'])
  }, T)

  test('live reload keeps the story time, the camera and a slider the author moved', async () => {
    const dir = freshDir()
    const file = join(dir, 'press.scene.js')
    writeFileSync(file, readFileSync(PRESS, 'utf8'))
    const proc = Bun.spawn([BIN, 'open', file, '--no-open', '--port', '0'], { cwd: dir, env: ENV, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    const browser = await launchChrome({ env: ENV })
    try {
      const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader()
      const { url } = JSON.parse(new TextDecoder().decode((await reader.read()).value)) as { url: string }
      reader.releaseLock()
      const page = await browser.newPage(1280, 720, 1)
      await page.navigate(url + '&play=0') // the viewer plays by itself; this author has paused it to work on one moment
      expect((await waitReady(page, 20_000, url)).title).toBe('How a hydraulic press multiplies force')
      const camera = async (): Promise<{ t: number; camera: { azimuth: number; elevation: number }; params: Record<string, number>; overridden: string[] }> =>
        (JSON.parse(await page.evaluate<string>(queryExpression({ what: 'state', ids: [], tolerance: 0 }))) as { result: any }).result
      // the author scrubs to 7 s, turns the camera and moves a slider
      await page.evaluate(`(async () => { const m = window.__mimir; window.__beforeReload = true; m.seek(7); m.setView({ azimuth: 123, elevation: 41 }); m.setParam('bore', 2.2); await m.frame(); })()`)
      const before = await camera()
      expect(before.camera.azimuth).toBeCloseTo(123, 3)
      await Bun.sleep(400) // the page's EventSource is connected and the watcher is armed
      writeFileSync(file, readFileSync(file, 'utf8').replace('How a hydraulic press multiplies force', 'Edited press'))
      let fresh = false
      for (let i = 0; i < 200 && !fresh; i++) {
        await Bun.sleep(50)
        try {
          fresh = await page.evaluate<boolean>(`(async () => { if (window.__beforeReload || !window.__mimir) return false; await window.__mimir.ready; return window.__mimir.info().title === 'Edited press'; })()`)
        } catch {
          // the page is navigating
        }
      }
      expect(fresh).toBe(true)
      // the restore runs right after ready
      let after = await camera()
      for (let i = 0; i < 40 && Math.abs(after.camera.azimuth - 123) > 1e-3; i++) { await Bun.sleep(50); after = await camera() }
      expect(after.t).toBeCloseTo(7, 2)
      expect(after.camera.azimuth).toBeCloseTo(123, 3)
      expect(after.camera.elevation).toBeCloseTo(41, 3)
      expect(after.params.bore).toBeCloseTo(2.2, 6)
      expect(after.overridden).toEqual(['bore'])
    } finally {
      await browser.close()
      proc.kill('SIGINT')
      await proc.exited
    }
  }, T)
})
