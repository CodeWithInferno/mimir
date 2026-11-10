// End-to-end: the real launcher (bin/mimir) + real headless Chrome, against the stub viewer in
// tests/fixtures/stub-viewer (same page contract as dist/viewer.html; selected with MIMIR_VIEWER_ROOT).
// After EVERY test the process list is checked: no browser started by the CLI may still be running.
import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchChrome } from '../../src/cli/chrome.ts'
import { sha256Hex, sheetLayout, type ManifestEntry } from '../../src/cli/manifest.ts'
import { pngSize } from '../../src/cli/png.ts'
import { waitReady } from '../../src/cli/session.ts'
import { testEnv } from '../support/env.ts'

const ROOT = resolve(import.meta.dir, '..', '..')
const BIN = join(ROOT, 'bin', 'mimir')
const STUB = join(ROOT, 'tests', 'fixtures', 'stub-viewer')
const SCENES = join(import.meta.dir, 'scenes')
const scene = (name: string): string => join(SCENES, `${name}.scene.js`)

// Every browser profile the CLI creates lives under this directory, so its path marks our processes in `ps`.
const WORK = mkdtempSync(join(realpathSync(tmpdir()), 'mimir-e2e-'))
const TMP = join(WORK, 'tmp')
mkdirSync(TMP)
const ENV: Record<string, string> = {
  ...(process.env as Record<string, string>),
  MIMIR_VIEWER_ROOT: STUB,
  TMPDIR: TMP,
  MIMIR_LAUNCH_DEPTH: '0',
}
// the shell's own settings must not change what is asserted; a machine that needs browser flags says so (tests/support/env.ts)
testEnv(ENV)
// browsers this file launches directly get the same marked temp directory through launchChrome({ env: ENV })

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

/** Command lines of running processes that use a profile under our temp directory. */
function browsersRunning(): string[] {
  const ps = Bun.spawnSync(['ps', '-axo', 'command='])
  return ps.stdout.toString().split('\n').filter((l) => l.includes(WORK) && l.includes('--user-data-dir'))
}

const profilesLeft = (): string[] => readdirSync(TMP).filter((n) => n.startsWith('mimir-chrome-'))

async function expectNoBrowser(): Promise<void> {
  // helper processes may need a moment to notice that the browser process is gone
  for (let i = 0; i < 40 && browsersRunning().length > 0; i++) await Bun.sleep(50)
  const processes = browsersRunning()
  const profiles = profilesLeft()
  // clean up before asserting, so that one guilty test fails alone instead of failing every test after it
  for (const line of Bun.spawnSync(['ps', '-axo', 'pid=,command=']).stdout.toString().split('\n')) {
    if (line.includes(WORK) && line.includes('--user-data-dir')) {
      try {
        process.kill(Number(line.trim().split(/\s+/)[0]), 'SIGKILL')
      } catch {
        // already gone
      }
    }
  }
  for (const p of profiles) rmSync(join(TMP, p), { recursive: true, force: true })
  expect(processes).toEqual([])
  expect(profiles).toEqual([])
}

const manifestOf = (r: Result): ManifestEntry[] => JSON.parse(r.stdout) as ManifestEntry[]
const png = (path: string): Uint8Array => new Uint8Array(readFileSync(path))

afterEach(expectNoBrowser)
afterAll(() => rmSync(WORK, { recursive: true, force: true }))

const T = 60_000

