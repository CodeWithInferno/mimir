// ── parts kit: believable machine parts with named anchors. Build machines from these and the mechanisms below; never from trigonometry. ──
// Orientation: parts that TURN (gear, pulley, flywheel, fan, cam, camshaft, crankshaft, shaft, bearing) have their axis along z, so they face
// the default camera; parts that SLIDE or stand (piston, valve, spring, coil, bolt, liner, block) have their axis along y; the connecting rod
// and the rack lie in the x-y plane. At their defaults the parts mate: a piston of bore 2 runs in a liner of bore 2 on a crankshaft of throw 1.
// `bore`, `journal`, `crankpin`, `head`, `stem`, `diameter`, `hub` and `wire` are DIAMETERS; `radius` is always a radius.

/** A spring: `span(a, b)` stands it between two points and makes its length follow them. */
interface Spring extends PartOf<Spring> {
  /** Stand the spring between two points (points, parts or anchors); its length follows the distance: spring.span(seat.anchor('top'), valve.anchor('tip')). */
  span(a: PointLike, b: PointLike): Spring
}
/** The numbers that shape kit parts beyond their own options (segments round a turn, crease angle, proportions). Change before creating parts. */
interface KitDefaults { segments: number; crease: number; fit: number; [group: string]: number | Record<string, number | number[] | string> }

