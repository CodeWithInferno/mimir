// Flow: particles along paths, bursts, trails, vector fields, fill levels, gas volumes, colour by scalar.
// This file is the pure side (main chunk): constructors, schemas, bounds, and the named defaults. Everything that
// computes or draws particles lives in the module's lazy chunks: ./flow.chunk.ts (the maths of every effect + the 2D
// canvas backends) and ./flow3d.chunk.ts (the three.js backends). Every effect is stateless: what is drawn is a pure
// function of the frame (time, params), so any frame can be drawn cold and in any order.
import {
  apply, boxCorners, boxOf, checkValue, closest, ctx, currentModel, defineKind, definePlacement, emptyBox, expand, isAnchorRef, isColor, isEmptyBox, isNode, kindOf, mix, PALETTE, qconj, qrot, reportProblems, SAFE_X, SAFE_Y, spec, sub, toVec3, transformBox, validateOptions,
  type Box3, type Frame, type Handle, type MNode, type Problem, type Resolved, type Schema, type SceneModel, type Vec3,
} from '../core/index.ts'
import { PART_LOOK, steady, steadyEnd } from '../r3d/index.ts'
import { trail as sampleTrail } from '../lib/sim/index.ts'

// ── named defaults (docs/OSS-HYGIENE.md §5): each is the default of the option of the same name ────────────────────────
export const FLOW_DEFAULTS = {
  /** particles of a flow */
  count: 40,
  /** path units per second */
  speed: 1,
  /** diameter of a particle: frame units in 2D, world units in 3D */
  size: 0.08,
  size3d: 0.12,
  color: PALETTE.BLUE,
  /** share of an open path over which particles appear at its start and vanish at its end */
  fade: 0.08,
  /** strength of the soft halo around each particle, 0..1 */
  glow: 0.4,
  /** radius of the halo, in particle radii, and its opacity at the centre and at 45% of that radius (it ends at 0) */
  haloRadius: 3.2,
  haloOpacity: [0.55, 0.16] as [number, number],
  /** how far the middle of a 2D particle is lifted towards white (a lit core), and the opacity of a tail where it leaves the particle */
  coreLift: 0.22,
  tailOpacity: 0.85,
  /** how much a 3D particle glows by itself, 0..1 */
  emissive: 0.35,
  seed: 1,
  /** points a path's speed, spread and colour functions are sampled at */
  samples: 96,
  /** distinct colours a 3D flow draws when its colour varies along the path */
  colorSteps: 12,
  /** burst: particles, seconds, how far they fly */
  burstCount: 24,
  burstDuration: 0.8,
  burstRadius: 1,
  burstRadius3d: 1.5,
  /** burst: the streak behind a spark as it leaves, as a share of the radius (it shortens to nothing as the spark slows) */
  burstStreak: 0.22,
  /** trail: stroke width (1 = 0.01 units in 2D, pixels of a 1280-wide stage in 3D) and seconds between samples */
  trailWidth: 3,
  trailEvery: 1 / 60,
  /** trail: pieces a fading trail is stroked in (each has one opacity, rising towards the head) */
  trailSteps: 28,
  /** field: arrows per unit, stroke width, the longest arrow as a share of the grid spacing */
  fieldDensity: 1.25,
  fieldWidth: 2,
  fieldReach: 0.82,
  /** field: the arrow head as a share of the arrow's length, capped at this many stroke widths; the opacity of the weakest arrow */
  fieldHead: 0.42,
  fieldHeadWidths: 5,
  fieldFaint: 0.35,
  /** fillLevel */
  fillOpacity: 0.55,
  /** fillLevel in 3D: how far the liquid stays off the walls of its housing (share of its smallest side), and off a moving part it is filled from or up to */
  fillInset: 0.06,
  fillClear: 0.012,
  /** fillLevel in 3D: the look of the liquid when it is given neither a material nor the role 'fluid' */
  fillMaterial: { roughness: 0.25, metalness: 0, opacity: 0.8, emissive: 0.3 },
  /** gas: particles, their diameter as a share of the volume's smallest side, how far they wander (share of the half size) */
  gasParticles: 70,
  gasParticleSize: 0.06,
  gasAgitation: 0.08,
  /** gas body: opacity and glow at density 0 and at density 1 */
  gasOpacity: [0.3, 0.72] as [number, number],
  gasEmissive: [0.55, 1] as [number, number],
  /** gas in the 3D look: the fluid energy (light of its own, bloom) of a cold thin gas and of a hot dense one */
  gasEnergy: [0.15, 0.9] as [number, number],
  /** gas: how far the particles' colour is lifted towards white so they read against the body; how much more a hot gas moves than a cold one */
  gasParticleLift: 0.3,
  gasHotAgitation: [0.6, 1.4] as [number, number],
  /** fillLevel in 2D: how far the surface line is lifted towards white, and its stroke width */
  surfaceLift: 0.35,
  surfaceWidth: 2.5,
}

/**
 * The defaults of this module as one scene sees them: `FLOW_DEFAULTS`, with whatever the engine's config store holds under
 * 'flow.<name>' (model.config('flow.<name>', fallback), when the core has one). Worked out once per scene.
 */
export const flowDefaults = (model: SceneModel): typeof FLOW_DEFAULTS => model.store<typeof FLOW_DEFAULTS>('flow.defaults', () => {
  const ask = (model as unknown as { config?: (key: string, fallback: unknown) => unknown }).config
  if (typeof ask !== 'function') return FLOW_DEFAULTS
  const out = { ...FLOW_DEFAULTS } as Record<string, unknown>
  for (const key of Object.keys(out)) { const v = ask.call(model, 'flow.' + key, out[key]); if (v !== undefined && typeof v === typeof out[key]) out[key] = v }
  return out as typeof FLOW_DEFAULTS
})

