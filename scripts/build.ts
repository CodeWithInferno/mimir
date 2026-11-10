// bun scripts/build.ts [--barrels] [--sourcemap] [--quiet] [--no-strict] [--where]   (MIMIR_BUILD_STRICT=0 is the same as --no-strict;
//                                                                           --where lists the largest source files of every chunk)
//
// 1. Discovers modules by file name (nobody edits a shared file to add one):
//      src/<module>/index.ts        → main chunk  (dist/mimir.js)         exports `api` = its public names
//                                     or, when it says `export const lazy = true`, the module's own API chunk
//                                     (dist/mimir.<module>api.js), loaded before a scene that uses one of its names
//      src/<module>/three.ts        → chunk '3d'   (dist/mimir.3d.js)      three.js + 3D backends
//      src/<module>/check.ts        → chunk 'check' (dist/mimir.check.js)  rules, dev only
//      src/<module>/<name>.chunk.ts → chunk <name> (dist/mimir.<name>.js)  a module's own lazy chunk
//      src/<module>/api.d.ts        → types/mimir.d.ts                     the typed reference
//    The CHUNKS table below is the whole rule. A lazy chunk is loaded by the runtime when a scene needs it (a kind
//    names it with `chunk`, or code calls model.requireChunk), and `mimir export` inlines exactly the loaded ones.
// 2. Imports every module file once under bun and fails on a name that is registered twice (kinds, verbs, setters,
//    step actions, overlays, rules …) unless the second registration says `override: true`.
// 3. Generates the barrels in src/_generated/ and the typed reference.
// 4. Bundles the chunks into a scratch directory and only then moves them into dist/, so a failed build leaves the
//    last good dist in place. A lazy chunk never contains a second copy of a main-chunk module: such imports are
//    redirected to the live objects the main chunk publishes (globalThis.__mimirBridge), NAME BY NAME, so the main
//    chunk keeps only the names somebody uses. A module's own chunk may use three.js and the files of the 3D chunk
//    the same way: those names are published by the 3D chunk, which is then loaded first.
// 5. Writes dist/viewer.html and dist/build.json (what was built, from which inputs) and prints min + gzip sizes.
//    Over a budget of DESIGN D13 the build FAILS (the last good dist stays); --no-strict only reports it.
// 6. Writes docs/CONFIG.md from the defaults the modules registered with defineConfig (the comment on a key in the
//    source is its documentation), and tells the dev chunk every key, so a setting of a module that is not loaded is
//    still known. `--print-config` prints that document instead of building (the test that keeps the file true).
// 7. Third-party notices travel with the code: every chunk starts with a `/*! … */` banner naming the npm packages
//    bundled into it (name, version, licence and copyright line, read from the package itself) and carrying the header
//    of every source file that embeds third-party data (font faces). `mimir export` inlines the chunks whole.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import type { BunPlugin } from 'bun'
import { inputSignature } from '../src/cli/paths.ts'

const ROOT = resolve(import.meta.dir, '..')
const SRC = join(ROOT, 'src')
const GEN = join(SRC, '_generated')
const DIST = join(ROOT, 'dist')
const args = new Set(process.argv.slice(2))
const log = (...a: unknown[]): void => { if (!args.has('--quiet')) console.log(...a) }
const fail = (msg: string): never => { console.error(`build: ${msg}`); process.exit(1) }

// ── the chunk table ──────────────────────────────────────────────────────────────────────────────────
interface ChunkRule {
  /** the on-demand module whose check rules this dev chunk holds */
  feature?: string
  /** file name inside a module directory */
  file: RegExp
  /** chunk name ($1 = the first capture of `file`) */
  chunk: string
  /** the only chunk that may import three.js */
  three?: boolean
  /** never part of an export (development tools) */
  dev?: boolean
  /** more entry files, relative to src/ */
  roots?: string[]
  /** extra lines of the generated barrel */
  barrel?: string[]
  /** the API of an on-demand module (its index.ts and what that alone imports) */
  api?: boolean
}
const CHUNKS: ChunkRule[] = [
  { file: /^three\.ts$/, chunk: '3d', three: true },
  { file: /^check\.ts$/, chunk: 'check', dev: true, roots: ['check/engine.ts'], barrel: [`export { runCheck, planSamples, runQuery } from '../check/engine.ts'`] },
  { file: /^([a-z][a-z0-9]*)\.chunk\.ts$/, chunk: '$1' },
]
/** the chunk of an on-demand module's index.ts: <module>api (a module says `export const lazy = true` to be one) */
const API_RULE: ChunkRule = { file: /^index\.ts$/, chunk: 'api', api: true }
const apiChunkOf = (module: string): string => `${module}api`
const RESERVED = new Set(['3d', 'check', 'js', 'd'])
/** the check rules of an on-demand module are a dev chunk of their own, loaded with `check` only when the scene uses the module: check<module> */
const featureCheckOf = (module: string): string => `check${module}`
/** core + 2D + player, the 3D chunk on top of it, and everything a viewer can ever load (DESIGN D13), in KB gzip */
// Feature-wave budgets (KB gzip). The first-load target stays small (DESIGN D13): after the wave the integrator
// splits every feature module into its own on-demand chunk, loaded by the names a scene uses.
// Each limit can be overridden: MIMIR_BUDGET_CORE / MIMIR_BUDGET_WITH3D / MIMIR_BUDGET_ALL / MIMIR_BUDGET_DATA (KB gzip).
// The ceiling counts code. A chunk that is embedded binary data (font faces as base64: nothing to minify, loaded one
// face group at a time) is a "data chunk" and has a limit of its own, so type cannot hide in the code budget or eat it.
const budgetOf = (name: string, fallback: number) => { const v = Number(process.env[name]); return Number.isFinite(v) && v > 0 ? v : fallback }
const BUDGET = { core: budgetOf('MIMIR_BUDGET_CORE', 120), with3d: budgetOf('MIMIR_BUDGET_WITH3D', 320), ceiling: budgetOf('MIMIR_BUDGET_ALL', 900), data: budgetOf('MIMIR_BUDGET_DATA', 280) }
/** a base64 literal at least this long is embedded binary data; a chunk that is at least DATA_SHARE of such literals is a data chunk */
const DATA_LITERAL = 4096, DATA_SHARE = 0.9

// ── discovery ────────────────────────────────────────────────────────────────────────────────────────
const NOT_MODULES = new Set(['_generated', 'lib', 'cli'])
const FIRST = ['core', 'r2d', 'r3d', 'anim']
const dirs = readdirSync(SRC).filter((d) => !NOT_MODULES.has(d) && statSync(join(SRC, d)).isDirectory())
const modules = [...FIRST.filter((d) => dirs.includes(d)), ...dirs.filter((d) => !FIRST.includes(d)).sort()]
const having = (file: string): string[] => modules.filter((m) => existsSync(join(SRC, m, file)))
const indexMods = having('index.ts'), dtsMods = having('api.d.ts')
const rel = (p: string): string => relative(SRC, p).split('\\').join('/')
const IDENT = /^[A-Za-z_$][\w$]*$/