describe('mimir check', () => {
  test('text form: the deliberate diagnostics, errors first, FAIL status, exit 1', async () => {
    const r = await mimir(['check', scene('demo'), '--text'], { cwd: ROOT })
    expect(r.code).toBe(1)
    expect(r.stdout).toBe(
      'OFF-FRAME error | step 2 "Compression" t=3.5s | #tri | tests/e2e/scenes/demo.scene.js:8\n' +
        '  what: #tri extends 38 px past the right edge of the frame.\n' +
        '  fix: tri.nextTo(dot, "left"); tri.shift(-0.5, 0)\n' +
        'TEXT-TINY warn | step 1 "Intake" t=1s | #caption | tests/e2e/scenes/demo.scene.js:9\n' +
        '  what: label #caption is 11 px tall at 1280x720; the minimum is 14 px.\n' +
        '  fix: text(…, { size: "label" })\n' +
        'FAIL 1 error, 1 warning\n',
    )
  }, T)

  test('JSON form is the default when piped: one compact line, same records, exit 1', async () => {
    const r = await mimir(['check', scene('demo')], { cwd: ROOT })
    expect(r.code).toBe(1)
    expect(r.stdout.trimEnd().includes('\n')).toBe(false)
    const out = JSON.parse(r.stdout)
    expect(out).toMatchObject({ ok: false, errors: 1, warnings: 1, total: 2, shown: 2 })
    expect(out.diagnostics[0]).toEqual({
      code: 'OFF-FRAME', severity: 'error', step: 2, t: 3.5, ids: ['tri'], file: 'tests/e2e/scenes/demo.scene.js', line: 8,
      measured: 38, limit: 0, what: '#tri extends 38 px past the right edge of the frame.', fix: ['tri.nextTo(dot, "left")', 'tri.shift(-0.5, 0)'],
    })
    expect(out.diagnostics[1].code).toBe('TEXT-TINY')
    // --json gives the same bytes
    expect((await mimir(['check', scene('demo'), '--json'], { cwd: ROOT })).stdout).toBe(r.stdout)
  }, T)

  test('a clean scene: OK and exit 0', async () => {
    const text = await mimir(['check', scene('clean'), '--text'])
    expect(text.code).toBe(0)
    expect(text.stdout).toBe('OK 0 errors, 0 warnings\n')
    const json = await mimir(['check', scene('clean')])
    expect(json.code).toBe(0)
    expect(JSON.parse(json.stdout)).toEqual({ ok: true, errors: 0, warnings: 0, total: 0, shown: 0, diagnostics: [] })
  }, T)

  test('a scene that fails to import is exactly one RUNTIME-ERROR with its line, exit 1', async () => {
    const r = await mimir(['check', scene('broken')], { cwd: SCENES })
    expect(r.code).toBe(1)
    const out = JSON.parse(r.stdout)
    expect(out.diagnostics.length).toBe(1)
    expect(out.diagnostics[0]).toMatchObject({ code: 'RUNTIME-ERROR', severity: 'error', file: 'broken.scene.js', line: 5 })
    expect(out.diagnostics[0].what).toContain("Cannot read properties of undefined (reading 'at')")
    const text = await mimir(['check', scene('broken'), '--text'], { cwd: SCENES })
    expect(text.stdout.split('\n')[0]).toBe('RUNTIME-ERROR error | broken.scene.js:5')
    expect(text.stdout.trimEnd().split('\n').pop()).toBe('FAIL 1 error, 0 warnings')
  }, T)

  test('at most 8 diagnostics, errors first, unless --all', async () => {
    const capped = JSON.parse((await mimir(['check', scene('many')])).stdout)
    expect(capped).toMatchObject({ errors: 2, warnings: 10, total: 12, shown: 8 })
    expect(capped.diagnostics.map((d: { code: string }) => d.code).slice(0, 3)).toEqual(['FLOATING', 'DEAD-PARAM', 'TEXT-OVERLAP'])
    const all = await mimir(['check', scene('many'), '--all', '--text'])
    expect(all.code).toBe(1)
    const lines = all.stdout.trimEnd().split('\n')
    expect(lines.length).toBe(12 * 3 + 1)
    expect(lines.pop()).toBe('FAIL 2 errors, 10 warnings')
    const text = await mimir(['check', scene('many'), '--text'])
    expect(text.stdout.trimEnd().split('\n').pop()).toBe('FAIL 2 errors, 10 warnings (showing 8 of 12; --all prints every one)')
  }, T)

  test('page console errors go to stderr; stdout stays the result only', async () => {
    const r = await mimir(['check', scene('noisy')])
    expect(r.code).toBe(0)
    expect(r.stderr).toContain('[page error] boom from the scene console')
    expect(JSON.parse(r.stdout).ok).toBe(true)
    expect(r.stdout).not.toContain('boom')
  }, T)
})

