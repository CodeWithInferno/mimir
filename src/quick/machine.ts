// machine({ parts, joints }): a 3D machine for explain(). The author lists parts (kit parts, or any primitive /
// extrude / lathe / sweep: a part the kit does not have is one expression) and joints (one line each: how a part
// relates to the others). This block does the rest: it places and moves every part from the joints, keeps housings
// see-through, fits the camera, names parts, measures the invariants the author declares, and turns state changes
// (view, explode, camera, spin, highlight, label) into the engine's own transitions. The grammar and the pose algebra
// are in ./joints.ts (pure, tested alone); this file binds them to the scene.
import {
  DEFAULT_FOV, definePlacement, fitPose, isNode, kindOf, Frame, PACE, selector, VIEWS,
  type MNode, type Handle, type OwnTransform, type Placed as PlacedPose, type SceneModel,
} from '../core/index.ts'
import { declareInvariant } from '../check/index.ts'
import { group } from '../r2d/index.ts'
import { fadeIn } from '../anim/index.ts'
import { isMechanismSpec, type MechanismSpec } from '../kit/mechanisms.ts'
import { flow as flowOf, gas as gasOf } from '../flow/index.ts'
import { defineBlock, type BlockCtx, type BlockDef, type BlockHandle } from './block.ts'
import {
  into, nearest, orderParts, parseJoints, parseRef, place, qmul, qrot, QID, ride, slide, span, spin, sub, sweep, type Drive, type Joint, type PointSpec, type Pose, type Quat, type Vec3,
} from './joints.ts'

// ── defaults: every number and name that shapes a machine, in one table ──────────────────────────────
export const VIEW_MODES = ['solid', 'ghost', 'cutaway', 'exploded'] as const
export type ViewMode = (typeof VIEW_MODES)[number]
export const MACHINE_DEFAULTS = {
  /** 'auto' = ghost when a housing (declared with 'around') has material between the camera side and what it holds, else solid */
  view: 'auto' as ViewMode | 'auto',
  /** the view the camera starts in: a readable three-quarter view */
  camera: 'iso',
  /** hints for the stage: width / height of the panel, and its share next to other blocks */
  aspect: 1.15,
  weight: 1.6,
  /** values per control at which swept bounds and invariants are measured while building */
  sweepSamples: 72,
  /** an invariant holds when its residual stays under this share of the machine's size */
  tolerance: 0.002,
  /**
   * a part nobody declared as a housing is one all the same when its box holds another part's whole travel and that
   * part fills at least this share of it, seen along the cut axis (a rotor in its casing; not a pin in a wheel)
   */
  autoHousingShare: 0.25,
  /** … and "holds" allows the inner part to stand out by this share of the outer one's size (outlines are not exact) */
  autoHousingSlack: 0.08,
  /** a housing that takes its height from what it holds is this much longer, as a share of that height */
  housingMargin: 0.1,
  /** a housing that is already within this share of its own size of the middle of what it holds stays where its geometry puts it */
  housingSnap: 0.02,
  /** share of the panel the whole motion of the machine fills, and the share one part fills when the camera looks at it */
  fill: 0.92,
  partFill: 0.55,
  /** a gas volume never shrinks below this size factor */
  gasMinSize: 0.05,
  /** spin: true turns the camera this many degrees, over this many seconds */
  spinDegrees: 30,
  spinSeconds: 6,
  /** seconds the machine takes to fade in when it comes on stage */
  enterSeconds: 0.7,
  /** the axis a cutaway removes along (the half toward the default camera) */
  cutAxis: 'z' as 'x' | 'y' | 'z',
  /** particles of one stream */
  particleCount: 24,
  particleSpeed: 1,
}
export interface MachineState { view: ViewMode; explode: number; camera: string; spin: number | boolean; highlight: string[]; label: Record<string, string> | string[] }
const STATE_KEYS = ['view', 'explode', 'camera', 'spin', 'highlight', 'label'] as const
const SPEC_KEYS = ['parts', 'joints', 'view', 'camera', 'labels', 'probes', 'checks'] as const
const QUANTITIES = ['x', 'y', 'z', 'height', 'angle', 'travel'] as const

/** What author functions (`by`, `follows`, `phase`, `when`, probes, checks) get as their second argument: the machine as it stands now. */
export interface MachineReader {
  /** world position of 'part' or 'part.anchor' */
  point(ref: string): Vec3
  /** a world point seen from a part: in the part's own axes, from its own origin */
  local(part: string, point: readonly number[]): Vec3
  /** distance between two points ('part.anchor' or [x, y, z]) */
  distance(a: string | readonly number[], b: string | readonly number[]): number
  /** how far a part is turned about z, degrees */
  angle(part: string): number
  /** a probe by name */
  probe(name: string): number
}
export interface CheckResult { name: string; /** largest residual found over the sweep */ worst: number; /** the control values where it was largest */ at: Record<string, number>; limit: number; samples: number; ok: boolean }

type AuthorFn = (c: Record<string, number>, m: MachineReader) => unknown
type Resolve = (node: MNode, frame: Frame, own: OwnTransform) => PlacedPose
definePlacement('quick.joint', (node, pl, frame, own) => (pl.resolve as Resolve)(node, frame, own))

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v) && !isNode(v)
const zDegrees = (q: Quat): number => { const x = qrot(q, [1, 0, 0]); return (Math.atan2(x[1], x[0]) * 180) / Math.PI }