declare namespace kit {
  /** Involute spur gear, axis z. `module` = tooth size (pitch diameter / teeth): gears mesh only with the same module. `bore` = hole diameter, `hub` = hub diameter. `internal: true` = a ring gear with teeth inside (`rim` = its thickness outside the teeth). Extra anchor: 'pitch'. Place and turn it with gearPair / gearTrain / planetary / rackPinion. */
  function gear(opts?: PartLook & { teeth?: Dyn<number>; module?: Dyn<number>; width?: Dyn<number>; bore?: Dyn<number>; hub?: Dyn<number>; hubWidth?: Dyn<number>; pressureAngle?: Dyn<number>; internal?: boolean; rim?: Dyn<number> }): Part
  /** Straight gear along x, teeth pointing +y, pitch line through its origin. `height` = body under the tooth roots. Extra anchor: 'pitch'. Place it with rackPinion. */
  function rack(opts?: PartLook & { teeth?: Dyn<number>; module?: Dyn<number>; width?: Dyn<number>; height?: Dyn<number>; pressureAngle?: Dyn<number> }): Part
  /** Round bar along z with chamfered ends. Its ends are the anchors 'front' and 'back'. */
  function shaft(opts?: PartLook & { radius?: Dyn<number>; length?: Dyn<number> }): Part
  /** Ball bearing, axis z: `bore` = inner diameter, `radius` = outer radius; the balls are drawn. */
  function bearing(opts?: PartLook & { bore?: Dyn<number>; radius?: Dyn<number>; width?: Dyn<number>; balls?: Dyn<number> }): Part
  /** Compression spring standing along y. `radius` = of the coil, `wire` = wire diameter; `length` may be a function, the coils close up as it shrinks. spring.span(a, b) stands it between two points. */
  function spring(opts?: PartLook & { radius?: Dyn<number>; wire?: Dyn<number>; turns?: Dyn<number>; length?: Dyn<number> }): Spring
  /** Wound coil of wire standing along y (copper), with a straight lead of length `leads` at each end. Extra anchors: 'start', 'end' (the lead tips). */
  function coil(opts?: PartLook & { radius?: Dyn<number>; wire?: Dyn<number>; turns?: Dyn<number>; length?: Dyn<number>; leads?: Dyn<number> }): Part
  /** Piston standing along y, sized by the `bore` (diameter) of the cylinder it runs in; hollow underneath, ring grooves, wrist pin along z. `pinHeight` = crown above the pin axis, `crown` > 0 domes the top, < 0 dishes it. Extra anchors: 'pin', 'crown', 'skirt'. Move it with crankSlider. */
  function piston(opts?: PartLook & { bore?: Dyn<number>; height?: Dyn<number>; pinHeight?: Dyn<number>; pin?: Dyn<number>; rings?: Dyn<number>; crown?: Dyn<number> }): Part
  /** Connecting rod in the x-y plane, big end down. `length` = centre to centre; `bigEnd` / `smallEnd` = bore diameters (a little wider than the crank pin and wrist pin they hold; by default those of the default crankshaft and piston). Extra anchors: 'bigEnd', 'smallEnd'. Place it with crankSlider. */
  function conRod(opts?: PartLook & { length?: Dyn<number>; bigEnd?: Dyn<number>; smallEnd?: Dyn<number>; thickness?: Dyn<number> }): Part
  /** One throw of a crankshaft, axis z: two main journals, two webs with counterweights, the crank pin at +y. `throw` = crank radius = stroke / 2; `counterweight` = its radius (0 for none). overhung: true keeps only the back web, the pin standing out in front (the rod and both pins are then in full view). Extra anchors: 'main', 'pin', 'nose' (front end), 'tail' (back end). Turn it with crankSlider. */
  function crankshaft(opts?: PartLook & { throw?: Dyn<number>; journal?: Dyn<number>; crankpin?: Dyn<number>; webThickness?: Dyn<number>; pinLength?: Dyn<number>; length?: Dyn<number>; counterweight?: Dyn<number>; overhung?: boolean }): Part
  /** Poppet valve standing along y, head down. `head` / `stem` = diameters. Extra anchors: 'seat', 'tip' (top of the stem), 'head' (the face). Move it with camFollower, or .at(x, () => y0 - lift(), z) with valveLift. */
  function valve(opts?: PartLook & { head?: Dyn<number>; stem?: Dyn<number>; length?: Dyn<number>; seatAngle?: Dyn<number> }): Part
  /** One cam lobe, axis z, nose along +x. It lifts a flat follower by `lift` during `duration` degrees of CAM rotation (an engine valve open for 240 crank degrees: duration 120). Extra anchors: 'nose', 'axis'. Turn it with camFollower. */
  function cam(opts?: PartLook & { baseRadius?: Dyn<number>; lift?: Dyn<number>; duration?: Dyn<number>; width?: Dyn<number>; bore?: Dyn<number> }): Part
  /** Shaft along z carrying cam lobes: each lobe has an `offset` along the shaft and the `angle` of its nose (degrees, 0 = +x). Extra anchors: 'lobe1', 'lobe2', … Use camFollower({ cam, lobe: 2, … }). */
  function camshaft(opts?: PartLook & { length?: Dyn<number>; radius?: Dyn<number>; lobes?: { offset: number; angle: number }[]; baseRadius?: Dyn<number>; lift?: Dyn<number>; duration?: Dyn<number>; lobeWidth?: Dyn<number> }): Part
  /** Grooved belt wheel, axis z: rim, web with `holes` (so it is seen to turn; 0 = a plain disc), hub. `groove` = groove depth. Extra anchor: 'rim'. Join two with belt(a, b). */
  function pulley(opts?: PartLook & { radius?: Dyn<number>; width?: Dyn<number>; bore?: Dyn<number>; groove?: Dyn<number>; holes?: Dyn<number> }): Part
  /** Heavy wheel, axis z: hub, thin web with lightening `holes`, thick rim (`rim` = its radial thickness, `hub` = hub diameter). */
  function flywheel(opts?: PartLook & { radius?: Dyn<number>; width?: Dyn<number>; bore?: Dyn<number>; rim?: Dyn<number>; web?: Dyn<number>; hub?: Dyn<number>; holes?: Dyn<number> }): Part
  /** Propeller fan facing +z: hub and twisted blades. `pitch` = blade angle in degrees, `width` = depth along the axis. Spin it: fan.rotate({ about: 'z', deg: () => 120 * s.t() }). */
  function fan(opts?: PartLook & { blades?: Dyn<number>; radius?: Dyn<number>; hub?: Dyn<number>; pitch?: Dyn<number>; width?: Dyn<number> }): Part
  /** Pipe through a list of points (coordinates, parts or anchors) with rounded bends. `thickness` = wall (0 = a solid rod), `bend` = corner radius. Extra anchors: 'start', 'end'. */
  function pipe(path: PointLike[], opts?: PartLook & { radius?: Dyn<number>; thickness?: Dyn<number>; bend?: Dyn<number> }): Part
  /** Hex bolt standing along y, head up. `head` = across flats. Extra anchors: 'seat' (under the head), 'head', 'tip'. bolt.attach(cover, { my: 'seat', to: 'top' }). */
  function bolt(opts?: PartLook & { diameter?: Dyn<number>; length?: Dyn<number>; head?: Dyn<number>; headHeight?: Dyn<number> }): Part
  /** Cylinder sleeve standing along y with a real hole: a piston of the same `bore` runs inside it without touching. cut: 'half' removes the half toward the viewer, 'quarter' the front right quarter, so the inside shows. Extra anchor: 'bore'. */
  function liner(opts?: PartLook & { bore?: Dyn<number>; height?: Dyn<number>; wall?: Dyn<number>; cut?: 'none' | 'quarter' | 'half' }): Part
  /** Block with a cylinder bored through it along y (same `bore` and `cut` as kit.liner). Extra anchors: 'bore', 'deck' (top). */
  function block(opts?: PartLook & { bore?: Dyn<number>; width?: Dyn<number>; height?: Dyn<number>; depth?: Dyn<number>; cut?: 'none' | 'quarter' | 'half' }): Part
  /** Detail and proportions of every kit part: kit.defaults.segments = 96. */
  const defaults: KitDefaults
}

