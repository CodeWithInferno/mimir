// Option-bag validation: aliases, did-you-mean, typed checks. Never throws: reports and falls back.
import { closest } from './diagnostics.ts'
import { isColor, PALETTE, MATERIALS, MATERIAL_ALIASES } from './color.ts'
import { isNode, type MNode } from './node.ts'
import type { SceneModel } from './model.ts'

export type PropType =
  | 'number' | 'positive' | 'nonneg' | 'unit' | 'int' | 'boolean' | 'string' | 'text' | 'color' | 'vec2' | 'vec3'
  | 'point' | 'node' | 'nodes' | 'fn' | 'material' | 'any'
  | readonly string[] // enum
  | { array: PropType | PropSpec; min?: number; max?: number } // a list: { array: 'point' }, { array: 'number', min: 2 }
  | { record: PropType | PropSpec } // a dictionary by name: { record: 'string' }
  | { object: Schema } // a nested option bag with its own schema
export interface PropSpec {
  type: PropType
  default?: unknown
  /** a correct literal shown in API-TYPE messages, e.g. 'radius: 0.5' */
  example?: string
  /** false = a function is not accepted for this option (default true) */
  dynamic?: boolean
  /** named values accepted in place of the type, e.g. { title: 72, body: 48 } */
  tokens?: Record<string, unknown>
  /** null is accepted (e.g. fill: null = no fill) */
  nullable?: boolean
  doc?: string
}
export type Schema = Record<string, PropType | PropSpec>
export const spec = (s: PropType | PropSpec): PropSpec => (typeof s === 'object' && s !== null && !Array.isArray(s) && 'type' in s ? (s as PropSpec) : { type: s as PropType })
/** The composite forms of PropType. */
export const arrayOf = (t: PropType): { array: PropType | PropSpec; min?: number; max?: number } | null => (typeof t === 'object' && !Array.isArray(t) && 'array' in t ? t : null)
export const recordOf = (t: PropType): { record: PropType | PropSpec } | null => (typeof t === 'object' && !Array.isArray(t) && 'record' in t ? t : null)
export const objectOf = (t: PropType): { object: Schema } | null => (typeof t === 'object' && !Array.isArray(t) && 'object' in t ? t : null)

/** r w h d are accepted silently everywhere (DESIGN §5). Kinds add their own. */
export const COMMON_ALIASES: Record<string, string> = { r: 'radius', w: 'width', h: 'height', d: 'depth' }