/** A 3D machine: parts placed and moved by joints. `machine({ parts: { … }, joints: [ … ] })` goes into `stage`. */
export function machine(spec?: unknown): BlockDef<MachineState> {
  return defineBlock<BlockDef<MachineState>>({ kind: 'machine', is3d: true, prefer: { aspect: MACHINE_DEFAULTS.aspect, weight: MACHINE_DEFAULTS.weight }, build: (ctx) => build(ctx, spec) })
}

function build(ctx: BlockCtx, given: unknown): BlockHandle<MachineState> {
  const model: SceneModel = (ctx.s as unknown as { model: SceneModel }).model
  const s = ctx.s as unknown as Record<string, (...args: any[]) => any>
  const D = MACHINE_DEFAULTS
  const once = new Set<string>()
  const report = (what: string, fix?: string): void => { if (!once.has(what)) { once.add(what); ctx.report(`${ctx.id}: ${what}`, fix) } }
  const spec = isRecord(given) ? given : {}
  if (!isRecord(given)) report('machine() needs one object.', "machine({ parts: { wheel: cylinder() }, joints: [['wheel', 'spins', { by: 'turn' }]] })")
  for (const k of Object.keys(spec)) if (!(SPEC_KEYS as readonly string[]).includes(k)) { const near = nearest(k, SPEC_KEYS); report(`machine() has no option "${k}".`, near ? `use '${near}'` : `options are: ${SPEC_KEYS.join(', ')}`) }

  // ── parts: the names of the record become the ids, so narration and joints say 'engine.rod' and 'rod' ──
  const parts = new Map<string, Handle>()
  const rename = (node: MNode, id: string): void => {
    const old = node.id
    const all = model.nodes.filter((n) => n === node || n.id.startsWith(old + '.'))
    for (const n of all) { model.byId.delete(n.id); n.id = n === node ? id : id + n.id.slice(old.length); model.byId.set(n.id, n) }
  }
  if (spec.parts !== undefined && !isRecord(spec.parts)) report('parts must be a record of name → part.', 'parts: { wheel: cylinder({ radius: 1 }) }')
  for (const [name, value] of Object.entries(isRecord(spec.parts) ? spec.parts : {})) {
    if (!isNode(value) || value.space !== '3d') { report(`part "${name}" is not a 3D part.`, `${name}: a kit part, or box / cylinder / extrude / lathe / sweep`); continue }
    if ([...parts.values()].includes(value as Handle)) { report(`part "${name}" is the same object as another part.`, 'create one object per name'); continue }
    rename(value, `${ctx.id}.${name}`)
    value.label = name
    parts.set(name, value as Handle)
  }
  const names = [...parts.keys()]
  if (!names.length) report('the machine has no parts.', 'parts: { wheel: cylinder({ radius: 1 }) }')
  if (isRecord(spec.labels)) for (const [name, text] of Object.entries(spec.labels)) {
    const node = parts.get(name)
    if (node) node.label = String(text)
    else { const near = nearest(name, names); report(`labels names "${name}", which is not a part.`, near ? `use '${near}'` : `parts are: ${names.join(', ')}`) }
  }

  // ── controls, read by author functions as c.name ───────────────────────────────────────────────────
  const used = new Set<string>()
  const control = (name: string): number => {
    const p = ctx.control(name)
    if (!p) { report(`no control is called "${name}".`, `declare it: controls: { ${name}: { from: 0, to: 360 } }`); return 0 }
    used.add(name)
    const v = Number(p())
    return Number.isFinite(v) ? v : 0
  }
  const c = new Proxy({} as Record<string, number>, { get: (_t, name) => (typeof name === 'string' ? control(name) : undefined) })
  const call = (fn: AuthorFn, what: string, fallback: unknown): unknown => {
    try { return fn(c, reader) } catch (e) { report(`${what} threw: ${String((e as Error)?.message ?? e)}`, 'it must be a pure function of the controls: (c, m) => …'); return fallback }
  }
  const number = (fn: AuthorFn, what: string): number => { const v = Number(call(fn, what, 0)); if (Number.isFinite(v)) return v; report(`${what} did not give a number.`); return 0 }
  const driven = (d: Drive, what: string): number => (typeof d === 'number' ? d : typeof d === 'string' ? control(d) : number(d as AuthorFn, what))

  // ── joints ─────────────────────────────────────────────────────────────────────────────────────────
  const slotsOf = (v: MechanismSpec): string[] => {
    const o = v.args.find((a) => isRecord(a)) as Record<string, unknown> | undefined
    return v.slots.flatMap((k) => { const x = typeof k === 'number' ? v.args[k] : o?.[k]; return Array.isArray(x) ? x : [x] }).filter((x): x is string => typeof x === 'string')
  }
  const parsed = parseJoints(spec.joints, names, (v) => (isMechanismSpec(v) ? { type: v.type, parts: slotsOf(v) } : null))
  parsed.problems.forEach((p) => report(p.what, p.fix))
  const joints = parsed.joints
  const plan = orderParts(names, joints)
  plan.cycles.forEach((loop) => report(`the joints of ${loop.join(' → ')} → ${loop[0]} depend on each other in a circle.`, "break it: place one of them with 'follows', a pure function of the controls"))
  plan.conflicts.forEach((k) => report(`"${k.part}" is placed by joints ${k.lines.map((l) => l + 1).join(' and ')}; a part has one place.`, 'keep one of them (spins and slides add to it)'))
  // a part in no joint is a fixed part (a base, a pivot, a frame): it stays where its geometry puts it, and that is no mistake

  // ── reading the machine as it stands ───────────────────────────────────────────────────────────────
  const now = (): Frame => model.now()
  const poseOf = (name: string): Pose => { const w = now().world(parts.get(name)!); return { p: w.p as Vec3, q: w.q as Quat } }
  const refPoint = (ref: PointSpec, what: string): Vec3 => {
    if (Array.isArray(ref)) return ref
    const node = parts.get(ref.part)!
    if (ref.anchor === null) return now().world(node).p as Vec3
    if (now().anchorLocal(node, ref.anchor) === null) { const near = nearest(ref.anchor, now().anchorNames(node)); report(`${what}: "${ref.part}" has no point "${ref.anchor}".`, near ? `use '${ref.part}.${near}'` : `name one: ${ref.part}: part.define('${ref.anchor}', [x, y, z])  (points: ${now().anchorNames(node).join(', ')})`); return now().world(node).p as Vec3 }
    return now().anchor(node, ref.anchor) as Vec3
  }
  const textPoint = (v: string | readonly number[], what: string): Vec3 => {
    if (typeof v !== 'string') return [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0]
    const ref = parseRef(v, names)
    if (ref) return refPoint(ref, what)
    const near = nearest(v.split('.')[0]!, names)
    report(`${what}: "${v}" names no part of this machine.`, near ? `use '${near}'` : `parts are: ${names.join(', ')}`)
    return [0, 0, 0]
  }
  const reader: MachineReader = {
    point: (ref) => textPoint(ref, 'm.point()'),
    local: (part, point) => (parts.has(part) ? into(poseOf(part), [Number(point[0]) || 0, Number(point[1]) || 0, Number(point[2]) || 0]) : (textPoint(part, 'm.local()'), [0, 0, 0])),
    distance: (a, b) => { const d = sub(textPoint(a, 'm.distance()'), textPoint(b, 'm.distance()')); return Math.hypot(d[0], d[1], d[2]) },
    angle: (part) => (parts.has(part) ? zDegrees(poseOf(part).q) : (textPoint(part, 'm.angle()'), 0)),
    probe: (name) => value(name),
  }

  // ── placement: every part the joints place gets one resolver, composed in the order the joints are written ──
  const localPoint = (node: MNode, anchor: string | null, frame: Frame): Vec3 => (anchor === null ? [0, 0, 0] : ((frame.anchorLocal(node, anchor) ?? [0, 0, 0]) as Vec3))
  const ENDS: readonly (readonly [string, string])[] = [['bigEnd', 'smallEnd'], ['start', 'end'], ['bottom', 'top']]
  const mine = (name: string): Joint[] => joints.filter((j) => j.verb !== 'mechanism' && j.verb !== 'particles' && j.verb !== 'around' && j.part === name)
  const fixed = new Map<string, Vec3>() // housings placed round what they hold
  for (const name of plan.order) {
    const list = mine(name)
    const node = parts.get(name)!
    if (!list.some((j) => j.verb !== 'gas' || j.from || j.to)) continue
    const resolve: Resolve = (n, frame, own) => frame.run(() => {
      const scaleOwn = own.parentS * own.s
      // a point of the part itself, as it lies once the part's own rotate() is applied
      const at = (anchor: string | null): Vec3 => { const l = localPoint(n, anchor, frame); return qrot(own.q as Quat, [l[0] * scaleOwn, l[1] * scaleOwn, l[2] * scaleOwn]) }
      let pose: Pose = { p: fixed.get(name) ?? [0, 0, 0], q: QID }
      let frameQ: Quat = QID // the axes spins and slides are written in: those of the carrier, when the part rides on one
      for (const j of list) {
        if (j.verb === 'on') {
          const carrier = now().world(parts.get(j.to.part)!).q as Quat
          const o = j.offset ? qrot(carrier, j.offset) : ([0, 0, 0] as Vec3)
          const target = refPoint(j.to, `joint ${j.line + 1}`)
          pose = ride(carrier, [target[0] + o[0], target[1] + o[1], target[2] + o[2]], at(j.my))
          frameQ = carrier
        } else if (j.verb === 'between') {
          const own = frame.anchorNames(n) // the part's own ends, when it names them: a rod's bores, a sweep's ends; else bottom → top
          const pair = ENDS.find(([a, b]) => own.includes(a) && own.includes(b)) ?? ENDS[2]!
          pose = span(refPoint(j.a, `joint ${j.line + 1}`), refPoint(j.b, `joint ${j.line + 1}`), at(pair[0]), at(pair[1]))
        } else if (j.verb === 'follows') {
          const law = call(j.law as AuthorFn, `the law of "${name}"`, null)
          const o = isRecord(law) ? law : {}
          if (!isRecord(law)) report(`the law of "${name}" must return { at: [x, y, z], turn: degrees }.`, "(c) => ({ at: [Math.cos(c.turn), 0, 0], turn: c.turn / 3 })")
          const p = Array.isArray(o.at) ? o.at.map((x) => (Number.isFinite(Number(x)) ? Number(x) : 0)) : [0, 0, 0]
          const axis: Vec3 = o.about === 'x' ? [1, 0, 0] : o.about === 'y' ? [0, 1, 0] : Array.isArray(o.about) && o.about.length === 3 ? (o.about as Vec3) : [0, 0, 1]
          pose = spin({ p: [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0], q: QID }, axis, Number.isFinite(Number(o.turn)) ? Number(o.turn) : 0)
        } else if (j.verb === 'spins') {
          if (j.at) pose = { p: sub(refPoint(j.at, `joint ${j.line + 1}`), qrot(pose.q, at(j.pivot))), q: pose.q }
          pose = spin(pose, qrot(frameQ, j.axis), driven(j.by, `\`by\` of joint ${j.line + 1}`), place(pose, at(j.pivot)))
        } else if (j.verb === 'slides') {
          pose = slide(pose, qrot(frameQ, j.axis), driven(j.by, `\`by\` of joint ${j.line + 1}`))
        } else if (j.verb === 'gas' && j.from && j.to) {
          const a = refPoint(j.from, `joint ${j.line + 1}`), b = refPoint(j.to, `joint ${j.line + 1}`)
          const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
          pose = { p: mid, q: span(a, b, [0, 0, 0], [0, 1, 0]).q }
        }
      }
      return { p: pose.p, q: qmul(pose.q, own.q), world: true }
    })
    node.placement = { type: 'quick.joint', resolve, parts: list.flatMap((j) => (j.verb === 'on' ? [parts.get(j.to.part)] : j.verb === 'between' ? [j.a, j.b].flatMap((r) => (Array.isArray(r) ? [] : [parts.get(r.part)])) : [])) }
  }
  model.revision++

  // ── the engine's mechanisms, declared by names: resolve the names and build them ─────────────────────
  const counts: Record<string, number> = {}
  for (const j of joints) {
    if (j.verb !== 'mechanism') continue
    const v = j.spec as MechanismSpec
    const n = (counts[v.type] = (counts[v.type] ?? 0) + 1)
    const slots = new Set(v.slots)
    const partOf = (x: unknown): unknown => (typeof x === 'string' && parts.has(x) ? parts.get(x) : Array.isArray(x) ? x.map(partOf) : x)
    // other options: a control by name, or a function of the controls
    const live = (x: unknown, what: string): unknown => (typeof x === 'string' && ctx.control(x) ? () => control(x) : typeof x === 'function' && x.length > 0 ? () => number(x as AuthorFn, what) : x)
    const args = v.args.map((a, i) => {
      if (slots.has(i)) return partOf(a)
      if (!isRecord(a)) return a
      const out: Record<string, unknown> = { id: `${ctx.id}.${v.type}${n > 1 ? n : ''}` }
      for (const [k, x] of Object.entries(a)) out[k] = slots.has(k) ? partOf(x) : live(x, `${k} of ${v.type}()`)
      return out
    })
    try { v.make(...args) } catch (e) { report(`${v.type}() could not be built: ${String((e as Error)?.message ?? e)}`) }
  }

  // ── sampling: the machine at many control values (bounds, invariants) ──────────────────────────────
  const settle = (): void => { try { new Frame(model, 0).run(() => { for (const n of names) now().world(parts.get(n)!); for (const p of Object.values(probesGiven)) call(p, 'a probe', 0) }) } catch { /* reported where it is used */ } }
  const probesGiven: Record<string, AuthorFn> = {}
  if (isRecord(spec.probes)) for (const [k, f] of Object.entries(spec.probes)) { if (typeof f === 'function') probesGiven[k] = f as AuthorFn; else report(`probe "${k}" must be a function of the controls.`, `${k}: (c, m) => m.point('part.anchor')[1]`) }
  /** Run `fn` with the machine at each value of each control the joints read (the others at their start), plus the start itself. */
  const everywhere = (fn: (at: Record<string, number>) => void): number => {
    settle()
    let count = 0
    const run = (overrides: Record<string, number>): void => { count++; try { new Frame(model, 0, overrides).run(() => fn(overrides)) } catch (e) { report(`sampling the machine failed: ${String((e as Error)?.message ?? e)}`) } }
    run({})
    for (const name of used) {
      const def = (ctx.control(name) as unknown as { def?: { min: number; max: number; cyclic?: boolean } } | undefined)?.def
      if (!def || !(def.max > def.min)) continue
      for (const x of sweep(def.min, def.max, D.sweepSamples, def.cyclic === true)) run({ [name]: x })
    }
    return count
  }
  interface Box { min: Vec3; max: Vec3 }
  const sweptBox = (nodes: MNode[]): Box => {
    const box: Box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
    everywhere(() => { for (const n of nodes) { const b = now().bounds(n); for (let i = 0; i < 3; i++) { if (b.min[i]! < box.min[i]!) box.min[i] = b.min[i]!; if (b.max[i]! > box.max[i]!) box.max[i] = b.max[i]! } } })
    return box
  }
  const finiteBox = (b: Box): boolean => b.min.every(Number.isFinite) && b.max.every(Number.isFinite)

  /** An outline pushed through with a hole in it: a ring, open toward the camera. */
  const isRing = (h: MNode): boolean => h.kind === 'extrude' && Array.isArray(h.props.holes) && h.props.holes.length > 0
  // ── housings: placed round what they hold, long enough for its whole travel, and seen through ────────
  const housings: Handle[] = []
  let hides = false // a housing reaches further toward the camera than what it holds: seen through by default
  const toward = D.cutAxis === 'x' ? 0 : D.cutAxis === 'y' ? 1 : 2
  for (const j of joints) {
    if (j.verb !== 'around') continue
    const node = parts.get(j.part)!
    housings.push(node)
    node.props.shell = true
    for (const inside of j.holds) (node as Handle).allow?.('CONTAINED', parts.get(inside))
    if (node.placement) { hides = true; continue } // the author placed it with another joint: where it is seen from is not known here
    const held = sweptBox(j.holds.map((n) => parts.get(n)!))
    if (!finiteBox(held)) continue
    const schema = kindOf(node.kind)?.schema ?? {}
    if ('height' in schema && node.props.height === undefined) node.props.height = (held.max[1] - held.min[1]) * (1 + D.housingMargin)
    const own = new Frame(model, 0).run(() => now().bounds(node))
    // seen through by default only when it has material between the camera side and what it holds
    // (an outline with a hole is a ring: what it holds is seen through the hole, and the ring stays solid)
    hides ||= !isRing(node) && own.max[toward]! - own.min[toward]! > held.max[toward]! - held.min[toward]! + 1e-9
    const centre = (b: Box): Vec3 => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]
    const p = sub(centre(held), centre(own))
    // already round it (boxes of turning parts are generous, so this is judged on the middles): it stays where its own geometry puts it
    if (Math.hypot(p[0], p[1], p[2]) <= D.housingSnap * Math.hypot(own.max[0] - own.min[0], own.max[1] - own.min[1], own.max[2] - own.min[2])) continue
    const stay: Resolve = (_n, _f, o) => ({ p, q: o.q, world: true })
    node.placement = { type: 'quick.joint', resolve: stay, parts: j.holds.map((n) => parts.get(n)) }
  }
  model.revision++

  // ── fluids ─────────────────────────────────────────────────────────────────────────────────────────
  const extras: Handle[] = []
  const gasFor = new Map<string, Handle>() // a part that holds gas → the gas, so a highlight of the part keeps its gas lit
  for (const j of joints) {
    if (j.verb === 'gas') {
      const node = parts.get(j.part)!
      if (j.from && j.to && 'height' in (kindOf(node.kind)?.schema ?? {})) node.props.height = () => { const a = refPoint(j.from!, 'gas'), b = refPoint(j.to!, 'gas'); return Math.max(1e-4, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])) }
      const phase = (): unknown => (j.phase ? call(j.phase as AuthorFn, `the phase of "${j.part}"`, null) : null)
      const field = (key: 'temperature' | 'density', fallback: number) => (): number => { const v = phase(); const x = typeof v === 'number' ? (key === 'temperature' ? v : fallback) : isRecord(v) && typeof v[key] === 'number' ? (v[key] as number) : fallback; return Math.min(1, Math.max(0, x)) }
      const color = (): string | null => { const v = phase(); return typeof v === 'string' ? v : isRecord(v) && typeof v.color === 'string' ? v.color : null }
      if (j.size) node.props.scale = (): number => Math.max(D.gasMinSize, number(j.size as AuthorFn, `the size of "${j.part}"`))
      const g = gasOf(node, { id: `${ctx.id}.${j.part}.gas`, temperature: field('temperature', 0.2), density: field('density', 0.5), color })
      g.label = node.label
      extras.push(g)
      gasFor.set(j.part, g)
    } else if (j.verb === 'particles') {
      const active = (): number => { if (!j.when) return 1; const v = call(j.when as AuthorFn, 'the `when` of a particle stream', 0); return v === true ? 1 : typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0 }
      const path = j.part ? parts.get(j.part)! : (): Vec3[] => j.path.map((p) => refPoint(p, `joint ${j.line + 1}`))
      const id = `${ctx.id}.${j.part ?? 'stream'}.particles${extras.filter((e) => e.kind !== 'gas').length ? extras.length + 1 : ''}`
      extras.push(flowOf(path, { id, active, count: D.particleCount, speed: D.particleSpeed, ...(j.color ? { color: j.color } : {}) }))
    }
  }

  const root = group([...parts.values(), ...extras]) as Handle
  rename(root, ctx.id)

  // The parts of one machine sit in front of each other by design (a rod on its pin, a pin in its slot, a piston in
  // its liner). Each pair is declared to check, which then asks for a smaller share of a part to show (limit
  // `occludedDeclared`) when only parts of its own machine are in front of it. A part hidden outright is still reported.
  for (const a of parts.values()) for (const b of parts.values()) if (a !== b) a.allow?.('OCCLUDED', b)

  // The parts of one machine also touch, mesh and slide in each other by design: a pin in its slot, a yoke on its pin,
  // a tooth in its gap, a beam on its pivot. Drawn from formulas, such fits overlap by a hair, and that is not a
  // collision a writer should be sent back for. Every pair is declared a fit; what a script claims about its
  // mechanism it states with `checks`, which are measured over every control.
  for (const a of parts.values()) for (const b of parts.values()) if (a !== b) a.allow?.('INTERPENETRATE', b)

  // ── probes ─────────────────────────────────────────────────────────────────────────────────────────
  const published = new Set<string>() // probes this block exposed to check / shot under '<id>.<name>'
  let rest: Map<string, Vec3> | null = null
  const restOf = (name: string): Vec3 => {
    rest ??= new Frame(model, 0).run(() => new Map(names.map((n) => [n, now().world(parts.get(n)!).p as Vec3])))
    return rest.get(name) ?? [0, 0, 0]
  }
  function value(name: string): number {
    const own = probesGiven[name]
    if (own) return number(own, `the probe "${name}"`)
    const engine = published.has(`${ctx.id}.${name}`) ? undefined : model.probes.get(`${ctx.id}.${name}`) // a mechanism's own probe, e.g. 'crankSlider.fraction'
    if (engine) { const v = Number(engine()); return Number.isFinite(v) ? v : 0 }
    const dot = name.lastIndexOf('.')
    const quantity = dot < 0 ? '' : name.slice(dot + 1), ref = dot < 0 ? null : parseRef(name.slice(0, dot), names)
    if (ref && (QUANTITIES as readonly string[]).includes(quantity)) {
      if (quantity === 'angle') return zDegrees(poseOf(ref.part).q)
      const p = refPoint(ref, `probe "${name}"`)
      if (quantity === 'travel') { const r = restOf(ref.part), w = now().world(parts.get(ref.part)!).p; return Math.hypot(w[0] - r[0], w[1] - r[1], w[2] - r[2]) }
      return p[quantity === 'x' ? 0 : quantity === 'z' ? 2 : 1]
    }
    const known = [...Object.keys(probesGiven), ...[...model.probes.keys()].filter((k) => k.startsWith(ctx.id + '.') && !published.has(k)).map((k) => k.slice(ctx.id.length + 1)), ...names.flatMap((n) => QUANTITIES.map((q) => `${n}.${q}`))]
    const near = nearest(name, known)
    report(`there is no probe "${name}".`, near ? `use '${near}'` : `a probe is 'part.x|y|z|angle|travel', 'part.anchor.y', or one of probes: { … }`)
    return 0
  }
  /** A live number of the machine, for a chart curve or a readout: a function that reads it at the state being drawn. */
  const probe = (name: string, other?: string): (() => number) => {
    const fn = other === undefined ? (): number => value(name) : (): number => reader.distance(name, other)
    const key = `${ctx.id}.${other === undefined ? name : `${name}~${other}`}`
    if (!published.has(key) && !model.probes.has(key)) { published.add(key); s.probe!(key, fn) }
    return fn
  }

  // ── invariants: declared by the author, measured here at many control values, verified again by check ──
  let size: number | null = null
  const sizeOf = (): number => (size ??= (() => { const b = sweptBox([...parts.values()]); return finiteBox(b) ? Math.max(1e-6, Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2])) : 1 })())
  const results: CheckResult[] = []
  const check = (name: string, fn: unknown): CheckResult | null => {
    if (typeof name !== 'string' || typeof fn !== 'function') { report('check() needs a name and a function that returns how far off the claim is (0 = it holds).', "check('the pin stays in the slot', (c, m) => Math.abs(m.local('wheel', m.point('driver.pin'))[1]))"); return null }
    const limit = D.tolerance * sizeOf()
    const residual = (): number => Math.abs(number(fn as AuthorFn, `the check "${name}"`))
    const result: CheckResult = { name, worst: 0, at: {}, limit, samples: 0, ok: true }
    result.samples = everywhere((at) => { const r = residual(); if (r > result.worst) { result.worst = r; result.at = { ...at } } })
    result.ok = result.worst <= limit
    results.push(result)
    // one owner per finding: check reports it (MECH-OPEN). When the sweep here found it broken at a control value the
    // story never visits, the invariant carries that measurement, so the linter still says so, with where
    const where = Object.entries(result.at).map(([k, v]) => `${k} = ${Math.round(v * 100) / 100}`).join(', ') || 'the start'
    declareInvariant({ name, parts: [...parts.values()], residual: (frame) => (result.ok ? frame.run(residual) : result.worst), tolerance: limit, what: result.ok ? `"${name}"` : `"${name}" (measured at ${result.samples} control values; worst at ${where})`, fix: ['the law that moves the parts and the outlines of the parts disagree: derive both from the same numbers', "a point named 'front', 'top' … is the middle of that side of the part's box, not a point on its axis: name your own with part.define('axle', [x, y, z])"], model })
    s.probe!(`${ctx.id}.check.${results.length}`, residual)
    return result
  }
  if (isRecord(spec.checks)) for (const [name, fn] of Object.entries(spec.checks)) check(name, fn)
  else if (spec.checks !== undefined) report('checks must be a record of claim → function.', "checks: { 'the pin stays in the slot': (c, m) => … }")

  // ── what the author did not declare but the geometry says ──────────────────────────────────────────
  // A part whose box holds another part, and is at least as deep toward the camera, hides it. When the inner part
  // fills a fair share of it, the outer one is its housing (seen through, like one declared with 'around'). A small
  // part inside a large one (a pin in a wheel, a shaft in a rotor) is hidden by design: no finding, no ghost.
  // Measured where the machine starts: the box of a part that turns grows with every angle it is measured at, and a
  // rotor then no longer "fits" the casing it turns in.
  {
    const plane = [0, 1, 2].filter((i) => i !== toward) as [number, number]
    const atRest = (node: MNode): Box => new Frame(model, 0).run(() => now().bounds(node))
    const within = (a: Box, b: Box): boolean => plane.every((i) => { const slack = (b.max[i]! - b.min[i]!) * D.autoHousingSlack; return a.min[i]! >= b.min[i]! - slack && a.max[i]! <= b.max[i]! + slack })
    const areaOf2 = (b: Box): number => Math.max(0, b.max[plane[0]]! - b.min[plane[0]]!) * Math.max(0, b.max[plane[1]]! - b.min[plane[1]]!)
    for (const [outerName, outer] of parts) {
      if (gasFor.has(outerName)) continue // a gas is what a part holds, never a part that holds
      const own = atRest(outer)
      if (!finiteBox(own)) continue
      for (const [innerName, inner] of parts) {
        if (inner === outer || gasFor.has(innerName)) continue
        const held = atRest(inner)
        if (!finiteBox(held) || !within(held, own) || areaOf2(held) > areaOf2(own)) continue
        ;(outer as Handle).allow?.('CONTAINED', inner)
        if (housings.includes(outer) || housings.includes(inner)) continue
        // as deep as what it holds is enough to hide it: the two faces lie in one plane
        const deeper = own.max[toward]! - own.min[toward]! >= held.max[toward]! - held.min[toward]! - 1e-9
        if (deeper && !isRing(outer) && areaOf2(held) >= D.autoHousingShare * areaOf2(own)) { housings.push(outer); outer.props.shell = true; hides = true }
      }
    }
  }
  // ── view: housings seen through, from the first frame ──────────────────────────────────────────────
  const asView = (v: unknown, what: string): ViewMode | null => {
    if (typeof v === 'string' && (VIEW_MODES as readonly string[]).includes(v)) return v as ViewMode
    const near = typeof v === 'string' ? nearest(v, VIEW_MODES) : null
    report(`${what}: "${String(v)}" is not a view.`, near ? `use '${near}'` : `views are: ${VIEW_MODES.join(', ')}`)
    return null
  }
  // NOT YET: the engine's explode pushes every part by its own offset, and parts that joints or mechanisms tie
  // together are then drawn apart from the pins that hold them (the linkage no longer closes). Until a machine can be
  // pulled apart along its joints, asking for it is reported and the machine stays as it is: a wrong picture is worse.
  const noExplode = (): void => report("the 'exploded' view is not available for a machine yet: its parts are tied by joints, and pulling them apart would draw the linkage open.", "use view: 'cutaway' or 'ghost' to see inside, or highlight: [part] to single one out")
  let wanted = spec.view === undefined || spec.view === 'auto' ? D.view : asView(spec.view, 'view') ?? D.view
  if (wanted === 'exploded') { noExplode(); wanted = D.view }
  const view0: ViewMode = wanted === 'auto' ? (hides ? 'ghost' : 'solid') : wanted
  const shells = (): true | Handle[] => (housings.length ? housings : true)
  // A solid block that stands round what it holds (an outline pushed through, a box, a cylinder: no hollow inside) shows
  // only its own cut face when it is cut open. It is seen through instead; a housing with a hollow is cut.
  const SOLID = ['extrude', 'box', 'cylinder', 'sphere']
  const isSolid = (h: Handle): boolean => SOLID.includes(h.kind) && !(Array.isArray(h.props.holes) && h.props.holes.length > 0)
  const cut = (): Record<string, unknown> => {
    const b = sweptBox([...parts.values()])
    const i = D.cutAxis === 'x' ? 0 : D.cutAxis === 'y' ? 1 : 2
    const hollow = housings.filter((h) => !isSolid(h))
    return { axis: D.cutAxis, at: finiteBox(b) ? (b.min[i]! + b.max[i]!) / 2 : 0, ...(hollow.length ? { parts: hollow } : {}) }
  }
  /** What is seen through in a view: every housing in 'ghost' (the whole machine when it has none), the solid ones in 'cutaway'. */
  const seenThrough = (v: ViewMode): true | Handle[] => (v === 'ghost' ? shells() : v === 'cutaway' ? housings.filter(isSolid) : [])
  /** Is anything cut open in a view? Only a housing with a hollow can be (or, without housings, the whole machine). */
  const cutIn = (v: ViewMode): boolean => v === 'cutaway' && (!housings.length || housings.some((h) => !isSolid(h)))
  const sameParts = (a: true | Handle[], b: true | Handle[]): boolean => (a === true || b === true ? a === b : a.length === b.length && a.every((h) => b.includes(h)))
  /** Go from one view to another, touching only what differs (a housing that stays seen through is not switched off and on). */
  const setView = (on: Record<string, (...args: any[]) => any>, from: ViewMode | null, to: ViewMode): void => {
    const was = from === null ? [] : seenThrough(from), is = seenThrough(to)
    if (from !== null && cutIn(from) && !cutIn(to)) on.cutaway!(false)
    if (!sameParts(was, is)) {
      if (was === true || was.length) on.ghost!(false)
      if (is === true || is.length) on.ghost!(is)
    }
    if (cutIn(to) && !(from !== null && cutIn(from))) on.cutaway!(cut())
  }
  setView(s as unknown as Record<string, (...args: any[]) => any>, null, view0)
  const camera0 = typeof spec.camera === 'string' && (VIEWS[spec.camera] || parts.has(spec.camera)) ? spec.camera : D.camera
  if (spec.camera !== undefined && camera0 !== spec.camera) { const near = typeof spec.camera === 'string' ? nearest(spec.camera, [...Object.keys(VIEWS), ...names]) : null; report(`camera: "${String(spec.camera)}" is neither a view nor a part.`, near ? `use '${near}'` : `views are: ${Object.keys(VIEWS).join(', ')}`) }
  // the camera frames the whole motion (the swept box over every control), so nothing leaves the panel when a control moves
  const cornersOf = (b: Box): Vec3[] => [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]])
  const aspect = ctx.rect.height > 0 ? ctx.rect.width / ctx.rect.height : 1
  const aim = (nodes: MNode[], az: number, el: number, fill: number): Record<string, unknown> => {
    // the corners of every part at every sampled control value: the cloud the motion really fills (the corners of one
    // box round the whole travel lie far outside it and set the camera much too far back)
    const cloud: Vec3[] = []
    everywhere(() => { for (const n of nodes) { const b = now().bounds(n); if (finiteBox(b)) cloud.push(...cornersOf(b)) } })
    if (!cloud.length) return { azimuth: az, elevation: el, fit: true }
    const pose = fitPose(cloud, az, el, DEFAULT_FOV, aspect, fill)
    return { azimuth: az, elevation: el, target: pose.target, distance: pose.distance }
  }
  const initial: MachineState = { view: view0, explode: 0, camera: camera0, spin: 0, highlight: [], label: [] }
  let azimuth = VIEWS[camera0]?.azimuth ?? VIEWS[D.camera]!.azimuth, elevation = VIEWS[camera0]?.elevation ?? VIEWS[D.camera]!.elevation
  let aimed = camera0 === D.camera // the engine's own fit is the default view: nothing to say until a step changes it

  const partFor = (name: unknown, what: string): Handle | null => {
    if (typeof name === 'string' && parts.has(name)) return parts.get(name)!
    const near = typeof name === 'string' ? nearest(name, names) : null
    report(`${what}: "${String(name)}" is not a part of this machine.`, near ? `use '${near}'` : `parts are: ${names.join(', ')}`)
    return null
  }

  return {
    root,
    initial,
    // comes on stage framed on its whole travel (the same framing every later view uses), so the first step is never further away than the others
    enter(st) {
      const step = st as unknown as Record<string, (...args: any[]) => any>
      aimed = true
      step.camera!({ ...(VIEWS[camera0] ? aim([...parts.values()], azimuth, elevation, D.fill) : aim([parts.get(camera0)!], azimuth, elevation, D.partFill)), duration: 0 })
      step.play!(fadeIn(root, { duration: D.enterSeconds }))
    },
    target: (path) => (path === '' ? root : parts.get(path) ?? (model.byId.get(`${ctx.id}.${path}`) as Handle | undefined)) as any,
    targets: () => ['', ...names],
    apply(st, change, prev) {
      const step = st as unknown as Record<string, (...args: any[]) => any>
      const next: MachineState = { ...prev }
      const given = isRecord(change) ? change : {}
      for (const k of Object.keys(given)) if (!(STATE_KEYS as readonly string[]).includes(k)) { const near = nearest(k, STATE_KEYS); report(`a step sets "${k}", which a machine does not have.`, near ? `use '${near}'` : `a machine has: ${STATE_KEYS.join(', ')}`) }
      if (!aimed) { aimed = true; if (given.camera === undefined) step.camera!({ ...(VIEWS[prev.camera] ? aim([...parts.values()], azimuth, elevation, D.fill) : aim([parts.get(prev.camera)!], azimuth, elevation, D.partFill)), duration: 0 }) }
      if (given.view !== undefined) {
        const v = asView(given.view, 'a step')
        if (v === 'exploded') noExplode()
        else if (v && v !== prev.view) {
          setView(step, prev.view, v)
          next.view = v
        }
      }
      if (given.explode !== undefined) {
        const x = Number(given.explode)
        if (!(Number.isFinite(x) && x >= 0 && x <= 1)) report(`explode: ${String(given.explode)} is not a number from 0 to 1.`, 'explode: 0 keeps the machine together')
        else if (x > 0) noExplode()
      }
      if (given.camera !== undefined) {
        const name = given.camera
        if (typeof name === 'string' && VIEWS[name]) { azimuth = VIEWS[name]!.azimuth; elevation = VIEWS[name]!.elevation; step.camera!(aim([...parts.values()], azimuth, elevation, D.fill)); next.camera = name }
        else { const part = partFor(name, 'camera'); if (part) { step.camera!(aim([part], azimuth, elevation, D.partFill)); next.camera = String(name) } }
      }
      if (given.spin !== undefined) {
        const degrees = given.spin === true ? D.spinDegrees : given.spin === false ? 0 : Number(given.spin)
        if (Number.isFinite(degrees)) { if (degrees !== 0) { azimuth += degrees; step.camera!({ azimuth, duration: D.spinSeconds }) } next.spin = given.spin as number | boolean }
        else report(`spin: ${String(given.spin)} is not true or a number of degrees.`, 'spin: true')
      }
      if (given.highlight !== undefined) {
        const list = (Array.isArray(given.highlight) ? given.highlight : given.highlight === null || given.highlight === false ? [] : [given.highlight]).map((n) => partFor(n, 'highlight')).filter((n): n is Handle => n !== null)
        if (list.length) {
          // dim the rest of THIS machine only (other blocks keep their light), and tell the guide what is in focus
          const keep = new Set<MNode>(), own = new Set<MNode>()
          const mark = (into: Set<MNode>) => (n: MNode): void => { into.add(n); n.children.forEach(mark(into)) }
          list.forEach(mark(keep))
          for (const [name, g] of gasFor) if (list.includes(parts.get(name)!)) mark(keep)(g)
          mark(own)(root)
          step.clip!(selector((n) => own.has(n) && !keep.has(n) && !kindOf(n.kind)?.container), 'dim', 1, { duration: PACE.scopedIn, scope: 'step' })
          step.action!('focus', { nodes: list })
        }
        next.highlight = list.map((n) => n.label ?? n.id)
      }
      if (given.label !== undefined) {
        const entries: [unknown, unknown][] = Array.isArray(given.label) ? given.label.map((n) => [n, undefined]) : isRecord(given.label) ? Object.entries(given.label) : [[given.label, undefined]]
        for (const [name, text] of entries) { const part = partFor(name, 'label'); if (part) step.label!(part, text === undefined ? part.label ?? String(name) : String(text)) }
        next.label = given.label as MachineState['label']
      }
      return next
    },
    api: { parts: names, probe, check, checks: () => results.map((r) => ({ ...r })), point: (ref: string) => reader.point(ref), value },
    describe: (state) => `machine ${ctx.id}: ${names.length} part${names.length === 1 ? '' : 's'} (${names.join(', ')}); view ${state.view}${state.explode ? `, exploded ${state.explode}` : ''}, camera ${state.camera}${state.highlight.length ? `, highlight ${state.highlight.join(', ')}` : ''}${results.length ? `; checks: ${results.map((r) => `"${r.name}" worst ${r.worst.toPrecision(2)} of ${r.limit.toPrecision(2)} over ${r.samples} samples (${r.ok ? 'holds' : 'FAILS'})`).join('; ')}` : ''}`,
  }
}
