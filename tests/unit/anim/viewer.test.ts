// The verbs in the real viewer (the CLI + a headless browser): the example checks clean, the lazy chunk is loaded
// and exported, and frames inside a write, a morph and a carried cross-fade are the same pixels whatever was shot
// before. Skipped, visibly, where no browser is installed.
import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { findChrome } from '../../../src/cli/chrome.ts'

const ROOT = resolve(import.meta.dir, '..', '..', '..')
const BIN = join(ROOT, 'bin', 'mimir')
const EXAMPLE = join(ROOT, 'examples', 'verbs.scene.js')
const SCENES = join(import.meta.dir, 'scenes')
const browser = (): boolean => { try { return !!findChrome() } catch { return false } }
const HAVE = existsSync(EXAMPLE) && existsSync(join(ROOT, 'scripts', 'build.ts')) && browser()

const WORK = mkdtempSync(join(tmpdir(), 'mimir-anim-'))
afterAll(() => rmSync(WORK, { recursive: true, force: true }))
const ENV: Record<string, string> = { ...(process.env as Record<string, string>), MIMIR_LAUNCH_DEPTH: '0' }
for (const k of ['MIMIR_VIEWER_ROOT', 'MIMIR_TIMEOUT', 'MIMIR_TYPES', 'MIMIR_CHROME_ARGS']) delete ENV[k]
async function mimir(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([BIN, ...args], { cwd: ROOT, env: ENV, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { code, stdout, stderr }
}
interface Shot { t: number | null; sha256: string }
async function shoot(scene: string, times: number[], dir: string, extra: string[] = []): Promise<Map<number, string>> {
  const r = await mimir(['shot', scene, '--at', times.join(','), '--out', join(WORK, dir), '--json', ...extra])
  expect(r.code).toBe(0)
  return new Map((JSON.parse(r.stdout) as Shot[]).filter((f) => f.t !== null).map((f) => [f.t as number, f.sha256]))
}
const T = 180_000 // the first command may build dist

describe.skipIf(!HAVE)('the verbs in the real viewer', () => {
  test('examples/verbs.scene.js and the two close-up scenes check clean', async () => {
    for (const scene of [EXAMPLE, join(SCENES, 'derive3d.scene.js'), join(SCENES, 'morphs.scene.js')]) {
      const r = await mimir(['check', scene, '--json', '--all'])
      const out = JSON.parse(r.stdout) as { ok: boolean; errors: number; warnings: number; diagnostics: { code: string; what: string }[] }
      expect(out.diagnostics.map((d) => `${d.code}: ${d.what}`)).toEqual([])
      expect([r.code, out.ok, out.errors, out.warnings]).toEqual([0, true, 0, 0])
    }
  }, T)
  test('same time, same pixels: inside a write, a move along a path, a derive, a carried cross-fade, a transform; three orders', async () => {
    // times spread over the plays of the example
    // (chosen again after the merge: every speaking step now starts with the guide's lead-in, and step 1 draws the circle before the title)
    const times = [0.45, 1.5, 3.1, 6.1, 7.7, 9.4, 11.0, 13.1, 14.4, 15.5, 16.6, 20.0, 21.5, 22.8, 28.0, 29.2, 34.5, 40.8, 42.5, 46.1]
    const asc = await shoot(EXAMPLE, times, 'asc')
    const desc = await shoot(EXAMPLE, [...times].reverse(), 'desc')
    const mixed = await shoot(EXAMPLE, times.map((_, i) => times[(i * 7) % times.length]!), 'mixed')
    expect(asc.size).toBe(times.length)
    expect(new Set(asc.values()).size).toBe(times.length) // every one of them is a different picture
    for (const t of times) expect([t, desc.get(t), mixed.get(t)]).toEqual([t, asc.get(t), asc.get(t)])
  }, T)
  test('a derive from a 3D part, at twice the pixel density, in two orders', async () => {
    const scene = join(SCENES, 'derive3d.scene.js'), times = [0.9, 4.4, 5.1, 6.6, 8.1, 10.3, 11.6]
    const a = await shoot(scene, times, '3d-a', ['--scale', '2'])
    const b = await shoot(scene, [...times].reverse(), '3d-b', ['--scale', '2'])
    for (const t of times) expect([t, b.get(t)]).toEqual([t, a.get(t)])
  }, T)
  test('the lazy chunk travels with the export, and only with scenes that need it', async () => {
    const out = join(WORK, 'verbs.html')
    const r = await mimir(['export', EXAMPLE, '-o', out, '--json'])
    expect(r.code).toBe(0)
    const res = JSON.parse(r.stdout) as { modules: string[]; verified: boolean }
    expect(res.modules).toContain('/mimir.anim.js')
    expect(res.verified).toBe(true)
    expect(readFileSync(out, 'utf8')).toContain('animMorph')
    const plain = await mimir(['export', join(ROOT, 'tests', 'e2e', 'scenes', 'real', 'empty.scene.js'), '-o', join(WORK, 'plain.html'), '--json'])
    if (plain.code === 0) expect((JSON.parse(plain.stdout) as { modules: string[] }).modules).not.toContain('/mimir.anim.js')
  }, T)
})