interface Chunk { name: string; rule: ChunkRule; /** module directories that feed it */ modules: string[]; /** entry files (absolute) */ entries: string[]; /** generated barrel (absolute) */ barrel: string; out: string; /** chunks that must be loaded before this one */ deps: string[] }
const chunks: Chunk[] = []
for (const m of modules) {
  for (const file of readdirSync(join(SRC, m)).sort()) {
    // a file that looks like a chunk and is not one would be left out without a word
    if (/\.chunk\.ts$/.test(file) && !CHUNKS.some((r) => r.file.test(file))) fail(`src/${m}/${file} is not a valid chunk file name: a chunk is <name>.chunk.ts with a name of lowercase letters and digits that starts with a letter (it becomes dist/mimir.<name>.js)`)
    for (const rule of CHUNKS) {
      const hit = file.match(rule.file)
      if (!hit) continue
      const name = rule.chunk.replace('$1', hit[1] ?? '')
      if (rule.chunk === '$1' && RESERVED.has(name)) fail(`src/${m}/${file}: "${name}" is a reserved chunk name; 3D backends go in three.ts and check rules in check.ts`)
      if (rule.chunk === '$1' && name.startsWith('check')) fail(`src/${m}/${file}: chunk names that start with "check" are the rule chunks of on-demand modules (their check.ts); pick another name`)
      if (rule.chunk === '$1' && name.endsWith('api')) fail(`src/${m}/${file}: chunk names that end in "api" are the API chunks of on-demand modules (an index.ts with \`export const lazy = true\`); pick another name`)
      let c = chunks.find((x) => x.name === name)
      if (!c) chunks.push((c = { name, rule, modules: [], entries: [], barrel: join(GEN, name === '3d' ? 'three.ts' : name === 'check' ? 'check.ts' : `chunk.${name}.ts`), out: `mimir.${name}.js`, deps: [] }))
      c.modules.push(m)
      c.entries.push(join(SRC, m, file))
      break
    }
  }
}
// the check chunk exists even when no module has rules of its own: the engine lives in it
if (!chunks.some((c) => c.name === 'check') && existsSync(join(SRC, 'check', 'engine.ts'))) chunks.push({ name: 'check', rule: CHUNKS[1]!, modules: [], entries: [], barrel: join(GEN, 'check.ts'), out: 'mimir.check.js', deps: [] })
const sortChunks = (): void => { chunks.sort((a, b) => (a.name === '3d' ? -1 : b.name === '3d' ? 1 : a.name === 'check' ? -1 : b.name === 'check' ? 1 : a.name < b.name ? -1 : 1)) }
sortChunks()

/** Why a module file could not be imported: a file that does not parse is named with its line, not blamed on the DOM. */
function importFailure(file: string, e: unknown, rule: string): string {
  const all = [e, ...(((e as { errors?: unknown[] })?.errors) ?? [])] as { name?: string; message?: string; position?: { file?: string; line?: number; column?: number; lineText?: string } | null }[]
  const parse = all.filter((x) => x?.position && typeof x.position.line === 'number')
  if (parse.length) return `${file} does not build:\n` + parse.map((x) => `  ${relative(ROOT, x.position!.file ?? file)}:${x.position!.line}:${x.position!.column ?? 0}: ${x.message}${x.position!.lineText ? `\n    ${x.position!.lineText.trim()}` : ''}`).join('\n')
  return `${file} cannot be imported without a DOM (${rule}):\n${(e as Error)?.stack ?? e}`
}

// ── public names: import each index.ts (they are environment-agnostic by contract) and read `api` ───────────
const owners = new Map<string, string>()
const apiNames: string[] = []
/** modules whose index.ts says `export const lazy = true`: their API is a chunk of its own, loaded for the scenes that use one of its names */
const lazyMods: string[] = []
for (const m of indexMods) {
  let mod: Record<string, unknown>
  try { mod = await import(join(SRC, m, 'index.ts')) } catch (e) { fail(importFailure(`src/${m}/index.ts`, e, 'it must not touch the DOM or three.js at import time')); throw e }
  const api = mod.api
  if (mod.lazy === true) {
    if (api === undefined || typeof api !== 'object' || api === null || !Object.keys(api).length) fail(`src/${m}/index.ts says \`lazy = true\` but exports no public names in \`api\`: nothing could ever ask for it`)
    lazyMods.push(m)
  }
  if (api === undefined) { log(`  note: src/${m}/index.ts exports no \`api\` (no public names)`); continue }
  if (typeof api !== 'object' || api === null) fail(`src/${m}/index.ts: \`api\` must be an object of public names`)
  for (const name of Object.keys(api as object)) {
    if (!IDENT.test(name)) fail(`src/${m}/index.ts: api name "${name}" is not a valid identifier`)
    const other = owners.get(name)
    if (other) fail(`public name "${name}" is exported by both src/${other} and src/${m}; one of them must rename it`)
    owners.set(name, m)
    apiNames.push(name)
  }
}

for (const m of lazyMods) chunks.push({ name: apiChunkOf(m), rule: API_RULE, modules: [m], entries: [join(SRC, m, 'index.ts')], barrel: join(GEN, `chunk.${apiChunkOf(m)}.ts`), out: `mimir.${apiChunkOf(m)}.js`, deps: [] })
// The rules of an on-demand module leave the check chunk for one of their own: `check` then loads no module's API, and
// a scene is only measured by the rules of the modules it uses.
{
  const check = chunks.find((c) => c.name === 'check')
  for (const m of lazyMods) {
    const file = join(SRC, m, 'check.ts')
    if (!check || !check.entries.includes(file)) continue
    check.entries = check.entries.filter((f) => f !== file)
    check.modules = check.modules.filter((x) => x !== m)
    const name = featureCheckOf(m)
    chunks.push({ name, rule: { file: /^check\.ts$/, chunk: name, dev: true, feature: m }, modules: [m], entries: [file], barrel: join(GEN, `chunk.${name}.ts`), out: `mimir.${name}.js`, deps: [] })
  }
}
sortChunks()
const isLazy = (m: string): boolean => lazyMods.includes(m)

// ── registrations: every chunk file is imported too, then the ledger must hold no name twice ─────────────
/** method-like names an on-demand module adds to objects other modules make (`part.on(…)`): a scene that calls one needs the module */
const lazyMethods = new Map<string, string[]>()
for (const c of chunks) {
  for (const f of c.entries) {
    try { await import(f) } catch (e) { fail(importFailure(`src/${rel(f)}`, e, 'use the DOM and WebGL only inside functions that run in the browser')) }
  }
}
{
  const core = (await import(join(SRC, 'core', 'index.ts'))) as { registryConflicts?: () => { registry: string; name: string; first: string | null; second: string | null }[]; allKinds?: () => { name: string; chunks?: string[] }[]; ownerOf?: (registry: string, name: string) => string | null; registrations?: () => { registry: string; name: string; owner: string | null }[] }
  for (const r of core.registrations?.() ?? []) {
    const m = (r.owner ?? '').split('/')[0]!
    if (!isLazy(m) || !['setter', 'method', 'getter', 'sceneMethod', 'stepAction'].includes(r.registry)) continue
    const name = r.name.slice(r.name.lastIndexOf(':') + 1)
    if (IDENT.test(name)) lazyMethods.set(m, [...new Set([...(lazyMethods.get(m) ?? []), name])])
  }
  // a kind that names a chunk nobody builds would only fail when a scene uses it, in the browser
  const known = new Set(chunks.map((c) => c.name))
  for (const k of core.allKinds?.() ?? []) for (const c of k.chunks ?? []) {
    if (known.has(c) || (c === '3d' && !known.size)) continue
    fail(`the kind "${k.name}" (src/${core.ownerOf?.('kind', k.name) ?? '?'}) names the lazy chunk "${c}", which does not exist (chunks: ${[...known].join(', ') || 'none'}). A chunk is a file src/<module>/${/^[a-z][a-z0-9]*$/.test(c) ? c : '<name>'}.chunk.ts; its name is lowercase letters and digits.`)
  }
  const clashes = core.registryConflicts?.() ?? []
  if (clashes.length) {
    fail(`${clashes.length} name${clashes.length === 1 ? ' is' : 's are'} registered twice:\n` + clashes.map((c) => `  ${c.registry} "${c.name}": src/${c.first ?? '?'} and src/${c.second ?? '?'}`).join('\n') +
      `\nRename one of each pair. To replace a seed definition on purpose, pass \`override: true\` in the second registration.`)
  }
}

