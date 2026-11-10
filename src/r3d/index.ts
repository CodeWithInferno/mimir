// 3D (pure side): primitive and shape kinds with their maths (bounds, anchors, hulls, signed distances), the 3D
// setters, the role of every part, and the view modes (ghost, cutaway, explode) as pure functions of the frame state.
// World space: y up, units arbitrary. Nothing here imports three.js; the backend lives in ./three.ts (lazy chunk).
import {
  boxOf, callSite, clamp01, closest, cross, currentModel, defineInterp, defineKind, defineKindMethod, defineLook, defineMethod, defineSceneMethod, defineSetter, defineStepAction, dist, dot,
  Frame, isAnchorRef, isNode, MATERIAL_ALIASES, MATERIALS, norm, PACE, parseDir, qAxisDeg, qrot, reportProblems, selector, toVec3, transformBox, validateOptions, VIEW,
  type Box3, type Handle, type IdPassResult, type MNode, type PartLook, type Patch, type Resolved, type SceneModel, type Schema, type Src, type Vec3,
} from '../core/index.ts'

export type Role = 'housing' | 'moving' | 'static' | 'fastener' | 'fluid'
const ROLES: Role[] = ['housing', 'moving', 'static', 'fastener', 'fluid']

/**
 * The look options every 3D part has. Other modules spread it into the schema of their own 3D kinds so that their
 * parts take a colour, a material, a role and the fluid energy the same way.
 */
export const PART_LOOK: Schema = {
  color: { type: 'color', nullable: true, default: null, example: 'color: BLUE' },
  material: { type: 'material', default: 'matte', example: "material: 'steel'" },
  /** a housing that may contain other parts without that being an error (check) */
  shell: { type: 'boolean', default: false, dynamic: false },
  /** what the part is in the assembly; decides how it is drawn when it has no colour and no material. null = worked out */
  role: { type: ROLES, nullable: true, default: null, dynamic: false, example: "role: 'housing'" },
  /** a fluid's energy, 0 (resting) to 1 (burning): brighter, more light of its own, more bloom */
  energy: { type: 'unit', default: 0, example: 'energy: () => burn()' },
}
const LOOK = PART_LOOK

/**
 * Defaults of the view modes that the pure side needs (the rest of the look lives in ./look.ts, which spreads these
 * into its table). A scene overrides them with s.look({ cut: { soft: 0.4 }, explode: { spread: 1 } }).
 */
export const VIEW_DEFAULTS = {
  cut: {
    /** a part that is kept whole fades out over this distance (world units) once the plane has passed all of it */
    soft: 0.25,
    /** the plane starts and ends this far outside the model when a cutaway is switched on or off (share of the model's extent) */
    margin: 0.06,
  },
  explode: {
    /** default push of a part away from the model's centre, as a share of its distance, at amount 1 */
    spread: 0.85,
    /** a part with an axis moves order x step x the model's radius along it */
    step: 0.25,
    /** each order starts this share of the way later than the one before */
    lag: 0.18,
  },
}
/** Top-level sections of the look table (./look.ts): s.look() checks its keys against these when the scene is built. */
export const LOOK_SECTIONS = ['creaseDeg', 'renderer', 'light', 'role', 'stagger', 'accent', 'preset', 'object', 'line', 'focus', 'recede', 'shell', 'fluid', 'cut', 'glow', 'explode', 'enter', 'hover', 'detail', 'camera']
interface LookStore { overrides: Record<string, unknown> | null; src: Src | null }
/** What the scene passed to s.look() (null when it did not). The renderer merges it into the look table. */
export const lookOverrides = (model: SceneModel): LookStore => {
  const said = model.store<LookStore>('r3d.look', () => ({ overrides: null, src: null }))
  // the config store holds the look too ('look.line.sigma' in scene({ defaults }), s.config(), mimir.config.json): s.look() is the same thing, said last
  const set = model.settings.overrides('look')
  if (!set) return said
  const merged: Record<string, unknown> = { ...set }
  for (const [k, v] of Object.entries(said.overrides ?? {})) { const under = merged[k]; merged[k] = typeof v === 'object' && v !== null && !Array.isArray(v) && typeof under === 'object' && under !== null && !Array.isArray(under) ? { ...(under as object), ...v } : v }
  return { overrides: merged, src: said.src }
}
/**
 * What the look table (./look.ts, LOOK) is merged with for one scene. lookOverrides() already lays the scene's s.look()
 * over the config store's 'look' group ('look.line.sigma' in scene({ defaults }), s.config(), mimir.config.json), so
 * what it returns is the whole answer; this is the one name the 3D side asks.
 */
export function configuredLook(_model: SceneModel, own: Record<string, unknown> | null): Record<string, unknown> | null { return own }
function viewNumber<S extends keyof typeof VIEW_DEFAULTS>(model: SceneModel, section: S, key: keyof (typeof VIEW_DEFAULTS)[S]): number {
  const o = configuredLook(model, lookOverrides(model).overrides)?.[section]
  const v = typeof o === 'object' && o !== null ? (o as Record<string, unknown>)[key as string] : undefined
  return typeof v === 'number' && Number.isFinite(v) ? v : (VIEW_DEFAULTS[section][key] as number)
}

// ── what other modules ask of the 3D side without importing three ───────────────────────────────────────
/** Key under which an id pass carries its silhouette query (the renderer attaches it; absent without a GPU). */
export const ID_EDGE = Symbol.for('mimir.r3d.edge')
/** Samples per stage pixel when a ray is walked through an id pass. */
export const ID_EDGE_STEPS = 1
export type PartEdgeFn = (id: string, from: { x: number; y: number }, to: { x: number; y: number }) => { x: number; y: number } | null
/**
 * The silhouette of a part along a ray: the first pixel of part `id` that is met when walking from `from` toward `to`
 * (stage px) in the id pass `pass`. null when the part shows no pixel on the way, or when there is no id pass.
 */
export function partEdge(pass: IdPassResult | null | undefined, id: string, from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number } | null {
  const fn = pass ? (pass as unknown as Record<symbol, PartEdgeFn | undefined>)[ID_EDGE] : undefined
  return fn ? fn(id, from, to) : null
}
/** Key under which an id pass carries the outline of each part, and how many rows of its pixels that outline is read from. */
export const ID_OUTLINE = Symbol.for('mimir.r3d.outline')
export const ID_OUTLINE_ROWS = 64
export type PartOutlineFn = (id: string) => { x: number; y: number }[]
/**
 * Points round the pixels of part `id` in the id pass `pass` (stage px): the ends of rows of its visible pixels. Their
 * convex hull is the silhouette of what can be seen of the part. Empty when the part shows no pixel or there is no pass.
 */
export function partOutline(pass: IdPassResult | null | undefined, id: string): { x: number; y: number }[] {
  const fn = pass ? (pass as unknown as Record<symbol, PartOutlineFn | undefined>)[ID_OUTLINE] : undefined
  return fn ? fn(id) : []
}
const LIT = new WeakMap<PartLook, number>()
/**
 * Put a part in the light, from a look function: `amount` 0..1 of the focus highlight (contour, lit body). It is a
 * channel of its own beside `look.dim`, so the light can pass from one part to the next while everything else stays
 * exactly as dim as it was.
 */
export function lightPart(look: PartLook, amount: number): void { if (amount > 0) LIT.set(look, Math.min(1, Math.max(LIT.get(look) ?? 0, amount))) }
/** How much a look has put its part in the light (0 when it has not). */
export const litOf = (look: PartLook): number => LIT.get(look) ?? 0

// ── derived parts and the exploded view ─────────────────────────────────────────────────────────────────
const RESTS = new WeakSet<Frame>()
/** The same moment with nothing pushed apart: every `offset` (what an exploded view and enter shifts use) taken as zero. */
export function restFrame(frame: Frame): Frame {
  if (RESTS.has(frame)) return frame
  return frame.memo('r3d.rest', () => { const rest = new Frame(frame.model, frame.tau, frame.overrides, frame.view, 'rest'); RESTS.add(rest); return rest }, frame)
}
/**
 * The frame in which a part that is WORKED OUT FROM OTHER PARTS reads where they are (a rod between two points, a
 * function that calls part.world(), a volume that follows a piston): the frame itself, or, while the assembly is
 * pulled apart, the same moment with nothing pushed apart. So an exploded view moves such a part as one piece (it
 * keeps its length) instead of stretching it between parts that have left, and a probe still reads the mechanism.
 */
