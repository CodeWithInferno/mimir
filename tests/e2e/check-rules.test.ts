// End to end through `bin/mimir check`: every rule of src/check has a scene built to break it and one built to
// stay clean (tests/e2e/scenes/check/<rule>.bad.scene.js / .ok.scene.js). A rule that reports on the clean scene
// is a false positive, and a false positive teaches the author to ignore the tool: both directions are asserted.
// Also here: what a message must carry (DESIGN §7), "unknown, never pass", the examples, the time a full check takes,
// and the page side of `mimir query`.
import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openSession } from '../../src/cli/session.ts'
import { resolveScene } from '../../src/cli/paths.ts'

const ROOT = resolve(import.meta.dir, '..', '..')
const BIN = join(ROOT, 'bin', 'mimir')
const fixture = (name: string): string => join(import.meta.dir, 'scenes', 'check', `${name}.scene.js`)
const HAVE = existsSync(join(ROOT, 'scripts', 'build.ts')) && existsSync(join(ROOT, 'src', 'check', 'rules-solid.ts'))

const WORK = mkdtempSync(join(tmpdir(), 'mimir-check-'))
const TMP = join(WORK, 'tmp')
mkdirSync(TMP)
const ENV: Record<string, string> = { ...(process.env as Record<string, string>), TMPDIR: TMP, MIMIR_LAUNCH_DEPTH: '0' }
for (const k of ['MIMIR_VIEWER_ROOT', 'MIMIR_TIMEOUT', 'MIMIR_TYPES', 'MIMIR_CHROME_ARGS']) delete ENV[k]

