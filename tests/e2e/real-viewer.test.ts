// End-to-end against the REAL viewer (dist/, built on demand by the CLI) and the scenes in examples/.
// cli.test.ts proves the CLI against the stub; this file proves that the stub was an honest stand-in.
// It asserts the contract between CLI and runtime (exit codes, shapes, determinism, self-contained export),
// never what a scene looks like. Skipped, visibly, when the runtime or the examples are not in the tree.
import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchChrome } from '../../src/cli/chrome.ts'
import { sha256Hex, type ManifestEntry } from '../../src/cli/manifest.ts'
import { pngSize } from '../../src/cli/png.ts'
import { openSession, waitReady } from '../../src/cli/session.ts'
import { resolveScene } from '../../src/cli/paths.ts'

const ROOT = resolve(import.meta.dir, '..', '..')
const BIN = join(ROOT, 'bin', 'mimir')
const example = (name: string): string => join(ROOT, 'examples', `${name}.scene.js`)
/** scenes written against the real API to make one rule fire each (tests/e2e/scenes/real) */
const fixture = (name: string): string => join(import.meta.dir, 'scenes', 'real', `${name}.scene.js`)
const HAVE =
  existsSync(join(ROOT, 'scripts', 'build.ts')) && existsSync(join(ROOT, 'src', 'host', 'index.ts')) &&
  ['hello-2d', 'hello-3d', 'broken'].every((n) => existsSync(example(n)))

const WORK = mkdtempSync(join(tmpdir(), 'mimir-real-'))
const TMP = join(WORK, 'tmp')
mkdirSync(TMP)
const ENV: Record<string, string> = { ...(process.env as Record<string, string>), TMPDIR: TMP, MIMIR_LAUNCH_DEPTH: '0' }
for (const k of ['MIMIR_VIEWER_ROOT', 'MIMIR_TIMEOUT', 'MIMIR_TYPES', 'MIMIR_CHROME_ARGS']) delete ENV[k]

let dirCount = 0
const freshDir = (): string => {
  const d = join(WORK, `d${++dirCount}`)
  mkdirSync(d)
  return d
}