export function steady(frame: Frame): Frame { return (frame.viewValue<number>('explode', 0) ?? 0) > 0 ? restFrame(frame) : frame }
// p.world(anchor?) of a 3D part, called from a scene's own functions: where the mechanism has it (see steady)
defineMethod('3d', 'world', (node: MNode, name: unknown = 'center') => steady(node.model.now()).anchor(node, typeof name === 'string' ? name : 'center'))
/** A point that follows other parts (a part, an anchor, a function), read in the steady frame; plain coordinates stay what they are. */
export const steadyEnd = (model: SceneModel, node: MNode, v: unknown): unknown => (toVec3(v) ? v : (): Vec3 => steady(model.now()).point(v, node))

const ring = (radius: number, y: number, n = 12): Vec3[] => Array.from({ length: n }, (_, i) => [radius * Math.cos((i / n) * 2 * Math.PI), y, radius * Math.sin((i / n) * 2 * Math.PI)] as Vec3)

export const box = defineKind({
  name: 'box', space: '3d', solid: true,
  schema: { width: { type: 'positive', default: 1 }, height: { type: 'positive', default: 1 }, depth: { type: 'positive', default: 1 }, ...LOOK },
  bounds: (_n, r) => boxOf(r.width / 2, r.height / 2, r.depth / 2),
  sdf: (_n, r, p) => {
    const q: Vec3 = [Math.abs(p[0]) - r.width / 2, Math.abs(p[1]) - r.height / 2, Math.abs(p[2]) - r.depth / 2]
    return Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0)) + Math.min(Math.max(q[0], q[1], q[2]), 0)
  },
})
export const sphere = defineKind({
  name: 'sphere', space: '3d', solid: true,
  schema: { radius: { type: 'positive', default: 0.5 }, ...LOOK },
  bounds: (_n, r) => boxOf(r.radius, r.radius, r.radius),
  hull: (_n, r) => [...ring(r.radius, 0), ...ring(r.radius * 0.7071, r.radius * 0.7071, 8), ...ring(r.radius * 0.7071, -r.radius * 0.7071, 8), [0, r.radius, 0], [0, -r.radius, 0]],
  sdf: (_n, r, p) => Math.hypot(p[0], p[1], p[2]) - r.radius,
})
const cylSdf = (radius: number, height: number, p: Vec3): number => {
  const dr = Math.hypot(p[0], p[2]) - radius, dy = Math.abs(p[1]) - height / 2
  return Math.min(Math.max(dr, dy), 0) + Math.hypot(Math.max(dr, 0), Math.max(dy, 0))
}
/** axis along y */
export const cylinder = defineKind({
  name: 'cylinder', space: '3d', solid: true,
  schema: { radius: { type: 'positive', default: 0.5 }, height: { type: 'positive', default: 1 }, ...LOOK },
  bounds: (_n, r) => boxOf(r.radius, r.height / 2, r.radius),
  hull: (_n, r) => [...ring(r.radius, r.height / 2), ...ring(r.radius, -r.height / 2)],
  sdf: (_n, r, p) => cylSdf(r.radius, r.height, p),
})
/** axis along y, base at the bottom, tip at the top */
export const cone = defineKind({
  name: 'cone', space: '3d', solid: true,
  schema: { radius: { type: 'positive', default: 0.5 }, height: { type: 'positive', default: 1 }, ...LOOK },
  bounds: (_n, r) => boxOf(r.radius, r.height / 2, r.radius),
  hull: (_n, r) => [...ring(r.radius, -r.height / 2), [0, r.height / 2, 0]],
  anchors: (_n, r) => ({ tip: [0, r.height / 2, 0] }),
  sdf: (_n, r, p) => sdfOutline([[0, -r.height / 2], [r.radius, -r.height / 2], [0, r.height / 2]], Math.hypot(p[0], p[2]), p[1]),
})
/** a ring lying flat: axis along y. radius = centre of the tube, tube = radius of the tube */
export const torus = defineKind({
  name: 'torus', space: '3d', solid: true,
  schema: { radius: { type: 'positive', default: 1 }, tube: { type: 'positive', default: 0.25 }, ...LOOK },
  bounds: (_n, r) => boxOf(r.radius + r.tube, r.tube, r.radius + r.tube),
  hull: (_n, r) => [...ring(r.radius + r.tube, 0, 16), ...ring(r.radius, r.tube, 12), ...ring(r.radius, -r.tube, 12)],
  sdf: (_n, r, p) => Math.hypot(Math.hypot(p[0], p[2]) - r.radius, p[1]) - r.tube,
  init(node, model) {
    const { radius, tube: t } = node.props as { radius: unknown; tube: unknown }
    if (typeof radius === 'number' && typeof t === 'number' && t >= radius) model.diagnostics.add({ code: 'NUM-INVALID', ids: [node.id], measured: t, limit: radius, what: `torus(): tube ${t} is not smaller than radius ${radius}, so the ring closes on itself (radius is the centre of the tube, tube is the tube's own radius).`, fix: [`torus({ radius: ${Math.max(radius, t)}, tube: ${Math.round(Math.min(radius, t) * 25) / 100 || 0.25} })`] }, node.src)
  },
})
/** hollow cylinder (a pipe / sleeve): axis along y. radius = outer radius */
export const tube = defineKind({
  name: 'tube', space: '3d', solid: true,
  schema: { radius: { type: 'positive', default: 0.5 }, thickness: { type: 'positive', default: 0.1 }, height: { type: 'positive', default: 1 }, ...LOOK },
  bounds: (_n, r) => boxOf(r.radius, r.height / 2, r.radius),
  hull: (_n, r) => [...ring(r.radius, r.height / 2), ...ring(r.radius, -r.height / 2)],
  sdf: (_n, r, p) => {
    const inner = Math.max(0, r.radius - r.thickness)
    const mid = (r.radius + inner) / 2, half = (r.radius - inner) / 2
    const dr = Math.abs(Math.hypot(p[0], p[2]) - mid) - half, dy = Math.abs(p[1]) - r.height / 2
    return Math.min(Math.max(dr, dy), 0) + Math.hypot(Math.max(dr, 0), Math.max(dy, 0))
  },
})

// ── shapes from profiles, paths and raw triangles ────────────────────────────────────────────────────
type P2 = [number, number]
const finite2 = (p: unknown): p is P2 => Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number' && Number.isFinite(p[0]) && Number.isFinite(p[1])
/** a point list option as it arrives: a missing or broken one (already reported by the constructor) is an empty list */
const pts2 = (v: unknown): P2[] => (Array.isArray(v) ? (v as P2[]) : [])
const pts3 = (v: unknown): Vec3[] => (Array.isArray(v) ? (v as unknown[]).filter((p): p is Vec3 => Array.isArray(p) && p.length >= 3 && p.every((x) => typeof x === 'number' && Number.isFinite(x))) : [])
/** at most `most` items of a list, evenly taken: enough for a silhouette estimate */
const spread = <T,>(list: readonly T[], most: number): T[] => (list.length <= most ? [...list] : Array.from({ length: most }, (_, i) => list[Math.floor((i * list.length) / most)]!))
const boxOfPoints = (pts: readonly (readonly number[])[], pad = 0): Box3 => {
  const b: Box3 = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
  for (const p of pts) for (let k = 0; k < 3; k++) { const v = p[k] ?? 0; if (v - pad < b.min[k]!) b.min[k] = v - pad; if (v + pad > b.max[k]!) b.max[k] = v + pad }
  return b.min[0] <= b.max[0] ? b : boxOf(0, 0, 0)
}
/** Signed distance from (x, y) to a closed outline in its plane: negative inside (even-odd), for the solids `check` measures. */
function sdfOutline(pts: readonly P2[], x: number, y: number): number {
  let d = Infinity, inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j]!, [bx, by] = pts[i]!
    const ex = bx - ax, ey = by - ay, wx = x - ax, wy = y - ay
    const t = Math.min(1, Math.max(0, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1)))
    d = Math.min(d, Math.hypot(wx - ex * t, wy - ey * t))
    if (ay > y !== by > y && x < ax + ((y - ay) / (by - ay)) * ex) inside = !inside
  }
  return inside ? -d : d
}
function badShape(node: MNode, model: SceneModel, what: string, fix: string): void {
  node.invalid = true
  model.diagnostics.add({ code: 'API-TYPE', ids: [node.id], what, fix: [fix] }, node.src)
}

