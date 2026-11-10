// The proof of explain(): each quick example renders in a real browser, `mimir check` is clean, and the pictures at
// three steps differ. Skipped (not passed) where the repository cannot build the viewer.
import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..', '..', '..')
const BIN = join(ROOT, 'bin', 'mimir')
const HAVE = existsSync(join(ROOT, 'scripts', 'build.ts')) && existsSync(join(ROOT, 'node_modules', 'three'))
const EXAMPLES = ['quick-binary-search', 'quick-handshake', 'quick-bubble-sort']
/** lines of the script itself: no comments, no blank lines */
const scriptLines = (file: string): number => readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() && !l.trim().startsWith('//')).length
async function mimir(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([BIN, ...args], { cwd: ROOT, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { code, stdout, stderr }
}

describe.skipIf(!HAVE)('quick examples in the browser', () => {
  for (const name of EXAMPLES) {
    const file = join(ROOT, 'examples', `${name}.scene.js`)
    test(`${name}: short, check is clean, and three steps show three different pictures`, async () => {
      expect(scriptLines(file)).toBeLessThanOrEqual(25)
      // the script holds no position, size, duration or camera
      expect(readFileSync(file, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')).not.toMatch(/\.at\(|duration|camera|width|height|st\.wait|\bsize\b/)
      const check = await mimir(['check', file, '--json'])
      const report = JSON.parse(check.stdout) as { ok: boolean; total: number; diagnostics: unknown[] }
      expect(report.diagnostics).toEqual([])
      expect(report.ok).toBe(true)
      expect(check.code).toBe(0)
      const out = mkdtempSync(join(tmpdir(), 'mimir-quick-'))
      try {
        const shot = await mimir(['shot', file, '--steps', '--out', out, '--json'])
        expect(shot.code).toBe(0)
        const frames = JSON.parse(shot.stdout) as { step: number; sha256: string }[]
        expect(frames.length).toBeGreaterThanOrEqual(3)
        const picked = [frames[0]!, frames[Math.floor(frames.length / 2)]!, frames[frames.length - 1]!].map((f) => f.sha256)
        expect(new Set(picked).size).toBe(3)
      } finally { rmSync(out, { recursive: true, force: true }) }
    }, 60000)
  }
})
