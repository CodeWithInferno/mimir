// The config store: every default that shapes output, by name, in one place (docs/CONFIG.md is generated from it).
//
//   defineConfig('pace', { play: 1, camera: 2 })      a module registers its defaults (the comment on a key is its doc)
//   model.config('pace.play')                          every reader asks the store: scene > project > registered default
//   scene({ title, defaults: { pace: { play: 1.5 } } })   s.config({ 'pace.play': 1.5 })   mimir.config.json { defaults }
//
// Keys are dotted paths; a value is JSON (number, string, boolean, null, or a list: a list is one value). Nothing here
// reads a clock or the DOM. Unknown keys and wrong types are diagnostics with a did-you-mean, never exceptions.
import { ctx } from './context.ts'
import { closest, type DiagInput, type Src } from './diagnostics.ts'
import { claim } from './ledger.ts'

const isPlain = (v: unknown): v is Record<string, unknown> => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const p = Object.getPrototypeOf(v)
  return p === Object.prototype || p === null
}
/** { a: { b: 1 }, 'c.d': 2 } → [['a.b', 1], ['c.d', 2]]: nested groups and dotted keys mean the same thing. */
export function flattenConfig(values: Record<string, unknown>, prefix = '', out: [string, unknown][] = [], leafAt: (key: string) => boolean = () => false): [string, unknown][] {
  for (const [k, v] of Object.entries(values)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (isPlain(v) && !leafAt(key)) flattenConfig(v, key, out, leafAt)
    else out.push([key, v])
  }
  return out
}
const nest = (pairs: Iterable<[string, unknown]>, cut: number): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const [key, value] of pairs) {
    const path = key.slice(cut).split('.')
    let at = out
    for (let i = 0; i < path.length - 1; i++) at = (isPlain(at[path[i]!]) ? at[path[i]!] : (at[path[i]!] = {})) as Record<string, unknown>
    at[path[path.length - 1]!] = value
  }
  return out
}

// ── the registry ─────────────────────────────────────────────────────────────────────────────────────
/** key → default, for the modules that are loaded */
const defaults = new Map<string, unknown>()
/** key → default of every module of the build, loaded or not (told by the dev chunk): what unknown keys are judged against */
const declared = new Map<string, unknown>()

/**
 * Register a module's defaults under `group`: defineConfig('pace', { play: 1, camera: 2 }). Nested objects are groups
 * ('look.light.keyGain'); a list is one value. The comment on each key in the source is its documentation: the build
 * reads it into docs/CONFIG.md. A key another module registered is refused (the build fails) unless `override: true`.
 */
export function defineConfig(group: string, table: Record<string, unknown>, o: ConfigRules & { override?: boolean } = {}): void {
  for (const [key, value] of flattenConfig(table, group)) {
    if (typeof value === 'function' || value === undefined) continue // a default is data
    if (!claim('config', key, o.override)) continue
    defaults.set(key, value)
    const rule: Rule = {}
    if (typeof value === 'number' && o.min !== undefined) rule.min = o.min
    const choices = o.oneOf?.[key.slice(group.length + 1)]
    if (choices) rule.oneOf = [...choices]
    if (rule.min !== undefined || rule.oneOf) rules.set(key, rule)
  }
}
/** What the values of a group must satisfy beyond the type of their default. */
export interface ConfigRules {
  /** no number of the group may be below this (durations and sizes: 0) */
  min?: number
  /** the values a text setting may take, by its key inside the group: { view: ['iso', 'front'] } */
  oneOf?: Record<string, readonly string[]>
}
interface Rule { min?: number; oneOf?: string[] }
const rules = new Map<string, Rule>()
/** Every registered default, in registration order: [key, default]. */
export const allConfig = (): [string, unknown][] => [...defaults]
/** The registered default of a key (undefined when no loaded module has it). */
export const configDefault = (key: string): unknown => defaults.get(key)
/** The defaults of every module of this build, told by the dev chunk so that a key of a module that is not loaded is still known. */
export function declareConfig(table: Record<string, unknown>): void { for (const [k, v] of Object.entries(table)) declared.set(k, v) }
const known = (key: string): { value: unknown } | null => (defaults.has(key) ? { value: defaults.get(key) } : declared.has(key) ? { value: declared.get(key) } : null)
const knownKeys = (): string[] => [...new Set([...defaults.keys(), ...declared.keys()])]

