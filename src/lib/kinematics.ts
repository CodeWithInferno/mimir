/**
 * Kinematics of mechanisms: slider-crank, valve timing, cams, gears, planetary sets, four-bar linkages.
 *
 * Pure maths. No DOM, no three.js, no runtime APIs. Every angle is in DEGREES, counter-clockwise positive.
 * Nothing here throws: impossible inputs give `valid: false`, `null`, or 0 as documented per function.
 */
import type { Vec2 } from './types.ts'

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

/** value wrapped into [0, cycle). `cycle` must be > 0. */
function wrap(value: number, cycle: number): number {
  const m = value % cycle
  return m < 0 ? m + cycle : m
}

// ── slider-crank ─────────────────────────────────────────────────────────────────────────────────────────────

/** Input of {@link sliderCrank}: crank throw (= stroke / 2), rod length centre to centre, crank angle from TDC. */
export interface SliderCrankInput {
  /** Crank radius: distance from the crank centre to the crank pin (half the stroke when offset is 0). */
  throw: number
  /** Connecting-rod length, centre to centre. */
  rod: number
  /** Crank angle in degrees; 0 = crank pin on the slide axis, pointing at the slider (TDC when offset is 0). */
  angle: number
  /** Sideways distance of the slide axis from the crank centre (0 for an ordinary engine). */
  offset?: number
}

/** Output of {@link sliderCrank}. Lengths are in the units of `throw` and `rod`; angles in degrees. */
export interface SliderCrankState {
  /** Distance of the slider pin from the crank centre, measured along the slide axis. */
  position: number
  /** Angle of the rod from the slide axis; positive when the crank pin is on the +sideways side of the slider pin. */
  rodAngle: number
  /** Largest `position` over a revolution (top dead centre). */
  tdc: number
  /** Smallest `position` over a revolution (bottom dead centre). */
  bdc: number
  /** tdc − bdc. Equals 2 × throw when offset is 0. */
  stroke: number
  /** Travel from TDC as a fraction of the stroke: 0 at TDC … 1 at BDC. */
  fraction: number
  /** Crank pin as [sideways, along the slide axis], relative to the crank centre. */
  crankPin: Vec2
  /** d(position) / d(angle), in length units per DEGREE of crank (negative while moving toward the crank). */
  velocity: number
  /** false when the rod is too short to go all the way round (rod < throw + |offset|); numbers stay finite. */
  valid: boolean
}

/** Slider-crank (piston / rod / crank) solved exactly for one crank angle; not a sinusoid. */
export function sliderCrank({ throw: radius, rod, angle, offset = 0 }: SliderCrankInput): SliderCrankState {
  const a = angle * RAD
  const sn = Math.sin(a)
  const cs = Math.cos(a)
  const sideways = radius * sn - offset
  const under = rod * rod - sideways * sideways
  const root = under > 0 ? Math.sqrt(under) : 0
  const position = radius * cs + root
  const reach = Math.abs(radius)
  const top = (rod + reach) * (rod + reach) - offset * offset
  const bottom = (rod - reach) * (rod - reach) - offset * offset
  const valid = rod >= reach + Math.abs(offset) && Number.isFinite(position)
  const tdc = top > 0 ? Math.sqrt(top) : 0
  const bdc = bottom > 0 && rod > reach ? Math.sqrt(bottom) : 0
  const stroke = tdc - bdc
  let fraction = stroke > 0 ? (tdc - position) / stroke : 0
  if (!(fraction > 0)) fraction = 0
  else if (fraction > 1) fraction = 1
  const ratio = rod !== 0 ? sideways / rod : 0
  const rodAngle = Math.asin(ratio < -1 ? -1 : ratio > 1 ? 1 : ratio) * DEG
  const velocity = root > 0 ? (-radius * sn - (sideways * radius * cs) / root) * RAD : 0
  return { position, rodAngle, tdc, bdc, stroke, fraction, crankPin: [radius * sn, radius * cs], velocity, valid }
}

// ── four-stroke cycle helpers ────────────────────────────────────────────────────────────────────────────────

/** The four strokes in order, each 180° of crank, starting at TDC of intake (angle 0). */
export const STROKES = ['intake', 'compression', 'power', 'exhaust'] as const

/** Name of one stroke of the four-stroke cycle. */
export type StrokeName = (typeof STROKES)[number]

