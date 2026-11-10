// Parts kit (pure side): the kinds with their schemas, derived dimensions, bounds, anchors and signed distances.
// Nothing here imports three.js; the meshes are built in ./kit.chunk.ts (lazy chunk 'kit') from the same
// `*Dims` functions, so what check measures and what is drawn come from one set of numbers.
//
// Orientation, chosen so that parts assemble into a mechanism seen from the front with no rotate() at all:
//   - everything that TURNS (gear, pulley, flywheel, fan, cam, camshaft, crankshaft, shaft, bearing) has its axis along z;
//   - everything that SLIDES or stands (piston, valve, spring, coil, bolt, liner, block) has its axis along y;
//   - the connecting rod and the rack lie in the x-y plane.
// `bore`, `journal`, `crankpin`, `head`, `stem`, `diameter`, `hub`, `wire` are DIAMETERS (the way such parts are
// specified); `radius` is always a radius.
import {
  boxOf, clamp, defineKind, defineKindMethod, dist, isNode, qconj, qrot, sub, toVec3,
  type Box3, type Frame, type Handle, type MNode, type Resolved, type Schema, type SceneModel, type TRS, type Vec3,
} from '../core/index.ts'
import { camFromTiming } from '../lib/kinematics.ts'
import { gearDimensions } from '../lib/profiles.ts'
import { sdfBox, sdfCylinder, sdfTube } from '../lib/solids/sdf.ts'

/**
 * Every number that shapes a kit part and is not an option of the part itself. Proportions are shares of the option
 * named in the comment. Change them before creating parts (`kit.defaults.segments = 96`); each proportion can also be
 * overridden per part with the option of the same meaning (`kit.piston({ height: 1.2 })`).
 */
export const KIT = {
  /** segments round a full turn of every revolved surface */
  segments: 64,
  /** edges sharper than this many degrees are shaded as corners; flatter ones are smoothed */
  crease: 35,
  /** how much wider a hole is than the pin or shaft meant for it (a visible, believable fit) */
  fit: 1.02,
  gear: { /** gap between meshing flanks along the pitch circle, share of the module */ backlash: 0.08, /** hub length, share of the face width */ hubWidth: 1.6, /** rim of a ring gear outside the tooth roots, in modules */ rim: 2 },
  rack: { /** body under the tooth roots, in modules */ height: 2 },
  piston: { /** radial gap to the bore, share of the bore */ clearance: 0.012, /** overall height, share of the bore */ height: 0.72, /** crown above the pin axis, share of the bore */ pinHeight: 0.37, /** wrist pin diameter, share of the bore */ pin: 0.25, /** skirt wall, share of the bore */ wall: 0.07, /** radius of the pin bosses, share of the pin radius */ boss: 1.5, /** where the bosses start, share of the piston radius from the middle (the rod's small end runs between them) */ bossGap: 0.42 },
  conRod: { /** outer radius of the big end, share of its bore */ bigEnd: 0.68, /** outer radius of the small end, share of its bore */ smallEnd: 0.78, /** beam width at the small end, share of the small-end outer radius */ beam: 0.95, /** the pins a rod holds when its bores are not given: the default crank pin and the wrist pin of the default piston (diameters) */ pins: [1, 0.5] },
  crankshaft: { /** counterweight radius, share of the throw */ counterweight: 1.45, /** length of each main journal outside the webs, share of the journal diameter */ journalLength: 0.6, /** outline of a web round a journal or the pin, share of that radius (the value src/lib/profiles draws the web with) */ boss: 1.35 },
  valve: { /** stem diameter, share of the head diameter */ stem: 0.17, /** overall length, share of the head diameter */ length: 3.1 },
  pulley: { /** groove depth, share of the radius */ groove: 0.16, /** rim under the groove, share of the radius */ rim: 0.1, /** thickness of the web, share of the width */ web: 0.45, /** hub diameter, share of the radius */ hub: 0.5 },
  flywheel: { /** radial thickness of the rim, share of the radius */ rim: 0.2, /** thickness of the web, share of the width */ web: 0.32, /** hub diameter, share of the radius */ hub: 0.5, /** diameter of the lightening holes, share of the free web */ hole: 0.5 },
  spring: { /** points per turn of the coil centre line */ perTurn: 24, /** sides of the wire cross-section */ sides: 10 },
  fan: { /** blade thickness, share of the radius */ thickness: 0.025, /** radial stations along a blade */ stations: 16, /** extra blade angle at the root and at the tip, degrees (a propeller's twist) */ twist: [14, -6], /** share of the span where the round tip begins */ tip: 0.7, /** share of the gap to its neighbour that a blade may fill */ fill: 0.86 },
  pipe: { /** corner radius of a bend, share of the pipe radius */ bend: 2.5, /** wall thickness, share of the radius */ wall: 0.18 },
  bolt: { /** head across flats, share of the diameter */ head: 1.7, /** head height, share of the diameter */ headHeight: 0.65 },
  liner: { /** wall thickness, share of the bore */ wall: 0.06 },
  block: { /** width and depth, share of the bore */ size: 1.5 },
  belt: { /** thickness, share of the smaller wheel radius */ thickness: 0.12, /** rib spacing, in belt thicknesses */ pitch: 2.5, /** colour: rubber, but light enough to read on a black stage */ color: '#7C838C', /** width, share of the first wheel's width */ width: 0.6, /** a rib: length along the belt and height, in belt thicknesses */ rib: [0.9, 0.5] },
}
/**
 * The defaults of this module as one scene sees them: `KIT`, with whatever the engine's config store holds under
 * 'kit.<name>' (model.config('kit.<name>', fallback), when the core has one). Worked out once per scene.
 */
export const kitDefaults = (model: SceneModel): typeof KIT => model.store<typeof KIT>('kit.defaults', () => {
  const ask = (model as unknown as { config?: (key: string, fallback: unknown) => unknown }).config
  if (typeof ask !== 'function') return KIT
  const out = { ...KIT } as Record<string, unknown>
  for (const key of Object.keys(out)) { const v = ask.call(model, 'kit.' + key, out[key]); if (v !== undefined && typeof v === typeof out[key]) out[key] = v }
  return out as typeof KIT
})