// ── colour by scalar ──────────────────────────────────────────────────────────────────────────────────
/**
 * Named colour ramps, low → high, in the palette's own hues so they sit on black like everything else.
 * temperature: cold blue → pale → gold → red. density: thin → dense. speed: slow → fast. pressure: low → high.
 */
export const RAMPS: Record<string, readonly string[]> = {
  temperature: [PALETTE.BLUE_D, PALETTE.BLUE_B, '#F4EEDC', PALETTE.GOLD, PALETTE.RED],
  density: ['#17333C', PALETTE.BLUE_E, PALETTE.BLUE, PALETTE.BLUE_A],
  speed: [PALETTE.BLUE_D, PALETTE.BLUE, PALETTE.TEAL_A, PALETTE.YELLOW_B, PALETTE.YELLOW],
  pressure: [PALETTE.PURPLE_E, PALETTE.PURPLE, PALETTE.MAROON_B, PALETTE.RED_A],
}
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : Number.isFinite(x) ? x : 0)
function rampColors(call: string, name: unknown, model: SceneModel | null): readonly string[] {
  if (typeof name === 'string' && Object.hasOwn(RAMPS, name)) return RAMPS[name]!
  if (Array.isArray(name) && name.length && name.every((c) => isColor(c))) return name as string[]
  const names = Object.keys(RAMPS)
  model?.diagnostics.add({ code: typeof name === 'string' ? 'API-UNKNOWN' : 'API-TYPE', what: `${call}: ${typeof name === 'string' ? `there is no ramp "${name}"` : 'the ramp must be a name or a list of colours'}.`, fix: [`use one of: ${names.map((n) => `'${n}'`).join(', ')}`, 'or a list of colours: [BLUE, YELLOW, RED]'] })
  return RAMPS.temperature!
}
const along = (colors: readonly string[], u: number): string => {
  if (colors.length === 1) return colors[0]!
  const x = clamp01(u) * (colors.length - 1)
  const i = Math.min(colors.length - 2, Math.floor(x))
  return mix(colors[i]!, colors[i + 1]!, x - i)
}
/**
 * colorScale(ramp, { min, max }): a function from a value in real units to a colour.
 * `const heat = colorScale('temperature', { min: 300, max: 2500 })` then `color: () => heat(T())`.
 */
export function colorScale(rampName: unknown = 'temperature', options?: { min?: number; max?: number }): (value: number) => string {
  const model = ctx.model
  const colors = rampColors('colorScale()', rampName, model)
  const o = typeof options === 'object' && options !== null ? options : {}
  let min = typeof o.min === 'number' && Number.isFinite(o.min) ? o.min : 0
  let max = typeof o.max === 'number' && Number.isFinite(o.max) ? o.max : 1
  for (const name of Object.keys(o)) if (name !== 'min' && name !== 'max') model?.diagnostics.add({ code: 'API-UNKNOWN', what: `colorScale() has no option "${name}".`, fix: ['Valid options: min, max.'] })
  if (max === min) { model?.diagnostics.add({ code: 'NUM-INVALID', what: `colorScale(): min and max are both ${min}, so every value has the same colour.`, fix: [`colorScale(${typeof rampName === 'string' ? `'${rampName}'` : 'ramp'}, { min: ${min}, max: ${min + 1} })`] }); max = min + 1 }
  return (value) => along(colors, (value - min) / (max - min))
}

// ── shared pieces ─────────────────────────────────────────────────────────────────────────────────────
/** simulation time of the frame being evaluated: the default clock of every effect */
const clock = (): number => ctx.frame?.t ?? 0
const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v) && !isNode(v) && typeof v !== 'function'
/** Call an author's function of the position along a path (or of a point) in a frame; anything that is not usable gives the fallback. */
export function callAt<T>(frame: Frame, node: MNode, fn: unknown, args: readonly unknown[], fallback: T, what: string): T {
  if (typeof fn !== 'function') return fallback
  const v = frame.value<unknown>(fn, fallback, node, what, args)
  return (typeof fallback === 'number' ? (typeof v === 'number' && Number.isFinite(v) ? v : fallback) : typeof fallback === 'string' ? (isColor(v) ? v : fallback) : v ?? fallback) as T
}
const FIVE = [0, 0.25, 0.5, 0.75, 1]
/**
 * What a function-valued option draws cannot be seen in the resolved options (a function is just "fn"), so a kind
 * with such options carries a `state` option: the functions sampled at a few points. That is what makes a param read
 * only inside such a function count as changing the picture (frame.signature: STATIC-STEP, DEAD-PARAM, NOT-PURE).
 */
function sampled(node: MNode, names: readonly string[], args: (u: number) => readonly unknown[] = (u) => [u]): void {
  const model = node.model
  node.props.state = (): unknown[] => {
    const frame = model.now()
    const out: unknown[] = []
    for (const name of names) {
      const fn = frame.prop<unknown>(node, name)
      if (typeof fn === 'function') for (const u of FIVE) out.push(frame.value<unknown>(fn, null, node, name, args(u)))
    }
    return out
  }
}
/** Options a kind has for the engine's own use: never offered to an author, never accepted from one. */
const HIDDEN = ['path', 'target', 'point', 'vector', 'at', 'speedAlong', 'spreadAlong', 'colorAlong', 'state']
/**
 * Build a node of one of this module's kinds from what the author wrote. The public function is one name for a 2D
 * and a 3D kind (flow → flow / flow3d), so the arguments are checked HERE, under the public name: a diagnostic then
 * says `flow()` and lists the options an author can pass, not the names of the kinds behind it.
 * `given` = the leading arguments by option name; `along` = options that may be a function of a position.
 */