// ── settings: every default the modules registered (defineConfig), with the comment on it as its documentation ──────
interface ConfigKey { key: string; value: unknown; owner: string | null; doc: string }
const configKeys: ConfigKey[] = await (async () => {
  const core = (await import(join(SRC, 'core', 'index.ts'))) as { allConfig?: () => [string, unknown][]; registrations?: () => { registry: string; name: string; owner: string | null; site: string | null }[] }
  const sites = new Map((core.registrations?.() ?? []).filter((r) => r.registry === 'config').map((r) => [r.name, r]))
  const docsOf = new Map<string, Map<string, string>>() // site → path below the group → doc
  const out: ConfigKey[] = []
  for (const [key, value] of core.allConfig?.() ?? []) {
    const reg = sites.get(key)
    const site = reg?.site ?? ''
    if (site && !docsOf.has(site)) docsOf.set(site, tableDocs(site))
    const found = docsOf.get(site)
    // the doc of the key itself, else of the nearest group above it
    let doc = ''
    for (let path = key; path && !doc; path = path.includes('.') ? path.slice(0, path.lastIndexOf('.')) : '') doc = found?.get(path) ?? ''
    out.push({ key, value, owner: reg?.owner ?? null, doc })
  }
  return out
})()
/**
 * The documentation of a table of defaults: the comment on each key, read from the source at the defineConfig /
 * liveConfig call `site` (file:line:col). Keys are full dotted names. A `/** … *\/` or `//` comment above a key (or
 * before it on its line) documents that key and the keys that follow it on the same line; `// …` at the end of a
 * line documents the keys of that line. A table passed by name is looked up in the same file, or in the file it is
 * imported from.
 */
