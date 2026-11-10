// The flow and sim modules through the real CLI and a real headless browser: the two example scenes and the two
// all-effects scenes pass `mimir check`, and the same story times shot in different orders give the same pixels
// (inside one step and across steps). Skipped where no browser can be started (the CLI says so with exit 2).
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..', '..', '..')
const BIN = join(ROOT, 'bin', 'mimir')
const SCENES: [name: string, file: string, times: number[]][] = [
  ['pendulum', join(ROOT, 'examples', 'pendulum.scene.js'), [0.6, 7.31, 7.36, 14.05, 25.6]],
  ['pipe-flow', join(ROOT, 'examples', 'pipe-flow.scene.js'), [2.2, 9.1, 9.15, 24.4, 27]],
  ['flow in 2D', join(import.meta.dir, 'scenes', 'flow-2d.scene.js'), [1.25, 3.5, 5.5]],
  ['flow in 3D', join(import.meta.dir, 'scenes', 'flow-3d.scene.js'), [1.3, 3, 5.5]],
]
interface Result { code: number; stdout: string; stderr: string }
async function mimir(args: string[]): Promise<Result> {
  const proc = Bun.spawn([BIN, ...args], { cwd: ROOT, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { code, stdout, stderr }
}
/** exit 2 with nothing on stdout = the CLI could not run at all here (no browser): nothing was measured */
const unavailable = (r: Result): boolean => r.code === 2 && !r.stdout.trim()

describe('flow and sim scenes in the real viewer', () => {
  for (const [name, file, times] of SCENES) {
    test(`${name}: check is clean`, async () => {
      const r = await mimir(['check', file, '--json', '--all'])
      if (unavailable(r)) { console.warn(`  skipped (no browser): ${r.stderr.trim().split('\n').pop()}`); return }
      const out = JSON.parse(r.stdout) as { ok: boolean; errors: number; warnings: number; stale?: boolean; diagnostics: { code: string; what: string }[] }
      expect(out.diagnostics.map((d) => `${d.code}: ${d.what}`)).toEqual([])
      expect(out.ok).toBe(true)
      expect(out.stale).toBeUndefined()
      expect(r.code).toBe(0)
    }, 60_000)

    test(`${name}: the same times in another order are the same pixels`, async () => {
      const shoot = async (order: number[]): Promise<Map<string, string> | null> => {
        const dir = mkdtempSync(join(tmpdir(), 'mimir-flow-'))
        try {
          const r = await mimir(['shot', file, '--at', order.join(','), '--out', dir, '--json'])
          if (unavailable(r)) return null
          expect(r.code).toBe(0)
          return new Map((JSON.parse(r.stdout) as { t: number; sha256: string }[]).map((f) => [f.t.toFixed(3), f.sha256]))
        } finally { rmSync(dir, { recursive: true, force: true }) }
      }
      const forward = await shoot(times)
      if (!forward) { console.warn('  skipped (no browser)'); return }
      const backward = await shoot([...times].reverse())
      expect(backward).not.toBeNull()
      expect([...backward!.entries()].sort()).toEqual([...forward.entries()].sort())
      // and the frames are not all one picture: time really moves the scene
      expect(new Set(forward.values()).size).toBe(times.length)
    }, 90_000)
  }
})
