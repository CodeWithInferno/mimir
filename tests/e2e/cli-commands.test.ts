// End-to-end, second file: the commands and flags added after M0 (shot --fine / --at name=value / --turntable /
// --cols, export --md / --mp4, query, docs guides and examples, examples, init), driven through the real
// launcher against the stub viewer (tests/fixtures/stub-viewer, the same page contract as the real one). What needs
// the real engine (chapters, cues, geometry) is in cli-real.test.ts. Fixtures that only these tests need are written
// by the tests themselves. After EVERY test: no browser started by the CLI may still be running.
import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, relative, resolve } from 'node:path'
import { sha256Hex, sheetLayout, storyLayout, type ManifestEntry } from '../../src/cli/manifest.ts'
import { pngSize } from '../../src/cli/png.ts'
import { ffmpegForTests, testEnv, videoEnv } from '../support/env.ts'

const ROOT = resolve(import.meta.dir, '..', '..')
const BIN = join(ROOT, 'bin', 'mimir')
const STUB = join(ROOT, 'tests', 'fixtures', 'stub-viewer')
const SCENES = join(import.meta.dir, 'scenes')
const scene = (name: string): string => join(SCENES, `${name}.scene.js`)

const WORK = mkdtempSync(join(realpathSync(tmpdir()), 'mimir-e2e-cmd-'))
const TMP = join(WORK, 'tmp')
mkdirSync(TMP)
// these tests drive the agent loop with a stand-in agent: the loop is asked for (the default is one call, tests/e2e/once.test.ts)
const ENV: Record<string, string> = { ...(process.env as Record<string, string>), MIMIR_VIEWER_ROOT: STUB, TMPDIR: TMP, MIMIR_LAUNCH_DEPTH: '0', MIMIR_NEW_MODE: 'loop' }
testEnv(ENV, ['MIMIR_AGENT', 'MIMIR_AGENT_BIN', 'MIMIR_AGENT_COMMAND', 'MIMIR_MODEL', 'MIMIR_MAX_TURNS', 'MIMIR_MAX_USD', 'MIMIR_GEN_SYSTEM', 'MIMIR_PLUGIN_DIR', 'MIMIR_EXAMPLES', 'MIMIR_TOPICS', 'MIMIR_SESSION'])