function tableDocs(site: string): Map<string, string> {
  const docs = new Map<string, string>()
  const m = /^(.*):(\d+):(\d*)$/.exec(site)
  if (!m || !existsSync(m[1]!)) return docs
  const file = m[1]!, text = readFileSync(file, 'utf8')
  const lineStart = text.split('\n').slice(0, Number(m[2]) - 1).join('\n').length + (Number(m[2]) > 1 ? 1 : 0)
  const call = /\b(?:defineConfig|liveConfig)\s*\(\s*(['"])([^'"]+)\1\s*,\s*/g
  call.lastIndex = lineStart
  const hit = call.exec(text)
  if (!hit) return docs
  const group = hit[2]!
  let src = text, at = call.lastIndex
  if (src[at] !== '{') {
    const name = /^[A-Za-z_$][\w$]*/.exec(src.slice(at))?.[0]
    if (!name) return docs
    const literal = (code: string): number => { const d = new RegExp(`\\bconst\\s+${name.replace(/\$/g, '\\$')}\\b[^=]*=\\s*(?:Object\\.freeze\\(\\s*)?\\{`).exec(code); return d ? d.index + d[0].length - 1 : -1 }
    at = literal(src)
    if (at < 0) {
      // imported: follow the import one file
      const imp = new RegExp(`import\\s*(?:type\\s*)?\\{[^}]*\\b${name.replace(/\$/g, '\\$')}\\b[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`).exec(src)
      const other = imp && imp[1]!.startsWith('.') ? resolve(dirname(file), imp[1]!) : null
      if (!other || !existsSync(other)) return docs
      src = readFileSync(other, 'utf8')
      at = literal(src)
      if (at < 0) return docs
    }
    // docs written on a type instead of on the values (`/** … *\/ name: number` in an interface of the same file)
    const seen = new Map<string, Set<string>>()
    for (const d of src.matchAll(/\/\*\*((?:[^*]|\*(?!\/))*)\*\/[ \t]*\n?[ \t]*([A-Za-z_$][\w$]*)\??[ \t]*:/g)) seen.set(d[2]!, new Set([...(seen.get(d[2]!) ?? []), clean(d[1]!)]))
    for (const [k, set] of seen) if (set.size === 1) docs.set(`${group}.${k}`, [...set][0]!)
  }
  for (const [path, doc] of literalDocs(src, at)) docs.set(`${group}.${path}`, doc)
  return docs
}
function clean(comment: string): string { return comment.split('\n').map((l) => l.replace(/^\s*\*?\s?/, '').trim()).filter(Boolean).join(' ') }
/** Walk an object literal that opens at `open` and return path → the comment on that key. */
function literalDocs(src: string, open: number): Map<string, string> {
  const docs = new Map<string, string>()
  const frames: { key: string | null }[] = [{ key: '' }] // key: the object's key in its parent; null = not an object of keys (a list, a call, a nested literal in one)
  const path = (k: string): string => [...frames.map((f) => f.key).filter((x) => x), k].join('.')
  let pending: string | null = null, pendingLine = false // a comment waiting for its key; pendingLine: it was a `//` line
  let expectKey = true
  let lineKeys: string[] = []
  let lastWasCommentLine = false
  for (let i = open + 1; i < src.length && frames.length; i++) {
    const ch = src[i]!
    const top = frames[frames.length - 1]!
    if (ch === '\n') {
      // a comment is about the keys of the line that follows it: once that line is over (or a blank line comes) it is spent
      if (lineKeys.length || /^[ \t]*\n/.test(src.slice(i + 1))) pending = null
      lineKeys = []
      continue
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') continue
    if (ch === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i)
      const text = src.slice(i + 2, end < 0 ? src.length : end).trim()
      if (lineKeys.length) { for (const k of lineKeys) if (!docs.has(k)) docs.set(k, text) }
      else if (top.key !== null) { pending = pending !== null && pendingLine && lastWasCommentLine ? `${pending} ${text}` : text; pendingLine = true; lastWasCommentLine = true }
      i = (end < 0 ? src.length : end) - 1
      continue
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      if (top.key !== null) { pending = clean(src.slice(i + 2, end < 0 ? src.length : end).replace(/^\*/, '')); pendingLine = false }
      i = end < 0 ? src.length : end + 1
      continue
    }
    lastWasCommentLine = false
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1
      while (j < src.length && src[j] !== ch) j += src[j] === '\\' ? 2 : 1
      const colon = ch === '`' ? null : /^\s*:(?!:)\s*/.exec(src.slice(j + 1))
      if (top.key !== null && expectKey && colon) { i = key(src.slice(i + 1, j), j + colon[0].length); continue }
      i = j
      expectKey = false
      continue
    }
    if (ch === '{' || ch === '[' || ch === '(') { frames.push({ key: null }); continue }
    if (ch === '}' || ch === ']' || ch === ')') { frames.pop(); expectKey = false; if (frames.length && frames[frames.length - 1]!.key !== null) pending = null; continue }
    if (ch === ',') { if (top.key !== null) expectKey = true; continue }
    if (top.key !== null && expectKey && /[A-Za-z_$]/.test(ch)) {
      const name = /^[A-Za-z_$][\w$]*/.exec(src.slice(i))![0]
      const rest = /^\s*:(?!:)\s*/.exec(src.slice(i + name.length))
      if (rest) { i = key(name, i + name.length + rest[0].length - 1); continue }
      i += name.length - 1
      expectKey = false
      continue
    }
    expectKey = false
  }
  /** A key was read; `i` is the last character of `key:`. Notes its doc and opens its object when the value is one. */
  function key(name: string, i: number): number {
    const k = path(name)
    if (pending !== null) docs.set(k, pending)
    lineKeys.push(k)
    expectKey = false
    const value = /^\s*\{/.exec(src.slice(i + 1))
    if (value) { frames.push({ key: name }); expectKey = true; pending = null; lineKeys = []; return i + value[0].length }
    return i
  }
  return docs
}

/** docs/CONFIG.md: every setting, its default and what it does, from the registrations above. */
function configDoc(): string {
  const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const show = (v: unknown): string => { const j = JSON.stringify(v); return j.length > 60 ? j.slice(0, 57) + '…' : j }
  const groups = new Map<string, ConfigKey[]>()
  for (const k of configKeys) { const g = k.key.split('.')[0]!; groups.set(g, [...(groups.get(g) ?? []), k]) }
  const lines = [
    '# Settings',
    '',
    '<!-- Generated by scripts/build.ts from the defaults the modules register with defineConfig. Do not edit: change the',
    '     default (and the comment on it) in the source file named under each group, then run `bun scripts/build.ts`.',
    '     tests/unit/integration/config.test.ts fails when this file and the sources disagree. -->',
    '',
    'Every default that shapes what Mimir draws is a named setting. A setting is read in one way',
    '(`model.config(\'pace.play\')`), and can be changed in three places. The nearest one wins:',
    '',
    '1. **A scene**: `scene({ title, defaults: { pace: { play: 1.5 } } }, s => { … })`, or `s.config({ \'pace.play\': 1.5 })`',
    '   on the first line of the builder (what was created before the call keeps the old value, and `check` says so).',
    '   `s.config(\'pace.play\')` reads the value in force.',
    '2. **A project**: `mimir.config.json` at the project root: `{ "defaults": { "pace": { "play": 1.5 } } }`. The CLI',
    '   hands it to the viewer (`?config=<url>`; an export carries it inline). Other top-level keys of the file belong',
    '   to the CLI.',
    '3. **The default** registered by the module that owns the setting (the tables below).',
    '',
    'Groups nest and keys may be written dotted: `{ pace: { play: 1.5 } }` and `{ \'pace.play\': 1.5 }` are the same.',
    'A value is plain data (a number, a text, true / false, null or a list), never a function: time is not an input here.',
    'An unknown key, or a value of the wrong type, is a diagnostic with the nearest name (`API-UNKNOWN`, `API-TYPE`,',
    '`NUM-INVALID`); the default stays in force. Keys of a module that is not loaded in the viewer are judged by',
    '`mimir check`, which knows every module of the build.',
    '',
    `${configKeys.length} settings in ${groups.size} groups: ${[...groups.keys()].map((g) => `[\`${g}\`](#${g})`).join(' · ')}.`,
    '',
  ]
  for (const [g, keys] of groups) {
    const owners = [...new Set(keys.map((k) => k.owner).filter(Boolean))]
    lines.push(`## ${g}`, '', owners.length ? `Registered in ${owners.map((o) => `\`src/${o}\``).join(', ')}.` : '', '', '| Setting | Default | What it is |', '|---|---|---|')
    for (const k of keys) lines.push(`| \`${k.key}\` | \`${cell(show(k.value))}\` | ${cell(k.doc)} |`)
    lines.push('')
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}
if (args.has('--print-config')) { process.stdout.write(configDoc()); process.exit(0) }
{
  const undocumented = configKeys.filter((k) => !k.doc)
  if (undocumented.length) log(`  settings: ${undocumented.length} of ${configKeys.length} have no comment on them (docs/CONFIG.md shows them without a description): ${undocumented.slice(0, 8).map((k) => k.key).join(', ')}${undocumented.length > 8 ? ', …' : ''}`)
  const file = join(ROOT, 'docs', 'CONFIG.md'), text = configDoc()
  if (existsSync(join(ROOT, 'docs')) && (!existsSync(file) || readFileSync(file, 'utf8') !== text)) writeFileSync(file, text)
}

// ── import graph (to know which main-chunk files the lazy chunks reach) ────────────────────────────────
const transpiler = new Bun.Transpiler({ loader: 'ts' })
const SIBLING = /^\.\/mimir\.[a-z0-9]+\.js$/
const importsOf = (file: string): { local: string[]; bare: string[] } => {
  const out = { local: [] as string[], bare: [] as string[] }
  for (const imp of transpiler.scanImports(readFileSync(file, 'utf8'))) {
    if (SIBLING.test(imp.path)) continue // the main chunk's literal imports of its lazy siblings (dist files)
    if (imp.path.startsWith('.')) out.local.push(resolve(dirname(file), imp.path))
    else out.bare.push(imp.path)
  }
  return out
}
function walk(roots: string[], stop: Set<string> = new Set()): { files: Set<string>; bare: Set<string>; stopped: Set<string> } {
  const files = new Set<string>(), bare = new Set<string>(), stopped = new Set<string>()
  const todo = [...roots]
  while (todo.length) {
    const f = todo.pop()!
    if (files.has(f)) continue
    if (stop.has(f)) { stopped.add(f); continue }
    if (!existsSync(f)) fail(`cannot resolve ${f} (imports must be relative paths with the .ts extension)`)
    files.add(f)
    const im = importsOf(f)
    im.bare.forEach((b) => bare.add(b))
    todo.push(...im.local)
  }
  return { files, bare, stopped }
}
/**
 * What a file imports, name by name: target (absolute path of a local file, or the bare specifier) → the names, or
 * '*' when it takes the whole module (import * as, export * from, a dynamic import). Read from the transpiled
 * source, where type-only imports are gone and every import statement is on one line.
 */
function namesOf(file: string): Map<string, Set<string> | '*'> {
  const out = new Map<string, Set<string> | '*'>()
  const js = transpiler.transformSync(readFileSync(file, 'utf8'))
  const key = (spec: string): string => (spec.startsWith('.') ? resolve(dirname(file), spec) : spec)
  const add = (spec: string, names: string[] | '*'): void => {
    const k = key(spec)
    const cur = out.get(k)
    if (names === '*' || cur === '*') { out.set(k, '*'); return }
    const set = cur ?? new Set<string>()
    names.forEach((n) => set.add(n))
    out.set(k, set)
  }
  const list = (inner: string): string[] => inner.split(',').map((x) => x.trim().split(/\s+as\s+/)[0]!.trim()).filter(Boolean)
  for (const m of js.matchAll(/^\s*import\s*(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*["']([^"']+)["']/gm)) add(m[3]!, [...(m[1] ? ['default'] : []), ...list(m[2] ?? '')])
  for (const m of js.matchAll(/^\s*import\s*(?:[A-Za-z_$][\w$]*\s*,\s*)?\*\s*as\s+[A-Za-z_$][\w$]*\s*from\s*["']([^"']+)["']/gm)) add(m[1]!, '*')
  for (const m of js.matchAll(/^\s*import\s*["']([^"']+)["']/gm)) add(m[1]!, [])
  for (const m of js.matchAll(/^\s*export\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/gm)) add(m[2]!, list(m[1]!))
  for (const m of js.matchAll(/^\s*export\s*\*\s*(?:as\s+[A-Za-z_$][\w$]*\s*)?from\s*["']([^"']+)["']/gm)) add(m[1]!, '*')
  for (const m of js.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) add(m[1]!, '*')
  return out
}
const mainRoots = indexMods.filter((m) => !isLazy(m)).map((m) => join(SRC, m, 'index.ts'))
// the generated chunk loader is part of the main chunk; it is written below, so it is not walked here
const main = walk(mainRoots)
const isThree = (b: string): boolean => b === 'three' || b.startsWith('three/')
if ([...main.bare].some(isThree)) fail('a main-chunk module imports three.js; only src/<module>/three.ts (and what it alone imports) may')
// src/lib/** is pure (no state, no registries): a lazy chunk bundles its own tree-shaken copy of what it imports from
// there, so a library that a chunk needs costs the main chunk nothing, whoever else imports from the same file.
// Every other main-chunk file exists once and is shared (the registries live there).
const LIB = join(SRC, 'lib') + '/'
const shared = new Set([...main.files].filter((f) => !f.startsWith(LIB)))
const graphs = new Map<string, ReturnType<typeof walk>>()
/** names the lazy chunks take from main-chunk files (published by the main chunk) and from three.js / files of the 3D chunk (published by the 3D chunk): key → names or '*' */
const fromMain = new Map<string, Set<string> | '*'>()
const from3d = new Map<string, Set<string> | '*'>()
/** the same for the files of an on-demand module's API chunk: API chunk name → file → names */
const fromApi = new Map<string, Map<string, Set<string> | '*'>>()
/** file of an API chunk → that chunk */
const apiOwner = new Map<string, string>()
const note = (into: Map<string, Set<string> | '*'>, key: string, names: Set<string> | '*'): void => {
  const cur = into.get(key)
  if (names === '*' || cur === '*') into.set(key, '*')
  else into.set(key, new Set([...(cur ?? []), ...names]))
}
// an on-demand module may build on another one (import names from its index.ts): every API entry is owned by its own
// chunk before any chunk is walked, whatever the order of the module directories
for (const c of chunks) if (c.rule.api) for (const e of c.entries) apiOwner.set(e, c.name)
// publishers first: the 3D chunk, then the API chunks, then everything that may build on them
const rank = (c: Chunk): number => (c.rule.three ? 0 : c.rule.api ? 1 : c.name === 'check' ? 2 : 3)
for (const c of [...chunks].sort((a, b) => rank(a) - rank(b))) {
  // a module's own chunk may build on the 3D chunk: its files (and three.js itself) are then not copied but shared.
  // The files of an on-demand module's API chunk exist once too: whoever else imports them reads the published names.
  const three = graphs.get('3d')
  const stop = new Set([...shared, ...(c.rule.three || c.rule.api || !three ? [] : [...three.files].filter((f) => !f.startsWith(LIB))), ...(c.rule.three ? [] : [...apiOwner].filter(([, owner]) => owner !== c.name).map(([file]) => file))])
  const g = walk([...c.entries, ...(c.rule.roots ?? []).map((r) => join(SRC, r)).filter(existsSync)], stop)
  const usesThree = [...g.bare].some(isThree)
  if (c.rule.api && usesThree) fail(`src/${c.modules[0]}/index.ts (or a file it imports) imports three.js; an index.ts is environment-agnostic, three.js belongs in three.ts or the module's chunk`)
  if (c.rule.api) for (const f of g.files) if (!f.startsWith(LIB)) apiOwner.set(f, c.name)
  if (c.rule.dev && usesThree) fail(`the "${c.name}" chunk imports three.js (${c.entries.map(rel).join(', ')}); rules measure through RuleCtx (screenRect, idPass) instead`)
  if (!c.rule.three && usesThree && !three) fail(`the "${c.name}" chunk imports three.js (${c.entries.map(rel).join(', ')}) but there is no 3D chunk (no src/<module>/three.ts) to share it with`)
  for (const [other, og] of graphs) for (const f of g.files) if (og.files.has(f) && !f.startsWith(LIB)) fail(`${rel(f)} is imported by both the "${other}" chunk and the "${c.name}" chunk; move it under a module index.ts (main chunk) so it exists once`)
  for (const f of g.files) {
    for (const [target, names] of namesOf(f)) {
      if (shared.has(target)) note(fromMain, target, names)
      else if (!c.rule.three && (isThree(target) || (three?.files.has(target) && !target.startsWith(LIB)))) {
        if (names === '*' && isThree(target)) fail(`${rel(f)} takes the whole of "${target}" (import * as …): import the names you use, so the 3D chunk keeps only those`)
        note(from3d, target, names)
        if (!c.deps.includes('3d')) c.deps.push('3d')
      } else if (apiOwner.has(target) && apiOwner.get(target) !== c.name) {
        const pub = apiOwner.get(target)!
        if (!fromApi.has(pub)) fromApi.set(pub, new Map())
        note(fromApi.get(pub)!, target, names)
        if (!c.deps.includes(pub)) c.deps.push(pub)
      }
    }
  }
  graphs.set(c.name, g)
}
// the barrel of the dev chunk tells the config store every setting of the build (written below): it takes that one name from the core
if (configKeys.length && chunks.some((c) => c.name === 'check')) note(fromMain, join(SRC, 'core', 'index.ts'), new Set(['declareConfig']))
const bridged = [...fromMain.keys()].sort()
const bridgeKey = (target: string): string => (target.startsWith('/') ? rel(target) : target)
/** `import { a as p_a, b as p_b } from 'x'` + the object `{ a: p_a, b: p_b }`, or the namespace when everything is taken */
const bridgeEntry = (target: string, names: Set<string> | '*', prefix: string, from: string): { line: string; value: string } => {
  if (names === '*') return { line: `import * as ${prefix} from '${from}'`, value: prefix }
  const list = [...names].sort()
  if (!list.length) return { line: `import '${from}'`, value: '{}' }
  return { line: `import { ${list.map((n) => `${n} as ${prefix}_${n}`).join(', ')} } from '${from}'`, value: `{ ${list.map((n) => `${n}: ${prefix}_${n}`).join(', ')} }` }
}

// ── barrels ──────────────────────────────────────────────────────────────────────────────────────────
mkdirSync(GEN, { recursive: true })
const HEADER = '// GENERATED by scripts/build.ts from the module directories under src/. Do not edit.\n'
const written = new Set<string>()
const writeGen = (file: string, text: string): void => {
  written.add(file)
  if (!existsSync(file) || readFileSync(file, 'utf8') !== text) writeFileSync(file, text)
}
{
  const eager = indexMods.filter((m) => !isLazy(m))
  const withApi = eager.filter((m) => [...owners.values()].includes(m))
  const eagerNames = apiNames.filter((n) => !isLazy(owners.get(n)!)), lateNames = apiNames.filter((n) => isLazy(owners.get(n)!))
  const lines = [HEADER]
  eager.forEach((m) => lines.push(withApi.includes(m) ? `import { api as a_${m} } from '../${m}/index.ts'` : `import '../${m}/index.ts'`))
  lazyMods.forEach((m) => lines.push(`import type { api as a_${m} } from '../${m}/index.ts'`))
  lines.push('', `/** every public name: \`import { … } from 'mimir'\` and globalThis (the names of on-demand modules are added when their chunk arrives) */`, `export const api: Record<string, unknown> = { ${withApi.map((m) => `...a_${m}`).join(', ')} }`)
  if (eagerNames.length) lines.push(`export const {\n  ${eagerNames.join(', ')},\n} = { ${withApi.map((m) => `...a_${m}`).join(', ')} }`)
  if (lateNames.length) {
    lines.push('', '// Public names of on-demand modules: live bindings, undefined until the module\'s API chunk is loaded (the viewer', '// loads it before it imports a scene that uses one of the names).',
      ...lateNames.map((n) => `export let ${n}: (typeof a_${owners.get(n)})['${n}']`),
      `const late: Record<string, (v: never) => void> = { ${lateNames.map((n) => `${n}: (v) => { ${n} = v }`).join(', ')} }`)
  } else lines.push('const late: Record<string, (v: never) => void> = {}')
  lines.push('/** The API of an on-demand module has arrived: its names become exports of this module and part of `api`. */',
    'export function installApi(names: Record<string, unknown>): void { for (const [k, v] of Object.entries(names)) { late[k]?.(v as never); api[k] = v } }',
    `export const MODULES = ${JSON.stringify(indexMods)}`, '')
  writeGen(join(GEN, 'core.ts'), lines.join('\n'))
}
for (const c of chunks) {
  const lines = [HEADER, ...(c.rule.api ? [`export { api } from '../${rel(c.entries[0]!)}'`] : c.entries.map((f) => `import '../${rel(f)}'`)), ...(c.rule.barrel ?? [])]
  const published = c.rule.three ? from3d : fromApi.get(c.name)
  if (published?.size) {
    // what the chunks that build on this one take from its files (and, for the 3D chunk, from three.js), published name by name
    const entries = [...published].sort(([a], [b]) => (a < b ? -1 : 1)).map(([target, names], i) => ({ key: bridgeKey(target), ...bridgeEntry(target, names, `t${i}`, target.startsWith('/') ? `../${rel(target)}` : target) }))
    lines.push('// names that other lazy chunks take from the files of this chunk (and from three.js): they read them from here', ...entries.map((e) => e.line),
      `Object.assign(((globalThis as { __mimirBridge?: Record<string, unknown> }).__mimirBridge ??= {}), { ${entries.map((e) => `${JSON.stringify(e.key)}: ${e.value}`).join(', ')} })`)
  }
  // the dev chunk knows the settings of every module of the build, loaded or not: `check` judges unknown keys against them
  if (c.name === 'check' && configKeys.length) lines.push(`import { declareConfig } from '../core/index.ts'`, `declareConfig(${JSON.stringify(Object.fromEntries(configKeys.map((k) => [k.key, k.value])))})`)
  lines.push(`export const MODULES = ${JSON.stringify(c.modules)}`, '')
  writeGen(c.barrel, lines.join('\n'))
}
writeGen(join(GEN, 'chunks.ts'), [
  HEADER,
  '// Loaders of the lazy chunks by name. The specifiers are literal and point next to the main bundle, so the build',
  '// keeps them external and `mimir export` can find, inline and rewrite them.',
  'export const chunks: Record<string, () => Promise<unknown>> = {',
  // a chunk that builds on another one (a 3D module's own chunk on the 3D chunk) loads that one first
  ...chunks.flatMap((c) => ['  // @ts-ignore the chunk exists only after the build', `  ${JSON.stringify(c.name)}: () => ${c.deps.map((d) => `import('./${chunks.find((x) => x.name === d)!.out}').then(() => `).join('')}import('./${c.out}')${')'.repeat(c.deps.length)},`]),
  '}',
  `export const CHUNK_INFO: { name: string; file: string; dev: boolean; modules: string[]; deps: string[]; feature?: string }[] = ${JSON.stringify(chunks.map((c) => ({ name: c.name, file: c.out, dev: !!c.rule.dev, modules: c.modules, deps: c.deps, ...(c.rule.feature ? { feature: c.rule.feature } : {}) })))}`,
  '/** On-demand modules: the chunk that holds a module\'s API, its public names, and the method names it adds to other objects. */',
  `export const FEATURES: { module: string; chunk: string; names: string[]; methods: string[]; check?: string; uses?: string[] }[] = ${JSON.stringify(lazyMods.map((m) => {
    // the on-demand modules this one is built on (its API chunk imports theirs): their check rules apply to its scenes too
    const uses = lazyMods.filter((other) => other !== m && (chunks.find((c) => c.name === apiChunkOf(m))?.deps ?? []).includes(apiChunkOf(other)))
    return { module: m, chunk: apiChunkOf(m), names: apiNames.filter((n) => owners.get(n) === m), methods: lazyMethods.get(m) ?? [], ...(chunks.some((c) => c.rule.feature === m) ? { check: featureCheckOf(m) } : {}), ...(uses.length ? { uses } : {}) }
  }))}`,
  '',
].join('\n'))
writeGen(join(GEN, 'bridge.ts'), [
  HEADER,
  '// What the lazy chunks import from main-chunk modules, name by name: they read these instead of bundling copies, and',
  '// the main chunk keeps nothing of a library that only a lazy chunk uses.',
  ...bridged.map((f, i) => bridgeEntry(f, fromMain.get(f)!, `b${i}`, `../${rel(f)}`).line),
  `export const bridge: Record<string, unknown> = { ${bridged.map((f, i) => `${JSON.stringify(rel(f))}: ${bridgeEntry(f, fromMain.get(f)!, `b${i}`, `../${rel(f)}`).value}`).join(', ')} }`,
  '',
].join('\n'))
// a barrel of a chunk (or module) that no longer exists must not survive: it would import files that are gone
for (const f of readdirSync(GEN)) if (f.endsWith('.ts') && !written.has(join(GEN, f))) rmSync(join(GEN, f))
log(`modules: ${indexMods.map((m) => (isLazy(m) ? `${m}(on demand)` : m)).join(' ')}  | ${chunks.map((c) => `${c.name}: ${c.modules.join(' ') || '-'}`).join('  | ')}  | ${apiNames.length} public names`)

// ── typed reference ──────────────────────────────────────────────────────────────────────────────────
{
  // Two files. types/mimir.d.ts is what an author reads: the ambient declarations of every module and nothing else.
  // types/mimir.module.d.ts is plumbing for the type checker (`import { box } from 'mimir'`): one line per name, no
  // information; the first file refers to it, so a tool that is given the reference still sees both.
  const parts: string[] = ['/// <reference path="./mimir.module.d.ts" />', '// GENERATED by scripts/build.ts from src/<module>/api.d.ts. Do not edit. The typed reference: read this file, or `mimir docs reference` for it at one line per declaration.', '// Every name is a global and an export of the module \'mimir\' (declared in mimir.module.d.ts, which only repeats the names).', '']
  const declared = new Set<string>()
  for (const m of dtsMods) {
    const text = readFileSync(join(SRC, m, 'api.d.ts'), 'utf8')
    if (/^\s*(import|export)\s/m.test(text)) fail(`src/${m}/api.d.ts must be an ambient fragment: only \`declare …\`, \`interface\` and \`type\` at the top level (no import / export)`)
    for (const hit of text.matchAll(/^declare\s+(?:function|const|let|var|class|namespace)\s+([A-Za-z_$][\w$]*)/gm)) declared.add(hit[1]!)
    // one banner per module, written here: the reference is looked up by module (`mimir docs module:<name>`). A rule
    // a fragment draws for itself is kept as a plain comment, so its sections stay inside the module.
    const body = text.trim().split('\n').map((l) => { const own = /^(\s*)\/\/\s*[─━═=\-#*]{2,}\s*([^─━═=\-#*].*?)\s*[─━═=\-#*]*\s*$/.exec(l); return own ? `${own[1]}// ${own[2]}` : l }).join('\n')
    parts.push(`// ── ${m} ${'─'.repeat(Math.max(4, 96 - m.length))}`, body, '')
  }
  const typed = apiNames.filter((n) => declared.has(n))
  const untyped = apiNames.filter((n) => !declared.has(n))
  const stale = [...declared].filter((n) => !owners.has(n))
  if (untyped.length) log(`  types: ${untyped.length} public names have no declaration in an api.d.ts: ${untyped.slice(0, 12).join(', ')}${untyped.length > 12 ? ', …' : ''}`)
  if (stale.length) log(`  types: declared but not exported by any module: ${stale.join(', ')}`)
  const moduleForm = ['// GENERATED by scripts/build.ts. Do not edit, and no need to read: the names of types/mimir.d.ts as exports of the module \'mimir\'.', ...typed.map((n) => `type __mimir_${n} = typeof ${n}`), `declare module 'mimir' {`, ...typed.map((n) => `  export const ${n}: __mimir_${n}`), '}', '']
  mkdirSync(join(ROOT, 'types'), { recursive: true })
  for (const [name, text] of [['mimir.d.ts', parts.join('\n')], ['mimir.module.d.ts', moduleForm.join('\n')]] as const) {
    const file = join(ROOT, 'types', name)
    if (!existsSync(file) || readFileSync(file, 'utf8') !== text) writeFileSync(file, text)
  }
}
if (args.has('--barrels')) process.exit(0)

// ── bundles: into a scratch directory first, so a failure leaves the last good dist untouched ────────────
mkdirSync(DIST, { recursive: true })
const TMP = join(DIST, `.build-${process.pid}`)
rmSync(TMP, { recursive: true, force: true })
mkdirSync(TMP)
const abort = (msg: string): never => { rmSync(TMP, { recursive: true, force: true }); return fail(msg) }
const bridgedSet = new Set(bridged)
/** Redirect a chunk's imports of main-chunk files (and, for a chunk that builds on the 3D chunk, of three.js and the 3D chunk's files) to the published objects. */
const bridgePlugin = (c: Chunk): BunPlugin => ({
  name: 'mimir-bridge',
  setup(build) {
    const shared3d = !c.rule.three && c.deps.includes('3d')
    const fromDeps = (abs: string): Set<string> | '*' | undefined => (shared3d ? from3d.get(abs) : undefined) ?? c.deps.map((d) => fromApi.get(d)?.get(abs)).find((x) => x !== undefined)
    build.onResolve({ filter: /^\.\.?\// }, (a) => {
      if (!a.importer || a.namespace === 'mimir-bridge') return undefined
      const abs = resolve(dirname(a.importer), a.path)
      if (bridgedSet.has(abs) || fromDeps(abs)) return { path: abs, namespace: 'mimir-bridge' }
      if (shared.has(abs)) abort(`${rel(a.importer)} imports ${rel(abs)}, a main-chunk file the import scan missed`)
      return undefined
    })
    if (shared3d) build.onResolve({ filter: /^three(\/|$)/ }, (a) => (a.namespace === 'mimir-bridge' ? undefined : { path: a.path, namespace: 'mimir-bridge' }))
    build.onLoad({ filter: /.*/, namespace: 'mimir-bridge' }, async (a) => {
      const wanted = fromMain.get(a.path) ?? fromDeps(a.path)
      const names = (wanted === '*' || wanted === undefined ? Object.keys(await import(a.path)) : [...wanted]).filter((n) => IDENT.test(n) && n !== 'default')
      const key = JSON.stringify(bridgeKey(a.path))
      // each export is a pure call, so the bundler drops the ones a chunk does not use (a chunk pays only for what it imports)
      return { loader: 'js', contents: `const m = globalThis.__mimirBridge && globalThis.__mimirBridge[${key}];\nif (!m) throw new Error('mimir: load mimir.js${fromMain.has(a.path) ? '' : ` and ${c.deps.map((d) => `mimir.${d}.js`).join(', ')}`} before this chunk (missing ' + ${key} + ')');\nconst get = (k) => m[k];\n${names.map((n) => `export const ${n} = /* @__PURE__ */ get(${JSON.stringify(n)});`).join('\n')}\n` }
    })
  },
})
/** the main chunk loads its lazy siblings with literal `import('./mimir.<chunk>.js')`: keep those out of the bundle */
const siblingsPlugin: BunPlugin = {
  name: 'mimir-siblings',
  setup(build) { build.onResolve({ filter: SIBLING }, (a) => ({ path: a.path, external: true })) },
}
const where: string[] = []
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { name?: string; version?: string; license?: string }
/** What the licence of a bundled npm package asks to travel with its code: name, version, licence id and the copyright lines of its licence file. */
const noticeCache = new Map<string, string>()
function packageNotice(pkg: string): string {
  if (noticeCache.has(pkg)) return noticeCache.get(pkg)!
  const dir = join(ROOT, 'node_modules', pkg)
  let meta: { name?: string; version?: string; license?: string | { type?: string } } = {}
  try { meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) } catch { /* reported below */ }
  const licence = typeof meta.license === 'string' ? meta.license : meta.license?.type
  if (!licence) abort(`the npm package "${pkg}" is bundled into the viewer but states no licence in its package.json: its notice cannot be written`)
  const file = existsSync(dir) ? readdirSync(dir).find((f) => /^licen[cs]e(\.|$)/i.test(f)) : undefined
  const copyright = file ? readFileSync(join(dir, file), 'utf8').split('\n').map((l) => l.trim()).filter((l) => /^copyright\b/i.test(l)) : []
  const text = `${meta.name ?? pkg} ${meta.version ?? ''} (${licence})${copyright.length ? `: ${copyright.join('; ')}` : ''}`.replace(/\*\//g, '* /')
  noticeCache.set(pkg, text)
  return text
}
/** The comment block a source file opens with (`//` lines, or one block comment), as one line of text. */
const headerOf = (source: string): string => {
  const block = /^\s*\/\*!?([\s\S]*?)\*\//.exec(source)
  if (block) return block[1]!.split('\n').map((l) => l.replace(/^\s*\*?\s?/, '').trim()).filter(Boolean).join(' ')
  const lines: string[] = []
  for (const l of source.split('\n')) { if (!/^\s*\/\//.test(l)) break; lines.push(l.replace(/^\s*\/\/\s?/, '').trim()) }
  return lines.join(' ')
}
/**
 * The banner of a chunk: this package, the npm packages whose code is in the chunk, and the header of every source
 * file that embeds binary data (a font face taken from another package says where it is from and under which
 * licence) or opens with a legal comment (`/*! … *\/`). One line, so it shifts a source map by exactly one.
 */
function bannerOf(name: string, inputs: Record<string, { bytesInOutput: number }>): string {
  const parts = [`${name}: ${PKG.name ?? 'mimir'} ${PKG.version ?? ''}${PKG.license ? ` (${PKG.license})` : ''}`]
  const packages = new Set<string>()
  for (const [path, v] of Object.entries(inputs)) {
    if (!(v.bytesInOutput > 0)) continue
    const pkg = /.*node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(path)?.[1]
    if (pkg) { packages.add(pkg); continue }
    const file = resolve(ROOT, path)
    if (!file.startsWith(SRC) || !existsSync(file)) continue
    const source = readFileSync(file, 'utf8')
    const data = new RegExp(`[A-Za-z0-9+/]{${DATA_LITERAL},}={0,2}`).test(source)
    if (!data && !/^\s*\/\*!/.test(source)) continue
    const header = headerOf(source)
    if (data && !/licen[cs]e/i.test(header)) abort(`src/${rel(file)} embeds binary data but its opening comment names no licence: say where the data is from and under which licence (the comment travels with the chunk)`)
    parts.push(`src/${rel(file)}: ${header.replace(/\*\//g, '* /')}`)
  }
  for (const pkg of [...packages].sort()) parts.splice(1, 0, `bundles ${packageNotice(pkg)}`)
  return `/*! ${parts.join(' | ')} */\n`
}
/** third-party notices of the build, by chunk file (dist/build.json: `notices`) */
const notices: Record<string, string> = {}
interface Size { name: string; chunk: string; bytes: number; gzip: number; dev: boolean; /** embedded binary data, not code */ data: boolean }
async function bundle(entry: string, name: string, chunk: string, dev: boolean, plugins: BunPlugin[] = []): Promise<Size> {
  // __MIMIR_BUNDLE__: code that only matters while the sources run unbundled (who registered what) is compiled out
  const res = await Bun.build({ entrypoints: [entry], outdir: TMP, naming: name, format: 'esm', target: 'browser', minify: true, define: { __MIMIR_BUNDLE__: 'true', __MIMIR_VERSION__: JSON.stringify(PKG.version ?? '0.0.0') }, sourcemap: args.has('--sourcemap') ? 'external' : 'none', plugins, metafile: true })
  if (!res.success) { for (const l of res.logs) console.error(l); abort(`bundling ${name} failed`) }
  const inputs = (Object.values((res as { metafile?: { outputs: Record<string, { inputs: Record<string, { bytesInOutput: number }> }> } }).metafile?.outputs ?? {}).find((o) => Object.keys(o.inputs ?? {}).length)?.inputs) ?? null
  if (!inputs) abort(`the bundler gave no list of inputs for ${name}: the third-party notices of the chunk cannot be written`)
  // the notices go in front of the minified code (the minifier would drop a comment in the sources)
  {
    const banner = bannerOf(name, inputs!)
    notices[name] = banner.trim()
    writeFileSync(join(TMP, name), banner + readFileSync(join(TMP, name), 'utf8'))
    const map = join(TMP, name + '.map')
    if (existsSync(map)) { const m = JSON.parse(readFileSync(map, 'utf8')) as { mappings?: string }; if (typeof m.mappings === 'string') { m.mappings = ';' + m.mappings; writeFileSync(map, JSON.stringify(m)) } }
  }
  // --where: which source files the bytes of each chunk come from (minified bytes, largest first)
  if (inputs && args.has('--where')) where.push(`${name}\n` + Object.entries(inputs).filter(([, v]) => v.bytesInOutput > 0).sort((a, b) => b[1].bytesInOutput - a[1].bytesInOutput).slice(0, 14).map(([f, v]) => `  ${(v.bytesInOutput / 1024).toFixed(1).padStart(7)} KB  ${f.replace(/^.*node_modules\//, '').replace(/^src\//, '')}`).join('\n'))
  const bytes = readFileSync(join(TMP, name))
  let embedded = 0
  for (const hit of bytes.toString('latin1').matchAll(new RegExp(`[A-Za-z0-9+/]{${DATA_LITERAL},}={0,2}`, 'g'))) embedded += hit[0].length
  return { name, chunk, bytes: bytes.length, gzip: Bun.gzipSync(bytes).length, dev, data: embedded >= DATA_SHARE * bytes.length }
}
const sizes: Size[] = [await bundle(join(SRC, 'index.ts'), 'mimir.js', 'core', false, [siblingsPlugin])]
for (const c of chunks) sizes.push(await bundle(c.barrel, c.out, c.name, !!c.rule.dev, [bridgePlugin(c)]))
const has = (file: string, needle: string): boolean => readFileSync(join(TMP, file), 'utf8').includes(needle)
for (const c of chunks) {
  if (!c.rule.three && has(c.out, 'WebGLRenderer')) abort(`three.js leaked into ${c.out}, which must not contain it`)
  if (!has('mimir.js', `./${c.out}`)) abort(`the main chunk lost its literal import of ./${c.out}`)
}
if (has('mimir.js', 'WebGLRenderer')) abort('three.js leaked into the main chunk')

writeFileSync(join(TMP, 'viewer.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>mimir</title>
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}</style>
<!-- viewer.html?scene=<module url>[&headless=1][&t=<tau>][&step=<k>][&set=name:value,...][&view=<name>][&debug=ids] -->
<script type="importmap">{"imports":{"mimir":"./mimir.js"}}</script>
</head>
<body>
<script type="module">
import { boot } from './mimir.js'
boot()
</script>
</body>
</html>
`)
const g = (chunk: string): number => sizes.find((s) => s.chunk === chunk)?.gzip ?? 0
const kbOf = (n: number): number => Math.round((n / 1024) * 10) / 10
const total3d = g('core') + g('3d')
const totalAll = sizes.filter((s) => !s.dev && !s.data).reduce((sum, s) => sum + s.gzip, 0)
const totalData = sizes.filter((s) => !s.dev && s.data).reduce((sum, s) => sum + s.gzip, 0)
const over = [g('core') > BUDGET.core * 1024 ? 'core' : '', total3d > BUDGET.with3d * 1024 ? 'with 3D' : '', totalAll > BUDGET.ceiling * 1024 ? 'ceiling' : '', totalData > BUDGET.data * 1024 ? 'data' : ''].filter(Boolean)
// what was built, from which set of input files: the CLI compares `inputs` with the tree to know when dist is stale
writeFileSync(join(TMP, 'build.json'), JSON.stringify({
  inputs: inputSignature(ROOT),
  modules: indexMods,
  chunks: sizes.map((s) => ({ chunk: s.chunk, file: s.name, bytes: s.bytes, gzip: s.gzip, dev: s.dev, data: s.data, modules: s.chunk === 'core' ? indexMods.filter((m) => !isLazy(m)) : chunks.find((c) => c.name === s.chunk)?.modules ?? [], deps: chunks.find((c) => c.name === s.chunk)?.deps ?? [] })),
  notices,
  budgets: { coreKb: kbOf(g('core')), coreLimitKb: BUDGET.core, with3dKb: kbOf(total3d), with3dLimitKb: BUDGET.with3d, allKb: kbOf(totalAll), ceilingKb: BUDGET.ceiling, dataKb: kbOf(totalData), dataLimitKb: BUDGET.data, over },
}, null, 1) + '\n')

// A budget is a rule, not a remark: over it the build fails and the last good dist stays (--no-strict only reports).
// The four limits: mimir.js alone; mimir.js + mimir.3d.js; the code of every non-dev chunk together; the data chunks together.
if (over.length && !args.has('--no-strict') && process.env.MIMIR_BUILD_STRICT !== '0') {
  const kbs = (n: number): string => (n / 1024).toFixed(1)
  abort(`over budget (DESIGN D13): ${over.map((o) => (o === 'core' ? `mimir.js is ${kbs(g('core'))} KB gzip (limit ${BUDGET.core})` : o === 'with 3D' ? `mimir.js + mimir.3d.js are ${kbs(total3d)} KB gzip (limit ${BUDGET.with3d})` : o === 'data' ? `the data chunks (embedded fonts) together are ${kbs(totalData)} KB gzip (limit ${BUDGET.data})` : `the code of all chunks together is ${kbs(totalAll)} KB gzip (limit ${BUDGET.ceiling})`)).join('; ')}.\n` +
    `Sizes: ${sizes.map((s) => `${s.name} ${kbs(s.gzip)}`).join(', ')}.\n` +
    'Move weight out of src/<module>/index.ts into the module\'s own lazy chunk (<name>.chunk.ts; a 3D module\'s chunk may import three.js). `bun scripts/build.ts --no-strict` (or MIMIR_BUILD_STRICT=0) builds anyway.')
}
// move the finished files into place; drop chunk files of chunks that no longer exist
const produced = new Set(readdirSync(TMP))
for (const f of readdirSync(DIST)) if (/^mimir\.[a-z0-9]+\.js(\.map)?$/.test(f) && !produced.has(f)) rmSync(join(DIST, f))
for (const f of produced) if (f !== 'build.json') renameSync(join(TMP, f), join(DIST, f))
renameSync(join(TMP, 'build.json'), join(DIST, 'build.json')) // last: its presence says the rest is complete
rmSync(TMP, { recursive: true, force: true })

const kb = (n: number): string => (n / 1024).toFixed(1).padStart(7) + ' KB'
log('\nchunk                    min        gzip')
for (const s of sizes) log(`${s.name.padEnd(22)}${kb(s.bytes)} ${kb(s.gzip)}${s.dev ? '   (dev only)' : s.data ? '   (data)' : ''}`)
log(`\nbudgets (DESIGN D13): core ${(g('core') / 1024).toFixed(1)} / ${BUDGET.core} KB gz ${over.includes('core') ? 'OVER' : 'ok'} · with 3D ${(total3d / 1024).toFixed(1)} / ${BUDGET.with3d} KB gz ${over.includes('with 3D') ? 'OVER' : 'ok'} · all code ${(totalAll / 1024).toFixed(1)} / ${BUDGET.ceiling} KB gz ${over.includes('ceiling') ? 'OVER' : 'ok'} · data (fonts) ${(totalData / 1024).toFixed(1)} / ${BUDGET.data} KB gz ${over.includes('data') ? 'OVER' : 'ok'}`)
log(`wrote dist/viewer.html, dist/build.json, types/mimir.d.ts (+ mimir.module.d.ts)`)
if (where.length) log('\n' + where.join('\n'))
if (over.length) log(`OVER BUDGET (${over.join(', ')}): built because strictness was switched off`)