function make(ctor: (...args: any[]) => Handle, kind: string, call: string, given: Record<string, unknown>, options: unknown, example: string, along: readonly string[] = []): Handle {
  const model = currentModel()
  const schema = kindOf(kind)?.schema ?? {}
  const names = Object.keys(schema).filter((n) => !HIDDEN.includes(n))
  const problems: Problem[] = []
  const wanted: Record<string, unknown> = {}
  if (options !== undefined && options !== null && !isPlain(options)) problems.push({ code: 'API-TYPE', what: `${call} expects an options object, got ${Array.isArray(options) ? 'an array' : isNode(options) ? `the object #${options.id}` : typeof options}.`, fix: [example] })
  else if (isPlain(options)) {
    for (const [key, value] of Object.entries(options)) {
      if (!names.includes(key)) { const near = closest(key, names); problems.push({ code: 'API-UNKNOWN', what: `${call} has no option "${key}".`, fix: [`${near ? `use "${near}". ` : ''}Valid options: ${names.join(', ')}.`] }); continue }
      // a function of the position along the path is kept as a function; the engine calls it with the position
      if (along.includes(key) && typeof value === 'function') wanted[key + 'Along'] = value
      else wanted[key] = value
    }
  }
  const checked = validateOptions(call, wanted, schema, undefined, model)
  problems.push(...checked.problems)
  const props = checked.props
  for (const [name, value] of Object.entries(given)) {
    if (value === undefined) { problems.push({ code: 'API-TYPE', what: `${call} needs ${LEADING[name] ?? name} as its first argument.`, fix: [example] }); continue }
    const r = checkValue(call, name, spec(schema[name] ?? 'any'), value, model)
    if (r.ok) props[name] = r.value
    else problems.push(r.problem)
  }
  const node = ctor(props)
  if (problems.length) { node.invalid = true; reportProblems(model, problems, [node.id]) }
  return node
}
/** what a leading argument is, in words */
const LEADING: Record<string, string> = { path: 'a path (a list of points, or an object to run along)', target: 'an object', at: 'a point', point: 'a function (t) => point', vector: 'a function (x, y) => [vx, vy]' }
/** '2d' or '3d' for a list of points as written: a part or a point with three coordinates makes it 3D. */
function spaceOfPoints(path: unknown, model: SceneModel, depth = 0): '2d' | '3d' {
  if (isNode(path)) return path.space
  if (isAnchorRef(path)) return path.node.space
  if (typeof path === 'function' && depth < 2) { try { return spaceOfPoints(model.now().value(path, null), model, depth + 1) } catch { return '2d' } }
  if (typeof path === 'string') return model.byId.get(path)?.space ?? '2d'
  if (!Array.isArray(path)) return '2d'
  if (path.length && path.every((x) => typeof x === 'number')) return path.length >= 3 ? '3d' : '2d'
  for (const item of path) {
    if (isNode(item) || isAnchorRef(item) || typeof item === 'string') return spaceOfPoints(item, model, depth + 1)
    if (Array.isArray(item) && item.every((x) => typeof x === 'number')) return item.length >= 3 ? '3d' : '2d'
  }
  return '2d'
}
const pad = (b: Box3, by: number, flat: boolean): Box3 => (isEmptyBox(b) ? boxOf(0, 0, 0) : { min: [b.min[0] - by, b.min[1] - by, flat ? 0 : b.min[2] - by], max: [b.max[0] + by, b.max[1] + by, flat ? 0 : b.max[2] + by] })
const boxOfPoints = (points: readonly Vec3[]): Box3 => { const b = emptyBox(); for (const p of points) expand(b, p); return b }

// ── flow ──────────────────────────────────────────────────────────────────────────────────────────────
/** The centre line a flow follows, as points in the flow's own space (a list as written, or the line of the object it runs along). */
export function flowPoints(node: MNode, r: Resolved, frame: Frame): Vec3[] {
  const target = r.target as MNode | null
  let points: Vec3[] = []
  if (target && isNode(target)) {
    if (node.space === '2d') { const b = frame.boxIn(node, target); points = [[b.min[0], b.min[1], 0], [b.max[0], b.max[1], 0]] }
    else points = centreLine(target, frame)
  } else if (Array.isArray(r.path)) points = (r.path as unknown[]).map((p) => toVec3(p)).filter((p): p is Vec3 => p !== null)
  return r.reverse ? points.slice().reverse() : points
}
/**
 * The centre line of a 3D part in world space: the points of its `path` option when its kind has one (a pipe, a
 * sweep), else from its 'start' anchor to its 'end' anchor, else along its own y axis from 'bottom' to 'top'.
 */
export function centreLine(target: MNode, frame: Frame): Vec3[] {
  const kind = kindOf(target.kind)
  const w = frame.world(target)
  if (kind && Object.hasOwn(kind.schema, 'path')) {
    const path = frame.prop<unknown>(target, 'path')
    const pts = Array.isArray(path) ? path.map((p) => toVec3(p)).filter((p): p is Vec3 => p !== null) : []
    if (pts.length >= 2) return pts.map((p) => apply(w, p))
  }
  const names = frame.anchorNames(target)
  const [a, b] = names.includes('start') && names.includes('end') ? ['start', 'end'] : ['bottom', 'top']
  return [frame.anchor(target, a), frame.anchor(target, b)]
}
const widest = (node: MNode, r: Resolved, frame: Frame): number => {
  let m = typeof r.spread === 'number' ? r.spread : 0
  if (typeof r.spreadAlong === 'function') for (const u of FIVE) m = Math.max(m, callAt(frame, node, r.spreadAlong, [u], 0, 'spread'))
  return m + (typeof r.size === 'number' ? r.size : 0)
}
const FLOW = (size: number): Schema => ({
  path: { type: { array: 'point', min: 2 }, nullable: true, default: null, example: 'flow([[-3, 0], [3, 0]], { count: 30 })' },
  target: { type: 'node', nullable: true, default: null, dynamic: false, example: 'flow(pipe)' },
  count: { type: 'int', default: FLOW_DEFAULTS.count, example: 'count: 40' },
  speed: { type: 'nonneg', default: FLOW_DEFAULTS.speed, example: 'speed: 1.5' },
  speedAlong: { type: 'fn', nullable: true, default: null, example: 'speed: (along) => 1 / area(along)' },
  size: { type: 'positive', default: size, example: 'size: 0.1' },
  color: { type: 'color', default: FLOW_DEFAULTS.color },
  colorAlong: { type: 'fn', nullable: true, default: null, example: 'color: (along) => heat(temperatureAt(along))' },
  phase: { type: 'number', nullable: true, default: null, example: 'phase: () => crank() / 360' },
  time: { type: 'number', default: clock, example: 'time: () => s.t()' },
  active: { type: 'any', default: true, example: 'active: () => valveOpen()' },
  spread: { type: 'nonneg', default: 0, example: 'spread: 0.3' },
  spreadAlong: { type: 'fn', nullable: true, default: null, example: 'spread: (along) => radiusAt(along)' },
  fade: { type: 'unit', default: FLOW_DEFAULTS.fade },
  glow: { type: 'unit', default: FLOW_DEFAULTS.glow },
  tail: { type: 'nonneg', default: 0, example: 'tail: 0.15' },
  closed: { type: 'boolean', default: false },
  reverse: { type: 'boolean', default: false },
  seed: { type: 'any', default: FLOW_DEFAULTS.seed, dynamic: false, example: 'seed: 7' },
  state: { type: 'any', default: null },
})
const flowInit = (node: MNode): void => sampled(node, ['speedAlong', 'spreadAlong', 'colorAlong'])
const flow2d = defineKind({
  name: 'flow', space: '2d', chunk: 'flow', worldGeometry: true, positional: ['path'],
  schema: FLOW(FLOW_DEFAULTS.size),
  bounds: (node, r, frame) => pad(boxOfPoints(flowPoints(node, r, frame)), widest(node, r, frame), true),
  init: flowInit,
})
const flow3d = defineKind({
  name: 'flow3d', space: '3d', chunk: ['flow', 'flow3d'], positional: ['path'],
  schema: FLOW(FLOW_DEFAULTS.size3d),
  bounds: (node, r, frame) => pad(boxOfPoints(flowPoints(node, r, frame)), widest(node, r, frame), false),
  init: flowInit,
})
/** Who builds flow(system): set by src/quick (the block of explain()) when that module is loaded; null means flow() only knows paths. */
export const flowSystem: { make: ((system: unknown, options?: unknown) => unknown) | null } = { make: null }
const isSystem = (v: unknown): boolean => typeof v === 'string' || (typeof v === 'object' && v !== null && !Array.isArray(v) && !isNode(v) && ('nodes' in v || 'links' in v))
/**
 * flow(path, { count, speed, size, color, phase, active, spread, … }): particles streaming along a path. 2D when the
 * path is 2D (points [x, y], a 2D object's outline), 3D when it is 3D (points [x, y, z], a part's centre line).
 * speed, spread and color may be functions of the position along the path (0..1).
 */
export function flow(path?: unknown, options?: unknown): Handle {
  // one name for the author: a SYSTEM ('a -> b -> c', or { nodes, links }) is not a path; the explain() layer's flow block takes it
  if (flowSystem.make && isSystem(path)) return flowSystem.make(path, options) as Handle
  const example = 'flow([[-3, 0], [3, 0]], { count: 30, speed: 1.5 })'
  const along = ['speed', 'spread', 'color']
  if (isNode(path)) return make(path.space === '3d' ? flow3d : flow2d, 'flow', 'flow()', { target: path }, options, example, along)
  const three = spaceOfPoints(path, currentModel()) === '3d'
  return make(three ? flow3d : flow2d, three ? 'flow3d' : 'flow', 'flow()', { path }, options, example, along)
}

// ── burst ─────────────────────────────────────────────────────────────────────────────────────────────
const BURST = (size: number, radius: number, flat: boolean): Schema => ({
  at: { type: 'point', default: [0, 0, 0], example: 'burst(plug, { when: 2 })' },
  count: { type: 'int', default: FLOW_DEFAULTS.burstCount },
  color: { type: 'color', default: PALETTE.YELLOW },
  size: { type: 'positive', default: size },
  radius: { type: 'positive', default: radius, example: 'radius: 1.2' },
  when: { type: 'any', nullable: true, default: null, example: 'when: [2, 4.5]' },
  duration: { type: 'positive', default: FLOW_DEFAULTS.burstDuration },
  progress: { type: 'number', nullable: true, default: null, example: 'progress: () => (angle() % 720 - 350) / 40' },
  time: { type: 'number', default: clock },
  direction: { type: flat ? 'vec2' : 'vec3', nullable: true, default: null, example: flat ? 'direction: [0, 1]' : 'direction: [0, 1, 0]' },
  cone: { type: 'number', default: 360, example: 'cone: 60' },
  glow: { type: 'unit', default: FLOW_DEFAULTS.glow },
  seed: { type: 'any', default: FLOW_DEFAULTS.seed, dynamic: false },
})
/**
 * How far a burst is through its life in a frame, 0..1, or null when it is not firing: `progress` when given, else
 * (time − the latest `when` that has passed) / duration.
 */
export function burstProgress(r: Resolved): number | null {
  if (typeof r.progress === 'number') return r.progress >= 0 && r.progress < 1 ? r.progress : null
  const times = (Array.isArray(r.when) ? r.when : [r.when]).filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
  let last = -Infinity
  for (const t of times) if (t <= r.time && t > last) last = t
  const p = (r.time - last) / r.duration
  return p >= 0 && p < 1 ? p : null
}
const burstBounds = (flat: boolean) => (_node: MNode, r: Resolved): Box3 => {
  const p = (toVec3(r.at) ?? [0, 0, 0]) as Vec3
  const k = r.radius * 1.4 + r.size
  return { min: [p[0] - k, p[1] - k, flat ? 0 : p[2] - k], max: [p[0] + k, p[1] + k, flat ? 0 : p[2] + k] }
}
function burstInit(node: MNode, model: SceneModel): void {
  const w = node.props.when
  const ok = (x: unknown): boolean => typeof x === 'number' && Number.isFinite(x)
  if (w !== null && typeof w !== 'function' && !(ok(w) || (Array.isArray(w) && w.every(ok)))) model.diagnostics.add({ code: 'API-TYPE', ids: [node.id], what: `burst(): when must be a time in seconds, a list of times, or a function that returns one; got ${Array.isArray(w) ? 'a list with something that is not a number' : typeof w}.`, fix: ['when: 2', 'when: [2, 4.5]', 'or drive it yourself: progress: () => …  (0 → 1 over the life of the burst)'] }, node.src)
  if (w === null && node.props.progress === null) model.diagnostics.add({ code: 'API-TYPE', ids: [node.id], what: 'burst() needs when (the time it fires, in seconds) or progress (0 → 1 over its life); without one it never fires.', fix: ['burst(at, { when: 2 })'] }, node.src)
}
const burst2d = defineKind({ name: 'burst', space: '2d', chunk: 'flow', worldGeometry: true, positional: ['at'], schema: BURST(FLOW_DEFAULTS.size, FLOW_DEFAULTS.burstRadius, true), bounds: burstBounds(true), init: burstInit })
const burst3d = defineKind({ name: 'burst3d', space: '3d', chunk: ['flow', 'flow3d'], positional: ['at'], schema: BURST(FLOW_DEFAULTS.size3d, FLOW_DEFAULTS.burstRadius3d, false), bounds: burstBounds(false), init: burstInit })
/** burst(at, { count, color, when }): particles thrown out from a point when something happens (a spark, an arrival). */
export function burst(at?: unknown, options?: unknown): Handle {
  const three = spaceOfPoints(at, currentModel()) === '3d'
  return make(three ? burst3d : burst2d, three ? 'burst3d' : 'burst', 'burst()', { at }, options, 'burst(plug, { when: 2, color: YELLOW })')
}

// ── trail ─────────────────────────────────────────────────────────────────────────────────────────────
const TRAIL: Schema = {
  point: { type: 'fn', nullable: true, default: null, example: 'trail((t) => [Math.cos(t), Math.sin(t)], { duration: 2 })' },
  duration: { type: 'positive', nullable: true, default: null, example: 'duration: 2' },
  from: { type: 'number', default: 0 },
  color: { type: 'color', default: PALETTE.YELLOW },
  width: { type: 'nonneg', default: FLOW_DEFAULTS.trailWidth },
  fade: { type: 'boolean', default: true },
  every: { type: 'positive', default: FLOW_DEFAULTS.trailEvery, dynamic: false },
  time: { type: 'number', default: clock },
  state: { type: 'any', default: null },
}
/** The points of a trail in a frame: where the moving point was at fixed moments of the last `duration` seconds, oldest first. Memoised per frame. */
export function trailPoints(node: MNode, frame: Frame): Vec3[] {
  return frame.memo('trail' + node.uid, () => {
    const fn = frame.prop<unknown>(node, 'point')
    const to = frame.prop<number>(node, 'time')
    if (typeof fn !== 'function' || !Number.isFinite(to)) return []
    const duration = frame.prop<number | null>(node, 'duration')
    const start = frame.prop<number>(node, 'from')
    const from = Math.min(to, Math.max(Number.isFinite(start) ? start : 0, duration ? to - duration : -Infinity))
    const every = frame.prop<number>(node, 'every')
    const out: Vec3[] = []
    for (const p of sampleTrail((t) => (toVec3(frame.value<unknown>(fn, null, node, 'the point of the trail', [t])) ?? [NaN, NaN, NaN]) as number[], { from, to, every })) if (Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2])) out.push(p as Vec3)
    return out
  }, [])
}
const trailBounds = (flat: boolean) => (node: MNode, r: Resolved, frame: Frame): Box3 => pad(boxOfPoints(trailPoints(node, frame)), flat ? r.width * 0.005 : 0, flat)
function trailInit(node: MNode, model: SceneModel): void {
  // the head and the oldest point say whether anything moved; the points in between follow from them
  node.props.state = (): unknown => { const pts = trailPoints(node, model.now()); return pts.length ? [pts[0], pts[pts.length - 1], pts.length] : [] }
}
const trail2d = defineKind({ name: 'trail', space: '2d', chunk: 'flow', worldGeometry: true, positional: ['point'], schema: TRAIL, bounds: trailBounds(true), init: trailInit })
const trail3d = defineKind({ name: 'trail3d', space: '3d', chunk: ['flow', 'flow3d'], positional: ['point'], schema: TRAIL, bounds: trailBounds(false), init: trailInit })
/**
 * trail((t) => point, { duration, color, width }): the line a moving point has drawn. The function gives the point
 * at simulation time t; a point with three coordinates makes a 3D trail.
 */