/** a flat outline in the x-y plane pushed through `depth` along z (centred on z = 0), with holes and a chamfer */
export const extrude = defineKind({
  name: 'extrude', space: '3d', solid: true, positional: ['profile'], required: ['profile'],
  schema: {
    profile: { type: { array: 'vec2', min: 3 }, dynamic: false, example: 'extrude([[0, 0], [2, 0], [2, 1], [0, 1]], { depth: 0.5 })' },
    depth: { type: 'positive', default: 1 },
    holes: { type: { array: { array: 'vec2', min: 3 } }, default: [], dynamic: false, example: 'holes: [[[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6]]]' },
    bevel: { type: 'nonneg', default: 0, dynamic: false },
    ...LOOK,
  },
  bounds: (_n, r) => { const b = boxOfPoints(pts2(r.profile).filter(finite2)); b.min[2] = -r.depth / 2; b.max[2] = r.depth / 2; return b },
  hull: (_n, r) => spread(pts2(r.profile).filter(finite2), 24).flatMap(([x, y]) => [[x, y, r.depth / 2], [x, y, -r.depth / 2]] as Vec3[]),
  sdf: (_n, r, p) => Math.max(sdfOutline(pts2(r.profile).filter(finite2), p[0], p[1]), ...(r.holes as P2[][]).map((h) => -sdfOutline(h.filter(finite2), p[0], p[1])), Math.abs(p[2]) - r.depth / 2),
  init(node, model) {
    const pts = ((node.props.profile as unknown[]) ?? []).filter(finite2)
    let a = 0
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j]![0] * pts[i]![1] - pts[i]![0] * pts[j]![1]
    if (!node.invalid && Math.abs(a) < 1e-12) badShape(node, model, 'extrude(): the profile has no area (its points lie on one line, or repeat).', 'extrude([[0, 0], [2, 0], [2, 1], [0, 1]], { depth: 0.5 })')
  },
})
/** a profile of [radius, height] points turned about the y axis */
export const lathe = defineKind({
  name: 'lathe', space: '3d', solid: true, positional: ['profile'], required: ['profile'],
  schema: {
    profile: { type: { array: 'vec2', min: 2 }, dynamic: false, example: 'lathe([[0, 0], [1, 0], [1, 2], [0, 2]])' },
    segments: { type: 'int', default: 48, dynamic: false },
    ...LOOK,
  },
  bounds: (_n, r) => {
    const pts = pts2(r.profile).filter(finite2)
    if (!pts.length) return boxOf(0, 0, 0)
    const rad = Math.max(...pts.map((p) => Math.abs(p[0]))), y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]))
    return { min: [-rad, y0, -rad], max: [rad, y1, rad] }
  },
  hull: (_n, r) => spread(pts2(r.profile).filter(finite2), 12).flatMap(([rad, y]) => (Math.abs(rad) < 1e-9 ? [[0, y, 0] as Vec3] : ring(Math.abs(rad), y, 10))),
  // the profile closed along the axis, turned: a point is inside when (its distance from the axis, its height) is inside the outline
  sdf: (_n, r, p) => sdfOutline(pts2(r.profile).filter(finite2), Math.hypot(p[0], p[2]), p[1]),
  init(node, model) {
    const pts = ((node.props.profile as unknown[]) ?? []).filter(finite2)
    if (!node.invalid && pts.some((p) => p[0] < 0)) badShape(node, model, 'lathe(): a profile point has a negative radius (points are [radius, height], radius from the y axis).', 'lathe([[0, 0], [1, 0], [1, 2], [0, 2]])')
    else if (!node.invalid && !pts.some((p) => p[0] > 1e-9)) badShape(node, model, 'lathe(): every profile point is on the axis, so there is nothing to turn.', 'lathe([[0, 0], [1, 0], [1, 2], [0, 2]])')
  },
})
/** a round tube along a path of 3D points (a pipe, a wire, a rail); corners are rounded with `bend` */
export const sweep = defineKind({
  name: 'sweep', space: '3d', solid: true, positional: ['path'], required: ['path'],
  schema: {
    path: { type: { array: 'vec3', min: 2 }, dynamic: false, example: 'sweep([[0, 0, 0], [0, 2, 0], [2, 2, 0]], { radius: 0.2 })' },
    radius: { type: 'positive', default: 0.1 },
    /** corner radius of the path; null = twice the tube radius, 0 = sharp */
    bend: { type: 'nonneg', nullable: true, default: null, dynamic: false },
    closed: { type: 'boolean', default: false, dynamic: false },
    sides: { type: 'int', default: 20, dynamic: false },
    ...LOOK,
  },
  bounds: (_n, r) => boxOfPoints(pts3(r.path), r.radius),
  hull: (_n, r) => spread(pts3(r.path), 16).flatMap((p) => [[p[0] + r.radius, p[1], p[2]], [p[0] - r.radius, p[1], p[2]], [p[0], p[1] + r.radius, p[2]], [p[0], p[1] - r.radius, p[2]], [p[0], p[1], p[2] + r.radius], [p[0], p[1], p[2] - r.radius]] as Vec3[]),
  anchors: (_n, r): Record<string, Vec3> => { const p = pts3(r.path); return p.length ? { start: [...p[0]!] as Vec3, end: [...p[p.length - 1]!] as Vec3 } : {} },
  // distance to the centre line (corners taken sharp) less the tube radius
  sdf: (_n, r, p) => {
    const pts = pts3(r.path)
    let d = Infinity
    for (let i = r.closed ? 0 : 1; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length]!, b = pts[i]!
      const e = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [p[0] - a[0], p[1] - a[1], p[2] - a[2]]
      const t = Math.min(1, Math.max(0, (w[0]! * e[0]! + w[1]! * e[1]! + w[2]! * e[2]!) / (e[0]! * e[0]! + e[1]! * e[1]! + e[2]! * e[2]! || 1)))
      d = Math.min(d, Math.hypot(w[0]! - e[0]! * t, w[1]! - e[1]! * t, w[2]! - e[2]! * t))
    }
    return d - r.radius
  },
})