let dirCount = 0
const freshDir = (): string => {
  const d = join(WORK, `d${++dirCount}`)
  mkdirSync(d)
  return d
}
interface Result { code: number; stdout: string; stderr: string }
async function mimir(args: string[], opts: { env?: Record<string, string>; cwd?: string } = {}): Promise<Result> {
  const proc = Bun.spawn([BIN, ...args], { cwd: opts.cwd ?? WORK, env: { ...ENV, ...opts.env }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
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
const manifestOf = (r: Result): ManifestEntry[] => JSON.parse(r.stdout) as ManifestEntry[]
const png = (path: string): Uint8Array => new Uint8Array(readFileSync(path))

afterEach(expectNoBrowser)
afterAll(() => rmSync(WORK, { recursive: true, force: true }))
const T = 90_000

/** A PATH on which the launcher still finds bun but nothing finds `name`. */
function pathWithout(name: string): string {
  const keep = (ENV.PATH ?? '').split(delimiter).filter((d) => d !== '' && !existsSync(join(d, name)))
  const bunDir = join(WORK, 'bun-only')
  if (!existsSync(bunDir)) { mkdirSync(bunDir); symlinkSync(process.execPath, join(bunDir, 'bun')) }
  return [bunDir, ...keep].join(delimiter)
}
// the ffmpeg the CLI itself would find (MIMIR_FFMPEG, else PATH): the video tests need one and are skipped without
const FFMPEG = ffmpegForTests()
const VIDEO = videoEnv(FFMPEG)

describe('mimir shot: filmstrips, parameter addresses, turntables', () => {
  test('--fine t0:t1:n: n frames at evenly spaced times and ONE filmstrip, four cells to a row', async () => {
    const out = freshDir()
    const r = await mimir(['shot', '--json', scene('demo'), '--fine', '1:4:7', '--out', out])
    expect(r.code).toBe(0)
    const m = manifestOf(r)
    const frames = m.filter((e) => !e.sheet)
    expect(frames.map((e) => e.t)).toEqual([1, 1.5, 2, 2.5, 3, 3.5, 4])
    expect(frames.map((e) => e.step)).toEqual([1, 1, 2, 2, 2, 2, 3])
    expect(new Set(frames.map((e) => e.sha256)).size).toBe(7) // every in-between frame is a different picture
    const strip = m[m.length - 1]!
    expect(strip).toMatchObject({ path: join(out, 'film.png'), title: 'filmstrip', sheet: { cols: 4, rows: 2, frames: 7 } })
    expect(pngSize(png(strip.path))).toEqual({ width: strip.width, height: strip.height })
    expect(strip.width).toBeLessThanOrEqual(1280)
    expect(strip.sheet!.tokens).toBe(Math.round((strip.width * strip.height) / 750))
    // --cols overrides the grid
    const six = manifestOf(await mimir(['shot', '--json', scene('demo'), '--fine', '1:4:6', '--cols', '6', '--out', freshDir()]))
    expect(six[six.length - 1]!.sheet).toMatchObject({ cols: 6, rows: 1, frames: 6 })
    // the same strip twice is the same bytes
    const again = manifestOf(await mimir(['shot', '--json', scene('demo'), '--fine', '1:4:7', '--out', freshDir()]))
    expect(again.map((e) => e.sha256)).toEqual(m.map((e) => e.sha256))
  }, T)

  test('--fine and --cues refuse what cannot be shot: past the end, a narration without cues', async () => {
    const out = freshDir()
    // a strip that starts inside the story and runs past its end stops at the end, and says so (the author had to guess)
    const clamped = await mimir(['shot', '--json', scene('demo'), '--fine', '4:9:5', '--out', freshDir()])
    expect(clamped.code).toBe(0)
    expect(clamped.stderr).toContain('--fine: the story ends at 6 s; the strip stops there instead of 9 s')
    const past = await mimir(['shot', '--json', scene('demo'), '--fine', '7:9:5', '--out', out])
    expect(past.code).toBe(2)
    expect(past.stderr).toContain('--fine 7:9:5: past the end of the story (duration 6s)')
    const cues = await mimir(['shot', '--json', scene('demo'), '--cues', '--out', out])
    expect(cues.code).toBe(2)
    expect(cues.stderr).toContain('--cues: the narration of this scene has no guide cue')
    expect(cues.stdout).toBe('')
    expect(readdirSync(out)).toEqual([])
  }, T)

  test('--at name=value: found when the story has the value, a clear refusal when it never does or when it is pinned', async () => {
    const out = freshDir()
    // the stub never moves its parameters: the declared value is there from t = 0
    const hit = manifestOf(await mimir(['shot', '--json', scene('demo'), '--at', 'hue=200,2.5', '--out', out]))
    expect(hit.map((e) => [e.path.slice(out.length + 1), e.t, e.step])).toEqual([['at-hue-200.png', 0, 1], ['t-2.500.png', 2.5, 2]])
    expect(hit[0]!.param).toEqual({ name: 'hue', value: 200 })
    expect(hit[1]).not.toHaveProperty('param')
    expect(JSON.parse(readFileSync(join(out, 'at-hue-200.probes.json'), 'utf8'))).toMatchObject({ t: 0, param: { name: 'hue', value: 200 }, params: { hue: 200 } })
    const cases: Array<[string[], string]> = [
      [['--at', 'hue=20'], '--at hue=20: the story never brings "hue" to 20 (the story keeps it at 200 over 6s). To see that value anyway, pin it: --set hue=20'],
      [['--at', 'hu=20'], '--at hu: the scene has no parameter "hu"; did you mean hue?'],
      [['--at', 'hue=200', '--set', 'hue=100'], '"hue" is pinned with --set, so the story no longer moves it'],
      [['--at', 'hue='], '--at takes seconds or name=value'],
    ]
    for (const [args, message] of cases) {
      const r = await mimir(['shot', '--json', scene('demo'), '--out', freshDir(), ...args])
      expect(r.code).toBe(2)
      expect(r.stderr).toContain(message)
      expect(r.stdout).toBe('')
    }
  }, T)

  test('--turntable: every frame from n angles, named by azimuth, one strip', async () => {
    const out = freshDir()
    const r = await mimir(['shot', '--json', scene('demo'), '--step', '2', '--turntable=4', '--sheet', '--out', out])
    expect(r.code).toBe(0)
    const m = manifestOf(r)
    expect(m.slice(0, 4).map((e) => [e.path.slice(out.length + 1), e.camera, e.step])).toEqual([
      ['step-02.az000.png', 'az000', 2], ['step-02.az090.png', 'az090', 2], ['step-02.az180.png', 'az180', 2], ['step-02.az270.png', 'az270', 2],
    ])
    expect(m[4]!.sheet).toMatchObject({ cols: 4, rows: 1, frames: 4 })
    // several steps: the views of one step stay together
    const two = manifestOf(await mimir(['shot', '--json', scene('clean'), '--turntable=2', '--out', freshDir()]))
    expect(two.map((e) => [e.step, e.camera])).toEqual([[1, 'az000'], [1, 'az180'], [2, 'az000'], [2, 'az180']])
    const both = await mimir(['shot', '--json', scene('demo'), '--turntable', '--views', 'iso', '--out', freshDir()])
    expect(both.code).toBe(2)
    expect(both.stderr).toContain('use only one of --views and --turntable')
  }, T)

  test('a sheet of steps has the pixel size the layout promises, and --debug ids falls back to the viewer overlay here', async () => {
    const out = freshDir()
    const r = await mimir(['shot', '--json', scene('demo'), '--sheet', '--debug', 'ids', '--out', out])
    expect(r.code).toBe(0)
    const m = manifestOf(r)
    const sheet = m[m.length - 1]!
    const flat = sheetLayout(3, 1280, 720)
    const story = storyLayout([{ heading: null, range: null, cells: [0, 1, 2].map((i) => ({ src: `${i}.png`, step: i + 1, title: '', t: i, view: null })) }], 1280, 720)
    expect({ width: sheet.width, height: sheet.height }).toEqual({ width: flat.width, height: flat.height })
    expect(story.pages[0]).toMatchObject({ width: flat.width, height: flat.height })
    expect(sheet).toMatchObject({ title: 'story sheet', path: join(out, 'sheet.debug-ids.png') })
    // the stub cannot be measured from outside: its own overlay is used and the frame keeps its size; no legend is claimed
    expect(r.stderr).toContain('--debug ids: this viewer does not expose its parts to measure')
    expect(m[0]).toMatchObject({ width: 1280, height: 720 })
    expect(JSON.parse(readFileSync(join(out, 'step-01.debug-ids.probes.json'), 'utf8'))).not.toHaveProperty('legend')
  }, T)
})

describe('mimir export: the article and the video', () => {
  test('--md alone: the step titles of a viewer without a transcript; --frames adds one image per step beside it', async () => {
    const dir = freshDir()
    const md = join(dir, 'demo.md')
    const r = await mimir(['export', scene('demo'), '--md', md, '--frames'])
    expect(r.code).toBe(0)
    const out = JSON.parse(r.stdout)
    expect(Object.keys(out)).toEqual(['md'])
    expect(out.md).toMatchObject({ path: md, steps: 3, chapters: 0, words: 0 })
    const text = readFileSync(md, 'utf8')
    expect(out.md.bytes).toBe(Buffer.byteLength(text))
    expect(text).toBe(
      '# Stub engine\n\n## 1. Intake\n\n![Intake](demo-frames/step-01.png)\n\n## 2. Compression\n\n![Compression](demo-frames/step-02.png)\n\n## 3. Power\n\n![Power](demo-frames/step-03.png)\n',
    )
    expect(r.stderr).toContain('the viewer reports no transcript')
    expect(out.md.frames.map((f: { path: string; step: number; t: number }) => [f.path, f.step, f.t])).toEqual([
      [join(dir, 'demo-frames', 'step-01.png'), 1, 1.999], [join(dir, 'demo-frames', 'step-02.png'), 2, 3.999], [join(dir, 'demo-frames', 'step-03.png'), 3, 5.999],
    ])
    for (const f of out.md.frames as Array<{ path: string; sha256: string }>) {
      expect(pngSize(png(f.path))).toEqual({ width: 1280, height: 720 })
      expect(sha256Hex(png(f.path))).toBe(f.sha256)
    }
    // the frames are the frames `shot` gives for the same steps
    const shots = manifestOf(await mimir(['shot', '--json', scene('demo'), '--out', freshDir()]))
    expect(shots.map((e) => e.sha256)).toEqual(out.md.frames.map((f: { sha256: string }) => f.sha256))
    // without --frames: text only, no directory
    const plain = join(freshDir(), 'plain.md')
    const p = JSON.parse((await mimir(['export', scene('demo'), '--md', plain, '--text', '--json'].filter((a) => a !== '--text'))).stdout)
    expect(p.md.frames).toEqual([])
    expect(readFileSync(plain, 'utf8')).not.toContain('![')
    expect(readdirSync(dirname(plain))).toEqual(['plain.md'])
  }, T)

  test('-o together with --md: the HTML result keeps its shape, the article is added under its key', async () => {
    const dir = freshDir()
    const r = await mimir(['export', scene('clean'), '-o', join(dir, 'c.html'), '--md', join(dir, 'c.md')])
    expect(r.code).toBe(0)
    const out = JSON.parse(r.stdout)
    expect(out).toMatchObject({ path: join(dir, 'c.html'), verified: true, md: { path: join(dir, 'c.md'), steps: 2 } })
    expect(readdirSync(dir).sort()).toEqual(['c.html', 'c.md'])
    const text = await mimir(['export', scene('clean'), '-o', join(dir, 'c.html'), '--md', join(dir, 'c.md'), '--text'])
    expect(text.stdout.split('\n').length).toBe(3)
    expect(text.stdout).toContain('verified from file://')
    expect(text.stdout).toContain('2 steps')
  }, T)

  test('--mp4 without ffmpeg: a message that says what to install, exit 2, before any browser starts', async () => {
    const out = join(freshDir(), 'v.mp4')
    const r = await mimir(['export', scene('demo'), '--mp4', out], { env: { PATH: pathWithout('ffmpeg') } })
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('mimir export --mp4 needs ffmpeg, and none was found on PATH')
    expect(r.stderr).toContain('MIMIR_FFMPEG=/path/to/ffmpeg')
    expect(r.stderr).not.toContain('browser') // nothing was launched
    expect(r.stdout).toBe('')
    expect(existsSync(out)).toBe(false)
    const bad = await mimir(['export', scene('demo'), '--mp4', out], { env: { MIMIR_FFMPEG: join(WORK, 'no-such-ffmpeg') } })
    expect(bad.code).toBe(2)
    expect(bad.stderr).toContain('MIMIR_FFMPEG points to a file that does not exist')
  }, T)

  test.skipIf(!FFMPEG)('--mp4: every frame of the range, the size and rate that were asked for, the same frames whatever the number of pages', async () => {
    const dir = freshDir()
    const one = await mimir(['export', scene('demo'), '--mp4', join(dir, 'one.mp4'), '--fps', '10', '--size', '320x180', '--from', '1', '--to', '4', '--jobs', '1'], { env: VIDEO })
    expect(one.code).toBe(0)
    const a = JSON.parse(one.stdout).mp4
    expect(a).toMatchObject({ path: join(dir, 'one.mp4'), frames: 30, fps: 10, width: 320, height: 180, from: 1, to: 4 })
    expect(statSync(a.path).size).toBe(a.bytes)
    expect(a.bytes).toBeGreaterThan(1000)
    expect(sha256Hex(png(a.path))).toBe(a.sha256)
    // what ffprobe measured in the file, when there is an ffprobe
    if (a.probe) expect(a.probe).toMatchObject({ frames: 30, width: 320, height: 180, codec: 'h264' })
    const three = await mimir(['export', scene('demo'), '--mp4', join(dir, 'three.mp4'), '--fps', '10', '--size', '320x180', '--from', '1', '--to', '4', '--jobs', '3'], { env: VIDEO })
    expect(three.code).toBe(0)
    const b = JSON.parse(three.stdout).mp4
    expect(b.frames_sha256).toBe(a.frames_sha256) // frame i is the picture at 1 + i / 10, whichever page drew it
    // a different range is a different set of frames
    const other = JSON.parse((await mimir(['export', scene('demo'), '--mp4', join(dir, 'other.mp4'), '--fps', '10', '--size', '320x180', '--to', '3'], { env: VIDEO })).stdout).mp4
    expect(other.frames).toBe(30)
    expect(other.frames_sha256).not.toBe(a.frames_sha256)
    expect(readdirSync(dir).sort()).toEqual(['one.mp4', 'other.mp4', 'three.mp4']) // no partial files left
  }, T)

  test.skipIf(!FFMPEG)('--mp4: a range the story does not have, an odd size and an encoder that fails are refused without leaving a file', async () => {
    const dir = freshDir()
    const past = await mimir(['export', scene('demo'), '--mp4', join(dir, 'v.mp4'), '--to', '99'], { env: VIDEO })
    expect(past.code).toBe(2)
    expect(past.stderr).toContain('--to 99: past the end of the story (duration 6s)')
    const odd = await mimir(['export', scene('demo'), '--mp4', join(dir, 'v.mp4'), '--size', '321x180'], { env: VIDEO })
    expect(odd.code).toBe(2)
    expect(odd.stderr).toContain('even width and height')
    // an "ffmpeg" that exits at once with an error
    const fake = join(dir, 'ffmpeg')
    writeFileSync(fake, '#!/bin/sh\necho "fake encoder: no codec" >&2\nexit 3\n')
    chmodSync(fake, 0o755)
    const failed = await mimir(['export', scene('demo'), '--mp4', join(dir, 'v.mp4'), '--fps', '5', '--size', '320x180'], { env: { MIMIR_FFMPEG: fake } })
    expect(failed.code).toBe(2)
    expect(failed.stderr).toContain('ffmpeg')
    expect(failed.stderr).toContain('fake encoder: no codec')
    expect(readdirSync(dir).sort()).toEqual(['ffmpeg'])
  }, T)

  test('usage: flags that belong to another output, a directory as the file', async () => {
    const dir = freshDir()
    const cases: Array<[string[], string]> = [
      [['-o', join(dir, 'a.html'), '--frames'], '--frames belongs to --md'],
      [['-o', join(dir, 'a.html'), '--fps', '24'], '--fps belongs to --mp4'],
      [['--md', dir], `--md ${dir} is a directory; name the file to write`],
      [['--md', join(dir, 'a.md'), '--set', 'hu=1'], 'the scene has no parameter "hu"; did you mean hue?'],
    ]
    for (const [args, message] of cases) {
      const r = await mimir(['export', scene('demo'), ...args])
      expect(r.code).toBe(2)
      expect(r.stderr).toContain(message)
      expect(r.stdout).toBe('')
    }
    expect(readdirSync(dir)).toEqual([])
  }, T)
})

describe('mimir query against a viewer that only has the host protocol', () => {
  test('state and probes are answered; when: --at, --step, --set, the end of the story by default', async () => {
    const end = JSON.parse((await mimir(['query', scene('demo'), 'state'])).stdout)
    expect(end).toMatchObject({ query: 'state', scene: 'demo.scene.js', t: 5.999, step: 3, source: 'viewer', step_title: 'Power', params: { hue: 200, speed: 1 } })
    const at = JSON.parse((await mimir(['query', scene('demo'), 'probes', '--at', '2.5', '--set', 'hue=20'])).stdout)
    expect(at).toEqual({ query: 'probes', scene: 'demo.scene.js', t: 2.5, step: 2, set: { hue: 20 }, source: 'viewer', params: { hue: 20, speed: 1 }, probes: { t: 2.5, angle: 100, hue: 20 } })
    const step = JSON.parse((await mimir(['query', scene('demo'), 'probes', '--step', '1'])).stdout)
    expect(step).toMatchObject({ t: 1.999, step: 1, probes: { angle: 40 * 1.999 } })
    // one compact line when piped, indented for a person
    const piped = await mimir(['query', scene('demo'), 'state'])
    expect(piped.stdout.trimEnd().includes('\n')).toBe(false)
    const text = await mimir(['query', scene('demo'), 'state', '--text'])
    expect(text.stdout).toContain('\n  "query": "state"')
    expect(JSON.parse(text.stdout).step).toBe(3)
  }, T)

  test('geometry it cannot measure is an error that says so, never a number', async () => {
    for (const q of [['distance', 'tri', 'dot'], ['bounds', 'tri'], ['visible', 'tri'], ['contacts']]) {
      const r = await mimir(['query', scene('demo'), ...q])
      expect(r.code).toBe(2)
      expect(r.stdout).toBe('')
      expect(r.stderr).toContain(`query ${q[0]} cannot be answered: this viewer exposes neither __mimir.query() nor its frame state. Nothing was measured.`)
    }
  }, T)

  test('a viewer with its own query() is asked, with the ids and the tolerance', async () => {
    const viewer = freshDir()
    for (const f of readdirSync(STUB)) copyFileSync(join(STUB, f), join(viewer, f))
    const runtime = readFileSync(join(viewer, 'mimir.js'), 'utf8')
    const marker = '  probes: currentProbes,\n'
    expect(runtime).toContain(marker)
    writeFileSync(join(viewer, 'mimir.js'), runtime.replace(marker, marker + '  query(what, ids, opts) { return { what, ids, tolerance: opts.tolerance, tau: state.tau, distance: 4.2 } },\n'))
    const r = await mimir(['query', scene('demo'), 'distance', 'tri', 'dot', '--at', '1.5', '--tolerance', '0.25'], { env: { MIMIR_VIEWER_ROOT: viewer } })
    expect(r.code).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual({ query: 'distance', ids: ['tri', 'dot'], scene: 'demo.scene.js', t: 1.5, step: 1, source: 'viewer', what: 'distance', tolerance: 0.25, tau: 1.5, distance: 4.2 })
  }, T)

  test('usage errors exit 2: an unknown query, the wrong number of ids, a time past the end, a broken scene exits 1', async () => {
    const cases: Array<[string[], string]> = [
      [['weight'], 'unknown query "weight" (one of: distance, contacts, bounds, visible, state, probes)'],
      [['distance', 'tri'], 'query distance takes 2 ids (got 1: tri)'],
      [['state', '--at', '99'], 'past the end of the story (duration 6s)'],
      [['state', '--step', '9'], '--step 9: no such step (steps: 1, 2, 3)'],
      [['state', '--set', 'hu=1'], '--set hu: the scene has no parameter "hu"; did you mean hue?'],
    ]
    for (const [args, message] of cases) {
      const r = await mimir(['query', scene('demo'), ...args])
      expect(r.code).toBe(2)
      expect(r.stderr).toContain(message)
      expect(r.stderr).toContain('usage: mimir query <scene>')
      expect(r.stdout).toBe('')
    }
    const broken = await mimir(['query', scene('broken'), 'state'], { cwd: SCENES })
    expect(broken.code).toBe(1)
    expect(broken.stderr).toContain('RUNTIME-ERROR error | broken.scene.js:5')
    expect(broken.stdout).toBe('')
  }, T)
})

describe('mimir docs, examples, init', () => {
  const TYPES = join(ROOT, 'tests', 'unit', 'cli', 'fixtures', 'sample.d.ts.txt')

  test('docs <symbol> shows where an example uses it; docs <guide> prints a topic file; the index lists the guides', async () => {
    const examples = freshDir()
    const topics = freshDir()
    writeFileSync(join(examples, 'pump.scene.js'), `// pump: two valves.\nimport { scene, box } from 'mimir'\nexport default scene({ title: 'Pump' }, (s) => {\n  const body = box({ id: 'body', width: 2 })\n  s.step('In', (st) => {})\n})\n`)
    writeFileSync(join(topics, 'cutaways.md'), '# Cutaways\n\nSlice a housing to show what is inside.\n')
    const env = { MIMIR_TYPES: TYPES, MIMIR_EXAMPLES: examples, MIMIR_TOPICS: topics }
    const sym = await mimir(['docs', 'box'], { env })
    expect(sym.code).toBe(0)
    expect(sym.stdout).toContain('function box(')
    // the file is named the way the caller can open it: relative to the working directory when it is under it
    const shown = relative(WORK, join(examples, 'pump.scene.js'))
    expect(sym.stdout).toEndWith(`\nexample (${shown}:4):\n  const body = box({ id: 'body', width: 2 })\n`)
    const json = JSON.parse((await mimir(['docs', 'box', '--json'], { env })).stdout)
    expect(json.example).toEqual({ file: shown, line: 4, text: `const body = box({ id: 'body', width: 2 })` })
    expect((await mimir(['docs', 'box'], { env, cwd: topics })).stdout).toContain(`example (${join(examples, 'pump.scene.js')}:4)`) // absolute from elsewhere
    const guide = await mimir(['docs', 'cutaways'], { env })
    expect(guide).toMatchObject({ code: 0, stdout: '# Cutaways\n\nSlice a housing to show what is inside.\n' })
    expect(JSON.parse((await mimir(['docs', 'Cutaways', '--json'], { env })).stdout)).toEqual({ guide: 'cutaways', title: 'Cutaways', text: '# Cutaways\n\nSlice a housing to show what is inside.\n' })
    const list = await mimir(['docs'], { env })
    expect(list.stdout).toContain('2d: text rect BLUE\n')
    expect(list.stdout).toEndWith('guides (mimir docs <name>): cutaways\nthe whole reference, one line per declaration: mimir docs reference\n')
    const index = JSON.parse((await mimir(['docs', '--json'], { env })).stdout)
    expect(index.guides).toEqual([{ name: 'cutaways', title: 'Cutaways' }])
    expect(index.modules.find((m: { module: string }) => m.module === '2d').names).toEqual(['text', 'rect', 'BLUE'])
    // a miss suggests guides too
    const miss = await mimir(['docs', 'cutaway'], { env })
    expect(miss.code).toBe(2)
    expect(miss.stderr).toContain('did you mean cutaways')
  }, T)

  test('examples: one line each, the directory from MIMIR_EXAMPLES; the real examples all have a title and a summary', async () => {
    const dir = freshDir()
    writeFileSync(join(dir, 'pump.scene.js'), `// pump: two valves and a chamber. More text.\nexport default scene({ title: 'How a pump works' }, () => {})\n`)
    writeFileSync(join(dir, 'bare.scene.js'), `export default scene({ title: 'Bare' }, () => {})\n`)
    writeFileSync(join(dir, 'README.md'), 'not a scene')
    const text = await mimir(['examples', '--text'], { env: { MIMIR_EXAMPLES: dir } })
    const rel = (name: string): string => relative(WORK, join(dir, name))
    expect(text).toMatchObject({ code: 0, stdout: `bare  Bare\npump  How a pump works: two valves and a chamber.\nmimir examples <name> prints one (they are in ${rel('')})\n` })
    // piped output is the same text: JSON only when asked for
    expect((await mimir(['examples'], { env: { MIMIR_EXAMPLES: dir } })).stdout).toBe(text.stdout)
    const json = JSON.parse((await mimir(['examples', '--json'], { env: { MIMIR_EXAMPLES: dir } })).stdout)
    expect(json).toEqual([
      { name: 'bare', path: join(dir, 'bare.scene.js'), title: 'Bare', summary: 'Bare' },
      { name: 'pump', path: join(dir, 'pump.scene.js'), title: 'How a pump works', summary: 'two valves and a chamber. More text.' },
    ])
    const real = JSON.parse((await mimir(['examples', '--json'])).stdout) as Array<{ name: string; path: string; title: string; summary: string }>
    expect(real.length).toBeGreaterThan(0)
    for (const e of real) {
      expect(existsSync(e.path)).toBe(true)
      expect(e.title.length).toBeGreaterThan(0)
      expect(e.summary.length).toBeGreaterThan(0)
    }
    // one example by name: its source, as text even when piped (an agent reads it from stdout)
    const one = await mimir(['examples', 'pump'], { env: { MIMIR_EXAMPLES: dir } })
    expect(one).toMatchObject({ code: 0, stdout: readFileSync(join(dir, 'pump.scene.js'), 'utf8') })
    expect((await mimir(['examples', 'pump.scene.js'], { env: { MIMIR_EXAMPLES: dir } })).stdout).toBe(one.stdout)
    expect(JSON.parse((await mimir(['examples', 'bare', '--json'], { env: { MIMIR_EXAMPLES: dir } })).stdout)).toEqual({
      name: 'bare', path: join(dir, 'bare.scene.js'), title: 'Bare', summary: 'Bare', source: `export default scene({ title: 'Bare' }, () => {})\n`,
    })
    const typo = await mimir(['examples', 'pmp'], { env: { MIMIR_EXAMPLES: dir } })
    expect(typo.code).toBe(2)
    expect(typo.stderr).toContain('no example "pmp"; did you mean pump? (examples: bare, pump)')
    const none = await mimir(['examples'], { env: { MIMIR_EXAMPLES: join(dir, 'nope') } })
    expect(none.code).toBe(2)
    expect(none.stderr).toContain('there is no examples directory')
  }, T)

  test('init writes <name>.scene.js, never overwrites without --force, and says what to run next', async () => {
    const dir = freshDir()
    const r = await mimir(['init', 'my-pump'], { cwd: dir })
    expect(r.code).toBe(0)
    const out = JSON.parse(r.stdout)
    expect(out.path).toEndWith(join('my-pump.scene.js'))
    expect(out.next).toEqual(['mimir check my-pump.scene.js', 'mimir shot my-pump.scene.js --sheet', 'mimir open my-pump.scene.js'])
    const source = readFileSync(join(dir, 'my-pump.scene.js'), 'utf8')
    expect(out.bytes).toBe(Buffer.byteLength(source))
    expect(source).toContain(`scene({ title: "My pump" }`)
    const again = await mimir(['init', 'my-pump.scene.js'], { cwd: dir })
    expect(again.code).toBe(2)
    expect(again.stderr).toContain('my-pump.scene.js already exists; choose another name or pass --force')
    expect(readFileSync(join(dir, 'my-pump.scene.js'), 'utf8')).toBe(source)
    writeFileSync(join(dir, 'my-pump.scene.js'), 'edited')
    expect((await mimir(['init', 'my-pump', '--force'], { cwd: dir })).code).toBe(0)
    expect(readFileSync(join(dir, 'my-pump.scene.js'), 'utf8')).toBe(source)
    // -o names the directory; text form is just the path
    const into = await mimir(['init', 'other', '-o', 'scenes/new', '--text'], { cwd: dir })
    expect(into.stdout).toMatch(/scenes\/new\/other\.scene\.js\n$/)
    expect(existsSync(join(dir, 'scenes', 'new', 'other.scene.js'))).toBe(true)
    const bad = await mimir(['init', '../escape'], { cwd: dir })
    expect(bad.code).toBe(2)
    expect(bad.stderr).toContain('the name must be a file name')
  }, T)
})
