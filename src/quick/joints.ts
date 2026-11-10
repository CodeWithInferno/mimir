// Joints of machine(): the pure side. A joint is one line that says how a part relates to the others; this file reads
// the lines, orders the parts by what they depend on (with cycle detection), and composes poses. No scene, no DOM:
// plain arrays in, plain arrays out, so every rule here is tested under bun (tests/unit/quick/machine-joints.test.ts).
//
//   ['wheel', 'spins',   { about?: 'z', by: 'turn' | 90 | (c, m) => degrees, at?: 'frame.axle' | [x, y, z], pivot?: 'hub' }]
//   ['ram',   'slides',  { along?: 'y', by: 'push' | 2 | (c, m) => distance }]
//   ['lobe',  'on',      'shaft.front', { my?: 'back', offset?: [x, y, z] }]   rigid: rides on a point of another part
//   ['rod',   'between', 'crank.pin', 'piston.pin']                   first end on one point, aimed at the other
//   ['case',  'around',  'rotor']                                     a housing: placed round what it holds, seen through
//   ['rotor', 'follows', (c, m) => ({ at: [x, y, z], turn: degrees, about?: 'z' })]   a closed-form law
//   ['charge','gas',     { phase: (c, m) => 0..1 | colour | { color, temperature, density }, size?: (c, m) => factor, from?: 'piston.crown', to?: 'head.bottom' }]
//   ['port',  'particles', { when: (c, m) => boolean | 0..1 }]        or [['a.out', 'b.in'], 'particles', { … }]
//   crankSlider({ crank: 'crank', rod: 'rod', slider: 'piston', angle: 'crank' })    a mechanism of the engine, by names
export type Vec3 = [number, number, number]
export type Quat = [number, number, number, number]
export interface Pose { p: Vec3; q: Quat }

export const VERBS = ['spins', 'slides', 'on', 'between', 'around', 'follows', 'gas', 'particles'] as const
export type Verb = (typeof VERBS)[number]
/** What `by` may be: a control by name, a constant, or a pure function of the controls. */
export type Drive = string | number | ((c: Record<string, number>, m: unknown) => number)
export interface Ref { part: string; anchor: string | null }
export type PointSpec = Ref | Vec3

export interface SpinJoint { verb: 'spins'; part: string; axis: Vec3; by: Drive; at: PointSpec | null; pivot: string | null; line: number }
export interface SlideJoint { verb: 'slides'; part: string; axis: Vec3; by: Drive; line: number }
export interface OnJoint { verb: 'on'; part: string; to: Ref; my: string | null; /** a shift from that point, in the carrier's own axes */ offset: Vec3 | null; line: number }
export interface BetweenJoint { verb: 'between'; part: string; a: PointSpec; b: PointSpec; line: number }
export interface AroundJoint { verb: 'around'; part: string; holds: string[]; line: number }
export interface FollowJoint { verb: 'follows'; part: string; law: (c: Record<string, number>, m: unknown) => unknown; line: number }
export interface GasJoint { verb: 'gas'; part: string; phase: ((c: Record<string, number>, m: unknown) => unknown) | null; /** a size factor that follows the controls (1 = as made) */ size: ((c: Record<string, number>, m: unknown) => unknown) | null; from: PointSpec | null; to: PointSpec | null; line: number }
export interface ParticleJoint { verb: 'particles'; part: string | null; path: PointSpec[]; when: ((c: Record<string, number>, m: unknown) => unknown) | null; color: string | null; line: number }
export interface MechanismJoint { verb: 'mechanism'; type: string; parts: string[]; spec: unknown; line: number }
export type Joint = SpinJoint | SlideJoint | OnJoint | BetweenJoint | AroundJoint | FollowJoint | GasJoint | ParticleJoint | MechanismJoint
export interface Problem { what: string; fix?: string }