const LOOK: Schema = {
  color: { type: 'color', nullable: true, default: null, example: 'color: BLUE' },
  material: { type: 'material', default: 'steel', example: "material: 'steel'" },
  /** a housing that may contain other parts without that being an error (check) */
  shell: { type: 'boolean', default: false, dynamic: false },
}
const opt = (example: string): { type: 'positive'; nullable: true; default: null; example: string } => ({ type: 'positive', nullable: true, default: null, example })
const CUT = { type: ['none', 'quarter', 'half'] as string[], default: 'none', dynamic: false, example: "cut: 'half'" }
const DEG = Math.PI / 180

/** signed distance to a cylinder whose axis is z (the library's are along y) */
const sdfDisc = (p: Vec3, radius: number, width: number): number => sdfCylinder([p[0], p[2], p[1]], radius, width)
/** signed distance to a ring (bore through it) whose axis is z */
const sdfRing = (p: Vec3, radius: number, bore: number, width: number): number => (bore > 0 ? sdfTube([p[0], p[2], p[1]], radius, radius - bore, width) : sdfDisc(p, radius, width))
const circle = (radius: number, z: number, n = 12): Vec3[] => Array.from({ length: n }, (_, i) => [radius * Math.cos((i / n) * 2 * Math.PI), radius * Math.sin((i / n) * 2 * Math.PI), z] as Vec3)
/** silhouette of a wheel-like part (axis z): two circles */
const wheelHull = (radius: number, half: number): Vec3[] => [...circle(radius, half), ...circle(radius, -half)]

// ── gear ─────────────────────────────────────────────────────────────────────────────────────────────
export interface GearDims { teeth: number; module: number; pitchRadius: number; tipRadius: number; rootRadius: number; /** outermost radius (tooth tips, or the rim of a ring gear) */ outer: number; boreRadius: number; hubRadius: number; half: number; halfHub: number; backlash: number; internal: boolean; pressureAngle: number }
export function gearDims(r: Resolved): GearDims {
  const internal = r.internal === true
  const backlash = KIT.gear.backlash * r.module
  const g = gearDimensions({ teeth: r.teeth, module: r.module, pressureAngle: r.pressureAngle, internal, backlash })
  const outer = internal ? g.rootRadius + (r.rim ?? KIT.gear.rim * g.module) : g.tipRadius
  const boreRadius = internal ? 0 : Math.min(r.bore / 2, 0.8 * g.rootRadius)
  const hubRadius = internal || !(r.hub > 0) ? 0 : clamp(r.hub / 2, boreRadius * 1.1, 0.92 * g.rootRadius)
  const half = r.width / 2
  return { teeth: g.teeth, module: g.module, pitchRadius: g.pitchRadius, tipRadius: g.tipRadius, rootRadius: g.rootRadius, outer, boreRadius, hubRadius, half, halfHub: hubRadius > 0 ? Math.max(half, (r.hubWidth ?? KIT.gear.hubWidth * r.width) / 2) : half, backlash, internal, pressureAngle: g.pressureAngle }
}
export const gear = defineKind({
  name: 'gear', space: '3d', solid: true, chunk: 'kit',
  schema: {
    teeth: { type: 'int', default: 20, example: 'teeth: 20' },
    module: { type: 'positive', default: 0.25, example: 'module: 0.25' },
    width: { type: 'positive', default: 0.5 },
    bore: { type: 'nonneg', default: 0, example: 'bore: 0.5' },
    hub: { type: 'nonneg', default: 0, example: 'hub: 1' },
    hubWidth: opt('hubWidth: 0.8'),
    pressureAngle: { type: 'positive', default: 20 },
    internal: { type: 'boolean', default: false, dynamic: false, example: 'internal: true' },
    rim: opt('rim: 0.5'),
    ...LOOK,
  },
  aliases: { toothCount: 'teeth', thickness: 'width', ring: 'internal' },
  bounds: (_n, r) => { const d = gearDims(r); return boxOf(d.outer, d.outer, d.halfHub) },
  hull: (_n, r) => { const d = gearDims(r); return wheelHull(d.outer, d.halfHub) },
  anchors: (_n, r) => ({ pitch: [gearDims(r).pitchRadius, 0, 0] }),
  // the pitch cylinder: two meshing gears touch along it without counting as inside each other
  sdf: (_n, r, p) => { const d = gearDims(r); return d.internal ? sdfRing(p, d.outer, d.pitchRadius, 2 * d.half) : sdfRing(p, d.pitchRadius, d.boreRadius, 2 * d.half) },
  init(node, model) {
    const t = node.props.teeth
    if (typeof t === 'number' && t < 6) model.diagnostics.add({ code: 'NUM-INVALID', ids: [node.id], measured: t, limit: 6, what: `kit.gear(): ${t} teeth is too few for an involute gear to turn smoothly (it is drawn with ${Math.max(3, Math.round(t))}).`, fix: ['teeth: 12'] }, node.src)
  },
})

// ── rack ─────────────────────────────────────────────────────────────────────────────────────────────
export interface RackDims { teeth: number; module: number; pitch: number; length: number; top: number; bottom: number; half: number; backlash: number }
export function rackDims(r: Resolved): RackDims {
  const teeth = Math.max(1, Math.round(r.teeth)), pitch = Math.PI * r.module
  return { teeth, module: r.module, pitch, length: teeth * pitch, top: r.module, bottom: -(1.25 * r.module + (r.height ?? KIT.rack.height * r.module)), half: r.width / 2, backlash: KIT.gear.backlash * r.module }
}
/** a straight gear: along x, teeth pointing +y, the pitch line through the origin */
export const rack = defineKind({
  name: 'rack', space: '3d', solid: true, chunk: 'kit',
  schema: { teeth: { type: 'int', default: 12 }, module: { type: 'positive', default: 0.25 }, width: { type: 'positive', default: 0.5 }, height: opt('height: 0.5'), pressureAngle: { type: 'positive', default: 20 }, ...LOOK },
  aliases: { thickness: 'width' },
  bounds: (_n, r): Box3 => { const d = rackDims(r); return { min: [-d.length / 2, d.bottom, -d.half], max: [d.length / 2, d.top, d.half] } },
  anchors: () => ({ pitch: [0, 0, 0] }),
  sdf: (_n, r, p) => { const d = rackDims(r); return sdfBox([p[0], p[1] - d.bottom / 2, p[2]], d.length, -d.bottom, 2 * d.half) },
})