/** The triangles a mesh() was given, flattened and checked once: what the backend draws and what the bounds come from. */
export interface MeshSource { positions: Float32Array; indices: Uint32Array | null; box: Box3 }
const meshStore = (model: SceneModel): Map<number, MeshSource> => model.store<Map<number, MeshSource>>('r3d.mesh', () => new Map())
export const meshSource = (node: MNode): MeshSource | null => meshStore(node.model).get(node.uid) ?? null
function flatNumbers(v: unknown): number[] | null {
  if (v instanceof Float32Array || v instanceof Float64Array || v instanceof Uint32Array || v instanceof Uint16Array || v instanceof Int32Array) return Array.from(v)
  if (!Array.isArray(v)) return null
  const out: number[] = []
  for (const x of v) {
    if (typeof x === 'number') out.push(x)
    else if (Array.isArray(x)) { for (const y of x) { if (typeof y !== 'number') return null; out.push(y) } }
    else return null
  }
  return out
}
/** raw triangles: positions as [x, y, z] triples (or flat numbers), indices as [a, b, c] triples (or flat, or left out for a triangle soup) */
export const mesh = defineKind({
  name: 'mesh', space: '3d', solid: true,
  schema: {
    positions: { type: 'any', dynamic: false, example: 'positions: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]]' },
    indices: { type: 'any', nullable: true, default: null, dynamic: false, example: 'indices: [[0, 2, 1], [0, 1, 3], [1, 2, 3], [0, 3, 2]]' },
    ...LOOK,
  },
  bounds: (node) => meshSource(node)?.box ?? boxOf(0.25, 0.25, 0.25),
  hull: (node) => {
    const m = meshSource(node)
    if (!m) return []
    const n = m.positions.length / 3
    return Array.from({ length: Math.min(n, 48) }, (_, i) => { const k = 3 * Math.floor((i * n) / Math.min(n, 48)); return [m.positions[k]!, m.positions[k + 1]!, m.positions[k + 2]!] as Vec3 })
  },
  init(node, model) {
    const example = 'mesh({ positions: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], indices: [[0, 2, 1], [0, 1, 3], [1, 2, 3], [0, 3, 2]] })'
    const pos = flatNumbers(node.props.positions)
    const idx = node.props.indices === null || node.props.indices === undefined ? null : flatNumbers(node.props.indices)
    delete node.props.positions
    delete node.props.indices
    if (!pos || pos.length < 9 || pos.length % 3 !== 0 || !pos.every(Number.isFinite)) return badShape(node, model, `mesh(): positions must be a list of [x, y, z] points (at least three, all finite)${pos ? `, got ${pos.length} numbers` : ''}.`, example)
    const count = pos.length / 3
    if (idx === null && node.props.indices !== undefined && count % 3 !== 0) return badShape(node, model, `mesh(): without indices the positions are read as triangles, three points each, but there are ${count} points.`, example)
    if (idx && (idx.length < 3 || idx.length % 3 !== 0 || !idx.every((i) => Number.isInteger(i) && i >= 0 && i < count))) {
      const bad = idx.find((i) => !Number.isInteger(i) || i < 0 || i >= count)
      return badShape(node, model, bad !== undefined ? `mesh(): index ${bad} does not name one of the ${count} points (indices count from 0).` : `mesh(): indices must be triangles, three numbers each, got ${idx.length} numbers.`, example)
    }
    const triples: number[][] = []
    for (let i = 0; i < pos.length; i += 3) triples.push([pos[i]!, pos[i + 1]!, pos[i + 2]!])
    meshStore(model).set(node.uid, { positions: new Float32Array(pos), indices: idx ? new Uint32Array(idx) : null, box: boxOfPoints(triples) })
  },
})

const endOf = (v: unknown): MNode | null => (isNode(v) ? v : isAnchorRef(v) ? v.node : null)
/** between(a, a): a rod from an object to itself has no length and no direction */
function sameEnds(model: SceneModel, node: MNode, a: unknown, b: unknown): void {
  const na = endOf(a), nb = endOf(b)
  if (!na || na !== nb || (isAnchorRef(a) && isAnchorRef(b) && a.anchor !== b.anchor) || isAnchorRef(a) !== isAnchorRef(b)) return
  model.diagnostics.add({ code: 'API-TYPE', ids: [node.id, na.id], what: `between(): both ends are #${na.id}, so the rod has no length.`, fix: [`pass two different objects, or two anchors of it: between(${na.id}.anchor('top'), ${na.id}.anchor('bottom'))`] }, node.src)
}
/** the rod that between(a, b) draws: a cylinder whose ends follow two points */
const link = defineKind({
  name: 'link', space: '3d', solid: true, positional: ['a', 'b'], required: ['a', 'b'],
  schema: { a: { type: 'point', example: 'between(crank.anchor("pin"), piston)' }, b: { type: 'point', example: 'between(crank.anchor("pin"), piston)' }, radius: { type: 'positive', default: 0.1 }, ...LOOK },
  bounds: (_n, r): Box3 => boxOf(r.radius, dist(r.a, r.b) / 2, r.radius),
  hull: (_n, r) => { const h = dist(r.a, r.b) / 2; return [...ring(r.radius, h, 8), ...ring(r.radius, -h, 8)] },
  anchors: (_n, r) => { const h = dist(r.a, r.b) / 2; return { start: [0, -h, 0], end: [0, h, 0] } },
  sdf: (_n, r, p) => cylSdf(r.radius, dist(r.a, r.b), p),
  init: (node, model) => {
    sameEnds(model, node, node.props.a, node.props.b)
    // the parts the rod joins, by name: its ends in them are a declared fit, not a collision (check reads the record)
    const parts = [endOf(node.props.a), endOf(node.props.b)].filter((n): n is MNode => n !== null)
    // the ends are read where the mechanism has them: an exploded view moves the rod, it does not stretch it
    node.props.a = steadyEnd(model, node, node.props.a)
    node.props.b = steadyEnd(model, node, node.props.b)
    node.placement = { type: 'between', a: node.props.a, b: node.props.b, parts }
  },
})
/**
 * between(a, b, { radius }): a rod from point a to point b that follows both.
 * between(a, b, { part }): centre an existing part between the two points and turn its y axis from a to b.
 */
export function between(a: unknown, b: unknown, opts?: unknown): Handle {
  const o = (typeof opts === 'object' && opts !== null ? opts : {}) as Record<string, unknown>
  if (isNode(o.part)) {
    const part = o.part as Handle
    const model = currentModel()
    const pa = toVec3(a) ?? (isNode(a) || typeof a === 'function' ? a : model.resolveNode(a, 'between()', 'a'))
    const pb = toVec3(b) ?? (isNode(b) || typeof b === 'function' ? b : model.resolveNode(b, 'between()', 'b'))
    if (pa && pb) {
      if (part.placement) model.diagnostics.add({ code: 'PLACE-CONFLICT', ids: [part.id], what: `#${part.id} already has a placement (${part.placement.type}); between() replaces it.`, fix: [`remove the earlier placement of #${part.id}`] })
      part.placement = { type: 'between', a: steadyEnd(model, part, pa), b: steadyEnd(model, part, pb), parts: [endOf(pa), endOf(pb)].filter((n): n is MNode => n !== null) }
      sameEnds(model, part, pa, pb)
    }
    return part
  }
  return opts === undefined ? link(a, b) : link(a, b, opts)
}

export const group3d = defineKind({
  name: 'group3d', space: '3d', container: true, positional: ['children'],
  schema: { children: { type: 'nodes', default: [], example: 'group([a, b])' } },
  init: (node) => {
    const kids = (node.props.children as MNode[] | undefined) ?? []
    delete node.props.children
    for (const c of kids) node.model.adopt(node, c)
  },
})
/** returned when a 3D part cannot be built: a red wire box, accepts every method */
export const placeholder3d = defineKind({ name: 'placeholder3d', space: '3d', inert: true, schema: {}, bounds: () => boxOf(0.25, 0.25, 0.25) })

// ── repeat: n copies made by a function of the index, arranged in a ring or along a line ─────────────
/** how many copies one repeat() may make (a typo such as repeat(1e6, …) must not freeze the page) */
export const REPEAT_LIMIT = 2000
/**
 * repeat(count, i => part): `count` parts, each made by the function from its index (use i for a size, a colour or
 * a phase). Every copy sits in a slot of its own, `<id>.<i>`; .ring() and .line() arrange the slots.
 */
