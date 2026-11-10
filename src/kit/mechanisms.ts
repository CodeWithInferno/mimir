// Mechanisms (pure side): every function here does the trigonometry of one closed linkage so a scene never has to.
// A mechanism (1) records a placement relation on the parts it positions, (2) turns the parts it drives about their
// own axis, (3) exposes probes for `check` and `shot`, and (4) declares invariants that the MECH-OPEN rule measures
// on the real world transforms (./check.ts), so a linkage that does not close is reported, not just drawn.
//
// The plane of a mechanism is the x-y plane of its driving part (crank, first gear, cam, first pulley), and that part
// turns about its own z axis: rotate or attach the driving part and the whole mechanism follows. Directions ('up',
// 'left', degrees counter-clockwise from 'right') are in that plane. All angles are degrees, counter-clockwise positive
// seen from the front (+z).
import {
  add, callSite, closest, ctx, currentModel, DEG, defineFinalize, definePlacement, defineSetter, dist, isNode, kindOf, mul, parseDir, qAxisDeg, qconj, qmul, qrot, reportProblems, sub, toVec3, validateOptions,
  type Frame, type Handle, type MNode, type OwnTransform, type Patch, type Placed, type Quat, type SceneModel, type Schema, type Src, type TRS, type Vec3,
} from '../core/index.ts'
import { camLift, centerDistance, fourStroke as strokeAt, meshAngle, planetary as willis, planetaryPose, rackMesh, sliderCrank, valveLift as liftAt, type SliderCrankState, type StrokeName } from '../lib/kinematics.ts'
import { beltKind, camShape, lobesOf, turning, wheelRadius, type CamShape } from './parts.ts'

const Z: Vec3 = [0, 0, 1]
const rz = (deg: number): Quat => qAxisDeg(Z, deg)
const wrap = (x: number, m: number): number => ((x % m) + m) % m
/** distance of x from the nearest whole number */
const offWhole = (x: number): number => Math.abs(x - Math.round(x))
const round = (x: number, n = 3): number => Math.round(x * 10 ** n) / 10 ** n + 0

// ── the record of what was declared ──────────────────────────────────────────────────────────────────
/** Something that must hold at every time and every slider position for the mechanism to be closed. */
export interface Invariant {
  name: string
  /** how far off it is in this frame (0 = holds); read from the world transforms, not from the formula that placed the parts */
  measure(frame: Frame): number
  limit: number
  /** the sentence of the diagnostic, given the measured value */
  what(measured: number): string
  fix: string[]
}
export interface Mechanism { id: string; type: string; src: Src; parts: MNode[]; invariants: Invariant[]; probes: string[] }
type AngleFn = (frame: Frame) => number
interface Store { list: Mechanism[]; spin: Map<number, AngleFn>; driver: Map<number, string>; counts: Record<string, number> }
const storeOf = (model: SceneModel): Store => model.store<Store>('kit', () => ({ list: [], spin: new Map(), driver: new Map(), counts: {} }))
/** Every mechanism a scene declared, in order (for the MECH-OPEN rule, tests and tools). */
export const mechanismsOf = (model: SceneModel): readonly Mechanism[] => storeOf(model).list

function newMechanism(model: SceneModel, type: string, id: unknown, parts: (MNode | null | undefined)[]): Mechanism {
  const st = storeOf(model)
  let name = typeof id === 'string' && id ? id : ''
  if (!name) { const n = (st.counts[type] = (st.counts[type] ?? 0) + 1); name = `${type}${n}` }
  if (st.list.some((m) => m.id === name)) { model.diagnostics.add({ code: 'ID-DUP', ids: [name], what: `two mechanisms are both called "${name}".`, fix: [`give this one another id: ${type}({ …, id: '${name}B' })`] }); name = `${name}-${st.list.length + 1}` }
  const m: Mechanism = { id: name, type, src: callSite(), parts: parts.filter(isNode), invariants: [], probes: [] }
  st.list.push(m)
  return m
}
/** a value that follows the state being evaluated: call it inside dynamic options, probes and readouts */
function signal<T>(model: SceneModel, fn: (frame: Frame) => T, fallback: T): () => T {
  const sig = (): T => { const f = model.now(); return f.memo(sig, () => fn(f), fallback) }
  return sig
}
function probe(model: SceneModel, mech: Mechanism, name: string, fn: () => number): void {
  model.probes.set(`${mech.id}.${name}`, fn)
  mech.probes.push(`${mech.id}.${name}`)
}
const num = (frame: Frame, v: unknown, fallback: number, what: string): number => { const x = frame.value<unknown>(v, fallback, null, what); return typeof x === 'number' && Number.isFinite(x) ? x : fallback }

// ── directions in the plane of a mechanism ───────────────────────────────────────────────────────────
const WORDS: Record<string, number> = { right: 0, up: 90, left: 180, down: 270, above: 90, below: 270, top: 90, bottom: 270 }
const SIDES = ['right', 'up', 'left', 'down'] as const
/** 'up' | 'down' | 'left' | 'right' or degrees counter-clockwise from 'right' (a value or a function) → degrees per frame */
function direction(model: SceneModel, call: string, name: string, v: unknown, fallback: number): AngleFn {
  const word = (w: string): number | null => {
    const d = WORDS[w.toLowerCase()]
    if (d !== undefined) return d
    const near = closest(w, SIDES)
    model.diagnostics.add({ code: 'API-UNKNOWN', what: `${call}: ${name} has no value "${w}".`, fix: [near ? `use '${near}'` : `use 'up', 'down', 'left' or 'right', or degrees counter-clockwise from 'right' (${name}: 90 is up)`] })
    return null
  }
  if (v === undefined || v === null) return () => fallback
  if (typeof v === 'string') { const d = word(v) ?? fallback; return () => d }
  if (typeof v === 'number' && Number.isFinite(v)) return () => v
  if (typeof v === 'function') return (frame) => { const x = frame.value<unknown>(v, fallback, null, `${call} ${name}`); return typeof x === 'string' ? WORDS[x.toLowerCase()] ?? fallback : typeof x === 'number' && Number.isFinite(x) ? x : fallback }
  model.diagnostics.add({ code: 'API-TYPE', what: `${call}: ${name} expects 'up', 'down', 'left', 'right' or degrees, got ${typeof v}.`, fix: [`${name}: 'up'`] })
  return () => fallback
}
/** the side a direction points at most */
const sideOf = (deg: number): (typeof SIDES)[number] => SIDES[wrap(Math.round(deg / 90), 4)]!
const OPPOSITE_ANCHOR: Record<string, string> = { right: 'left', left: 'right', up: 'bottom', down: 'top' }
const unit = (deg: number): Vec3 => [Math.cos(deg * DEG), Math.sin(deg * DEG), 0]

// ── turning parts ────────────────────────────────────────────────────────────────────────────────────
/** the rotate entry a mechanism adds: about the part's own z, applied before any rotate() the scene gives the part */
const spinAxis = (): Vec3 => [0, 0, 1]
/**
 * Angle of a part about its own z axis, in degrees: what a mechanism turns it by, else its own rotate({ about: 'z' }),
 * plus the angle of what it is attached to (a gear attached to a turning shaft turns with it).
 */
export function angleOf(node: MNode, frame: Frame): number {
  const fn = storeOf(node.model).spin.get(node.uid)
  if (fn) return fn(frame)
  let own = 0
  const list = frame.prop<unknown>(node, 'rotate')
  if (Array.isArray(list)) for (const e of list as { about: unknown; deg: unknown }[]) if (e.about === 'z') own += num(frame, e.deg, 0, 'rotate.deg')
  const pl = node.placement
  return pl?.type === 'attach' && isNode(pl.target) ? own + angleOf(pl.target, frame) : own
}
/** The frame of a turning part with its turning taken out: the plane its mechanism lies in. */
export function planeOf(node: MNode, frame: Frame): TRS {
  const w = frame.world(node)
  return { p: w.p, q: qmul(w.q, rz(-angleOf(node, frame))), s: w.s }
}
turning.base = planeOf
turning.angle = angleOf