// ── shaft ────────────────────────────────────────────────────────────────────────────────────────────
/** a round bar along z */
export const shaft = defineKind({
  name: 'shaft', space: '3d', solid: true, chunk: 'kit',
  schema: { radius: { type: 'positive', default: 0.25 }, length: { type: 'positive', default: 4 }, ...LOOK },
  bounds: (_n, r) => boxOf(r.radius, r.radius, r.length / 2),
  hull: (_n, r) => wheelHull(r.radius, r.length / 2),
  sdf: (_n, r, p) => sdfDisc(p, r.radius, r.length),
})

// ── bearing ──────────────────────────────────────────────────────────────────────────────────────────
/** a ball bearing, axis along z */
export const bearing = defineKind({
  name: 'bearing', space: '3d', solid: true, chunk: 'kit',
  schema: { bore: { type: 'positive', default: 0.5, example: 'bore: 0.5' }, radius: { type: 'positive', default: 0.6 }, width: { type: 'positive', default: 0.3 }, balls: { type: 'int', nullable: true, default: null, example: 'balls: 9' }, ...LOOK },
  bounds: (_n, r) => boxOf(r.radius, r.radius, r.width / 2),
  hull: (_n, r) => wheelHull(r.radius, r.width / 2),
  sdf: (_n, r, p) => sdfRing(p, r.radius, Math.min(r.bore / 2, 0.9 * r.radius), r.width),
  init(node, model) {
    const { bore, radius } = node.props as { bore: unknown; radius: unknown }
    if (typeof bore === 'number' && typeof radius === 'number' && bore / 2 >= radius) model.diagnostics.add({ code: 'NUM-INVALID', ids: [node.id], measured: bore, limit: 2 * radius, what: `kit.bearing(): the bore (${bore}, a diameter) is not smaller than the outside (radius ${radius}).`, fix: [`radius: ${Math.round(bore * 120) / 100}`] }, node.src)
  },
})

// ── spring and coil ──────────────────────────────────────────────────────────────────────────────────
/** a compression spring standing along y; its length is an option and may follow anything */
export const spring = defineKind({
  name: 'spring', space: '3d', chunk: 'kit',
  schema: { radius: { type: 'positive', default: 0.4 }, wire: { type: 'positive', default: 0.08 }, turns: { type: 'positive', default: 6 }, length: { type: 'positive', default: 2, example: 'length: () => 2 - lift()' }, ...LOOK },
  aliases: { coils: 'turns', height: 'length' },
  bounds: (_n, r) => boxOf(r.radius + r.wire / 2, r.length / 2, r.radius + r.wire / 2),
})
/**
 * spring.span(a, b): stand the spring between two points; its length follows the distance between them.
 * Each end is a point, an object (its centre) or an anchor.
 */
defineKindMethod('spring', 'span', (node: Handle, a: unknown, b: unknown) => {
  const model = node.model
  const end = (v: unknown, name: string): unknown => toVec3(v) ?? (isNode(v) || typeof v === 'function' ? v : model.resolveNode(v, 'spring.span()', name))
  const pa = end(a, 'a'), pb = end(b, 'b')
  if (!pa || !pb) return node
  if (node.placement) model.diagnostics.add({ code: 'PLACE-CONFLICT', ids: [node.id], what: `#${node.id} already has a placement (${node.placement.type}); span() replaces it.`, fix: [`remove the earlier placement of #${node.id}`] })
  node.placement = { type: 'between', a: pa, b: pb }
  // the same two points give the length, in the spring's own units
  node.props.length = () => { const f = model.now(); return Math.max(1e-6, dist(f.point(pa, node), f.point(pb, node)) / ((node.parent ? f.world(node.parent).s : 1) * f.ownScale(node))) }
  model.revision++
  return node
})
/** a wound coil of wire standing along y, with a straight lead at each end (anchors start and end) */
export const coil = defineKind({
  name: 'coil', space: '3d', chunk: 'kit',
  schema: { radius: { type: 'positive', default: 0.4 }, wire: { type: 'positive', default: 0.06 }, turns: { type: 'positive', default: 12 }, length: { type: 'positive', default: 1.6 }, leads: { type: 'nonneg', default: 0.4 }, color: { type: 'color', nullable: true, default: null }, material: { type: 'material', default: 'copper' }, shell: LOOK.shell! },
  aliases: { windings: 'turns', height: 'length' },
  bounds: (_n, r): Box3 => ({ min: [-(r.radius + r.wire / 2), -r.length / 2, -(r.radius + r.wire / 2)], max: [r.radius + r.wire / 2 + r.leads, r.length / 2, r.radius + r.wire / 2] }),
  anchors: (_n, r) => ({ start: [r.radius + r.leads, -r.length / 2 + r.wire / 2, 0], end: [r.radius + r.leads, r.length / 2 - r.wire / 2, 0] }),
})