export const repeat = defineKind({
  name: 'repeat', space: '3d', container: true, positional: ['count', 'make'], required: ['count', 'make'],
  schema: {
    count: { type: 'int', dynamic: false, example: 'repeat(6, (i) => box({ width: 0.2 }))' },
    make: { type: 'fn', example: 'repeat(6, (i) => box({ width: 0.2 }))' },
  },
  init(node, model) {
    const count = node.props.count as number, make = node.props.make as ((i: number, count: number) => unknown) | undefined
    delete node.props.make
    if (node.invalid || typeof make !== 'function') return
    if (!(count >= 1) || count > REPEAT_LIMIT) {
      node.invalid = true
      model.diagnostics.add({ code: 'NUM-INVALID', ids: [node.id], measured: count, limit: REPEAT_LIMIT, what: `repeat(): count is ${count}; it must be between 1 and ${REPEAT_LIMIT}.`, fix: ['repeat(6, (i) => box({ width: 0.2 }))'] }, node.src)
      return
    }
    for (let i = 0; i < count; i++) {
      let made: unknown
      try { made = make(i, count) } catch (e) { model.reportError(e, `repeat(): the function, called with i = ${i}`, { ids: [node.id] }); break }
      const parts = (Array.isArray(made) ? made : [made]).filter((p): p is MNode => isNode(p) && p.space === '3d')
      if (!parts.length) {
        node.invalid = true
        model.diagnostics.add({ code: 'API-TYPE', ids: [node.id], what: `repeat(): the function must return a 3D part for every index; for i = ${i} it returned ${made === undefined ? 'nothing (is the return missing?)' : isNode(made) ? 'a 2D object' : typeof made}.`, fix: ['repeat(6, (i) => box({ width: 0.2 }))', 'with braces, return the part: (i) => { return box() }'] }, node.src)
        break
      }
      model.child(node, String(i), group3d, parts)
    }
  },
})
const dyn = <T,>(v: unknown, fallback: T): T => { const x = typeof v === 'function' ? (v as () => unknown)() : v; return (x === undefined || x === null ? fallback : x) as T }
const AXES: Record<string, Vec3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }
/** 'x' | 'y' | 'z' | [x, y, z] → a unit vector, or null */
function axisOf(v: unknown): Vec3 | null {
  if (typeof v === 'string') return AXES[v.toLowerCase()] ?? null
  const a = toVec3(v)
  return a && a.every(Number.isFinite) && (a[0] || a[1] || a[2]) ? norm(a) : null
}
const RING: Schema = { radius: { type: 'positive', example: 'radius: 2' }, axis: { type: 'any', default: 'y', dynamic: false, example: "axis: 'y'" }, phase: { type: 'number', default: 0, example: 'phase: () => turn()' }, turn: { type: 'boolean', default: true, dynamic: false } }
/** rep.ring({ radius, axis, phase, turn }): the copies evenly around an axis; copy 0 sits at `phase` degrees. turn: false keeps every copy upright. */
defineKindMethod('repeat', 'ring', (node: Handle, opts: unknown) => {
  const v = validateOptions('repeat.ring()', opts, RING, { r: 'radius', angle: 'phase', offset: 'phase' }, node.model)
  reportProblems(node.model, v.problems, [node.id])
  const axis = axisOf(v.props.axis ?? 'y')
  if (!axis) { node.model.diagnostics.add({ code: 'API-TYPE', ids: [node.id], what: `repeat.ring(): axis must be 'x', 'y', 'z' or a vector, got ${JSON.stringify(v.props.axis)}.`, fix: ["rep.ring({ radius: 2, axis: 'y' })"] }); return node }
  if (v.props.radius === undefined) { node.model.diagnostics.add({ code: 'API-TYPE', ids: [node.id], what: 'repeat.ring() needs a radius.', fix: ['rep.ring({ radius: 2 })'] }); return node }
  // the direction copy 0 sits in: +z for a ring about y, +x about z, +y about x (the next axis round)
  const base: Vec3 = axis[1] > 0.999 ? [0, 0, 1] : axis[2] > 0.999 ? [1, 0, 0] : axis[0] > 0.999 ? [0, 1, 0] : norm(cross(Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], axis))
  const n = node.children.length
  // a ring whose radius and phase are plain numbers is placed with plain numbers: only a ring that turns is "moving"
  const live = typeof v.props.radius === 'function' || typeof v.props.phase === 'function'
  node.children.forEach((slot, i) => {
    const angle = (): number => dyn<number>(v.props.phase, 0) + (360 * i) / n
    const at = (): Vec3 => { const p = qrot(qAxisDeg(axis, angle()), base), r = dyn<number>(v.props.radius, 1); return [p[0] * r, p[1] * r, p[2] * r] }
    if (live) (slot as Handle).at(at); else (slot as Handle).at(...at())
    if (v.props.turn !== false) (slot as Handle).rotate({ about: axis, deg: live ? angle : angle() })
  })
  return node
})
const LINE: Schema = { step: { type: 'any', example: 'step: [0.5, 0, 0]' }, centered: { type: 'boolean', default: true, dynamic: false } }
/** rep.line({ step, centered }): the copies in a row, `step` apart ([x, y, z], or a number along x); centred on the repeat unless centered: false. */
defineKindMethod('repeat', 'line', (node: Handle, opts: unknown) => {
  const v = validateOptions('repeat.line()', opts, LINE, { gap: 'step', spacing: 'step', centred: 'centered' }, node.model)
  reportProblems(node.model, v.problems, [node.id])
  const stepOf = (): Vec3 | null => { const s = dyn<unknown>(v.props.step, null); return typeof s === 'number' && Number.isFinite(s) ? [s, 0, 0] : toVec3(s) }
  if (!stepOf()?.every(Number.isFinite)) { node.model.diagnostics.add({ code: 'API-TYPE', ids: [node.id], what: 'repeat.line() needs a step: a vector, or a number for a row along x.', fix: ['rep.line({ step: [0.5, 0, 0] })'] }); return node }
  const n = node.children.length
  node.children.forEach((slot, i) => {
    const k = v.props.centered === false ? i : i - (n - 1) / 2
    const at = (): Vec3 => { const s = stepOf() ?? [0, 0, 0]; return [s[0] * k, s[1] * k, s[2] * k] }
    if (typeof v.props.step === 'function') (slot as Handle).at(at); else (slot as Handle).at(...at())
  })
  return node
})

// ── p.on(target) / p.under(target) ───────────────────────────────────────────────────────────────────
function rest(node: MNode, call: string, target: unknown, gap: unknown, side: 'up' | 'down'): Patch | null {
  let t: unknown = target
  if (typeof target !== 'function' && !toVec3(target)) { t = node.model.resolveNode(target, call); if (!t) return null }
  if (t === node) { node.model.diagnostics.add({ code: 'PLACE-CONFLICT', ids: [node.id], what: `${call}: #${node.id} cannot rest on itself.`, fix: ['pass another part'] }); return null }
  if (gap !== undefined && typeof gap !== 'function' && !(typeof gap === 'number' && Number.isFinite(gap))) { node.model.diagnostics.add({ code: typeof gap === 'number' ? 'NUM-INVALID' : 'API-TYPE', ids: [node.id], what: `${call}: gap must be a finite number, got ${String(gap)}.`, fix: [`${call.replace('()', '')}(target, 0.1)`] }); return null }
  const dir = parseDir(node, call, side)
  return dir ? { placement: { type: 'nextTo', target: t, dir, gap: gap ?? 0 } } : null
}
/** p.on(target, gap = 0): rest on top of another part, centred over it, the two boxes touching. */
defineSetter('3d', 'on', (node, target: unknown, gap?: unknown) => rest(node, `${node.kind}.on()`, target, gap, 'up'))
/** p.under(target, gap = 0): hang directly below another part, centred under it, the two boxes touching. */
defineSetter('3d', 'under', (node, target: unknown, gap?: unknown) => rest(node, `${node.kind}.under()`, target, gap, 'down'))

