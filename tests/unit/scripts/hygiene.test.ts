// Tests of scripts/hygiene.ts. Every fixture is a throwaway directory under the OS temp dir; nothing here depends on
// the repository the test runs in, on the platform, on a browser or on the network. The git test is skipped when
// git is not installed.
//
// Where this file lives: next to hygiene.ts (as delivered) or in tests/ with the script in scripts/ (in the
// repository). Both layouts are found below, so the file can be moved without an edit.
import { afterAll, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

// the script is found by walking up from this file to the first directory that has scripts/hygiene.ts
const SCRIPT = [join(import.meta.dir, 'hygiene.ts'), ...[1, 2, 3, 4].map((up) => join(import.meta.dir, ...Array<string>(up).fill('..'), 'scripts', 'hygiene.ts'))].find((p) => existsSync(p))
if (!SCRIPT) throw new Error('hygiene.test.ts: cannot find hygiene.ts next to this file or in scripts/ of a directory above it')
/** the repository this copy of the script belongs to (null when the script was delivered on its own) */
const REPO = existsSync(join(dirname(SCRIPT), '..', 'package.json')) && existsSync(join(dirname(SCRIPT), 'hygiene.allow.json')) ? join(dirname(SCRIPT), '..') : null
// The script is loaded by path, so this file typechecks in either layout; these are the parts of its surface used here.
interface Finding { rule: string; path: string; line: number; what: string; fix: string; text?: string; untracked?: boolean }
interface Report { root: string; mode: 'git' | 'walk'; files: number; tracked: number; rules: string[]; findings: Finding[]; allowed: number; pending: Finding[]; resolved: string[] }
interface RunOptions { root: string; allowlist?: string | null; trackedOnly?: boolean; rules?: string[]; noGit?: boolean; names?: string[]; strict?: boolean; config?: Record<string, unknown> }
interface Hygiene {
  globToRegExp(glob: string): RegExp
  matches(path: string, globs: readonly string[]): boolean
  maskJs(src: string, opts: { strings: boolean }): string
  maskSh(src: string): string
  parseGitignore(text: string): (path: string, isDir: boolean) => boolean
  portsIn(line: string): number[]
  runHygiene(opts: RunOptions): Report
  formatReport(report: Report, verbose?: boolean): string
  RULES: Record<string, string>
}
const { globToRegExp, maskJs, maskSh, matches, parseGitignore, portsIn, runHygiene, formatReport, RULES } = (await import(SCRIPT)) as Hygiene

// tests that read a whole tree or start a process: far more room than the work needs, so a busy machine cannot fail them
const SLOW = 120_000
const WORK = mkdtempSync(join(tmpdir(), 'mimir-hygiene-'))
afterAll(() => rmSync(WORK, { recursive: true, force: true }))

const MIT = 'MIT License\n\nCopyright (c) 2026 The Example Authors\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software.\n'
const BASE: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'example', license: 'MIT', dependencies: {} }, null, 2) + '\n',
  'LICENSE': MIT,
  'THIRD_PARTY_NOTICES.md': '# Third-party notices\n\nNothing yet.\n',
}

let count = 0
/** A fresh project directory holding BASE plus `files` (a null value removes a BASE file). */
function project(files: Record<string, string | Uint8Array | null> = {}): string {
  const root = join(WORK, `p${++count}`)
  mkdirSync(root)
  for (const [path, body] of Object.entries({ ...BASE, ...files })) {
    if (body === null) continue
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), body)
  }
  return root
}
/** Findings of one run with no allowlist, no git and no machine names unless given. */
const run = (root: string, extra: Partial<RunOptions> = {}): Report => runHygiene({ root, allowlist: null, noGit: true, names: [], ...extra })
const rulesOf = (root: string, extra: Partial<RunOptions> = {}): string[] => run(root, extra).findings.map((f) => `${f.rule} ${f.path}:${f.line}`)

// fixtures that would otherwise look like the real thing to this script (and to other scanners): built at run time
const HOME = '/Us' + 'ers/'
const VENDOR = 'clau' + 'de'