describe('mimir shot', () => {
  test('default: one PNG per step end state, manifest on stdout, probes JSON next to each PNG', async () => {
    const out = freshDir()
    const r = await mimir(['shot', '--json', scene('demo'), '--out', out])
    expect(r.code).toBe(0)
    const m = manifestOf(r)
    expect(m.map((e) => [e.step, e.title, e.t, e.camera, e.width, e.height])).toEqual([
      [1, 'Intake', 1.999, null, 1280, 720],
      [2, 'Compression', 3.999, null, 1280, 720],
      [3, 'Power', 5.999, null, 1280, 720],
    ])
    expect(Object.keys(m[0]!)).toEqual(['path', 'step', 'title', 't', 'camera', 'width', 'height', 'sha256'])
    expect(m.map((e) => e.path)).toEqual(['step-01.png', 'step-02.png', 'step-03.png'].map((f) => join(out, f)))
    for (const e of m) {
      const bytes = png(e.path)
      expect(pngSize(bytes)).toEqual({ width: 1280, height: 720 })
      expect(sha256Hex(bytes)).toBe(e.sha256)
      const probes = JSON.parse(readFileSync(e.path.replace(/\.png$/, '.probes.json'), 'utf8'))
      expect(probes).toMatchObject({ scene: 'demo.scene.js', step: e.step, title: e.title, t: e.t, camera: null, params: { hue: 200, speed: 1 } })
      expect(probes.probes).toEqual({ t: e.t, angle: 40 * e.t!, hue: 200 })
    }
    expect(new Set(m.map((e) => e.sha256)).size).toBe(3)
    expect(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))).toEqual(m)
  }, T)

  test('frames differ across times and are IDENTICAL for the same time shot twice', async () => {
    const a = manifestOf(await mimir(['shot', '--json', scene('demo'), '--at', '1.5,3', '--out', freshDir()]))
    const b = manifestOf(await mimir(['shot', '--json', scene('demo'), '--at', '1.5,3', '--out', freshDir()]))
    expect(a.map((e) => e.t)).toEqual([1.5, 3])
    expect(a.map((e) => e.step)).toEqual([1, 2])
    expect(a[0]!.sha256).not.toBe(a[1]!.sha256)
    expect(b.map((e) => e.sha256)).toEqual(a.map((e) => e.sha256))
    expect(a[0]!.path.endsWith('t-1.500.png')).toBe(true)
    // the same time reached in a different order inside one run is the same picture too (no history dependence)
    const c = manifestOf(await mimir(['shot', '--json', scene('demo'), '--at', '3,0.25,1.5', '--out', freshDir()]))
    expect(c[2]!.sha256).toBe(a[0]!.sha256)
    expect(c[0]!.sha256).toBe(a[1]!.sha256)
  }, T)

  test('--sheet writes ONE contact sheet with the expected pixel size', async () => {
    const out = freshDir()
    const r = await mimir(['shot', '--json', scene('demo'), '--sheet', '--out', out])
    expect(r.code).toBe(0)
    const m = manifestOf(r)
    expect(m.length).toBe(4)
    const sheet = m[3]!
    const layout = sheetLayout(3, 1280, 720)
    expect(layout).toMatchObject({ cols: 3, rows: 1, width: 1280 })
    expect(sheet).toMatchObject({ path: join(out, 'sheet.png'), step: null, t: null, sheet: { cols: 3, rows: 1, frames: 3 } })
    const bytes = png(sheet.path)
    expect(pngSize(bytes)).toEqual({ width: layout.width, height: layout.height })
    expect({ width: sheet.width, height: sheet.height }).toEqual({ width: layout.width, height: layout.height })
    expect(sheet.width).toBeLessThanOrEqual(1280)
    expect(sha256Hex(bytes)).toBe(sheet.sha256)
    expect(readdirSync(out).filter((f) => f.startsWith('sheet')).length).toBe(1)
    // the sheet is not just one of the frames
    expect(m.slice(0, 3).map((e) => e.sha256)).not.toContain(sheet.sha256)
  }, T)

  test('--set changes the picture and the reported params', async () => {
    const base = manifestOf(await mimir(['shot', '--json', scene('demo'), '--at', '1.5', '--out', freshDir()]))
    const out = freshDir()
    const set = manifestOf(await mimir(['shot', '--json', scene('demo'), '--at', '1.5', '--set', 'hue=20', '--out', out]))
    expect(set[0]!.sha256).not.toBe(base[0]!.sha256)
    const probes = JSON.parse(readFileSync(join(out, 't-1.500.probes.json'), 'utf8'))
    expect(probes.params).toEqual({ hue: 20, speed: 1 })
    expect(probes.probes.hue).toBe(20)
    // setting the default value explicitly is the default picture
    const same = manifestOf(await mimir(['shot', '--json', scene('demo'), '--at', '1.5', '--set', 'hue=200', '--out', freshDir()]))
    expect(same[0]!.sha256).toBe(base[0]!.sha256)
  }, T)

  test('--step, --views, --debug, --size and --scale', async () => {
    const out = freshDir()
    const r = await mimir(['shot', '--json', scene('demo'), '--step', '2', '--views', 'iso,front', '--debug', 'ids', '--size', '640x360', '--scale', '2', '--sheet', '--out', out])
    expect(r.code).toBe(0)
    const m = manifestOf(r)
    expect(m.map((e) => [e.path.slice(out.length + 1), e.step, e.camera, e.width, e.height])).toEqual([
      ['step-02.iso.debug-ids.png', 2, 'iso', 1280, 720],
      ['step-02.front.debug-ids.png', 2, 'front', 1280, 720],
      ['sheet.debug-ids.png', null, null, 1280, sheetLayout(2, 1280, 720).height],
    ])
    expect(m[0]!.sha256).not.toBe(m[1]!.sha256)
    expect(pngSize(png(m[0]!.path))).toEqual({ width: 1280, height: 720 })
    // debug mode is a different picture than the plain frame of the same step, view and size
    const plain = manifestOf(await mimir(['shot', '--json', scene('demo'), '--step', '2', '--views', 'iso', '--size', '640x360', '--scale', '2', '--out', freshDir()]))
    expect(plain[0]!.sha256).not.toBe(m[0]!.sha256)
  }, T)

  test('a second run into the same directory removes the files of the first', async () => {
    const out = freshDir()
    await mimir(['shot', '--json', scene('demo'), '--sheet', '--out', out])
    expect(readdirSync(out).sort()).toEqual(['manifest.json', 'sheet.png', 'step-01.png', 'step-01.probes.json', 'step-02.png', 'step-02.probes.json', 'step-03.png', 'step-03.probes.json'])
    await mimir(['shot', '--json', scene('demo'), '--step', '1', '--out', out])
    expect(readdirSync(out).sort()).toEqual(['manifest.json', 'step-01.png', 'step-01.probes.json'])
  }, T)

  test('default output directory is .mimir/shots/<scene> under the working directory', async () => {
    const cwd = realpathSync(freshDir())
    const m = manifestOf(await mimir(['shot', '--json', scene('clean'), '--step', '1'], { cwd }))
    expect(m[0]!.path).toBe(join(cwd, '.mimir', 'shots', 'clean', 'step-01.png'))
    expect(existsSync(m[0]!.path)).toBe(true)
  }, T)

  test('text form lists one file per line', async () => {
    const out = freshDir()
    const r = await mimir(['shot', scene('clean'), '--text', '--out', out])
    // the directory once (relative to the working directory when it is inside it), then the names: no path repeated, no hash
    const lines = r.stdout.split('\n')
    expect(lines[0]).toMatch(/^in (.*\/)?d\d+\/$/)
    expect(lines.slice(1)).toEqual(['step 1 "Enqueue" t=1.499s  1280x720  step-01.png', 'step 2 "Process" t=3.999s  1280x720  step-02.png', ''])
    expect(r.stdout).not.toMatch(/[0-9a-f]{64}/)
  }, T)

  test('6 frames at 1280x720 take less than 5 s after launch', async () => {
    const r = await mimir(['shot', '--json', scene('demo'), '--at', '0.5,1.5,2.5,3.5,4.5,5.5', '--out', freshDir()])
    expect(r.code).toBe(0)
    expect(manifestOf(r).length).toBe(6)
    const ms = Number(/6 frames in (\d+) ms/.exec(r.stderr)![1])
    const ready = Number(/scene ready (\d+) ms/.exec(r.stderr)![1])
    expect(ms + ready).toBeLessThan(5000)
  }, T)

  test('usage errors exit 2 and render nothing', async () => {
    const out = freshDir()
    const cases: Array<[string[], string]> = [
      [['--step', '9'], '--step 9: no such step (steps: 1, 2, 3)'],
      [['--at', '99'], 'past the end of the story (duration 6s)'],
      [['--set', 'hu=3'], 'the scene has no parameter "hu"; did you mean hue?'],
      [['--views', 'isso'], '--views isso: no such view; did you mean iso? (views: front, iso, side, top)'],
      [['--steps', '--at', '1'], 'use only one of --steps, --at, --step'],
      [['--size', 'big'], '--size must look like 1280x720'],
      [['--shet'], 'unknown option --shet'],
    ]
    for (const [args, message] of cases) {
      const r = await mimir(['shot', '--json', scene('demo'), '--out', out, ...args])
      expect(r.code).toBe(2)
      expect(r.stderr).toContain(message)
      expect(r.stderr).toContain('usage: mimir shot <scene>')
      expect(r.stdout).toBe('')
    }
    expect(readdirSync(out)).toEqual([])
  }, T)

  test('a scene that fails to load: the RUNTIME-ERROR on stderr, an empty manifest, exit 1', async () => {
    const r = await mimir(['shot', '--json', scene('broken'), '--out', freshDir()], { cwd: SCENES })
    expect(r.code).toBe(1)
    expect(r.stdout).toBe('[]\n')
    expect(r.stderr).toContain('RUNTIME-ERROR error | broken.scene.js:5')
  }, T)
})