export function trail(point?: unknown, options?: unknown): Handle {
  const model = currentModel()
  let three = false
  if (typeof point === 'function') { const p = model.now().value<unknown>(point, null, null, 'the point of the trail', [0]); three = Array.isArray(p) && p.length >= 3 }
  return make(three ? trail3d : trail2d, three ? 'trail3d' : 'trail', 'trail()', { point }, options, 'trail((t) => [Math.cos(t), Math.sin(t)], { duration: 2 })')
}

// ── vector field (2D) ─────────────────────────────────────────────────────────────────────────────────
export interface FieldRegion { x: number; y: number; width: number; height: number }
/** The rectangle a field covers in a frame (min corner + size): the region as written, the box of an object, or the safe area. */
export function fieldRegion(node: MNode, r: Resolved, frame: Frame): FieldRegion {
  const g = r.region as unknown
  if (isNode(g)) { const b = frame.boxIn(node, g); return { x: b.min[0], y: b.min[1], width: b.max[0] - b.min[0], height: b.max[1] - b.min[1] } }
  if (isPlain(g) && [g.x, g.y, g.width, g.height].every((v) => typeof v === 'number' && Number.isFinite(v)) && (g.width as number) > 0 && (g.height as number) > 0) return { x: g.x as number, y: g.y as number, width: g.width as number, height: g.height as number }
  return { x: -SAFE_X, y: -SAFE_Y, width: 2 * SAFE_X, height: 2 * SAFE_Y }
}
const field2d = defineKind({
  name: 'field', space: '2d', chunk: 'flow', worldGeometry: true, positional: ['vector'],
  schema: {
    vector: { type: 'fn', nullable: true, default: null, example: 'field((x, y) => [-y, x], { region: s.area() })' },
    region: { type: 'any', nullable: true, default: null, dynamic: false, example: 'region: { x: -3, y: -2, width: 6, height: 4 }' },
    density: { type: 'positive', default: FLOW_DEFAULTS.fieldDensity, example: 'density: 1.5' },
    color: { type: 'color', default: PALETTE.BLUE },
    colorAlong: { type: 'fn', nullable: true, default: null, example: 'color: (strength) => ramp([BLUE, YELLOW])(strength)' },
    scale: { type: 'positive', nullable: true, default: null, example: 'scale: 0.5' },
    width: { type: 'nonneg', default: FLOW_DEFAULTS.fieldWidth },
    time: { type: 'number', default: clock },
    state: { type: 'any', default: null },
  },
  bounds: (node, r, frame) => { const g = fieldRegion(node, r, frame); return { min: [g.x, g.y, 0], max: [g.x + g.width, g.y + g.height, 0] } },
  init(node, model) {
    const g = node.props.region
    if (g !== null && !isNode(g) && !(isPlain(g) && typeof g.width === 'number' && typeof g.height === 'number' && g.width > 0 && g.height > 0)) model.diagnostics.add({ code: 'API-TYPE', ids: [node.id], what: 'field(): region must be a rectangle { x, y, width, height } (x, y = the left bottom corner), an area from s.area(), or an object.', fix: ['region: s.area()', 'region: { x: -3, y: -2, width: 6, height: 4 }'] }, node.src)
    // the field sampled at five points of its region, and its colour function at five strengths
    node.props.state = (): unknown[] => {
      const frame = model.now()
      const rect = fieldRegion(node, { region: node.props.region }, frame)
      const fn = frame.prop<unknown>(node, 'vector'), tint = frame.prop<unknown>(node, 'colorAlong')
      const out: unknown[] = []
      if (typeof fn === 'function') for (const [u, v] of [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]] as const) out.push(frame.value<unknown>(fn, null, node, 'the field', [rect.x + rect.width * u, rect.y + rect.height * v]))
      if (typeof tint === 'function') for (const u of FIVE) out.push(frame.value<unknown>(tint, null, node, 'color', [u]))
      return out
    }
  },
})
/** field((x, y) => [vx, vy], { region, density }): a grid of arrows showing a 2D vector field. */
export function field(vector?: unknown, options?: unknown): Handle {
  return make(field2d, 'field', 'field()', { vector }, options, 'field((x, y) => [-y, x], { region: s.area(), density: 1.5 })', ['color'])
}