const exampleOf = (name: string, s: PropSpec): string => {
  if (s.example) return s.example
  const t = s.type
  if (Array.isArray(t)) return `${name}: '${t[0]}'`
  const inner = (x: PropType | PropSpec): string => exampleOf('x', spec(x)).replace(/^x: /, '').replace(/  \(.*$/, '')
  const arr = arrayOf(t), rec = recordOf(t), ob = objectOf(t)
  if (arr) return `${name}: [${inner(arr.array)}, ${inner(arr.array)}]`
  if (rec) return `${name}: { a: ${inner(rec.record)} }`
  if (ob) return `${name}: { ${Object.entries(ob.object).slice(0, 2).map(([k, v]) => exampleOf(k, spec(v))).join(', ')} }`
  switch (t) {
    case 'number': case 'positive': case 'nonneg': case 'int': return `${name}: 2`
    case 'unit': return `${name}: 0.5`
    case 'boolean': return `${name}: true`
    case 'string': case 'text': return `${name}: 'label'`
    case 'color': return `${name}: BLUE`
    case 'vec2': return `${name}: [1, 2]`
    case 'vec3': return `${name}: [1, 2, 3]`
    case 'point': return `${name}: [1, 2]  (or an object, or object.top)`
    case 'node': return `${name}: an object returned by a constructor such as rect() or box()`
    case 'nodes': return `${name}: [a, b]`
    case 'fn': return `${name}: () => value`
    case 'material': return `${name}: 'steel'`
    default: return `${name}: …`
  }
}
const describe = (v: unknown): string => {
  if (v === null) return 'null'
  if (v === undefined) return 'undefined'
  if (isNode(v)) return `the object #${v.id}`
  if (Array.isArray(v)) return `an array (${v.length} items)`
  if (typeof v === 'number') return Number.isNaN(v) ? 'NaN' : String(v)
  if (typeof v === 'string') return `the string "${v.length > 24 ? v.slice(0, 24) + '…' : v}"`
  if (typeof v === 'function') return 'a function'
  return `a ${typeof v}`
}

export interface Problem { code: 'API-UNKNOWN' | 'API-TYPE' | 'REF-MISSING' | 'NUM-INVALID'; what: string; fix: string[]; measured?: number | string | null }
export type Checked = { ok: true; value: unknown } | { ok: false; problem: Problem }

const isNum = (v: unknown): v is number => typeof v === 'number'
const vecOf = (v: unknown, n: number[]): boolean => Array.isArray(v) && n.includes(v.length) && v.every((x) => typeof x === 'number')

/** Resolve a node reference: a node, or the id of one. */
export function resolveNodeRef(v: unknown, model: SceneModel, call: string, name: string): Checked {
  if (isNode(v)) return { ok: true, value: v }
  if (typeof v === 'string') {
    const hit = model.byId.get(v)
    if (hit) return { ok: true, value: hit }
    const ids = [...model.byId.keys()]
    const near = closest(v, ids)
    const list = ids.slice(0, 8).join(', ')
    return { ok: false, problem: { code: 'REF-MISSING', what: `${call}: "${v}" - no object has that id.`, fix: [near ? `use "${near}"${ids.length > 1 ? ` (objects: ${list}${ids.length > 8 ? ', …' : ''})` : ''}` : ids.length ? `pass one of: ${list}${ids.length > 8 ? ', …' : ''}` : 'create the object first and pass the variable'] } }
  }
  if (v === undefined || v === null) {
    return { ok: false, problem: { code: 'REF-MISSING', what: `${call}: ${name} is ${v === null ? 'null' : 'undefined'} - the object it should refer to does not exist.`, fix: ['pass an object created earlier in the scene (check the variable name and that it is defined above this line)'] } }
  }
  return { ok: false, problem: { code: 'API-TYPE', what: `${call}: ${name} expects an object, got ${describe(v)}.`, fix: [exampleOf(name, { type: 'node' })] } }
}

/** Check one value against a type. Functions pass for dynamic options and are checked when evaluated. */
export function checkValue(call: string, name: string, s: PropSpec, v: unknown, model: SceneModel): Checked {
  const t = s.type
  const bad = (what?: string): Checked => ({ ok: false, problem: { code: 'API-TYPE', what: what ?? `${call}: ${name} expects ${typeName(s)}, got ${describe(v)}.`, fix: [exampleOf(name, s)] } })
  const nan = (why: string): Checked => ({ ok: false, problem: { code: 'NUM-INVALID', what: `${call}: ${name} is ${describe(v)} (${why}).`, fix: [exampleOf(name, s)], measured: String(v) } })
  if (v === null && s.nullable) return { ok: true, value: null }
  if (s.tokens && typeof v === 'string') {
    if (v in s.tokens) return { ok: true, value: s.tokens[v] }
    if (t !== 'color' && t !== 'string' && t !== 'text' && t !== 'point' && t !== 'node') {
      const near = closest(v, Object.keys(s.tokens))
      return { ok: false, problem: { code: 'API-UNKNOWN', what: `${call}: ${name} has no value "${v}".`, fix: [near ? `use "${near}"` : `use one of: ${Object.keys(s.tokens).join(', ')}`, `or a number, e.g. ${exampleOf(name, { type: t })}`] } }
    }
  }
  if (t === 'fn') return typeof v === 'function' ? { ok: true, value: v } : bad()
  if (t === 'node') return resolveNodeRef(v, model, call, name)
  if (t === 'nodes') {
    if (!Array.isArray(v)) return bad()
    const out: MNode[] = []
    for (let i = 0; i < v.length; i++) {
      const r = resolveNodeRef(v[i], model, call, `${name}[${i}]`)
      if (!r.ok) return r
      out.push(r.value as MNode)
    }
    return { ok: true, value: out }
  }
  if (t === 'point') {
    if (typeof v === 'function' || isNode(v)) return { ok: true, value: v }
    if (typeof v === 'string') return resolveNodeRef(v, model, call, name)
    if (v === undefined || v === null) return resolveNodeRef(v, model, call, name)
    if (!vecOf(v, [2, 3])) return bad()
    if (!(v as number[]).every(Number.isFinite)) return nan('every coordinate must be a finite number')
    return { ok: true, value: v }
  }
  if (typeof v === 'function') return s.dynamic === false ? bad(`${call}: ${name} cannot be a function; pass a value.`) : { ok: true, value: v }
  const arr = arrayOf(t), rec = recordOf(t), ob = objectOf(t)
  if (arr) {
    if (!Array.isArray(v)) return bad()
    if (arr.min !== undefined && v.length < arr.min) return bad(`${call}: ${name} needs at least ${arr.min} item${arr.min === 1 ? '' : 's'}, got ${v.length}.`)
    if (arr.max !== undefined && v.length > arr.max) return bad(`${call}: ${name} takes at most ${arr.max} item${arr.max === 1 ? '' : 's'}, got ${v.length}.`)
    const out: unknown[] = []
    for (let i = 0; i < v.length; i++) {
      const r = checkValue(call, `${name}[${i}]`, spec(arr.array), v[i], model)
      if (!r.ok) return r
      out.push(r.value)
    }
    return { ok: true, value: out }
  }
  if (rec || ob) {
    if (typeof v !== 'object' || v === null || Array.isArray(v) || isNode(v)) return bad()
    if (ob) {
      const inner = validateOptions(`${call}: ${name}`, v, ob.object, undefined, model)
      return inner.problems.length ? { ok: false, problem: inner.problems[0]! } : { ok: true, value: inner.props }
    }
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const r = checkValue(call, `${name}.${k}`, spec(rec!.record), x, model)
      if (!r.ok) return r
      out[k] = r.value
    }
    return { ok: true, value: out }
  }
  if (Array.isArray(t)) {
    if (typeof v === 'string' && t.includes(v)) return { ok: true, value: v }
    const near = typeof v === 'string' ? closest(v, t) : null
    return { ok: false, problem: { code: typeof v === 'string' ? 'API-UNKNOWN' : 'API-TYPE', what: `${call}: ${name} has no value ${typeof v === 'string' ? `"${v}"` : describe(v)}.`, fix: [near ? `use "${near}". Valid values: ${t.join(', ')}.` : `use one of: ${t.join(', ')}`] } }
  }
  switch (t) {
    case 'number': case 'positive': case 'nonneg': case 'unit': case 'int':
      if (!isNum(v)) return bad()
      if (!Number.isFinite(v)) return nan('must be a finite number')
      if (t === 'positive' && v <= 0) return nan('must be greater than 0')
      if (t === 'nonneg' && v < 0) return nan('must not be negative')
      if (t === 'unit' && (v < 0 || v > 1)) return nan('must be between 0 and 1')
      if (t === 'int' && !Number.isInteger(v)) return bad()
      return { ok: true, value: v }
    case 'boolean': return typeof v === 'boolean' ? { ok: true, value: v } : bad()
    case 'string': return typeof v === 'string' ? { ok: true, value: v } : bad()
    case 'text': return typeof v === 'string' || (isNum(v) && Number.isFinite(v)) ? { ok: true, value: String(v) } : bad()
    case 'color': {
      if (isColor(v)) return { ok: true, value: v }
      const near = typeof v === 'string' ? closest(v, Object.keys(PALETTE)) : null
      return { ok: false, problem: { code: typeof v === 'string' ? 'API-UNKNOWN' : 'API-TYPE', what: `${call}: ${name} is not a colour (${describe(v)}).`, fix: [near ? `use ${near}` : `${name}: BLUE  (a palette token) or ${name}: '#58C4DD'`] } }
    }
    case 'vec2': case 'vec3':
      if (!vecOf(v, t === 'vec2' ? [2, 3] : [3])) return bad()
      if (!(v as number[]).every(Number.isFinite)) return nan('every component must be a finite number')
      return { ok: true, value: v }
    case 'material': {
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) return { ok: true, value: v }
      if (typeof v === 'string') {
        const key = MATERIAL_ALIASES[v] ?? v
        if (key in MATERIALS) return { ok: true, value: key }
        const near = closest(v, Object.keys(MATERIALS))
        return { ok: false, problem: { code: 'API-UNKNOWN', what: `${call}: there is no material "${v}".`, fix: [near ? `use "${near}". Materials: ${Object.keys(MATERIALS).join(', ')}.` : `use one of: ${Object.keys(MATERIALS).join(', ')}`] } }
      }
      return bad()
    }
    default: return { ok: true, value: v }
  }
}