describe('helpers', () => {
  test('globs: ** crosses directories, * does not, a trailing slash means everything below', () => {
    expect(globToRegExp('src/**').test('src/a/b.ts')).toBe(true)
    expect(globToRegExp('src/*.ts').test('src/a/b.ts')).toBe(false)
    expect(globToRegExp('src/*.ts').test('src/b.ts')).toBe(true)
    expect(globToRegExp('**/frames/**').test('x/frames/1.png')).toBe(true)
    expect(globToRegExp('**/frames/**').test('frames/1.png')).toBe(true)
    expect(globToRegExp('docs/').test('docs/a/b.md')).toBe(true)
    expect(globToRegExp('a.b').test('aXb')).toBe(false)
    expect(matches('tests/unit/hygiene.test.ts', ['tests/**/hygiene.test.ts'])).toBe(true)
  })

  test('maskJs removes comments and keeps line numbers; strings are kept or blanked on request', () => {
    const src = ['const a = 1 // Date.now()', '/* Math.random()', '   more */ const b = "Date.now()"', 'const c = `x ${Date.now()} y`'].join('\n')
    const code = maskJs(src, { strings: false }).split('\n')
    expect(code).toHaveLength(4)
    expect(code[0]).not.toContain('Date.now')
    expect(code[1]).not.toContain('Math.random')
    expect(code[2]).toContain('"Date.now()"')
    const bare = maskJs(src, { strings: true }).split('\n')
    expect(bare[2]).not.toContain('Date.now')
    expect(bare[2]).toContain('const b =')
    // an expression inside a template literal is code, the text around it is not
    expect(bare[3]).toContain('Date.now()')
    expect(bare[3]).not.toContain(' y')
  })

  test('maskJs: a // inside a string or a regular expression is not a comment', () => {
    const src = ['const u = "http://x" + Date.now()', 'const r = /https?:\\/\\//.test(s) && Math.random()'].join('\n')
    const bare = maskJs(src, { strings: true }).split('\n')
    expect(bare[0]).toContain('Date.now()')
    expect(bare[1]).toContain('Math.random()')
  })

  test('maskSh blanks # comments and the shebang, nothing else', () => {
    const out = maskSh('#!/bin/sh\nport=8080 # default\necho "$#"\n').split('\n')
    expect(out[0]!.trim()).toBe('')
    expect(out[1]).toContain('port=8080')
    expect(out[1]).not.toContain('default')
    expect(out[2]).toContain('"$#"')
  })

  test('portsIn finds literal ports and leaves port 0, ranges and look-alike names alone', () => {
    expect(portsIn('const DEFAULT_PORT = 4747')).toEqual([4747])
    expect(portsIn("fetch('http://localhost:3000/x')")).toEqual([3000])
    expect(portsIn("spawn(bin, ['--port', '5000'])")).toEqual([5000])
    expect(portsIn("'--remote-debugging-port=9222'")).toEqual([9222])
    expect(portsIn('args.push(`--proxy-server=127.0.0.1:9`)')).toEqual([9])
    expect(portsIn("{ help: 'port (default 4747, or a free one)' }")).toEqual([4747])
    expect(portsIn('server.listen(8080)')).toEqual([8080])
    expect(portsIn('Bun.serve({ port: 0 })')).toEqual([])
    expect(portsIn("'--remote-debugging-port=0'")).toEqual([])
    expect(portsIn('const viewport = 720, transport = 3, support = 12')).toEqual([])
    expect(portsIn("throw new Error('--port must be 0..65535')")).toEqual([])
    expect(portsIn('const origin = `http://127.0.0.1:${server.port}`')).toEqual([])
  })

  test('parseGitignore: directory names, extensions and anchored paths', () => {
    const ignored = parseGitignore('node_modules/\n*.log\n/out\ndesign/**/shots/\n# comment\n')
    expect(ignored('node_modules', true)).toBe(true)
    expect(ignored('a/node_modules', true)).toBe(true)
    expect(ignored('a/b.log', false)).toBe(true)
    expect(ignored('out', true)).toBe(true)
    expect(ignored('a/out', true)).toBe(false)
    expect(ignored('design/x/shots', true)).toBe(true)
    expect(ignored('src/a.ts', false)).toBe(false)
  })
})