/** Which stroke a crank angle falls in (720° cycle, 0 = TDC at the start of intake), and how far through it. */
export function fourStroke(angle: number): { index: number; name: StrokeName; progress: number } {
  const a = Number.isFinite(angle) ? wrap(angle, 720) : 0
  const index = Math.min(3, Math.floor(a / 180))
  return { index, name: STROKES[index] as StrokeName, progress: (a - index * 180) / 180 }
}

const INLINE_FOUR_OFFSETS = [0, 540, 180, 360] as const

/** Crank-angle offset in degrees of cylinder i (1–4) of an inline-four firing 1-3-4-2: cylinder angle = angle − offset. */
export function inlineFour(i: number): number {
  if (!Number.isFinite(i)) return 0
  return INLINE_FOUR_OFFSETS[wrap(Math.round(i) - 1, 4)] as number
}

// ── valves and cams ──────────────────────────────────────────────────────────────────────────────────────────

/** Input of {@link valveLift}. Angles are crank degrees inside one `cycle`. */
export interface ValveLiftInput {
  /** Current crank angle (any real number; wrapped into the cycle). */
  angle: number
  /** Crank angle at which the valve starts to open. */
  opens: number
  /** Crank angle at which the valve is closed again (may be "before" `opens`: the window wraps round the cycle). */
  closes: number
  /** Maximum lift. */
  lift: number
  /** Length of one cycle in crank degrees: 720 for a four-stroke (the cam turns once per cycle). */
  cycle?: number
  /** 'cosine' = raised cosine (smooth start); 'cam' = flat follower on a two-circle lobe (matches camProfile). */
  profile?: 'cosine' | 'cam'
}

/** Valve lift at a crank angle: 0 outside the open window, `lift` at its centre. */
export function valveLift({ angle, opens, closes, lift, cycle = 720, profile = 'cosine' }: ValveLiftInput): number {
  if (!(cycle > 0)) return 0
  const duration = wrap(closes - opens, cycle)
  if (!(duration > 0)) return 0
  const u = wrap(angle - opens, cycle)
  if (!(u < duration)) return 0
  if (profile === 'cam') {
    const toCam = (360 / cycle) * RAD // crank degrees → cam radians
    const edge = Math.cos(0.5 * duration * toCam)
    const span = 1 - edge
    const raised = Math.cos((u - 0.5 * duration) * toCam) - edge
    return span > 0 && raised > 0 ? (lift * raised) / span : 0
  }
  const s = Math.sin((Math.PI * u) / duration)
  return lift * s * s
}

/** A two-circle ("egg") cam lobe: base circle on the cam axis, nose circle `distance` along the lobe centreline. */
export interface CamShape {
  baseRadius: number
  noseRadius: number
  distance: number
}

/** Lift of a flat follower on a two-circle cam; `angle` = cam angle from the lobe centreline (0 = nose on the follower). */
export function camLift({ angle, baseRadius, noseRadius, distance }: CamShape & { angle: number }): number {
  const support = distance * Math.cos(angle * RAD) + noseRadius
  return support > baseRadius ? support - baseRadius : 0
}

/** Two-circle cam that gives `lift` over `duration` crank degrees (same motion as valveLift profile 'cam'). */
export function camFromTiming({
  lift,
  duration,
  baseRadius,
  cycle = 720,
}: {
  lift: number
  duration: number
  baseRadius: number
  cycle?: number
}): CamShape & { valid: boolean } {
  const half = cycle > 0 ? 0.5 * duration * (360 / cycle) * RAD : 0
  const edge = Math.cos(half)
  const span = 1 - edge
  const distance = span > 1e-12 ? lift / span : 0
  const noseRadius = baseRadius - distance * edge
  return { baseRadius, noseRadius, distance, valid: span > 1e-12 && noseRadius > 0 && Number.isFinite(noseRadius) }
}

// ── gears ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Gear ratio teethB / teethA: turns of A per turn of B (2 means B turns at half the speed of A). */
export function gearRatio(teethA: number, teethB: number): number {
  return teethA !== 0 ? teethB / teethA : 0
}

/** Pitch radius of a gear: module × teeth / 2. */
export function pitchRadius(teeth: number, module: number): number {
  return 0.5 * module * teeth
}

/** Distance between the centres of two meshing gears (internal: a pinion inside a ring gear). */
export function centerDistance(teethA: number, teethB: number, module: number, options?: { internal?: boolean }): number {
  return options?.internal ? 0.5 * module * Math.abs(teethB - teethA) : 0.5 * module * (teethA + teethB)
}