function typeName(s: PropSpec): string {
  const t = s.type
  if (Array.isArray(t)) return `one of ${t.map((x) => `'${x}'`).join(', ')}`
  const arr = arrayOf(t), rec = recordOf(t)
  if (arr) return `a list (each item: ${typeName(spec(arr.array))})`
  if (rec) return `an object of named values (each: ${typeName(spec(rec.record))})`
  if (objectOf(t)) return 'an options object'
  const names: Record<string, string> = {
    number: 'a number', positive: 'a number greater than 0', nonneg: 'a number that is not negative', unit: 'a number from 0 to 1', int: 'a whole number',
    boolean: 'true or false', string: 'a string', text: 'a string', color: 'a colour', vec2: '[x, y]', vec3: '[x, y, z]',
    point: 'a point ([x, y], an object, or an anchor such as box.top)', node: 'an object', nodes: 'an array of objects', fn: 'a function', material: 'a material name', any: 'a value',
  }
  return (names[t as string] ?? String(t)) + (s.tokens ? ` (or ${Object.keys(s.tokens).map((k) => `'${k}'`).join(', ')})` : '')
}

export interface Validated { props: Record<string, unknown>; problems: Problem[] }

/** Validate an option bag. Unknown and invalid options are reported and dropped; the rest are returned canonical. */
export function validateOptions(call: string, opts: unknown, schema: Schema, aliases: Record<string, string> | undefined, model: SceneModel): Validated {
  const out: Validated = { props: {}, problems: [] }
  if (opts === undefined || opts === null) return out
  if (typeof opts !== 'object' || Array.isArray(opts) || isNode(opts)) {
    const first = Object.keys(schema).find((k) => k !== 'id')
    out.problems.push({ code: 'API-TYPE', what: `${call} expects an options object, got ${describe(opts)}.`, fix: [`${call.replace(/\(\)$/, '')}({ ${first ? exampleOf(first, spec(schema[first]!)) : ''} })`] })
    return out
  }
  const names = Object.keys(schema)
  for (const [rawKey, v] of Object.entries(opts as Record<string, unknown>)) {
    const key = rawKey in schema ? rawKey : aliases?.[rawKey] ?? COMMON_ALIASES[rawKey] ?? rawKey
    const sp = schema[key]
    if (!sp) {
      const near = closest(rawKey, names)
      out.problems.push({ code: 'API-UNKNOWN', what: `${call} has no option "${rawKey}".`, fix: [`${near ? `use "${near}". ` : ''}Valid options: ${names.join(', ')}.`] })
      continue
    }
    if (v === undefined) continue
    const r = checkValue(call, key, spec(sp), v, model)
    if (r.ok) out.props[key] = r.value
    else out.problems.push(r.problem)
  }
  return out
}