describe('rules', () => {
  test('a clean project has no findings', () => {
    const root = project({ 'src/core/a.ts': 'export const a = 1\n', 'README.md': '# example\n\nRun `bun test`. Scratch files go to the OS temp directory.\n' })
    const r = run(root)
    expect(r.findings).toEqual([])
    expect(r.mode).toBe('walk')
    expect(formatReport(r)).toContain('hygiene: clean.')
  })

  test('no-home-path: any file, any platform spelling; placeholder users are fine', () => {
    const root = project({
      'docs/a.md': `cloned to ${HOME}alex/code/x\n`,
      'src/b.ts': `const p = '/ho' + 'me'\nconst q = "/home/alex/x"\nconst w = 'C:\\\\Users\\\\alex\\\\x'\n`,
      'docs/ok.md': `put it in ${HOME}you/project or /home/user/project\n`,
    })
    expect(rulesOf(root)).toEqual(['no-home-path docs/a.md:1', 'no-home-path src/b.ts:2', 'no-home-path src/b.ts:3'])
  })

  test('no-username: the names of this machine, whole words only, not twice on a home-path line', () => {
    const root = project({ 'docs/a.md': 'reviewed by Marisol\nmarisolved is another word\n', 'docs/b.md': `see ${HOME}marisol/x\n` })
    expect(rulesOf(root, { names: ['marisol'] })).toEqual(['no-home-path docs/b.md:1', 'no-username docs/a.md:1'])
    expect(rulesOf(root, { names: [] })).toEqual(['no-home-path docs/b.md:1'])
  })

  test('no-fixed-port: code only, comments ignored, port 0 is fine', () => {
    const root = project({
      'src/cli/open.ts': 'export const DEFAULT_PORT = 4747\n// the old default was port: 8080\nBun.serve({ port: 0 })\n',
      'bin/tool': '#!/bin/sh\nport=9000\n',
      'docs/a.md': 'open http://localhost:3000\n',
    })
    expect(rulesOf(root)).toEqual(['no-fixed-port bin/tool:2', 'no-fixed-port src/cli/open.ts:1'])
  })

  test('browser-path: only the discovery module may name a browser binary', () => {
    const mac = "'/Appli" + "cations/Google Chrome.app/Contents/MacOS/Google Chrome'"
    const root = project({
      'src/cli/chrome.ts': `export const CANDIDATES = [${mac}, 'chromium-browser']\n`,
      'scripts/shot.ts': `const CHROME = process.env.MIMIR_CHROME ?? ${mac}\n// full Google Chrome is needed here\n`,
    })
    expect(rulesOf(root)).toEqual(['browser-path scripts/shot.ts:1'])
  })

  test('no-platform-path: literal /tmp and package-manager prefixes in code', () => {
    const root = project({
      'tests/a.test.ts': "const WORK = mkdtempSync('/tmp/x-')\nconst ok = join(tmpdir(), 'x-')\nrun({ cwd: '/tmp' })\n",
      'bin/tool': '#!/bin/sh\nfor c in /opt/homebrew/bin/bun; do :; done\n',
      'docs/a.md': 'write the frames to /tmp/x\n',
    })
    expect(rulesOf(root)).toEqual(['no-platform-path bin/tool:2', 'no-platform-path tests/a.test.ts:1', 'no-platform-path tests/a.test.ts:3'])
  })

  test('no-ai-vendor: nowhere in engine or CLI code except the adapter config; prose outside the scope is not checked', () => {
    const root = project({
      'src/cli/new.ts': `const model = '${VENDOR}-latest'\nconst key = process.env.SOME_API_KEY\n`,
      'src/cli/agents/defaults.ts': `export const DEFAULTS = { name: '${VENDOR}' }\n`,
      'README.md': `Works with ${VENDOR} and others.\n`,
    })
    expect(rulesOf(root)).toEqual(['no-ai-vendor src/cli/new.ts:1', 'no-ai-vendor src/cli/new.ts:2'])
  })

  test('no-wallclock: render-path code only; comments, strings and the CLI are not render path', () => {
    const root = project({
      'src/core/frame.ts': "const t = Date.now()\n// Math.random() would break determinism\nconst msg = 'never call performance.now() here'\nconst r = Math.random()\nconst d = new Date(value)\n",
      'src/cli/session.ts': 'const t0 = performance.now()\n',
      'scripts/build.ts': 'const started = Date.now()\n',
    })
    expect(rulesOf(root)).toEqual(['no-wallclock src/core/frame.ts:1', 'no-wallclock src/core/frame.ts:4'])
  })

  test('media, build output, generated and large files are reported; media is grouped by directory', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])
    const root = project({
      'docs/img/a.png': png, 'docs/img/b.png': png, 'docs/demo.mp4': png,
      'dist/app.js': 'x\n',
      'src/_generated/core.ts': '// GENERATED by scripts/build.ts. Do not edit.\nexport {}\n',
      'data/big.json': 'x'.repeat(600 * 1024),
    })
    const r = run(root)
    expect(r.findings.map((f) => `${f.rule} ${f.path}`)).toEqual([
      'no-tracked-media docs/demo.mp4', 'no-tracked-media docs/img/', 'no-build-output dist/app.js', 'generated-tracked src/_generated/core.ts', 'large-file data/big.json',
    ])
    expect(r.findings[1]!.what).toContain('2 media')
    // each of them can be allowed on purpose through the config
    expect(rulesOf(root, { config: { mediaAllow: ['docs/**'], buildOutput: [], generatedAllow: ['src/_generated/**'], maxFileKb: 1024 } })).toEqual([])
  })

  test('third-party-notice: the file, runtime dependencies, cited origins, provenance markers and fonts', () => {
    const font = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0])
    const files = {
      'package.json': JSON.stringify({ name: 'example', license: 'MIT', dependencies: { three: '^0.1.0' }, devDependencies: { typescript: '^5' } }, null, 2) + '\n',
      'src/core/rate.ts': '// Rate functions, transcribed from 3b1b/manim rate_functions.py\nexport const linear = (t: number) => t\n',
      'src/lib/pose.ts': '// The curve is ported from Acme/widget (their flight path).\n// The outline is derived from this one answer.\nexport {}\n',
      'src/assets/fonts/Main-Regular.woff2': font,
    }
    const root = project({ ...files, 'THIRD_PARTY_NOTICES.md': null })
    expect(run(root).findings.map((f) => `${f.path}:${f.line} ${f.what.slice(0, 44)}`)).toEqual([
      'THIRD_PARTY_NOTICES.md:0 THIRD_PARTY_NOTICES.md does not exist',
      'package.json:5 runtime dependency "three" is not listed in ',
      'src/assets/fonts/Main-Regular.woff2:0 font file Main-Regular.woff2 has no entry in',
      'src/core/rate.ts:1 "manim" is used or cited in 1 file (src/core',
      'src/lib/pose.ts:1 says it comes from "Acme/widget", which is n',
    ])
    const listed = project({ ...files, 'THIRD_PARTY_NOTICES.md': '# Notices\n\n## three.js (MIT)\n## manim (MIT): src/core/rate.ts\n## Acme widget (MIT)\n## Example Sans (OFL 1.1): src/assets/fonts/\n' })
    expect(run(listed).findings).toEqual([])
  })

  test('bundle-notice: a built file that holds third-party code must hold its copyright line (read from disk, git or not)', () => {
    const bundleNotices = [{ name: 'libfoo', files: 'dist/*.js', marker: '__LIBFOO__', notice: 'Copyright[^\\n]{0,40}libfoo authors' }]
    const root = project({ '.gitignore': 'dist/\n', 'dist/a.js': 'var x="__LIBFOO__";\n', 'dist/b.js': '/* Copyright 2020 libfoo authors, MIT */var x="__LIBFOO__";\n', 'dist/c.js': 'var own=1;\n' })
    expect(rulesOf(root, { config: { bundleNotices } })).toEqual(['bundle-notice dist/a.js:0'])
    expect(rulesOf(project(), { config: { bundleNotices } })).toEqual([]) // nothing built yet: nothing to check
  })

  test('licence-file: present, declared, the declared licence, no placeholder', () => {
    expect(rulesOf(project({ 'LICENSE': null }))).toEqual(['licence-file LICENSE:0'])
    expect(rulesOf(project({ 'LICENSE': 'All rights reserved.\n' }))).toEqual(['licence-file LICENSE:1'])
    expect(rulesOf(project({ 'LICENSE': MIT.replace('2026 The Example Authors', '[year] [fullname]') }))).toEqual(['licence-file LICENSE:1'])
    expect(rulesOf(project({ 'package.json': '{ "name": "example" }\n' }))).toEqual(['licence-file package.json:0'])
    expect(rulesOf(project({ 'LICENSE': null, 'LICENCE.md': MIT }))).toEqual([])
  })

  test('no-secret: key shapes and credential files; the value is never printed', () => {
    const key = 'AK' + 'IA' + 'ABCDEFGHIJKLMNOP'
    const root = project({ 'src/a.ts': `const k = '${key}'\n`, '.env': 'X=1\n', '.env.example': 'X=\n' })
    const r = run(root)
    expect(r.findings.map((f) => `${f.rule} ${f.path}:${f.line}`)).toEqual(['no-secret .env:0', 'no-secret src/a.ts:1'])
    expect(formatReport(r)).not.toContain(key)
  })

  test('focused-test: test.only and debugger in code, not in strings', () => {
    const root = project({ 'tests/a.test.ts': "test.only('x', () => {})\nconst s = 'describe.only('\ndebugger\n" })
    expect(rulesOf(root)).toEqual(['focused-test tests/a.test.ts:1', 'focused-test tests/a.test.ts:3'])
  })

  test('internal notes and references to them come from the config, not from the script', () => {
    const root = project({ 'docs/research/01.md': 'notes\n', 'docs/GUIDE.md': 'public\n', 'src/a.ts': '// see docs/research/01 section 2\nexport {}\n' })
    expect(rulesOf(root)).toEqual([])
    expect(rulesOf(root, { config: { internalPaths: ['docs/research/**'], internalRefs: ['docs/research\\b'] } })).toEqual(['internal-notes docs/research/:0', 'dangling-internal-ref src/a.ts:1'])
  })

  test('published documents are checked for references to internal notes as well as code', () => {
    const config = { internalPaths: ['docs/research/**'], internalRefs: ['docs/research\\b'] }
    const root = project({ 'README.md': 'Evidence: docs/research/05.\n', 'docs/DESIGN.md': 'see `docs/research/03`\n', 'docs/deep/notes.md': 'docs/research/03\n', 'docs/research/03.md': 'cites docs/research/05 itself\n' })
    // the notes themselves are reported once as internal, not line by line; a document outside the published set is not read
    expect(rulesOf(root, { config })).toEqual(['internal-notes docs/research/:0', 'dangling-internal-ref README.md:1', 'dangling-internal-ref docs/DESIGN.md:1'])
  })

  test('no-topic: engine code keyed on one object, or naming an example, its file or its title', () => {
    const scene = "export default scene({ title: 'How a crank moves a piston' }, (s) => {})\n"
    const root = project({
      'examples/slider-crank.scene.js': scene,
      'examples/pendulum.scene.js': "export default scene({ title: 'A pendulum' }, (s) => {})\n",
      'src/engine.ts': [
        "if (node.id === 'piston') lift()",                         // 1: one object
        "if ('piston' !== part.id) skip()",                         // 2: the same, turned round
        "if (model.title.startsWith('How a')) tune()",              // 3: one scene by its title
        'switch (node.id) { default: }',                            // 4
        "const known = typeof node.id === 'string' && node.id === other.id", // 5: fine, no literal
        "if (node.id.startsWith(`${parent.id}.`)) own()",           // 6: fine, a relation between two objects
        "const demo = 'slider-crank'",                              // 7: an example by name
        "open('examples/pendulum')",                                // 8: an example by path
        "const file = 'pendulum.scene.js'",                         // 9: an example by file
        "const text = 'How a crank moves a piston'",                // 10: an example by title
        "const kind = 'pendulum' // a one-word name is vocabulary", // 11: fine
        "// node.id === 'piston' in a comment is not code",         // 12: fine
        'export {}',
      ].join('\n') + '\n',
      'tests/a.test.ts': "expect(node.id === 'piston').toBe(true)\n", // tests name objects: not engine code
    })
    expect(rulesOf(root, { rules: ['no-topic'] })).toEqual([1, 2, 3, 4, 7].map((n) => `no-topic src/engine.ts:${n}`).concat(['no-topic src/engine.ts:8']))
    const all = run(root, { rules: ['no-topic'], config: { maxPerFile: 20 } }).findings
    expect(all.map((f) => f.line)).toEqual([1, 2, 3, 4, 7, 8, 9, 10])
    expect(all[0]!.what).toContain("code keyed on one object: .id === 'piston'")
    expect(all[4]!.what).toBe('engine code names the example "slider-crank"')
    expect(all[7]!.what).toBe('engine code names the title of the example "slider-crank"')
    // the fields, the engine scope and the examples directory are configuration, not part of the rule
    expect(rulesOf(root, { rules: ['no-topic'], config: { topicFields: ['name'], examplesDir: 'gallery', engineScope: ['lib/**'] } })).toEqual([])
  })

  test('a file with many hits lists the first few and summarises the rest', () => {
    const root = project({ 'docs/a.md': Array.from({ length: 9 }, (_, i) => `${HOME}alex/${i}`).join('\n') + '\n' })
    const r = run(root)
    expect(r.findings).toHaveLength(6)
    expect(r.findings[5]!.what).toContain('4 more lines')
  })

  test('the script and its allowlist are not checked against their own patterns', () => {
    const root = project({ 'scripts/hygiene.ts': `const RE = /${HOME.replace(/\//g, '\\/')}alex/\n`, 'scripts/hygiene.allow.json': '{ "allow": [] }\n' })
    expect(run(root).findings).toEqual([])
  })
})