/**
 * Rotation of gear B that meshes with gear A turned to `angleA`, half-tooth phase included so teeth interleave.
 * Assumes gearProfile's convention (a tooth centred on +x at angle 0). `direction` = direction in degrees from
 * A's centre to the point where the teeth touch (for an external pair: toward B's centre). Default 0.
 */
export function meshAngle(
  angleA: number,
  teethA: number,
  teethB: number,
  options?: { internal?: boolean; direction?: number },
): number {
  if (!(teethB !== 0)) return 0
  const direction = options?.direction ?? 0
  const turned = ((angleA - direction) * teethA) / teethB
  const halfTooth = 180 / teethB
  return options?.internal ? direction + turned + halfTooth : direction + 180 + halfTooth - turned
}

/** Distance a rack moves when its pinion turns by `angle` degrees (pitchRadius × angle in radians). */
export function rackTravel(angle: number, pitchRadius: number): number {
  return angle * RAD * pitchRadius
}

/**
 * x of a rack tooth centre that meshes a pinion turned to `angle`: pinion centre at [0, pitch radius], rack along x
 * with teeth pointing +y and its pitch line on y = 0 (rackProfile's layout; shift the rack by this amount).
 */
export function rackMesh(angle: number, teeth: number, module: number): number {
  return (angle + 90) * RAD * 0.5 * module * teeth + 0.5 * Math.PI * module
}

// ── planetary gear set ───────────────────────────────────────────────────────────────────────────────────────

/** Input of {@link planetary}: tooth counts plus any two of the three speeds (same unit in, same unit out). */
export interface PlanetaryInput {
  sun: number
  ring: number
  sunSpeed?: number
  ringSpeed?: number
  carrierSpeed?: number
}

/** Output of {@link planetary}: all three member speeds, the planet's absolute spin and its tooth count. */
export interface PlanetaryState {
  sunSpeed: number
  ringSpeed: number
  carrierSpeed: number
  /** Absolute spin of a planet about its own axis (subtract carrierSpeed for the spin seen from the carrier). */
  planetSpeed: number
  /** (ring − sun) / 2. */
  planetTeeth: number
}

/**
 * Willis equation sun·ωs + ring·ωr = (sun + ring)·ωc: give any two speeds, get the third and the planet spin.
 * Returns null when fewer than two speeds are given. With all three, sun and carrier win and ring is recomputed.
 */
export function planetary({ sun, ring, sunSpeed, ringSpeed, carrierSpeed }: PlanetaryInput): PlanetaryState | null {
  const total = sun + ring
  let ws: number
  let wr: number
  let wc: number
  if (sunSpeed !== undefined && carrierSpeed !== undefined) {
    ws = sunSpeed
    wc = carrierSpeed
    wr = ring !== 0 ? (total * wc - sun * ws) / ring : 0
  } else if (sunSpeed !== undefined && ringSpeed !== undefined) {
    ws = sunSpeed
    wr = ringSpeed
    wc = total !== 0 ? (sun * ws + ring * wr) / total : 0
  } else if (ringSpeed !== undefined && carrierSpeed !== undefined) {
    wr = ringSpeed
    wc = carrierSpeed
    ws = sun !== 0 ? (total * wc - ring * wr) / sun : 0
  } else {
    return null
  }
  const planetTeeth = 0.5 * (ring - sun)
  const planetSpeed = planetTeeth !== 0 ? wc - (sun / planetTeeth) * (ws - wc) : wc
  return { sunSpeed: ws, ringSpeed: wr, carrierSpeed: wc, planetSpeed, planetTeeth }
}

/** Output of {@link planetaryPose}: where every gear of the set sits and how it is turned, teeth interleaved. */
export interface PlanetaryPose {
  /** (ring − sun) / 2. */
  planetTeeth: number
  /** Distance of each planet centre from the sun centre: module × (sun + planet) / 2. */
  orbitRadius: number
  /** Direction in degrees from the sun centre to each planet centre. */
  planetDirections: number[]
  /** Centre of each planet. */
  planetCenters: Vec2[]
  /** Rotation of each planet (gearProfile convention). */
  planetAngles: number[]
  /** Rotation of the ring gear (gearProfile `internal: true` convention). */
  ringAngle: number
  /** true when (sun + ring) / planets is a whole number, i.e. evenly spaced planets all mesh. */
  assembles: boolean
}