// ── setters ──────────────────────────────────────────────────────────────────────────────────────────
const ROTATE: Schema = { about: { type: 'any', example: "about: 'z'" }, deg: { type: 'number', example: 'deg: 90' } }
/** p.rotate({ about: 'x' | 'y' | 'z' | [x, y, z], deg }): sets the turn about that axis (parent axes). Calls with different axes add up in call order. */
defineSetter('3d', 'rotate', (node, spec: unknown): Patch | null => {
  const call = `${node.kind}.rotate()`
  const v = validateOptions(call, spec, ROTATE, { axis: 'about', angle: 'deg', degrees: 'deg', by: 'deg' }, node.model)
  reportProblems(node.model, v.problems, [node.id])
  if (v.problems.length) return null
  const about = v.props.about ?? 'y'
  if (!(typeof about === 'string' && ['x', 'y', 'z'].includes(about)) && !(toVec3(about)?.every(Number.isFinite) && toVec3(about)!.some((c) => c !== 0))) {
    const near = typeof about === 'string' ? closest(about, ['x', 'y', 'z']) : null
    node.model.diagnostics.add({ code: typeof about === 'string' ? 'API-UNKNOWN' : 'API-TYPE', ids: [node.id], what: `${call}: about must be 'x', 'y', 'z' or a vector, got ${JSON.stringify(about)}.`, fix: [near ? `about: '${near}'` : ".rotate({ about: 'z', deg: 90 })"] })
    return null
  }
  if (v.props.deg === undefined) { node.model.diagnostics.add({ code: 'API-TYPE', ids: [node.id], what: `${call} needs deg (degrees).`, fix: [".rotate({ about: 'z', deg: 90 })"] }); return null }
  const prev = node.model.latest(node, 'rotate')
  const list = (Array.isArray(prev) ? prev : []) as { about: unknown; deg: unknown }[]
  const same = (x: unknown): boolean => (typeof x === 'string' || typeof about === 'string' ? x === about : JSON.stringify(x) === JSON.stringify(about))
  const entry = { about, deg: v.props.deg }
  return { rotate: list.some((e) => same(e.about)) ? list.map((e) => (same(e.about) ? entry : e)) : [...list, entry] }
})
const MATERIAL: Schema = { color: 'color', metalness: 'unit', roughness: 'unit', opacity: 'unit', emissive: 'unit' }
/** p.material('steel') or p.material({ color, metalness?, roughness?, opacity?, emissive? }) */
defineSetter('3d', 'material', (node, m: unknown): Patch | null => {
  const call = `${node.kind}.material()`
  if (typeof m === 'string') {
    const key = MATERIAL_ALIASES[m] ?? m
    if (key in MATERIALS) return { material: key }
    const near = closest(m, Object.keys(MATERIALS))
    node.model.diagnostics.add({ code: 'API-UNKNOWN', ids: [node.id], what: `${call}: there is no material "${m}".`, fix: [near ? `use "${near}". Materials: ${Object.keys(MATERIALS).join(', ')}.` : `use one of: ${Object.keys(MATERIALS).join(', ')}`] })
    return null
  }
  const v = validateOptions(call, m, MATERIAL, undefined, node.model)
  reportProblems(node.model, v.problems, [node.id])
  if (v.problems.length || m === undefined || m === null) { if (m === undefined || m === null) node.model.diagnostics.add({ code: 'API-TYPE', ids: [node.id], what: `${call} needs a material name or an object.`, fix: [".material('steel')"] }); return null }
  return { material: v.props }
})

// ── roles: what a part is in the assembly ────────────────────────────────────────────────────────────
/** channels whose clips mean "this part is moved by the story" (offset is not one: it is what enter verbs and explode use) */
const MOTION = ['shift', 'rotate', 'placement', 'scale']
interface RoleInfo { role: Role; /** index of the part among the drawn parts of its role, in declaration order */ nth: number }
function workOutRoles(model: SceneModel): Map<number, RoleInfo> {
  const moving = new Map<MNode, boolean>()
  const isMoving = (n: MNode, trail: Set<MNode>): boolean => {
    const known = moving.get(n)
    if (known !== undefined) return known
    if (trail.has(n)) return false
    trail.add(n)
    let m = n.parent ? isMoving(n.parent, trail) : false
    if (!m && Array.isArray(n.props.rotate)) m = (n.props.rotate as { deg: unknown }[]).some((e) => typeof e?.deg === 'function')
    if (!m && typeof n.props.shift === 'function') m = true
    if (!m) m = MOTION.some((c) => !!model.clipsFor(n, c))
    if (!m && n.placement) {
      for (const v of Object.values(n.placement)) {
        if (isAnchorRef(v)) m = isMoving(v.node, trail)
        else if (isNode(v)) m = isMoving(v, trail)
        else if (typeof v === 'function') m = true
        if (m) break
      }
    }
    trail.delete(n)
    moving.set(n, m)
    return m
  }
  const explicit = (n: MNode): Role | null => {
    for (let p: MNode | null = n; p; p = p.parent) { const r = p.props.role; if (typeof r === 'string' && (ROLES as string[]).includes(r)) return r as Role }
    return null
  }
  const out = new Map<number, RoleInfo>(), counts: Record<string, number> = {}
  for (const n of model.nodes) {
    if (n.space !== '3d') continue
    const mat = n.props.material
    const role: Role = explicit(n) ?? (n.props.shell === true || mat === 'ghost' || mat === 'glass' ? 'housing' : isMoving(n, new Set()) ? 'moving' : 'static')
    const drawn = n.kind !== 'group3d' && n.kind !== 'repeat'
    const nth = drawn ? (counts[role] = (counts[role] ?? -1) + 1) : 0
    out.set(n.uid, { role, nth })
  }
  return out
}
/**
 * The role of a 3D part and its place among the parts of that role: the `role` option of the part or of a group
 * around it; else a housing when it is a shell (shell: true, material ghost / glass); else `moving` when anything
 * moves it (a function or a param in its rotation or position, a play on it, a mate to something that moves); else
 * `static`. Fasteners and fluids are named by the author (or by the kit part).
 */
export function roleInfo(node: MNode): RoleInfo {
  const model = node.model
  const c = model.store<{ revision: number; map: Map<number, RoleInfo> }>('r3d.roles', () => ({ revision: -1, map: new Map() }))
  if (c.revision !== model.revision) { c.map = workOutRoles(model); c.revision = model.revision }
  return c.map.get(node.uid) ?? { role: 'static', nth: 0 }
}
export const roleOf = (node: MNode): Role => roleInfo(node).role

// ── view modes ───────────────────────────────────────────────────────────────────────────────────────
// Each is a look: a pure function of the frame state (EXTENDING 2.9). The renderer reads what they leave on the part's
// look; check rules and tests read the same thing without a GPU.
declare module '../core/registry.ts' {
  interface PartLook {
    /** 0..1: how far the part is turned into an x-ray shell (s.ghost) */
    ghost?: number
    /** the section plane that cuts this part (s.cutaway): the kept side is dot(normal, p) + constant > 0 */
    cut?: { normal: Vec3; constant: number; /** 0..1: how fast the plane is travelling (its outline lights up) */ sweep: number }
  }
}
const named = (list: readonly string[], node: MNode): boolean => { for (let n: MNode | null = node; n; n = n.parent) if (list.includes(n.id)) return true; return false }
/** ids of a part list given as objects, ids, or one of either; reports what is not an object */
function partIds(model: SceneModel, v: unknown, call: string): string[] {
  const out: string[] = []
  for (const p of (Array.isArray(v) ? v : [v]).flat(3)) { const n = isNode(p) ? p : model.resolveNode(p, call, 'a part'); if (n) out.push(n.id) }
  return out
}

/** s.ghost: amount per part id; '*' = every housing and fastener. */
type GhostValue = Record<string, number> | number | null
const GHOST_DEFAULT: Role[] = ['housing', 'fastener']
defineLook('ghost', (look, v: GhostValue, node) => {
  let amount = 0
  if (typeof v === 'number') amount = v
  else if (v && typeof v === 'object') {
    let found = false
    for (let n: MNode | null = node; n && !found; n = n.parent) if (typeof v[n.id] === 'number') { amount = v[n.id]!; found = true }
    if (!found && typeof v['*'] === 'number' && GHOST_DEFAULT.includes(roleOf(node))) amount = v['*']
  }
  amount = clamp01(Number.isFinite(amount) ? amount : 0)
  if (amount <= 0) return
  look.ghost = Math.max(look.ghost ?? 0, amount)
  if (amount > 0.5) look.shell = true
}, { rest: null, control: { label: 'Ghost', on: { '*': 1 } } })
defineInterp('*', 'ghost', (a: GhostValue, b: GhostValue, u: number): GhostValue => {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * u
  const ra = a && typeof a === 'object' ? a : typeof a === 'number' ? { '*': a } : {}, rb = b && typeof b === 'object' ? b : typeof b === 'number' ? { '*': b } : {}
  const out: Record<string, number> = {}
  for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) { const x = (ra[k] ?? 0) + ((rb[k] ?? 0) - (ra[k] ?? 0)) * u; if (x > 1e-6) out[k] = x }
  return Object.keys(out).length ? out : u >= 1 ? b : {}
})
function ghostValue(model: SceneModel, parts: unknown, call: string): GhostValue | undefined {
  if (parts === false || parts === null) return null
  if (parts === true || parts === undefined) return { '*': 1 }
  const ids = partIds(model, parts, call)
  if (!ids.length) return undefined
  return Object.fromEntries(ids.map((id) => [id, 1]))
}

