// mimir docs [symbol|module|topic]: exact lookup into types/mimir.d.ts. A small declaration scanner, no TypeScript
// compiler: it finds top-level declarations and the members of interfaces / classes / namespaces, each with
// the comment directly above it. The banner comments of the file ("// ── r2d ───") are the modules. A symbol is
// printed with its JSDoc, its declaration and the place an example scene uses it. Topic guides are the markdown
// files of docs/topics (MIMIR_TOPICS), when there are any.
// Also here: `mimir examples` (the example scenes, one line each) and `mimir init` (a starter scene).
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import type { DocsOptions, ExamplesOptions, InitOptions } from '../args.ts'
import { CliError, UsageError, suggest } from '../errors.ts'
import type { Io } from '../io.ts'
import { ensureViewer, ROOT } from '../paths.ts'

export interface DocEntry {
  /** "box", "Scene", "Scene.step", "kit.gear" */
  name: string
  kind: string
  topic: string | null
  /** the comment directly above the declaration, verbatim */
  doc: string
  /** the declaration, verbatim (container bodies included) */
  decl: string
  /** 1-based line in the file */
  line: number
  parent: string | null
}

export interface DocIndex { entries: DocEntry[]; topics: string[] }

const DECL = /^\s*(?:export\s+)?(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(function|const|let|var|interface|type|class|namespace|module|enum)\s+([A-Za-z_$][\w$]*)/
const MEMBER = /^\s*(?:(?:readonly|static|public|private|protected|abstract|get|set|export|declare|function|const|let|var)\s+)*([A-Za-z_$][\w$]*)\s*(?:\?|\(|:|<)/
const BANNER = /^\s*\/\/\s*[─━═=\-#*]{2,}\s*([^─━═=\-#*].*?)\s*[─━═=\-#*]*\s*$/
const CONTAINERS = new Set(['interface', 'class', 'namespace', 'module'])
/** `declare module 'mimir' { export const box: … }`: the same names again for `import … from`, no documentation */
const AMBIENT_MODULE = /^\s*(?:export\s+)?declare\s+module\s+['"]/
/** helper names such as `__mimir_box` are plumbing of the reference file, not API */
const isPrivateName = (name: string): boolean => name.startsWith('__')

/** Index of the character after the declaration that starts at `start` (brace / paren aware, comments and strings skipped). */
function declEnd(src: string, start: number): number {
  let depth = 0
  let sawBrace = false
  for (let i = start; i < src.length; i++) {
    const c = src[i]!
    const two = src.slice(i, i + 2)
    if (two === '//') {
      const nl = src.indexOf('\n', i)
      if (nl < 0) return src.length
      i = nl - 1
      continue
    }
    if (two === '/*') {
      const end = src.indexOf('*/', i + 2)
      if (end < 0) return src.length
      i = end + 1
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1
      i = j
      continue
    }
    if (c === '{' || c === '(' || c === '[') {
      depth++
      if (c === '{') sawBrace = true
    } else if (c === '}' || c === ')' || c === ']') {
      depth--
      if (depth < 0) return i // the enclosing container closes: the member ends here
      if (depth === 0 && c === '}' && sawBrace) {
        // a body just closed; swallow one optional semicolon
        const rest = /^[ \t]*;/.exec(src.slice(i + 1))
        const after = src.slice(i + 1 + (rest ? rest[0].length : 0))
        // `}` followed by more type text (`} | {`, `}[]`, `} & X`) keeps going
        if (!rest && /^\s*(?:[|&\[.]|=>)/.test(after)) continue
        return i + 1 + (rest ? rest[0].length : 0)
      }
    } else if (depth === 0 && c === ';') {
      return i + 1
    } else if (depth === 0 && c === '\n') {
      const before = src.slice(start, i).trimEnd()
      const next = src.slice(i + 1).trimStart()
      const open = /(?:[=,|&:(<{\[?]|=>|\bextends|\bkeyof|\bin|\bof)$/.test(before)
      const cont = /^(?:[|&.?:)\]}]|=>|extends\b)/.test(next)
      if (!open && !cont && before.length > 0) return i
    }
  }
  return src.length
}

/** The comment block (JSDoc or // lines) that ends on the line directly above `lineIndex`. */
function commentAbove(lines: string[], lineIndex: number): string {
  let i = lineIndex - 1
  if (i < 0) return ''
  const last = lines[i]!.trim()
  if (last.endsWith('*/')) {
    let j = i
    while (j >= 0 && !lines[j]!.includes('/*')) j--
    if (j < 0) return ''
    return outdent(lines.slice(j, i + 1))
  }
  if (last.startsWith('//') && !BANNER.test(last)) {
    let j = i
    while (j - 1 >= 0 && lines[j - 1]!.trim().startsWith('//') && !BANNER.test(lines[j - 1]!)) j--
    return outdent(lines.slice(j, i + 1))
  }
  return ''
}

/** Remove the first line's indentation from every line (keeps the " * " alignment of JSDoc). */
function outdent(block: string[]): string {
  const cut = /^\s*/.exec(block[0]!)![0].length
  return block.map((l) => l.slice(Math.min(cut, /^\s*/.exec(l)![0].length)).trimEnd()).join('\n')
}

function dedent(text: string): string {
  const lines = text.split('\n')
  const indents = lines.slice(1).filter((l) => l.trim() !== '').map((l) => /^\s*/.exec(l)![0].length)
  const cut = indents.length ? Math.min(...indents) : 0
  return [lines[0]!.trimStart(), ...lines.slice(1).map((l) => l.slice(Math.min(cut, /^\s*/.exec(l)![0].length)))].join('\n').trimEnd()
}

export function parseDts(src: string): DocIndex {
  const entries: DocEntry[] = []
  const topics: string[] = []
  const lines = src.split('\n')
  const offsets: number[] = []
  let off = 0
  for (const l of lines) {
    offsets.push(off)
    off += l.length + 1
  }
  const lineOf = (offset: number): number => {
    let lo = 0
    let hi = offsets.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (offsets[mid]! <= offset) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  // scan [from, to) line range; parent = container name for members
  const scan = (fromLine: number, toLine: number, parent: string | null, parentKind: string | null, topicIn: string | null): void => {
    let topic = topicIn
    let i = fromLine
    while (i < toLine) {
      const line = lines[i]!
      const trimmed = line.trim()
      if (parent === null) {
        const b = BANNER.exec(line)
        if (b) {
          topic = b[1]!.trim().toLowerCase()
          if (!topics.includes(topic)) topics.push(topic)
          i++
          continue
        }
      }
      if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
        if (trimmed.startsWith('/*') && !trimmed.includes('*/')) {
          while (i < toLine && !lines[i]!.includes('*/')) i++
        }
        i++
        continue
      }
      if (parent === null && AMBIENT_MODULE.test(line)) {
        const start = offsets[i]!
        i = lineOf(Math.max(start, declEnd(src, start) - 1)) + 1
        continue
      }
      const asDecl = parentKind === 'interface' || parentKind === 'class' ? null : DECL.exec(line)
      const asMember = asDecl ? null : parent !== null ? MEMBER.exec(line) : null
      if (!asDecl && !asMember) {
        i++
        continue
      }
      const kind = asDecl ? asDecl[1]! : 'member'
      const short = asDecl ? asDecl[2]! : asMember![1]!
      const start = offsets[i]! + (line.length - line.trimStart().length)
      const end = declEnd(src, start)
      const endLine = lineOf(Math.max(start, end - 1))
      const name = parent ? `${parent}.${short}` : short
      if (!isPrivateName(short)) {
        entries.push({ name, kind, topic, doc: commentAbove(lines, i), decl: dedent(src.slice(start, end)), line: i + 1, parent })
        if (asDecl && CONTAINERS.has(kind) && endLine > i) scan(i + 1, endLine, name, kind, topic)
      }
      i = endLine + 1
    }
  }
  scan(0, lines.length, null, null, null)
  // a banner with nothing documented under it (only plumbing) is not a topic
  return { entries, topics: topics.filter((t) => entries.some((e) => e.topic === t)) }
}

export type Lookup =
  | { kind: 'symbol'; entries: DocEntry[] }
  | { kind: 'topic'; topic: string; entries: DocEntry[] }
  | { kind: 'none'; suggestions: string[] }

/** `module:plot`, `symbol:plot`, `guide:essentials`: what kind of thing a query names, when it says so. */
export const QUERY_KINDS = ['module', 'symbol', 'guide'] as const
export type QueryKind = (typeof QUERY_KINDS)[number]
export function splitQuery(query: string): { kind: QueryKind | null; name: string } {
  const m = /^(module|symbol|guide):(.*)$/i.exec(query.trim())
  return m ? { kind: m[1]!.toLowerCase() as QueryKind, name: m[2]!.trim() } : { kind: null, name: query.trim() }
}
/**
 * Exact lookup. A bare name: a symbol's full name, then a member's short name, then a module (topic) of that name,
 * then symbols ignoring case. `module:<name>` asks for the module only, `symbol:<name>` for the symbol only: several
 * modules share their name with one of their functions (flow, guide, tex).
 */
export function lookup(index: DocIndex, query: string): Lookup {
  const { kind, name: q } = splitQuery(query)
  const short = (e: DocEntry): string => e.name.slice(e.name.lastIndexOf('.') + 1)
  const exact: Array<(e: DocEntry) => boolean> = [(e) => e.name === q, (e) => e.parent !== null && short(e) === q]
  const loose: Array<(e: DocEntry) => boolean> = [(e) => e.name.toLowerCase() === q.toLowerCase(), (e) => e.parent !== null && short(e).toLowerCase() === q.toLowerCase()]
  const symbol = (tries: Array<(e: DocEntry) => boolean>): Lookup | null => {
    for (const match of tries) {
      const hits = index.entries.filter(match)
      if (hits.length) return { kind: 'symbol', entries: hits }
    }
    return null
  }
  const module = (): Lookup | null => {
    const topic = index.topics.find((t) => t === q.toLowerCase())
    return topic === undefined ? null : { kind: 'topic', topic, entries: index.entries.filter((e) => e.topic === topic && e.parent === null) }
  }
  const hit = kind === 'module' ? module() : kind === 'symbol' ? symbol([...exact, ...loose]) : kind === 'guide' ? null : symbol(exact) ?? module() ?? symbol(loose)
  return hit ?? { kind: 'none', suggestions: suggest(q, kind === 'module' ? index.topics : kind === 'symbol' ? index.entries.map((e) => e.name) : [...index.entries.map((e) => e.name), ...index.topics], 5) }
}

export function renderEntry(e: DocEntry): string {
  return (e.doc ? e.doc + '\n' : '') + e.decl
}

const firstLine = (s: string): string => s.split('\n')[0]!

/** One line per declaration of a topic: the signature's first line, plus the first sentence of its comment. */
/** First sentence-line of a JSDoc block, without its comment marks. */
const docLine = (doc: string): string | undefined => doc.replace(/^\/\*\*?|\*\/$/g, '').split('\n').map((l) => l.replace(/^\s*(?:\*|\/\/)\s?/, '').trim()).find((l) => l !== '')
const CONSTANT = /^(\s*(?:export\s+)?(?:declare\s+)?const\s+)([A-Za-z_$][\w$]*)(\s*:\s*[^=;]+?);?$/
/**
 * One line per declaration with the first line of its comment. Constants of one type that follow each other without
 * a comment of their own (the shades of the palette, the direction vectors) share the line of the first.
 * `members`: the members of a container, listed indented under it (the compact reference); left out of a topic list.
 */
function compactLines(entries: readonly DocEntry[], members?: (container: DocEntry) => readonly DocEntry[], indent = ''): string[] {
  const lines: string[] = []
  let run: { head: string; names: string[]; type: string; doc: string | undefined } | null = null
  const flush = (): void => { if (run) lines.push(`${indent}${run.head}${run.names.join(', ')}${run.type}` + (run.doc ? `   // ${run.doc}` : '')); run = null }
  for (const e of entries) {
    const doc = docLine(e.doc)
    const first = firstLine(e.decl).trim()
    const c = e.decl.includes('\n') ? null : CONSTANT.exec(first)
    if (c && run && !doc && c[1] === run.head && c[3] === run.type) { run.names.push(c[2]!); continue }
    flush()
    if (c) { run = { head: c[1]!, names: [c[2]!], type: c[3]!, doc }; continue }
    lines.push(indent + first + (doc ? `   // ${doc}` : ''))
    if (members) lines.push(...compactLines(members(e), undefined, indent + '  '))
  }
  flush()
  return lines
}
/** A module of the reference: its declarations, one line each. */
export function renderTopic(topic: string, entries: readonly DocEntry[]): string {
  return [`# ${topic}`, ...compactLines(entries)].join('\n')
}
/** Words that ask `mimir docs` for the whole compact reference instead of one name. */
export const REFERENCE_WORDS = ['reference']
/**
 * The whole reference, compact: every module's declarations one line each, the members of Scene, Step, kit … indented
 * under them, each with the first line of its comment. What an author (or a model) reads once before writing a scene.
 */
export function renderReference(index: DocIndex): string {
  return index.topics.map((topic) => renderModule(index, topic)).filter((text) => text !== '').join('\n\n')
}
/**
 * One module of the reference (`mimir docs module:<name>`): its declarations one line each with the first line of
 * their comment, and under an interface or namespace the members this module declares (s.param … under Scene in
 * core, st.say … under Step in guide). '' when the module declares nothing.
 */
export function renderModule(index: DocIndex, topic: string): string {
  const top = index.entries.filter((e) => e.topic === topic && e.parent === null)
  if (!top.length) return ''
  const seen = new Set<DocEntry>()
  // the members a container declares in this module (Scene and Step are added to by several modules)
  const members = (c: DocEntry): DocEntry[] => index.entries.filter((m) => m.parent === c.name && m.topic === topic && m.line > c.line && !seen.has(m) && !!seen.add(m) && m.line <= c.line + c.decl.split('\n').length + c.doc.split('\n').length)
  return [`# ${topic}`, ...compactLines(top, members)].join('\n')
}

/** The list of names: top-level names grouped by topic, then each container with its members. */
export function renderList(index: DocIndex): string {
  const lines: string[] = []
  const top = index.entries.filter((e) => e.parent === null)
  const uniq = (names: string[]): string[] => [...new Set(names)]
  const groups: Array<string | null> = [null, ...index.topics]
  for (const topic of groups) {
    const names = uniq(top.filter((e) => e.topic === topic).map((e) => e.name))
    if (names.length === 0) continue
    lines.push(`${topic ?? 'general'}: ${names.join(' ')}`)
  }
  // an interface may be declared in several places (one module adds members to another's); list it once
  for (const container of uniq(top.filter((e) => CONTAINERS.has(e.kind)).map((e) => e.name))) {
    const members = uniq(index.entries.filter((e) => e.parent === container).map((e) => e.name.slice(container.length + 1)))
    if (members.length) lines.push(`${container}.: ${members.join(' ')}`)
  }
  return lines.join('\n')
}

export function typesPath(env: Record<string, string | undefined>): string {
  return env.MIMIR_TYPES && env.MIMIR_TYPES !== '' ? env.MIMIR_TYPES : join(ROOT, 'types', 'mimir.d.ts')
}

// ── example scenes ───────────────────────────────────────────────────────────────────────────────

export function examplesDir(env: Record<string, string | undefined>): string {
  return env.MIMIR_EXAMPLES && env.MIMIR_EXAMPLES !== '' ? resolve(env.MIMIR_EXAMPLES) : join(ROOT, 'examples')
}

export interface ExampleInfo {
  /** file name without .scene.js */
  name: string
  path: string
  /** the title given to scene({ title }) or explain({ title }), or '' */
  title: string
  /** what the comment at the top of the file says, on one line */
  summary: string
}

/** Title and one-line summary of a scene file, read from its text (the scene is not run). */
export function describeExample(path: string, source: string): ExampleInfo {
  const name = basename(path).replace(/(\.scene)?\.m?js$/i, '')
  const title = /\b(?:scene|explain)\s*\(\s*\{[^}]*?\btitle\s*:\s*(["'`])((?:\\.|(?!\1).)*)\1/s.exec(source)?.[2]?.replace(/\\(.)/g, '$1') ?? ''
  // the comment block the file opens with: // lines or one /* … */
  const lines = source.split('\n')
  const head: string[] = []
  if (/^\s*\/\*/.test(lines[0] ?? '')) {
    for (const l of lines) {
      head.push(l.replace(/^\s*\/\*+\s?|\*\/\s*$/g, '').replace(/^\s*\*\s?/, ''))
      if (l.includes('*/')) break
    }
  } else {
    for (const l of lines) {
      if (!/^\s*\/\//.test(l)) break
      head.push(l.replace(/^\s*\/\/\s?/, ''))
    }
  }
  let summary = head.join(' ').replace(/\s+/g, ' ').trim()
  // "hello-3d: a crank and slider …" names the file again, "How a pump works. Story: …" the title: drop what repeats
  if (summary.toLowerCase().startsWith(name.toLowerCase() + ':')) summary = summary.slice(name.length + 1).trim()
  if (title !== '' && summary.toLowerCase().startsWith(title.toLowerCase())) summary = summary.slice(title.length).replace(/^[\s.:,;-]+/, '')
  return { name, path, title, summary: summary !== '' ? summary : title }
}

/** longest summary `mimir examples` prints on a line; the JSON form carries the whole text */
export const SUMMARY_MAX = 150

/** The first sentence of a summary, cut at a word when even that is long. */
export function shortSummary(summary: string, max = SUMMARY_MAX): string {
  const end = summary.search(/[.!?](\s|$)/)
  const first = end >= 0 ? summary.slice(0, end + 1) : summary
  if (first.length <= max) return first
  const cut = first.slice(0, max - 1)
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max >> 1)) + '…'
}

/** A line that carries a diagnostic code in a trailing comment (`// API-UNKNOWN: …`) shows a mistake on purpose. */
const SHOWS_A_MISTAKE = /\/\/.*\b[A-Z]{2,}-[A-Z]{2,}\b/

/** The example scenes of a directory, by name. A directory that does not exist has none. */
export function listExamples(dir: string): ExampleInfo[] {
  let names: string[]
  try { names = readdirSync(dir) } catch { return [] }
  return names.filter((n) => /\.scene\.m?js$/i.test(n)).sort().map((n) => {
    const path = join(dir, n)
    let source = ''
    try { source = readFileSync(path, 'utf8') } catch { /* listed without a description */ }
    return describeExample(path, source)
  })
}

export interface Usage { file: string; line: number; text: string }

/** longest snippet printed for a usage */
const USAGE_MAX_LINES = 6

/**
 * Where an example scene calls a symbol: the first statement that does, as written. `box` matches `box(`,
 * `Scene.step` and `Step.say` match `.step(` / `.say(`, a constant matches the bare word outside the import line.
 */
export function findUsage(symbol: string, examples: readonly { path: string; source: string }[]): Usage | null {
  const short = symbol.slice(symbol.lastIndexOf('.') + 1)
  if (!/^[A-Za-z_$][\w$]*$/.test(short)) return null
  const member = symbol.includes('.')
  const call = new RegExp(member ? `\\.${short.replace(/\$/g, '\\$')}\\s*\\(` : `(^|[^\\w$.])${short.replace(/\$/g, '\\$')}\\s*\\(`)
  const word = new RegExp(`(^|[^\\w$.])${short.replace(/\$/g, '\\$')}([^\\w$]|$)`)
  // scenes that demonstrate mistakes (lines annotated with a diagnostic code) are asked last, and never for such a line
  const ordered = [...examples].sort((a, b) => Number(SHOWS_A_MISTAKE.test(a.source)) - Number(SHOWS_A_MISTAKE.test(b.source)))
  for (const pass of member ? [call] : [call, word]) {
    for (const ex of ordered) {
      const lines = ex.source.split('\n')
      let inImport = false
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]!
        if (/^\s*import\b/.test(l)) inImport = true
        const skip = inImport || /^\s*(\/\/|\*|\/\*)/.test(l)
        if (inImport && /\bfrom\s*['"]|^\s*import\s*['"]/.test(l)) inImport = false
        if (skip || SHOWS_A_MISTAKE.test(l) || !pass.test(l)) continue
        // the whole statement: keep going while brackets are open, a few lines at most
        const out = [l]
        let depth = 0
        const count = (t: string): void => { for (const c of t) depth += c === '(' || c === '[' || c === '{' ? 1 : c === ')' || c === ']' || c === '}' ? -1 : 0 }
        count(l)
        for (let j = i + 1; depth > 0 && j < lines.length && out.length < USAGE_MAX_LINES; j++) { out.push(lines[j]!); count(lines[j]!) }
        const cut = Math.min(...out.filter((x) => x.trim() !== '').map((x) => /^\s*/.exec(x)![0].length))
        return { file: ex.path, line: i + 1, text: out.map((x) => x.slice(cut).trimEnd()).join('\n') + (depth > 0 ? '\n…' : '') }
      }
    }
  }
  return null
}

// ── topic guides ─────────────────────────────────────────────────────────────────────────────────

export function topicsDir(env: Record<string, string | undefined>): string {
  return env.MIMIR_TOPICS && env.MIMIR_TOPICS !== '' ? resolve(env.MIMIR_TOPICS) : join(ROOT, 'docs', 'topics')
}

export interface Guide { name: string; path: string; /** its first heading, or '' */ title: string }

/** The markdown guides of a directory: <name>.md → `mimir docs <name>`. */
export function listGuides(dir: string): Guide[] {
  let names: string[]
  try { names = readdirSync(dir) } catch { return [] }
  return names.filter((n) => /\.md$/i.test(n)).sort().map((n) => {
    const path = join(dir, n)
    let title = ''
    try { title = /^#+\s+(.+)$/m.exec(readFileSync(path, 'utf8'))?.[1]?.trim() ?? '' } catch { /* no title */ }
    return { name: n.replace(/\.md$/i, ''), path, title }
  })
}

const shownPath = (path: string, cwd: string): string => {
  const rel = relative(cwd, path)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) ? rel : path
}

export async function docs(opts: DocsOptions, io: Io, jsonFlag: boolean): Promise<number> {
  const file = typesPath(io.env)
  // the reference is generated by the build: bring it up to date first, so a module that was added or removed
  // shows (or stops showing) here too. A failed build is reported by ensureViewer and the last reference answers.
  if (!io.env.MIMIR_TYPES) { try { await ensureViewer(io.env, io.log) } catch { /* the lookup below reports a missing reference */ } }
  if (!existsSync(file)) {
    throw new CliError(`the typed reference is missing: ${file} (it is generated by the build: bun scripts/build.ts)`)
  }
  const index = parseDts(readFileSync(file, 'utf8'))
  const guides = listGuides(topicsDir(io.env))
  if (opts.query === null) {
    const names = [...new Set(index.entries.map((e) => e.name))]
    if (jsonFlag) {
      const modules = index.topics.map((t) => ({ module: t, names: [...new Set(index.entries.filter((e) => e.topic === t && e.parent === null).map((e) => e.name))] }))
      io.out(JSON.stringify({ topics: index.topics, names, modules, guides: guides.map((g) => ({ name: g.name, title: g.title })) }) + '\n')
    } else {
      io.out(renderList(index) + '\n' + (guides.length ? `guides (mimir docs <name>): ${guides.map((g) => g.name).join(' ')}\n` : '') + `the whole reference, one line per declaration: mimir docs ${REFERENCE_WORDS[0]}\n`)
    }
    return 0
  }
  // the whole compact reference in one answer (a public name spelt the same way would win: it is the exact lookup)
  if (REFERENCE_WORDS.includes(opts.query.trim().toLowerCase()) && lookup(index, opts.query).kind === 'none') {
    const text = renderReference(index)
    io.out(jsonFlag ? JSON.stringify({ reference: text }) + '\n' : text + '\n')
    return 0
  }
  const hit = lookup(index, opts.query)
  const asked = splitQuery(opts.query)
  // a guide is asked for by its file name (or `guide:<name>`); a symbol of the same name wins (it is the exact lookup), a module does not
  const guide = hit.kind === 'symbol' || (asked.kind !== null && asked.kind !== 'guide') ? undefined : guides.find((g) => g.name.toLowerCase() === asked.name.toLowerCase())
  if (guide) {
    const text = readFileSync(guide.path, 'utf8')
    io.out(jsonFlag ? JSON.stringify({ guide: guide.name, title: guide.title, text }) + '\n' : text.replace(/\n*$/, '\n'))
    return 0
  }
  if (hit.kind === 'none') {
    const near = suggest(opts.query, [...index.entries.map((e) => e.name), ...index.topics, ...guides.map((g) => g.name)], 5)
    throw new CliError(
      `no symbol or topic "${opts.query}" in ${file}` +
        (near.length ? `; did you mean ${near.join(', ')}?` : '') +
        ' (mimir docs lists every name)',
    )
  }
  const examples = hit.kind === 'symbol'
    ? listExamples(examplesDir(io.env)).map((e) => { try { return { path: e.path, source: readFileSync(e.path, 'utf8') } } catch { return { path: e.path, source: '' } } })
    : []
  const usage = hit.kind === 'symbol' ? findUsage(hit.entries[0]!.name, examples) : null
  // a bare name that is a symbol and also a module (flow, guide, tex): the answer is the symbol, and says how to get the module
  const also = hit.kind === 'symbol' && asked.kind === null && index.topics.includes(asked.name.toLowerCase()) ? [`module:${asked.name.toLowerCase()}`] : []
  if (jsonFlag) {
    const entries = hit.entries.map((e) => ({ name: e.name, kind: e.kind, topic: e.topic, line: e.line, doc: e.doc, decl: e.decl }))
    io.out(JSON.stringify(hit.kind === 'topic' ? { topic: hit.topic, entries } : { entries, ...(usage ? { example: { file: shownPath(usage.file, io.cwd), line: usage.line, text: usage.text } } : {}), ...(also.length ? { also } : {}) }) + '\n')
  } else if (hit.kind === 'topic') {
    io.out(renderModule(index, hit.topic) + '\n')
  } else {
    io.out(
      hit.entries.map(renderEntry).join('\n\n') + '\n' +
        (usage ? `\nexample (${shownPath(usage.file, io.cwd)}:${usage.line}):\n${usage.text.split('\n').map((l) => '  ' + l).join('\n')}\n` : '') +
        (also.length ? `\n"${asked.name}" is also a module: mimir docs ${also[0]}\n` : ''),
    )
  }
  return 0
}

export async function examples(opts: ExamplesOptions, io: Io, jsonFlag: boolean): Promise<number> {
  const dir = examplesDir(io.env)
  if (!existsSync(dir)) throw new CliError(`there is no examples directory: ${dir} (set MIMIR_EXAMPLES to one)`)
  const list = listExamples(dir)
  if (opts.name !== null) {
    // by name, with or without .scene.js; the source is text, so JSON only when asked for (like mimir docs)
    const wanted = basename(opts.name).replace(/(\.scene)?\.m?js$/i, '')
    const hit = list.find((e) => e.name === wanted) ?? list.find((e) => e.name.toLowerCase() === wanted.toLowerCase())
    if (!hit) {
      const near = suggest(wanted, list.map((e) => e.name))
      throw new UsageError(`no example "${opts.name}"` + (near.length ? `; did you mean ${near.join(', ')}?` : '') + ` (examples: ${list.map((e) => e.name).join(', ') || 'none'})`, 'examples')
    }
    const source = readFileSync(hit.path, 'utf8')
    io.out(jsonFlag ? JSON.stringify({ name: hit.name, path: hit.path, title: hit.title, summary: hit.summary, source }) + '\n' : source.replace(/\n*$/, '\n'))
    return 0
  }
  if (io.json) {
    io.out(JSON.stringify(list.map((e) => ({ name: e.name, path: e.path, title: e.title, summary: e.summary }))) + '\n')
    return 0
  }
  // one line per example: its name (what `mimir examples <name>` takes) and what it shows; the directory once, last
  const pad = Math.max(0, ...list.map((e) => e.name.length))
  io.out(list.map((e) => `${e.name.padEnd(pad)}  ${e.title && e.summary !== e.title ? `${e.title}: ` : ''}${shortSummary(e.summary)}`).join('\n') + (list.length ? `\nmimir examples <name> prints one (they are in ${shownPath(dir, io.cwd)})\n` : ''))
  return 0
}

// ── a starter scene ──────────────────────────────────────────────────────────────────────────────

/** "my-first_scene" → "My first scene" */
export function titleFromName(name: string): string {
  const words = name.replace(/[-_.]+/g, ' ').trim()
  return words === '' ? 'Untitled' : words[0]!.toUpperCase() + words.slice(1)
}

/**
 * The starter: a small scene that already passes `mimir check`, built from the calls every scene uses (objects placed
 * by relation, one parameter, steps with narration and a guide span). It is a starting point to edit, not a template
 * engine: `mimir examples` lists fuller scenes.
 */
export function starterScene(title: string): string {
  return `// ${title}: a starter scene. Edit it, then run the loop:
//   mimir check <this file>          diagnostics with the line and the fix
//   mimir shot <this file> --sheet   one picture of every step: look at it
//   mimir open <this file>           the live viewer
// Every name is documented: mimir docs <name>. Fuller scenes: mimir examples.
import { scene, rect, text, arrow, row, write, create, fadeIn, lagged, mix, BLUE, TEAL, GREEN, RED, GREY_B } from 'mimir'

export default scene({ title: ${JSON.stringify(title)} }, (s) => {
  // a parameter is a slider in the viewer; steps can sweep it
  const level = s.param('level', { value: 20, min: 0, max: 100, unit: '%', label: 'Level' })

  // objects are placed by relation (row, nextTo, at(other)), not by coordinates
  const heading = text(${JSON.stringify(title)}, { size: 'section' }).at(0, 3.1)
  const source = rect({ id: 'source', width: 2.6, height: 1.5, radius: 0.18, color: BLUE }).fill(BLUE, 0.15)
  const target = rect({ id: 'target', width: 2.6, height: 1.5, radius: 0.18, color: () => mix(GREEN, RED, level() / 100) })
    .fill(() => mix(GREEN, RED, level() / 100), 0.15)
  row([source, target], { gap: 2.4 }).at(0, 0.3)
  const names = [text('Source', { size: 'label' }).at(source), text('Target', { size: 'label' }).at(target)]
  const link = arrow(source, target).color(TEAL)
  const readout = text(() => \`level \${Math.round(level())}%\`, { size: 'note', color: GREY_B }).nextTo(target, 'down', 0.4)

  // one idea per step; the narration is the caption, and [words](part) sends the guide to that part
  s.step('Two parts', (st) => {
    st.say('A [source](source) and a [target](target).')
    // plays in one st.play() run together: the parts are drawn while the heading is written, so each is on stage when its word is spoken
    st.play(write(heading), lagged([create(source), create(target)], { lag: 0.3 }))
    st.play(lagged(names.map((n) => fadeIn(n)), { lag: 0.2 }))
  })

  s.step('One feeds the other', (st) => {
    st.say('What the source sends fills the [target](target).')
    st.play(create(link), fadeIn(readout))
    st.set(level, 90)
  })
})
`
}

export async function init(opts: InitOptions, io: Io): Promise<number> {
  const stem = opts.name.replace(/\.scene\.js$/i, '').replace(/\.js$/i, '')
  const dir = opts.out !== null ? resolve(io.cwd, opts.out) : io.cwd
  const path = join(dir, `${stem}.scene.js`)
  if (existsSync(path) && !opts.force) {
    throw new UsageError(`${shownPath(path, io.cwd)} already exists; choose another name or pass --force to overwrite it`, 'init')
  }
  if (existsSync(dir) && !statSync(dir).isDirectory()) throw new UsageError(`-o ${opts.out} is not a directory`, 'init')
  mkdirSync(dir, { recursive: true })
  const source = starterScene(titleFromName(stem))
  writeFileSync(path, source)
  const shown = shownPath(path, io.cwd)
  io.out(io.json ? JSON.stringify({ path, bytes: Buffer.byteLength(source), next: [`mimir check ${shown}`, `mimir shot ${shown} --sheet`, `mimir open ${shown}`] }) + '\n' : `${path}\n`)
  io.log(`next: mimir check ${shown}  ->  mimir shot ${shown} --sheet  ->  mimir open ${shown}`)
  return 0
}
