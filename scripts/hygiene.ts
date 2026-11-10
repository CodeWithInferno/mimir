#!/usr/bin/env bun
// bun scripts/hygiene.ts [--root dir] [--allowlist file] [--tracked-only] [--rules a,b] [--strict] [--json] [--verbose] [--list-rules]
//
// Mechanical enforcement of docs/OSS-HYGIENE.md: what a machine can check, it checks here, on every file git would
// publish (tracked files and untracked files that are not ignored). Prints one finding per line as
//   path:line  rule  what is wrong
//       fix: what to do
// and exits 1 when anything is found, 0 when clean, 2 on a usage error.
//
// No dependencies: node:fs / node:path / node:os / node:child_process only. `git` is used when the root is a git
// work tree; otherwise the directory is walked and the root .gitignore is honoured (simple patterns).
//
// Nothing about this project is baked into the rules: every path, scope, name list and threshold is a named default
// in DEFAULT_CONFIG below and can be replaced in the "config" block of the allowlist file (scripts/hygiene.allow.json).
// An exception is an entry of that file's "allow" list and must say why ("reason"); an entry that no longer
// suppresses anything is itself reported, so the list cannot rot. An entry marked "pending": true is not an exception
// but a KNOWN VIOLATION that waits for its owner: it does not fail an ordinary run, every run counts it in the summary,
// and `--strict` (the run to make before publishing) reports it as a finding again.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir, hostname, userInfo } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

// ── configuration (every value is a default; override in the allowlist file's "config" block) ─────────────────────

export interface Origin {
  /** how THIRD_PARTY_NOTICES names it (matched case-insensitively) */
  notice: string
  /** regular expression source; a file that matches uses this origin */
  pattern: string
}

export interface BundleNotice {
  /** what the notice is for, e.g. "three.js" */
  name: string
  /** root-relative glob of built files (they are usually ignored by git; they are read from disk) */
  files: string
  /** regular expression source: a file that matches contains the third-party code */
  marker: string
  /** regular expression source: the copyright / licence line that must then be in the same file */
  notice: string
}

export interface Config {
  /** files whose CODE is checked (ports, browser paths, platform paths, focused tests, provenance markers) */
  codeScope: string[]
  /** extensions treated as JavaScript-like source; a file with a `#!` line that names sh/bash/zsh is treated as shell */
  codeExtensions: string[]
  /** the only files that may name browser binaries or their install locations */
  browserDiscovery: string[]
  /** files where an AI vendor or model id may appear (adapter defaults, documented and overridable) */
  aiAdapterPaths: string[]
  /** files checked for AI vendor / model names */
  aiVendorScope: string[]
  /** regular expression sources (case-insensitive) of vendor names and model-id shapes */
  aiVendors: string[]
  /** regular expression sources (case-sensitive) of credential variable names */
  aiKeyNames: string[]
  /** modules whose output must be a function of story time: no wall clock, no unseeded randomness */
  renderPath: string[]
  renderPathExclude: string[]
  /** paths that are internal process notes and must not be published */
  internalPaths: string[]
  /** regular expression sources: a line that matches refers to an internal note that will not be published */
  internalRefs: string[]
  /** files checked for such references besides codeScope: the documents that are published */
  internalRefDocs: string[]
  /** directories that hold build output or caches and must never be tracked */
  buildOutput: string[]
  mediaExtensions: string[]
  fontExtensions: string[]
  /** media that may be tracked on purpose (say why in the allowlist instead, when it is a single file) */
  mediaAllow: string[]
  /** generated files that are tracked on purpose */
  generatedAllow: string[]
  /** a tracked file larger than this is reported (KB) */
  maxFileKb: number
  /** content rules list at most this many lines per file, then summarise */
  maxPerFile: number
  noticesFile: string
  licenceFiles: string[]
  /** third-party work whose use must be recorded in the notices file */
  origins: Origin[]
  /** built files that carry third-party code and must therefore carry its copyright line (checked when they exist) */
  bundleNotices: BundleNotice[]
  /** user names in example paths that are not a real person (/Users/you/…) */
  placeholderUsers: string[]
  /** account names of build machines: never treated as a personal name */
  genericUsers: string[]
  /** the hygiene script's own files (they contain the patterns they look for) */
  selfPaths: string[]
  /** engine code: files that must never special-case a scene, an id, a title or a subject (rule no-topic) */
  engineScope: string[]
  engineScopeExclude: string[]
  /** where the example scenes live, and the suffix that makes a file one: their names and titles must not appear in engine code */
  examplesDir: string
  sceneSuffix: string
  /** fields whose comparison with a string literal keys code on one particular object: `.id === 'piston'` */
  topicFields: string[]
}

export const DEFAULT_CONFIG: Config = {
  codeScope: ['src/**', 'scripts/**', 'bin/**', 'tests/**', 'examples/**', 'types/**'],
  codeExtensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'],
  browserDiscovery: ['src/cli/chrome.ts'],
  aiAdapterPaths: ['src/cli/agents/**', 'src/agents/**'],
  aiVendorScope: ['src/**', 'scripts/**', 'bin/**', 'tests/**', 'examples/**', 'types/**', 'package.json'],
  aiVendors: [
    '\\b(?:anthropic|claude|openai|chatgpt|gemini|codex|copilot|deepseek|mistral|llama|ollama|qwen|kimi|grok|perplexity|cohere|bedrock)\\b',
    '\\b(?:gpt|o[134])-[0-9a-z][0-9a-z.-]*\\b',
  ],
  aiKeyNames: ['\\b[A-Z][A-Z0-9]*_API_KEY\\b'],
  renderPath: ['src/**'],
  renderPathExclude: ['src/cli/**', 'src/_generated/**'],
  internalPaths: [],
  internalRefs: [],
  internalRefDocs: ['*.md', 'docs/*.md', '.github/**'],
  buildOutput: ['dist/**', 'node_modules/**', '.mimir/**', 'out/**', 'coverage/**', 'tmp/**', '**/frames/**', '**/shots/**'],
  mediaExtensions: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.tiff', '.psd', '.mp4', '.mov', '.webm', '.mkv', '.mp3', '.wav', '.ogg', '.flac', '.pdf', '.zip', '.gz', '.tgz', '.7z', '.bak'],
  fontExtensions: ['.woff', '.woff2', '.ttf', '.otf', '.eot'],
  mediaAllow: [],
  generatedAllow: [],
  maxFileKb: 500,
  maxPerFile: 5,
  noticesFile: 'THIRD_PARTY_NOTICES.md',
  licenceFiles: ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'LICENCE.txt', 'COPYING'],
  origins: [
    { notice: 'manim', pattern: '\\bmanim(?:gl|lib)?\\b|\\b3b1b\\b' },
    { notice: 'three', pattern: 'three/(?:examples/jsm|addons)/' },
    { notice: 'KaTeX', pattern: '\\bkatex\\b' },
    { notice: 'Temml', pattern: '\\btemml\\b' },
    { notice: 'MathJax', pattern: '\\bmathjax\\b' },
  ],
  bundleNotices: [],
  placeholderUsers: ['you', 'user', 'username', 'name', 'me', 'someone', 'USER', 'Shared'],
  genericUsers: ['root', 'runner', 'user', 'admin', 'administrator', 'ubuntu', 'node', 'bun', 'build', 'ci', 'github', 'docker', 'vscode', 'codespace', 'nobody', 'circleci', 'gitlab-runner', 'jenkins'],
  selfPaths: ['scripts/hygiene.ts', 'scripts/hygiene.allow.json', 'tests/**/hygiene.test.ts'],
  engineScope: ['src/**'],
  engineScopeExclude: ['src/_generated/**'],
  examplesDir: 'examples',
  sceneSuffix: '.scene.js',
  topicFields: ['id', 'title', 'subtitle'],
}