// ── piston ───────────────────────────────────────────────────────────────────────────────────────────
export interface PistonDims { radius: number; height: number; /** y of the wrist pin axis (the part is centred on its box) */ pinY: number; pinRadius: number; wall: number; crown: number; rings: number }
export function pistonDims(r: Resolved): PistonDims {
  const height = r.height ?? KIT.piston.height * r.bore
  const radius = (r.bore / 2) * (1 - 2 * KIT.piston.clearance)
  const pinHeight = clamp(r.pinHeight ?? KIT.piston.pinHeight * r.bore, 0.15 * height, 0.85 * height)
  const pinRadius = Math.min((r.pin ?? KIT.piston.pin * r.bore) / 2, 0.3 * radius, 0.4 * (height - pinHeight))
  return { radius, height, pinY: height / 2 - pinHeight, pinRadius, wall: Math.min(KIT.piston.wall * r.bore, 0.5 * radius), crown: clamp(r.crown, -0.3 * height, 0.5 * radius), rings: Math.max(0, Math.round(r.rings)) }
}
/** a piston standing along y, sized by the bore it runs in; hollow underneath, with ring grooves and a wrist pin */
export const piston = defineKind({
  name: 'piston', space: '3d', solid: true, chunk: 'kit',
  schema: { bore: { type: 'positive', default: 2, example: 'bore: 2' }, height: opt('height: 1.4'), pinHeight: opt('pinHeight: 0.7'), pin: opt('pin: 0.5'), rings: { type: 'int', default: 3 }, crown: { type: 'number', default: 0, example: 'crown: 0.1' }, color: LOOK.color!, material: { type: 'material', default: 'aluminium' }, shell: LOOK.shell! },
  aliases: { diameter: 'bore', compressionHeight: 'pinHeight' },
  bounds: (_n, r): Box3 => { const d = pistonDims(r); return { min: [-d.radius, -d.height / 2, -d.radius], max: [d.radius, d.height / 2 + Math.max(0, d.crown), d.radius] } },
  anchors: (_n, r) => { const d = pistonDims(r); return { pin: [0, d.pinY, 0], crown: [0, d.height / 2 + d.crown, 0], skirt: [0, -d.height / 2, 0] } },
  // a cup: the crown slab on top of a skirt tube, so the rod's small end inside it is not a collision
  sdf: (_n, r, p) => {
    const d = pistonDims(r), slab = Math.min(d.height, 1.6 * d.wall + Math.max(0, -d.crown))
    return Math.min(sdfCylinder([p[0], p[1] - (d.height - slab) / 2, p[2]], d.radius, slab), sdfTube(p, d.radius, d.wall, d.height))
  },
})

// ── connecting rod ───────────────────────────────────────────────────────────────────────────────────
export interface ConRodDims { length: number; bigRadius: number; smallRadius: number; bigBore: number; smallBore: number; half: number; beam: number }
export function conRodDims(r: Resolved): ConRodDims {
  // a bore is a little wider than the pin it holds
  const big = r.bigEnd ?? KIT.fit * KIT.conRod.pins[0]!, small = r.smallEnd ?? KIT.fit * KIT.conRod.pins[1]!
  const bigRadius = Math.max(KIT.conRod.bigEnd * big, 0.55 * big), smallRadius = Math.max(KIT.conRod.smallEnd * small, 0.55 * small)
  return { length: r.length, bigRadius, smallRadius, bigBore: big / 2, smallBore: small / 2, half: r.thickness / 2, beam: KIT.conRod.beam * smallRadius * 2 }
}
/** a connecting rod in the x-y plane: big end (the crank side) down, small end (the piston side) up; `length` is centre to centre */
export const conRod = defineKind({
  name: 'conRod', space: '3d', solid: true, chunk: 'kit',
  schema: { length: { type: 'positive', default: 3.25, example: 'length: 3.25' }, bigEnd: opt('bigEnd: 1.02'), smallEnd: opt('smallEnd: 0.51'), thickness: { type: 'positive', default: 0.45 }, ...LOOK },
  aliases: { width: 'thickness', depth: 'thickness' },
  bounds: (_n, r): Box3 => { const d = conRodDims(r); return { min: [-d.bigRadius, -d.length / 2 - d.bigRadius, -d.half], max: [d.bigRadius, d.length / 2 + d.smallRadius, d.half] } },
  anchors: (_n, r) => ({ bigEnd: [0, -r.length / 2, 0], smallEnd: [0, r.length / 2, 0] }),
  // two eyes with their bores open, joined by the beam
  sdf: (_n, r, p) => {
    const d = conRodDims(r), h = d.length / 2
    const ring = (y: number, outer: number, bore: number): number => Math.abs(Math.hypot(p[0], p[1] - y) - (outer + bore) / 2) - (outer - bore) / 2
    const beamY = Math.abs(p[1] - (d.smallRadius - d.bigRadius) / 2) - Math.max(0, h - (d.bigRadius + d.smallRadius) / 2), beamX = Math.abs(p[0]) - d.beam / 2
    const beam = Math.min(Math.max(beamX, beamY), 0) + Math.hypot(Math.max(beamX, 0), Math.max(beamY, 0))
    const flat = Math.min(ring(-h, d.bigRadius, d.bigBore), ring(h, d.smallRadius, d.smallBore), beam), dz = Math.abs(p[2]) - d.half
    return Math.min(Math.max(flat, dz), 0) + Math.hypot(Math.max(flat, 0), Math.max(dz, 0))
  },
})

// ── crankshaft ───────────────────────────────────────────────────────────────────────────────────────
export interface CrankDims { throw: number; journalRadius: number; pinRadius: number; web: number; /** half the gap between the two webs (where the rod runs) */ gap: number; half: number; /** z of the front end: the end of the journal, or of the pin of an overhung crank */ front: number; overhung: boolean; counterweight: number; /** outline radius of the web round the main journal / the pin */ mainBoss: number; pinBoss: number }
export function crankDims(r: Resolved): CrankDims {
  const journalRadius = r.journal / 2, pinRadius = r.crankpin / 2, gap = r.pinLength / 2
  const half = Math.max((r.length ?? r.pinLength + 2 * r.webThickness + 2 * KIT.crankshaft.journalLength * r.journal) / 2, gap + r.webThickness)
  const counterweight = r.counterweight ?? KIT.crankshaft.counterweight * r.throw
  const overhung = r.overhung === true
  return { throw: r.throw, journalRadius, pinRadius, web: r.webThickness, gap, half, front: overhung ? gap : half, overhung, counterweight, mainBoss: KIT.crankshaft.boss * journalRadius, pinBoss: KIT.crankshaft.boss * pinRadius }
}
/**
 * one throw of a crankshaft, axis along z: two main journals, two webs with counterweights, the crank pin at +y.
 * overhung: true keeps only the back journal and web, with the pin standing out in front of it (the rod is then in full view)
 */