// ── the project layer (mimir.config.json): one per page, set by the host before the scene is imported ───────────
let project = new Map<string, unknown>()
let projectSource: string | null = null
/**
 * The project's defaults: the `defaults` object of mimir.config.json (nested or dotted keys). Every scene compiled
 * after this call starts from them; each reports what is wrong with them as its own diagnostics. null clears.
 */
export function setProjectConfig(values: unknown, source: string | null = null): void {
  project = new Map(isPlain(values) ? flattenConfig(values, '', [], (k) => known(k) !== null) : values === null || values === undefined ? [] : [['', values]])
  projectSource = source
}
export const projectConfig = (): { values: Record<string, unknown>; source: string | null } => ({ values: Object.fromEntries(project), source: projectSource })

/** Why a value cannot stand in for a default, or null when it can. */
function mismatch(dflt: unknown, v: unknown, key = ''): { code: 'API-TYPE' | 'NUM-INVALID' | 'API-UNKNOWN'; why: string } | null {
  const rule = rules.get(key)
  const what = (x: unknown): string => (x === null ? 'null' : Array.isArray(x) ? 'a list' : typeof x === 'number' && !Number.isFinite(x) ? String(x) : typeof x === 'object' ? 'an object' : typeof x === 'function' ? 'a function' : `${typeof x === 'string' ? 'the string ' : ''}${JSON.stringify(x)}`)
  if (typeof v === 'function' || v === undefined || (typeof v === 'object' && v !== null && !Array.isArray(v))) return { code: 'API-TYPE', why: `takes a plain value, got ${what(v)}` }
  if (dflt === null || dflt === undefined) return null // a default of null says nothing about the type
  if (typeof dflt === 'number') {
    if (typeof v !== 'number') return { code: 'API-TYPE', why: `is a number, got ${what(v)}` }
    if (!Number.isFinite(v)) return { code: 'NUM-INVALID', why: `must be a finite number, got ${String(v)}` }
    return rule?.min !== undefined && v < rule.min ? { code: 'NUM-INVALID', why: `must not be below ${rule.min}, got ${v}` } : null
  }
  if (Array.isArray(dflt)) {
    if (!Array.isArray(v)) return { code: 'API-TYPE', why: `is a list, got ${what(v)}` }
    if (dflt.length && dflt.every((x) => typeof x === 'number') && !v.every((x) => typeof x === 'number' && Number.isFinite(x))) return { code: 'API-TYPE', why: 'is a list of numbers' }
    return null
  }
  if (v === null) return { code: 'API-TYPE', why: `is a ${typeof dflt}, got null` }
  if (typeof v !== typeof dflt) return { code: 'API-TYPE', why: `is a ${typeof dflt}, got ${what(v)}` }
  if (rule?.oneOf && !rule.oneOf.includes(v as string)) { const near = closest(v as string, rule.oneOf); return { code: 'API-UNKNOWN', why: `has no value "${v as string}" (${near ? `did you mean "${near}"? ` : ''}values: ${rule.oneOf.join(', ')})` } }
  return null
}

interface Entry { value: unknown; call: string; src: Src | null }
/**
 * The settings of one scene: what the scene set on top of the project and the registered defaults. The model owns one
 * (model.config(key) reads through it).
 */
export class ConfigStore {
  private set_ = new Map<string, Entry>()
  /** set, but no loaded module has registered the key (it may belong to a chunk that is not loaded): judged by settle() */
  private pending = new Map<string, Entry>()
  /** keys somebody has read, with the value they got: a later change of one of them cannot reach what was already built */
  private read = new Map<string, unknown>()
  constructor(private report: (d: DiagInput, src: Src | null) => void) {}

  /** The value in force: what the scene set, else the project's, else the registered default, else `fallback`. */
  get<T = unknown>(key: string, fallback?: T): T {
    const s = this.set_.get(key) ?? this.pending.get(key)
    let v: unknown
    if (s) v = s.value
    else if (project.has(key) && this.projectOk(key)) v = project.get(key)
    else if (defaults.has(key)) v = defaults.get(key)
    else v = fallback
    this.read.set(key, v)
    return v as T
  }
  /** a project value of the wrong type is reported (once, by checkProject) and not used */
  private projectOk(key: string): boolean { const k = known(key); return !k || mismatch(k.value, project.get(key), key) === null }