// ── fill level ────────────────────────────────────────────────────────────────────────────────────────
const SIDES = ['bottom', 'top', 'left', 'right'] as const
/** The part of a box that is filled up to `level` from one side. */
export function filledBox(b: Box3, level: number, from: string): Box3 {
  const k = clamp01(level)
  const out: Box3 = { min: [...b.min] as Vec3, max: [...b.max] as Vec3 }
  if (from === 'top') out.min[1] = b.max[1] - (b.max[1] - b.min[1]) * k
  else if (from === 'left') out.max[0] = b.min[0] + (b.max[0] - b.min[0]) * k
  else if (from === 'right') out.min[0] = b.max[0] - (b.max[0] - b.min[0]) * k
  else out.max[1] = b.min[1] + (b.max[1] - b.min[1]) * k
  return out
}
const fill2d = defineKind({
  name: 'fill', space: '2d', chunk: 'flow', worldGeometry: true, positional: ['target'],
  schema: {
    target: { type: 'node', nullable: true, default: null, dynamic: false, example: 'fillLevel(tank, { level: 0.6 })' },
    level: { type: 'unit', default: 0.5, example: 'level: () => volume() / capacity' },
    color: { type: 'color', default: PALETTE.BLUE },
    fillOpacity: { type: 'unit', default: FLOW_DEFAULTS.fillOpacity },
    from: { type: SIDES, default: 'bottom', dynamic: false },
    surface: { type: 'boolean', default: true },
  },
  bounds: (node, r, frame) => (isNode(r.target) ? filledBox(frame.boxIn(node, r.target), r.level, r.from) : boxOf(0, 0, 0)),
})
/**
 * Is the part round when seen along its y axis? Asked of its own signed distance at a corner of its box: a corner
 * that lies outside the solid means the box is not filled to its corners. Parts without a distance count as boxes.
 */