export const crankshaft = defineKind({
  name: 'crankshaft', space: '3d', solid: true, chunk: 'kit',
  schema: {
    throw: { type: 'positive', default: 1, example: 'throw: 1' }, journal: { type: 'positive', default: 1.2 }, crankpin: { type: 'positive', default: 1 },
    webThickness: { type: 'positive', default: 0.4 }, pinLength: { type: 'positive', default: 0.6 }, length: opt('length: 3'), counterweight: { type: 'nonneg', nullable: true, default: null, example: 'counterweight: 1.5' },
    overhung: { type: 'boolean', default: false, dynamic: false, example: 'overhung: true' }, ...LOOK,
  },
  aliases: { radius: 'throw', stroke: 'throw' },
  bounds: (_n, r): Box3 => { const d = crankDims(r), x = Math.max(d.counterweight, d.mainBoss, d.pinBoss); return { min: [-x, -Math.max(d.counterweight, d.mainBoss), -d.half], max: [x, Math.max(d.throw + d.pinBoss, d.mainBoss), d.front] } },
  anchors: (_n, r) => { const d = crankDims(r); return { main: [0, 0, 0], pin: [0, d.throw, 0], nose: [0, 0, d.overhung ? -d.gap : d.half], tail: [0, 0, -d.half] } },
  // the journals, the pin and the arms; the counterweights are left out (smaller than the truth, never larger)
  sdf: (_n, r, p) => {
    const d = crankDims(r), z = d.overhung ? -p[2] : Math.abs(p[2])
    const journal = sdfDisc([p[0], p[1], z - (d.half + d.gap + d.web) / 2], d.journalRadius, d.half - d.gap - d.web)
    const pin = d.overhung ? sdfDisc([p[0], p[1] - d.throw, p[2] + d.web / 2], d.pinRadius, 2 * d.gap + d.web) : sdfDisc([p[0], p[1] - d.throw, p[2]], d.pinRadius, 2 * (d.gap + d.web))
    const t = clamp(p[1] / d.throw, 0, 1), arm2 = Math.hypot(p[0], p[1] - t * d.throw) - (d.mainBoss + (d.pinBoss - d.mainBoss) * t), dz = Math.abs(z - d.gap - d.web / 2) - d.web / 2
    return Math.min(journal, pin, Math.min(Math.max(arm2, dz), 0) + Math.hypot(Math.max(arm2, 0), Math.max(dz, 0)))
  },
})

// ── valve ────────────────────────────────────────────────────────────────────────────────────────────
export interface ValveDims { headRadius: number; stemRadius: number; length: number; /** y of the middle of the seat band */ seatY: number }
export function valveDims(r: Resolved): ValveDims {
  const headRadius = r.head / 2, length = Math.max(r.length ?? KIT.valve.length * r.head, 0.75 * r.head)
  return { headRadius, stemRadius: clamp((r.stem ?? KIT.valve.stem * r.head) / 2, 0.02 * headRadius, 0.7 * headRadius), length, seatY: -length / 2 + 0.12 * headRadius }
}
/** a poppet valve standing along y, head down */
export const valve = defineKind({
  name: 'valve', space: '3d', solid: true, chunk: 'kit',
  schema: { head: { type: 'positive', default: 0.8, example: 'head: 0.8' }, stem: opt('stem: 0.14'), length: opt('length: 2.5'), seatAngle: { type: 'positive', default: 45 }, ...LOOK },
  aliases: { diameter: 'head' },
  bounds: (_n, r) => { const d = valveDims(r); return boxOf(d.headRadius, d.length / 2, d.headRadius) },
  anchors: (_n, r) => { const d = valveDims(r); return { seat: [0, d.seatY, 0], tip: [0, d.length / 2, 0], head: [0, -d.length / 2, 0] } },
  sdf: (_n, r, p) => { const d = valveDims(r), disc = 0.24 * d.headRadius; return Math.min(sdfCylinder(p, d.stemRadius, d.length), sdfCylinder([p[0], p[1] + d.length / 2 - disc / 2, p[2]], d.headRadius, disc)) },
})