// ── mechanisms: each does the trigonometry of one linkage, places and turns its parts, adds probes "<id>.<name>", and is verified by check (MECH-OPEN) ──
// The plane of a mechanism is the x-y plane of its driving part, which turns about its own z axis: rotate or attach that part and the mechanism follows.
// Directions in that plane: 'up' | 'down' | 'left' | 'right', or degrees counter-clockwise from 'right'. Angles: degrees, counter-clockwise positive from the front.
// Do not place (.at) or rotate about z the parts a mechanism moves: that is PLACE-CONFLICT.

/** A direction in the plane of a mechanism: a side, or degrees counter-clockwise from 'right'. */
type PlaneDirection = 'up' | 'down' | 'left' | 'right' | number
/** What crankSlider returns: lengths in world units, every member follows the current state. */
interface CrankSlider {
  readonly id: string
  /** Distance between top and bottom dead centre. */
  readonly stroke: number
  /** Distance of the slider's pin from the crank axis at top dead centre. */
  readonly tdc: number
  /** The same at bottom dead centre. */
  readonly bdc: number
  /** Distance of the slider's pin from the crank axis now. */
  position(): number
  /** How far the slider has come down from top dead centre: 0 … stroke. */
  travel(): number
  /** Travel as a share of the stroke: 0 at top dead centre, 1 at bottom dead centre (0.579 after a quarter turn of a real engine, not 0.5). */
  fraction(): number
  /** Crank angle from top dead centre, degrees. */
  angle(): number
  /** Tilt of the rod from the slide axis, degrees. */
  rodAngle(): number
}
/**
 * A crank that drives a slider through a rod: crankSlider({ crank, rod, slider: piston, angle: crankAngle }). At angle 0 the crank's 'pin' anchor points along
 * `axis` (top dead centre); the slider's 'pin' anchor (or centre) rides the axis through the crank's centre; the rod spans the two pins. Throw and rod length
 * are read from the parts. `crank`: a kit.crankshaft, or any part with .define('pin', [x, y, 0]). `rod`: a kit.conRod or any part (bottom to top); or give rodLength alone.
 * Probes: <id>.position, <id>.travel, <id>.fraction.
 */
declare function crankSlider(opts: { crank: Part; slider: Part; rod?: Part; rodLength?: Dyn<number>; axis?: Dyn<PlaneDirection>; angle?: Dyn<number> | Param<number>; offset?: Dyn<number>; id?: string }): CrankSlider
/** What gearPair returns. */
interface GearPair {
  readonly id: string
  /** Teeth of b / teeth of a: turns of a for one turn of b. */
  readonly ratio: number
  /** Distance between the two centres. */
  readonly distance: number
  /** Angle of a, degrees. */
  angle(): number
  /** Angle of b, degrees. */
  driven(): number
}
/**
 * Two meshing gears: gearPair(a, b, { angle: turn, direction: 'right' }) puts b beside a at the meshing distance, in a's plane, and turns it so the teeth interleave.
 * `angle` turns a; leave it out when a is already turned (by an earlier gearPair, or because it is attached to a turning shaft). One of the two may be a ring gear
 * (internal: true): the other then runs inside it, touching on the `direction` side. Probes: <id>.ratio, <id>.driven.
 */