export function isRound(target: MNode, frame: Frame): boolean {
  const kind = kindOf(target.kind)
  if (!kind?.sdf) return false
  const b = frame.localBounds(target)
  const hx = (b.max[0] - b.min[0]) / 2, hz = (b.max[2] - b.min[2]) / 2
  try { return kind.sdf(target, frame.props(target), [(b.min[0] + b.max[0]) / 2 + hx * 0.97, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2 + hz * 0.97]) > 0.02 * Math.min(hx, hz) } catch { return false }
}
/** Local box of a part shrunk by a share of its smallest side on every side (what is inside its walls). */
export function innerBox(target: MNode, frame: Frame, inset: number): Box3 {
  const b = frame.localBounds(target)
  const d = Math.min(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) * clamp01(inset) * 0.5
  return { min: [b.min[0] + d, b.min[1] + d, b.min[2] + d], max: [b.max[0] - d, b.max[1] - d, b.max[2] - d] }
}
// what fills a part belongs to that part: it is drawn where the part is and gets no push of its own in an exploded view
definePlacement('flow.inside', () => ({ p: [0, 0, 0] }))
/**
 * The part of the inside of a housing that is filled, in the housing's own space (its y axis is "up"): from its inside
 * bottom to `level` of its height; or, with `from` / `to`, between two points that parts carry (the crown of a piston,
 * the underside of a lid): the volume then follows those parts, and stays `clear` off them so that the two faces
 * never fight for the same pixels.
 */