// ── small maths (the same conventions as the engine: degrees, quaternions as [x, y, z, w]) ───────────
const DEG = Math.PI / 180
export const QID: Quat = [0, 0, 0, 1]
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2])
export const unit = (a: Vec3): Vec3 => { const n = length(a); return n > 1e-12 ? scale(a, 1 / n) : [0, 0, 1] }
export const qmul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
]
export const qconj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]]
export function qaxis(axis: Vec3, deg: number): Quat {
  const u = unit(axis), h = (deg * DEG) / 2, s = Math.sin(h)
  return [u[0] * s, u[1] * s, u[2] * s, Math.cos(h)]
}
export function qrot(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0])
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)]
}
/** The shortest turn that takes direction `from` to direction `to`. */
export function qbetween(from: Vec3, to: Vec3): Quat {
  const a = unit(from), b = unit(to)
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  if (d > 1 - 1e-12) return QID
  if (d < -1 + 1e-12) { const side: Vec3 = Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]; return qaxis([a[1] * side[2] - a[2] * side[1], a[2] * side[0] - a[0] * side[2], a[0] * side[1] - a[1] * side[0]], 180) }
  const c: Vec3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const q: Quat = [c[0], c[1], c[2], 1 + d], n = Math.hypot(q[0], q[1], q[2], q[3])
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n]
}
/** A point of a posed part: its local point turned and moved. */
export const place = (pose: Pose, local: Vec3): Vec3 => add(pose.p, qrot(pose.q, local))
/** A world point seen from a posed part. */
export const into = (pose: Pose, world: Vec3): Vec3 => qrot(qconj(pose.q), sub(world, pose.p))

// ── pose algebra: what each joint does to a pose ─────────────────────────────────────────────────────
/** Turn a pose by `deg` about `axis` through `pivot` (a point in the same space as the pose). */
export function spin(pose: Pose, axis: Vec3, deg: number, pivot: Vec3 = pose.p): Pose {
  const r = qaxis(axis, deg)
  return { p: add(pivot, qrot(r, sub(pose.p, pivot))), q: qmul(r, pose.q) }
}
/** Move a pose by `by` along `axis`. */
export const slide = (pose: Pose, axis: Vec3, by: number): Pose => ({ p: add(pose.p, scale(unit(axis), by)), q: pose.q })
/** A part riding on a point of another: its own point `my` sits on `point`, and it turns with the carrier. */
export const ride = (carrier: Quat, point: Vec3, my: Vec3 = [0, 0, 0]): Pose => ({ p: sub(point, qrot(carrier, my)), q: carrier })
/** A link whose local point `start` sits on `a` and whose local direction start → end aims at `b`. */
export function span(a: Vec3, b: Vec3, start: Vec3, end: Vec3): Pose {
  const q = qbetween(sub(end, start), sub(b, a))
  return { p: sub(a, qrot(q, start)), q }
}

// ── reading the lines ────────────────────────────────────────────────────────────────────────────────
const AXES: Record<string, Vec3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }
/** Levenshtein distance, for did-you-mean. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!
    row[0] = i
    for (let j = 1; j <= b.length; j++) { const keep = row[j]!; row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = keep }
  }
  return row[b.length]!
}
/** The nearest of `names` to a word, when it is near enough to be a typing mistake. */
export function nearest(word: string, names: readonly string[]): string | null {
  let best: string | null = null, score = Infinity
  for (const n of names) { const d = distance(word.toLowerCase(), n.toLowerCase()); if (d < score) { score = d; best = n } }
  return best !== null && score <= Math.max(1, Math.floor(word.length / 2)) ? best : null
}
const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x))
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** 'part' or 'part.anchor' → { part, anchor }. The part is the longest known name the text starts with. */
export function parseRef(text: string, parts: readonly string[]): Ref | null {
  if (parts.includes(text)) return { part: text, anchor: null }
  let hit: string | null = null
  for (const p of parts) if (text.startsWith(p + '.') && (hit === null || p.length > hit.length)) hit = p
  return hit === null ? null : { part: hit, anchor: text.slice(hit.length + 1) }
}