/** s.cutaway, resolved: everything beyond `at` along `axis` (a unit vector) is removed. */
export interface CutValue { axis: Vec3; at: number; parts: string[] | null; sweep: number }
const CUT_DEFAULT: Role[] = ['housing', 'static', 'fastener', 'fluid']
const corners = (b: Box3): Vec3[] => [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]] as Vec3)
const smoothstep = (a: number, b: number, x: number): number => { const t = clamp01((x - a) / (b - a || 1e-9)); return t * t * (3 - 2 * t) }
defineLook('cutaway', (look, v: CutValue | null, node, frame) => {
  if (!v || !Array.isArray(v.axis) || !Number.isFinite(v.at)) return
  const cut = v.parts ? named(v.parts, node) : CUT_DEFAULT.includes(roleOf(node))
  if (cut) {
    const plane = { normal: [-v.axis[0], -v.axis[1], -v.axis[2]] as Vec3, constant: v.at }
    look.clip.push(plane)
    look.cut = { ...plane, sweep: clamp01(v.sweep ?? 0) }
    return
  }
  // a part that is kept whole (the mechanism) disappears once all of it lies on the removed side
  // (it fades over the last stretch: `soft` world units, or its second half when it is thinner than that)
  let inside = -Infinity, outside = -Infinity
  for (const c of corners(frame.bounds(node))) { const d = v.at - dot(v.axis, c); if (d > inside) inside = d; if (-d > outside) outside = -d }
  look.opacity *= smoothstep(0, Math.max(1e-6, Math.min(viewNumber(node.model, 'cut', 'soft'), (inside + outside) / 2)), inside)
}, { rest: null, control: { label: 'Section', on: { axis: [0, 0, 1], at: 0, parts: null, sweep: 0 } } })
/** how far the model reaches along a direction in this frame (so a cutaway can start and end outside it) */
function reach(frame: Frame, axis: Vec3): { far: number; near: number } {
  return frame.memo(`r3d.reach:${axis.join(',')}`, () => {
    let far = -Infinity, near = Infinity
    for (const p of frame.subject()) { const d = dot(axis, p); if (d > far) far = d; if (d < near) near = d }
    if (!Number.isFinite(far)) return { far: 0, near: 0 }
    const pad = Math.max(1e-3, (far - near) * viewNumber(frame.model, 'cut', 'margin'))
    return { far: far + pad, near: near - pad }
  }, { far: 0, near: 0 })
}
const bell = (u: number): number => 4 * u * (1 - u)
defineInterp('*', 'cutaway', (a: CutValue | null, b: CutValue | null, u: number, frame: Frame): CutValue | null => {
  if (!a && !b) return null
  const same = a && b && dot(a.axis, b.axis) > 0.9999
  if (same) return { axis: b.axis, at: a.at + (b.at - a.at) * u, parts: u >= 0.5 ? b.parts : a.parts, sweep: Math.abs(b.at - a.at) > 1e-9 ? bell(u) : 0 }
  // switching on, off, or to another direction: the plane travels in from outside the model, or out of it
  const sweepIn = (v: CutValue, w: number): CutValue => ({ ...v, at: reach(frame, v.axis).far + (v.at - reach(frame, v.axis).far) * w, sweep: bell(w) })
  if (!a) return u <= 0 ? null : sweepIn(b!, u)
  if (!b) return u >= 1 ? null : sweepIn(a, 1 - u)
  return u < 0.5 ? sweepIn(a, 1 - 2 * u) : sweepIn(b, 2 * u - 1)
})
const CUTAWAY: Schema = {
  axis: { type: 'any', default: 'z', dynamic: false, example: "axis: 'z'" },
  at: { type: 'number', default: 0, example: 'at: 0' },
  parts: { type: 'any', nullable: true, default: null, dynamic: false, example: 'parts: [block, head]' },
}
function cutValue(model: SceneModel, opts: unknown, call: string): CutValue | (() => CutValue) | null | undefined {
  if (opts === false || opts === null) return null
  const v = validateOptions(call, opts === undefined || opts === true ? {} : opts, CUTAWAY, { plane: 'at', position: 'at', normal: 'axis', only: 'parts' }, model)
  reportProblems(model, v.problems, [])
  if (v.problems.length) return undefined
  const axis = axisOf(v.props.axis ?? 'z')
  if (!axis) { model.diagnostics.add({ code: 'API-TYPE', what: `${call}: axis must be 'x', 'y', 'z' or a vector that points at the half to remove, got ${JSON.stringify(v.props.axis)}.`, fix: [`${call.replace('()', '')}({ axis: 'z', at: 0 })`] }); return undefined }
  const parts = v.props.parts === null || v.props.parts === undefined ? null : partIds(model, v.props.parts, call)
  const at = v.props.at
  if (typeof at === 'function') return () => ({ axis, at: Number((at as () => unknown)()) || 0, parts, sweep: 0 })
  return { axis, at: typeof at === 'number' ? at : 0, parts, sweep: 0 }
}

// explode: a scene-level amount; where each part goes is a pure function of it (and of where the part rests)
defineLook('explode', () => {}, {
  rest: 0,
  // a viewer may explode a scene that never did: the parts then need the clip that reads their place from the amount
  control: { label: 'Exploded', on: 1, prepare: (model) => { if (!model.selectorClipsFor('offset')?.some((c) => c.to === explodeOffset)) model.addClip({ target: everyPart, prop: 'offset', to: explodeOffset, t0: 0, t1: 0, rate: (u: number) => u, scope: 'persist', step: 0, src: { file: null, line: null }, seq: 0 }) } },
})
interface ExplodeSpec { axis: Vec3; distance: number | null; order: number; /** p.explode(false): stays where it is */ stay?: boolean }
/** a part whose place is worked out from other parts (a mate, a rod between two points, a function): it follows them, and gets no push of its own */
const follows = (n: MNode): boolean => !!n.placement && Object.values(n.placement).some((v) => typeof v === 'function' || isNode(v))
const explodeSpecs = (model: SceneModel): Map<number, ExplodeSpec> => model.store<Map<number, ExplodeSpec>>('r3d.explode', () => new Map())
const EXPLODE: Schema = { axis: { type: 'any', example: "axis: 'up'" }, distance: { type: 'positive', dynamic: false, example: 'distance: 2' }, order: { type: 'int', default: 1, dynamic: false, example: 'order: 2' } }
/**
 * p.explode({ axis, distance?, order? }): where this part (or group) goes in an exploded view: along `axis` ('up',
 * 'down', 'left', 'right', 'front', 'back' or a vector) by `distance` (default: order x a share of the model's size);
 * `order` 1 leaves first, higher orders later and farther. p.explode(false) keeps the part where it is. Parts
 * without either are pushed away from the model's centre, unless their place is worked out from other parts (a mate,
 * a rod between two points, a function): those follow what they depend on.
 */