  /** Every default under `prefix` with what the project and the scene changed, as a nested object: group('guide').hop. */
  group(prefix: string): Record<string, unknown> {
    const p = prefix + '.'
    const pairs: [string, unknown][] = []
    for (const key of new Set([...defaults.keys(), ...project.keys(), ...this.set_.keys(), ...this.pending.keys()])) if (key.startsWith(p)) pairs.push([key, this.get(key)])
    return nest(pairs, p.length)
  }
  /** Only what the project and the scene set under `prefix`, as a nested object (a deep partial of the group); null when nothing. */
  overrides(prefix: string): Record<string, unknown> | null {
    const p = prefix + '.'
    const pairs: [string, unknown][] = []
    for (const key of new Set([...project.keys(), ...this.set_.keys(), ...this.pending.keys()])) if (key.startsWith(p) && this.usable(key)) pairs.push([key, this.get(key)])
    return pairs.length ? nest(pairs, p.length) : null
  }
  /** A key that was set and that a reader of the group may be handed: a registered one of the right type, or one whose group nobody has registered under yet. */
  private usable(key: string): boolean {
    const k = known(key)
    if (k) return this.set_.has(key) || (this.pending.has(key) ? mismatch(k.value, this.pending.get(key)!.value, key) === null : this.projectOk(key))
    const group = key.split('.')[0]! + '.'
    return !knownKeys().some((x) => x.startsWith(group))
  }
  /**
   * More modules have registered since the scene was built (a lazy chunk arrived): judge the keys that waited for
   * them. Keys whose group is still open keep waiting for settle().
   */
  recheck(): void {
    for (const [key, e] of [...this.pending]) {
      const k = known(key)
      if (k) { this.pending.delete(key); if (this.accept(key, k.value, e)) this.set_.set(key, e); continue }
      if (!this.judge(key, e, false)) this.pending.delete(key)
    }
    this.checkProject()
  }
  /** What the scene itself set: key → value (the project layer and the defaults are not in it). */
  own(): Record<string, unknown> { return Object.fromEntries([...this.set_, ...this.pending].map(([k, e]) => [k, e.value])) }

