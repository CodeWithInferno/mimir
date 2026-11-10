// docs/EXTENDING.md is executable: every fenced block tagged `file=` is cut out of the document, written into a
// scratch copy of the repository as the module src/demo (plus its scene), and then built, typechecked, checked, shot
// and exported with the real launcher and the real browser. The same scratch copy then proves the rest of the
// extension contract: a name registered twice fails the build while the CLI keeps answering, an error inside a kind
// backend carries the scene line, and removing the module leaves no trace.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { ManifestEntry } from '../../src/cli/manifest.ts'
import { resolveScene } from '../../src/cli/paths.ts'
import { openSession } from '../../src/cli/session.ts'

const ROOT = resolve(import.meta.dir, '..', '..')
const DOC = join(ROOT, 'docs', 'EXTENDING.md')
const HAVE = existsSync(DOC) && existsSync(join(ROOT, 'scripts', 'build.ts')) && existsSync(join(ROOT, 'node_modules', 'three'))

const WORK = mkdtempSync(join(tmpdir(), 'mimir-extend-'))
const REPO = join(WORK, 'repo')
const TMP = join(WORK, 'tmp')
mkdirSync(TMP)
// The document's module is an illustration, not a shipped feature: it is built on top of whatever the tree holds, so
// the absolute budgets are switched off here and the test asserts what the module itself costs instead. (The real
// tree is held to the budgets by the build itself; one test below turns the strictness back on.)
const ENV: Record<string, string> = { ...(process.env as Record<string, string>), TMPDIR: TMP, MIMIR_LAUNCH_DEPTH: '0', MIMIR_BUILD_STRICT: '0' }
for (const k of ['MIMIR_VIEWER_ROOT', 'MIMIR_TIMEOUT', 'MIMIR_TYPES', 'MIMIR_CHROME_ARGS']) delete ENV[k]
// the over-budget case pins the limit it tests against, so it does not depend on the project's current budget
const STRICT: Record<string, string> = { ...ENV, MIMIR_BUDGET_CORE: '60' }
delete STRICT.MIMIR_BUILD_STRICT

/** the files embedded in the document: blocks with the same `file=` are joined in order */
function embedded(): Map<string, string> {
  const out = new Map<string, string[]>()
  for (const m of readFileSync(DOC, 'utf8').matchAll(/^```[a-z]+ file=(\S+)\n([\s\S]*?)\n```$/gm)) out.set(m[1]!, [...(out.get(m[1]!) ?? []), m[2]!])
  return new Map([...out].map(([file, parts]) => [file, parts.join('\n\n') + '\n']))
}