declare function gearPair(a: Part, b: Part, opts?: { angle?: Dyn<number> | Param<number>; direction?: Dyn<PlaneDirection>; id?: string }): GearPair
/** What gearTrain returns. */
interface GearTrain {
  readonly id: string
  /** Teeth of the last gear / teeth of the first: turns of the first for one turn of the last. */
  readonly ratio: number
  /** One GearPair per neighbouring pair. */
  readonly pairs: GearPair[]
  /** Angle of gear i (0-based), degrees. */
  angle(i: number): number
  /** How far gear i has turned since the first gear was at angle 0, degrees (negative = the other way round). */
  turned(i: number): number
}
/** A row of meshing gears: gearTrain([a, b, c], { angle: turn, direction: ['right', 'up'] }). `angle` turns the first; each next gear sits beside the one before (one direction for all, or one per pair). */
declare function gearTrain(gears: Part[], opts?: { angle?: Dyn<number> | Param<number>; direction?: PlaneDirection | PlaneDirection[]; id?: string }): GearTrain
/** What rackPinion returns. */
interface RackPinion {
  readonly id: string
  /** How far the rack has moved since angle 0 (angle × pitch radius). */
  travel(): number
}
/** A rack laid against a pinion: rackPinion({ rack, pinion, angle: turn, side: 'below' }). The rack slides as the pinion turns. Probe: <id>.travel. */
declare function rackPinion(opts: { rack: Part; pinion: Part; angle?: Dyn<number> | Param<number>; side?: Dyn<PlaneDirection>; id?: string }): RackPinion
/** What planetary returns. */
interface Planetary {
  readonly id: string
  /** Turns of the input for one turn of the output with this member held (negative: reversed). */
  readonly ratio: number
  /** Angle of the sun, degrees. */
  sun(): number
  /** Angle of the carrier, degrees. */
  carrier(): number
  /** Angle of the ring, degrees. */
  ring(): number
}
/**
 * A planetary gear set: planetary({ sun, planets: [p1, p2, p3], ring, carrier, angle: turn, hold: 'ring' }). The planets are spaced evenly round the sun; the ring
 * (kit.gear with internal: true and sun + 2 × planet teeth) and the optional carrier share its axis. One member is held: with 'ring' or 'carrier' held, `angle` turns
 * the sun; with 'sun' held it turns the carrier. Probes: <id>.sun, <id>.carrier, <id>.ring.
 */
declare function planetary(opts: { sun: Part; planets: Part[]; ring?: Part; carrier?: Part; angle?: Dyn<number> | Param<number>; hold?: 'ring' | 'carrier' | 'sun'; id?: string }): Planetary
/** What camFollower returns. */
interface CamFollower {
  readonly id: string
  /** Highest lift. */
  readonly maxLift: number
  /** How far the cam has pushed the follower along the axis now. */
  lift(): number
  /** Cam angle from "nose on the follower", degrees. */
  angle(): number
}
/**
 * A flat follower riding on a cam: camFollower({ cam, follower: valve, axis: 'down', angle: () => (crank() - 110) / 2 }). `axis` is the way the cam pushes (a valve under
 * a cam: 'down'); at angle 0 the nose points along it (full lift). The follower's far side (its 'top' for 'down'; or `contact: 'anchor'`) stays on the lobe.
 * `cam`: a kit.cam, or a kit.camshaft with `lobe` (1-based). An engine camshaft turns at half crank speed: angle = (crank − peak) / 2. Probe: <id>.lift.
 */
declare function camFollower(opts: { cam: Part; follower: Part; axis?: Dyn<PlaneDirection>; angle?: Dyn<number> | Param<number>; lobe?: number; contact?: string; id?: string }): CamFollower
/** What belt returns. */
interface Belt {
  readonly id: string
  /** The belt itself: label it, colour it, focus it. */
  readonly part: Part
  /** Radius of b / radius of a: turns of a for one turn of b. */
  readonly ratio: number
  /** Length of the belt. */
  readonly length: number
}
/** An open belt round two wheels (pulleys, flywheels, gears as sprockets): belt(a, b, { angle: turn }). The wheels stay where the scene put them (same z); b turns with a in the ratio of the radii, the same way round. Probe: <id>.ratio. */
declare function belt(a: Part, b: Part, opts?: { angle?: Dyn<number> | Param<number>; width?: Dyn<number>; thickness?: Dyn<number>; ribs?: boolean; color?: Dyn<Color>; material?: MaterialName; id?: string }): Belt
/**
 * Valve lift as a function of crank angle: const lift = valveLift({ angle: crank, opens: 710, closes: 230, lift: 0.18 }); then lift() is 0 while closed and 0.18 in the
 * middle of the window. `opens` / `closes` are crank degrees inside one `cycle` (720 for a four-stroke; the window may wrap). profile 'cam' = the motion of a kit.cam.
 */
declare function valveLift(opts: { angle: Dyn<number> | Param<number>; opens: Dyn<number>; closes: Dyn<number>; lift?: Dyn<number>; cycle?: Dyn<number>; profile?: 'cosine' | 'cam' }): () => number
/** Which stroke of the four-stroke cycle a crank angle is in (0 = top dead centre at the start of intake, 720 per cycle): fourStroke(crank)().name → 'intake' | 'compression' | 'power' | 'exhaust'. */
declare function fourStroke(angle: Dyn<number> | Param<number>): () => { index: number; name: 'intake' | 'compression' | 'power' | 'exhaust'; progress: number }