// ── types ────────────────────────────────────────────────────────────────────────────────────────────

export interface Finding {
  rule: string
  /** root-relative, forward slashes */
  path: string
  /** 1-based; 0 = the file (or directory) as a whole */
  line: number
  what: string
  fix: string
  /** the offending line (trimmed), what an allowlist entry's `contains` is matched against */
  text?: string
  /** true when git does not track the file yet (it would be added by `git add -A`) */
  untracked?: boolean
}

export interface AllowEntry {
  rule: string
  path: string
  contains?: string
  reason: string
  /** true = a known violation waiting for its owner, not an accepted exception: counted on every run, a finding with --strict */
  pending?: boolean
}

export interface Options {
  root: string
  /** path of the allowlist file; null = none; undefined = <script dir>/hygiene.allow.json when it exists */
  allowlist?: string | null
  /** only what git already tracks (default: also untracked files that are not ignored) */
  trackedOnly?: boolean
  /** run only these rules */
  rules?: string[]
  /** walk the directory even when it is a git work tree */
  noGit?: boolean
  /** names that must not appear in files; default: the account and host this runs on (and MIMIR_HYGIENE_NAMES) */
  names?: string[]
  /** pending entries of the allowlist do not suppress anything: the run to make before publishing */
  strict?: boolean
  /** config overrides applied on top of the allowlist file's "config" block */
  config?: Partial<Config>
}

export interface Report {
  root: string
  mode: 'git' | 'walk'
  files: number
  tracked: number
  rules: string[]
  findings: Finding[]
  /** findings suppressed by the allowlist */
  allowed: number
  /** known violations that wait for their owner (allowlist entries with "pending": true): not findings unless --strict */
  pending: Finding[]
  /** pending entries whose violation is gone (it was fixed): good news, said on every run; with --strict a finding, so the list is emptied before publishing */
  resolved: string[]
}

interface FileEntry { path: string; tracked: boolean; size: number }
interface TextFile extends FileEntry { text: string; lines: string[]; kind: 'js' | 'sh' | 'other' }

export const RULES: Record<string, string> = {
  'no-home-path': 'no absolute home directory (/Users/<name>, /home/<name>, C:\\Users\\<name>) in a published file',
  'no-username': 'the account or host name of the machine this runs on does not appear in a published file',
  'no-fixed-port': 'no literal port number in code (0 = any free port is fine)',
  'browser-path': 'browser binaries and install locations are named only in the discovery module',
  'no-platform-path': 'no machine-specific absolute path in code (/tmp, /opt/homebrew, /usr/local/bin, ~/Library …)',
  'no-ai-vendor': 'no AI vendor or model id outside the adapter config',
  'no-wallclock': 'no wall clock and no unseeded randomness in render-path modules',
  'no-topic': 'engine code never special-cases a scene, an id, a title or an example',
  'no-tracked-media': 'no media, archive or backup file in git',
  'no-build-output': 'no build output or cache directory in git',
  'generated-tracked': 'no generated file in git',
  'large-file': 'no very large file in git',
  'internal-notes': 'internal process notes stay out of the published tree',
  'dangling-internal-ref': 'code and published documents do not point at an internal note that will not be published',
  'third-party-notice': 'every third-party asset, dependency or ported algorithm is listed in the notices file',
  'bundle-notice': 'a built file that contains third-party code carries its copyright line',
  'licence-file': 'a licence file is present and agrees with package.json',
  'no-secret': 'no key, token or private key in a published file',
  'focused-test': 'no test.only / describe.only / debugger left behind',
  'allowlist': 'every allowlist entry has a reason and still suppresses something',
}

// ── small helpers ────────────────────────────────────────────────────────────────────────────────────

/** `**` = any directories, `*` = anything but a slash, `?` = one character; a pattern ending in `/` is a directory. */
export function globToRegExp(glob: string): RegExp {
  let g = glob.endsWith('/') ? glob + '**' : glob
  let re = ''
  for (let i = 0; i < g.length; i++) {
    const c = g[i]!
    if (c === '*') {
      if (g[i + 1] === '*') {
        if (g[i + 2] === '/') { re += '(?:.*/)?'; i += 2 } else { re += '.*'; i += 1 }
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else re += /[.+^${}()|[\]\\]/.test(c) ? '\\' + c : c
  }
  return new RegExp('^' + re + '$')
}

const globCache = new Map<string, RegExp>()
export function matches(path: string, globs: readonly string[]): boolean {
  for (const g of globs) {
    let re = globCache.get(g)
    if (!re) globCache.set(g, (re = globToRegExp(g)))
    if (re.test(path)) return true
  }
  return false
}

const extOf = (path: string): string => { const b = basename(path); const i = b.lastIndexOf('.'); return i <= 0 ? '' : b.slice(i).toLowerCase() }
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Blank out comments (always) and the contents of strings, template text and regular-expression literals (when
 * `strings` is set), keeping every newline, so that line numbers survive and rules only see what executes.
 */
export function maskJs(src: string, opts: { strings: boolean }): string {
  const out: string[] = []
  const n = src.length
  // context stack: a number is a brace depth inside code (the bottom one is the file), 'tpl' is template text
  const stack: Array<number | 'tpl'> = [0]
  let i = 0
  let lastSignificant = ''
  const blank = (from: number, to: number): void => { for (let k = from; k < to; k++) out.push(src[k] === '\n' ? '\n' : ' ') }
  const keepOrBlank = (from: number, to: number): void => { if (opts.strings) blank(from, to); else out.push(src.slice(from, to)) }
  while (i < n) {
    const top = stack[stack.length - 1]!
    const c = src[i]!
    if (top === 'tpl') {
      let j = i
      while (j < n && src[j] !== '`' && !(src[j] === '$' && src[j + 1] === '{')) j += src[j] === '\\' ? 2 : 1
      keepOrBlank(i, Math.min(j, n))
      if (j >= n) break
      if (src[j] === '`') { out.push('`'); stack.pop(); lastSignificant = '`'; i = j + 1 } else { out.push('${'); stack.push(0); lastSignificant = '{'; i = j + 2 }
      continue
    }
    if (c === '/' && src[i + 1] === '/' && src[i - 1] !== '\\') {
      let j = i
      while (j < n && src[j] !== '\n') j++
      blank(i, j)
      i = j
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      const j = end < 0 ? n : end + 2
      blank(i, j)
      i = j
      continue
    }
    if (c === "'" || c === '"') {
      let j = i + 1
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1
      out.push(c)
      keepOrBlank(i + 1, Math.min(j, n))
      if (j < n && src[j] === c) { out.push(c); j++ }
      lastSignificant = c
      i = j
      continue
    }
    if (c === '`') { out.push('`'); stack.push('tpl'); i++; continue }
    // a regular-expression literal: a slash where an operand is expected
    if (c === '/' && (lastSignificant === '' || '(,=:[!&|?{};+-*%<>~^'.includes(lastSignificant) || /(?:return|typeof|case|in|of|void|delete|throw|new)$/.test(src.slice(Math.max(0, i - 8), i).trimEnd()))) {
      let j = i + 1
      let inClass = false
      while (j < n && src[j] !== '\n' && (inClass || src[j] !== '/')) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === '[') inClass = true
        else if (src[j] === ']') inClass = false
        j++
      }
      if (j < n && src[j] === '/') {
        out.push('/')
        keepOrBlank(i + 1, j)
        out.push('/')
        lastSignificant = '/'
        i = j + 1
        continue
      }
    }
    if (c === '{') stack[stack.length - 1] = (top as number) + 1
    else if (c === '}') {
      if ((top as number) === 0 && stack.length > 1) { stack.pop(); out.push('}'); lastSignificant = '}'; i++; continue }
      stack[stack.length - 1] = Math.max(0, (top as number) - 1)
    }
    out.push(c)
    if (!/\s/.test(c)) lastSignificant = c
    i++
  }
  return out.join('')
}