// ── cam and camshaft ─────────────────────────────────────────────────────────────────────────────────
export interface CamShape { baseRadius: number; noseRadius: number; distance: number; /** false when no two-circle lobe gives that lift in that many degrees on that base circle */ valid: boolean }
/** The two-circle lobe that lifts a flat follower by `lift` over `duration` degrees of cam rotation. */
export function camShape(baseRadius: number, lift: number, duration: number): CamShape {
  const c = camFromTiming({ lift, duration: clamp(duration, 10, 350), baseRadius, cycle: 360 })
  if (c.valid) return { baseRadius, noseRadius: c.noseRadius, distance: c.distance, valid: true }
  // no such lobe: keep the lift and the base circle (the open time comes out longer than asked for)
  const noseRadius = 0.08 * baseRadius
  return { baseRadius, noseRadius, distance: baseRadius + lift - noseRadius, valid: false }
}
function checkCam(node: MNode, model: SceneModel, call: string): void {
  const { baseRadius: b, lift, duration } = node.props as Record<string, unknown>
  if (typeof b !== 'number' || typeof lift !== 'number' || typeof duration !== 'number' || camShape(b, lift, duration).valid) return
  const half = (clamp(duration, 10, 350) / 2) * DEG, least = (lift * Math.cos(half)) / (1 - Math.cos(half))
  model.diagnostics.add({ code: 'NUM-INVALID', ids: [node.id], measured: b, limit: Math.ceil(least * 105) / 100, what: `${call}: no lobe on a base circle of radius ${b} lifts ${lift} in ${duration}° (the base circle must be larger than ${Math.round(least * 1000) / 1000}); the lobe is drawn with a longer open time.`, fix: [`baseRadius: ${Math.ceil(least * 115) / 100}`, `or lift: ${Math.floor(((b * (1 - Math.cos(half))) / Math.cos(half)) * 90) / 100}`] }, node.src)
}
const CAM: Schema = { baseRadius: { type: 'positive', default: 0.32 }, lift: { type: 'positive', default: 0.18, example: 'lift: 0.18' }, duration: { type: 'positive', default: 120, example: 'duration: 120' } }
/** one cam lobe, axis along z, nose along +x; `duration` = degrees of CAM rotation during which a flat follower is lifted */
export const cam = defineKind({
  name: 'cam', space: '3d', solid: true, chunk: 'kit',
  schema: { ...CAM, width: { type: 'positive', default: 0.35 }, bore: { type: 'nonneg', default: 0 }, ...LOOK },
  aliases: { thickness: 'width', radius: 'baseRadius' },
  bounds: (_n, r): Box3 => ({ min: [-r.baseRadius, -r.baseRadius, -r.width / 2], max: [r.baseRadius + r.lift, r.baseRadius, r.width / 2] }),
  anchors: (_n, r) => ({ nose: [r.baseRadius + r.lift, 0, 0], axis: [0, 0, 0] }),
  sdf: (_n, r, p) => sdfRing(p, r.baseRadius, Math.min(r.bore / 2, 0.9 * r.baseRadius), r.width),
  init: (node, model) => checkCam(node, model, 'kit.cam()'),
})
export interface Lobe { offset: number; angle: number }
export const lobesOf = (r: Resolved): Lobe[] => (Array.isArray(r.lobes) ? r.lobes : []).map((l: Partial<Lobe>) => ({ offset: Number.isFinite(l?.offset) ? l.offset! : 0, angle: Number.isFinite(l?.angle) ? l.angle! : 0 }))
/** a shaft along z carrying cam lobes: each lobe has an offset along the shaft and the angle of its nose (0 = +x) */
export const camshaft = defineKind({
  name: 'camshaft', space: '3d', solid: true, chunk: 'kit',
  schema: {
    length: { type: 'positive', default: 4 }, radius: { type: 'positive', default: 0.2 },
    lobes: { type: { array: { type: { object: { offset: { type: 'number', default: 0 }, angle: { type: 'number', default: 0 } } } } }, default: [{ offset: -0.8, angle: 0 }, { offset: 0.8, angle: 90 }], example: 'lobes: [{ offset: -0.8, angle: 0 }, { offset: 0.8, angle: 90 }]' },
    ...CAM, lobeWidth: { type: 'positive', default: 0.35 }, ...LOOK,
  },
  bounds: (_n, r) => boxOf(r.baseRadius + r.lift, r.baseRadius + r.lift, r.length / 2),
  hull: (_n, r) => wheelHull(r.baseRadius + r.lift, r.length / 2),
  anchors: (_n, r) => Object.fromEntries(lobesOf(r).map((l, i) => [`lobe${i + 1}`, [0, 0, l.offset] as Vec3])),
  sdf: (_n, r, p) => Math.min(sdfDisc(p, r.radius, r.length), ...lobesOf(r).map((l) => sdfDisc([p[0], p[1], p[2] - l.offset], r.baseRadius, r.lobeWidth))),
  init: (node, model) => checkCam(node, model, 'kit.camshaft()'),
})

// ── pulley, flywheel ─────────────────────────────────────────────────────────────────────────────────
export const pulleyGroove = (r: Resolved): number => clamp(r.groove ?? KIT.pulley.groove * r.radius, 0, 0.8 * (r.radius - r.bore / 2))
export interface PulleyDims { radius: number; half: number; groove: number; boreRadius: number; hubRadius: number; /** inner radius of the rim: the web lies inside it */ rimInner: number; web: number; holes: number; holeRadius: number; holeCircle: number }
export function pulleyDims(r: Resolved): PulleyDims {
  const boreRadius = Math.min(r.bore / 2, 0.5 * r.radius), groove = pulleyGroove(r)
  const hubRadius = Math.max(1.5 * boreRadius, (KIT.pulley.hub * r.radius) / 2)
  const rimInner = r.radius - groove - KIT.pulley.rim * r.radius
  const free = rimInner - hubRadius, wanted = Math.max(0, Math.round(r.holes))
  // holes only where a web is left to carry them; otherwise the wheel is a plain disc
  const holes = free > 0.2 * r.radius ? wanted : 0, holeCircle = hubRadius + free / 2
  return { radius: r.radius, half: r.width / 2, groove, boreRadius, hubRadius, rimInner, web: KIT.pulley.web * r.width, holes, holeRadius: holes > 0 ? Math.min(0.36 * free, 0.8 * holeCircle * Math.sin(Math.PI / Math.max(holes, 2))) : 0, holeCircle }
}
/** a grooved wheel for a belt, axis along z */
export const pulley = defineKind({
  name: 'pulley', space: '3d', solid: true, chunk: 'kit',
  schema: { radius: { type: 'positive', default: 1 }, width: { type: 'positive', default: 0.4 }, bore: { type: 'nonneg', default: 0 }, groove: { type: 'nonneg', nullable: true, default: null, example: 'groove: 0.15' }, holes: { type: 'int', default: 5, example: 'holes: 5' }, ...LOOK },
  aliases: { thickness: 'width', spokes: 'holes' },
  bounds: (_n, r) => boxOf(r.radius, r.radius, r.width / 2),
  hull: (_n, r) => wheelHull(r.radius, r.width / 2),
  anchors: (_n, r) => ({ rim: [r.radius - pulleyGroove(r), 0, 0] }),
  sdf: (_n, r, p) => sdfRing(p, r.radius, Math.min(r.bore / 2, 0.8 * r.radius), r.width),
})
export interface FlywheelDims { radius: number; half: number; boreRadius: number; hubRadius: number; rim: number; web: number; holes: number; holeRadius: number; holeCircle: number }
export function flywheelDims(r: Resolved): FlywheelDims {
  const boreRadius = Math.min(r.bore / 2, 0.5 * r.radius)
  const rim = clamp(r.rim ?? KIT.flywheel.rim * r.radius, 0.02 * r.radius, 0.6 * r.radius)
  const hubRadius = clamp((r.hub ?? KIT.flywheel.hub * r.radius) / 2, boreRadius * 1.15, 0.6 * (r.radius - rim))
  const free = r.radius - rim - hubRadius, holes = Math.max(0, Math.round(r.holes))
  const holeCircle = hubRadius + free / 2
  // the holes never touch each other, the hub or the rim
  const holeRadius = holes > 0 ? Math.min((KIT.flywheel.hole * free) / 2, 0.8 * holeCircle * Math.sin(Math.PI / Math.max(holes, 2))) : 0
  return { radius: r.radius, half: r.width / 2, boreRadius, hubRadius, rim, web: clamp(r.web ?? KIT.flywheel.web * r.width, 0.05 * r.width, r.width), holes, holeRadius, holeCircle }
}
/** a heavy wheel, axis along z: hub, a thin web with lightening holes, a thick rim */
export const flywheel = defineKind({
  name: 'flywheel', space: '3d', solid: true, chunk: 'kit',
  schema: { radius: { type: 'positive', default: 2 }, width: { type: 'positive', default: 0.5 }, bore: { type: 'nonneg', default: 0 }, rim: opt('rim: 0.4'), web: opt('web: 0.15'), hub: opt('hub: 1'), holes: { type: 'int', default: 6 }, ...LOOK },
  aliases: { thickness: 'width' },
  bounds: (_n, r) => boxOf(r.radius, r.radius, r.width / 2),
  hull: (_n, r) => wheelHull(r.radius, r.width / 2),
  sdf: (_n, r, p) => sdfRing(p, r.radius, Math.min(r.bore / 2, 0.5 * r.radius), r.width),
})