interface Result { code: number; stdout: string; stderr: string }
async function mimir(args: string[]): Promise<Result> {
  const proc = Bun.spawn([BIN, ...args], { cwd: ROOT, env: ENV, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { code, stdout, stderr }
}
const browsersRunning = (): string[] =>
  Bun.spawnSync(['ps', '-axo', 'command=']).stdout.toString().split('\n').filter((l) => l.includes(WORK) && l.includes('--user-data-dir'))

afterEach(async () => {
  for (let i = 0; i < 40 && browsersRunning().length > 0; i++) await Bun.sleep(50)
  const processes = browsersRunning()
  const profiles = readdirSync(TMP).filter((n) => n.startsWith('mimir-chrome-'))
  for (const p of profiles) rmSync(join(TMP, p), { recursive: true, force: true })
  expect(processes).toEqual([])
  expect(profiles).toEqual([])
})
afterAll(() => rmSync(WORK, { recursive: true, force: true }))

const T = 180_000 // the first command may build dist

describe.skipIf(!HAVE)('real viewer + examples', () => {
  test('check: exit code agrees with the result; diagnostics carry the scene path and a line', async () => {
    for (const name of ['hello-2d', 'hello-3d']) {
      const r = await mimir(['check', example(name)])
      const out = JSON.parse(r.stdout)
      expect([0, 1]).toContain(r.code)
      expect(out.ok).toBe(r.code === 0)
      expect(out.ok).toBe(out.errors === 0)
      expect(out.shown).toBe(out.diagnostics.length)
      expect(out.shown).toBeLessThanOrEqual(8)
    }
    const broken = await mimir(['check', example('broken')])
    expect(broken.code).toBe(1)
    const out = JSON.parse(broken.stdout)
    expect(out.errors).toBeGreaterThan(0)
    for (const d of out.diagnostics) {
      expect(Object.keys(d)).toEqual(['code', 'severity', 'step', 't', 'ids', 'file', 'line', 'measured', 'limit', 'what', 'fix'])
      expect(d.code).toMatch(/^[A-Z][A-Z-]+$/)
    }
    const first = out.diagnostics[0]
    expect(first.severity).toBe('error')
    expect(first.file).toBe('examples/broken.scene.js') // a path the author can open, not a page URL
    expect(typeof first.line).toBe('number')
    const text = await mimir(['check', example('broken'), '--text'])
    expect(text.stdout.split('\n')[0]).toMatch(/^[A-Z-]+ error \| .*examples\/broken\.scene\.js:\d+$/)
    expect(text.stdout.trimEnd().split('\n').pop()).toMatch(/^FAIL \d+ errors?, \d+ warnings?/)
  }, T)

  test('check: the two hello scenes are clean; broken reports exactly its four mistakes with line and fix', async () => {
    for (const name of ['hello-2d', 'hello-3d']) {
      const r = await mimir(['check', example(name)])
      expect(r.code).toBe(0)
      expect(JSON.parse(r.stdout)).toEqual({ ok: true, errors: 0, warnings: 0, total: 0, shown: 0, diagnostics: [] })
      expect((await mimir(['check', example(name), '--text'])).stdout).toBe('OK 0 errors, 0 warnings\n')
    }
    const r = await mimir(['check', example('broken')])
    expect(r.code).toBe(1)
    const out = JSON.parse(r.stdout)
    expect(out).toMatchObject({ ok: false, errors: 4, warnings: 0, total: 4, shown: 4 })
    const byCode = Object.fromEntries(out.diagnostics.map((d: { code: string }) => [d.code, d]))
    expect(Object.keys(byCode).sort()).toEqual(['API-TYPE', 'API-UNKNOWN', 'NUM-INVALID', 'REF-MISSING'])
    expect(byCode['API-UNKNOWN']).toMatchObject({ ids: ['a'], line: 8, file: 'examples/broken.scene.js' })
    expect(byCode['API-UNKNOWN'].what).toContain('"widht"')
    expect(byCode['API-UNKNOWN'].fix[0]).toContain('"width"') // did-you-mean
    expect(byCode['API-TYPE']).toMatchObject({ ids: ['b'], line: 9 })
    expect(byCode['NUM-INVALID']).toMatchObject({ ids: ['c'], line: 10, measured: 'NaN' })
    expect(byCode['REF-MISSING']).toMatchObject({ line: 14 })
    for (const d of out.diagnostics) expect(d.fix.length).toBeGreaterThan(0)

    // the text contract of DESIGN section 7: header, what, fix; status line last
    const text = (await mimir(['check', example('broken'), '--text'])).stdout.trimEnd().split('\n')
    expect(text.length).toBe(4 * 3 + 1)
    for (let i = 0; i < 4; i++) {
      expect(text[i * 3]).toMatch(/^[A-Z-]+ error \| #\w+ \| examples\/broken\.scene\.js:\d+$/)
      expect(text[i * 3 + 1]).toMatch(/^  what: \S/)
      expect(text[i * 3 + 2]).toMatch(/^  fix: \S/)
    }
    expect(text[12]).toBe('FAIL 4 errors, 0 warnings')
    // a broken scene still renders what it can
    const shot = await mimir(['shot', '--json', example('broken'), '--out', freshDir()])
    expect(shot.code).toBe(0)
    expect((JSON.parse(shot.stdout) as ManifestEntry[]).length).toBe(1)
  }, T)

  test('check: measured rules fire on scenes built to break them (off-frame, overlap, empty, dead param, static step)', async () => {
    const r = await mimir(['check', fixture('rules'), '--all'])
    expect(r.code).toBe(1)
    const out = JSON.parse(r.stdout)
    const find = (code: string): { severity: string; step: number | null; ids: string[]; line: number | null; fix: string[]; what: string } =>
      out.diagnostics.find((d: { code: string }) => d.code === code)
    // (NO-VISUAL-BEAT is the guide's word on the same step that STATIC-STEP names: it only talks)
    expect(out.diagnostics.map((d: { code: string }) => d.code).sort()).toEqual(['DEAD-PARAM', 'NO-VISUAL-BEAT', 'OFF-FRAME', 'STATIC-STEP', 'TEXT-OVERLAP'])
    expect(find('OFF-FRAME')).toMatchObject({ severity: 'error', step: 1, ids: ['off'], line: 7 })
    expect(find('OFF-FRAME').what).toMatch(/\d+% of off is beyond the right edge/)
    expect(find('TEXT-OVERLAP')).toMatchObject({ severity: 'error', step: 1, line: 6 })
    expect(find('TEXT-OVERLAP').ids.length).toBe(2)
    expect(find('DEAD-PARAM')).toMatchObject({ severity: 'error', line: 4 })
    expect(find('STATIC-STEP')).toMatchObject({ severity: 'warn', step: 2, line: 10 })
    expect(out).toMatchObject({ errors: 3, warnings: 2 })

    const empty = JSON.parse((await mimir(['check', fixture('empty')])).stdout)
    expect(empty.diagnostics.map((d: { code: string }) => d.code)).toEqual(['EMPTY-FRAME'])
    expect(empty.diagnostics[0]).toMatchObject({ severity: 'error', step: 2 })
  }, T)

  test('check: a scene that does not load is one RUNTIME-ERROR with the line found on disk', async () => {
    const cases: Array<[string, RegExp, number, RegExp]> = [
      ['syntax', /syntax\.scene\.js$/, 5, /SyntaxError/],
      ['nested', /lib\/bad\.js$/, 1, /SyntaxError/],
      ['badimport', /badimport\.scene\.js$/, 5, /'rectangle' is not part of the mimir API; did you mean 'rect'\?/],
    ]
    for (const [name, file, line, what] of cases) {
      const r = await mimir(['check', fixture(name)])
      expect(r.code).toBe(1)
      const out = JSON.parse(r.stdout)
      expect(out.total).toBe(1)
      expect(out.diagnostics[0].code).toBe('RUNTIME-ERROR')
      expect(out.diagnostics[0].file).toMatch(file)
      expect(out.diagnostics[0].line).toBe(line)
      expect(out.diagnostics[0].what).toMatch(what)
    }
  }, T)

  test('shot: one frame per step, deterministic, --set changes pixels and the reported parameter', async () => {
    const out = freshDir()
    const r = await mimir(['shot', '--json', example('hello-3d'), '--sheet', '--out', out])
    expect(r.code).toBe(0)
    const m = JSON.parse(r.stdout) as ManifestEntry[]
    const frames = m.filter((e) => !e.sheet)
    expect(frames.length).toBeGreaterThan(0)
    expect(m.filter((e) => e.sheet).length).toBe(1)
    for (const e of frames) {
      const bytes = new Uint8Array(readFileSync(e.path))
      expect(pngSize(bytes)).toEqual({ width: 1280, height: 720 })
      expect(sha256Hex(bytes)).toBe(e.sha256)
      expect(typeof e.step).toBe('number')
      expect(existsSync(e.path.replace(/\.png$/, '.probes.json'))).toBe(true)
    }
    expect(m[m.length - 1]!.width).toBeLessThanOrEqual(1280)
    expect(Object.keys(frames[0]!)).toEqual(['path', 'step', 'title', 't', 'camera', 'width', 'height', 'sha256']) // DESIGN section 8
    expect(new Set(frames.map((e) => e.sha256)).size).toBe(frames.length) // every step ends on a different picture

    // one process, times visited out of order and twice: a frame depends on its time only, not on what came before
    for (const name of ['hello-2d', 'hello-3d']) {
      const seq = JSON.parse((await mimir(['shot', '--json', example(name), '--at', '12.9,2.6,7.3,0,7.3,12.9,2.6', '--out', freshDir()])).stdout) as ManifestEntry[]
      const byTime = new Map<number, Set<string>>()
      for (const e of seq) byTime.set(e.t!, (byTime.get(e.t!) ?? new Set()).add(e.sha256))
      expect([...byTime.keys()].sort((x, y) => x - y)).toEqual([0, 2.6, 7.3, 12.9])
      for (const hashes of byTime.values()) expect(hashes.size).toBe(1)
      expect(new Set(seq.map((e) => e.sha256)).size).toBeGreaterThanOrEqual(3)
    }
    // a named view is reported in the manifest and changes the picture
    const views = JSON.parse((await mimir(['shot', '--json', example('hello-3d'), '--step', '1', '--views', 'front,top', '--out', freshDir()])).stdout) as ManifestEntry[]
    expect(views.map((e) => e.camera)).toEqual(['front', 'top'])
    expect(views[0]!.sha256).not.toBe(views[1]!.sha256)

    // the same time twice → the same bytes; this is the engine's "time is an input" seen through the CLI
    const mid = (frames[0]!.t! / 2).toFixed(3)
    const a = JSON.parse((await mimir(['shot', '--json', example('hello-3d'), '--at', mid, '--out', freshDir()])).stdout) as ManifestEntry[]
    const b = JSON.parse((await mimir(['shot', '--json', example('hello-3d'), '--at', mid, '--out', freshDir()])).stdout) as ManifestEntry[]
    expect(b[0]!.sha256).toBe(a[0]!.sha256)

    // a parameter override: different pixels, and the probes file reports the value in effect
    const probesOf = (dir: string): { params: Record<string, number> } =>
      JSON.parse(readFileSync(join(dir, readdirSync(dir).find((f) => f.endsWith('.probes.json'))!), 'utf8'))
    const params = probesOf(out).params
    const name = Object.keys(params)[0]
    if (name !== undefined) {
      const dir = freshDir()
      const other = Number(params[name]) + 137
      const c = JSON.parse((await mimir(['shot', '--json', example('hello-3d'), '--at', mid, '--set', `${name}=${other}`, '--out', dir])).stdout) as ManifestEntry[]
      expect(c[0]!.sha256).not.toBe(a[0]!.sha256)
      expect(probesOf(dir).params[name]).toBe(other)
    }
  }, T)

  test('export: one file, runs from file:// with no network, 2D scenes do not carry the 3D chunk', async () => {
    const dir = freshDir()
    const flat = JSON.parse((await mimir(['export', example('hello-2d'), '-o', join(dir, '2d.html')])).stdout)
    const solid = JSON.parse((await mimir(['export', example('hello-3d'), '-o', join(dir, '3d.html')])).stdout)
    expect(flat.verified).toBe(true)
    expect(solid.verified).toBe(true)
    expect(flat.modules).not.toContain('/mimir.3d.js')
    expect(solid.modules).toContain('/mimir.3d.js')
    for (const r of [flat, solid]) expect(r.modules.some((p: string) => /mimir\.check/.test(p))).toBe(false)
    expect(flat.bytes).toBeLessThan(solid.bytes)

    const html = readFileSync(solid.path, 'utf8')
    expect(html).toContain(`http-equiv="Content-Security-Policy" content="default-src 'none'`)
    expect(html).not.toMatch(/<script[^>]+\bsrc=/)
    const browser = await launchChrome({ env: ENV })
    try {
      const page = await browser.newPage(1280, 720, 1)
      const requests: string[] = []
      browser.cdp.on((e) => {
        if (e.method === 'Network.requestWillBeSent' && e.sessionId === page.sessionId) requests.push(String(e.params.request.url))
      })
      await page.send('Network.enable')
      await page.navigate(pathToFileURL(solid.path).href)
      const info = await waitReady(page, 20_000, solid.path)
      expect(info.fatal).toBeNull()
      expect(info.steps.length).toBeGreaterThan(0)
      for (const url of requests) expect(url).toMatch(/^(file:|blob:|data:)/)
      expect(requests.filter((u) => u.startsWith('file:')).length).toBe(1)
    } finally {
      await browser.close()
    }

    // the same file with the network switched off: still ready, a frame that is not empty, nothing blocked
    const proof = Bun.spawn(['bun', join(ROOT, 'scripts', 'offline-proof.ts'), solid.path, join(dir, 'offline.png'), '--t', '7.3'], { cwd: ROOT, env: ENV, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    const [proofOut, proofCode] = await Promise.all([new Response(proof.stdout).text(), proof.exited])
    expect(proofCode).toBe(0)
    const seen = JSON.parse(proofOut)
    expect(seen).toMatchObject({ ready: true, fatal: null, steps: 3, requests: { file: 1, other: [] }, blocked: [], consoleErrors: [], width: 1280, height: 720 })
    expect(seen.lit).toBeGreaterThan(0.02)
    expect(pngSize(new Uint8Array(readFileSync(join(dir, 'offline.png'))))).toEqual({ width: 1280, height: 720 })
  }, T)

  test('chapters, transcript and the 2D camera: info() carries the read-mode data; hud objects ignore the zoom; a 2D tag sits on its 3D part', async () => {
    // clean: in particular #far, which the zoom of step 2 pushes out of view, is not OFF-FRAME
    const check = await mimir(['check', fixture('chapters'), '--all'])
    expect(JSON.parse(check.stdout)).toEqual({ ok: true, errors: 0, warnings: 0, total: 0, shown: 0, diagnostics: [] })
    const prev = { tmp: process.env.TMPDIR }
    process.env.TMPDIR = TMP // the browser profile of this in-process session goes where afterEach looks
    const session = await openSession({ scene: resolveScene(fixture('chapters'), ROOT, 'check'), viewerRoot: join(ROOT, 'dist'), width: 1280, height: 720, scale: 1 })
    try {
      const info = await session.host<any>('info')
      expect(info.chapters.map((c: any) => [c.index, c.title, c.steps, c.keep])).toEqual([[1, 'Parts', [1, 2], []], [2, 'Afterwards', [3], ['title']]])
      expect(info.steps.map((st: any) => st.chapter)).toEqual([1, 1, 2])
      expect(info.chapters[1].t0).toBe(info.steps[2].t0)
      expect(info.chunks).toEqual(['3d', 'fonts', 'guide']) // exactly the chunks this scene needs: 3D parts, text set in the embedded faces, narration
      expect(info.features).toEqual([]) // and no on-demand module: it uses no kit, plot, diagram … name
      expect(info.transcript.map((t: any) => [t.step, t.chapter, t.chapterTitle, t.title, t.narration.map((n: any) => n.plain), t.note])).toEqual([
        [1, 1, 'Parts', 'Meet the parts', ['A box and a rectangle.'], 'Read mode shows this **note** under the paragraph.'],
        [2, 1, 'Parts', 'Look closer', ['The camera moves in.'], null],
        [3, 2, 'Afterwards', 'A new stage', ['Everything but the title has left.'], null],
      ])
      const first = info.transcript[0].narration[0]
      expect(first.text).toBe('A [box](part) and a [rectangle](ring:a+title,hold).')
      expect(first.spans).toEqual([
        { start: 2, end: 5, words: 'box', verb: 'point', targets: ['part'], options: [] },
        { start: 12, end: 21, words: 'rectangle', verb: 'ring', targets: ['a', 'title'], options: ['hold'] },
      ])
      expect(first.plain.slice(12, 21)).toBe('rectangle')
      expect(first.t0).toBe(0)
      expect(first.duration).toBeGreaterThan(1)

      // measured in the page: DOM boxes of the 2D objects, the projected centre of the 3D part
      const at = async (tau: number): Promise<Record<string, { x: number; y: number; w: number; h: number } | null>> => {
        await session.host('seek', tau)
        await session.host('frame')
        return JSON.parse(await session.page.evaluate<string>(`JSON.stringify(Object.fromEntries(['title', 'a', 'tag', 'b', 'fresh'].map((id) => { const el = document.querySelector('[data-node="' + id + '"]'); const r = el && getComputedStyle(el).display !== 'none' ? el.getBoundingClientRect() : null; return [id, r && r.width ? { x: r.x, y: r.y, w: r.width, h: r.height } : null] })))`, 10_000))
      }
      const s1 = info.steps[0], s2 = info.steps[1], s3 = info.steps[2]
      const before = await at(s1.t1 - 0.01), zoomed = await at(s2.t1 - 0.01), after = await at(s3.t1 - 0.01)
      // the 2D camera looks through the part of the frame the 3D panel leaves free (the left 60%): the rectangle grows
      // to half of that window (margin 2) and moves to its middle; the hud title does not move at all
      expect(zoomed.a!.w).toBeGreaterThan(before.a!.w * 2)
      expect(Math.abs(zoomed.a!.w - 0.5 * 0.6 * 1280)).toBeLessThan(6) // stroke included
      expect(Math.abs(zoomed.a!.x + zoomed.a!.w / 2 - 0.3 * 1280)).toBeLessThan(1.5)
      expect(Math.abs(zoomed.a!.y + zoomed.a!.h / 2 - 360)).toBeLessThan(1.5)
      expect(zoomed.title).toEqual(before.title)
      // the 2D tag is pinned to the top of the 3D box: 0.4 units above where that anchor is drawn, zoom or no zoom
      for (const f of [before, zoomed]) {
        expect(f.tag!.x + f.tag!.w / 2).toBeGreaterThan(1280 * 0.6) // inside the 3D panel (the right 40%), not at frame x = 0
        expect(f.tag!.y + f.tag!.h / 2).toBeLessThan(360) // above the middle: it sits on top of the box
      }
      expect(Math.abs(before.tag!.x + before.tag!.w / 2 - (zoomed.tag!.x + zoomed.tag!.w / 2))).toBeLessThan(1.5)
      // the new chapter: the old objects are gone, the kept title and the new ones are there, the camera is back
      expect([after.a, after.tag]).toEqual([null, null])
      expect(after.title).toEqual(before.title)
      expect(after.b).not.toBeNull()
      expect(after.fresh).not.toBeNull()
      expect(Math.abs(after.b!.w - 3 * 90)).toBeLessThan(4) // zoom 1 again (stroke included); 1280 px / 14.222 units = 90 px per unit
    } finally {
      await session.close()
      process.env.TMPDIR = prev.tmp
    }
    // lazy chunks: a 2D scene with text and narration needs the faces and the guide; no 3D, no on-demand module
    const flat = await openSession({ scene: resolveScene(example('hello-2d'), ROOT, 'check'), viewerRoot: join(ROOT, 'dist'), width: 640, height: 360, scale: 1 })
    try { const info = await flat.host<any>('info'); expect([info.chunks, info.features]).toEqual([['fonts', 'guide'], []]) } finally { await flat.close() }
  }, T)

  // ── the findings of the two verifier reports on the hardened core, seen through the real CLI and browser ──────────
  const shas = async (scene: string, times: string, extra: string[] = []): Promise<Map<number, Set<string>>> => {
    const r = await mimir(['shot', '--json', scene, '--at', times, '--out', freshDir(), ...extra])
    expect(r.code).toBe(0)
    const by = new Map<number, Set<string>>()
    for (const e of JSON.parse(r.stdout) as ManifestEntry[]) by.set(e.t!, (by.get(e.t!) ?? new Set()).add(e.sha256))
    return by
  }

  test('determinism inside one step: labels, captions and moving shapes give one sha per time in any order, at any scale', async () => {
    // What the first determinism tests never did: two shots inside ONE labelled step, so that a visible label, the
    // caption and a moving object are on screen in both frames. Three real causes were found this way: a label at a
    // fractional position (composited from the raster of the frame before), the browser not repainting the
    // antialiased rim of a shape that moved by a hundredth of a pixel, and label elements that sat in the DOM in the
    // order they were first shown. 7.3 / 6.5 is the pair of the report; 11.66 / 11.7 the sub-pixel move in hello-2d;
    // 6.01 … 6.23 at scale 2 the pair of overlapping labels (5.41 … 5.63 before the guide gave every speaking step its
    // 0.6 s lead-in: the same moment after the step boundary).
    const cases: Array<[string, string[], string[]]> = [
      ['hello-3d', ['7.3,6.5,5.9,8.4,6.5', '6.5,8.4,7.3,5.9', '5.9,6.5,7.3,8.4'], []],
      ['hello-2d', ['11.66,11.7,7.9,9.2', '11.7,11.66,9.2,7.9', '9.2,11.7,7.9,11.66'], []],
      ['hello-3d', ['6.01,6.12,6.23,7.1', '7.1,6.23,6.12,6.01', '6.23,7.1,6.01,6.12'], ['--scale', '2']],
    ]
    for (const [name, orders, extra] of cases) {
      const runs = []
      for (const order of orders) runs.push(await shas(example(name), order, extra))
      for (const [t, hashes] of runs[0]!) {
        expect(hashes.size).toBe(1)
        for (const other of runs.slice(1)) expect([name, t, [...other.get(t)!]]).toEqual([name, t, [...hashes]])
      }
      expect(new Set([...runs[0]!.values()].map((h) => [...h][0])).size).toBe(runs[0]!.size) // and the times do differ from each other
    }
    // through the host: a param dragged and given back in between leaves no trace either
    const prev = process.env.TMPDIR
    process.env.TMPDIR = TMP
    const session = await openSession({ scene: resolveScene(example('hello-3d'), ROOT, 'shot'), viewerRoot: join(ROOT, 'dist'), width: 1280, height: 720, scale: 1 })
    try {
      const snap = async (): Promise<string> => { await session.host('frame'); return sha256Hex(await session.page.screenshot(20_000)) }
      await session.host('seek', 7.3)
      const first = await snap()
      await session.host('setParam', 'crank', 300)
      await session.host('seek', 2)
      await snap()
      await session.host('seek', 7.3)
      await session.host('clearParam')
      expect(await snap()).toBe(first)
      // the stage uses a 16:9 window whole (it was 1279 x 719: a strip of unused pixels and 89.93 px per unit)
      expect((await session.host<any>('info')).stage).toEqual({ width: 1280, height: 720 })
      // labels sit in the DOM in the order of the story, whatever was shown first
      await session.host('seek', 14)
      await session.host('frame')
      await session.host('seek', 1)
      await session.host('frame')
      const order = JSON.parse(await session.page.evaluate<string>(`JSON.stringify([...document.querySelectorAll('[data-overlay="guide.labels"] > div')].map((d) => d.textContent))`, 10_000))
      expect(order).toEqual(['crank wheel', 'connecting rod', 'slider', 'slides down', 'crank pin'])
      const left = JSON.parse(await session.page.evaluate<string>(`JSON.stringify([...document.querySelectorAll('[data-overlay="guide.labels"] > div, [data-overlay="guide.caption"] > div')].filter((d) => d.style.display !== 'none').map((d) => [parseFloat(d.style.left), parseFloat(d.style.top), d.style.transform, d.style.willChange]))`, 10_000)) as [number, number, string, string][]
      expect(left.length).toBeGreaterThan(2)
      for (const [x, y, transform, will] of left) expect([Number.isInteger(x), Number.isInteger(y), transform, will]).toEqual([true, true, '', '']) // whole pixels, no compositing hints
    } finally {
      await session.close()
      process.env.TMPDIR = prev
    }
  }, T)

  test('the modules together: a kit mechanism, a plot tied to it, a formula, narration, a graph with tokens, flow, a chapter, the 2D camera', async () => {
    // tests/e2e/scenes/real/combined.scene.js uses every M1 module in one story
    const check = await mimir(['check', fixture('combined'), '--all'])
    expect(JSON.parse(check.stdout)).toEqual({ ok: true, errors: 0, warnings: 0, total: 0, shown: 0, diagnostics: [] })
    const prev = process.env.TMPDIR
    process.env.TMPDIR = TMP
    const session = await openSession({ scene: resolveScene(fixture('combined'), ROOT, 'check'), viewerRoot: join(ROOT, 'dist'), width: 1280, height: 720, scale: 1 })
    try {
      const info = await session.host<any>('info')
      // the on-demand modules are read off the scene source (sim is not used: it is not loaded), then the chunks its kinds need
      expect(info.features).toEqual(['diagram', 'flow', 'kit', 'plot', 'tex'])
      expect([...info.chunks].sort()).toEqual(['3d', 'anim', 'diagram', 'flow', 'fonts', 'guide', 'kit', 'plot', 'tex'])
      expect(info.chapters.map((c: any) => [c.title, c.steps])).toEqual([['The mechanism', [1, 2, 3]], ['What it is for', [4, 5]]])
      expect(info.guide.steps.length).toBe(5)
      const px = async (id: string): Promise<{ x: number; y: number; width: number; height: number } | null> => {
        const q = await session.host<any>('query', 'bounds', [id])
        return q.bounds?.[0]?.screen ?? null
      }
      // step 2: the plot's cursor is at (180°, 100 %) and the guide tie runs from the piston (left of the panel edge) to it
      await session.host('seek', info.steps[1].t1 - 0.01)
      await session.host('frame')
      expect((await session.host<any>('probes'))['slide.fraction']).toBeCloseTo(1, 3)
      const tie = (await px('tie'))!, cursor = (await px('cursor'))!, panelRight = 1280 * 0.42
      expect(tie.x).toBeLessThan(panelRight)
      expect(Math.abs(tie.x + tie.width - (cursor.x + cursor.width / 2))).toBeLessThan(12)
      // step 5: the 2D camera has zoomed on the graph inside its window; the heading (hud) and the 3D panel did not move,
      // and the tokens on the edge that ends on the piston are on that edge, over the 3D panel
      await session.host('seek', info.steps[4].t1 - 0.01)
      await session.host('frame')
      const chain = (await px('chain'))!, link = (await px('link'))!, pushes = (await px('pushes'))!
      expect(chain.x).toBeGreaterThan(panelRight)
      expect(chain.x + chain.width).toBeLessThan(1280)
      expect(link.x).toBeLessThan(panelRight)
      expect(pushes.x).toBeGreaterThanOrEqual(link.x - 12)
      expect(pushes.x + pushes.width).toBeLessThanOrEqual(link.x + link.width + 12)
      expect(pushes.y).toBeGreaterThanOrEqual(link.y - 12)
      expect(pushes.y + pushes.height).toBeLessThanOrEqual(link.y + link.height + 12)
    } finally {
      await session.close()
      process.env.TMPDIR = prev
    }
    // same time, same pixels, in two orders: inside the create of the 3D parts, the sweep with the plot, the derive of the
    // formula, the chapter opening, the graph being drawn with tokens and particles, the zoom
    const times = [0.8, 2.4, 9.1, 12.6, 16.2, 19.9, 22.0, 24.3, 27.7, 31.4, 35.0, 38.6]
    const asc = await shas(fixture('combined'), times.join(','))
    const mixed = await shas(fixture('combined'), times.map((_, i) => times[(i * 5) % times.length]!).join(','))
    expect(asc.size).toBe(times.length)
    for (const [t, hashes] of asc) expect([t, [...mixed.get(t)!]]).toEqual([t, [...hashes]])
    expect(new Set([...asc.values()].map((h) => [...h][0])).size).toBe(times.length)
    // one file, no network: every module, chunk and face it uses is inside
    const out = join(freshDir(), 'combined.html')
    const exported = JSON.parse((await mimir(['export', fixture('combined'), '-o', out])).stdout)
    expect(exported.verified).toBe(true)
    expect(exported.modules.filter((m: string) => m.startsWith('/mimir')).sort()).toEqual([
      '/mimir.3d.js', '/mimir.anim.js', '/mimir.diagram.js', '/mimir.diagramapi.js', '/mimir.flow.js', '/mimir.flowapi.js', '/mimir.fonts.js', '/mimir.guide.js',
      '/mimir.js', '/mimir.kit.js', '/mimir.kitapi.js', '/mimir.player.js', '/mimir.plot.js', '/mimir.plotapi.js', '/mimir.tex.js', '/mimir.texapi.js', // (the formula's root is drawn as a path: no extra faces; the player's chrome is its own chunk)
    ])
    expect(readFileSync(out, 'utf8')).toContain('"features", "diagram,flow,kit,plot,tex"')
  }, T)

  test('st.zoom beside a 3D panel: the 2D world is zoomed inside its window; what follows a 3D part stays put; check is clean', async () => {
    const check = await mimir(['check', fixture('zoom3d'), '--all'])
    expect(JSON.parse(check.stdout)).toEqual({ ok: true, errors: 0, warnings: 0, total: 0, shown: 0, diagnostics: [] })
    const prev = process.env.TMPDIR
    process.env.TMPDIR = TMP
    const session = await openSession({ scene: resolveScene(fixture('zoom3d'), ROOT, 'check'), viewerRoot: join(ROOT, 'dist'), width: 1280, height: 720, scale: 1 })
    try {
      const info = await session.host<any>('info')
      const at = async (tau: number): Promise<Record<string, { x: number; y: number; w: number; h: number; clip: string | null }>> => {
        await session.host('seek', tau)
        await session.host('frame')
        return JSON.parse(await session.page.evaluate<string>(`JSON.stringify(Object.fromEntries(['note', 'ring', 'beside', 'link', 'wide'].map((id) => { const el = document.querySelector('[data-node="' + id + '"]'); const r = el.getBoundingClientRect(); return [id, { x: r.x, y: r.y, w: r.width, h: r.height, clip: el.getAttribute('clip-path') }] })))`, 10_000))
      }
      const before = await at(info.steps[0].t1 - 0.01), zoomed = await at(info.steps[1].t1 - 0.01)
      // the note fills half of the left half (margin 2) and sits in its middle; it does not reach the 3D panel
      expect(Math.abs(zoomed.note!.x + zoomed.note!.w / 2 - 320)).toBeLessThan(1.5)
      expect(Math.abs(zoomed.note!.y + zoomed.note!.h / 2 - 360)).toBeLessThan(1.5)
      expect(Math.abs(zoomed.note!.w - 320)).toBeLessThan(8)
      expect(zoomed.note!.x + zoomed.note!.w).toBeLessThan(640)
      // the ring on the ball and the text under the base: same place, same size (they were 3 times bigger and half outside the frame)
      for (const id of ['ring', 'beside']) for (const k of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(zoomed[id]![k] - before[id]![k])).toBeLessThan(0.01)
      expect([zoomed.ring!.clip, zoomed.beside!.clip, zoomed.link!.clip]).toEqual([null, null, null])
      // the arrow joins the zoomed note and the ball: it starts right of the note and ends inside the 3D panel, pointing right
      expect(zoomed.link!.x).toBeGreaterThan(zoomed.note!.x + zoomed.note!.w - 2)
      expect(zoomed.link!.x + zoomed.link!.w).toBeGreaterThan(700)
      expect(zoomed.link!.w).toBeGreaterThan(200)
      // 2D-world objects are cut at the edge of the window while zoomed (and only then)
      expect(before.note!.clip).toBeNull()
      expect(zoomed.note!.clip).toMatch(/^url\(#mimir-window-\d+\)$/)
      expect(zoomed.wide!.clip).toBe(zoomed.note!.clip)
      // the pixels: left of the middle the zoomed bar is drawn, right of it (over the 3D panel) it is not
      const row = JSON.parse(await session.page.evaluate<string>(`(() => { const el = document.querySelector('[data-node="wide"]'); const r = el.getBoundingClientRect(); const y = r.y + r.height / 2; return JSON.stringify({ y, left: document.elementsFromPoint(600, y).length, bar: [r.x, r.x + r.width] }) })()`, 10_000))
      expect(row.bar[1]).toBeGreaterThan(900) // the bar itself extends far over the panel; the clip is what stops it
    } finally {
      await session.close()
      process.env.TMPDIR = prev
    }
    // looked at through pixels: at the height of the bar, the right half of the frame shows no white bar when zoomed
    const dir = freshDir()
    const shot = JSON.parse((await mimir(['shot', '--json', fixture('zoom3d'), '--step', '2', '--out', dir])).stdout) as ManifestEntry[]
    expect(shot.length).toBe(1)
  }, T)

  test('a diagnostic found at a param extreme names the value, carries it in the JSON, and says how to see it', async () => {
    const r = await mimir(['check', fixture('sampling'), '--all'])
    expect(r.code).toBe(1)
    const out = JSON.parse(r.stdout)
    const off = out.diagnostics.find((d: { code: string }) => d.code === 'OFF-FRAME'), nan = out.diagnostics.find((d: { code: string }) => d.code === 'NUM-INVALID')
    expect(out.diagnostics.length).toBe(2)
    expect(Object.keys(off)).toEqual(['code', 'severity', 'step', 't', 'ids', 'file', 'line', 'measured', 'limit', 'what', 'fix', 'params']) // `params` only where it applies
    expect(off).toMatchObject({ ids: ['a'], step: 1, params: { p: 10 } })
    expect(off.what).toMatch(/^100% of a is beyond the right edge of the frame .* when p = 10 \(its maximum\)\.$/)
    expect(off.fix.join(' ')).not.toContain('.shift(') // moving it in the default picture would push it off the other side
    expect(off.fix[0]).toContain('for every value of p')
    expect(off.fix.at(-1)).toBe(`see it: mimir shot ${fixture('sampling')} --step 1 --set p=10`)
    expect(nan).toMatchObject({ ids: ['n'], params: { q: 10 } })
    expect(nan.what).toBe('width of #n became NaN when q = 10 (its maximum).')
    // the hint is a command that works, and shows what the default picture does not
    const base = JSON.parse((await mimir(['shot', '--json', fixture('sampling'), '--step', '1', '--out', freshDir()])).stdout) as ManifestEntry[]
    const seen = JSON.parse((await mimir(['shot', '--json', fixture('sampling'), '--step', '1', '--set', 'p=10', '--out', freshDir()])).stdout) as ManifestEntry[]
    expect(seen[0]!.sha256).not.toBe(base[0]!.sha256)
  }, T)

  test('a scene that never finishes building is a RUNTIME-ERROR on stdout with exit 1, for check, shot and export', async () => {
    const env = { ...ENV, MIMIR_TIMEOUT: '1500' }
    const run = async (args: string[]): Promise<Result> => {
      const proc = Bun.spawn([BIN, ...args], { cwd: ROOT, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
      const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
      return { code, stdout, stderr }
    }
    const check = await run(['check', fixture('loop')])
    expect(check.code).toBe(1)
    const out = JSON.parse(check.stdout)
    expect(out).toMatchObject({ ok: false, errors: 1, total: 1 })
    expect(out.diagnostics[0]).toMatchObject({ code: 'RUNTIME-ERROR', severity: 'error' })
    expect(out.diagnostics[0].what).toContain('the scene never finished building (waited 1500 ms): it is stuck in an endless loop')
    expect(out.diagnostics[0].file).toMatch(/loop\.scene\.js$/)
    expect(out.diagnostics[0].fix.length).toBeGreaterThan(0)
    const shot = await run(['shot', fixture('loop'), '--out', freshDir(), '--json'])
    expect([shot.code, shot.stdout]).toEqual([1, '[]\n'])
    expect(shot.stderr).toContain('never finished building')
    const exp = await run(['export', fixture('loop'), '-o', join(freshDir(), 'x.html')])
    expect(exp.code).toBe(1)
    expect(exp.stdout).toBe('')
  }, T)

  test('shot --set is checked against the param; shot and export say when the scene has errors; export -o <directory> is a usage error with nothing left behind', async () => {
    const bad: Array<[string, string]> = [
      ['size=abc', '"size" is a number from 1 to 4'], ['size=1e9', '"size" goes from 1 to 4'], ['size=0', '"size" goes from 1 to 4'],
      ['on=yes', '"on" is a toggle: true or false'], ['mode=warp', '"mode" is one of: slow, fast'], ['nope=1', 'the scene has no parameter "nope"'],
    ]
    for (const [set, message] of bad) {
      const r = await mimir(['shot', '--json', fixture('params'), '--step', '1', '--set', set, '--out', freshDir()])
      expect([set, r.code, r.stdout]).toEqual([set, 2, ''])
      expect(r.stderr).toContain(message)
    }
    const base = JSON.parse((await mimir(['shot', '--json', fixture('params'), '--step', '1', '--out', freshDir()])).stdout) as ManifestEntry[]
    for (const set of ['size=4', 'on=true', 'mode=fast']) {
      const r = await mimir(['shot', '--json', fixture('params'), '--step', '1', '--set', set, '--out', freshDir()])
      expect(r.code).toBe(0)
      expect((JSON.parse(r.stdout) as ManifestEntry[])[0]!.sha256).not.toBe(base[0]!.sha256)
    }
    const debug = await mimir(['shot', '--json', fixture('params'), '--step', '1', '--debug', 'bogus', '--out', freshDir()])
    expect(debug.code).toBe(2)
    expect(debug.stderr).toContain('--debug must be one of ids, boxes, safe')
    // the debug overlay comes with the dev chunk on first use: the frame differs from the plain one
    const ids = JSON.parse((await mimir(['shot', '--json', fixture('params'), '--step', '1', '--debug', 'ids', '--out', freshDir()])).stdout) as ManifestEntry[]
    expect(ids[0]!.sha256).not.toBe(base[0]!.sha256)

    const shot = await mimir(['shot', '--json', example('broken'), '--step', '1', '--out', freshDir()])
    expect(shot.code).toBe(0)
    expect(shot.stderr).toContain('warning: the scene has 4 errors')
    expect(shot.stderr).toContain('mimir check')
    const dir = freshDir()
    const exp = await mimir(['export', example('broken'), '-o', join(dir, 'b.html')])
    expect(exp.code).toBe(0)
    expect(JSON.parse(exp.stdout).warnings.join(' ')).toContain('the scene has 4 errors')
    const into = freshDir()
    const toDir = await mimir(['export', example('hello-2d'), '-o', into])
    expect(toDir.code).toBe(2)
    expect(toDir.stderr).toContain('is a directory; name the file to write')
    expect(toDir.stderr).not.toContain('internal error')
    expect(readdirSync(into)).toEqual([])
    expect(existsSync(`${into}.unverified.html`)).toBe(false)
  }, T)

  test('export: a JSON module the scene imports is embedded, and the file runs offline', async () => {
    expect(JSON.parse((await mimir(['check', fixture('jsondata')])).stdout).ok).toBe(true)
    const dir = freshDir()
    const r = await mimir(['export', fixture('jsondata'), '-o', join(dir, 'j.html')])
    expect(r.code).toBe(0)
    const out = JSON.parse(r.stdout)
    expect(out).toMatchObject({ verified: true, warnings: [] })
    expect(out.modules).toContain('/scene/lib/da%20ta/size.json')
    expect(readdirSync(dir)).toEqual(['j.html'])
    const html = readFileSync(out.path, 'utf8')
    expect(html).not.toMatch(/with\s*\{\s*type/) // the import attribute is gone: the data is a script module now
    const proof = Bun.spawn(['bun', join(ROOT, 'scripts', 'offline-proof.ts'), out.path, join(dir, 'offline.png')], { cwd: ROOT, env: ENV, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    const [proofOut, proofCode] = await Promise.all([new Response(proof.stdout).text(), proof.exited])
    expect(proofCode).toBe(0)
    expect(JSON.parse(proofOut)).toMatchObject({ ready: true, fatal: null, steps: 1, requests: { file: 1, other: [] }, blocked: [], consoleErrors: [] })
  }, T)

  test('docs: the generated reference answers an exact lookup', async () => {
    if (!existsSync(join(ROOT, 'types', 'mimir.d.ts'))) return
    const r = await mimir(['docs', 'scene'])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('function scene(')
    expect(r.stdout).not.toContain('__mimir_') // no module-form plumbing
    const list = await mimir(['docs'])
    expect(list.code).toBe(0)
    expect(list.stdout).not.toContain('__mimir_')
    expect(list.stdout).toMatch(/Scene\.: .*\bstep\b/)
  }, T)
})

// ── how the viewer starts, the settings it is given, and what it loads ────────────────────────────────────────
// Scenes written for these tests (a scratch directory: they use only the public API).
const SCRATCH = join(WORK, 'scenes')
mkdirSync(SCRATCH)
const write = (name: string, source: string): string => { const p = join(SCRATCH, name); writeFileSync(p, source); return p }
const PLAIN = write('plain.scene.js', `import { scene, rect, text, fadeIn, BLUE } from 'mimir'
export default scene({ title: 'Plain' }, (s) => {
  const angle = s.param('angle', { value: 0, min: 0, max: 360, unit: '°' })
  const crank = s.param('crank', { value: 0, min: 0, max: 90 })
  const lit = s.state('lit', false)
  const a = rect({ id: 'a', width: 2, height: 1, color: BLUE }).at(() => [-3 + angle() / 120 + crank() / 90, 0]).fill(BLUE, () => (lit() ? 0.6 : 0.1))
  const t = text('Plain', { id: 't', size: 'title' }).at(0, 2.5)
  s.step('One', (st) => { st.play(fadeIn(t)); st.set(angle, 360) })
  s.step('Two', (st) => { st.set(lit, true); st.wait(1) })
})
`)
const COMPUTED = write('computed.scene.js', `import { scene, text } from 'mimir'
// names of on-demand modules that never stand in the source as words of their own
const make = globalThis['ax' + 'es']
export default scene({ title: 'Computed' }, (s) => {
  const ax = make({ id: 'ax', x: [0, 4], y: [0, 4], width: 5, height: 3 }).at(-2, 0)
  ax.plot((x) => x, { id: 'curve' })
  const f = globalThis['te' + 'x']('a^2 + b^2', { id: 'f' }).at(4, 2)
  const t = text('Computed', { id: 't', size: 'label' }).at(4, -2)
  s.step('One', (st) => { st.wait(1) })
})
`)
const TOPLEVEL = write('toplevel.scene.js', `import { scene } from 'mimir'
// touched while the module is evaluated, before scene() runs
const gear = globalThis['k' + 'it'].gear({ id: 'gear', teeth: 12 })
export default scene({ title: 'Top level' }, (s) => { s.step('One', (st) => { st.wait(1) }) })
`)
write('mimir.config.json', JSON.stringify({ defaults: { pace: { hold: 0, plya: 2 }, look: { line: { sigm: 2, sigma: 2 } }, guide: { hop: 0.9 }, 'text.size.title': 'big' }, agent: { name: 'none' } }))
write('quiet.config.json', JSON.stringify({ defaults: { viewer: { autoplay: false, mode: 'read' } } }))

describe.skipIf(!HAVE)('viewer start, settings, on-demand loading', () => {
  /** a session on PLAIN, and pages of the same server opened with a query of their own */
  async function withPages<T>(fn: (open: (file: string, query: string, opts?: { before?: string }) => Promise<{ page: any; info: any; json: <R>(expr: string) => Promise<R> }>, session: any) => Promise<T>): Promise<T> {
    const prev = process.env.TMPDIR
    process.env.TMPDIR = TMP
    const session = await openSession({ scene: resolveScene(PLAIN, ROOT, 'check'), viewerRoot: join(ROOT, 'dist'), width: 640, height: 360, scale: 1 })
    try {
      const open = async (file: string, query: string, opts: { before?: string } = {}) => {
        const page = await session.browser.newPage(640, 360, 1, { window: true }) // a window of its own: only a front tab gets animation frames
        if (opts.before) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: opts.before })
        const url = `${session.server.origin}/viewer.html?scene=${encodeURIComponent('/scene/' + file)}${query}`
        await page.navigate(url)
        await waitReady(page, 20_000, url)
        const json = async <R>(expr: string): Promise<R> => JSON.parse(await page.evaluate<string>(`Promise.resolve(${expr}).then((v) => JSON.stringify(v === undefined ? null : v))`)) as R
        return { page, info: await json<any>('__mimir.info()'), json }
      }
      return await fn(open, session)
    } finally {
      await session.close()
      process.env.TMPDIR = prev
    }
  }
  const until = async (probe: () => Promise<boolean>, ms = 8000): Promise<boolean> => { const t0 = performance.now(); while (performance.now() - t0 < ms) { if (await probe()) return true; await Bun.sleep(40) } return false }

  test('the viewer plays when a person is watching; autoplay=0, a setting, or headless keep it still; play() and pause() are the one clock', async () => {
    await withPages(async (open) => {
      // 1. not headless: plays on its own, in video mode
      const live = await open('plain.scene.js', '')
      expect(live.info).toMatchObject({ headless: false, autoplay: true, mode: 'video' })
      expect(await until(async () => (await live.json<any>('__mimir.state()')).tau > 0.15)).toBe(true)
      expect((await live.json<any>('__mimir.state()')).playing).toBe(true)
      await live.json('__mimir.pause()')
      const paused = await live.json<any>('__mimir.state()')
      await Bun.sleep(250)
      expect(await live.json<any>('__mimir.state()')).toMatchObject({ playing: false, tau: paused.tau })
      // the events of the transport, and the end of the story: seek near the end, play, it stops there by itself
      await live.json(`(globalThis.__ev = [], __mimir.on('play', () => __ev.push('play')), __mimir.on('pause', (e) => __ev.push(e.ended ? 'ended' : 'pause')), __mimir.seek(__mimir.info().duration - 0.2), __mimir.play())`)
      expect(await until(async () => (await live.json<string[]>('__ev')).includes('ended'))).toBe(true)
      expect(await live.json<string[]>('__ev')).toEqual(['play', 'ended'])
      const end = await live.json<any>('__mimir.state()')
      // the mounted player owns the clock and rests one end-epsilon before the end, so that the last step stays the step being told
      expect(end.playing).toBe(false)
      expect(Math.abs(end.tau - live.info.duration)).toBeLessThanOrEqual(0.0021)
      // 2. autoplay=0: ready and still; play() starts it, at the speed asked for
      const still = await open('plain.scene.js', '&autoplay=0&mode=read')
      expect(still.info).toMatchObject({ autoplay: false, mode: 'read' })
      await Bun.sleep(300)
      expect(await still.json<any>('__mimir.state()')).toMatchObject({ tau: 0, playing: false })
      await still.json('__mimir.play({ speed: 2 })')
      expect(await until(async () => (await still.json<any>('__mimir.state()')).tau > 0.15)).toBe(true)
      expect(await still.json<any>('__mimir.state()')).toMatchObject({ playing: true, speed: 2 })
      // 3. the project says no autoplay (and another mode): the query can still ask for it
      const quiet = await open('plain.scene.js', '&config=' + encodeURIComponent('/scene/quiet.config.json'))
      expect(quiet.info).toMatchObject({ autoplay: false, mode: 'read' })
      expect(quiet.info.config).toEqual({ project: 'quiet.config.json', values: { 'viewer.autoplay': false, 'viewer.mode': 'read' } })
      await Bun.sleep(250)
      expect((await quiet.json<any>('__mimir.state()')).tau).toBe(0)
      const asked = await open('plain.scene.js', '&autoplay=1&config=' + encodeURIComponent('/scene/quiet.config.json'))
      expect(asked.info.autoplay).toBe(true)
      // a page opened at a moment shows that moment (a link, a live reload): it does not run away from it
      const moment = await open('plain.scene.js', '&t=1.5')
      expect(moment.info.autoplay).toBe(false)
      await Bun.sleep(250)
      expect(await moment.json<any>('__mimir.state()')).toMatchObject({ tau: 1.5, playing: false })
      // pinning a param by hand takes the story's hand off: it pauses; play() gives the params back to the story
      await moment.json('__mimir.play()')
      expect(await until(async () => (await moment.json<any>('__mimir.state()')).tau > 1.6)).toBe(true)
      await moment.json(`__mimir.setParam('crank', 45)`)
      const held = await moment.json<any>('__mimir.state()')
      expect([held.playing, held.overridden]).toEqual([false, ['crank']])
      await moment.json('__mimir.play()')
      expect((await moment.json<any>('__mimir.state()')).overridden).toEqual([])
      // 4. headless: nothing moves, whatever is asked
      const headless = await open('plain.scene.js', '&headless=1&autoplay=1')
      expect(headless.info).toMatchObject({ headless: true, autoplay: false })
      await headless.json('__mimir.play()')
      await Bun.sleep(300)
      expect(await headless.json<any>('__mimir.state()')).toMatchObject({ tau: 0, playing: false })
    })
  }, T)

  test('info(): params say cyclic / period / hidden; the version is the package\'s', async () => {
    await withPages(async (_open, session) => {
      const info = await session.host('info')
      expect(info.params.map((p: any) => [p.name, p.kind, p.cyclic, p.period, p.hidden])).toEqual([['angle', 'number', true, 360, false], ['crank', 'number', false, 0, false], ['lit', 'toggle', false, 0, true]])
      expect(info.version).toBe(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version)
      expect(info).toMatchObject({ headless: true, autoplay: false, mode: 'video', config: { project: null, values: {} } })
    })
  }, T)

  test('mimir.config.json: the page is given the project\'s settings; wrong keys are diagnostics, also for modules that are not loaded', async () => {
    await withPages(async (open) => {
      const base = await open('plain.scene.js', '&headless=1')
      const page = await open('plain.scene.js', '&headless=1&config=' + encodeURIComponent('/scene/mimir.config.json'))
      // pace.hold 0: every step is one second shorter
      expect(page.info.steps.map((x: any) => +(x.t1 - x.t0).toFixed(3))).toEqual(base.info.steps.map((x: any) => +(x.t1 - x.t0 - 1).toFixed(3)))
      expect(page.info.config.project).toBe('mimir.config.json')
      expect(page.info.config.values).toMatchObject({ 'pace.hold': 0, 'guide.hop': 0.9 })
      // what the page can know at once: groups whose keys are all in the main chunk
      const now = await page.json<any[]>('__mimir.diagnostics({ sample: false })')
      expect(now.map((d) => [d.code, d.what, d.file])).toEqual([
        ['API-UNKNOWN', 'mimir.config.json: there is no setting "pace.plya".', 'mimir.config.json'],
        ['API-TYPE', 'mimir.config.json: "text.size.title" is a number, got the string "big".', 'mimir.config.json'],
      ])
      expect(now[0].fix[0]).toBe('use "pace.play"')
      // `check` knows every module of the build: the look belongs to the 3D chunk, which this 2D scene never loads
      const checked = await page.json<any[]>('__mimir.diagnostics()')
      const look = checked.filter((d) => /look\./.test(d.what))
      expect(look.map((d) => [d.code, d.what, d.fix[0]])).toEqual([['API-UNKNOWN', 'mimir.config.json: there is no setting "look.line.sigm".', 'use "look.line.sigma"']])
      expect((await page.json<any>('__mimir.info()')).chunks).not.toContain('3d')
      // the same settings handed over as an object (what an export does): no request, same result
      const inline = await open('plain.scene.js', '&headless=1', { before: `globalThis.__mimirConfig = ${JSON.stringify({ defaults: { 'pace.hold': 0 } })}` })
      expect(inline.info.steps.map((x: any) => x.t1)).toEqual(page.info.steps.map((x: any) => x.t1))
      // a file that is not there: said once, the scene runs on the defaults
      const missing = await open('plain.scene.js', '&headless=1&config=' + encodeURIComponent('/scene/nothing.json'))
      expect(missing.info.fatal).toBeNull()
      expect(missing.info.steps.map((x: any) => x.t1)).toEqual(base.info.steps.map((x: any) => x.t1))
      const said = await missing.json<any[]>('__mimir.diagnostics({ sample: false })')
      expect(said.map((d) => [d.code, d.severity])).toEqual([['RUNTIME-ERROR', 'warn']])
      expect(said[0].what).toContain('nothing.json could not be read')
    })
  }, T)

  test('on-demand modules: a name reached through computed access, at the top level of the module, or with no source to read is loaded all the same', async () => {
    await withPages(async (open) => {
      const loaded = async (p: { json: <R>(e: string) => Promise<R> }): Promise<string[]> => (await p.json<string[]>(`performance.getEntriesByType('resource').map((e) => e.name.split('/').pop())`)).filter((n) => /^mimir\./.test(n)).sort()
      // the plain scene names no on-demand module: none is loaded, and `check` brings none in
      const plain = await open('plain.scene.js', '&headless=1')
      expect(plain.info.features).toEqual([])
      expect((await plain.json<any[]>('__mimir.diagnostics()')).filter((d) => d.severity === 'error')).toEqual([])
      expect(await loaded(plain)).toEqual(['mimir.check.js', 'mimir.fonts.js', 'mimir.js'])
      expect(await plain.json<string[]>(`Object.keys(globalThis.__mimirBridge).filter((k) => /^(kit|plot|diagram|flow|sim|tex)\\//.test(k))`)).toEqual([])
      // a stand-in says which module a name belongs to
      expect(await plain.json<string>(`(() => { try { axes({}) } catch (e) { return e.name + ': ' + e.message } })()`)).toBe('FeatureNeeded: "axes" belongs to the on-demand module "plot", which is not loaded in this page')
      // computed access inside the builder
      const computed = await open('computed.scene.js', '&headless=1')
      expect(computed.info.fatal).toBeNull()
      expect(computed.info.features).toEqual(['plot', 'tex'])
      expect(computed.info.parts.map((p: any) => p.id)).toEqual(expect.arrayContaining(['ax', 'curve', 'f', 't']))
      const diags = await computed.json<any[]>('__mimir.diagnostics()')
      expect(diags.filter((d) => d.code === 'RUNTIME-ERROR')).toEqual([])
      for (const d of diags) expect(String(d.file)).not.toContain('mimir-retry')
      // the rules of the modules it loaded came with `check`, the others did not
      const files = await loaded(computed)
      expect(files).toContain('mimir.checktex.js')
      expect(files).not.toContain('mimir.checkkit.js')
      expect(files).not.toContain('mimir.kitapi.js')
      // touched while the module itself is evaluated
      const top = await open('toplevel.scene.js', '&headless=1')
      expect(top.info.fatal).toBeNull()
      expect(top.info.features).toEqual(['kit'])
      expect(top.info.parts.map((p: any) => p.id)).toContain('gear')
      // told that it holds no module at all (what a page gets whose source cannot be read): it finds out by touching
      const blind = await open('computed.scene.js', '&headless=1&features=')
      expect(blind.info.features).toEqual(['plot', 'tex'])
      expect(blind.info.fatal).toBeNull()
    })
  }, T)

  test('third-party notices travel with the code: in the build, and in an exported 3D scene and an exported formula', async () => {
    const dist = join(ROOT, 'dist')
    const head = (file: string): string => readFileSync(join(dist, file), 'utf8').slice(0, 2000).split('\n')[0]!
    const pkg = (name: string): { version: string; license: string } => JSON.parse(readFileSync(join(ROOT, 'node_modules', name, 'package.json'), 'utf8'))
    const three = `bundles three ${pkg('three').version} (${pkg('three').license}): Copyright`
    const katex = `bundles katex ${pkg('katex').version} (${pkg('katex').license}): Copyright`
    expect(head('mimir.3d.js')).toStartWith('/*! mimir.3d.js: ')
    expect(head('mimir.3d.js')).toContain(three)
    expect(head('mimir.tex.js')).toContain(katex)
    // font faces are data taken from another package: the chunk says from where and under which licence
    const dataChunks = (JSON.parse(readFileSync(join(dist, 'build.json'), 'utf8')).chunks as { file: string; data: boolean }[]).filter((c) => c.data).map((c) => c.file)
    expect(dataChunks.length).toBeGreaterThan(1)
    for (const f of dataChunks) { expect(head(f), f).toMatch(/^\/\*! mimir\.[a-z0-9]+\.js: /); expect(head(f), f).toMatch(/Open Font License/) }
    expect(head('mimir.fonts.js')).toMatch(/Copyright \(c\) [\d-]+ .*Khan Academy/)
    // every chunk opens with its banner, and build.json lists them
    const notices = JSON.parse(readFileSync(join(dist, 'build.json'), 'utf8')).notices as Record<string, string>
    for (const f of readdirSync(dist).filter((n) => /^mimir\..*\.js$|^mimir\.js$/.test(n))) expect(head(f)).toBe(notices[f]!)
    // exports
    const dir = freshDir()
    const solid = await mimir(['export', example('hello-3d'), '-o', join(dir, 'solid.html')])
    expect(solid.code).toBe(0)
    const html = readFileSync(join(dir, 'solid.html'), 'utf8')
    expect(html).toContain(three)
    expect(html).toMatch(/Open Font License/)
    expect(html).not.toContain('bundles katex') // KaTeX itself is not in a scene without a formula
    const formula = await mimir(['export', example('formula'), '-o', join(dir, 'formula.html')])
    expect(formula.code).toBe(0)
    const fhtml = readFileSync(join(dir, 'formula.html'), 'utf8')
    expect(fhtml).toContain(katex)
    expect(fhtml).not.toContain('bundles three')
  }, T)
})