/** Turn `node` about its own z axis by fn(frame) degrees. Returns false (and reports) when another mechanism already turns it. */
function drive(node: MNode, mech: Mechanism, fn: AngleFn, viaRotate: boolean): boolean {
  const model = node.model, st = storeOf(model)
  const by = st.driver.get(node.uid)
  if (by) {
    model.diagnostics.add({ code: 'PLACE-CONFLICT', ids: [node.id], what: `#${node.id} is already turned by ${by}; ${mech.id} cannot turn it as well.`, fix: [`leave the angle out of ${mech.type}(): #${node.id} then turns as ${by} says`, `or give ${mech.type}() another part`] }, mech.src)
    return false
  }
  st.driver.set(node.uid, mech.id)
  const key = {}
  st.spin.set(node.uid, (frame) => frame.memo(key, () => fn(frame), 0))
  if (viaRotate) {
    const list = Array.isArray(node.props.rotate) ? (node.props.rotate as unknown[]) : []
    node.props.rotate = [{ about: spinAxis(), deg: () => st.spin.get(node.uid)!(model.now()) }, ...list]
  }
  model.revision++
  return true
}

// ── placing parts ────────────────────────────────────────────────────────────────────────────────────
type MateFn = (node: MNode, frame: Frame, own: OwnTransform) => Placed
definePlacement('kit.mate', (node, pl, frame, own) => (pl.resolve as MateFn)(node, frame, own))
/** Give `node` the placement a mechanism computes. A placement the scene gave it before is reported and replaced. */
function mate(node: MNode, mech: Mechanism, resolve: MateFn): boolean {
  const model = node.model, prev = node.placement
  if (prev?.type === 'kit.mate') {
    model.diagnostics.add({ code: 'PLACE-CONFLICT', ids: [node.id], what: `#${node.id} is already placed by ${String(prev.mechanism)}; ${mech.id} cannot place it as well.`, fix: [`give ${mech.type}() another part, or remove ${String(prev.mechanism)}`] }, mech.src)
    return false
  }
  if (prev) model.diagnostics.add({ code: 'PLACE-CONFLICT', ids: [node.id], what: `#${node.id} already has a placement (${prev.type}); ${mech.type}() decides where it goes and replaces it.`, fix: [`remove the .${prev.type === 'at' ? 'at' : prev.type}(…) of #${node.id}`] }, mech.src)
  // `parts` names what the mechanism joins: a placement that names another part is a declared fit (a pin in its bore is
  // not a collision for `check`)
  node.placement = { type: 'kit.mate', mechanism: mech.id, resolve, parts: mech.parts }
  model.revision++
  return true
}
/** world scale of a part without asking for its world transform (which may depend on the part being placed) */
const scaleOf = (node: MNode, frame: Frame): number => (node.parent ? frame.world(node.parent).s : 1) * frame.ownScale(node)
const hasAnchor = (node: MNode, name: string): boolean => node.model.now().anchorLocal(node, name) !== null

// ── mechanisms declared by part NAMES ────────────────────────────────────────────────────────────────
/**
 * A mechanism whose parts were given as names that no object has yet: crankSlider({ crank: 'crank', … }) inside the
 * joints of machine(), written before the scene is built. Whoever owns those names resolves them to parts and calls
 * make() with the same arguments, names replaced. A spec that nobody makes is reported when the scene is finalized,
 * as the missing reference it is.
 */
export interface MechanismSpec { readonly isMechanismSpec: true; readonly type: string; readonly args: readonly unknown[]; /** where the parts are: an argument index, or an option name of the options object */ readonly slots: readonly (string | number)[]; readonly src: Src; made: boolean; make(...args: unknown[]): unknown }
export const isMechanismSpec = (v: unknown): v is MechanismSpec => typeof v === 'object' && v !== null && (v as MechanismSpec).isMechanismSpec === true
const pendingOf = (model: SceneModel): MechanismSpec[] => model.store<MechanismSpec[]>('kit.named', () => [])
/**
 * The spec to return instead of building: when the call is made before any scene builder runs (the stage of explain()
 * is declared at the top of the module) and a part slot holds a name that is not an object. Inside a builder nothing
 * changes: a name no object has is reported there and then.
 */
function named(type: string, fn: (...args: any[]) => unknown, args: unknown[], slots: readonly (string | number)[]): MechanismSpec | null {
  if (ctx.building) return null
  const model = currentModel()
  const o = args.find((a) => typeof a === 'object' && a !== null && !isNode(a) && !Array.isArray(a)) as Record<string, unknown> | undefined
  const values = slots.flatMap((k) => { const v = typeof k === 'number' ? args[k] : o?.[k]; return Array.isArray(v) ? v : [v] })
  if (!values.some((v) => typeof v === 'string' && !model.byId.has(v))) return null
  const spec: MechanismSpec = { isMechanismSpec: true, type, args, slots, src: callSite(), made: false, make: (...real) => { spec.made = true; return fn(...real) } }
  pendingOf(model).push(spec)
  return spec
}
defineFinalize('kit.named', (model) => {
  for (const spec of pendingOf(model)) if (!spec.made) model.diagnostics.add({ code: 'REF-MISSING', what: `${spec.type}() was given part names, and no object of the scene has them.`, fix: ['pass the parts themselves', `or list it in the joints of machine({ parts, joints: [${spec.type}({ … })] }), which owns the names`] }, spec.src)
})