interface Result { code: number; stdout: string; stderr: string }
async function run(cmd: string[], env: Record<string, string> = ENV): Promise<Result> {
  const proc = Bun.spawn(cmd, { cwd: REPO, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { code, stdout, stderr }
}
const mimir = (args: string[], env?: Record<string, string>): Promise<Result> => run([join(REPO, 'bin', 'mimir'), ...args], env)
const build = (env?: Record<string, string>): Promise<Result> => run(['bun', 'scripts/build.ts'], env)
interface BuildInfo { chunks: { chunk: string; file: string; gzip: number; dev: boolean; modules: string[]; deps: string[] }[]; budgets: { coreKb: number; with3dKb: number; over: string[] } }
const buildInfo = (): BuildInfo => JSON.parse(readFileSync(join(REPO, 'dist', 'build.json'), 'utf8'))
const gzipOf = (info: BuildInfo, name: string): number => info.chunks.find((c) => c.chunk === name)?.gzip ?? 0
const buildInfoOrNull = (): BuildInfo | null => { try { return buildInfo() } catch { return null } }
/** sizes of the tree as it is, before the document's module is added */
let before: BuildInfo
const write = (file: string, text: string): void => { mkdirSync(dirname(join(REPO, file)), { recursive: true }); writeFileSync(join(REPO, file), text) }
const browsersRunning = (): string[] =>
  Bun.spawnSync(['ps', '-axo', 'command=']).stdout.toString().split('\n').filter((l) => l.includes(WORK) && l.includes('--user-data-dir'))

beforeAll(async () => {
  if (!HAVE) return
  mkdirSync(REPO)
  for (const name of ['src', 'scripts', 'bin', 'examples', 'package.json', 'tsconfig.json']) cpSync(join(ROOT, name), join(REPO, name), { recursive: true })
  rmSync(join(REPO, 'src', 'demo'), { recursive: true, force: true })
  symlinkSync(join(ROOT, 'node_modules'), join(REPO, 'node_modules'))
  const base = await build()
  if (base.code !== 0) throw new Error(`the tree does not build without the document's module:\n${base.stderr}`)
  before = buildInfo()
  for (const [file, text] of embedded()) write(file, text)
}, 120_000)
afterEach(async () => {
  for (let i = 0; i < 40 && browsersRunning().length > 0; i++) await Bun.sleep(50)
  const processes = browsersRunning()
  const profiles = readdirSync(TMP).filter((n) => n.startsWith('mimir-chrome-'))
  for (const p of profiles) rmSync(join(TMP, p), { recursive: true, force: true })
  expect(processes).toEqual([])
  expect(profiles).toEqual([])
})
afterAll(() => { if (!process.env.MIMIR_KEEP_SCRATCH) rmSync(WORK, { recursive: true, force: true }); else console.log('scratch kept at', REPO) })

const T = 180_000

describe.skipIf(!HAVE)('docs/EXTENDING.md, built as written', () => {
  test('the document carries a whole module: pure side, 3D side, own chunk, rules, types and a scene', () => {
    expect([...embedded().keys()].sort()).toEqual(['demo.scene.js', 'src/demo/api.d.ts', 'src/demo/check.ts', 'src/demo/demo.chunk.ts', 'src/demo/demoparts.chunk.ts', 'src/demo/index.ts', 'src/demo/three.ts'])
    // the recipes the feature wave needs are all there, in the module that gets built
    const index = embedded().get('src/demo/index.ts')!
    for (const hook of ['outline:', 'textRects:', 'clip:', 'model.child(', 'chunk:', 'defineLook(', 'defineInterp(', 'defineFinalize(', 'defineManifest(', 'after:', 'layout(', 'paint(', 'defineKindMethod(', 'defineKindSetter(', 'frame.rest(', 'c.snap(']) expect(index).toContain(hook)
    expect(embedded().get('src/demo/demoparts.chunk.ts')!).toContain("from 'three'") // a module's own chunk on top of the 3D chunk
    const three = embedded().get('src/demo/three.ts')!
    for (const hook of ['c.instanced(', 'c.place(', 'c.line(', 'c.points(', 'c.material(']) expect(three).toContain(hook)
    for (const hook of ['c.canvas()', 'c.begin(']) expect(embedded().get('src/demo/demo.chunk.ts')!).toContain(hook)
    for (const hook of ['.pin(', '.hud()', 's.chapter(', 'st.note(', 'st.zoom(', 'st.spread(', '.to.level(']) expect(embedded().get('demo.scene.js')!).toContain(hook)
  })

  test('it builds with no edit outside its directory, typechecks, costs the main chunk little, and gets its own chunks', async () => {
    const b = await build()
    expect(b.stderr).toBe('')
    expect(b.code).toBe(0)
    const info = buildInfo()
    const chunk = (name: string): BuildInfo['chunks'][number] => info.chunks.find((c) => c.chunk === name)!
    // whatever other modules the tree holds, the document's module adds exactly these two chunks
    const names = info.chunks.map((c) => c.chunk)
    expect(names.slice(0, 3)).toEqual(['core', '3d', 'check'])
    expect(names.filter((n) => !before.chunks.some((c) => c.chunk === n)).sort()).toEqual(['demo', 'demoparts'])
    expect(chunk('demo')).toMatchObject({ file: 'mimir.demo.js', dev: false, modules: ['demo'], deps: [] })
    expect(chunk('3d').modules).toContain('demo')
    expect(chunk('check').modules).toContain('demo')
    expect(chunk('check').dev).toBe(true)
    expect(chunk('demo').gzip).toBeLessThan(2048) // a chunk pays only for what it imports from the main chunk
    // a 3D module's own chunk builds on the 3D chunk: it is loaded after it, and three.js is shared, not copied
    expect(chunk('demoparts')).toMatchObject({ file: 'mimir.demoparts.js', dev: false, modules: ['demo'], deps: ['3d'] })
    expect(chunk('demoparts').gzip).toBeLessThan(1024)
    expect(readFileSync(join(REPO, 'src', '_generated', 'chunks.ts'), 'utf8')).toContain(`"demoparts": () => import('./mimir.3d.js').then(() => import('./mimir.demoparts.js'))`)
    // what the module itself costs (the tree's own size is the build's business, not this test's): five kinds, two
    // overlays, a verb, a look, three step actions and two hooks in the main chunk; one backend in the 3D chunk
    const coreCost = gzipOf(info, 'core') - gzipOf(before, 'core'), threeCost = gzipOf(info, '3d') - gzipOf(before, '3d')
    console.log(`  the document's module costs ${(coreCost / 1024).toFixed(1)} KB in mimir.js, ${(threeCost / 1024).toFixed(1)} KB in mimir.3d.js, ${(chunk('demo').gzip / 1024).toFixed(1)} + ${(chunk('demoparts').gzip / 1024).toFixed(1)} KB in its own chunks (gzip)`)
    expect(coreCost).toBeLessThan(3.5 * 1024)
    expect(threeCost).toBeLessThan(1.5 * 1024)
    expect(existsSync(join(REPO, 'dist', 'mimir.demo.js'))).toBe(true)
    // three.js stays out of the main chunk and out of the module's own chunks
    for (const f of ['mimir.js', 'mimir.demo.js', 'mimir.demoparts.js', 'mimir.check.js']) expect(readFileSync(join(REPO, 'dist', f), 'utf8').includes('WebGLRenderer')).toBe(false)

    const tsc = await run(['bunx', 'tsc', '--noEmit', '-p', '.'])
    expect(tsc.stdout + tsc.stderr).toBe('')
    expect(tsc.code).toBe(0)
    // the scene against the typed reference: a kind with its own method keeps it through chained setters (MobOf<Gauge>)
    const js = await run(['bunx', 'tsc', '--ignoreConfig', '--noEmit', '--allowJs', '--checkJs', '--target', 'es2022', '--module', 'esnext', '--moduleResolution', 'bundler', '--skipLibCheck', '--lib', 'es2023,dom', 'types/mimir.d.ts', 'demo.scene.js'])
    expect(js.stdout + js.stderr).toBe('')
    expect(js.code).toBe(0)
    const docs = await mimir(['docs', 'gauge'])
    expect(docs.stdout).toContain('declare function gauge(')
    expect((await mimir(['docs', 'Gauge'])).stdout).toContain('percent(): () => number')
    expect((await mimir(['docs', 'GaugeTo'])).stdout).toContain('level(value: Dyn<number>): GaugeTo')
  }, T)

  test('settings: the module\'s default is documented from the comment on it, a scene can change it, a wrong key names the right one', async () => {
    // the build's document of every setting carries the module's key, its default and the comment written on it
    const doc = await run(['bun', 'scripts/build.ts', '--print-config'])
    expect(doc.code).toBe(0)
    expect(doc.stdout).toContain('| `demo.pulse.scale` | `1.3` | how far pulse() swells its target, as a factor of its size |')
    expect(doc.stdout).toContain('Registered in `src/demo/index.ts`.')
    const scene = (defaults: string): string => `import { scene, star, pulse } from 'mimir'
export default scene({ title: 'Settings', defaults: ${defaults} }, (s) => {
  const a = star({ id: 'a', radius: 1 })
  s.probe('scale', () => s.config('demo.pulse.scale'))
  s.step('Pulse', (st) => { st.play(pulse(a)) })
})
`
    write('settings.scene.js', scene(`{ demo: { pulse: { scale: 2 } }, 'pace.enter': 2 }`))
    const ok = JSON.parse((await mimir(['check', 'settings.scene.js', '--all'])).stdout)
    expect(ok.diagnostics.filter((d: { severity: string }) => d.severity === 'error')).toEqual([])
    // the value in force, read where the scene is drawn
    const shot = JSON.parse((await mimir(['shot', 'settings.scene.js', '--at', '1', '--out', join(WORK, 'settings'), '--json'])).stdout) as ManifestEntry[]
    const seen = JSON.parse(readFileSync(shot[0]!.path.replace(/\.png$/, '.probes.json'), 'utf8')) as { probes: Record<string, number> }
    expect(seen.probes.scale).toBe(2)
    write('settings.scene.js', scene(`{ demo: { pulse: { scal: 2, scale: 'big' } } }`))
    const bad = JSON.parse((await mimir(['check', 'settings.scene.js', '--all'])).stdout)
    expect(bad.diagnostics.map((d: { code: string; what: string; fix: string[]; line: number }) => [d.code, d.what, d.fix[0], d.line])).toEqual([
      ['API-UNKNOWN', 'scene({ defaults }): there is no setting "demo.pulse.scal".', 'use "demo.pulse.scale"', 2],
      ['API-TYPE', 'scene({ defaults }): "demo.pulse.scale" is a number, got the string "big".', `'demo.pulse.scale': 1.3  (the default)`, 2],
    ])
    rmSync(join(REPO, 'settings.scene.js'))
  }, T)

  test('check: the scene is clean except for the module\'s own rule; composite parts are named parent.part', async () => {
    const r = await mimir(['check', 'demo.scene.js', '--all'])
    const out = JSON.parse(r.stdout)
    expect(out.diagnostics.map((d: { code: string; ids: string[]; severity: string }) => [d.code, d.ids, d.severity])).toEqual([['DEMO-TINY', ['speck'], 'warn']])
    expect(out.diagnostics[0].file).toBe('demo.scene.js')
    expect(typeof out.diagnostics[0].line).toBe('number')
    expect(r.code).toBe(0)
    // a text that sits on the text of a part: the fix names the object the author made (`dial`), not the part
    // (`dial.readout`, which in scene code is not a variable: following it used to give REF-MISSING)
    write('overlap.scene.js', `import { scene, gauge, text } from 'mimir'\nexport default scene({ title: 'Overlap' }, (s) => {\n  const dial = gauge({ id: 'dial', value: 0.4 })\n  text('40', { id: 'onTop', size: 'note' }).at(0, 0.3)\n  s.step('x', (st) => { st.wait(1) })\n})\n`)
    const over = JSON.parse((await mimir(['check', 'overlap.scene.js', '--all'])).stdout)
    const hit = over.diagnostics.find((d: { code: string }) => d.code === 'TEXT-OVERLAP')
    expect(hit.ids.sort()).toEqual(['dial.readout', 'onTop'])
    expect(hit.fix[0]).toBe("put one beside the other: onTop.nextTo(dial, 'down')")
    expect(hit.fix.join(' ')).not.toContain('dial.readout')
  }, T)

  test('same time, same pixels, in any order: with an overlay that reads other overlays, a canvas layer, instancing, lines, a cut and a zoom', async () => {
    const shoot = async (times: string): Promise<Map<number, Set<string>>> => {
      const dir = mkdtempSync(join(WORK, 'shots-'))
      const r = await mimir(['shot', '--json', 'demo.scene.js', '--at', times, '--out', dir])
      expect(r.code).toBe(0)
      const by = new Map<number, Set<string>>()
      for (const e of JSON.parse(r.stdout) as ManifestEntry[]) by.set(e.t!, (by.get(e.t!) ?? new Set()).add(e.sha256))
      return by
    }
    // mid-entrance, marks + cut + badge + explode, the chapter clearing, the zoom; and neighbours inside one step,
    // where a label, a mark and a moving part are on screen in both frames (what the first version of this test missed)
    const a = await shoot('2,9.5,11.3,15.5,9.5,2,7.1,7.4,8.2')
    const b = await shoot('15.5,8.2,11.3,7.4,2,9.5,7.1')
    expect([...a.keys()].sort((x, y) => x - y)).toEqual([2, 7.1, 7.4, 8.2, 9.5, 11.3, 15.5])
    for (const [t, hashes] of a) {
      expect(hashes.size).toBe(1)
      expect(b.get(t)).toEqual(hashes)
    }
    expect(new Set([...a.values()].map((s) => [...s][0])).size).toBe(7)
  }, T)

  test('lazy chunks: the runtime loads exactly what the scene needs, and the export inlines exactly that', async () => {
    const demo = JSON.parse((await mimir(['export', 'demo.scene.js', '-o', join(WORK, 'demo.html')])).stdout)
    expect(demo.verified).toBe(true) // opened from file:// by the exporter itself
    expect(demo.modules).toEqual(expect.arrayContaining(['/mimir.js', '/mimir.3d.js', '/mimir.demo.js', '/mimir.demoparts.js']))
    expect(demo.modules.some((m: string) => m.includes('check'))).toBe(false)
    const flat = JSON.parse((await mimir(['export', 'examples/hello-2d.scene.js', '-o', join(WORK, 'flat.html')])).stdout)
    // a 2D scene: the main chunk, the embedded faces (it shows text), the guide (it speaks) and the player's chrome (a person will watch it); no 3D, no on-demand module
    expect(flat.modules.filter((m: string) => m.startsWith('/mimir')).sort()).toEqual(['/mimir.fonts.js', '/mimir.guide.js', '/mimir.js', '/mimir.player.js'])
    const solid = JSON.parse((await mimir(['export', 'examples/hello-3d.scene.js', '-o', join(WORK, 'solid.html')])).stdout)
    expect(solid.modules.filter((m: string) => m.startsWith('/mimir')).sort()).toEqual(['/mimir.3d.js', '/mimir.fonts.js', '/mimir.guide.js', '/mimir.js', '/mimir.player.js'])

    const prev = process.env.TMPDIR
    process.env.TMPDIR = TMP
    const session = await openSession({ scene: resolveScene('demo.scene.js', REPO, 'check'), viewerRoot: join(REPO, 'dist'), width: 1280, height: 720, scale: 1 })
    try {
      const info = await session.host<any>('info')
      expect(info.chunks).toEqual(['3d', 'demo', 'demoparts', 'fonts', 'guide']) // + the embedded faces (it shows text) and the guide (it speaks)
      expect(info.stage).toEqual({ width: 1280, height: 720 }) // a 16:9 window is used whole: 90 px per unit
      expect(info.demo).toEqual({ gauges: ['gauge'], rings: 2 }) // defineManifest
      expect(info.parts.map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining(['gauge', 'gauge.dial', 'gauge.needle', 'gauge.readout', 'window', 'ring', 'core', 'halo']))
      expect(info.chapters.map((c: { title: string; keep: string[] }) => [c.title, c.keep])).toEqual([['New kinds', []], ['A closer look', ['text1', 'gauge']]])
      expect(info.transcript[0].note).toContain('**composite**')
      expect(info.transcript[0].narration[0].spans.map((sp: { verb: string; targets: string[] }) => [sp.verb, sp.targets])).toEqual([['point', ['star']], ['ring', ['gauge']]])
      await session.host('seek', info.steps[1].t1 - 0.01)
      await session.host('frame')
      expect(await session.host<Record<string, number>>('probes')).toEqual({ percent: 85 }) // the kind method, through a param sweep
      // in the page: the star inside the porthole is cut by its parent, the particles are on a canvas layer in the SVG
      const dom = JSON.parse(await session.page.evaluate<string>(`JSON.stringify({ clip: document.querySelector('[data-node="peek"] > g').getAttribute('clip-path'), outer: document.querySelector('[data-node="peek"]').getAttribute('clip-path'), defs: [...document.querySelectorAll('svg.mimir-2d defs clipPath')].map((c) => c.id), canvas: [...document.querySelectorAll('.mimir-2d-layers > *')].map((e) => e.tagName.toLowerCase() + (e.dataset.node ? ':' + e.dataset.node : '')), badge: document.querySelector('[data-overlay="demo.badge"] div').getBoundingClientRect().bottom, caption: document.querySelector('[data-overlay="guide.caption"] div').getBoundingClientRect().top })`, 10_000))
      // two clip paths: the window 2D content has beside the 3D panel (used only while the 2D camera is zoomed), and the porthole's
      expect(dom.defs.length).toBe(2)
      expect(dom.defs.map((id: string) => `url(#${id})`)).toContain(dom.clip)
      expect(dom.outer).toBeNull() // not zoomed in this step: nothing is cut at the window
      expect(dom.canvas).toEqual(['svg', 'canvas:dust', 'svg']) // a real canvas between two SVG segments, in z order
      expect(dom.caption - dom.badge).toBeGreaterThan(2) // the badge sits on top of the caption it read in this frame
      expect(dom.caption - dom.badge).toBeLessThan(14)
    } finally {
      await session.close()
      process.env.TMPDIR = prev
    }
  }, T)

  test('id pass: one per sample for every rule; a covered part is found; the visible point of each part is a pixel of that part', async () => {
    write('covered.scene.js', `import { scene, box, sphere } from 'mimir'
export default scene({ title: 'Covered' }, (s) => {
  s.viewport('full')
  box({ id: 'wall', width: 4, height: 4, depth: 0.5 }).at(0, 0, 1)
  sphere({ id: 'hidden', radius: 0.5 }).at(0, 0, -1)
  sphere({ id: 'seen', radius: 0.5 }).at(4, 0, 0)
  box({ id: 'glass', width: 2, height: 2, depth: 2, material: 'glass' }).at(4, 0, 0)
  box({ id: 'half', width: 1, height: 1, depth: 1 }).at(-2.5, 0, -1)
  s.step('front', (st) => { st.camera({ view: 'front', duration: 0 }); st.wait(1) })
})
`)
    const r = await mimir(['check', 'covered.scene.js', '--all'])
    const out = JSON.parse(r.stdout)
    // the sphere behind the wall is drawn (solo) but no pixel of it shows; the one inside the glass housing is fine
    // (the built-in OCCLUDED says the same as a warning: no step ever shows the part)
    expect(out.diagnostics.map((d: { code: string; ids: string[] }) => [d.code, d.ids])).toEqual([['OCCLUDED', ['hidden']], ['DEMO-COVERED', ['hidden']]])
    expect(out.diagnostics[1].what).toMatch(/^only 0% of hidden can be seen \(0 of \d{3,} px\)\.$/)
    expect(out.diagnostics[1].line).toBe(5)

    const prev = process.env.TMPDIR
    process.env.TMPDIR = TMP
    const session = await openSession({ scene: resolveScene('covered.scene.js', REPO, 'check'), viewerRoot: join(REPO, 'dist'), width: 1280, height: 720, scale: 1 })
    try {
      // one sample (the end of the only step), two rules that ask for the id pass (EMPTY-FRAME plain, DEMO-COVERED solo),
      // five parts: one full-frame read-back per kind of pass; every other read-back is only the rectangle of one part
      // (the glass housing alone in the plain pass, each of the five parts alone in the solo pass): 2 + 6, not 2 + 6 full frames
      const reads = JSON.parse(await session.page.evaluate<string>(`(async () => {
        const P = WebGL2RenderingContext.prototype, o = P.readPixels, sizes = []
        P.readPixels = function (x, y, w, h, ...rest) { sizes.push(w * h); return o.call(this, x, y, w, h, ...rest) }
        const diags = await window.__mimir.diagnostics()
        P.readPixels = o
        const full = Math.max(...sizes)
        return JSON.stringify({ codes: diags.map((d) => d.code), full: sizes.filter((n) => n === full).length, regions: sizes.filter((n) => n < full).length, area: sizes.filter((n) => n < full).reduce((a, b) => a + b, 0) / full })
      })()`, 20_000)) as { codes: string[]; full: number; regions: number; area: number }
      expect(reads).toMatchObject({ codes: ['OCCLUDED', 'DEMO-COVERED'], full: 2, regions: 6 })
      expect(reads.area).toBeLessThan(1) // all six part passes together read back less than one frame
      await session.host('debug', 'ids')
      await session.host('seek', 1.5)
      await session.host('frame')
      // the debug view marks the visible point of every 3D part; picking that pixel must give the part back
      const marks = JSON.parse(await session.page.evaluate<string>(`JSON.stringify([...document.querySelectorAll('[data-at]')].map((p) => { const m = /M([-\\d.]+) ([-\\d.]+)h10/.exec(p.getAttribute('d')); return { id: p.dataset.at, x: Number(m[1]) + 5, y: Number(m[2]) } }))`, 10_000)) as { id: string; x: number; y: number }[]
      expect(marks.map((m) => m.id).sort()).toEqual(['glass', 'half', 'seen', 'wall']) // nothing of 'hidden' is visible: no point
      for (const m of marks) {
        const hit = await session.host<string | null>('pick', m.x, m.y)
        expect(hit).toBe(m.id === 'glass' ? 'seen' : m.id) // a housing is seen through: the pick goes to what is inside
      }
      // 'half' is half behind the wall: its visible point is on the half that shows, not at its projected centre
      const half = marks.find((m) => m.id === 'half')!, wall = marks.find((m) => m.id === 'wall')!
      expect(half.x).toBeLessThan(wall.x - 100)
    } finally {
      await session.close()
      process.env.TMPDIR = prev
    }
  }, T)

  test('instances beyond the room they started with are drawn; a canvas kind moves with shift like any other object', async () => {
    write('grow.scene.js', `import { scene, beads, sparks } from 'mimir'
export default scene({ title: 'Grow' }, (s) => {
  s.viewport('right', 0.5)
  const n = s.param('n', { value: 8, min: 4, max: 60, step: 1 })
  beads({ id: 'ring', count: () => Math.round(n()), radius: 1.6, bead: 0.12 }) // the backend makes room for 8 copies at first
  const dust = sparks({ id: 'dust', at: [-4, 0], count: 30, radius: 0.5 })
  s.step('move', (st) => { st.play(dust.to.shift(2, 1)) })
})
`)
    const check = await mimir(['check', 'grow.scene.js', '--all'])
    expect(JSON.parse(check.stdout).diagnostics.filter((d: { severity: string }) => d.severity === 'error')).toEqual([])
    const prev = process.env.TMPDIR
    process.env.TMPDIR = TMP
    const session = await openSession({ scene: resolveScene('grow.scene.js', REPO, 'check'), viewerRoot: join(REPO, 'dist'), width: 1280, height: 720, scale: 1 })
    try {
      // how much of the 3D panel picks as the ring: with 60 small beads it is several times what 8 beads cover
      // (when the copies beyond the capacity were dropped, 60 beads showed as 8 of them: less than with n = 8)
      const hits = async (n: number): Promise<number> => {
        await session.host('setParam', 'n', n)
        await session.host('frame')
        return Number(await session.page.evaluate<string>(`(() => { let c = 0; for (let y = 4; y < 720; y += 8) for (let x = 644; x < 1280; x += 8) if (window.__mimir.pick(x, y) === 'ring') c++; return String(c) })()`, 20_000))
      }
      const few = await hits(8), many = await hits(60), back = await hits(8)
      expect(few).toBeGreaterThan(10)
      expect(many).toBeGreaterThan(few * 2)
      expect(back).toBe(few)
      // the particles: the middle of what is drawn on the canvas layer moves by the shift (2 units right, 1 up = 180 px, 90 px)
      const middle = async (tau: number): Promise<{ x: number; y: number; n: number }> => {
        await session.host('seek', tau)
        await session.host('frame')
        return JSON.parse(await session.page.evaluate<string>(`(() => { const cv = document.querySelector('canvas.mimir-2d-canvas'); const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let sx = 0, sy = 0, n = 0; for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) if (d[(y * cv.width + x) * 4 + 3] > 0) { sx += x; sy += y; n++ } return JSON.stringify({ x: sx / n * 1280 / cv.width, y: sy / n * 720 / cv.height, n }) })()`, 20_000))
      }
      const info = await session.host<any>('info')
      const a = await middle(0), b = await middle(info.steps[0].t1 - 0.01)
      expect(a.n).toBeGreaterThan(50)
      expect(Math.abs(a.x - 280)).toBeLessThan(12)
      expect(Math.abs(a.y - 360)).toBeLessThan(12)
      expect(Math.abs(b.x - a.x - 180)).toBeLessThan(12)
      expect(Math.abs(b.y - a.y + 90)).toBeLessThan(12)
    } finally {
      await session.close()
      process.env.TMPDIR = prev
    }
  }, T)

  test('a chunk carries its own copy of a pure library; over a budget the build fails and the CLI marks its answer stale', async () => {
    const start = buildInfo()
    // the case of the report: an index.ts uses one small function of a library, the module's chunk a big one of the same file
    write('src/zzlib/index.ts', `import { arrangeRing } from '../lib/layout/index.ts'\nexport const slot: { layout?: unknown } = {}\nexport const zzRing = (n: number) => arrangeRing(Array.from({ length: n }, () => ({ width: 1, height: 1 })), { radius: 2 }).positions\nexport const api = { zzRing }\n`)
    write('src/zzlib/zzlib.chunk.ts', `import { forceLayout, layoutGraph, layoutTree } from '../lib/layout/index.ts'\nimport { measurePath, pointAt } from '../lib/path/index.ts'\nimport { slot } from './index.ts'\nslot.layout = { forceLayout, layoutGraph, layoutTree, measurePath, pointAt }\n`)
    const ok = await build()
    expect(ok.stderr).toBe('')
    expect(ok.code).toBe(0)
    const info = buildInfo()
    const grew = gzipOf(info, 'core') - gzipOf(start, 'core')
    console.log(`  an index.ts that uses arrangeRing costs mimir.js ${(grew / 1024).toFixed(1)} KB; the chunk with the graph, tree and force layouts is ${(gzipOf(info, 'zzlib') / 1024).toFixed(1)} KB (gzip)`)
    expect(grew).toBeLessThan(2 * 1024) // it was +13.5 KB: the whole library file was kept for the chunk's sake
    expect(gzipOf(info, 'zzlib')).toBeGreaterThan(4 * 1024) // the weight is where it is used
    // the bridge hands over names, never a whole module
    const bridge = readFileSync(join(REPO, 'src', '_generated', 'bridge.ts'), 'utf8')
    expect(bridge).not.toContain('import * as')
    expect(bridge).not.toContain('../lib/')
    expect(bridge).toContain(`import { slot as `)

    // an index.ts that takes the weight into the main chunk: with the budgets on (the default) the build fails …
    write('src/zzfat/index.ts', `import { forceLayout, layoutGraph, layoutTree, placeLabels } from '../lib/layout/index.ts'\nexport const zzFat = { forceLayout, layoutGraph, layoutTree, placeLabels }\nexport const api = { zzFat }\n`)
    const stamp = readFileSync(join(REPO, 'dist', 'build.json'), 'utf8')
    const over = await build(STRICT)
    expect(over.code).toBe(1)
    expect(over.stderr).toMatch(/over budget \(DESIGN D13\): mimir\.js is \d+\.\d KB gzip \(limit 60\)/)
    expect(over.stderr).toContain('Sizes: mimir.js')
    expect(readFileSync(join(REPO, 'dist', 'build.json'), 'utf8')).toBe(stamp) // the last good dist is untouched
    expect(readdirSync(join(REPO, 'dist')).filter((f) => f.startsWith('.build-'))).toEqual([])
    // … and every command answers from the last good build and says so on stdout, not only on stderr
    const stale = await mimir(['check', 'examples/hello-2d.scene.js'], STRICT)
    expect(stale.code).toBe(0)
    const out = JSON.parse(stale.stdout)
    expect(out).toMatchObject({ ok: true, errors: 0, stale: true })
    expect(out.build_error).toContain('over budget')
    expect(stale.stderr).toContain('WARNING: building the viewer failed')
    expect((await mimir(['check', 'examples/hello-2d.scene.js', '--text'], STRICT)).stdout).toMatch(/^OK 0 errors, 0 warnings - STALE: /)
    const shot = JSON.parse((await mimir(['shot', '--json', 'examples/hello-2d.scene.js', '--step', '1', '--out', mkdtempSync(join(WORK, 'stale-'))], STRICT)).stdout)
    expect(shot[0].stale).toBe(true)
    const exp = JSON.parse((await mimir(['export', 'examples/hello-2d.scene.js', '-o', join(WORK, 'stale.html')], STRICT)).stdout)
    expect(exp.stale).toBe(true)
    expect(exp.warnings.join(' ')).toContain('last good build')
    // --no-strict builds it anyway and says what is over
    const lenient = await run(['bun', 'scripts/build.ts', '--no-strict'], STRICT)
    expect(lenient.code).toBe(0)
    expect(lenient.stdout).toMatch(/OVER BUDGET \(core[,)]/) // (the code of all chunks together may be over as well: the two scratch modules add 10 KB)
    rmSync(join(REPO, 'src', 'zzfat'), { recursive: true })
    rmSync(join(REPO, 'src', 'zzlib'), { recursive: true })
    const clean = await build()
    expect(clean.code).toBe(0)
    expect('stale' in JSON.parse((await mimir(['check', 'examples/hello-2d.scene.js'])).stdout)).toBe(false)
  }, T)

  test('the build refuses a chunk file it would leave out, a kind that names a chunk nobody makes, and names the line of a file that does not parse', async () => {
    write('src/zzbad/zzGraph.chunk.ts', `export {}\n`)
    const name = await build()
    expect(name.code).toBe(1)
    expect(name.stderr).toContain('src/zzbad/zzGraph.chunk.ts is not a valid chunk file name')
    expect(name.stderr).toContain('lowercase letters and digits')
    rmSync(join(REPO, 'src', 'zzbad'), { recursive: true })
    write('src/zzbad/index.ts', `import { boxOf, defineKind } from '../core/index.ts'\nexport const zzOrphan = defineKind({ name: 'zzOrphan', space: '2d', chunk: 'zzgraphh', schema: {}, bounds: () => boxOf(1, 1, 0) })\nexport const api = { zzOrphan }\n`)
    const kind = await build()
    expect(kind.code).toBe(1)
    expect(kind.stderr).toContain('the kind "zzOrphan" (src/zzbad/index.ts) names the lazy chunk "zzgraphh", which does not exist')
    write('src/zzbad/index.ts', `export const api = {}\nconst broken = (\n`)
    const syntax = await build()
    expect(syntax.code).toBe(1)
    expect(syntax.stderr).toContain('src/zzbad/index.ts does not build')
    expect(syntax.stderr).toMatch(/src\/zzbad\/index\.ts:\d+:\d+: /)
    expect(syntax.stderr).not.toContain('without a DOM')
    rmSync(join(REPO, 'src', 'zzbad'), { recursive: true })
    expect((await build()).code).toBe(0)
  }, T)

  test('a name registered twice fails the build with both owners; the CLI answers from the last good build; override: true is accepted', async () => {
    write('src/clash/index.ts', `import { boxOf, defineKind, defineStepAction } from '../core/index.ts'\ndefineKind({ name: 'rect', space: '2d', schema: {}, bounds: () => boxOf(9, 9, 0) })\ndefineStepAction('label', () => {})\nexport const api = {}\n`)
    const bad = await build()
    expect(bad.code).toBe(1)
    expect(bad.stderr).toContain('2 names are registered twice')
    expect(bad.stderr).toContain('kind "rect": src/r2d/kinds.ts and src/clash/index.ts')
    expect(bad.stderr).toMatch(/stepAction "label": src\/(guide\/index\.ts and src\/clash|clash\/index\.ts and src\/guide)\/index\.ts/) // whichever loads first owns it
    expect(bad.stderr).toContain('override: true')
    // the broken module does not take the CLI down: the last good dist answers, loudly
    const still = await mimir(['check', 'examples/hello-2d.scene.js'])
    expect(JSON.parse(still.stdout)).toMatchObject({ ok: true, errors: 0 })
    expect(still.code).toBe(0)
    expect(still.stderr).toContain('WARNING: building the viewer failed')
    expect(still.stderr).toContain('using the last good build')
    // replacing on purpose
    write('src/clash/index.ts', `import { boxOf, defineKind } from '../core/index.ts'\nexport const fragile = defineKind({ name: 'fragile', space: '2d', schema: {}, bounds: () => boxOf(1, 1, 0), build: (_n: unknown, c: any) => c.el('g'), update() { throw new Error('backend exploded') } })\ndefineKind({ name: 'placeholder', space: '2d', override: true, inert: true, schema: {}, bounds: () => boxOf(0.2, 0.2, 0) })\nexport const api = { fragile }\n`)
    write('src/clash/api.d.ts', `/** Always fails to draw (a test of error reporting). */\ndeclare function fragile(opts?: { id?: string }): Mob\n`)
    const good = await build()
    expect(good.stderr).toBe('')
    expect(good.code).toBe(0)
  }, T)

  test('an exception inside a kind backend is one RUNTIME-ERROR at the line that created the object; the rest still renders', async () => {
    write('fragile.scene.js', `import { scene, fragile, rect } from 'mimir'\nexport default scene({ title: 'Fragile' }, (s) => {\n  rect({ id: 'fine' })\n  fragile({ id: 'breaks' }).at(3, 0)\n  s.step('x', (st) => { st.wait(1) })\n})\n`)
    const r = await mimir(['check', 'fragile.scene.js', '--all'])
    const out = JSON.parse(r.stdout)
    expect(r.code).toBe(1)
    expect(out.diagnostics.length).toBe(1)
    expect(out.diagnostics[0]).toMatchObject({ code: 'RUNTIME-ERROR', ids: ['breaks'], file: 'fragile.scene.js', line: 4 })
    expect(out.diagnostics[0].what).toContain('backend exploded')
    expect(out.diagnostics[0].fix[0]).toContain('the fragile created on this line could not be drawn')
    const shot = await mimir(['shot', '--json', 'fragile.scene.js', '--out', mkdtempSync(join(WORK, 'fragile-'))])
    expect(shot.code).toBe(0)
  }, T)

  test('removing a module: the next command rebuilds, and its chunk, barrels, rules, names and reference entries are gone', async () => {
    expect(existsSync(join(REPO, 'dist', 'mimir.demo.js'))).toBe(true)
    rmSync(join(REPO, 'src', 'demo'), { recursive: true })
    rmSync(join(REPO, 'src', 'clash'), { recursive: true })
    const r = await mimir(['check', 'examples/hello-3d.scene.js'])
    expect(r.stderr).toContain('rebuilding the viewer (a module or file was added, removed or renamed since dist was built)')
    expect(r.stderr).not.toContain('WARNING')
    expect(JSON.parse(r.stdout)).toEqual({ ok: true, errors: 0, warnings: 0, total: 0, shown: 0, diagnostics: [] })
    expect(existsSync(join(REPO, 'dist', 'mimir.demo.js'))).toBe(false)
    // the barrels of the two removed modules are gone; those of every other module (one per chunk it ships) stay
    const barrels = readdirSync(join(REPO, 'src', '_generated')).sort()
    expect(barrels).toEqual(expect.arrayContaining(['bridge.ts', 'check.ts', 'chunks.ts', 'core.ts', 'three.ts']))
    expect(barrels.filter((f) => /demo|clash/.test(f))).toEqual([])
    for (const f of readdirSync(join(REPO, 'src', '_generated'))) expect(readFileSync(join(REPO, 'src', '_generated', f), 'utf8')).not.toMatch(/demo|clash/)
    expect(readFileSync(join(REPO, 'types', 'mimir.d.ts'), 'utf8')).not.toMatch(/gauge|fragile/)
    const docs = await mimir(['docs', 'gauge'])
    expect(docs.code).toBe(2)
    // the scene that used the module now says which name is gone, with its line
    const gone = JSON.parse((await mimir(['check', 'demo.scene.js'])).stdout)
    expect(gone.diagnostics[0]).toMatchObject({ code: 'RUNTIME-ERROR', line: 1 })
    expect(gone.diagnostics[0].what).toContain('is not part of the mimir API')
    // a second command finds dist current and does not build again
    const again = await mimir(['check', 'examples/hello-2d.scene.js'])
    expect(again.stderr).not.toContain('building the viewer')
    const tsc = await run(['bunx', 'tsc', '--noEmit', '-p', '.'])
    expect(tsc.stdout + tsc.stderr).toBe('')
  }, T)

  test('a fresh clone: no generated barrels, no typed reference, no dist: docs answers, typecheck and a test run make what they need', async () => {
    const wipe = (): void => { for (const d of [join('src', '_generated'), 'types', 'dist']) rmSync(join(REPO, d), { recursive: true, force: true }) }
    wipe()
    const docs = await mimir(['docs', 'box'])
    expect(docs.stderr).toContain('building the viewer (dist is missing)')
    expect(docs.stdout).toContain('declare function box(')
    wipe()
    // the package's own typecheck script writes the barrels first
    const script = (JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts.typecheck!
    expect(script).toContain('scripts/build.ts --barrels')
    const tsc = await run(['sh', '-c', script.replace(/\btsc\b/, 'bunx tsc')])
    expect(tsc.stdout + tsc.stderr).toBe('')
    expect(tsc.code).toBe(0)
    expect(existsSync(join(REPO, 'dist'))).toBe(false) // barrels and types only: nothing was bundled
    wipe()
    // `bun test` preloads tests/setup.ts, which writes them when they are missing
    for (const f of ['bunfig.toml', join('tests', 'setup.ts')]) { mkdirSync(dirname(join(REPO, f)), { recursive: true }); cpSync(join(ROOT, f), join(REPO, f)) }
    write(join('tests', 'generated.test.ts'), `import { expect, test } from 'bun:test'\nimport { FEATURES } from '../src/_generated/chunks.ts'\nimport { existsSync } from 'node:fs'\ntest('generated', () => { expect(FEATURES.length).toBeGreaterThan(0); expect(existsSync('types/mimir.d.ts')).toBe(true) })\n`)
    const t = await run(['bun', 'test', 'tests/generated.test.ts'])
    expect(t.stderr).toContain('1 pass')
    expect(t.code).toBe(0)
    // nothing that is generated is meant for git
    const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf8').split('\n')
    for (const line of ['src/_generated/', 'types/mimir.d.ts', 'types/mimir.module.d.ts', 'dist/']) expect(ignore).toContain(line)
  }, T)

  test('a player in its own chunk (src/player/player.chunk.ts) is loaded only with a person watching, and the page still plays', async () => {
    // the player of this tree is built that way: src/player/index.ts is the side every scene carries (what the chrome
    // must know about a scene), src/player/player.chunk.ts is the chrome itself
    expect(existsSync(join(REPO, 'src', 'player', 'player.chunk.ts'))).toBe(true)
    const b = await build()
    expect(b.stderr).toBe('')
    const info = buildInfo()
    expect(info.chunks.find((c) => c.chunk === 'player')).toMatchObject({ file: 'mimir.player.js', dev: false })
    console.log(`  the player as a chunk of its own: mimir.js ${(gzipOf(info, 'core') / 1024).toFixed(1)} KB gzip, mimir.player.js ${(gzipOf(info, 'player') / 1024).toFixed(1)} KB`)
    // the chrome is not in the core: the first load of a headless frame does not pay for it
    expect(readFileSync(join(REPO, 'dist', 'mimir.js'), 'utf8')).not.toContain('data-a="play"')
    expect(readFileSync(join(REPO, 'dist', 'mimir.player.js'), 'utf8')).toContain('data-a="play"')
    const prev = process.env.TMPDIR
    process.env.TMPDIR = TMP
    const session = await openSession({ scene: resolveScene(join(REPO, 'examples', 'hello-2d.scene.js'), REPO, 'check'), viewerRoot: join(REPO, 'dist'), width: 640, height: 360, scale: 1 })
    try {
      const files = (page: { evaluate: <T>(e: string) => Promise<T> }): Promise<string[]> => page.evaluate<string[]>(`performance.getEntriesByType('resource').map((e) => e.name.split('/').pop()).filter((n) => /^mimir\\./.test(n))`)
      expect(await files(session.page)).not.toContain('mimir.player.js') // the headless page of check and shot
      const live = await session.browser.newPage(640, 360, 1, { window: true })
      await live.navigate(`${session.server.origin}/viewer.html?scene=${encodeURIComponent(session.pageUrl.split('scene=')[1]!.split('&')[0]!).replace(/%25/g, '%')}`)
      let tau = 0
      for (let i = 0; i < 200 && !(tau > 0.1); i++) { await Bun.sleep(50); tau = await live.evaluate<number>(`(globalThis.__mimir && __mimir.state ? __mimir.state().tau : 0)`).catch(() => 0) }
      expect(tau).toBeGreaterThan(0.1) // it plays on its own
      expect(await files(live)).toContain('mimir.player.js')
      expect(await live.evaluate<boolean>(`!!document.querySelector('[data-a=play]')`)).toBe(true) // the player drew its transport
    } finally {
      await session.close()
      process.env.TMPDIR = prev
    }
  }, T)
})