describe('allowlist', () => {
  const files = { 'src/a.ts': `const p = '${HOME}alex/x'\nexport const PORT = 5000\n` }
  const allowFile = (root: string, body: unknown): string => { const p = join(root, 'allow.json'); writeFileSync(p, JSON.stringify(body)); return p }

  test('an entry with a reason suppresses exactly what it names', () => {
    const root = project(files)
    const allowlist = allowFile(root, { allow: [{ rule: 'no-home-path', path: 'src/a.ts', contains: 'alex/x', reason: 'An invented path used as parser input.' }] })
    const r = runHygiene({ root, allowlist, noGit: true, names: [] })
    expect(r.findings.map((f) => f.rule)).toEqual(['no-fixed-port'])
    expect(r.allowed).toBe(1)
  })

  test('an entry without a reason is rejected and suppresses nothing', () => {
    const root = project(files)
    const allowlist = allowFile(root, { allow: [{ rule: 'no-fixed-port', path: 'src/a.ts', reason: 'ok' }, { rule: 'nope', path: 'src/a.ts', reason: 'A rule that does not exist.' }] })
    const r = runHygiene({ root, allowlist, noGit: true, names: [] })
    expect(r.findings.map((f) => f.rule).sort()).toEqual(['allowlist', 'allowlist', 'no-fixed-port', 'no-home-path'])
    expect(r.findings.filter((f) => f.rule === 'allowlist').map((f) => f.what).join(' | ')).toMatch(/has no reason.*unknown rule "nope"/)
  })

  test('an entry that suppresses nothing is reported, so the list cannot rot', () => {
    const root = project({ 'src/a.ts': 'export const a = 1\n' })
    const allowlist = allowFile(root, { allow: [{ rule: 'no-fixed-port', path: 'src/a.ts', reason: 'The port was a test fixture.' }] })
    const r = runHygiene({ root, allowlist, noGit: true, names: [] })
    expect(r.findings.map((f) => `${f.rule}: ${f.what}`)).toEqual(['allowlist: allow[0] (no-fixed-port src/a.ts) no longer suppresses anything'])
    // …but not when only some rules run: the entry may belong to a rule that was not asked for
    expect(runHygiene({ root, allowlist, noGit: true, names: [], rules: ['no-home-path'] }).findings).toEqual([])
  })

  test('a pending entry is a known violation, not an exception: counted on every run, a finding with --strict; when it is fixed that is said, not failed', () => {
    const root = project(files)
    const entry = { rule: 'no-fixed-port', path: 'src/a.ts', reason: 'PENDING: its owner moves the port to an option.', pending: true }
    const allowlist = allowFile(root, { allow: [entry, { rule: 'no-home-path', path: 'src/a.ts', reason: 'An invented path used as parser input.' }] })
    const r = runHygiene({ root, allowlist, noGit: true, names: [] })
    expect(r.findings).toEqual([])
    expect(r.allowed).toBe(1)
    expect(r.pending.map((f) => `${f.rule} ${f.path}:${f.line}`)).toEqual(['no-fixed-port src/a.ts:2'])
    expect(formatReport(r)).toMatch(/hygiene: clean\. .* 1 allowlisted, 1 pending\.\n  pending \(known violations waiting for their owner; `--strict` fails on them, and must pass before publishing\): no-fixed-port 1\n$/)
    const strict = runHygiene({ root, allowlist, noGit: true, names: [], strict: true })
    expect(strict.findings.map((f) => `${f.rule} ${f.path}:${f.line}`)).toEqual(['no-fixed-port src/a.ts:2'])
    expect(strict.pending).toEqual([])
    // the owner fixed it: the run stays clean and names the entry to delete; --strict insists that it is deleted
    writeFileSync(join(root, 'src/a.ts'), `const p = '${HOME}alex/x'\nexport const port = Number(process.env.PORT)\n`)
    const fixed = runHygiene({ root, allowlist, noGit: true, names: [] })
    expect([fixed.findings, fixed.pending, fixed.resolved]).toEqual([[], [], ['allow[0] (no-fixed-port src/a.ts)']])
    expect(formatReport(fixed)).toContain('resolved (pending entries whose violation is gone: delete them from the allowlist): allow[0] (no-fixed-port src/a.ts)')
    expect(runHygiene({ root, allowlist, noGit: true, names: [], strict: true }).findings.map((f) => f.rule)).toEqual(['allowlist'])
    // "pending" must be a boolean
    const bad = runHygiene({ root, allowlist: allowFile(root, { allow: [{ ...entry, pending: 'yes' }] }), noGit: true, names: [] })
    expect(bad.findings.map((f) => f.rule)).toContain('allowlist')
  })

  test('the config block of the allowlist file overrides the defaults; unknown keys and broken JSON are findings', () => {
    const root = project({ 'tools/a.ts': 'export const PORT = 5000\n' })
    expect(rulesOf(root)).toEqual([])
    expect(runHygiene({ root, allowlist: allowFile(root, { config: { codeScope: ['tools/**'] }, allow: [] }), noGit: true, names: [] }).findings.map((f) => f.rule)).toEqual(['no-fixed-port'])
    expect(runHygiene({ root, allowlist: allowFile(root, { config: { codeScop: [] } }), noGit: true, names: [] }).findings.map((f) => f.what)).toEqual(['unknown config key: codeScop'])
    const broken = join(root, 'broken.json')
    writeFileSync(broken, '{ nope')
    expect(runHygiene({ root, allowlist: broken, noGit: true, names: [] }).findings.map((f) => f.rule)).toEqual(['allowlist'])
  })
})