describe('headless driver', () => {
  test('a scene that never becomes ready is a load error of the scene: one RUNTIME-ERROR, exit 1, browser gone', async () => {
    // It used to be exit 2 with the message on stderr only: an agent that reads stdout and the exit code could not
    // tell a scene stuck in a loop or a top-level await from a broken installation.
    const r = await mimir(['shot', '--json', scene('hang'), '--out', freshDir()], { env: { MIMIR_TIMEOUT: '1500' } })
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('the scene never finished building (waited 1500 ms)')
    expect(r.stderr).toContain('nothing rendered')
    expect(r.stdout).toBe('[]\n')
    const check = await mimir(['check', scene('hang')], { cwd: SCENES, env: { MIMIR_TIMEOUT: '1500' } })
    expect(check.code).toBe(1)
    const out = JSON.parse(check.stdout)
    expect(out).toMatchObject({ ok: false, errors: 1, total: 1 })
    expect(out.diagnostics[0]).toMatchObject({ code: 'RUNTIME-ERROR', file: 'hang.scene.js' })
    expect(out.diagnostics[0].what).toContain('stuck in an endless loop or in a top-level await')
  }, T)

  // Signals are sent at several moments after the browser process appears. Two real defects lived here:
  //  - ~30 ms: only the browser process was killed; a GPU helper that was just being spawned outlived it and
  //    re-created the profile directory after it had been removed (8 of 10 runs);
  //  - 60-90 ms: the launch that was in flight failed because the browser was gone, and that error raced the
  //    signal teardown to the exit: exit code 2 with "could not connect…", profile left behind (10 of 10 runs).
  // Every run must end with the signal's exit code, nothing on stdout, no error on stderr, no browser, no profile.
  async function interrupted(signal: 'SIGINT' | 'SIGTERM', delayMs: number, args: string[]): Promise<Result> {
    const proc = Bun.spawn([BIN, ...args], { cwd: WORK, env: ENV, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    for (let i = 0; i < 400 && browsersRunning().length === 0; i++) await Bun.sleep(5)
    expect(browsersRunning().length).toBeGreaterThan(0)
    await Bun.sleep(delayMs)
    proc.kill(signal)
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    return { code, stdout, stderr }
  }

  for (const delay of [0, 30, 60, 90, 150, 300]) {
    test(`SIGINT ${delay} ms after the browser starts: exit 130, silent, browser and profile gone`, async () => {
      const r = await interrupted('SIGINT', delay, ['shot', '--json', scene('hang'), '--out', freshDir()])
      expect(r).toEqual({ code: 130, stdout: '', stderr: '' })
      await expectNoBrowser()
    }, T)
  }

  for (const delay of [30, 90]) {
    test(`SIGTERM ${delay} ms after the browser starts: exit 143, silent, browser and profile gone`, async () => {
      const r = await interrupted('SIGTERM', delay, ['check', scene('hang')])
      expect(r).toEqual({ code: 143, stdout: '', stderr: '' })
      await expectNoBrowser()
    }, T)
  }

  test('SIGINT while frames are being rendered: exit 130 and no half-reported result', async () => {
    const r = await interrupted('SIGINT', 250, ['shot', '--json', scene('demo'), '--at', Array.from({ length: 400 }, (_, i) => (i * 0.015).toFixed(3)).join(','), '--out', freshDir()])
    expect(r.code).toBe(130)
    expect(r.stdout).toBe('')
    expect(r.stderr).not.toMatch(/could not|timed out|internal error|closed the DevTools/)
  }, T)

  test('SIGKILL of the CLI (no handler can run): the browser still quits by itself', async () => {
    const proc = Bun.spawn([BIN, 'shot', '--json', scene('hang'), '--out', freshDir()], { cwd: WORK, env: ENV, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    for (let i = 0; i < 400 && browsersRunning().length < 3; i++) await Bun.sleep(5)
    await Bun.sleep(300)
    expect(browsersRunning().length).toBeGreaterThan(0)
    proc.kill('SIGKILL')
    await proc.exited
    for (let i = 0; i < 100 && browsersRunning().length > 0; i++) await Bun.sleep(50)
    expect(browsersRunning()).toEqual([])
    // nobody was left to remove the profile: this is the one case where the directory stays (in the temp dir)
    expect(profilesLeft().length).toBe(1)
    for (const p of profilesLeft()) rmSync(join(TMP, p), { recursive: true, force: true })
  }, T)

  test('MIMIR_CHROME pointing nowhere and a viewer root without viewer.html are clear errors', async () => {
    const a = await mimir(['check', scene('clean')], { env: { MIMIR_CHROME: '/nope/chrome' } })
    expect(a.code).toBe(2)
    expect(a.stderr).toContain('MIMIR_CHROME points to a file that does not exist: /nope/chrome')
    const b = await mimir(['check', scene('clean')], { env: { MIMIR_VIEWER_ROOT: freshDir() } })
    expect(b.code).toBe(2)
    expect(b.stderr).toContain('MIMIR_VIEWER_ROOT has no viewer.html')
  }, T)

  test('the browser is full Chrome in new headless mode with GPU WebGL (not SwiftShader)', async () => {
    const browser = await launchChrome({ env: ENV })
    try {
      expect(browsersRunning().length).toBeGreaterThan(0)
      const page = await browser.newPage(320, 200, 1)
      const info = await page.evaluate<{ renderer: string }>(`(() => {
        const gl = document.createElement('canvas').getContext('webgl');
        const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
        return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'none' };
      })()`)
      expect(info.renderer).not.toBe('none')
      if (process.platform === 'darwin') expect(info.renderer).not.toMatch(/SwiftShader/i)
      expect(pngSize(await page.screenshot())).toEqual({ width: 320, height: 200 })
    } finally {
      await browser.close()
    }
  }, T)
})

describe('mimir open', () => {
  test('--no-open serves the page and the scene, and emits an SSE reload when the scene file changes', async () => {
    const dir = freshDir()
    copyFileSync(scene('clean'), join(dir, 'clean.scene.js'))
    const proc = Bun.spawn([BIN, 'open', join(dir, 'clean.scene.js'), '--no-open', '--port', '0'], { cwd: dir, env: ENV, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    try {
      const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader()
      const first = new TextDecoder().decode((await reader.read()).value)
      reader.releaseLock()
      const info = JSON.parse(first) as { url: string; port: number; scene: string }
      expect(info.url).toBe(`http://127.0.0.1:${info.port}/viewer.html?scene=%2Fscene%2Fclean.scene.js`)
      expect(info.scene).toBe(join(dir, 'clean.scene.js'))
      const origin = new URL(info.url).origin

      const page = await fetch(info.url)
      expect(page.status).toBe(200)
      const html = await page.text()
      expect(html).toContain('<title>Mimir stub viewer</title>')
      expect(html).toContain('new EventSource("/events")') // the dev server's reload client
      expect((await fetch(`${origin}/`)).status).toBe(200)
      expect((await fetch(`${origin}/mimir.js`)).headers.get('content-type')).toBe('text/javascript; charset=utf-8')
      expect(await (await fetch(`${origin}/scene/clean.scene.js`)).text()).toBe(readFileSync(scene('clean'), 'utf8'))
      expect((await fetch(`${origin}/scene/%2e%2e/%2e%2e/etc/passwd`)).status).toBe(404)

      const events = await fetch(`${origin}/events`)
      expect(events.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
      const sse = events.body!.getReader()
      const decoder = new TextDecoder()
      let text = decoder.decode((await sse.read()).value)
      expect(text).toContain(': connected')
      expect(text).not.toContain('event: reload')
      appendFileSync(join(dir, 'clean.scene.js'), '\n// edited\n')
      const deadline = Date.now() + 10_000
      while (!text.includes('event: reload') && Date.now() < deadline) text += decoder.decode((await sse.read()).value)
      expect(text).toContain('event: reload\ndata: {"kind":"scene","path":"clean.scene.js"}')
      // the edited file is what the server now serves
      expect(await (await fetch(`${origin}/scene/clean.scene.js`)).text()).toContain('// edited')
      await sse.cancel()

      proc.kill('SIGINT')
      expect(await proc.exited).toBe(130)
      expect(fetch(info.url)).rejects.toThrow()
    } finally {
      proc.kill('SIGKILL')
    }
  }, T)

  test('live reload for real: a browser on the page reloads when the scene is edited, and returns to the same time', async () => {
    const dir = freshDir()
    const file = join(dir, 'clean.scene.js')
    copyFileSync(scene('clean'), file)
    const proc = Bun.spawn([BIN, 'open', file, '--no-open', '--port', '0'], { cwd: dir, env: ENV, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    const browser = await launchChrome({ env: ENV })
    try {
      const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader()
      const { url } = JSON.parse(new TextDecoder().decode((await reader.read()).value)) as { url: string }
      reader.releaseLock()
      const page = await browser.newPage(800, 450, 1)
      await page.navigate(url)
      expect((await waitReady(page, 10_000, url)).title).toBe('Clean pipeline')
      await page.evaluate('window.__beforeReload = true; window.__mimir.seek(1.2)')
      await Bun.sleep(300) // the page's EventSource is connected and the watcher is armed
      writeFileSync(file, readFileSync(file, 'utf8').replace('Clean pipeline', 'Edited pipeline'))
      let state = { fresh: false, title: '', tau: -1, search: '' }
      for (let i = 0; i < 200 && !(state.fresh && state.title === 'Edited pipeline'); i++) {
        await Bun.sleep(50)
        try {
          state = JSON.parse(await page.evaluate<string>(`(async () => {
            if (window.__beforeReload || !window.__mimir) return JSON.stringify({ fresh: false, title: '', tau: -1, search: '' });
            await window.__mimir.ready;
            return JSON.stringify({ fresh: true, title: window.__mimir.info().title, tau: window.__mimir.state().tau, search: location.search });
          })()`))
        } catch {
          // the page is navigating
        }
      }
      expect(state.fresh).toBe(true) // a new document: the marker set before the edit is gone
      expect(state.title).toBe('Edited pipeline') // and it shows the edited scene
      expect(state.tau).toBeCloseTo(1.2, 3) // at the time the author was looking at
      expect(state.search).toContain('t=1.200')
    } finally {
      await browser.close()
      proc.kill('SIGINT')
      await proc.exited
    }
  }, T)

  test('text form prints just the URL', async () => {
    const proc = Bun.spawn([BIN, 'open', scene('clean'), '--no-open', '--port', '0', '--text'], { cwd: WORK, env: ENV, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    try {
      const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader()
      const first = new TextDecoder().decode((await reader.read()).value)
      reader.releaseLock()
      expect(first).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/viewer\.html\?scene=%2Fscene%2Fclean\.scene\.js\n$/)
    } finally {
      proc.kill('SIGINT')
      await proc.exited
    }
  }, T)
})

describe('mimir export', () => {
  test('one self-contained file that runs from file:// with no network', async () => {
    const out = join(freshDir(), 'demo.html')
    const r = await mimir(['export', scene('demo'), '-o', out])
    expect(r.code).toBe(0)
    const result = JSON.parse(r.stdout)
    expect(result).toMatchObject({ path: out, verified: true, skipped: [], warnings: [] })
    expect(result.modules.sort()).toEqual(['/mimir.3d.js', '/mimir.js', '/scene/demo.scene.js'])
    const html = readFileSync(out, 'utf8')
    expect(result.bytes).toBe(Buffer.byteLength(html))
    expect(html).toContain(`http-equiv="Content-Security-Policy" content="default-src 'none'`)
    expect(html).toContain("connect-src 'none'")
    expect(html).not.toMatch(/https?:\/\/127\.0\.0\.1/)
    expect(html).not.toContain('<link')
    expect(html).not.toMatch(/<script[^>]+\bsrc=/)
    expect(html).toContain('Stub engine') // the scene source is inside
    expect(html).toContain('stub-3d-chunk') // and the 3D chunk it needs

    // open it the way a user would: from file://, in a fresh browser, watching every request it makes
    const browser = await launchChrome({ env: ENV })
    try {
      const page = await browser.newPage(1280, 720, 1)
      const requests: string[] = []
      browser.cdp.on((e) => {
        if (e.method === 'Network.requestWillBeSent' && e.sessionId === page.sessionId) requests.push(String(e.params.request.url))
      })
      await page.send('Network.enable')
      await page.navigate(pathToFileURL(out).href)
      const info = await waitReady(page, 10_000, out)
      expect(info.fatal).toBeNull()
      expect(info.title).toBe('Stub engine')
      expect(info.steps.map((s) => s.title)).toEqual(['Intake', 'Compression', 'Power'])
      expect(requests.length).toBeGreaterThan(0)
      for (const url of requests) expect(url).toMatch(/^(file:|blob:|data:)/)
      expect(requests.filter((u) => u.startsWith('file:')).length).toBe(1)
      // it renders: the frame at t=3 is not the frame at t=0
      await page.evaluate('window.__mimir.seek(0)')
      await page.evaluate('window.__mimir.frame()')
      const a = sha256Hex(await page.screenshot())
      await page.evaluate('window.__mimir.seek(3)')
      await page.evaluate('window.__mimir.frame()')
      const b = sha256Hex(await page.screenshot())
      expect(a).not.toBe(b)
    } finally {
      await browser.close()
    }
  }, T)

  test('a 2D scene does not carry the 3D chunk', async () => {
    const out = join(freshDir(), 'clean.html')
    const r = await mimir(['export', scene('clean'), '-o', out])
    expect(r.code).toBe(0)
    const result = JSON.parse(r.stdout)
    expect(result.modules.sort()).toEqual(['/mimir.js', '/scene/clean.scene.js'])
    expect(result.skipped).toEqual(['/mimir.3d.js'])
    expect(result.verified).toBe(true)
    const html = readFileSync(out, 'utf8')
    expect(html).not.toContain('stub-3d-chunk')
    expect(html).toContain('Clean pipeline')
  }, T)

  test('a scene with relative imports: served by the dev server, embedded by export', async () => {
    const checked = await mimir(['check', scene('modular')])
    expect(checked.code).toBe(0)
    const shots = manifestOf(await mimir(['shot', '--json', scene('modular'), '--out', freshDir()]))
    expect(shots.map((e) => e.title)).toEqual(['Fetch', 'Decode', 'Execute'])
    const out = join(freshDir(), 'modular.html')
    const r = await mimir(['export', scene('modular'), '-o', out])
    expect(r.code).toBe(0)
    const result = JSON.parse(r.stdout)
    expect(result.modules.sort()).toEqual(['/mimir.js', '/scene/lib/steps.js', '/scene/modular.scene.js'])
    expect(result.verified).toBe(true)
    const html = readFileSync(out, 'utf8')
    expect(html).toContain('steps-helper-module')
    expect(html).toContain(`from 'mimir-export/scene/lib/steps.js'`)
  }, T)

  test('an export that does not work from file:// is refused: exit 2, no file under the requested name', async () => {
    // a viewer that needs the network at run time (a fetch the export policy blocks)
    const viewer = freshDir()
    for (const f of readdirSync(STUB)) copyFileSync(join(STUB, f), join(viewer, f))
    const runtime = readFileSync(join(viewer, 'mimir.js'), 'utf8')
    const marker = "    const mod = await import(url.href)\n"
    expect(runtime).toContain(marker)
    writeFileSync(join(viewer, 'mimir.js'), runtime.replace(marker, marker + "    await (await fetch(new URL('./viewer.css', location.href))).text()\n"))
    const out = join(freshDir(), 'needs-network.html')
    const ok = await mimir(['check', scene('clean')], { env: { MIMIR_VIEWER_ROOT: viewer } })
    expect(ok.code).toBe(0) // fine on the dev server
    const r = await mimir(['export', scene('clean'), '-o', out], { env: { MIMIR_VIEWER_ROOT: viewer } })
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('the export does not run from file://')
    expect(r.stderr).toContain(`the failing file was kept at ${out}.unverified.html`)
    expect(r.stdout).toBe('')
    expect(existsSync(out)).toBe(false)
    expect(existsSync(`${out}.unverified.html`)).toBe(true)
  }, T)

  test('missing -o and a broken scene', async () => {
    const a = await mimir(['export', scene('demo')])
    expect(a.code).toBe(2)
    expect(a.stderr).toContain('missing -o <out.html>')
    const out = join(freshDir(), 'broken.html')
    const b = await mimir(['export', scene('broken'), '-o', out], { cwd: SCENES })
    expect(b.code).toBe(1)
    expect(b.stderr).toContain('RUNTIME-ERROR error | broken.scene.js:5')
    expect(existsSync(out)).toBe(false)
  }, T)
})

describe('mimir docs, query, new, help, launcher', () => {
  const TYPES = join(ROOT, 'tests', 'unit', 'cli', 'fixtures', 'sample.d.ts.txt')

  test('docs: a missing reference file says so and exits 2', async () => {
    const r = await mimir(['docs', 'box'], { env: { MIMIR_TYPES: join(WORK, 'nope.d.ts') } })
    expect(r.code).toBe(2)
    expect(r.stderr).toContain(`the typed reference is missing: ${join(WORK, 'nope.d.ts')}`)
    expect(r.stdout).toBe('')
  }, T)

  test('docs: symbol → JSDoc + declaration (plain text even when piped); no argument → the names', async () => {
    const none = freshDir() // no example scenes, no guides: the reference alone
    const sym = await mimir(['docs', 'Scene.step'], { env: { MIMIR_TYPES: TYPES, MIMIR_EXAMPLES: none, MIMIR_TOPICS: none } })
    expect(sym.code).toBe(0)
    expect(sym.stdout).toBe('/** Add a step to the story. */\nstep(title: string, build: (st: Step) => void): void\n')
    const list = await mimir(['docs'], { env: { MIMIR_TYPES: TYPES } })
    expect(list.code).toBe(0)
    expect(list.stdout).toContain('2d: text rect BLUE\n')
    expect(list.stdout).toContain('Scene.: param step t\n')
    const topic = await mimir(['docs', '2d'], { env: { MIMIR_TYPES: TYPES } })
    expect(topic.stdout.split('\n')[0]).toBe('# 2d')
    const json = await mimir(['docs', 'box', '--json'], { env: { MIMIR_TYPES: TYPES } })
    expect(JSON.parse(json.stdout).entries[0]).toMatchObject({ name: 'box', kind: 'function', topic: '3d' })
    const miss = await mimir(['docs', 'sprng'], { env: { MIMIR_TYPES: TYPES } })
    expect(miss.code).toBe(2)
    expect(miss.stderr).toContain('no symbol or topic "sprng"')
    expect(miss.stderr).toContain('did you mean kit.spring?')
  }, T)

  test('--help, <cmd> --help and --version print to stdout and exit 0', async () => {
    const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version as string
    const v = await mimir(['--version'])
    expect(v).toEqual({ code: 0, stdout: `${version}\n`, stderr: '' })
    const h = await mimir(['--help'])
    expect(h.code).toBe(0)
    for (const c of ['check', 'shot', 'open', 'export', 'docs', 'examples', 'init', 'query', 'new']) expect(h.stdout).toContain(`  ${c} `)
    expect((await mimir([])).stdout).toBe(h.stdout)
    for (const c of ['check', 'shot', 'open', 'export', 'docs', 'examples', 'init', 'query', 'new']) {
      const r = await mimir([c, '--help'])
      expect(r.code).toBe(0)
      expect(r.stdout).toStartWith(`mimir ${c} - `)
      expect(r.stdout).toContain(`usage: mimir ${c}`)
      expect(r.stderr).toBe('')
    }
  }, T)

  test('unknown command, missing scene file: exit 2 with a message on stderr, nothing on stdout', async () => {
    const a = await mimir(['chek', 'x.js'])
    expect(a).toMatchObject({ code: 2, stdout: '' })
    expect(a.stderr).toContain('unknown command "chek"; did you mean check?')
    const b = await mimir(['check', 'nope.scene.js'])
    expect(b).toMatchObject({ code: 2, stdout: '' })
    expect(b.stderr).toContain('scene file not found: nope.scene.js')
  }, T)

  test('the launcher works from any directory, through symlinks, and refuses to recurse', async () => {
    const dir = freshDir()
    symlinkSync(BIN, join(dir, 'mimir'))
    symlinkSync('mimir', join(dir, 'mimir-again'))
    const viaLink = Bun.spawnSync([join(dir, 'mimir-again'), '--version'], { cwd: '/', env: ENV })
    expect(viaLink.exitCode).toBe(0)
    expect(viaLink.stdout.toString()).toMatch(/^\d+\.\d+\.\d+\n$/)
    const onPath = Bun.spawnSync([Bun.which('sh') ?? 'sh', '-c', 'mimir --version'], { cwd: tmpdir(), env: { ...ENV, PATH: `${dir}${delimiter}${ENV.PATH}` } })
    expect(onPath.exitCode).toBe(0)
    expect(onPath.stdout.toString()).toBe(viaLink.stdout.toString())
    const looping = Bun.spawnSync([BIN, '--version'], { cwd: dir, env: { ...ENV, MIMIR_LAUNCH_DEPTH: '8' } })
    expect(looping.exitCode).toBe(2)
    expect(looping.stderr.toString()).toContain('the launcher is calling itself')
    // a relative scene path is resolved against the caller's working directory
    const rel = await mimir(['check', 'clean.scene.js'], { cwd: SCENES })
    expect(rel.code).toBe(0)
  }, T)
})