export interface Parsed { joints: Joint[]; problems: Problem[] }
/**
 * Read the joints as written. Nothing here throws: a line that cannot be read is left out and described in
 * `problems`, with the nearest name when a word looks like a typing mistake. `isSpec` recognises a mechanism of the
 * engine that was declared by part names (it gives its type and the names it joins).
 */
export function parseJoints(raw: unknown, parts: readonly string[], isSpec: (v: unknown) => { type: string; parts: string[] } | null = () => null): Parsed {
  const joints: Joint[] = [], problems: Problem[] = []
  if (raw === undefined || raw === null) return { joints, problems }
  if (!Array.isArray(raw)) { problems.push({ what: 'joints must be a list of lines.', fix: "joints: [['wheel', 'spins', { by: 'turn' }]]" }); return { joints, problems } }
  const partName = (v: unknown, line: number, role: string): string | null => {
    if (typeof v === 'string' && parts.includes(v)) return v
    const near = typeof v === 'string' ? nearest(v, parts) : null
    problems.push({ what: `joint ${line + 1}: ${role} "${String(v)}" is not a part of this machine.`, fix: near ? `use '${near}'` : `parts are: ${parts.join(', ') || '(none)'}` })
    return null
  }
  const point = (v: unknown, line: number, role: string): PointSpec | null => {
    if (isVec3(v)) return v
    if (typeof v === 'string') {
      const ref = parseRef(v, parts)
      if (ref) return ref
      const near = nearest(v.split('.')[0]!, parts)
      problems.push({ what: `joint ${line + 1}: ${role} "${v}" names no part of this machine.`, fix: near ? `use '${near}${v.includes('.') ? v.slice(v.indexOf('.')) : ''}'` : `write 'part.anchor' with one of: ${parts.join(', ') || '(none)'}` })
      return null
    }
    problems.push({ what: `joint ${line + 1}: ${role} must be 'part.anchor' or [x, y, z].`, fix: "'crank.pin'" })
    return null
  }
  const axis = (v: unknown, line: number, fallback: Vec3): Vec3 => {
    if (v === undefined) return fallback
    if (typeof v === 'string' && AXES[v]) return AXES[v]!
    if (isVec3(v) && length(v) > 0) return v
    problems.push({ what: `joint ${line + 1}: "${String(v)}" is not an axis.`, fix: "use 'x', 'y', 'z' or a vector [x, y, z]" })
    return fallback
  }
  const drive = (v: unknown, line: number): Drive | null => {
    if (typeof v === 'string' || typeof v === 'function' || (typeof v === 'number' && Number.isFinite(v))) return v as Drive
    problems.push({ what: `joint ${line + 1}: \`by\` must be a control name, a number or a function of the controls.`, fix: "by: 'turn'   or   by: (c) => c.turn / 2" })
    return null
  }
  const known = (o: Record<string, unknown>, keys: readonly string[], line: number): void => {
    for (const k of Object.keys(o)) if (!keys.includes(k)) { const near = nearest(k, keys); problems.push({ what: `joint ${line + 1}: unknown option "${k}".`, fix: near ? `use '${near}'` : `options are: ${keys.join(', ')}` }) }
  }
  raw.forEach((item, line) => {
    const mech = isSpec(item)
    if (mech) {
      const names = mech.parts.filter((n) => partName(n, line, `${mech.type}() part`) !== null)
      if (names.length === mech.parts.length) joints.push({ verb: 'mechanism', type: mech.type, parts: names, spec: item, line })
      return
    }
    if (!Array.isArray(item) || item.length < 2) { problems.push({ what: `joint ${line + 1} is not a line of the form [part, verb, …].`, fix: "['wheel', 'spins', { by: 'turn' }]" }); return }
    const [subject, verb, ...rest] = item as unknown[]
    if (typeof verb !== 'string' || !(VERBS as readonly string[]).includes(verb)) {
      const near = typeof verb === 'string' ? nearest(verb, VERBS) : null
      problems.push({ what: `joint ${line + 1}: "${String(verb)}" is not a joint.`, fix: near ? `use '${near}'` : `joints are: ${VERBS.join(', ')}` })
      return
    }
    const opts = (i: number): Record<string, unknown> => (isRecord(rest[i]) ? (rest[i] as Record<string, unknown>) : {})
    if (verb === 'particles') {
      const o = opts(0)
      known(o, ['when', 'color'], line)
      const when = typeof o.when === 'function' ? (o.when as ParticleJoint['when']) : null, color = typeof o.color === 'string' ? o.color : null
      if (Array.isArray(subject)) {
        const path = subject.map((v) => point(v, line, 'a point of the path')).filter((v): v is PointSpec => v !== null)
        if (path.length === subject.length && path.length >= 2) joints.push({ verb, part: null, path, when, color, line })
        else if (path.length === subject.length) problems.push({ what: `joint ${line + 1}: a path needs at least two points.`, fix: "[['tank.out', 'pump.in'], 'particles', { when }]" })
        return
      }
      const part = partName(subject, line, 'the path')
      if (part) joints.push({ verb, part, path: [], when, color, line })
      return
    }
    const part = partName(subject, line, 'the part')
    if (!part) return
    switch (verb as Verb) {
      case 'spins': {
        const o = opts(0)
        known(o, ['about', 'by', 'at', 'pivot'], line)
        const by = drive(o.by, line)
        const at = o.at === undefined ? null : point(o.at, line, '`at`')
        if (by !== null && (o.at === undefined || at !== null)) joints.push({ verb: 'spins', part, axis: axis(o.about, line, AXES.z!), by, at, pivot: typeof o.pivot === 'string' ? o.pivot : null, line })
        return
      }
      case 'slides': {
        const o = opts(0)
        known(o, ['along', 'by'], line)
        const by = drive(o.by, line)
        if (by !== null) joints.push({ verb: 'slides', part, axis: axis(o.along, line, AXES.y!), by, line })
        return
      }
      case 'on': {
        const to = point(rest[0], line, 'the carrier')
        const o = opts(1)
        known(o, ['my', 'offset'], line)
        if (o.offset !== undefined && !isVec3(o.offset)) problems.push({ what: `joint ${line + 1}: offset must be [x, y, z].`, fix: 'offset: [0, 0.5, 0]' })
        if (to && !isVec3(to)) joints.push({ verb: 'on', part, to, my: typeof o.my === 'string' ? o.my : null, offset: isVec3(o.offset) ? o.offset : null, line })
        else if (to) problems.push({ what: `joint ${line + 1}: 'on' needs a part to ride on.`, fix: "['lobe', 'on', 'shaft.front']" })
        return
      }
      case 'between': {
        const a = point(rest[0], line, 'the first end'), b = point(rest[1], line, 'the second end')
        if (a && b) joints.push({ verb: 'between', part, a, b, line })
        return
      }
      case 'around': {
        const names = rest.flat().filter((v) => !isRecord(v)).map((v) => partName(v, line, 'the part inside')).filter((v): v is string => v !== null)
        if (names.length) joints.push({ verb: 'around', part, holds: names, line })
        else if (!rest.length) problems.push({ what: `joint ${line + 1}: 'around' needs the part inside.`, fix: "['case', 'around', 'rotor']" })
        return
      }
      case 'follows': {
        if (typeof rest[0] === 'function') joints.push({ verb: 'follows', part, law: rest[0] as FollowJoint['law'], line })
        else problems.push({ what: `joint ${line + 1}: 'follows' needs a function of the controls.`, fix: "['rotor', 'follows', (c) => ({ at: [Math.cos(c.turn), 0, 0], turn: c.turn / 3 })]" })
        return
      }
      case 'gas': {
        const o = opts(0)
        known(o, ['phase', 'size', 'from', 'to'], line)
        const from = o.from === undefined ? null : point(o.from, line, '`from`'), to = o.to === undefined ? null : point(o.to, line, '`to`')
        joints.push({ verb: 'gas', part, phase: typeof o.phase === 'function' ? (o.phase as GasJoint['phase']) : null, size: typeof o.size === 'function' ? (o.size as GasJoint['size']) : null, from, to, line })
        return
      }
    }
  })
  return { joints, problems }
}