const HAVE_GIT = spawnSync('git', ['--version']).status === 0

describe.skipIf(!HAVE_GIT)('with git', () => {
  test('tracked and untracked-but-not-ignored files are checked; ignored files are not', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0])
    const root = project({ '.gitignore': 'shots/\n', 'a.png': png, 'b.png': png, 'shots/c.png': png, 'src/_generated/x.ts': '// GENERATED by a script\n' })
    const git = (...args: string[]): void => { const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr) }
    git('init', '-q')
    git('add', 'a.png', '.gitignore', 'package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md')
    const r = runHygiene({ root, allowlist: null, names: [] })
    expect(r.mode).toBe('git')
    expect(r.findings.map((f) => `${f.rule} ${f.path} ${f.untracked ? 'untracked' : 'tracked'}`)).toEqual(['no-tracked-media a.png tracked', 'no-tracked-media b.png untracked'])
    // a generated file is only a finding once git tracks it
    git('add', 'src/_generated/x.ts')
    expect(runHygiene({ root, allowlist: null, names: [], trackedOnly: true }).findings.map((f) => `${f.rule} ${f.path}`)).toEqual(['no-tracked-media a.png', 'generated-tracked src/_generated/x.ts'])
  }, SLOW)
})

describe('command line', () => {
  const cli = (args: string[]): { code: number; out: string; err: string } => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, MIMIR_HYGIENE_NAMES: '' } })
    return { code: r.status ?? -1, out: r.stdout, err: r.stderr }
  }

  test('exit 0 when clean, 1 with findings printed as path:line rule what + fix, 2 on a usage error', () => {
    const clean = cli(['--root', project({ 'src/a.ts': 'export const a = 1\n' }), '--no-allowlist', '--no-git', '--rules', 'no-fixed-port,licence-file'])
    expect(clean.code).toBe(0)
    expect(clean.out).toContain('hygiene: clean.')
    const dirty = cli(['--root', project({ 'src/a.ts': 'export const PORT = 5000\n' }), '--no-allowlist', '--no-git', '--rules', 'no-fixed-port'])
    expect(dirty.code).toBe(1)
    expect(dirty.out).toMatch(/^ {2}src\/a\.ts:1 {2}no-fixed-port {2}fixed port 5000$/m)
    expect(dirty.out).toMatch(/^ {6}fix: bind port 0/m)
    expect(cli(['--bogus']).code).toBe(2)
    expect(cli(['--rules', 'nope']).code).toBe(2)
    expect(cli(['--root', join(WORK, 'missing')]).code).toBe(2)
  }, SLOW)

  test('--json is one report object; --list-rules names every rule', () => {
    const r = cli(['--root', project({ 'src/a.ts': 'export const PORT = 5000\n' }), '--no-allowlist', '--no-git', '--rules', 'no-fixed-port', '--json'])
    const report = JSON.parse(r.out) as { findings: { rule: string; path: string; line: number; fix: string }[]; mode: string }
    expect(report.mode).toBe('walk')
    expect(report.findings).toHaveLength(1)
    expect(report.findings[0]).toMatchObject({ rule: 'no-fixed-port', path: 'src/a.ts', line: 1 })
    const list = cli(['--list-rules'])
    expect(list.code).toBe(0)
    for (const rule of Object.keys(RULES)) expect(list.out).toContain(rule)
  }, SLOW)
})

// The repository this script belongs to keeps its own rules: the tree as a fresh repository would publish it (the
// directory walk honours .gitignore; what git still tracks from before is the business of `bun run hygiene` itself).
describe.skipIf(REPO === null)('this repository', () => {
  test('passes its own hygiene check; every exception has a reason, every known violation is marked pending', () => {
    const r = runHygiene({ root: REPO!, noGit: true, names: [] })
    expect(r.findings.map((f) => `${f.path}${f.line ? `:${f.line}` : ''}  ${f.rule}  ${f.what}\n      fix: ${f.fix}`)).toEqual([])
    expect(r.rules).toContain('no-topic')
  }, SLOW)
})