  /** Set values for this scene: nested groups or dotted keys. Reports unknown keys and wrong types; the rest is applied. */
  set(values: unknown, call: string, src: Src | null = null): void {
    if (!isPlain(values)) { this.report({ code: 'API-TYPE', what: `${call} expects an object of settings, got ${values === null ? 'null' : Array.isArray(values) ? 'a list' : typeof values}.`, fix: [`${call.replace(/\(.*$/, '')}({ pace: { play: 1.5 } })`, 'every key: docs/CONFIG.md'] }, src); return }
    for (const [key, value] of flattenConfig(values, '', [], (k) => known(k) !== null)) {
      const entry: Entry = { value, call, src }
      const k = known(key)
      if (!k) {
        // a group somebody has registered under: the key is wrong now. Otherwise its module may not be loaded yet.
        if (this.judge(key, entry, false)) this.pending.set(key, entry)
        continue
      }
      if (!this.accept(key, k.value, entry)) continue
      if (this.read.has(key) && !same(this.read.get(key), value)) {
        this.report({ code: 'API-TYPE', severity: 'warn', what: `${call}: "${key}" was already used (as ${JSON.stringify(this.read.get(key))}) before this line changed it to ${JSON.stringify(value)}; what was built before keeps the old value.`, fix: [`set it before anything is created: scene({ title, defaults: { '${key}': ${JSON.stringify(value)} } }, s => { … })`, 'or move this s.config({ … }) to the first line of the scene'] }, src)
      }
      this.set_.set(key, entry)
    }
  }
  private accept(key: string, dflt: unknown, e: Entry): boolean {
    const bad = mismatch(dflt, e.value, key)
    if (!bad) return true
    this.report({ code: bad.code, what: `${e.call}: "${key}" ${bad.why}.`, fix: [`'${key}': ${JSON.stringify(dflt)}  (the default)`] }, e.src)
    return false
  }
  /**
   * An unregistered key: may it wait (true), or is it wrong (reported, false)? It waits while its module may simply
   * not be loaded. It is judged once every module of the build is known (`final`), or at once in a group that is
   * closed (all of its keys are registered in the main chunk). A group nobody registers under but whose keys code
   * reads with a fallback (model.config(key, fallback)) cannot be judged by name and is left alone.
   */
  private judge(key: string, e: Entry, final: boolean): boolean {
    const group = key.split('.')[0]!
    if (!final && !closedGroups.has(group)) return true
    const keys = knownKeys()
    const sameGroup = keys.filter((k) => k.startsWith(group + '.'))
    if (!sameGroup.length && [...this.read.keys(), ...readAnywhere].some((k) => k.startsWith(group + '.'))) return true
    const groups = [...new Set(keys.map((k) => k.split('.')[0]!))].sort()
    const near = closest(key, sameGroup.length ? sameGroup : keys) ?? (sameGroup.length ? null : closest(group, groups))
    this.report({
      code: 'API-UNKNOWN',
      what: sameGroup.length ? `${e.call}: there is no setting "${key}".` : `${e.call}: there is no setting "${key}" (no module has settings under "${group}").`,
      fix: [near ? `use "${near}"` : sameGroup.length ? `settings of ${group}: ${sameGroup.slice(0, 12).join(', ')}${sameGroup.length > 12 ? ', …' : ''}` : `groups: ${groups.join(', ')}`, 'every key and its default: docs/CONFIG.md'],
    }, e.src)
    return false
  }
  private reported = new Set<string>()
  /** Report what is wrong with the project's values, each once: the scene keeps running on the defaults for those. */
  checkProject(final = false): void {
    const call = projectSource ?? 'the project config'
    const src: Src = { file: projectSource, line: null }
    for (const [key, value] of project) {
      const id = `project:${key}`
      if (this.reported.has(id)) continue
      if (key === '') { this.reported.add(id); this.report({ code: 'API-TYPE', what: `${call}: "defaults" must be an object of settings.`, fix: ['{ "defaults": { "pace": { "play": 1.5 } } }'] }, src); continue }
      const k = known(key)
      if (k) {
        const bad = mismatch(k.value, value, key)
        if (bad) { this.reported.add(id); this.report({ code: bad.code, what: `${call}: "${key}" ${bad.why}.`, fix: [`"${key}": ${JSON.stringify(k.value)}  (the default)`] }, src) }
      } else if (!this.judge(key, { value, call, src }, final)) this.reported.add(id)
    }
  }
  /**
   * Every module of the build is known now (the dev chunk has told the store): judge the keys that were waiting for
   * their module. Called by the host before `check` answers. Each key is reported once.
   */
  settle(): void {
    for (const [key, e] of [...this.pending]) {
      const k = known(key)
      if (k) { this.pending.delete(key); if (this.accept(key, k.value, e)) this.set_.set(key, e); continue }
      if (!this.judge(key, e, true)) this.pending.delete(key)
    }
    this.checkProject(true)
  }
}
const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b)

/** groups whose every key is registered in the main chunk (closeConfigGroup): a key they do not have is wrong as soon as it is set */
const closedGroups = new Set<string>()
/**
 * Say that `group` has no keys beyond the ones registered so far (nothing of it is registered by a lazy chunk): an
 * unknown key in it is reported where it is set, without waiting for `mimir check`.
 */
export function closeConfigGroup(group: string): void { closedGroups.add(group) }
/** keys read with config(key, fallback) outside any model */
const readAnywhere = new Set<string>()

/**
 * The value in force right now, for code that has no model at hand: the scene being built or drawn, else the project,
 * else the registered default, else `fallback`.
 */
export function config<T = unknown>(key: string, fallback?: T): T {
  const model = ctx.frame?.model ?? ctx.model
  if (model) return model.config<T>(key, fallback)
  readAnywhere.add(key)
  if (project.has(key)) { const k = known(key); if (!k || mismatch(k.value, project.get(key), key) === null) return project.get(key) as T }
  return (defaults.has(key) ? defaults.get(key) : fallback) as T
}
/**
 * A table whose members read the store: `PACE.play` is config('pace.play'). Registers the table under `group` and
 * returns the live view, so code written against a constant table follows what a scene or a project sets.
 */
export function liveConfig<T extends Record<string, number | string | boolean>>(group: string, table: T, rules: ConfigRules = {}): { readonly [K in keyof T]: T[K] extends number ? number : T[K] extends string ? string : boolean } {
  defineConfig(group, table, rules)
  const out = {}
  for (const key of Object.keys(table)) Object.defineProperty(out, key, { enumerable: true, get: () => config(`${group}.${key}`, table[key]) })
  return out as never
}