// ── argument checking ────────────────────────────────────────────────────────────────────────────────
const PART = { type: 'node' as const, dynamic: false }
function options(call: string, opts: unknown, schema: Schema, aliases: Record<string, string>, example: string): { model: SceneModel; o: Record<string, unknown> } {
  const model = currentModel()
  if (opts === undefined || opts === null || typeof opts !== 'object' || isNode(opts)) {
    model.diagnostics.add({ code: 'API-TYPE', what: `${call} takes one options object.`, fix: [example] })
    return { model, o: {} }
  }
  const v = validateOptions(call, opts, { id: { type: 'string', dynamic: false }, ...schema }, aliases, model)
  reportProblems(model, v.problems, [])
  return { model, o: v.props }
}
function need(model: SceneModel, call: string, o: Record<string, unknown>, names: string[], example: string): boolean {
  const missing = names.filter((n) => !isNode(o[n]))
  if (!missing.length) return true
  model.diagnostics.add({ code: 'API-TYPE', what: `${call} needs ${missing.join(' and ')} (${missing.length === 1 ? 'a part' : 'parts'} created earlier in the scene).`, fix: [example] })
  return false
}
interface GearInfo { teeth: number; module: number; internal: boolean }
const isGear = (node: MNode): boolean => { const k = kindOf(node.kind); return !!k && 'teeth' in k.schema && 'module' in k.schema }
const gearOf = (node: MNode, frame: Frame): GearInfo => ({ teeth: Math.max(3, Math.round(frame.prop<number>(node, 'teeth'))), module: frame.prop<number>(node, 'module') * scaleOf(node, frame), internal: frame.prop<unknown>(node, 'internal') === true })
function needGears(model: SceneModel, call: string, gears: MNode[], example: string): boolean {
  const bad = gears.filter((g) => !isGear(g))
  if (!bad.length) return true
  model.diagnostics.add({ code: 'API-TYPE', ids: bad.map((g) => g.id), what: `${call}: ${bad.map((g) => `#${g.id} (${g.kind})`).join(' and ')} ${bad.length === 1 ? 'is not a gear' : 'are not gears'}: a part with teeth and a module is needed.`, fix: [example] })
  return false
}
/** How far two gears are from meshing at the point where they touch, as a share of one tooth pitch (0 = a tooth faces a gap exactly). */
function meshError(a: MNode, b: MNode, frame: Frame): number {
  const plane = planeOf(a, frame), ga = gearOf(a, frame), gb = gearOf(b, frame)
  const local = (p: Vec3): Vec3 => qrot(qconj(plane.q), p)
  const turned = (n: MNode): number => { const x = local(qrot(frame.world(n).q, [1, 0, 0])); return Math.atan2(x[1], x[0]) / DEG }
  const rel = local(sub(frame.world(b).p, plane.p))
  const internal = ga.internal !== gb.internal
  // direction from a to the point of contact: toward b, or away from the ring's centre when a is the pinion inside it
  const toward = Math.atan2(rel[1], rel[0]) / DEG + (internal && gb.internal ? 180 : 0)
  const phaseA = ((toward - turned(a)) * ga.teeth) / 360, phaseB = ((toward + (internal ? 0 : 180) - turned(b)) * gb.teeth) / 360
  return offWhole((internal ? phaseA - phaseB : phaseA + phaseB) - 0.5)
}
const meshInvariant = (a: MNode, b: MNode): Invariant => ({
  name: `${a.id} meshes ${b.id}`, limit: 0.02, measure: (frame) => meshError(a, b, frame),
  what: (m) => `the teeth of #${a.id} and #${b.id} are ${round(m * 100, 1)}% of a tooth pitch away from meshing (a tooth must face a gap where they touch).`,
  fix: [`let the mechanism turn both gears: do not rotate #${b.id} yourself`, `give both gears the same module`],
})
const moduleInvariant = (a: MNode, b: MNode): Invariant => ({
  name: `${a.id} and ${b.id} have one module`, limit: 1e-6, measure: (frame) => { const ma = gearOf(a, frame).module, mb = gearOf(b, frame).module; return Math.abs(ma - mb) / Math.max(ma, mb, 1e-12) },
  what: () => { const f = a.model.now(); return `#${a.id} has module ${round(gearOf(a, f).module)} and #${b.id} has module ${round(gearOf(b, f).module)}: gears mesh only when their teeth are the same size.` },
  fix: [`give #${b.id} the module of #${a.id}`],
})

// ── crankSlider ──────────────────────────────────────────────────────────────────────────────────────
/** What crankSlider returns. Lengths are world units; every member follows the state being evaluated. */
export interface CrankSlider {
  readonly id: string
  /** distance between top and bottom dead centre */
  readonly stroke: number
  /** distance of the slider's pin from the crank axis at top dead centre */
  readonly tdc: number
  /** the same at bottom dead centre */
  readonly bdc: number
  /** distance of the slider's pin from the crank axis, along the slide axis */
  position(): number
  /** how far the slider has come down from top dead centre: 0 … stroke */
  travel(): number
  /** travel as a share of the stroke: 0 at top dead centre, 1 at bottom dead centre */
  fraction(): number
  /** crank angle from top dead centre, degrees */
  angle(): number
  /** tilt of the rod from the slide axis, degrees */
  rodAngle(): number
}
const CRANK_SLIDER: Schema = { crank: PART, rod: PART, slider: PART, axis: { type: 'any', example: "axis: 'up'" }, angle: { type: 'number', example: 'angle: crank' }, rodLength: { type: 'positive', example: 'rodLength: 3.25' }, offset: { type: 'number', default: 0 } }
const CRANK_SLIDER_EX = 'crankSlider({ crank, rod, slider: piston, angle: crankAngle })'
/**
 * crankSlider({ crank, rod, slider, axis = 'up', angle }): a crank that drives a slider through a rod.
 * The crank turns about its own z axis so that its `pin` anchor points along `axis` at angle 0 (top dead centre); the
 * slider's `pin` anchor (or its centre) moves along the axis through the crank's centre; the rod spans the two pins.
 * Throw and rod length are read from the parts (the crank's `pin` anchor, the rod's `bigEnd` / `smallEnd` or
 * `bottom` / `top` anchors), so the numbers shown are the numbers drawn.
 */
export function crankSlider(opts: unknown): CrankSlider {
  const later = named('crankSlider', crankSlider, [opts], ['crank', 'rod', 'slider']); if (later) return later as unknown as CrankSlider
  const call = 'crankSlider()'
  const { model, o } = options(call, opts, CRANK_SLIDER, { piston: 'slider', crankshaft: 'crank', conRod: 'rod', direction: 'axis', along: 'axis', length: 'rodLength' }, CRANK_SLIDER_EX)
  const crank = o.crank as MNode | undefined, slider = o.slider as MNode | undefined, rod = o.rod as MNode | undefined
  const mech = newMechanism(model, 'crankSlider', o.id, [crank, rod, slider])
  let ok = need(model, call, o, ['crank', 'slider'], CRANK_SLIDER_EX)
  if (ok && !hasAnchor(crank!, 'pin')) {
    model.diagnostics.add({ code: 'API-TYPE', ids: [crank!.id], what: `${call}: #${crank!.id} (${crank!.kind}) has no anchor "pin", so there is nothing for the rod to hold.`, fix: ['use kit.crankshaft({ throw: 1 }) as the crank', `or say where the pin is: ${crank!.id}.define('pin', [0, 1, 0])  (a point in the part's own x-y plane; it turns about its z axis)`] })
    ok = false
  }
  if (ok && !rod && o.rodLength === undefined) {
    model.diagnostics.add({ code: 'API-TYPE', what: `${call} needs a rod (a part) or rodLength (a number).`, fix: [CRANK_SLIDER_EX, 'or crankSlider({ crank, slider, rodLength: 3.25, angle })'] })
    ok = false
  }
  const state = (frame: Frame): SliderCrankState | null => (ok ? solve(frame).k : null)
  const result: CrankSlider = {
    id: mech.id,
    get stroke() { return state(model.now())?.stroke ?? 0 },
    get tdc() { return state(model.now())?.tdc ?? 0 },
    get bdc() { return state(model.now())?.bdc ?? 0 },
    position: signal(model, (f) => state(f)?.position ?? 0, 0),
    travel: signal(model, (f) => { const k = state(f); return k ? k.tdc - k.position : 0 }, 0),
    fraction: signal(model, (f) => state(f)?.fraction ?? 0, 0),
    angle: signal(model, (f) => (ok ? solve(f).angle : 0), 0),
    rodAngle: signal(model, (f) => state(f)?.rodAngle ?? 0, 0),
  }
  if (!ok) return result

  const axis = direction(model, call, 'axis', o.axis, 90)
  const rodEnds: [string, string] = rod && hasAnchor(rod, 'bigEnd') && hasAnchor(rod, 'smallEnd') ? ['bigEnd', 'smallEnd'] : ['bottom', 'top']
  const sliderAnchor = hasAnchor(slider!, 'pin') ? 'pin' : 'center'
  const pinLocal = (frame: Frame): Vec3 => frame.anchorLocal(crank!, 'pin') ?? [0, 1, 0]
  /** direction of the pin in the crank's own plane at angle 0, degrees from +x */
  const pinAt = (frame: Frame): number => { const p = pinLocal(frame); return Math.atan2(p[1], p[0]) / DEG }
  if (o.angle !== undefined) drive(crank!, mech, (frame) => axis(frame) - pinAt(frame) + num(frame, o.angle, 0, `${call} angle`), true)
  const rodLength = (frame: Frame): number => {
    if (!rod) return num(frame, o.rodLength, 1, `${call} rodLength`)
    const a = frame.anchorLocal(rod, rodEnds[0]) ?? [0, 0, 0], b = frame.anchorLocal(rod, rodEnds[1]) ?? [0, 1, 0]
    return dist(a, b) * scaleOf(rod, frame)
  }
  interface Solved { plane: TRS; dir: number; angle: number; k: SliderCrankState; /** world point the slider's pin sits on */ pin: Vec3; rod: number }
  function solve(frame: Frame): Solved {
    return frame.memo(mech, () => {
      const plane = planeOf(crank!, frame), dir = axis(frame), local = pinLocal(frame)
      const angle = angleOf(crank!, frame) + pinAt(frame) - dir
      const length = rodLength(frame)
      const k = sliderCrank({ throw: Math.hypot(local[0], local[1]) * plane.s, rod: length, angle, offset: num(frame, o.offset, 0, `${call} offset`) })
      const d = unit(dir), side = unit(dir + 90), off = num(frame, o.offset, 0, `${call} offset`)
      const pin = add(plane.p, qrot(plane.q, [d[0] * k.position + side[0] * off, d[1] * k.position + side[1] * off, local[2] * plane.s]))
      return { plane, dir, angle, k, pin, rod: length }
    }, { plane: { p: [0, 0, 0], q: [0, 0, 0, 1], s: 1 }, dir: 90, angle: 0, k: sliderCrank({ throw: 1, rod: 3, angle: 0 }), pin: [0, 0, 0], rod: 3 } as Solved)
  }
  // the slider: its pin on the slide axis, its own "up" along the axis
  mate(slider!, mech, (node, frame, own) => {
    const s = solve(frame), q = qmul(qmul(s.plane.q, rz(s.dir - 90)), own.q)
    return { p: sub(s.pin, qrot(q, mul(frame.anchorLocal(node, sliderAnchor) ?? [0, 0, 0], own.parentS * own.s))), q, world: true }
  })
  // the rod: its first end on the crank pin, pointing at the slider's pin, lying in the crank's plane
  if (rod) mate(rod, mech, (node, frame, own) => {
    const s = solve(frame), from = frame.anchor(crank!, 'pin')
    const a = frame.anchorLocal(node, rodEnds[0]) ?? [0, 0, 0], b = frame.anchorLocal(node, rodEnds[1]) ?? [0, 1, 0]
    const want = qrot(qconj(s.plane.q), sub(s.pin, from))
    const q = qmul(s.plane.q, rz((Math.atan2(want[1], want[0]) - Math.atan2(b[1] - a[1], b[0] - a[0])) / DEG))
    return { p: sub(from, qrot(q, mul(a, own.parentS * own.s))), q, world: true }
  })

  const names = `#${crank!.id}${rod ? `, #${rod.id}` : ''} and #${slider!.id}`
  mech.invariants.push({
    name: 'the rod is long enough', limit: 1e-9, measure: (frame) => { const s = solve(frame), pin = pinLocal(frame); return Math.max(0, Math.hypot(pin[0], pin[1]) * s.plane.s + Math.abs(num(frame, o.offset, 0, 'offset')) - s.rod) },
    what: (m) => `the rod of ${mech.id} is ${round(m)} too short to reach round the crank (it must be longer than the throw${o.offset ? ' plus the offset' : ''}), so the crank cannot turn all the way.`,
    fix: [rod ? `make #${rod.id} longer: a real engine has a rod about 3.2 times the throw` : 'make rodLength larger: about 3.2 times the throw', `or make the throw of #${crank!.id} smaller`],
  }, {
    name: 'the linkage closes', limit: 1e-6, measure: (frame) => { const s = solve(frame); return Math.abs(dist(frame.anchor(crank!, 'pin'), frame.anchor(slider!, sliderAnchor)) - s.rod) / Math.max(s.rod, 1e-12) },
    what: (m) => `${mech.id} does not close: the distance from the crank pin to the pin of #${slider!.id} is off the rod length by ${round(m * 100, 2)}%.`,
    fix: [`let crankSlider() place ${names}: remove their own .at() / .rotate() about z`, 'or make the rod longer than the throw'],
  })
  if (rod) mech.invariants.push({
    name: 'the rod is on its pins', limit: 1e-6,
    measure: (frame) => { const s = solve(frame); return Math.max(dist(frame.anchor(rod, rodEnds[0]), frame.anchor(crank!, 'pin')), dist(frame.anchor(rod, rodEnds[1]), frame.anchor(slider!, sliderAnchor))) / Math.max(s.rod, 1e-12) },
    what: (m) => `#${rod.id} has left its pins by ${round(m * 100, 2)}% of its length.`,
    fix: [`let crankSlider() place #${rod.id}: remove its own placement`, `or make #${rod.id} longer than the throw of #${crank!.id}`],
  })
  probe(model, mech, 'position', result.position)
  probe(model, mech, 'travel', result.travel)
  probe(model, mech, 'fraction', result.fraction)
  return result
}

// ── gears ────────────────────────────────────────────────────────────────────────────────────────────
/** What gearPair returns. */
export interface GearPair {
  readonly id: string
  /** teeth of b / teeth of a: turns of a for one turn of b */
  readonly ratio: number
  /** distance between the two centres, world units */
  readonly distance: number
  /** angle of the first gear, degrees */
  angle(): number
  /** angle of the second gear, degrees */
  driven(): number
}
const GEAR_PAIR: Schema = { angle: { type: 'number', example: 'angle: turn' }, direction: { type: 'any', example: "direction: 'right'" } }
const GEAR_PAIR_EX = "gearPair(a, b, { angle: turn, direction: 'right' })"
/**
 * gearPair(a, b, { angle, direction = 'right' }): put gear b beside gear a at the meshing distance, in a's plane, and
 * turn it so the teeth interleave. `angle` turns a (leave it out when a is already turned by something else, such as
 * an earlier gearPair). `direction` is where b sits as seen from a. One of the two may be a ring gear
 * (kit.gear({ internal: true })): the other then runs inside it.
 */
export function gearPair(a: unknown, b: unknown, opts?: unknown): GearPair {
  const later = named('gearPair', gearPair, [a, b, opts], [0, 1]); if (later) return later as unknown as GearPair
  const call = 'gearPair()'
  const model = currentModel()
  const ga = model.resolveNode(a, call, 'a'), gb = model.resolveNode(b, call, 'b')
  const v = validateOptions(call, opts, { id: { type: 'string', dynamic: false }, ...GEAR_PAIR }, { dir: 'direction', side: 'direction' }, model)
  reportProblems(model, v.problems, [])
  const o = v.props
  const mech = newMechanism(model, 'gearPair', o.id, [ga, gb])
  let ok = !!ga && !!gb && needGears(model, call, [ga, gb], GEAR_PAIR_EX)
  if (ok && ga === gb) { model.diagnostics.add({ code: 'API-TYPE', ids: [ga!.id], what: `${call}: both gears are #${ga!.id}.`, fix: ['pass two different gears'] }); ok = false }
  if (ok && ga!.props.internal === true && gb!.props.internal === true) { model.diagnostics.add({ code: 'API-TYPE', ids: [ga!.id, gb!.id], what: `${call}: #${ga!.id} and #${gb!.id} are both ring gears; two rings cannot mesh.`, fix: ['make one of them an ordinary gear: remove internal: true'] }); ok = false }
  const dir = direction(model, call, 'direction', o.direction, 0)
  const info = (frame: Frame): { za: number; zb: number; internal: boolean; ringIsB: boolean; distance: number } => {
    const x = gearOf(ga!, frame), y = gearOf(gb!, frame), internal = x.internal !== y.internal
    return { za: x.teeth, zb: y.teeth, internal, ringIsB: y.internal, distance: centerDistance(x.teeth, y.teeth, x.module, { internal }) }
  }
  /** angle of b for the angle of a, with the half-tooth phase that interleaves the teeth */
  const drivenAngle = (frame: Frame): number => {
    const i = info(frame), d = dir(frame), turn = angleOf(ga!, frame)
    if (!i.internal) return meshAngle(turn, i.za, i.zb, { direction: d })
    if (i.ringIsB) return meshAngle(turn, i.za, i.zb, { internal: true, direction: d })
    // a is the ring: the same relation solved for the pinion
    return d + ((turn - d - 180 / i.za) * i.za) / i.zb
  }
  const result: GearPair = {
    id: mech.id,
    get ratio() { if (!ok) return 1; const i = info(model.now()); return i.zb / i.za },
    get distance() { return ok ? info(model.now()).distance : 0 },
    angle: signal(model, (f) => (ok ? angleOf(ga!, f) : 0), 0),
    driven: signal(model, (f) => (ok ? angleOf(gb!, f) : 0), 0),
  }
  if (!ok) return result
  if (o.angle !== undefined) drive(ga!, mech, (frame) => num(frame, o.angle, 0, `${call} angle`), true)
  if (!drive(gb!, mech, drivenAngle, false)) return result
  mate(gb!, mech, (_node, frame) => {
    const plane = planeOf(ga!, frame), i = info(frame), d = unit(dir(frame))
    // an ordinary pair: b sits toward the contact. A pinion a inside a ring b: the ring's centre is on the other side.
    const k = i.internal && i.ringIsB ? -i.distance : i.distance
    return { p: add(plane.p, qrot(plane.q, [d[0] * k, d[1] * k, 0])), q: qmul(plane.q, rz(drivenAngle(frame))), world: true }
  })
  mech.invariants.push(moduleInvariant(ga!, gb!), {
    name: 'centre distance', limit: 1e-6, measure: (frame) => { const i = info(frame); return Math.abs(dist(frame.world(ga!).p, frame.world(gb!).p) - i.distance) / Math.max(i.distance, 1e-12) },
    what: (m) => `#${ga!.id} and #${gb!.id} are ${round(m * 100, 2)}% off their meshing distance (the sum of their pitch radii).`,
    fix: [`let gearPair() place #${gb!.id}: remove its own .at()`],
  }, meshInvariant(ga!, gb!))
  probe(model, mech, 'ratio', () => result.ratio)
  probe(model, mech, 'driven', result.driven)
  return result
}

/** What gearTrain returns. */
export interface GearTrain {
  readonly id: string
  /** teeth of the last gear / teeth of the first: turns of the first for one turn of the last */
  readonly ratio: number
  /** one gearPair per neighbouring pair */
  readonly pairs: GearPair[]
  /** angle of gear i (0-based), degrees */
  angle(i: number): number
  /** how far gear i has turned since the first gear was at angle 0, degrees (negative = the other way round) */
  turned(i: number): number
}
/**
 * gearTrain([a, b, c, …], { angle, direction = 'right' }): a row of meshing gears. `angle` turns the first; each
 * next gear sits beside the one before it (`direction` for all, or one direction per pair in a list).
 */
export function gearTrain(gears: unknown, opts?: unknown): GearTrain {
  const later = named('gearTrain', gearTrain, [gears, opts], [0]); if (later) return later as unknown as GearTrain
  const call = 'gearTrain()'
  const model = currentModel()
  const v = validateOptions(call, opts, { id: { type: 'string', dynamic: false }, angle: GEAR_PAIR.angle!, direction: { type: 'any', example: "direction: ['right', 'up']" } }, { dir: 'direction', directions: 'direction' }, model)
  reportProblems(model, v.problems, [])
  const list = Array.isArray(gears) ? gears.map((g, i) => model.resolveNode(g, call, `gears[${i}]`)).filter(isNode) : []
  if (!Array.isArray(gears) || list.length < 2) model.diagnostics.add({ code: 'API-TYPE', what: `${call} needs a list of at least two gears${Array.isArray(gears) ? `, got ${list.length}` : ''}.`, fix: ['gearTrain([a, b, c], { angle: turn })'] })
  const st = storeOf(model)
  let id = typeof v.props.id === 'string' && v.props.id ? v.props.id : ''
  if (!id) { const n = (st.counts.gearTrain = (st.counts.gearTrain ?? 0) + 1); id = `gearTrain${n}` }
  const dirs = v.props.direction
  const pairs: GearPair[] = []
  for (let i = 0; i + 1 < list.length; i++) pairs.push(gearPair(list[i], list[i + 1], { id: `${id}.${i + 1}`, direction: Array.isArray(dirs) ? dirs[i] ?? dirs[dirs.length - 1] : dirs, ...(i === 0 && v.props.angle !== undefined ? { angle: v.props.angle } : {}) }))
  const index = (i: number): number => Math.max(0, Math.min(list.length - 1, Math.round(Number(i)) || 0))
  const angle = (i: number): number => { const g = list[index(i)]; return g ? angleOf(g, model.now()) : 0 }
  // each mesh reverses the turning, except a gear running inside a ring
  const turned = (i: number): number => {
    const f = model.now()
    let a = list[0] ? angleOf(list[0], f) : 0
    for (let k = 0; k < index(i); k++) { const x = gearOf(list[k]!, f), y = gearOf(list[k + 1]!, f); a *= ((x.internal !== y.internal ? 1 : -1) * x.teeth) / y.teeth }
    return a
  }
  return { id, pairs, get ratio() { return pairs.reduce((r, p) => r * p.ratio, 1) }, angle, turned }
}

// ── rack and pinion ──────────────────────────────────────────────────────────────────────────────────
/** What rackPinion returns. */
export interface RackPinion {
  readonly id: string
  /** how far the rack has moved from where it is at angle 0, world units (positive = the way the pinion's teeth push it) */
  travel(): number
}
const RACK_PINION: Schema = { rack: PART, pinion: PART, angle: { type: 'number', example: 'angle: turn' }, side: { type: 'any', example: "side: 'below'" } }
const RACK_PINION_EX = "rackPinion({ rack, pinion, angle: turn, side: 'below' })"
/**
 * rackPinion({ rack, pinion, angle, side = 'below' }): lay the rack against the pinion (below, above, left or right of
 * it, teeth toward it) and slide it as the pinion turns: travel = angle × pitch radius.
 */
export function rackPinion(opts: unknown): RackPinion {
  const later = named('rackPinion', rackPinion, [opts], ['rack', 'pinion']); if (later) return later as unknown as RackPinion
  const call = 'rackPinion()'
  const { model, o } = options(call, opts, RACK_PINION, { gear: 'pinion', direction: 'side' }, RACK_PINION_EX)
  const rack = o.rack as MNode | undefined, pinion = o.pinion as MNode | undefined
  const mech = newMechanism(model, 'rackPinion', o.id, [rack, pinion])
  let ok = need(model, call, o, ['rack', 'pinion'], RACK_PINION_EX) && needGears(model, call, [rack!, pinion!], RACK_PINION_EX)
  if (ok && rack!.kind !== 'rack') { model.diagnostics.add({ code: 'API-TYPE', ids: [rack!.id], what: `${call}: rack is #${rack!.id}, a ${rack!.kind}; a kit.rack is needed.`, fix: ['rack: kit.rack({ teeth: 12, module: 0.25 })', 'two round gears mesh with gearPair(a, b)'] }); ok = false }
  const side = direction(model, call, 'side', o.side, 270)
  /** the rack's own frame is turned by this much from "below the pinion" */
  const turnOf = (frame: Frame): number => side(frame) - 270
  const travel = (frame: Frame): number => { const g = gearOf(pinion!, frame); return angleOf(pinion!, frame) * DEG * 0.5 * g.module * g.teeth }
  const result: RackPinion = { id: mech.id, travel: signal(model, (f) => (ok ? travel(f) : 0), 0) }
  if (!ok) return result
  if (o.angle !== undefined) drive(pinion!, mech, (frame) => num(frame, o.angle, 0, `${call} angle`), true)
  /** x of the rack's origin along its own length, measured from the point under the pinion's centre */
  const along = (frame: Frame): number => {
    const g = gearOf(pinion!, frame), pitch = Math.PI * g.module
    const teeth = Math.max(1, Math.round(frame.prop<number>(rack!, 'teeth')))
    // a tooth centre must be at rackMesh(angle); the rack's teeth are centred on its origin
    const first = -((teeth - 1) / 2) * pitch
    const phase = wrap(rackMesh(0, g.teeth, g.module) - turnOf(frame) * DEG * 0.5 * g.module * g.teeth - first + pitch / 2, pitch) - pitch / 2
    return phase + travel(frame)
  }
  mate(rack!, mech, (_node, frame) => {
    const plane = planeOf(pinion!, frame), g = gearOf(pinion!, frame), turn = rz(turnOf(frame))
    return { p: add(plane.p, qrot(qmul(plane.q, turn), [along(frame), -0.5 * g.module * g.teeth, 0])), q: qmul(plane.q, turn), world: true }
  })
  mech.invariants.push(moduleInvariant(pinion!, rack!), {
    name: 'the rack meshes the pinion', limit: 0.02,
    measure: (frame) => {
      const plane = planeOf(pinion!, frame), g = gearOf(pinion!, frame), pitch = Math.PI * g.module
      const q = qmul(plane.q, rz(turnOf(frame))), rel = qrot(qconj(q), sub(frame.world(rack!).p, plane.p))
      const x = qrot(qconj(q), qrot(frame.world(pinion!).q, [1, 0, 0]))
      const teeth = Math.max(1, Math.round(frame.prop<number>(rack!, 'teeth')))
      // a rack tooth centre nearest the contact, against the tooth space of the pinion that points down at it
      const rackPhase = (rel[0] - ((teeth - 1) / 2) * pitch) / pitch, pinionPhase = ((270 - Math.atan2(x[1], x[0]) / DEG) * g.teeth) / 360
      return Math.max(offWhole(pinionPhase + rackPhase - 0.5), Math.abs(rel[1] + 0.5 * g.module * g.teeth) / pitch)
    },
    what: (m) => `the teeth of #${rack!.id} and #${pinion!.id} are ${round(m * 100, 1)}% of a tooth pitch away from meshing.`,
    fix: [`let rackPinion() place #${rack!.id}: remove its own .at()`, `give both the same module`],
  })
  probe(model, mech, 'travel', result.travel)
  return result
}

// ── planetary gear set ───────────────────────────────────────────────────────────────────────────────
/** What planetary returns. */
export interface Planetary {
  readonly id: string
  /** turns of the input for one turn of the output with this member held */
  readonly ratio: number
  /** angles of the three members, degrees */
  sun(): number
  carrier(): number
  ring(): number
}
const PLANETARY: Schema = { sun: PART, planets: { type: 'nodes', example: 'planets: [p1, p2, p3]' }, ring: PART, carrier: PART, angle: { type: 'number', example: 'angle: turn' }, hold: { type: ['ring', 'carrier', 'sun'], default: 'ring', dynamic: false, example: "hold: 'ring'" } }
const PLANETARY_EX = "planetary({ sun, planets: [p1, p2, p3], ring, carrier, angle: turn, hold: 'ring' })"
/**
 * planetary({ sun, planets, ring, carrier, angle, hold = 'ring' }): a sun gear, planets evenly round it, a ring gear
 * outside them, and optionally the carrier that holds the planets. One member is held still: with 'ring' or 'carrier'
 * held `angle` turns the sun; with the sun held it turns the carrier. Every gear is placed and phased.
 */
export function planetary(opts: unknown): Planetary {
  const later = named('planetary', planetary, [opts], ['sun', 'planets', 'ring', 'carrier']); if (later) return later as unknown as Planetary
  const call = 'planetary()'
  const { model, o } = options(call, opts, PLANETARY, { planet: 'planets', fixed: 'hold', held: 'hold' }, PLANETARY_EX)
  const sun = o.sun as MNode | undefined, ring = o.ring as MNode | undefined, carrier = o.carrier as MNode | undefined
  const planets = (Array.isArray(o.planets) ? o.planets : []) as MNode[]
  const hold = (o.hold as string | undefined) ?? 'ring'
  const mech = newMechanism(model, 'planetary', o.id, [sun, ...planets, ring, carrier])
  let ok = need(model, call, o, ['sun'], PLANETARY_EX)
  if (ok && !planets.length) { model.diagnostics.add({ code: 'API-TYPE', what: `${call} needs planets: a list of gears.`, fix: [PLANETARY_EX] }); ok = false }
  ok = ok && needGears(model, call, [sun!, ...planets, ...(ring ? [ring] : [])], PLANETARY_EX)
  if (ok && ring && ring.props.internal !== true) { model.diagnostics.add({ code: 'API-TYPE', ids: [ring.id], what: `${call}: ring is #${ring.id}, an ordinary gear; the ring has its teeth on the inside.`, fix: ['ring: kit.gear({ teeth: 48, internal: true })'] }); ok = false }
  const teeth = (frame: Frame): { s: number; p: number; r: number; module: number } => { const s = gearOf(sun!, frame), p = gearOf(planets[0]!, frame); return { s: s.teeth, p: p.teeth, r: s.teeth + 2 * p.teeth, module: s.module } }
  /** the three member angles for the input angle, from the Willis equation */
  const members = (frame: Frame): { sun: number; carrier: number; ring: number } => frame.memo(mech, () => {
    const t = teeth(frame), input = num(frame, o.angle, 0, `${call} angle`)
    const w = hold === 'ring' ? willis({ sun: t.s, ring: t.r, sunSpeed: input, ringSpeed: 0 }) : hold === 'carrier' ? willis({ sun: t.s, ring: t.r, sunSpeed: input, carrierSpeed: 0 }) : willis({ sun: t.s, ring: t.r, sunSpeed: 0, carrierSpeed: input })
    return { sun: w?.sunSpeed ?? 0, carrier: w?.carrierSpeed ?? 0, ring: w?.ringSpeed ?? 0 }
  }, { sun: 0, carrier: 0, ring: 0 })
  const pose = (frame: Frame) => { const t = teeth(frame), m = members(frame); return planetaryPose({ sun: t.s, ring: t.r, planets: planets.length, sunAngle: m.sun, carrierAngle: m.carrier, module: t.module }) }
  const result: Planetary = {
    id: mech.id,
    get ratio() { if (!ok) return 1; const t = teeth(model.now()); return hold === 'ring' ? (t.s + t.r) / t.s : hold === 'carrier' ? -t.r / t.s : (t.s + t.r) / t.r },
    sun: signal(model, (f) => (ok ? members(f).sun : 0), 0), carrier: signal(model, (f) => (ok ? members(f).carrier : 0), 0), ring: signal(model, (f) => (ok ? members(f).ring : 0), 0),
  }
  if (!ok) return result
  {
    const f = model.now(), t = teeth(f), rt = ring ? gearOf(ring, f).teeth : t.r
    if (rt !== t.r) model.diagnostics.add({ code: 'NUM-INVALID', ids: [ring!.id], measured: rt, limit: t.r, what: `${call}: the ring #${ring!.id} has ${rt} teeth, but a sun of ${t.s} with planets of ${t.p} needs a ring of ${t.r} (sun + 2 × planet).`, fix: [`teeth: ${t.r} for #${ring!.id}`] })
    if (offWhole((t.s + t.r) / planets.length) > 1e-9) model.diagnostics.add({ code: 'NUM-INVALID', ids: planets.map((p) => p.id), measured: round((t.s + t.r) / planets.length), what: `${call}: ${planets.length} evenly spaced planets do not fit a sun of ${t.s} and a ring of ${t.r} teeth ((sun + ring) / planets must be a whole number, it is ${round((t.s + t.r) / planets.length)}).`, fix: [`use ${[2, 3, 4, 5, 6].filter((n) => offWhole((t.s + t.r) / n) < 1e-9).join(' or ') || 'another number of'} planets`, 'or change the tooth counts so that sun + ring divides by the number of planets'] })
  }
  drive(sun!, mech, (frame) => members(frame).sun, true)
  planets.forEach((planet, i) => {
    if (!drive(planet, mech, (frame) => pose(frame).planetAngles[i] ?? 0, false)) return
    mate(planet, mech, (_node, frame) => {
      const plane = planeOf(sun!, frame), c = pose(frame).planetCenters[i] ?? [0, 0]
      return { p: add(plane.p, qrot(plane.q, [c[0], c[1], 0])), q: qmul(plane.q, rz(pose(frame).planetAngles[i] ?? 0)), world: true }
    })
    mech.invariants.push(meshInvariant(sun!, planet))
    if (ring) mech.invariants.push(meshInvariant(planet, ring))
  })
  /** a member that shares the sun's axis and turns by its own angle */
  const coaxial = (node: MNode, angle: AngleFn): void => {
    if (!drive(node, mech, angle, false)) return
    mate(node, mech, (_n, frame) => { const plane = planeOf(sun!, frame); return { p: plane.p, q: qmul(plane.q, rz(angle(frame))), world: true } })
  }
  if (ring) coaxial(ring, (frame) => pose(frame).ringAngle)
  if (carrier) coaxial(carrier, (frame) => members(frame).carrier)
  mech.invariants.push(moduleInvariant(sun!, planets[0]!))
  probe(model, mech, 'sun', result.sun)
  probe(model, mech, 'carrier', result.carrier)
  probe(model, mech, 'ring', result.ring)
  return result
}

// ── cam and follower ─────────────────────────────────────────────────────────────────────────────────
/** What camFollower returns. */
export interface CamFollower {
  readonly id: string
  /** highest lift, world units */
  readonly maxLift: number
  /** how far the cam has pushed the follower along the axis right now, world units */
  lift(): number
  /** cam angle from the nose pointing at the follower, degrees */
  angle(): number
}
const CAM_FOLLOWER: Schema = { cam: PART, follower: PART, axis: { type: 'any', example: "axis: 'down'" }, angle: { type: 'number', example: 'angle: () => (crank() - 110) / 2' }, lobe: { type: 'int', dynamic: false, example: 'lobe: 2' }, contact: { type: 'string', dynamic: false, example: "contact: 'top'" } }
const CAM_FOLLOWER_EX = "camFollower({ cam, follower: valve, axis: 'down', angle: camAngle })"
/**
 * camFollower({ cam, follower, axis = 'down', angle }): a flat follower riding on a cam lobe. `axis` is the way the
 * cam pushes the follower (a valve under a cam: 'down'). At angle 0 the nose points along the axis (full lift). The
 * follower's far side (its 'top' for 'down', or the anchor named by `contact`) stays on the lobe; its lift is the
 * exact support of the lobe that is drawn. With a kit.camshaft, `lobe` picks the lobe (1-based).
 */
export function camFollower(opts: unknown): CamFollower {
  const later = named('camFollower', camFollower, [opts], ['cam', 'follower']); if (later) return later as unknown as CamFollower
  const call = 'camFollower()'
  const { model, o } = options(call, opts, CAM_FOLLOWER, { direction: 'axis', along: 'axis', valve: 'follower', tappet: 'follower' }, CAM_FOLLOWER_EX)
  const camPart = o.cam as MNode | undefined, follower = o.follower as MNode | undefined
  const mech = newMechanism(model, 'camFollower', o.id, [camPart, follower])
  let ok = need(model, call, o, ['cam', 'follower'], CAM_FOLLOWER_EX)
  const schema = ok ? kindOf(camPart!.kind)?.schema : undefined
  if (ok && !(schema && 'baseRadius' in schema && 'lift' in schema && 'duration' in schema)) {
    model.diagnostics.add({ code: 'API-TYPE', ids: [camPart!.id], what: `${call}: cam is #${camPart!.id}, a ${camPart!.kind}; a cam lobe (baseRadius, lift, duration) is needed.`, fix: ['cam: kit.cam({ lift: 0.18, duration: 120 })', 'or a kit.camshaft with lobe: 1'] })
    ok = false
  }
  const lobeIndex = typeof o.lobe === 'number' ? o.lobe - 1 : 0
  const lobe = (frame: Frame): { offset: number; angle: number } => (schema && 'lobes' in schema ? lobesOf(frame.props(camPart!))[lobeIndex] ?? { offset: 0, angle: 0 } : { offset: 0, angle: 0 })
  if (ok && schema && 'lobes' in schema) {
    const n = lobesOf(model.now().props(camPart!)).length
    if (lobeIndex < 0 || lobeIndex >= n) model.diagnostics.add({ code: 'NUM-INVALID', ids: [camPart!.id], measured: lobeIndex + 1, limit: n, what: `${call}: lobe ${lobeIndex + 1} does not exist; #${camPart!.id} has ${n} lobe${n === 1 ? '' : 's'}.`, fix: [`lobe: ${Math.max(1, Math.min(n, lobeIndex + 1))}`] })
  }
  const axis = direction(model, call, 'axis', o.axis, 270)
  const shape = (frame: Frame): CamShape => { const r = frame.props(camPart!); return camShape(r.baseRadius, r.lift, r.duration) }
  /** cam angle from "nose on the follower" */
  const camAngle = (frame: Frame): number => angleOf(camPart!, frame) + lobe(frame).angle - axis(frame)
  const lift = (frame: Frame): number => camLift({ angle: camAngle(frame), ...shape(frame) }) * planeOf(camPart!, frame).s
  const result: CamFollower = {
    id: mech.id,
    get maxLift() { if (!ok) return 0; const f = model.now(), s = shape(f); return (s.distance + s.noseRadius - s.baseRadius) * planeOf(camPart!, f).s },
    lift: signal(model, (f) => (ok ? lift(f) : 0), 0),
    angle: signal(model, (f) => (ok ? camAngle(f) : 0), 0),
  }
  if (!ok) return result
  if (o.angle !== undefined) drive(camPart!, mech, (frame) => axis(frame) - lobe(frame).angle + num(frame, o.angle, 0, `${call} angle`), true)
  const anchorName = (frame: Frame): string => (typeof o.contact === 'string' && frame.anchorLocal(follower!, o.contact) ? o.contact : OPPOSITE_ANCHOR[sideOf(axis(frame))]!)
  if (typeof o.contact === 'string' && !hasAnchor(follower!, o.contact)) {
    const names = model.now().anchorNames(follower!), near = closest(o.contact, names)
    model.diagnostics.add({ code: 'API-UNKNOWN', ids: [follower!.id], what: `${call}: #${follower!.id} (${follower!.kind}) has no anchor "${o.contact}".`, fix: [`${near ? `use "${near}". ` : ''}Anchors: ${names.join(', ')}.`] })
  }
  /** the point of the lobe that is furthest along the axis: where the flat follower touches */
  const touch = (frame: Frame): Vec3 => {
    const plane = planeOf(camPart!, frame), d = unit(axis(frame)), reach = shape(frame).baseRadius * plane.s + lift(frame)
    return add(plane.p, qrot(plane.q, [d[0] * reach, d[1] * reach, lobe(frame).offset * plane.s]))
  }
  mate(follower!, mech, (node, frame, own) => {
    const q = qmul(planeOf(camPart!, frame).q, own.q)
    return { p: sub(touch(frame), qrot(q, mul(frame.anchorLocal(node, anchorName(frame)) ?? [0, 0, 0], own.parentS * own.s))), q, world: true }
  })
  mech.invariants.push({
    name: 'the follower rides on the lobe', limit: 1e-6,
    measure: (frame) => {
      // from the transforms: where the nose really points, and how far along the axis the follower's face really is
      const plane = planeOf(camPart!, frame), s = shape(frame), d = unit(axis(frame))
      const nose = qrot(qconj(plane.q), qrot(frame.world(camPart!).q, unit(lobe(frame).angle)))
      const between = (Math.atan2(nose[1], nose[0]) - Math.atan2(d[1], d[0])) / DEG
      const face = qrot(qconj(plane.q), sub(frame.anchor(follower!, anchorName(frame)), plane.p))
      const reach = face[0] * d[0] + face[1] * d[1]
      return Math.abs(reach - (s.baseRadius + camLift({ angle: between, ...s })) * plane.s) / Math.max(s.baseRadius * plane.s, 1e-12)
    },
    what: (m) => `#${follower!.id} is ${round(m * 100, 2)}% of the base radius away from the surface of #${camPart!.id}: it floats or digs in.`,
    fix: [`let camFollower() place #${follower!.id}: remove its own .at()`, `turn #${camPart!.id} with camFollower({ angle }) instead of rotate()`],
  })
  probe(model, mech, 'lift', result.lift)
  return result
}

// ── belt ─────────────────────────────────────────────────────────────────────────────────────────────
/** What belt returns. */
export interface Belt {
  readonly id: string
  /** the belt itself: label it, colour it, focus it */
  readonly part: Handle
  /** radius of b / radius of a: turns of a for one turn of b */
  readonly ratio: number
  /** length of the belt, world units */
  readonly length: number
}
const BELT: Schema = { angle: { type: 'number', example: 'angle: turn' }, width: { type: 'positive' }, thickness: { type: 'positive' }, ribs: { type: 'boolean', dynamic: false }, color: 'color', material: 'material' }
/**
 * belt(a, b, { angle }): an open belt round two wheels (pulleys, flywheels, gears used as sprockets). The wheels stay
 * where the scene put them; the belt is drawn round them in the plane of a, and b turns with a in the ratio of the
 * radii (the same way round). `angle` turns a; leave it out when something else already does.
 */
export function belt(a: unknown, b: unknown, opts?: unknown): Belt {
  const later = named('belt', belt, [a, b, opts], [0, 1]); if (later) return later as unknown as Belt
  const call = 'belt()'
  const model = currentModel()
  const wa = model.resolveNode(a, call, 'a'), wb = model.resolveNode(b, call, 'b')
  const v = validateOptions(call, opts, { id: { type: 'string', dynamic: false }, ...BELT }, { colour: 'color' }, model)
  reportProblems(model, v.problems, [])
  const o = v.props
  const mech = newMechanism(model, 'belt', o.id, [wa, wb])
  let ok = !!wa && !!wb
  if (ok && wa === wb) { model.diagnostics.add({ code: 'API-TYPE', ids: [wa!.id], what: `${call}: both wheels are #${wa!.id}.`, fix: ['pass two different wheels'] }); ok = false }
  if (!ok) return { id: mech.id, part: beltKind({ id: mech.id }) as Handle, ratio: 1, length: 0 }
  const part = beltKind(wa, wb, { id: mech.id, ...(o.width !== undefined ? { width: o.width } : {}), ...(o.thickness !== undefined ? { thickness: o.thickness } : {}), ...(o.ribs !== undefined ? { ribs: o.ribs } : {}), ...(o.color !== undefined ? { color: o.color } : {}), ...(o.material !== undefined ? { material: o.material } : {}) })
  mech.parts.push(part)
  if (o.angle !== undefined) drive(wa!, mech, (frame) => num(frame, o.angle, 0, `${call} angle`), true)
  const ratio = (frame: Frame): number => wheelRadius(wb!, frame) / Math.max(wheelRadius(wa!, frame), 1e-12)
  // b follows a unless another mechanism already turns it (two shafts geared together and belted as well)
  if (!storeOf(model).driver.has(wb!.uid)) drive(wb!, mech, (frame) => angleOf(wa!, frame) / ratio(frame), true)
  part.placement = { type: 'kit.mate', mechanism: mech.id, parts: mech.parts, resolve: ((_n, frame) => { const plane = planeOf(wa!, frame); return { p: plane.p, q: plane.q, world: true } }) as MateFn }
  const gap = (frame: Frame): { d: number; ra: number; rb: number; z: number } => { const plane = planeOf(wa!, frame), rel = qrot(qconj(plane.q), sub(frame.world(wb!).p, plane.p)); return { d: Math.hypot(rel[0], rel[1]), ra: wheelRadius(wa!, frame), rb: wheelRadius(wb!, frame), z: rel[2] } }
  mech.invariants.push({
    name: 'the wheels are apart', limit: 0, measure: (frame) => { const g = gap(frame); return Math.max(0, Math.abs(g.ra - g.rb) - g.d + 1e-9) },
    what: () => `#${wa!.id} and #${wb!.id} sit inside each other: a belt needs two wheels side by side.`, fix: [`move #${wb!.id} away from #${wa!.id}: at least the sum of their radii apart`],
  }, {
    name: 'the wheels are in one plane', limit: 0.5, measure: (frame) => { const g = gap(frame); return Math.abs(g.z) / Math.max(Math.min(g.ra, g.rb), 1e-12) },
    what: (m) => `#${wb!.id} is ${round(m, 2)} of a wheel radius out of the plane of #${wa!.id}: the belt would run off.`, fix: [`give #${wb!.id} the same z as #${wa!.id}`],
  })
  const result: Belt = {
    id: mech.id, part,
    get ratio() { return ratio(model.now()) },
    get length() { const g = gap(model.now()), tilt = Math.asin(Math.max(-1, Math.min(1, (g.rb - g.ra) / Math.max(g.d, 1e-12)))); return 2 * g.d * Math.cos(tilt) + Math.PI * (g.ra + g.rb) + 2 * tilt * (g.rb - g.ra) },
  }
  probe(model, mech, 'ratio', () => result.ratio)
  return result
}

// ── valve timing ─────────────────────────────────────────────────────────────────────────────────────
const VALVE_LIFT: Schema = { angle: { type: 'number', example: 'angle: crank' }, opens: { type: 'number', example: 'opens: 710' }, closes: { type: 'number', example: 'closes: 230' }, lift: { type: 'number', default: 1, example: 'lift: 0.18' }, cycle: { type: 'positive', default: 720 }, profile: { type: ['cosine', 'cam'], default: 'cosine', dynamic: false } }
/**
 * valveLift({ angle, opens, closes, lift, cycle = 720 }): how far a valve is open at a crank angle. `opens` and
 * `closes` are crank degrees inside one cycle (720 for a four-stroke; the window may wrap past the end of the cycle).
 * Returns a function of the state: 0 while closed, `lift` in the middle of the window.
 */
export function valveLift(opts: unknown): () => number {
  const call = 'valveLift()'
  const { model, o } = options(call, opts, VALVE_LIFT, { open: 'opens', close: 'closes', crank: 'angle', height: 'lift' }, 'valveLift({ angle: crank, opens: 710, closes: 230, lift: 0.18 })')
  const missing = ['angle', 'opens', 'closes'].filter((k) => o[k] === undefined)
  if (missing.length) model.diagnostics.add({ code: 'API-TYPE', what: `${call} needs ${missing.join(', ')}.`, fix: ['valveLift({ angle: crank, opens: 710, closes: 230, lift: 0.18 })'] })
  return signal(model, (f) => (missing.length ? 0 : liftAt({ angle: num(f, o.angle, 0, `${call} angle`), opens: num(f, o.opens, 0, `${call} opens`), closes: num(f, o.closes, 0, `${call} closes`), lift: num(f, o.lift, 1, `${call} lift`), cycle: num(f, o.cycle, 720, `${call} cycle`), profile: o.profile === 'cam' ? 'cam' : 'cosine' })), 0)
}
/** What fourStroke returns for one crank angle. */
export interface Stroke { /** 0 … 3 */ index: number; name: StrokeName; /** 0 … 1 through the stroke */ progress: number }
/**
 * fourStroke(angle): which stroke of the four-stroke cycle a crank angle is in (0 = top dead centre at the start of
 * intake; 720 degrees per cycle). Returns a function of the state.
 */
export function fourStroke(angle: unknown): () => Stroke {
  const model = currentModel()
  if (typeof angle !== 'number' && typeof angle !== 'function') model.diagnostics.add({ code: 'API-TYPE', what: `fourStroke() expects the crank angle (a number, a param or a function), got ${typeof angle}.`, fix: ['fourStroke(crank)'] })
  return signal(model, (f) => strokeAt(num(f, angle, 0, 'fourStroke() angle')), strokeAt(0))
}
