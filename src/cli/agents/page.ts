// The one always-on page of a lean generation (skills/mimir/PAGE.md): the loop, the explain() way, the minimum of
// the full API, the rules. `mimir new` hands it to the agent as its whole instructions; the interactive skill points
// at the same file. Everything else stays behind `mimir docs <name>`.
//
// The page cannot drift from the engine: every name it imports or calls is looked up in the generated reference
// (types/mimir.d.ts, what `mimir docs` reads) by checkPage(), which the unit tests run. The explain() section sits
// between two markers and is left out of a launch when this engine does not export `explain`: an agent is never
// told about an API that is not there.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONCEPT_SIZES, type ConceptSize } from './limits.ts'

export const PAGE_FILE = join('skills', 'mimir', 'PAGE.md')
export const QUICK_BEGIN = '<!-- quick:begin'
export const QUICK_END = '<!-- quick:end -->'
export const LOOP_BEGIN = '<!-- loop:begin'
export const LOOP_END = '<!-- loop:end -->'
/** the head of a write-once call: what to answer with (the reference part of the page follows it) */
export const ONCE_FILE = join('skills', 'mimir', 'ONCE.md')
/** the name whose presence in the reference turns the explain() section on */
export const QUICK_SYMBOL = 'explain'
/** bytes the launched page may have (about 0.4 tokens per byte); the test holds it to this */
export const PAGE_MAX_BYTES = 12_000

/** The page without its explain() section. */
export function stripQuick(page: string): string {
  const a = page.indexOf(QUICK_BEGIN)
  const b = page.indexOf(QUICK_END)
  if (a < 0 || b < a) return page
  return page.slice(0, a) + page.slice(b + QUICK_END.length).replace(/^\n+/, '')
}

/** The explain() section alone (between the markers), or '' when the page has none. */
export function quickSection(page: string): string {
  const a = page.indexOf(QUICK_BEGIN)
  const b = page.indexOf(QUICK_END)
  return a < 0 || b < a ? '' : page.slice(page.indexOf('\n', a) + 1, b)
}

/** Does the generated reference declare this top-level name? */
export function declares(types: string, name: string): boolean {
  return new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:function|const|class|namespace)\\s+${name}\\b`, 'm').test(types)
}

/** Every engine name a text uses: what its code imports from 'mimir', and every `name(` written in backticks. */
export function pageNames(text: string): string[] {
  const names = new Set<string>()
  for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'mimir'/g)) for (const n of m[1]!.split(',')) { const t = n.trim(); if (t !== '') names.add(t) }
  for (const m of text.matchAll(/`([A-Za-z_][\w]*)\(/g)) names.add(m[1]!)
  return [...names]
}

/** names in backticks that are not engine exports: methods of the scene, the step and objects, and plain JavaScript */
export const PAGE_NOT_EXPORTS = ['text', 'color', 'width', 'opacity', 'fn', 'f', 'state', 'count', 'hot', 'load', 'p', 'x', 'y', 'tilt', 'n', 'a', 'b', 'x1', 'y1', 'x2', 'y2']

/** What is wrong with the page against a reference: names it uses that the engine does not declare. */
export function checkPage(page: string, types: string): string[] {
  const problems: string[] = []
  const quickOn = declares(types, QUICK_SYMBOL)
  const body = quickOn ? page : stripQuick(page)
  for (const name of pageNames(body)) {
    if (PAGE_NOT_EXPORTS.includes(name)) continue
    // a top-level export, or a member of some interface (st.say, s.param, obj.nextTo)
    if (declares(types, name) || new RegExp(`^\\s*(?:readonly\\s+)?${name}\\s*[(:<?]`, 'm').test(types)) continue
    problems.push(`PAGE.md names \`${name}\`, which types/mimir.d.ts does not declare`)
  }
  if (page.includes(QUICK_BEGIN) !== page.includes(QUICK_END)) problems.push('PAGE.md has only one of the two quick markers')
  const launched = Buffer.byteLength(composePage(page, { quick: quickOn, size: 'small' }))
  if (launched > PAGE_MAX_BYTES) problems.push(`the launched page is ${launched} bytes, over PAGE_MAX_BYTES (${PAGE_MAX_BYTES})`)
  return problems
}