export function filledSpan(target: MNode, frame: Frame, r: { level: number; inset: number; clear?: number; from?: Vec3 | null; to?: Vec3 | null }): Box3 {
  const inner = innerBox(target, frame, r.inset)
  const from = r.from && toVec3(r.from), to = r.to && toVec3(r.to)
  if (!from && !to) return filledBox(inner, r.level, 'bottom')
  // where the housing is in the mechanism: an exploded view moves the liquid with its housing, it does not stretch it
  const w = steady(frame).world(target)
  const height = (p: Vec3): number => qrot(qconj(w.q), sub(p, w.p))[1] / (w.s || 1)
  const gap = Math.max(0, r.clear ?? FLOW_DEFAULTS.fillClear) * Math.min(inner.max[0] - inner.min[0], inner.max[1] - inner.min[1], inner.max[2] - inner.min[2])
  const clampY = (y: number): number => Math.min(inner.max[1], Math.max(inner.min[1], y))
  const y0 = from ? clampY(height(from) + gap) : inner.min[1]
  const y1 = to ? clampY(height(to) - gap) : from ? inner.max[1] : inner.min[1] + (inner.max[1] - inner.min[1]) * clamp01(r.level)
  return { min: [inner.min[0], y0, inner.min[2]], max: [inner.max[0], Math.max(y0, y1), inner.max[2]] }
}
const fill3d = defineKind({
  name: 'fill3d', space: '3d', chunk: ['flow', 'flow3d'], positional: ['target'],
  schema: {
    target: { type: 'node', nullable: true, default: null, dynamic: false, example: 'fillLevel(tank, { level: 0.6 })' },
    level: { type: 'unit', default: 0.5 },
    /** the liquid starts at / reaches up to a point a part carries, instead of the bottom / a level */
    from: { type: 'point', nullable: true, default: null, example: "from: piston.anchor('top')" },
    to: { type: 'point', nullable: true, default: null, example: "to: piston.anchor('bottom')" },
    color: { type: 'color', nullable: true, default: PALETTE.BLUE },
    material: { type: 'material', default: FLOW_DEFAULTS.fillMaterial },
    shape: { type: ['auto', 'box', 'cylinder'], default: 'auto', dynamic: false },
    inset: { type: 'unit', default: FLOW_DEFAULTS.fillInset },
    clear: { type: 'unit', default: FLOW_DEFAULTS.fillClear },
    shell: { type: 'boolean', default: false, dynamic: false },
    role: PART_LOOK.role!,
    energy: PART_LOOK.energy!,
  },
  bounds: (_node, r, frame) => {
    const t = r.target as MNode | null
    if (!t || !isNode(t)) return boxOf(0, 0, 0)
    return transformBox(filledSpan(t, frame, r as never), frame.world(t))
  },
  // asked by gas(): is the volume round? (a corner of its box lies outside a liquid that stands in a round housing)
  sdf: (node, r, p) => {
    const t = r.target as MNode | null
    if (!t || !isNode(t)) return 1
    const frame = node.model.now()
    const b = frame.localBounds(node)
    const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2, cz = (b.min[2] + b.max[2]) / 2
    const hx = Math.max((b.max[0] - b.min[0]) / 2, 1e-9), hy = (b.max[1] - b.min[1]) / 2, hz = Math.max((b.max[2] - b.min[2]) / 2, 1e-9)
    const up = Math.abs(p[1] - cy) - hy
    const round = r.shape === 'cylinder' || (r.shape === 'auto' && isRound(t, frame))
    return round ? Math.max((Math.hypot((p[0] - cx) / hx, (p[2] - cz) / hz) - 1) * Math.min(hx, hz), up) : Math.max(Math.abs(p[0] - cx) - hx, up, Math.abs(p[2] - cz) - hz)
  },
  init(node, model) {
    // the points it is filled from and up to are read where the mechanism has them (see steady in ../r3d)
    for (const end of ['from', 'to'] as const) if (node.props[end] !== null && node.props[end] !== undefined) node.props[end] = steadyEnd(model, node, node.props[end])
    if (isNode(node.props.target)) node.placement = { type: 'flow.inside', of: node.props.target }
  },
})
/** fillLevel(shape, { level }): a 2D shape, or the inside of a 3D part, filled up to a level 0..1. */
export function fillLevel(target?: unknown, options?: unknown): Handle {
  const model = currentModel()
  const node = isNode(target) ? target : typeof target === 'string' ? model.byId.get(target) : undefined
  const three = node?.space === '3d'
  let o = options
  // one name for the opacity of the liquid in both spaces: in 2D it is the opacity of the fill, the surface line stays crisp
  if (isPlain(o) && !three && o.opacity !== undefined) { const { opacity, ...rest } = o; o = { ...rest, fillOpacity: opacity } }
  return make(three ? fill3d : fill2d, three ? 'fill3d' : 'fill', 'fillLevel()', { target }, o, 'fillLevel(tank, { level: 0.6, color: BLUE })')
}