// ── order ────────────────────────────────────────────────────────────────────────────────────────────
const refPart = (p: PointSpec | null): string[] => (p && !Array.isArray(p) ? [p.part] : [])
/** The parts a joint needs to be placed before the part it places. */
export function needs(j: Joint): string[] {
  switch (j.verb) {
    case 'spins': return refPart(j.at).filter((p) => p !== j.part)
    case 'on': return [j.to.part]
    case 'between': return [...refPart(j.a), ...refPart(j.b)].filter((p) => p !== j.part)
    case 'around': return j.holds
    case 'gas': return [...refPart(j.from), ...refPart(j.to)].filter((p) => p !== j.part)
    default: return []
  }
}
/** The parts a joint places. */
export const places = (j: Joint): string[] => (j.verb === 'mechanism' ? j.parts : j.verb === 'particles' ? [] : [j.part])

export interface Order {
  /** every part, each after the parts it depends on */
  order: string[]
  /** groups of parts whose joints depend on each other in a circle (they are placed without the joint that closes it) */
  cycles: string[][]
  /** parts no joint mentions: they sit at the origin */
  free: string[]
  /** parts that two joints both try to put somewhere */
  conflicts: { part: string; lines: number[] }[]
}
/** Dependency order of the parts (depth first, the order of `parts` breaking ties), with cycles and unmentioned parts found. */
export function orderParts(parts: readonly string[], joints: readonly Joint[]): Order {
  const deps = new Map<string, Set<string>>(parts.map((p) => [p, new Set<string>()]))
  const mentioned = new Set<string>()
  const placers = new Map<string, number[]>()
  for (const j of joints) {
    for (const p of places(j)) {
      mentioned.add(p)
      for (const d of needs(j)) if (d !== p) deps.get(p)?.add(d)
      // a part has ONE base (on, between, follows); spins and slides add to it, around and gas decorate it. A mechanism
      // moves some of its parts and only turns others (a cam that rides on a shaft): it reports its own conflicts
      if (j.verb === 'on' || j.verb === 'between' || j.verb === 'follows') placers.set(p, [...(placers.get(p) ?? []), j.line])
    }
    needs(j).forEach((d) => mentioned.add(d))
    if (j.verb === 'particles') j.path.forEach((p) => refPart(p).forEach((d) => mentioned.add(d)))
    if (j.verb === 'particles' && j.part) mentioned.add(j.part)
  }
  const order: string[] = [], cycles: string[][] = []
  const state = new Map<string, 0 | 1 | 2>()
  const stack: string[] = []
  const visit = (p: string): void => {
    const s = state.get(p) ?? 0
    if (s === 2) return
    if (s === 1) { cycles.push(stack.slice(stack.indexOf(p))); return }
    state.set(p, 1)
    stack.push(p)
    for (const d of deps.get(p) ?? []) visit(d)
    stack.pop()
    state.set(p, 2)
    order.push(p)
  }
  parts.forEach(visit)
  return { order, cycles, free: parts.filter((p) => !mentioned.has(p)), conflicts: [...placers].filter(([, lines]) => lines.length > 1).map(([part, lines]) => ({ part, lines })) }
}

// ── sampling plans ───────────────────────────────────────────────────────────────────────────────────
/** `count` values across [from, to], both ends included (a cyclic range leaves the last out: it is the first again). */
export function sweep(from: number, to: number, count: number, cyclic = false): number[] {
  const n = Math.max(2, Math.floor(count))
  return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (cyclic ? n : n - 1))
}