/** A page without its marker lines (the text between them stays). */
const unmark = (page: string): string => page.replace(/^<!-- (quick|loop):(begin|end)[^\n]*\n/gm, '')

/** The page without the part that tells an agent how to run its loop (between the two loop markers). */
export function stripLoop(page: string): string {
  const a = page.indexOf(LOOP_BEGIN)
  const b = page.indexOf(LOOP_END)
  if (a < 0 || b < a) return page
  return page.slice(0, a) + page.slice(b + LOOP_END.length).replace(/^\n+/, '')
}

/** where the reference goes in the head of a write-once call */
export const ONCE_REFERENCE = '<!-- reference -->'
/** the reference of explain(): what `mimir docs quick` prints, and the whole API of a write-once call when the engine has explain() */
export const QUICK_TOPIC_FILE = join('docs', 'topics', 'quick.md')

/** A reference without the lines that tell a reader to run a command (a writer has no shell). */
export const withoutCommands = (text: string): string => text.split('\n').filter((line) => !/^`mimir /.test(line)).join('\n')

/**
 * The text of a write-once call: the head (answer with the module, nothing else), the reference in its place, and
 * what the head says after it. The reference is the explain() topic when this engine has explain() (`quickTopic`),
 * else the API part of the page. No loop, no shell, no tools: the model is a function from this text and a request
 * to a module.
 */
export function composeOncePage(head: string, page: string, o: { quick: boolean; quickTopic?: string | null }): string {
  const reference = o.quick && o.quickTopic ? withoutCommands(o.quickTopic).trim() : unmark(stripLoop(o.quick ? page : stripQuick(page))).trim()
  const at = head.indexOf(ONCE_REFERENCE)
  // the rules after the reference are written for explain(); without it the page brings its own
  if (at < 0) return `${head.trim()}\n\n${reference}\n`
  const before = head.slice(0, at).trim()
  const after = o.quick && o.quickTopic ? head.slice(at + ONCE_REFERENCE.length).trim() : ''
  return `${before}\n\n${reference}\n${after !== '' ? `\n${after}\n` : ''}`
}

/** Read the head and the page of a checkout and compose them for a write-once call. null = this checkout has none. */
export function oncePage(root: string, typesFile: string): { file: string; text: string; quick: boolean } | null {
  const head = join(root, ONCE_FILE)
  const page = join(root, PAGE_FILE)
  if (!existsSync(head) || !existsSync(page)) return null
  const topic = join(root, QUICK_TOPIC_FILE)
  const quick = existsSync(typesFile) && declares(readFileSync(typesFile, 'utf8'), QUICK_SYMBOL)
  const quickTopic = quick && existsSync(topic) ? readFileSync(topic, 'utf8') : null
  return { file: head, text: composeOncePage(readFileSync(head, 'utf8'), readFileSync(page, 'utf8'), { quick, quickTopic }), quick }
}

/** The text an agent is launched with: the page, with or without the explain() section, and the limits of this size. */
export function composePage(page: string, o: { quick: boolean; size: ConceptSize }): string {
  const body = unmark(o.quick ? page : stripQuick(page)).trimEnd()
  if (o.size === 'small') return body + '\n'
  const s = CONCEPT_SIZES[o.size]
  return (
    `${body}\n\n## This run is a ${o.size} concept\n\n` +
    `Where the loop above says 4 to 5 steps and 40 to 70 lines, use ${s.steps} steps and ${s.lines} lines; step 6 may repeat up to ${s.fixRounds} times.` +
    (s.motionShots ? ' If, and only if, the request is about HOW something moves, you may render ONE filmstrip (`mimir shot <scene> --fine t0:t1:8 --sheet`) and look at it once.' : '') +
    '\n'
  )
}

/** Read the page of a checkout and compose it for a launch. null = this checkout has no page. */
export function launchPage(root: string, typesFile: string, size: ConceptSize): { file: string; text: string; quick: boolean } | null {
  const file = join(root, PAGE_FILE)
  if (!existsSync(file)) return null
  const quick = existsSync(typesFile) && declares(readFileSync(typesFile, 'utf8'), QUICK_SYMBOL)
  return { file, text: composePage(readFileSync(file, 'utf8'), { quick, size }), quick }
}