// ── gas ───────────────────────────────────────────────────────────────────────────────────────────────
const gas3d = defineKind({
  name: 'gas', space: '3d', chunk: ['flow', 'flow3d'], positional: ['target'],
  schema: {
    target: { type: 'node', nullable: true, default: null, dynamic: false, example: 'gas(chamber, { density: () => squeeze(), temperature: () => heat() })' },
    density: { type: 'unit', default: 0.5, example: 'density: () => 1 / volume()' },
    temperature: { type: 'unit', default: 0.2, example: 'temperature: () => heat()' },
    color: { type: 'color', nullable: true, default: null, example: 'color: () => chargeColor()' },
    ramp: { type: 'any', default: 'temperature', dynamic: false, example: "ramp: 'temperature'" },
    particles: { type: 'int', default: FLOW_DEFAULTS.gasParticles },
    size: { type: 'positive', nullable: true, default: null },
    agitation: { type: 'nonneg', default: FLOW_DEFAULTS.gasAgitation },
    time: { type: 'number', default: clock },
    seed: { type: 'any', default: FLOW_DEFAULTS.seed, dynamic: false },
  },
  bounds: (_node, r, frame) => (isNode(r.target) ? transformBox(frame.localBounds(r.target), frame.world(r.target)) : boxOf(0, 0, 0)),
  hull: (_node, r, frame) => (isNode(r.target) ? boxCorners(frame.localBounds(r.target)).map((p) => apply(frame.world(r.target), p)) : []),
  init(node, model) {
    const target = node.props.target as MNode | null
    if (!target || !isNode(target)) return
    if (target.space !== '3d') { model.diagnostics.add({ code: 'API-TYPE', ids: [node.id, target.id], what: `gas(): #${target.id} is a 2D object; gas fills a 3D part.`, fix: ['pass a 3D part: gas(cylinder({ radius: 1, height: 2 }), { … })', 'for a 2D shape use fillLevel(shape, { level, color })'] }, node.src); return }
    node.placement = { type: 'flow.inside', of: target }
    const colors = rampColors('gas()', node.props.ramp, model)
    const now = <T,>(name: string): T => model.now().prop<T>(node, name)
    /** the colour of the gas in the frame being evaluated: its own colour, else the ramp at its temperature */
    const tint = (): string => now<string | null>('color') ?? along(colors, now<number>('temperature'))
    node.props.tint = tint
    // the volume becomes the gas: a glowing, see-through body that brightens and thickens with density
    const k = (): number => clamp01(now<number>('density'))
    const [o0, o1] = FLOW_DEFAULTS.gasOpacity, [e0, e1] = FLOW_DEFAULTS.gasEmissive
    target.props.color = tint
    target.props.material = (): Record<string, number> => ({ roughness: 1, metalness: 0, opacity: o0 + (o1 - o0) * k(), emissive: e0 + (e1 - e0) * k() })
    target.props.shell = true // other parts may be inside it: it is a volume, not a solid
    // in the 3D look a gas is a fluid: its colour, undimmed, with light of its own that grows as it gets hot and dense
    const schema = kindOf(target.kind)?.schema
    if (schema && Object.hasOwn(schema, 'role') && Object.hasOwn(schema, 'energy') && (target.props.role === undefined || target.props.role === null)) {
      const [g0, g1] = FLOW_DEFAULTS.gasEnergy
      target.props.role = 'fluid'
      target.props.energy = (): number => clamp01(g0 + (g1 - g0) * clamp01(now<number>('temperature')) * (0.5 + 0.5 * k()))
    }
  },
})
/** read by the backend: the colour function gas() installed (hidden from the schema so nobody has to pass it) */
export const gasTint = (node: MNode, frame: Frame, fallback: string): string => frame.value<string>(node.props.tint, fallback, node, 'the colour of the gas')
/**
 * gas(volume, { density, temperature }): turn a 3D part into a volume of gas: a glowing see-through body whose colour
 * follows `temperature` (0 cold → 1 hot, on the temperature ramp) and whose brightness follows `density`, with
 * particles inside that are squeezed with the part.
 */
export function gas(volume?: unknown, options?: unknown): Handle {
  return make(gas3d, 'gas', 'gas()', { target: volume }, options, 'gas(chamber, { density: () => squeeze(), temperature: () => heat() })')
}

/** A flow resolved for one frame: where its particles are, and the colour at a share of the path. */
export interface FlowState { particles: import('./particles.ts').Particle[]; transit: number; length: number; colorAt(u: number): string }
/**
 * Where the chunks leave what the other side needs: flow.chunk.ts publishes the particle maths and the function that
 * resolves a flow for a frame; flow3d.chunk.ts and tests read them. Empty until the chunk is loaded.
 */
export const slots: { maths?: typeof import('./particles.ts'); flowState?: (node: MNode, frame: Frame) => FlowState } = {}

/** On demand: this module's API is its own chunk (mimir.flowapi.js), loaded before a scene that uses one of its names. */
export const lazy = true
export const api = { flow, burst, trail, field, fillLevel, gas, colorScale, RAMPS, FLOW_DEFAULTS }