interface Diag { code: string; severity: string; step: number | null; t: number | null; ids: string[]; file: string | null; line: number | null; measured: number | string | null; limit: number | string | null; what: string; fix: string[]; params?: Record<string, unknown> }
interface Result { code: number; out: { ok: boolean; errors: number; warnings: number; total: number; shown: number; diagnostics: Diag[] }; stderr: string; ms: number }
async function check(file: string, flags: string[] = ['--all']): Promise<Result> {
  const started = performance.now()
  const proc = Bun.spawn([BIN, 'check', file, ...flags], { cwd: ROOT, env: ENV, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  let out: Result['out']
  try { out = JSON.parse(stdout) } catch { throw new Error(`mimir check ${file} printed no JSON (exit ${code}):\n${stdout}\n${stderr}`) }
  return { code, out, stderr, ms: performance.now() - started }
}
/** several scenes at once, a few browsers at a time */
async function checkAll(names: string[]): Promise<Map<string, Result>> {
  const out = new Map<string, Result>()
  for (let i = 0; i < names.length; i += 5) await Promise.all(names.slice(i, i + 5).map(async (n) => { out.set(n, await check(fixture(n))) }))
  return out
}
const browsersRunning = (): string[] => Bun.spawnSync(['ps', '-axo', 'command=']).stdout.toString().split('\n').filter((l) => l.includes(WORK) && l.includes('--user-data-dir'))
afterEach(async () => {
  for (let i = 0; i < 40 && browsersRunning().length > 0; i++) await Bun.sleep(50)
  const processes = browsersRunning()
  const profiles = readdirSync(TMP).filter((n) => n.startsWith('mimir-chrome-'))
  for (const p of profiles) rmSync(join(TMP, p), { recursive: true, force: true })
  expect(processes).toEqual([])
  expect(profiles).toEqual([])
})
afterAll(() => rmSync(WORK, { recursive: true, force: true }))

const T = 240_000 // the first command may build dist

/** [rule, what the broken scene must report (code severity, in print order), assertions on the first diagnostic of the rule] */
const RULES: [string, string[], (d: Diag, all: Diag[]) => void][] = [
  ['place-none', ['PLACE-NONE error', 'PLACE-NONE error'], (d, all) => {
    expect(d).toMatchObject({ ids: ['spring', 'retainer'], step: 1, line: 6 })
    expect(d.what).toBe('2 objects were never placed, so they all sit at the origin on top of each other: #spring, #retainer.')
    expect(d.fix[0]).toBe("place each on the one it belongs to: retainer.attach(spring, { my: 'bottom', to: 'top' })")
    expect(all[1]!.ids).toEqual(['a', 'b', 'c'])
  }],
  ['occluded', ['OCCLUDED error'], (d) => {
    expect(d).toMatchObject({ ids: ['ball'], step: 1, measured: 0, limit: 30, line: 8 }) // one limit with the guide's GUIDE-TARGET (it was 60)
    expect(d.what).toMatch(/^none of #ball can be seen at the end of step 1 \(0 of \d+ px\) while it is labelled there \(at least 30%\): #wall is in front of it\.$/)
    expect(d.fix[0]).toBe('see through what is in front: st.ghost(wall)') // (wall.material('ghost') before the 3D layer had view modes)
    expect(d.fix[1]).toMatch(/^look from where it shows: st\.camera\(\{ view: '\w+' \}\) shows \d+% of it$/) // a view that was rendered and measured
  }],
  ['floating', ['FLOATING error', 'HATCH-USE info'], (d) => {
    expect(d).toMatchObject({ ids: ['lamp'], step: 1, measured: 0.3, line: 6 })
    expect(d.what).toBe('#lamp touches nothing else: the nearest part, #top, is 0.3 units away (along -Y).')
    expect(d.fix).toEqual(["close the gap with a relation: lamp.nextTo(top, 'up', 0)", 'or move it by the gap: lamp.shift(0, -0.3, 0)', "if it is meant to hang free: lamp.allow('FLOATING')"])
  }],
  ['interpenetrate', ['INTERPENETRATE error', 'HATCH-USE info'], (d) => {
    expect(d).toMatchObject({ ids: ['slider', 'rail'], step: 1, measured: 0.1, limit: 0.008, line: 6 })
    expect(d.what).toBe('#slider and #rail overlap by 0.1 units at the end of step 1 (limit 0.008: 2% of the thinner part) and they move against each other: a collision.')
    expect(d.fix.at(-1)).toMatch(/^see it: mimir shot .*interpenetrate\.bad\.scene\.js --step 1$/)
  }],
  ['collide-in-motion', ['COLLIDE-IN-MOTION error'], (d) => {
    expect(d).toMatchObject({ ids: ['ram', 'post'], step: 2, measured: 0.25, line: 7 })
    expect(d.what).toMatch(/^#ram passes through #post \(0\.25 units deep\) 50% of the way through step 2 \(t = [\d.]+ s\); they are clear at the end of every step, so the still frames do not show it\.$/)
    expect(d.fix.at(-1)).toMatch(/^see it: mimir shot .*collide-in-motion\.bad\.scene\.js --at [\d.]+$/)
  }],
  ['expect-failed', ['EXPECT-FAILED error', 'EXPECT-FAILED error', 'EXPECT-FAILED error', 'EXPECT-FAILED error'], (d, all) => {
    expect(d).toMatchObject({ ids: ['valve', 'piston'], step: 2, measured: 1.3, line: 13 })
    expect(d.what).toMatch(/^expect\.above\(valve, piston\) is false .* the lowest point of #valve \(y = 1\.3\) is [\d.]+ below the top of #piston \(y = [\d.]+\)\. It fails in \d+ of the \d+ states/)
    expect(all.map((x) => x.line)).toEqual([13, 14, 15, 16])
    expect(all[1]!.what).toMatch(/^"the lift stays under 1" is false .*the probes there: crankAngle = /)
    expect(all[2]!.what).toMatch(/a ratio of 1, expected 0\.5/) // the cam at crank speed: no collision anywhere, only the claim can catch it
    expect(all[3]!.what).toMatch(/"rodLength" goes from 3 at the end of step 1 to 4 when crank = 720 \(its maximum\)/)
  }],
  // (SAY-LONG is the guide's word on the same caption: it is one sentence of 50 words)
  ['text-long', ['TEXT-LONG warn', 'TEXT-LONG warn', 'SAY-LONG warn'], (d, all) => {
    expect(d).toMatchObject({ measured: 263, limit: 180, line: 6 })
    expect(all[1]).toMatchObject({ ids: ['queue'], measured: 9, limit: 4, line: 7 })
  }],
  ['label-covers', ['LABEL-COVERS warn'], (d) => {
    expect(d).toMatchObject({ ids: ['worker', 'note'], step: 1, limit: 25 })
    expect(d.what).toMatch(/^text "takes one request" hides \d+% of #worker, which is focused in this step \(at most 25%\)\.$/)
    expect(d.fix[0]).toBe("move the text off it: note.nextTo(worker, 'up')")
  }],
  ['text-tiny', ['TEXT-TINY error'], (d) => {
    expect(d).toMatchObject({ ids: ['fine', 'shrunk'], measured: 7.3, limit: 14 })
    expect(d.what).toBe('text "the fine print" is 7.3 px tall (minimum 14 px on a 720 px frame: 2% of its height). 1 more like it: #shrunk.')
  }],
  ['contrast-text', ['CONTRAST-TEXT error', 'CONTRAST-TEXT error', 'CONTRAST-TEXT error'], (d, all) => {
    expect(d).toMatchObject({ ids: ['dim'], measured: 2.2, limit: 4.5, line: 5 })
    expect(d.what).toBe('text "dark grey on black" has a contrast of 2.2:1 against the black background (#000000); text this size needs 4.5:1.')
    expect(all[1]!.what).toMatch(/against #sign \(#ffff00\)/)
    expect(all[1]!.fix[0]).toMatch(/^onSign\.color\(BLACK\) gives [\d.]+:1$/)
    expect(all[2]!.what).toMatch(/against the 3D model behind it \(#[0-9a-f]{6}\)/) // read back from the 3D canvas
  }],
  ['tiny', ['TINY warn', 'TINY warn'], (d, all) => {
    expect(d).toMatchObject({ ids: ['speck'], measured: 3.6, limit: 6 })
    expect(all[1]!).toMatchObject({ ids: ['chip'], measured: 18, limit: 29 })
    expect(all[1]!.fix[0]).toBe('move in on it: st.zoom(chip)')
  }],
  ['subject-fit', ['SUBJECT-FIT warn'], (d) => {
    expect(d.limit).toBe(45)
    expect(d.what).toMatch(/^everything drawn in the 3D panel fits in \d+% of its height \(\d+ x \d+ px of 1280 x 720\): the camera is about [\d.]+x too far\.$/)
    expect(d.fix[0]).toContain('st.camera() call of step 1')
  }],
  ['contained', ['CONTAINED error'], (d) => {
    expect(d).toMatchObject({ ids: ['core', 'housing'], line: 5 })
    expect(d.what).toBe('#core is completely inside #housing (100% of its surface), which is solid and opaque in every step: #core can never be seen.')
  }],
  ['coincident', ['COINCIDENT error'], (d) => {
    expect(d).toMatchObject({ ids: ['intake', 'exhaust'], measured: 100, limit: 90, line: 6 })
  }],
  ['param-breaks', ['PARAM-BREAKS error'], (d) => {
    expect(d).toMatchObject({ ids: ['piston', 'head'], measured: 0.3, params: { stroke: 3 } })
    expect(d.what).toBe('the scene is sound where the story has "stroke", but when stroke = 3 (its maximum) #piston cuts 0.3 units into #head (INTERPENETRATE).')
    expect(d.fix.at(-1)).toMatch(/--step 1 --set stroke=3$/)
  }],
  ['camera-clip', ['CAMERA-CLIP error'], (d) => {
    expect(d).toMatchObject({ ids: ['block'], step: 2 })
    expect(d.what).toBe('the camera is inside #block at the end of step 2: the frame shows the inside of the part, or nothing.')
  }],
  ['hatch-use', ['FLOATING error', 'HATCH-USE info'], (d) => {
    expect(d).toMatchObject({ severity: 'info', ids: ['cap'], measured: 100, limit: 30 })
    expect(d.what).toBe('3 of 3 placed objects use literal coordinates (.at(x, y, z)); 1 of them is behind FLOATING: #cap.')
  }],
  ['chapter-long', ['CHAPTER-LONG warn'], (d) => {
    expect(d).toMatchObject({ measured: 104, limit: 90, line: 5 })
    expect(d.what).toBe('chapter 1 "Everything at once" lasts 104 s (2 steps; about 90 s at most).')
  }],
  ['color-count', ['COLOR-COUNT warn'], (d) => {
    expect(d).toMatchObject({ measured: 5, limit: 3 })
  }],
  ['mech-open', ['MECH-OPEN warn'], (d) => {
    expect(d.ids).toEqual(['rod'])
    expect(d.what).toMatch(/^#rod spans two points whose distance goes from [\d.]+ .* to [\d.]+ .*: a rigid rod cannot change length by [\d.]+\.$/)
    expect(d.fix[1]).toBe("if it is meant to stretch (a spring, a beam, a string): rod.allow('MECH-OPEN')")
  }],
]

describe.skipIf(!HAVE)('check rules, through bin/mimir check', () => {
  test('every rule reports on the scene built to break it: the right code, part, line, measured value, limit and literal fixes', async () => {
    const results = await checkAll(RULES.map(([name]) => `${name}.bad`))
    for (const [name, codes, more] of RULES) {
      const r = results.get(`${name}.bad`)!
      const got = r.out.diagnostics.map((d) => `${d.code} ${d.severity}`)
      expect([name, got]).toEqual([name, codes])
      expect([name, r.code]).toEqual([name, codes.some((c) => c.endsWith(' error')) ? 1 : 0])
      const code = name.toUpperCase()
      const mine = r.out.diagnostics.filter((d) => d.code === code)
      more(mine[0] ?? r.out.diagnostics[0]!, mine.length ? mine : r.out.diagnostics)
      // the message contract (DESIGN §7), for every diagnostic of every rule
      for (const d of r.out.diagnostics) {
        expect([name, d.code, d.file]).toEqual([name, d.code, `tests/e2e/scenes/check/${name}.bad.scene.js`])
        expect(typeof d.line).toBe('number') // the scene line
        expect(d.what).toMatch(/\d/) // a measured value
        expect(d.what).toMatch(/[.:]$|\)$/)
        expect(d.fix.length).toBeGreaterThanOrEqual(1)
        expect(d.fix.filter((f) => !f.startsWith('see it: ')).length).toBeLessThanOrEqual(3)
        if (!['TEXT-LONG', 'CHAPTER-LONG', 'SUBJECT-FIT', 'SAY-LONG'].includes(d.code)) expect([d.code, d.ids.length > 0 || d.code === 'EXPECT-FAILED']).toEqual([d.code, true]) // the part by id
        for (const id of d.ids) if (d.code !== 'TEXT-TINY') expect(d.what.includes(`#${id}`) || d.what.includes(id) || d.fix.join(' ').includes(id)).toBe(true)
      }
    }
  }, T)

  test('no rule reports on the scene built to stay clean (no false positive), nor on the examples', async () => {
    const names = [...RULES.map(([name]) => `${name}.ok`)]
    const results = await checkAll(names)
    for (const name of names) expect([name, results.get(name)!.out]).toEqual([name, { ok: true, errors: 0, warnings: 0, total: 0, shown: 0, diagnostics: [] }])
    const examples = readdirSync(join(ROOT, 'examples')).filter((f) => f.endsWith('.scene.js') && f !== 'broken.scene.js')
    for (let i = 0; i < examples.length; i += 5) {
      await Promise.all(examples.slice(i, i + 5).map(async (f) => {
        const r = await check(join(ROOT, 'examples', f))
        expect([f, r.out.diagnostics.map((d) => `${d.code} ${d.severity} ${d.ids.join(',')}: ${d.what}`)]).toEqual([f, []])
      }))
    }
  }, T)

  test('OCCLUDED: a housing is seen around what it holds; behind a wall it is hidden with its contents', async () => {
    // a cut sleeve whose plug covers most of its inner wall: 14% of its own pixels show, the plug shows in the rest
    const housing = await check(fixture('occluded.housing'))
    expect(housing.out.diagnostics.map((d) => `${d.code} ${d.severity}: ${d.what}`)).toEqual([])
    const session = await openSession({ scene: resolveScene(fixture('occluded.housing'), ROOT, 'check'), viewerRoot: join(ROOT, 'dist'), width: 1280, height: 720, scale: 1 })
    try {
      await session.page.evaluate<string>(`(async () => { const m = window.__mimir; if (typeof m.query !== 'function') await m.diagnostics({ rules: [] }); return 'ok' })()`, 20_000)
      const own = await session.host<{ visible: { ratio: number }[] }>('query', { what: 'visible', args: ['sleeve'], step: 1 })
      expect(own.visible[0]!.ratio).toBeLessThan(0.3) // the fixture would fail on its own pixels alone: the rule is what passes it
    } finally { await session.close() }
    // the same model behind a wall: nothing of the sleeve or of what it holds shows
    const covered = await check(fixture('occluded.covered'))
    expect(covered.code).toBe(1)
    const hidden = covered.out.diagnostics.find((d) => d.code === 'OCCLUDED' && d.severity === 'error')!
    expect(hidden).toMatchObject({ ids: ['sleeve'], measured: 0, limit: 30 })
    expect(hidden.what).toMatch(/#wall is in front of it\.$/)
  }, T)

  test('GUIDE-TARGET judges the story as it plays, not with the last sampled slider value still pinned', async () => {
    // an author met this four times in one scene: "#pointer is outside the frame then", at a story time where it was on stage
    const r = await check(fixture('guide-target.slider'))
    expect(r.out.diagnostics.filter((d) => d.code === 'GUIDE-TARGET')).toEqual([])
  }, T)

  test('two primitives that overlap and never move are asked about once, as a warning; what was not measured is said, never passed', async () => {
    const still = await check(fixture('interpenetrate.static'))
    expect(still.code).toBe(0)
    expect(still.out.diagnostics.map((d) => `${d.code} ${d.severity}`)).toEqual(['INTERPENETRATE warn', 'HATCH-USE info'])
    expect(still.out.diagnostics[0]!.fix[0]).toBe('if they are one body, say so: group([body, cabin])')
    const cone = await check(fixture('unknown.note'))
    expect(cone.code).toBe(0)
    // Before the merge a cone described no solid and this scene got the note "INTERPENETRATE unknown | #nozzle … not
    // measured". Every solid kind of the public API has a description now (cone, extrude, lathe, sweep, mesh), so the
    // cone standing on the block is measured and clean. The note itself (a module's kind with `solid: true` and no sdf)
    // is covered by tests/unit/check/solid.test.ts, the only place such a kind can still be made.
    expect(cone.out).toEqual({ ok: true, errors: 0, warnings: 0, total: 0, shown: 0, diagnostics: [] })
    const text = Bun.spawnSync([BIN, 'check', fixture('unknown.note'), '--text'], { cwd: ROOT, env: ENV }).stdout.toString()
    expect(text.trimEnd().split('\n').at(-1)).toBe('OK 0 errors, 0 warnings')
  }, T)

  test('at most 8 are printed, errors first and causes before effects', async () => {
    const file = join(WORK, 'many.scene.js') // written to the temp directory: the repository is left as it was
    writeFileSync(file, `import { scene, box, rect, text } from 'mimir'
export default scene({ title: 'Many problems' }, (s) => {
  s.viewport('right', 0.5)
  const unused = s.param('unused', { value: 0, min: 0, max: 1 })
  const base = box({ id: 'base', width: 6, height: 0.4, depth: 4 })
  for (let i = 0; i < 6; i++) box({ id: 'float' + i, width: 0.5, height: 0.5, depth: 0.5 }).at(-2.5 + i, 0.6, 0)
  for (let i = 0; i < 6; i++) text('small print number ' + i, { id: 't' + i, size: 8 }).at(-4, 3 - i * 0.6)
  rect({ id: 'wide', widht: 3 }).at(-5, -2)
  rect({ id: 'typed', width: 'big' }).at(-2, -2)
  rect({ id: 'gone', width: 2, height: 1 }).at(-9, 0)
  text('one text', { id: 'first' }).at(-3.5, -0.5)
  text('another text', { id: 'second' }).at(-3.4, -0.5)
  s.step('One', (st) => { st.say('Many things are wrong here.'); st.focus('nope'); for (let i = 0; i < 6; i++) st.label('float' + i, 'a label that is a whole sentence about it') })
  s.step('Two', (st) => { st.say('And nothing changes.'); for (let i = 0; i < 6; i++) st.label('float' + i, 'a label that is a whole sentence about it') })
})
`)
    try {
      const all = await check(file)
      const eight = await check(file, [])
      expect(all.out.total).toBeGreaterThan(8)
      expect(eight.out).toMatchObject({ total: all.out.total, shown: 8 })
      expect(eight.out.diagnostics.length).toBe(8)
      const sev = eight.out.diagnostics.map((d) => d.severity)
      expect(sev).toEqual([...sev].sort((a, b) => ['error', 'warn', 'info', 'unknown'].indexOf(a) - ['error', 'warn', 'info', 'unknown'].indexOf(b)))
      expect(eight.out.diagnostics.slice(0, 3).map((d) => d.code)).toEqual(['API-UNKNOWN', 'API-TYPE', 'REF-MISSING']) // the calls that are wrong come before what was measured
      // six parts that hover the same way, six texts that are too small and twelve labels that are too long are one line each
      for (const code of ['FLOATING', 'TEXT-TINY', 'TEXT-LONG']) {
        expect([code, all.out.diagnostics.filter((d) => d.code === code).length]).toEqual([code, 1])
        expect(all.out.diagnostics.find((d) => d.code === code)!.what).toMatch(/\d+ more like it: #/)
      }
      expect(all.out.diagnostics.find((d) => d.code === 'FLOATING')!.ids).toEqual(['float0', 'float1', 'float2', 'float3', 'float4', 'float5'])
      // nothing measured is said about the two objects whose constructor calls are wrong
      expect(all.out.diagnostics.filter((d) => !d.code.startsWith('API-') && (d.ids.includes('wide') || d.ids.includes('typed')))).toEqual([])
    } finally { rmSync(file, { force: true }) }
  }, T)

  test('performance: a full check of a 40-part, 8-step 3D scene takes a few seconds, most of it the browser starting', async () => {
    const file = join(WORK, 'forty.scene.js')
    writeFileSync(file, `import { scene, box, cylinder, GREY_B, BLUE } from 'mimir'
export default scene({ title: 'Forty parts' }, (s) => {
  const crank = s.param('crank', { value: 0, min: 0, max: 360, unit: '°' })
  const lift = s.param('lift', { value: 0, min: 0, max: 1 })
  const base = box({ id: 'base', width: 12, height: 0.4, depth: 6, color: GREY_B })
  // three rows, the back one tallest, so that every post shows
  const posts = Array.from({ length: 36 }, (_, i) => { const h = 2.6 - Math.floor(i / 12) * 0.8; return box({ id: 'post' + i, width: 0.4, height: h, depth: 0.4 }).at(-5.5 + (i % 12), 0.2 + h / 2, -2 + Math.floor(i / 12) * 2) })
  const wheel = cylinder({ id: 'wheel', radius: 0.45, height: 0.3, color: BLUE }).nextTo(posts[5], 'up', 0).rotate({ about: 'y', deg: crank })
  const cap = box({ id: 'cap', width: 0.6, height: 0.2, depth: 0.6, color: BLUE }).nextTo(posts[20], 'up', 0)
  const plate = box({ id: 'plate', width: 0.8, height: 0.1, depth: 0.8 }).nextTo(posts[30], 'up', () => lift() * 0.4)
  for (let k = 0; k < 8; k++) s.step('Step ' + (k + 1), (st) => { st.say('Step ' + (k + 1) + ' turns the wheel a little further.'); st.set(crank, 45 * (k + 1)); if (k === 3) st.set(lift, 1); st.label(k % 2 ? wheel : cap, k % 2 ? 'wheel' : 'cap'); st.focus(wheel, cap, plate) })
})
`)
    try {
      const session = await openSession({ scene: resolveScene(file, ROOT, 'check'), viewerRoot: join(ROOT, 'dist'), width: 1280, height: 720, scale: 1 })
      let stats: { ms: number; samples: number; rendered: number; idPasses: number; pairTests: number; pairHits: number } | null = null
      let parts = 0, steps = 0, total = -1
      try {
        const info = session.info
        parts = info.parts.length; steps = info.steps.length
        const started = performance.now()
        const diags = await session.host<Diag[]>('diagnostics', { sample: true })
        const wall = performance.now() - started
        total = diags.length
        stats = JSON.parse(await session.page.evaluate<string>('JSON.stringify(globalThis.__mimirCheck)', 10_000))
        console.log(`  check of ${parts} parts x ${steps} steps in the page: ${Math.round(wall)} ms (engine ${stats!.ms} ms; ${stats!.samples} samples, ${stats!.rendered} rendered, ${stats!.idPasses} id passes, ${stats!.pairTests} pair measurements + ${stats!.pairHits} from the cache)`)
        expect(wall).toBeLessThan(5000)
      } finally { await session.close() }
      expect([parts, steps, total]).toEqual([40, 8, 0])
      expect(stats!.idPasses).toBeLessThanOrEqual(2 * 8) // a plain and a solo pass per step end at most: memoised, never one per rule
      const whole = await check(file)
      console.log(`  bin/mimir check of the same scene, browser start included: ${Math.round(whole.ms)} ms`)
      expect(whole.out.total).toBe(0)
      expect(whole.ms).toBeLessThan(15_000)
    } finally { rmSync(file, { force: true }) }
  }, T)

  test('mimir query, page side: distance, contacts, bounds, visible and state at a step or a slider setting; the page is left as it was', async () => {
    const session = await openSession({ scene: resolveScene(fixture('occluded.bad'), ROOT, 'check'), viewerRoot: join(ROOT, 'dist'), width: 1280, height: 720, scale: 1 })
    try {
      // __mimir.query() is the host's; a host without one gets it from the check chunk the first time diagnostics() runs
      await session.page.evaluate<string>(`(async () => { const m = window.__mimir; if (typeof m.query !== 'function') await m.diagnostics({ rules: [] }); return 'ok' })()`, 20_000)
      const before = await session.host<{ tau: number }>('state')
      // the form the CLI uses: about the state on screen
      await session.host('seek', 1)
      expect(await session.host<any>('query', 'distance', ['ball', 'floor'])).toMatchObject({ what: 'distance', t: 1, step: 1, relation: 'touching', gap: 0 })
      expect(await session.host<any>('query', 'distance', ['ball.top', 'wall'])).toMatchObject({ measured: 'point to surface (negative = inside)' })
      await session.host('seek', before.tau)
      const visible = await session.host<any>('query', { what: 'visible', args: ['ball', 'wall'], step: 1 })
      expect(visible.visible[0]).toMatchObject({ id: 'ball', onStage: true, visible: false, pixels: 0, ratio: 0, hiddenBy: ['wall'] })
      expect(visible.visible[0].total).toBeGreaterThan(1000)
      expect(visible.visible[1]).toMatchObject({ id: 'wall', visible: true, ratio: 1 })
      const d = await session.host<any>('query', { what: 'distance', args: ['ball', 'floor'], step: 1 })
      expect(d).toMatchObject({ a: 'ball', b: 'floor', relation: 'touching', gap: 0, measured: 'solids' })
      const c = await session.host<any>('query', { what: 'contacts', args: ['wall'], step: 1 })
      expect(c.contacts[0]).toMatchObject({ id: 'wall', touching: ['floor'], floating: false })
      const b = await session.host<any>('query', { what: 'bounds', args: ['ball'], step: 1 })
      expect(b.bounds[0]).toMatchObject({ id: 'ball', size: [1.2, 1.2, 1.2], center: [0, 0, 0] })
      expect(b.bounds[0].screen.width).toBeGreaterThan(20) // where it is on screen, in px
      const st = await session.host<any>('query', { what: 'state', t: 1 })
      expect(st).toMatchObject({ what: 'state', t: 1, step: 1, title: 'The ball', labelled: ['ball'] })
      expect(st.camera.distance).toBeGreaterThan(1)
      expect(await session.host<any>('query', { what: 'visible', args: ['bal'] })).toEqual({ error: 'no object has the id "bal".', fix: ['use "ball"'] })
      expect((await session.host<{ tau: number }>('state')).tau).toBe(before.tau)
    } finally { await session.close() }
  }, T)
})