defineMethod('3d', 'explode', (node: MNode, spec: unknown) => {
  const call = `${node.kind}.explode()`
  if (spec === false) { explodeSpecs(node.model).set(node.uid, { axis: [0, 1, 0], distance: 0, order: 1, stay: true }); node.model.revision++; return node }
  const v = validateOptions(call, spec, EXPLODE, { dir: 'axis', direction: 'axis', along: 'axis', by: 'distance', step: 'order' }, node.model)
  reportProblems(node.model, v.problems, [node.id])
  if (v.problems.length) return node
  const axis = parseDir(node, call, v.props.axis ?? 'up')
  if (!axis) return node
  const order = Math.max(1, Math.min(99, (v.props.order as number | undefined) ?? 1))
  explodeSpecs(node.model).set(node.uid, { axis: norm(axis), distance: (v.props.distance as number | undefined) ?? null, order })
  node.model.revision++
  return node
})
/** the share of its travel a part of `order` has covered at `amount`: order 1 leaves first, each next one `lag` later, all arrive at 1 */
export function explodeShare(amount: number, order: number, lag: number): number {
  const a = clamp01(amount)
  const start = Math.min(0.9, Math.max(0, (Math.max(1, order) - 1) * lag))
  return a <= start ? 0 : (a - start) / (1 - start)
}
/** Where the explode view mode puts a part in this frame, as an offset from where it rests. Pure. */
export function explodeOffset(node: MNode, frame: Frame): Vec3 {
  const amount = frame.viewValue<number>('explode', 0)
  if (!(amount > 0) || node.space !== '3d') return [0, 0, 0]
  const model = node.model
  const spec = explodeSpecs(model).get(node.uid)
  if (spec?.stay || (!spec && (node.parent || follows(node)))) return [0, 0, 0] // it stays, or travels with what it is part of or mated to
  const body = frame.memo('r3d.explode.body', () => {
    // the model as it rests: the centre every default push points away from, and the size every default distance scales with
    const b: Box3 = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
    // measured with nothing pushed apart: the size of a part that follows others must not ask for the push being worked out
    const rest = restFrame(frame)
    for (const n of model.nodes) {
      if (n.space !== '3d' || n.children.length || frame.reveal(n).p <= 0) continue
      for (const c of corners(transformBox(rest.localBounds(n), rest.world(n)))) for (let k = 0; k < 3; k++) { if (c[k]! < b.min[k]!) b.min[k] = c[k]!; if (c[k]! > b.max[k]!) b.max[k] = c[k]! }
    }
    if (!(b.min[0] <= b.max[0])) return { centre: [0, 0, 0] as Vec3, radius: 1 }
    return { centre: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2] as Vec3, radius: Math.max(1e-6, Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2) }
  }, { centre: [0, 0, 0] as Vec3, radius: 1 })
  const lag = viewNumber(model, 'explode', 'lag')
  if (spec) {
    const d = (spec.distance ?? spec.order * viewNumber(model, 'explode', 'step') * body.radius) * explodeShare(amount, spec.order, lag)
    return [spec.axis[0] * d, spec.axis[1] * d, spec.axis[2] * d]
  }
  // no axis given: away from the model's centre by a share of the distance (parts that share the centre stay nested)
  const rest = frame.rest(node)
  const lb = frame.localBounds(node)
  const kids = !(lb.min[0] <= lb.max[0]) || (lb.min[0] === lb.max[0] && lb.min[1] === lb.max[1] && lb.min[2] === lb.max[2] && node.children.length > 0)
  const wb = transformBox(lb, rest)
  const centre: Vec3 = kids ? rest.p : [(wb.min[0] + wb.max[0]) / 2, (wb.min[1] + wb.max[1]) / 2, (wb.min[2] + wb.max[2]) / 2]
  const k = viewNumber(model, 'explode', 'spread') * explodeShare(amount, 1, lag)
  return [(centre[0] - body.centre[0]) * k, (centre[1] - body.centre[1]) * k, (centre[2] - body.centre[2]) * k]
}
/** every 3D part reads its exploded position from the amount: one selector clip on `offset`, recorded where the scene first explodes */
const everyPart = selector((n) => n.space === '3d')

const DURATION: Schema = { duration: { type: 'nonneg', dynamic: false, example: 'duration: 2' }, rate: { type: 'fn', example: 'rate: smooth' } }
function timing(model: SceneModel, call: string, opts: unknown, fallback: number): { duration: number; rate?: (u: number) => number } {
  const v = validateOptions(call, opts, DURATION, { runTime: 'duration', seconds: 'duration' }, model)
  reportProblems(model, v.problems, [])
  const d = v.props.duration as number | undefined
  return { duration: typeof d === 'number' && Number.isFinite(d) ? Math.min(d, 300) : fallback, rate: v.props.rate as ((u: number) => number) | undefined }
}
/** default seconds of a view-mode change: a ghost or an explode is a play, a cutaway sweeps like a camera move */
export const VIEW_PACE = { ghost: PACE.play, cutaway: PACE.camera, explode: PACE.camera }

/** s.ghost(parts | true | false): x-ray housings from the start of the story. */
defineSceneMethod('ghost', (s, parts: unknown) => { const v = ghostValue(s.model, parts, 's.ghost()'); if (v !== undefined) { s.model.view.ghost = v; s.model.revision++ } })
/** s.cutaway({ axis, at, parts } | false): a section plane from the start of the story. */
defineSceneMethod('cutaway', (s, opts: unknown) => { const v = cutValue(s.model, opts, 's.cutaway()'); if (v !== undefined) { s.model.view.cutaway = v; s.model.revision++ } })
/** s.explode(amount): the assembly pulled apart from the start of the story (0..1, or a function / param). */
defineSceneMethod('explode', (s, amount: unknown) => {
  if (typeof amount !== 'function' && !(typeof amount === 'number' && Number.isFinite(amount))) { s.model.diagnostics.add({ code: 'API-TYPE', what: `s.explode() expects an amount from 0 to 1, got ${String(amount)}.`, fix: ['s.explode(1)'] }); return }
  s.model.view.explode = typeof amount === 'number' ? clamp01(amount) : amount
  // from the first instant: every part reads its place from the amount
  s.model.addClip({ target: everyPart, prop: 'offset', to: explodeOffset, t0: 0, t1: 0, rate: (u: number) => u, scope: 'persist', step: 0, src: { file: null, line: null }, seq: 0 })
})
/** st.ghost(parts | true | false, { duration? }): fade housings to x-ray shells (or back). */
defineStepAction('ghost', (st, parts: unknown, opts?: unknown) => {
  const v = ghostValue(st.model, parts, 'st.ghost()')
  if (v !== undefined) st.clip(VIEW, 'ghost', v, timing(st.model, 'st.ghost()', opts, VIEW_PACE.ghost))
})
/** st.cutaway({ axis, at, parts } | false, { duration? }): sweep a section plane in, to another place, or out. */
defineStepAction('cutaway', (st, cut: unknown, opts?: unknown) => {
  const v = cutValue(st.model, cut, 'st.cutaway()')
  if (v !== undefined) st.clip(VIEW, 'cutaway', v, timing(st.model, 'st.cutaway()', opts, VIEW_PACE.cutaway))
})
/** st.explode(amount, { duration? }): pull the assembly apart (1) or put it back (0). */
defineStepAction('explode', (st, amount: unknown, opts?: unknown) => {
  if (!(typeof amount === 'number' && Number.isFinite(amount))) { st.model.diagnostics.add({ code: 'API-TYPE', what: `st.explode() expects an amount from 0 to 1, got ${String(amount)}.`, fix: ['st.explode(1)'] }); return }
  const t = timing(st.model, 'st.explode()', opts, VIEW_PACE.explode)
  st.clip(everyPart, 'offset', explodeOffset, { duration: 0 })
  st.clip(VIEW, 'explode', clamp01(amount), t)
})

/** s.look({ … }): override defaults of the 3D look for this scene (a deep partial of the look table; see `mimir docs look`). */
defineSceneMethod('look', (s, overrides: unknown) => {
  const model = s.model
  if (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides)) { model.diagnostics.add({ code: 'API-TYPE', what: `s.look() expects an object of overrides, got ${overrides === null ? 'null' : typeof overrides}.`, fix: ['s.look({ line: { sigma: 2 } })'] }); return }
  const store = model.store<LookStore>('r3d.look', () => ({ overrides: null, src: null }))
  store.src = callSite()
  const next: Record<string, unknown> = { ...(store.overrides ?? {}) }
  for (const [k, v] of Object.entries(overrides)) {
    if (!LOOK_SECTIONS.includes(k)) { const near = closest(k, LOOK_SECTIONS); model.diagnostics.add({ code: 'API-UNKNOWN', what: `s.look(): the look has no "${k}".`, fix: [near ? `use "${near}"` : `sections: ${LOOK_SECTIONS.join(', ')}`] }); continue }
    const prev = next[k]
    next[k] = typeof v === 'object' && v !== null && !Array.isArray(v) && typeof prev === 'object' && prev !== null && !Array.isArray(prev) ? { ...(prev as object), ...v } : v
  }
  store.overrides = next
  model.revision++
})

export type { Resolved }
export const api = { box, sphere, cylinder, cone, torus, tube, extrude, lathe, sweep, mesh, repeat, between }