/** Shell: blank `#` comments (a `#` at the start of a line or after white space), keep everything else. */
export function maskSh(src: string): string {
  return src.split('\n').map((line, k) => {
    if (k === 0 && line.startsWith('#!')) return ' '.repeat(line.length)
    const m = /(^|\s)#/.exec(line)
    return m ? line.slice(0, m.index + m[1]!.length) + ' '.repeat(line.length - m.index - m[1]!.length) : line
  }).join('\n')
}

// ── which files ──────────────────────────────────────────────────────────────────────────────────────

function gitList(root: string, args: string[]): string[] | null {
  const r = spawnSync('git', ['-C', root, 'ls-files', '-z', ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })
  if (r.error || r.status !== 0) return null
  return r.stdout.split('\0').filter((p) => p !== '')
}

function isGitWorkTree(root: string): boolean {
  const r = spawnSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })
  return !r.error && r.status === 0 && r.stdout.trim() === 'true'
}

/** The simple part of .gitignore: `name/`, `*.ext`, `a/b`, `/anchored`, `**`; negations are not supported. */
export function parseGitignore(text: string): (path: string, isDir: boolean) => boolean {
  const rules: { re: RegExp; dirOnly: boolean }[] = []
  for (const raw of text.split('\n')) {
    let line = raw.trim()
    if (line === '' || line.startsWith('#') || line.startsWith('!')) continue
    const dirOnly = line.endsWith('/')
    if (dirOnly) line = line.slice(0, -1)
    const anchored = line.startsWith('/') || line.includes('/')
    if (line.startsWith('/')) line = line.slice(1)
    rules.push({ re: globToRegExp(anchored ? line : '**/' + line), dirOnly })
  }
  return (path, isDir) => rules.some((r) => (!r.dirOnly || isDir) && r.re.test(path))
}

function walk(root: string): string[] {
  const ignoreFile = join(root, '.gitignore')
  const ignored = existsSync(ignoreFile) ? parseGitignore(readFileSync(ignoreFile, 'utf8')) : () => false
  const out: string[] = []
  const visit = (dir: string, rel: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = rel === '' ? e.name : rel + '/' + e.name
      if (e.name === '.git') continue
      if (e.isDirectory()) { if (!ignored(p, true)) visit(join(dir, e.name), p) } else if (e.isFile() && !ignored(p, false)) out.push(p)
    }
  }
  visit(root, '')
  return out
}

function listFiles(root: string, opts: Options): { files: FileEntry[]; mode: 'git' | 'walk' } {
  let tracked: string[] | null = null
  let others: string[] = []
  if (!opts.noGit && isGitWorkTree(root)) {
    tracked = gitList(root, ['--cached'])
    if (tracked && !opts.trackedOnly) others = gitList(root, ['--others', '--exclude-standard']) ?? []
  }
  const mode = tracked ? 'git' : 'walk'
  const names = tracked ? [...new Set([...tracked, ...others])] : walk(root)
  const trackedSet = new Set(tracked ?? names)
  const files: FileEntry[] = []
  for (const path of names.sort()) {
    let size: number
    try { const st = statSync(join(root, path)); if (!st.isFile()) continue; size = st.size } catch { continue } // deleted in the work tree
    files.push({ path: path.split(sep).join('/'), tracked: trackedSet.has(path), size })
  }
  return { files, mode }
}

const TEXT_LIMIT = 2 * 1024 * 1024

function readText(root: string, f: FileEntry, cfg: Config): TextFile | null {
  if (f.size > TEXT_LIMIT) return null
  let buf: Buffer
  try { buf = readFileSync(join(root, f.path)) } catch { return null }
  if (buf.subarray(0, 8000).includes(0)) return null
  const text = buf.toString('utf8')
  const firstLine = text.slice(0, 120).split('\n')[0]!
  const kind = cfg.codeExtensions.includes(extOf(f.path)) ? 'js' : extOf(f.path) === '.sh' || /^#!.*\b(?:sh|bash|zsh|dash)\b/.test(firstLine) ? 'sh' : 'other'
  return { ...f, text, lines: text.split('\n'), kind }
}

// ── the rules ────────────────────────────────────────────────────────────────────────────────────────

interface Ctx {
  root: string
  cfg: Config
  files: FileEntry[]
  texts: TextFile[]
  names: string[]
  add(f: Finding): void
  /** comment-free view of a code file (strings kept), cached */
  code(t: TextFile): string[]
  /** comment- and string-free view of a JavaScript-like file, cached */
  bare(t: TextFile): string[]
}

/** Report matching lines of one file, at most cfg.maxPerFile of them, then one summary line. */
function perLine(c: Ctx, t: TextFile, rule: string, hits: { line: number; what: string; text: string }[], fix: string): void {
  const max = c.cfg.maxPerFile
  hits.slice(0, max).forEach((h) => c.add({ rule, path: t.path, line: h.line, what: h.what, fix, text: h.text, untracked: !t.tracked }))
  if (hits.length > max) c.add({ rule, path: t.path, line: hits[max]!.line, what: `… and ${hits.length - max} more line${hits.length - max === 1 ? '' : 's'} in this file (${hits.slice(max).map((h) => h.line).slice(0, 12).join(', ')}${hits.length - max > 12 ? ', …' : ''})`, fix, text: hits.slice(max).map((h) => h.text).join('\n'), untracked: !t.tracked })
}

const HOME_RE = /(?:\/Users\/|\/home\/|[A-Za-z]:\\{1,2}Users\\{1,2})([A-Za-z0-9._-]+)/g

function ruleHomePath(c: Ctx): void {
  for (const t of c.texts) {
    const hits: { line: number; what: string; text: string }[] = []
    t.lines.forEach((line, k) => {
      HOME_RE.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = HOME_RE.exec(line))) {
        if (c.cfg.placeholderUsers.includes(m[1]!)) continue
        hits.push({ line: k + 1, what: `absolute home path "${m[0]}"`, text: line.trim() })
        break
      }
    })
    perLine(c, t, 'no-home-path', hits, 'derive the path (import.meta.dir, process.cwd(), os.tmpdir(), an environment variable) or write it relative to the repository; in prose use <repo>/… or ~/…')
  }
}

function ruleUsername(c: Ctx): void {
  if (!c.names.length) return
  const re = new RegExp(`(?<![A-Za-z0-9])(?:${c.names.map(escapeRe).join('|')})(?![A-Za-z0-9])`, 'i')
  for (const t of c.texts) {
    const hits: { line: number; what: string; text: string }[] = []
    t.lines.forEach((line, k) => {
      const m = re.exec(line)
      if (!m) return
      HOME_RE.lastIndex = 0
      if (HOME_RE.test(line)) return // already reported as a home path
      hits.push({ line: k + 1, what: `the name "${m[0]}" of this machine's account or host`, text: line.trim() })
    })
    perLine(c, t, 'no-username', hits, 'remove the name; if it is the copyright holder or the package author, add an allowlist entry that says so')
  }
}

const NOT_A_PORT = new Set(['viewport', 'transport', 'support', 'export', 'import', 'report', 'teleport', 'passport', 'airport', 'rapport', 'sport'])