/** Angles and centres of a planetary set for given sun and carrier angles, phased so every mesh interleaves. */
export function planetaryPose({
  sun,
  ring,
  planets = 3,
  sunAngle = 0,
  carrierAngle = 0,
  module = 1,
}: {
  sun: number
  ring: number
  planets?: number
  sunAngle?: number
  carrierAngle?: number
  module?: number
}): PlanetaryPose {
  const count = Number.isFinite(planets) ? Math.max(1, Math.round(planets)) : 1
  const planetTeeth = 0.5 * (ring - sun)
  const orbitRadius = 0.5 * module * (sun + planetTeeth)
  const planetDirections: number[] = []
  const planetCenters: Vec2[] = []
  const planetAngles: number[] = []
  for (let i = 0; i < count; i++) {
    const direction = carrierAngle + (360 * i) / count
    planetDirections.push(direction)
    planetCenters.push([orbitRadius * Math.cos(direction * RAD), orbitRadius * Math.sin(direction * RAD)])
    planetAngles.push(meshAngle(sunAngle, sun, planetTeeth, { direction }))
  }
  const ringAngle = meshAngle(planetAngles[0] as number, planetTeeth, ring, { internal: true, direction: carrierAngle })
  const perPlanet = (sun + ring) / count
  const assembles = Math.abs(perPlanet - Math.round(perPlanet)) < 1e-9
  return { planetTeeth, orbitRadius, planetDirections, planetCenters, planetAngles, ringAngle, assembles }
}

// ── four-bar linkage ─────────────────────────────────────────────────────────────────────────────────────────

/** Input of {@link fourBar}: the four link lengths and the crank angle from the ground link (+x). */
export interface FourBarInput {
  /** Distance between the two fixed pivots; the rocker pivot is at [ground, 0]. */
  ground: number
  /** Length of the driven link, pivoting at [0, 0]. */
  crank: number
  /** Length of the link joining the crank tip to the rocker tip. */
  coupler: number
  /** Length of the output link, pivoting at [ground, 0]. */
  rocker: number
  /** Crank angle in degrees from +x. */
  angle: number
  /** Pick the crossed assembly (rocker tip on the other side of the line from crank tip to rocker pivot). */
  crossed?: boolean
}

/** Output of {@link fourBar}: the four joints and the link angles (degrees from +x). */
export interface FourBarState {
  crankPivot: Vec2
  crankTip: Vec2
  rockerTip: Vec2
  rockerPivot: Vec2
  /** Direction of the coupler, from the crank tip to the rocker tip. */
  couplerAngle: number
  /** Direction of the rocker, from its pivot to its tip. */
  rockerAngle: number
  /** Angle between coupler and rocker at their joint (near 90° pushes well, near 0° or 180° jams). */
  transmissionAngle: number
}

/** Four-bar linkage solved for one crank angle; null when the links cannot reach each other at that angle. */
export function fourBar({ ground, crank, coupler, rocker, angle, crossed = false }: FourBarInput): FourBarState | null {
  const a = angle * RAD
  const bx = crank * Math.cos(a)
  const by = crank * Math.sin(a)
  const dx = ground - bx
  const dy = -by
  const gap = Math.hypot(dx, dy)
  const slack = 1e-9 * (Math.abs(coupler) + Math.abs(rocker))
  if (!(gap > 1e-12) || !(coupler > 0) || !(rocker > 0)) return null
  if (gap > coupler + rocker + slack || gap < Math.abs(coupler - rocker) - slack) return null
  const along = (coupler * coupler - rocker * rocker + gap * gap) / (2 * gap)
  const rise2 = coupler * coupler - along * along
  const rise = (rise2 > 0 ? Math.sqrt(rise2) : 0) * (crossed ? -1 : 1)
  const ux = dx / gap
  const uy = dy / gap
  const cx = bx + along * ux - rise * uy
  const cy = by + along * uy + rise * ux
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null
  const cosine = (coupler * coupler + rocker * rocker - gap * gap) / (2 * coupler * rocker)
  return {
    crankPivot: [0, 0],
    crankTip: [bx, by],
    rockerTip: [cx, cy],
    rockerPivot: [ground, 0],
    couplerAngle: Math.atan2(cy - by, cx - bx) * DEG,
    rockerAngle: Math.atan2(cy, cx - ground) * DEG,
    transmissionAngle: Math.acos(cosine < -1 ? -1 : cosine > 1 ? 1 : cosine) * DEG,
  }
}