// ── fan ──────────────────────────────────────────────────────────────────────────────────────────────
/** a propeller fan facing +z: a hub with twisted blades */
export const fan = defineKind({
  name: 'fan', space: '3d', chunk: 'kit',
  schema: { blades: { type: 'int', default: 5 }, radius: { type: 'positive', default: 1.5 }, hub: { type: 'positive', default: 0.6 }, pitch: { type: 'number', default: 32, example: 'pitch: 30' }, width: { type: 'positive', default: 0.35 }, color: LOOK.color!, material: { type: 'material', default: 'aluminium' }, shell: LOOK.shell! },
  aliases: { depth: 'width', bladeCount: 'blades' },
  bounds: (_n, r) => boxOf(r.radius, r.radius, r.width / 2),
  hull: (_n, r) => wheelHull(r.radius, r.width / 2),
})

// ── pipe ─────────────────────────────────────────────────────────────────────────────────────────────
/** a pipe through a list of points (world coordinates, objects or anchors), with rounded bends; hollow unless thickness is 0 */
export const pipe = defineKind({
  name: 'pipe', space: '3d', chunk: 'kit', worldGeometry: true, positional: ['path'], required: ['path'],
  schema: {
    path: { type: { array: 'point', min: 2 }, example: 'kit.pipe([[0, 0, 0], [0, 2, 0], [3, 2, 0]], { radius: 0.2 })' },
    radius: { type: 'positive', default: 0.2 }, thickness: { type: 'nonneg', nullable: true, default: null, example: 'thickness: 0.04' }, bend: { type: 'nonneg', nullable: true, default: null, example: 'bend: 0.5' }, ...LOOK,
  },
  aliases: { points: 'path', wall: 'thickness' },
  bounds: (_n, r): Box3 => {
    const pts = (Array.isArray(r.path) ? r.path : []) as Vec3[]
    if (!pts.length) return boxOf(0, 0, 0)
    const b: Box3 = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
    for (const p of pts) for (let k = 0; k < 3; k++) { b.min[k] = Math.min(b.min[k]!, p[k]! - r.radius); b.max[k] = Math.max(b.max[k]!, p[k]! + r.radius) }
    return b
  },
  anchors: (_n, r): Record<string, Vec3> => { const pts = (Array.isArray(r.path) ? r.path : []) as Vec3[]; return pts.length ? { start: [...pts[0]!] as Vec3, end: [...pts[pts.length - 1]!] as Vec3 } : {} },
})

// ── bolt ─────────────────────────────────────────────────────────────────────────────────────────────
export interface BoltDims { radius: number; length: number; headRadius: number; headHeight: number; /** y of the face under the head */ seatY: number }
export function boltDims(r: Resolved): BoltDims {
  const headHeight = r.headHeight ?? KIT.bolt.headHeight * r.diameter
  // `head` is across flats; the corners of the hexagon are 2 / √3 further out
  return { radius: r.diameter / 2, length: r.length, headRadius: (r.head ?? KIT.bolt.head * r.diameter) / Math.sqrt(3), headHeight, seatY: (r.length - headHeight) / 2 }
}
/** a hex bolt standing along y, head up */
export const bolt = defineKind({
  name: 'bolt', space: '3d', solid: true, chunk: 'kit',
  schema: { diameter: { type: 'positive', default: 0.25 }, length: { type: 'positive', default: 1 }, head: opt('head: 0.42'), headHeight: opt('headHeight: 0.16'), ...LOOK },
  bounds: (_n, r) => { const d = boltDims(r); return boxOf(d.headRadius, (d.length + d.headHeight) / 2, d.headRadius) },
  anchors: (_n, r) => { const d = boltDims(r); return { seat: [0, d.seatY, 0], head: [0, d.seatY + d.headHeight, 0], tip: [0, d.seatY - d.length, 0] } },
  sdf: (_n, r, p) => { const d = boltDims(r); return Math.min(sdfCylinder([p[0], p[1] - d.seatY + d.length / 2, p[2]], d.radius, d.length), sdfCylinder([p[0], p[1] - d.seatY - d.headHeight / 2, p[2]], d.headRadius * 0.866, d.headHeight)) },
})

// ── cylinder liner and block: housings with a real bore ───────────────────────────────────────────────
/**
 * Silhouette of a housing of half sizes x, y, z with a cutaway. The box (and with it 'center' and the other standard
 * anchors) stays on the bore axis whatever is cut; only the silhouette follows the cut, so the camera and the frame
 * rules see what is drawn.
 */