/** Literal port numbers on one line of code (comments already removed). Port 0 means "any free port". */
export function portsIn(line: string): number[] {
  const found = new Set<number>()
  const take = (text: string | undefined): void => { const v = Number(text); if (Number.isInteger(v) && v > 0 && v <= 65535) found.add(v) }
  for (const m of line.matchAll(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{1,5})\b/g)) take(m[1])
  for (const m of line.matchAll(/([A-Za-z_$][\w$]*)['"]?\s*[:=]\s*['"]?(\d{1,5})\b(?!\s*[.\d])/g)) {
    const id = m[1]!.toLowerCase()
    if (id.endsWith('port') && !NOT_A_PORT.has(id)) take(m[2])
  }
  for (const m of line.matchAll(/--[a-z-]*port\b['"]?\s*[,= ]\s*['"]?(\d{1,5})\b/gi)) take(m[1])
  for (const m of line.matchAll(/--proxy-server=[^\s'"`]*?:(\d{1,5})\b/g)) take(m[1])
  for (const m of line.matchAll(/\blisten\(\s*(\d{1,5})\b/g)) take(m[1])
  if (/\bport\b/i.test(line)) for (const m of line.matchAll(/\bdefault\s+(\d{2,5})\b/gi)) take(m[1])
  return [...found]
}

function ruleFixedPort(c: Ctx): void {
  for (const t of c.texts) {
    if (t.kind === 'other' || !matches(t.path, c.cfg.codeScope)) continue
    const hits: { line: number; what: string; text: string }[] = []
    c.code(t).forEach((line, k) => {
      const ports = portsIn(line)
      if (ports.length) hits.push({ line: k + 1, what: `fixed port ${ports.join(', ')}`, text: t.lines[k]!.trim() })
    })
    perLine(c, t, 'no-fixed-port', hits, 'bind port 0 (the OS picks a free one) and read the port back; let --port / an environment variable override. In a test that never binds the number, add an allowlist entry that says so')
  }
}

const BROWSER_RE = /\.app\/Contents\/MacOS|\/Applications\/|(?:Google Chrome|Chromium|Microsoft Edge|Brave Browser)\.app|\b(?:chrome|msedge|brave|chromium)\.exe\b|Program Files|\/opt\/google\/chrome|\/snap\/bin\/chromium|\/usr\/lib\/chromium|\bgoogle-chrome(?:-stable|-beta)?\b|\bchromium-browser\b|\bmicrosoft-edge(?:-stable)?\b|\bbrave-browser\b/

function ruleBrowserPath(c: Ctx): void {
  for (const t of c.texts) {
    if (t.kind === 'other' || !matches(t.path, c.cfg.codeScope) || matches(t.path, c.cfg.browserDiscovery)) continue
    const hits: { line: number; what: string; text: string }[] = []
    c.code(t).forEach((line, k) => {
      const m = BROWSER_RE.exec(line)
      if (m) hits.push({ line: k + 1, what: `browser location "${m[0]}" outside the discovery module (${c.cfg.browserDiscovery.join(', ')})`, text: t.lines[k]!.trim() })
    })
    perLine(c, t, 'browser-path', hits, `call the discovery module (findChrome / launchChrome) instead of naming a binary; MIMIR_CHROME stays the only override`)
  }
}

const PLATFORM_RE = /(['"`])\/tmp(?:\/|\1)|\/opt\/homebrew|\/usr\/local\/(?:bin|Cellar|opt)\b|\/var\/folders\/|\/private\/(?:var|tmp)\b|~\/Library|\/Library\/(?:Fonts|Application Support)|\/System\/Library/

function rulePlatformPath(c: Ctx): void {
  for (const t of c.texts) {
    if (t.kind === 'other' || !matches(t.path, c.cfg.codeScope) || matches(t.path, c.cfg.browserDiscovery)) continue
    const hits: { line: number; what: string; text: string }[] = []
    c.code(t).forEach((line, k) => {
      const m = PLATFORM_RE.exec(line)
      if (m) hits.push({ line: k + 1, what: `machine-specific path "${m[0].replace(/^['"`]/, '')}"`, text: t.lines[k]!.trim() })
    })
    perLine(c, t, 'no-platform-path', hits, 'use os.tmpdir() for scratch space and PATH / an environment variable for tools; a search list of install locations belongs in one discovery module')
  }
}

function ruleAiVendor(c: Ctx): void {
  const res = [...c.cfg.aiVendors.map((s) => new RegExp(s, 'i')), ...c.cfg.aiKeyNames.map((s) => new RegExp(s))]
  for (const t of c.texts) {
    if (!matches(t.path, c.cfg.aiVendorScope) || matches(t.path, c.cfg.aiAdapterPaths)) continue
    const hits: { line: number; what: string; text: string }[] = []
    t.lines.forEach((line, k) => {
      for (const re of res) {
        const m = re.exec(line)
        if (m) { hits.push({ line: k + 1, what: `AI vendor or model id "${m[0]}" outside the adapter config (${c.cfg.aiAdapterPaths.join(', ')})`, text: line.trim() }); break }
      }
    })
    perLine(c, t, 'no-ai-vendor', hits, 'the engine never names a model: move the name into the adapter defaults (documented, overridable by flag / env / config) and refer to "the agent" elsewhere')
  }
}

const CLOCK_RE = /\bDate\.now\b|\bnew\s+Date\s*\(\s*\)|\bperformance\.now\b|\bMath\.random\b|\bcrypto\.(?:getRandomValues|randomUUID)\b|\bprocess\.hrtime\b/

function ruleWallClock(c: Ctx): void {
  for (const t of c.texts) {
    if (t.kind !== 'js' || !matches(t.path, c.cfg.renderPath) || matches(t.path, c.cfg.renderPathExclude)) continue
    const hits: { line: number; what: string; text: string }[] = []
    c.bare(t).forEach((line, k) => {
      const m = CLOCK_RE.exec(line)
      if (m) hits.push({ line: k + 1, what: `${m[0].replace(/\s+/g, ' ')} in a render-path module`, text: t.lines[k]!.trim() })
    })
    perLine(c, t, 'no-wallclock', hits, 'time is an input: read story time from the frame, randomness from a seeded generator. A playback clock that only maps wall time to story time is an allowlist entry that says so')
  }
}

/** The example scenes of a project: file name without the suffix, and the title the scene declares (when it can be read). */
export function exampleScenes(c: { files: { path: string }[]; texts: { path: string; text: string }[]; cfg: Pick<Config, 'examplesDir' | 'sceneSuffix'> }): { name: string; title: string | null }[] {
  const dir = c.cfg.examplesDir.replace(/\/+$/, '') + '/'
  const out: { name: string; title: string | null }[] = []
  for (const f of c.files) {
    if (!f.path.startsWith(dir) || !f.path.endsWith(c.cfg.sceneSuffix)) continue
    const name = basename(f.path).slice(0, -c.cfg.sceneSuffix.length)
    const text = c.texts.find((t) => t.path === f.path)?.text ?? ''
    const m = /\bscene\(\s*\{[^}]*?\btitle\s*:\s*(['"`])((?:(?!\1)[^\\\n]|\\.)+)\1/.exec(text)
    if (name !== '') out.push({ name, title: m ? m[2]! : null })
  }
  return out
}

/**
 * Rule 4 of docs/OSS-HYGIENE.md, as far as a machine can see it. In engine code (comments are not code):
 *   - a field that identifies one object (config.topicFields: id, title, subtitle) compared with a string literal,
 *     matched against one (startsWith / includes …) or switched on: the engine would behave differently for one scene;
 *   - the file name of an example, its path, or its title; and, for a name of several words (slider-crank), the name
 *     itself inside a string. A one-word name (pendulum, shapes) is ordinary vocabulary and is only caught in those forms.
 * It cannot see a branch on a subject that is spelled any other way: that stays a matter for review.
 */
function ruleTopic(c: Ctx): void {
  const fields = c.cfg.topicFields.map(escapeRe).join('|')
  if (fields === '') return
  const lit = `(['"])(?:(?!\\2)[^\\\\\\n$])+\\2`
  const keyed = [
    new RegExp(`\\.(${fields})\\s*(?:===|!==|==|!=)\\s*${lit}`),
    new RegExp(`(['"])(?:(?!\\1)[^\\\\\\n$])+\\1\\s*(?:===|!==|==|!=)\\s*[\\w$.\\]\\[!?]*\\.(${fields})\\b(?!\\s*\\()`),
    new RegExp(`\\.(${fields})\\??\\.(?:startsWith|endsWith|includes|match|search|indexOf)\\(\\s*(?:(['"])(?:(?!\\2)[^\\\\\\n$])+\\2|/)`),
    new RegExp(`\\bswitch\\s*\\(\\s*[\\w$.\\]\\[!?]*\\.(${fields})\\s*\\)`),
  ]
  const examples = exampleScenes(c)
  const dir = c.cfg.examplesDir.replace(/\/+$/, '')
  const named: { re: RegExp; what: string }[] = []
  for (const e of examples) {
    named.push({ re: new RegExp(`(?<![\\w-])${escapeRe(e.name + c.cfg.sceneSuffix)}(?![\\w-])|(?<![\\w-])${escapeRe(dir)}/${escapeRe(e.name)}(?![\\w-])`), what: `the example "${e.name}"` })
    if (/[^A-Za-z0-9]/.test(e.name)) named.push({ re: new RegExp(`(['"\`])[^'"\`\\n]*(?<![\\w-])${escapeRe(e.name)}(?![\\w-])[^'"\`\\n]*\\1`), what: `the example "${e.name}"` })
    if (e.title && e.title.trim().length >= 8) named.push({ re: new RegExp(escapeRe(e.title)), what: `the title of the example "${e.name}"` })
  }
  for (const t of c.texts) {
    if (t.kind !== 'js' || !matches(t.path, c.cfg.engineScope) || matches(t.path, c.cfg.engineScopeExclude)) continue
    const hits: { line: number; what: string; text: string }[] = []
    c.code(t).forEach((raw, k) => {
      // `typeof part.id === 'string'` asks for the type of the field, not for one object
      const line = raw.replace(/\btypeof\s+[\w$.\]\[!?]+\s*(?:===|!==|==|!=)\s*(['"])[a-z]+\1/g, 'typeof')
      for (const re of keyed) {
        const m = re.exec(line)
        if (m) { hits.push({ line: k + 1, what: `code keyed on one object: ${m[0].trim().slice(0, 60)}`, text: t.lines[k]!.trim() }); return }
      }
      for (const n of named) {
        if (n.re.test(line)) { hits.push({ line: k + 1, what: `engine code names ${n.what}`, text: t.lines[k]!.trim() }); return }
      }
    })
    perLine(c, t, 'no-topic', hits, 'the engine gets a general feature, never a branch for one scene: read a property the scene declares (an option, a role, a kind flag), or list what exists at run time instead of naming it')
  }
}

/** Group file-level findings by directory so that 400 screenshots are one line each directory, not 400 lines. */
function perDirectory(c: Ctx, rule: string, files: FileEntry[], what: (n: number, sample: string) => string, fix: string): void {
  const groups = new Map<string, FileEntry[]>()
  // tracked and not-yet-tracked files of one directory are two groups: the first needs `git rm --cached`, the second only .gitignore
  for (const f of files) { const d = dirname(f.path) + (f.tracked ? '' : '\0'); groups.set(d, [...(groups.get(d) ?? []), f]) }
  for (const [key, list] of [...groups].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const dir = key.replace('\0', '')
    const kb = Math.round(list.reduce((s, f) => s + f.size, 0) / 1024)
    const one = list.length === 1
    c.add({
      rule, path: one ? list[0]!.path : (dir === '.' ? './' : dir + '/'), line: 0,
      what: what(list.length, basename(list[0]!.path)) + ` (${kb} KB)`, fix,
      text: list.map((f) => f.path).join('\n'), untracked: list.every((f) => !f.tracked),
    })
  }
}

function ruleTrackedMedia(c: Ctx): void {
  const media = c.files.filter((f) => c.cfg.mediaExtensions.includes(extOf(f.path)) && !matches(f.path, c.cfg.mediaAllow) && !matches(f.path, c.cfg.buildOutput))
  perDirectory(c, 'no-tracked-media', media, (n, s) => (n === 1 ? `media / archive file ${s}` : `${n} media / archive files (${s}, …)`),
    'remove from git (git rm --cached) and ignore it; anything shown in the README must be reproducible with one documented command from files in the repository')
}

function ruleBuildOutput(c: Ctx): void {
  const built = c.files.filter((f) => matches(f.path, c.cfg.buildOutput))
  perDirectory(c, 'no-build-output', built, (n, s) => (n === 1 ? `build output / cache file ${s}` : `${n} build output / cache files (${s}, …)`),
    'remove from git (git rm -r --cached) and add the directory to .gitignore')
}

function ruleGenerated(c: Ctx): void {
  for (const t of c.texts) {
    if (!t.tracked || matches(t.path, c.cfg.generatedAllow) || matches(t.path, c.cfg.buildOutput)) continue
    const head = t.text.slice(0, 400)
    const m = /\bGENERATED by\b[^\n]*|@generated\b|\bAUTO-?GENERATED\b[^\n]*|\bDO NOT EDIT\b[^\n]*/i.exec(head)
    if (m) c.add({ rule: 'generated-tracked', path: t.path, line: 1, what: `generated file in git ("${m[0].trim().slice(0, 80)}")`, fix: 'ignore it and generate it on install / before typecheck, or keep it tracked on purpose: list it in config.generatedAllow and let CI fail when it differs from a fresh build', text: m[0].trim() })
  }
}

function ruleLargeFile(c: Ctx): void {
  for (const f of c.files) {
    if (f.size <= c.cfg.maxFileKb * 1024) continue
    if (c.cfg.mediaExtensions.includes(extOf(f.path)) || c.cfg.fontExtensions.includes(extOf(f.path)) || matches(f.path, c.cfg.buildOutput)) continue
    if (/(?:^|\/)(?:bun\.lockb?|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(f.path)) continue
    c.add({ rule: 'large-file', path: f.path, line: 0, what: `${Math.round(f.size / 1024)} KB (limit ${c.cfg.maxFileKb} KB)`, fix: 'keep large or generated data out of git, or raise config.maxFileKb with a reason', untracked: !f.tracked })
  }
}

function ruleInternalNotes(c: Ctx): void {
  if (!c.cfg.internalPaths.length) return
  const groups = new Map<string, FileEntry[]>()
  for (const f of c.files) {
    const owner = c.cfg.internalPaths.find((g) => matches(f.path, [g]))
    if (owner) groups.set(owner, [...(groups.get(owner) ?? []), f])
  }
  for (const [glob, list] of groups) {
    const kb = Math.round(list.reduce((s, f) => s + f.size, 0) / 1024)
    c.add({ rule: 'internal-notes', path: glob.replace(/\*\*$/, ''), line: 0, what: `${list.length} file${list.length === 1 ? '' : 's'} of internal process notes (${kb} KB), e.g. ${list[0]!.path}`, fix: 'move out of the published tree (a private repository or branch) before the first public commit', text: list.map((f) => f.path).join('\n'), untracked: list.every((f) => !f.tracked) })
  }
}

function ruleDanglingRef(c: Ctx): void {
  if (!c.cfg.internalRefs.length) return
  const re = new RegExp(c.cfg.internalRefs.join('|'), 'i')
  for (const t of c.texts) {
    if ((!matches(t.path, c.cfg.codeScope) && !matches(t.path, c.cfg.internalRefDocs)) || matches(t.path, c.cfg.internalPaths)) continue
    const hits: { line: number; what: string; text: string }[] = []
    t.lines.forEach((line, k) => { const m = re.exec(line); if (m) hits.push({ line: k + 1, what: `refers to "${m[0]}", an internal note that is not published`, text: line.trim() }) })
    perLine(c, t, 'dangling-internal-ref', hits, 'state the fact where it is cited, or cite a published document (the notices file, a public doc, the upstream source)')
  }
}

const MARKER_RE = /\b(?:ported|transcribed|adapted|derived|copied|borrowed|taken)\b[^\n]{0,60}?\bfrom\s+([A-Za-z0-9@][\w@./-]*)/i

function ruleNotices(c: Ctx): void {
  const file = c.cfg.noticesFile
  const notices = c.texts.find((t) => t.path === file)
  const fixAdd = `add a section to ${file}: name, where it came from, its licence and copyright line, and which files use it`
  if (!notices) c.add({ rule: 'third-party-notice', path: file, line: 0, what: `${file} does not exist`, fix: `create ${file} and list every third-party asset, dependency and ported algorithm with its licence` })
  const has = (name: string): boolean => !!notices && notices.text.toLowerCase().includes(name.toLowerCase())

  // 1. runtime dependencies
  const pkg = c.texts.find((t) => t.path === 'package.json')
  if (pkg) {
    let deps: string[] = []
    try { deps = Object.keys((JSON.parse(pkg.text) as { dependencies?: Record<string, string> }).dependencies ?? {}) } catch { /* reported by nobody: not this rule's business */ }
    for (const d of deps) {
      if (has(d)) continue
      const line = pkg.lines.findIndex((l) => l.includes(`"${d}"`)) + 1
      c.add({ rule: 'third-party-notice', path: 'package.json', line, what: `runtime dependency "${d}" is not listed in ${file} (it is bundled into what users receive)`, fix: fixAdd, text: `"${d}"` })
    }
  }

  // 2. known origins and explicit provenance markers
  // code first, then the files at the root; internal notes are not published, so what they cite needs no notice
  const scope = c.texts
    .filter((t) => t.path !== file && !matches(t.path, c.cfg.internalPaths) && (matches(t.path, c.cfg.codeScope) || !t.path.includes('/')))
    .sort((x, y) => Number(matches(y.path, c.cfg.codeScope)) - Number(matches(x.path, c.cfg.codeScope)))
  for (const o of c.cfg.origins) {
    if (has(o.notice)) continue
    const re = new RegExp(o.pattern, 'i')
    const users: { t: TextFile; line: number }[] = []
    for (const t of scope) { const k = t.lines.findIndex((l) => re.test(l)); if (k >= 0) users.push({ t, line: k + 1 }) }
    if (!users.length) continue
    const first = users[0]!
    c.add({ rule: 'third-party-notice', path: first.t.path, line: first.line, what: `"${o.notice}" is used or cited in ${users.length} file${users.length === 1 ? '' : 's'} (${users.slice(0, 6).map((u) => u.t.path).join(', ')}${users.length > 6 ? ', …' : ''}) and is not listed in ${file}`, fix: fixAdd, text: first.t.lines[first.line - 1]!.trim(), untracked: !first.t.tracked })
  }
  for (const t of scope) {
    if (!matches(t.path, c.cfg.codeScope)) continue
    const hits: { line: number; what: string; text: string }[] = []
    t.lines.forEach((line, k) => {
      const m = MARKER_RE.exec(line)
      if (!m) return
      const origin = m[1]!.replace(/[.,;:)]+$/, '')
      // a reference, not a figure of speech ("derived from this"): a path, a package, a version or a proper name
      if (!/[/@.\d-]|^[A-Z]/.test(origin)) return
      const parts = [origin, ...origin.split('/')].filter((p) => p.length >= 4)
      if (parts.some(has)) return
      if (c.cfg.origins.some((o) => new RegExp(o.pattern, 'i').test(line))) return // reported once above, by name
      hits.push({ line: k + 1, what: `says it comes from "${origin}", which is not listed in ${file}`, text: line.trim() })
    })
    perLine(c, t, 'third-party-notice', hits, `${fixAdd}; when the origin is this project's own earlier work, say so in the notices file (or in an allowlist entry)`)
  }

  // 3. font files
  const fonts = c.files.filter((f) => c.cfg.fontExtensions.includes(extOf(f.path)) && !matches(f.path, c.cfg.buildOutput))
  const unlisted = fonts.filter((f) => !has(f.path) && !has(dirname(f.path) + '/') && !has(basename(f.path)))
  perDirectory(c, 'third-party-notice', unlisted, (n, s) => (n === 1 ? `font file ${s} has no entry in ${file}` : `${n} font files (${s}, …) have no entry in ${file}`),
    `name the family, its source and its licence in ${file} and mention this directory or each file; remove fonts that are not shipped`)
}

/** Files under a directory, root-relative with forward slashes (used for build output, which git does not list). */
function filesUnder(root: string, dir: string, out: string[] = []): string[] {
  let entries: import('node:fs').Dirent[]
  try { entries = readdirSync(join(root, dir), { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = dir === '' ? e.name : dir + '/' + e.name
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.git') filesUnder(root, p, out) } else if (e.isFile()) out.push(p)
  }
  return out
}

function ruleBundleNotice(c: Ctx): void {
  for (const b of c.cfg.bundleNotices) {
    // the fixed part of the glob is the directory to list: 'dist/*.js' → 'dist'
    const fixed = b.files.split('/').filter((seg, i, all) => i < all.length - 1 && !/[*?]/.test(seg)).join('/')
    const marker = new RegExp(b.marker), notice = new RegExp(b.notice, 'i')
    for (const path of filesUnder(c.root, fixed).filter((p) => matches(p, [b.files])).sort()) {
      let text: string
      try { text = readFileSync(join(c.root, path), 'utf8') } catch { continue }
      if (!marker.test(text) || notice.test(text)) continue
      c.add({ rule: 'bundle-notice', path, line: 0, what: `contains ${b.name} but not its copyright line (every copy must carry it: this file, and every export that embeds it)`, fix: `keep the licence comment when bundling (a banner on the chunk, or legal comments preserved by the minifier) so that /${b.notice}/ matches`, text: b.name })
    }
  }
}

function ruleLicence(c: Ctx): void {
  const present = c.cfg.licenceFiles.filter((n) => c.files.some((f) => f.path === n && f.size > 0))
  const pkg = c.texts.find((t) => t.path === 'package.json')
  let declared: string | null = null
  if (pkg) { try { const v = (JSON.parse(pkg.text) as { license?: unknown }).license; declared = typeof v === 'string' ? v : null } catch { /* unreadable package.json */ } }
  if (!present.length) {
    c.add({ rule: 'licence-file', path: c.cfg.licenceFiles[0]!, line: 0, what: `no licence file at the repository root (looked for ${c.cfg.licenceFiles.join(', ')})${declared ? `; package.json says "${declared}"` : ''}`, fix: `add ${c.cfg.licenceFiles[0]} with the full licence text and the copyright holder's name` })
    return
  }
  if (pkg && declared === null) c.add({ rule: 'licence-file', path: 'package.json', line: 0, what: 'package.json has no "license" field', fix: 'add "license": "<SPDX id>" that matches the licence file' })
  const text = c.texts.find((t) => t.path === present[0])?.text ?? ''
  if (declared === 'MIT' && !/Permission is hereby granted, free of charge/i.test(text)) c.add({ rule: 'licence-file', path: present[0]!, line: 1, what: 'package.json says MIT but this file is not the MIT licence text', fix: 'use the standard MIT text, or change "license" in package.json' })
  if (/\[year\]|\[fullname\]|<year>|<copyright holders?>|\bYEAR\b|\bCOPYRIGHT HOLDER\b/.test(text)) c.add({ rule: 'licence-file', path: present[0]!, line: 1, what: 'the licence file still has a placeholder for the year or the copyright holder', fix: 'fill in the year and the holder' })
}

const SECRET_RES: [string, RegExp][] = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['API key', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}\b/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['bearer token', /\bBearer\s+[A-Za-z0-9._~+/-]{30,}={0,2}/],
]

function ruleSecrets(c: Ctx): void {
  for (const f of c.files) {
    const b = basename(f.path)
    if ((/^\.env(?:\..+)?$/.test(b) && !/\.(?:example|sample|template)$/.test(b)) || /\.(?:pem|p12|pfx|key)$/.test(b) || /^id_(?:rsa|ed25519|ecdsa)$/.test(b)) {
      c.add({ rule: 'no-secret', path: f.path, line: 0, what: 'a file that normally holds credentials', fix: 'remove it from git, rotate what it held, and ignore the name', untracked: !f.tracked })
    }
  }
  for (const t of c.texts) {
    const hits: { line: number; what: string; text: string }[] = []
    t.lines.forEach((line, k) => { for (const [name, re] of SECRET_RES) if (re.test(line)) { hits.push({ line: k + 1, what: `looks like a ${name}`, text: '(not shown)' }); break } })
    perLine(c, t, 'no-secret', hits, 'remove it, rotate it, and read it from the environment at run time')
  }
}

function ruleFocusedTest(c: Ctx): void {
  for (const t of c.texts) {
    if (t.kind !== 'js' || !matches(t.path, c.cfg.codeScope)) continue
    const hits: { line: number; what: string; text: string }[] = []
    c.bare(t).forEach((line, k) => { const m = /\b(?:test|it|describe)\.only\s*\(|\bdebugger\b/.exec(line); if (m) hits.push({ line: k + 1, what: `${m[0].replace(/\s*\($/, '')} left behind`, text: t.lines[k]!.trim() }) })
    perLine(c, t, 'focused-test', hits, 'remove it: a focused test silently skips the rest of the suite')
  }
}

const RULE_FNS: Record<string, (c: Ctx) => void> = {
  'no-home-path': ruleHomePath,
  'no-username': ruleUsername,
  'no-fixed-port': ruleFixedPort,
  'browser-path': ruleBrowserPath,
  'no-platform-path': rulePlatformPath,
  'no-ai-vendor': ruleAiVendor,
  'no-wallclock': ruleWallClock,
  'no-topic': ruleTopic,
  'no-tracked-media': ruleTrackedMedia,
  'no-build-output': ruleBuildOutput,
  'generated-tracked': ruleGenerated,
  'large-file': ruleLargeFile,
  'internal-notes': ruleInternalNotes,
  'dangling-internal-ref': ruleDanglingRef,
  'third-party-notice': ruleNotices,
  'bundle-notice': ruleBundleNotice,
  'licence-file': ruleLicence,
  'no-secret': ruleSecrets,
  'focused-test': ruleFocusedTest,
}

// ── allowlist ────────────────────────────────────────────────────────────────────────────────────────

export interface AllowFile { config?: Partial<Config>; allow?: AllowEntry[] }

/** Read the allowlist file. Problems with the file itself come back as findings (rule "allowlist"). */
export function readAllowFile(path: string, shown: string): { file: AllowFile; problems: Finding[] } {
  const problems: Finding[] = []
  const bad = (what: string, fix: string): void => void problems.push({ rule: 'allowlist', path: shown, line: 0, what, fix })
  let file: AllowFile = {}
  try { file = JSON.parse(readFileSync(path, 'utf8')) as AllowFile } catch (e) { bad(`cannot read the allowlist: ${(e as Error).message}`, 'make it valid JSON: { "config": { … }, "allow": [ { "rule", "path", "contains"?, "reason" } ] }'); return { file: {}, problems } }
  if (file === null || typeof file !== 'object' || Array.isArray(file)) { bad('the allowlist must be an object with "allow" (and optionally "config")', 'wrap the entries: { "allow": [ … ] }'); return { file: {}, problems } }
  const unknown = Object.keys(file.config ?? {}).filter((k) => !(k in DEFAULT_CONFIG))
  if (unknown.length) bad(`unknown config key${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`, `use one of: ${Object.keys(DEFAULT_CONFIG).join(', ')}`)
  const entries = Array.isArray(file.allow) ? file.allow : []
  file.allow = entries.filter((e, i) => {
    const where = `allow[${i}]${e && typeof e.path === 'string' ? ` (${e.rule} ${e.path})` : ''}`
    if (e === null || typeof e !== 'object' || typeof e.rule !== 'string' || typeof e.path !== 'string') { bad(`${where} needs "rule" and "path"`, 'write { "rule": "<rule id>", "path": "<file or glob>", "reason": "<why this is fine>" }'); return false }
    if (!(e.rule in RULES)) { bad(`${where} names an unknown rule "${e.rule}"`, `use one of: ${Object.keys(RULE_FNS).join(', ')}`); return false }
    if (typeof e.reason !== 'string' || e.reason.trim().length < 12) { bad(`${where} has no reason`, 'say in a sentence why this exception is safe; an entry without a reason is ignored'); return false }
    if (e.pending !== undefined && typeof e.pending !== 'boolean') { bad(`${where}: "pending" must be true or false`, 'write "pending": true for a known violation that waits for its owner, or leave it out for an accepted exception'); return false }
    if (e.contains !== undefined && (typeof e.contains !== 'string' || e.contains === '')) { bad(`${where}: "contains" must be a non-empty string`, 'give a piece of the offending line, or leave "contains" out to allow the whole file for that rule'); return false }
    return true
  })
  return { file, problems }
}

// ── run ──────────────────────────────────────────────────────────────────────────────────────────────

/** Names of the machine this runs on that must not leak into files; generic build accounts are ignored. */
export function machineNames(cfg: Config, env: Record<string, string | undefined> = process.env): string[] {
  const raw: string[] = []
  try { raw.push(userInfo().username) } catch { /* no passwd entry */ }
  raw.push(basename(homedir()), env.USER ?? '', env.LOGNAME ?? '', env.USERNAME ?? '', hostname().split('.')[0] ?? '')
  raw.push(...(env.MIMIR_HYGIENE_NAMES ?? '').split(','))
  const generic = new Set(c14n(cfg.genericUsers))
  return [...new Set(raw.map((s) => s.trim()).filter((s) => s.length >= 4 && !generic.has(s.toLowerCase()) && !/^localhost$/i.test(s)))]
}
const c14n = (list: readonly string[]): string[] => list.map((s) => s.toLowerCase())

export function runHygiene(opts: Options): Report {
  const root = resolve(opts.root)
  const here = typeof import.meta.dir === 'string' ? import.meta.dir : process.cwd()
  const allowPath = opts.allowlist === null ? null : opts.allowlist !== undefined ? resolve(opts.allowlist) : existsSync(join(here, 'hygiene.allow.json')) ? join(here, 'hygiene.allow.json') : null
  const shownAllow = allowPath === null ? '' : (relative(root, allowPath).startsWith('..') ? allowPath : relative(root, allowPath)).split(sep).join('/')
  const raw: Finding[] = []
  let allowFile: AllowFile = {}
  if (allowPath !== null) {
    if (!existsSync(allowPath)) raw.push({ rule: 'allowlist', path: shownAllow, line: 0, what: 'the allowlist file does not exist', fix: 'create it ({ "allow": [] }) or drop --allowlist' })
    else { const r = readAllowFile(allowPath, shownAllow); allowFile = r.file; raw.push(...r.problems) }
  }
  const cfg: Config = { ...DEFAULT_CONFIG, ...(allowFile.config ?? {}), ...(opts.config ?? {}) }
  const self = [...cfg.selfPaths]
  // wherever this script and its allowlist really are, they hold the patterns they look for
  for (const p of [join(here, 'hygiene.ts'), allowPath ?? '']) { if (p) { const rel = relative(root, p).split(sep).join('/'); if (!rel.startsWith('..')) self.push(rel) } }

  const { files, mode } = listFiles(root, opts)
  const texts: TextFile[] = []
  for (const f of files) { if (matches(f.path, self)) continue; const t = readText(root, f, cfg); if (t) texts.push(t) }
  const codeCache = new Map<string, string[]>(), bareCache = new Map<string, string[]>()
  const ctx: Ctx = {
    root, cfg, files: files.filter((f) => !matches(f.path, self)), texts,
    names: opts.names ?? machineNames(cfg),
    add: (f) => void raw.push(f),
    code(t) { let v = codeCache.get(t.path); if (!v) codeCache.set(t.path, (v = (t.kind === 'js' ? maskJs(t.text, { strings: false }) : t.kind === 'sh' ? maskSh(t.text) : t.text).split('\n'))); return v },
    bare(t) { let v = bareCache.get(t.path); if (!v) bareCache.set(t.path, (v = (t.kind === 'js' ? maskJs(t.text, { strings: true }) : t.text).split('\n'))); return v },
  }
  const wanted = opts.rules?.length ? opts.rules : Object.keys(RULE_FNS)
  for (const r of wanted) RULE_FNS[r]?.(ctx)

  // apply the allowlist
  const entries = allowFile.allow ?? []
  const used = new Array<number>(entries.length).fill(0)
  const findings: Finding[] = []
  const pending: Finding[] = []
  let allowed = 0
  for (const f of raw) {
    const k = f.rule === 'allowlist' ? -1 : entries.findIndex((e) => e.rule === f.rule && matches(f.path, [e.path]) && (e.contains === undefined || (f.text ?? '').includes(e.contains) || f.what.includes(e.contains)))
    if (k < 0) { findings.push(f); continue }
    used[k]!++
    // a pending entry is a known violation, not an exception: it is counted on every run and is a finding with --strict
    if (entries[k]!.pending) { if (opts.strict) findings.push(f); else pending.push(f) } else allowed++
  }
  const resolved: string[] = []
  if (!opts.rules?.length) entries.forEach((e, i) => {
    if (used[i] === 0 && e.pending && !opts.strict) { resolved.push(`allow[${i}] (${e.rule} ${e.path})`); return }
    if (used[i] === 0) findings.push({ rule: 'allowlist', path: shownAllow, line: 0, what: `allow[${i}] (${e.rule} ${e.path}${e.contains ? ` contains "${e.contains}"` : ''}) no longer suppresses anything`, fix: 'delete the entry: the code it excused is gone or has changed' })
  })
  const order = Object.keys(RULES)
  findings.sort((a, b) => order.indexOf(a.rule) - order.indexOf(b.rule) || (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line))
  return { root, mode, files: files.length, tracked: files.filter((f) => f.tracked).length, rules: wanted, findings, allowed, pending, resolved }
}

export function formatReport(r: Report, verbose = false): string {
  const lines: string[] = []
  let rule = ''
  for (const f of r.findings) {
    if (f.rule !== rule) { rule = f.rule; lines.push('', `${rule}: ${RULES[rule] ?? ''}`) }
    lines.push(`  ${f.path}${f.line > 0 ? `:${f.line}` : ''}  ${f.rule}  ${f.what}${f.untracked ? '  [not tracked yet]' : ''}`)
    if (verbose && f.text && f.line === 0) for (const p of f.text.split('\n')) lines.push(`      ${p}`)
    lines.push(`      fix: ${f.fix}`)
  }
  const perRule = new Map<string, number>()
  for (const f of r.findings) perRule.set(f.rule, (perRule.get(f.rule) ?? 0) + 1)
  const scanned = `${r.files} files (${r.mode === 'git' ? `${r.tracked} tracked, ${r.files - r.tracked} not tracked yet` : 'directory walk, no git'})`
  lines.push('')
  const waiting = r.pending.length ? `, ${r.pending.length} pending` : ''
  if (!r.findings.length) lines.push(`hygiene: clean. ${scanned}, ${r.rules.length} rules, ${r.allowed} allowlisted${waiting}.`)
  else {
    lines.push(`hygiene: ${r.findings.length} finding${r.findings.length === 1 ? '' : 's'} in ${scanned}, ${r.allowed} allowlisted${waiting}.`)
    lines.push('  ' + [...perRule].map(([k, v]) => `${k} ${v}`).join(' · '))
  }
  if (r.pending.length) {
    const byRule = new Map<string, number>()
    for (const f of r.pending) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1)
    lines.push(`  pending (known violations waiting for their owner; \`--strict\` fails on them, and must pass before publishing): ${[...byRule].map(([k, v]) => `${k} ${v}`).join(' · ')}`)
    if (verbose) for (const f of r.pending) lines.push(`    ${f.path}${f.line > 0 ? `:${f.line}` : ''}  ${f.rule}  ${f.what}`)
  }
  if (r.resolved.length) lines.push(`  resolved (pending entries whose violation is gone: delete them from the allowlist): ${r.resolved.join(', ')}`)
  return lines.join('\n').replace(/^\n/, '') + '\n'
}

function usage(): string {
  return [
    'usage: bun scripts/hygiene.ts [--root dir] [--allowlist file | --no-allowlist] [--tracked-only] [--no-git]',
    '                              [--rules a,b] [--strict] [--json] [--verbose] [--list-rules]',
    '',
    'Checks every file git would publish against docs/OSS-HYGIENE.md. Exit 0 clean, 1 findings, 2 usage.',
    'Exceptions and project paths live in scripts/hygiene.allow.json ("allow" entries need a "reason").',
    'An entry with "pending": true is a known violation, not an exception: --strict reports it (run it before publishing).',
    'MIMIR_HYGIENE_NAMES=a,b adds names that must not appear in any file.',
  ].join('\n') + '\n'
}

export function main(argv: readonly string[]): number {
  const opts: Options = { root: '' }
  let json = false, verbose = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    const value = (): string => { const v = argv[++i]; if (v === undefined) throw new Error(`${a} needs a value`); return v }
    try {
      if (a === '--root') opts.root = value()
      else if (a === '--allowlist') opts.allowlist = value()
      else if (a === '--no-allowlist') opts.allowlist = null
      else if (a === '--tracked-only') opts.trackedOnly = true
      else if (a === '--no-git') opts.noGit = true
      else if (a === '--rules') opts.rules = value().split(',').map((s) => s.trim()).filter(Boolean)
      else if (a === '--strict') opts.strict = true
      else if (a === '--json') json = true
      else if (a === '--verbose') verbose = true
      else if (a === '--list-rules') { process.stdout.write(Object.entries(RULES).map(([k, v]) => `${k.padEnd(24)}${v}`).join('\n') + '\n'); return 0 }
      else if (a === '--help' || a === '-h') { process.stdout.write(usage()); return 0 }
      else throw new Error(`unknown option ${a}`)
    } catch (e) {
      process.stderr.write(`hygiene: ${(e as Error).message}\n${usage()}`)
      return 2
    }
  }
  const unknown = (opts.rules ?? []).filter((r) => !(r in RULE_FNS))
  if (unknown.length) { process.stderr.write(`hygiene: unknown rule ${unknown.join(', ')} (see --list-rules)\n`); return 2 }
  if (opts.root === '') {
    // scripts/hygiene.ts lives one level below the repository root; anywhere else, check the working directory
    const here = typeof import.meta.dir === 'string' ? import.meta.dir : process.cwd()
    opts.root = process.env.MIMIR_HYGIENE_ROOT ?? (existsSync(join(here, '..', 'package.json')) ? resolve(here, '..') : process.cwd())
  }
  if (!existsSync(opts.root) || !statSync(opts.root).isDirectory()) { process.stderr.write(`hygiene: no such directory: ${opts.root}\n`); return 2 }
  const report = runHygiene(opts)
  process.stdout.write(json ? JSON.stringify(report) + '\n' : formatReport(report, verbose))
  return report.findings.length ? 1 : 0
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
