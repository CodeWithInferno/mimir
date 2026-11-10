// The page a model writes from (docs/topics/quick.md, what `mimir docs quick` prints and what a write-once call is
// given) must be true: every script on it is run through the real engine as written, and every name it tells an
// author to call is one the engine declares.
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../..')
const mimir = join(root, 'bin', 'mimir')
const work = mkdtempSync(join(tmpdir(), 'mimir-quick-ref-'))
const page = readFileSync(join(root, 'docs', 'topics', 'quick.md'), 'utf8')
const types = readFileSync(join(root, 'types', 'mimir.d.ts'), 'utf8')
const run = (args: string[]): { code: number; out: string } => { const p = Bun.spawnSync(args, { cwd: root, stdout: 'pipe', stderr: 'pipe' }); return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() } }

/** the scripts of the page: the code blocks that tell a story (the one-line shape of explain() is not a script) */
const scripts = [...page.matchAll(/```js\n([\s\S]*?)```/g)].map((m) => m[1]!).filter((code) => /\bstory\s*:\s*(\[|function)/.test(code))
/** the import line a script of the page stands under when it has none of its own */
const head = /```js\n(import \{[^}]*\} from 'mimir')\n/.exec(page)?.[1] ?? ''

describe('the reference of explain()', () => {
  test('has its scripts, and the import line they stand under', () => {
    expect(scripts.length).toBeGreaterThanOrEqual(4)
    expect(head).toContain('explain')
  })
  test.each(scripts.map((code, i) => [i + 1, code] as const))('script %i renders as written: check clean, review clean', (i, code) => {
    const file = join(work, `script${i}.scene.js`)
    writeFileSync(file, code.includes("from 'mimir'") ? code : `${head}\n${code}`)
    const check = run([mimir, 'check', file, '--text', '--all'])
    expect(check.out).toContain('OK 0 errors, 0 warnings')
    const review = run([mimir, 'review', file])
    expect(review.out).toContain('CLEAN: no errors, no flags.')
  }, 120_000)
  test('every name it imports or calls is declared by the engine', () => {
    const names = new Set<string>()
    for (const m of page.matchAll(/import \{([^}]*)\} from 'mimir'/g)) for (const n of m[1]!.split(',')) if (n.trim() !== '') names.add(n.trim())
    for (const m of page.matchAll(/`([a-z][A-Za-z]*)\(/g)) names.add(m[1]!)
    // words in backticks that are an author's own (a row's reads, a joint's law, plain JavaScript), not engine exports
    const own = new Set(['value', 'values', 'at', 'indexOf', 'count', 'depth', 'time', 'end', 'error', 'probe', 'point', 'angle', 'distance', 'change', 'describe', 'fadeIn', 'indicate', 'row', 'column', 'grid'])
    const missing = [...names].filter((n) => !own.has(n) && !new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:function|const|namespace)\\s+${n}\\b`, 'm').test(types) && !new RegExp(`^\\s*(?:readonly\\s+)?${n}\\s*[(:<?]`, 'm').test(types))
    expect(missing).toEqual([])
  })
  test('shapes come from maths: the page teaches the formula helpers, and a page of this size stays one page', () => {
    for (const name of ['curve(', 'polar(', 'outset(', 'moved(', 'areaBetween(']) expect(page).toContain(name)
    expect(Buffer.byteLength(page)).toBeLessThan(16_000)
  })
})