const cutHull = (x: number, y: number, z: number, cut: unknown): Vec3[] => {
  const front = cut === 'half' ? 0 : z
  const out: Vec3[] = []
  for (const h of [-y, y]) out.push([-x, h, -z], [x, h, -z], [x, h, cut === 'quarter' ? 0 : front], [-x, h, front], ...(cut === 'quarter' ? [[0, h, z] as Vec3, [0, h, 0] as Vec3] : []))
  return out
}
/** a cylinder sleeve standing along y: `bore` is the diameter of the hole a piston of the same bore runs in */
export const liner = defineKind({
  name: 'liner', space: '3d', solid: true, chunk: 'kit',
  schema: { bore: { type: 'positive', default: 2, example: 'bore: 2' }, height: { type: 'positive', default: 4 }, wall: opt('wall: 0.15'), cut: CUT, color: LOOK.color!, material: { type: 'material', default: 'iron' }, shell: LOOK.shell! },
  aliases: { diameter: 'bore', length: 'height', thickness: 'wall', cutaway: 'cut' },
  bounds: (_n, r) => { const ro = r.bore / 2 + (r.wall ?? KIT.liner.wall * r.bore); return boxOf(ro, r.height / 2, ro) },
  hull: (_n, r) => { const ro = r.bore / 2 + (r.wall ?? KIT.liner.wall * r.bore); return cutHull(ro, r.height / 2, ro, r.cut) },
  anchors: () => ({ bore: [0, 0, 0] }),
  sdf: (_n, r, p) => { const wall = r.wall ?? KIT.liner.wall * r.bore; return sdfTube(p, r.bore / 2 + wall, wall, r.height) },
})
/** a block with a cylinder bored through it along y */
export const block = defineKind({
  name: 'block', space: '3d', solid: true, chunk: 'kit',
  schema: { bore: { type: 'positive', default: 2, example: 'bore: 2' }, width: opt('width: 3'), height: { type: 'positive', default: 4 }, depth: opt('depth: 3'), cut: CUT, color: LOOK.color!, material: { type: 'material', default: 'iron' }, shell: LOOK.shell! },
  aliases: { diameter: 'bore', cutaway: 'cut' },
  bounds: (_n, r) => boxOf((r.width ?? KIT.block.size * r.bore) / 2, r.height / 2, (r.depth ?? KIT.block.size * r.bore) / 2),
  hull: (_n, r) => cutHull((r.width ?? KIT.block.size * r.bore) / 2, r.height / 2, (r.depth ?? KIT.block.size * r.bore) / 2, r.cut),
  anchors: (_n, r) => ({ bore: [0, 0, 0], deck: [0, r.height / 2, 0] }),
  // the box with the bore open
  sdf: (_n, r, p) => Math.max(sdfBox(p, r.width ?? KIT.block.size * r.bore, r.height, r.depth ?? KIT.block.size * r.bore), r.bore / 2 - Math.hypot(p[0], p[2])),
})

// ── belt (made by the belt() mechanism) ──────────────────────────────────────────────────────────────
/** The circle a belt rides on, for any wheel-like part: the groove floor of a pulley, the pitch circle of a gear, else its radius. */
export function wheelRadius(node: MNode, frame: Frame): number {
  // the scale without the part's own world transform: a wheel that a belt turns asks for its radius while it is being placed
  const r = frame.props(node), s = (node.parent ? frame.world(node.parent).s : 1) * frame.ownScale(node)
  if (node.kind === 'pulley') return (r.radius - pulleyGroove(r)) * s
  if (typeof r.teeth === 'number' && typeof r.module === 'number') return ((r.teeth * r.module) / 2) * s
  if (typeof r.radius === 'number') return r.radius * s
  const b = frame.localBounds(node)
  return ((b.max[0] - b.min[0]) / 2) * s
}
export interface BeltShape { /** frame of the first wheel without its turning: the belt lies in its x-y plane */ base: TRS; /** centre of the second wheel in that frame, world units */ center: [number, number]; radiusA: number; radiusB: number; thickness: number; width: number; /** how far the belt has run, world units */ travel: number }
/** filled in by ./mechanisms.ts: the plane of a turning part, and its angle */
export const turning: { base: (node: MNode, frame: Frame) => TRS; angle: (node: MNode, frame: Frame) => number } = { base: (node, frame) => frame.world(node), angle: () => 0 }
export function beltShape(node: MNode, r: Resolved, frame: Frame): BeltShape {
  return frame.memo('kit.belt' + node.uid, () => {
    const a = r.a as MNode, b = r.b as MNode
    const base = turning.base(a, frame)
    const rel = qrot(qconj(base.q), sub(frame.world(b).p, base.p))
    const radiusA = wheelRadius(a, frame), radiusB = wheelRadius(b, frame)
    const thickness = r.thickness ?? KIT.belt.thickness * Math.min(radiusA, radiusB)
    return { base, center: [rel[0], rel[1]] as [number, number], radiusA, radiusB, thickness, width: r.width ?? KIT.belt.width * (frame.localBounds(a).max[2] - frame.localBounds(a).min[2]) * base.s, travel: turning.angle(a, frame) * DEG * (radiusA + thickness / 2) }
  }, { base: { p: [0, 0, 0], q: [0, 0, 0, 1], s: 1 }, center: [1, 0] as [number, number], radiusA: 1, radiusB: 1, thickness: 0.1, width: 0.3, travel: 0 })
}
export const beltKind = defineKind({
  name: 'belt', space: '3d', chunk: 'kit', positional: ['a', 'b'],
  schema: { a: { type: 'node', dynamic: false }, b: { type: 'node', dynamic: false }, width: opt('width: 0.3'), thickness: opt('thickness: 0.08'), ribs: { type: 'boolean', default: true }, color: { type: 'color', nullable: true, default: null }, material: { type: 'material', default: 'rubber' }, shell: LOOK.shell! },
  init(node) { if (node.props.color === null || node.props.color === undefined) node.props.color = () => KIT.belt.color },
  bounds: (node, r, frame): Box3 => {
    if (!isNode(r.a) || !isNode(r.b)) return boxOf(0, 0, 0)
    const s = beltShape(node, r, frame), ra = s.radiusA + s.thickness, rb = s.radiusB + s.thickness
    return { min: [Math.min(-ra, s.center[0] - rb), Math.min(-ra, s.center[1] - rb), -s.width / 2], max: [Math.max(ra, s.center[0] + rb), Math.max(ra, s.center[1] + rb), s.width / 2] }
  },
})

