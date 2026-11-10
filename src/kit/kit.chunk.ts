// src/kit/kit.chunk.ts: the drawing side of the parts kit (lazy chunk 'kit', built on the 3D chunk). Loaded only for
// scenes that use a kit part. Every mesh is made from the dimensions the pure side computes (./parts.ts) and the
// outlines of src/lib/profiles, through Ctx3D, so each part gets the look, the view modes, picking and the id pass.
import { BoxGeometry, BufferGeometry, Group, SphereGeometry, type InstancedMesh, type Mesh } from 'three'
import { defineKindBackend, isNode, kindOf, qAxisDeg, type MNode, type Resolved, type Vec3 } from '../core/index.ts'
import type { Ctx3D } from '../r3d/three.ts'
import {
  bearingBalls, bearingProfile, beltPath, camProfile, circleProfile, conRodProfile, crankWebProfile, gearProfile, pathLengths, pistonProfile, pointAlong, pulleyProfile, rackProfile, shaftProfile, smoothPath, valveProfile,
} from '../lib/profiles.ts'
import type { Vec2 } from '../lib/types.ts'
import { extrude, lathe, loft, merge, toGeometry, translate, tubeAlong, turn, upright, wire, type Soup } from './geometry.ts'
import { beltShape, boltDims, camShape, conRodDims, crankDims, flywheelDims, gearDims, KIT, lobesOf, pistonDims, pulleyDims, rackDims, valveDims } from './parts.ts'

const DEG = Math.PI / 180
const LOOKS = new Set(['color', 'material', 'shell', 'opacity'])
/** everything that shapes a part: its options (not the look) and the kit-wide detail settings */
const keyOf = (node: MNode, r: Resolved): string => JSON.stringify([KIT.segments, KIT.crease, ...Object.keys(kindOf(node.kind)?.schema ?? {}).filter((k) => !LOOKS.has(k) && k !== 'id').map((k) => (isNode(r[k]) ? r[k].id : r[k]))])
const ring = (radius: number): Vec2[] => circleProfile({ radius, samples: KIT.segments })
/** lathe profile of a plain bar or sleeve from z0 to z1 (a loop when it has a bore) */
const sleeve = (bore: number, radius: number, z0: number, z1: number): Vec2[] => (bore > 0 ? [[bore, z0], [radius, z0], [radius, z1], [bore, z1], [bore, z0]] : [[0, z0], [radius, z0], [radius, z1], [0, z1]])
const spin = (profile: Vec2[], o: { from?: number; sweep?: number } = {}): Soup => lathe(profile, { segments: KIT.segments, ...o })
const shift = (points: Vec2[], dx: number, dy: number): Vec2[] => points.map((p) => [p[0] + dx, p[1] + dy] as Vec2)

/** The triangles of every single-mesh part by kind, from its resolved options (what the backend draws; tests measure it). */
export const soups: Record<string, (r: Resolved, node: MNode) => Soup> = {}
/** A part that is one mesh: rebuilt only when an option that shapes it changes. */
function part(kind: string, make: (r: Resolved, node: MNode) => Soup, o: { edges?: boolean } = {}): void {
  soups[kind] = make
  defineKindBackend<Mesh, Ctx3D>(kind, {
    build: (_node, c) => c.mesh(new BufferGeometry(), o),
    update: (mesh, r, c, node) => c.geometry(mesh, keyOf(node, r), () => toGeometry(make(r, node), KIT.crease)),
  })
}

// ── gears ────────────────────────────────────────────────────────────────────────────────────────────
part('gear', (r) => {
  const d = gearDims(r)
  const teeth = gearProfile({ teeth: d.teeth, module: d.module, pressureAngle: d.pressureAngle, internal: d.internal, backlash: d.backlash })
  if (d.internal) return extrude(ring(d.outer), [teeth], -d.half, d.half)
  const body = extrude(teeth, d.boreRadius > 0 ? [ring(d.boreRadius)] : [], -d.half, d.half)
  if (!(d.hubRadius > 0) || !(d.halfHub > d.half)) return body
  return merge(body, spin(sleeve(d.boreRadius, d.hubRadius, d.half, d.halfHub)), spin(sleeve(d.boreRadius, d.hubRadius, -d.halfHub, -d.half)))
})
part('rack', (r) => {
  const d = rackDims(r)
  const outline = rackProfile({ teeth: d.teeth, module: d.module, pressureAngle: r.pressureAngle, backlash: d.backlash, height: -d.bottom - 1.25 * d.module })
  return extrude(shift(outline, -((d.teeth - 1) / 2) * d.pitch, 0), [], -d.half, d.half)
})

// ── shafts and wheels ────────────────────────────────────────────────────────────────────────────────
const bar = (radius: number, z0: number, z1: number): Soup => translate(spin(shaftProfile({ sections: [{ radius, length: z1 - z0 }] })), 0, 0, z0)
part('shaft', (r) => bar(r.radius, -r.length / 2, r.length / 2))
/** round holes on a circle, the first one half a step round (so none sits on the line to a crank pin or a key) */
const holesOn = (count: number, circle: number, radius: number): Vec2[][] => Array.from({ length: radius > 0 ? count : 0 }, (_, i) => { const a = ((i + 0.5) / count) * 2 * Math.PI; return circleProfile({ radius, center: [circle * Math.cos(a), circle * Math.sin(a)], samples: Math.max(16, KIT.segments / 2) }) })
part('pulley', (r) => {
  const d = pulleyDims(r)
  if (!d.holes) return translate(spin(pulleyProfile({ radius: d.radius, width: 2 * d.half, grooveDepth: d.groove, boreRadius: d.boreRadius })), 0, 0, -d.half)
  // a grooved rim, a thin web with holes (so the wheel is seen to turn) and a hub
  const rim = translate(spin(pulleyProfile({ radius: d.radius, width: 2 * d.half, grooveDepth: d.groove, boreRadius: d.rimInner })), 0, 0, -d.half)
  const web = extrude(ring(d.rimInner + 0.02 * d.radius), [...(d.boreRadius > 0 ? [ring(d.boreRadius)] : []), ...holesOn(d.holes, d.holeCircle, d.holeRadius)], -d.web / 2, d.web / 2)
  return merge(rim, web, spin(sleeve(d.boreRadius, d.hubRadius, -d.half, d.half)))
})
part('flywheel', (r) => {
  const d = flywheelDims(r), inner = d.radius - d.rim, bevel = Math.min(0.12 * d.rim, 0.2 * d.half)
  const holes: Vec2[][] = [...(d.boreRadius > 0 ? [ring(d.boreRadius)] : []), ...holesOn(d.holes, d.holeCircle, d.holeRadius)]
  const rim: Vec2[] = [[inner, -d.half], [d.radius - bevel, -d.half], [d.radius, -d.half + bevel], [d.radius, d.half - bevel], [d.radius - bevel, d.half], [inner, d.half], [inner, -d.half]]
  // the web reaches a little into the rim and the hub so the three are one piece
  return merge(extrude(ring(inner + 0.2 * d.rim), holes, -d.web / 2, d.web / 2), spin(rim), spin(sleeve(d.boreRadius, d.hubRadius, -d.half, d.half)))
})
defineKindBackend<{ object: Group; races: Mesh; balls: InstancedMesh }, Ctx3D>('bearing', {
  build(_node, c) {
    const object = new Group()
    const races = c.mesh(new BufferGeometry()), balls = c.instanced(new SphereGeometry(1, Math.max(12, KIT.segments / 2), Math.max(8, KIT.segments / 4)), 16)
    object.add(races, balls)
    return { object, races, balls }
  },
  update(h, r, c, node) {
    const size = { innerRadius: Math.min(r.bore / 2, 0.9 * r.radius), outerRadius: r.radius, width: r.width }
    c.geometry(h.races, keyOf(node, r), () => toGeometry(translate(merge(spin(bearingProfile({ ...size, race: 'outer' })), spin(bearingProfile({ ...size, race: 'inner' }))), 0, 0, -r.width / 2), KIT.crease))
    const b = bearingBalls({ ...size, count: r.balls ?? undefined })
    c.place(h.balls, Array.from({ length: b.count }, (_, i) => { const a = (i / b.count) * 2 * Math.PI; return { p: [b.pitchRadius * Math.cos(a), b.pitchRadius * Math.sin(a), 0] as Vec3, s: b.radius } }))
  },
})

// ── springs, coils, pipes ────────────────────────────────────────────────────────────────────────────
part('spring', (r) => {
  // one closed (flat) coil at each end, the rest evenly pitched: a compression spring that sits square on its seats
  const turns = Math.max(1, r.turns), n = Math.max(8, Math.ceil(turns * KIT.spring.perTurn)), half = r.wire / 2
  const span = Math.max(r.length - r.wire, 1e-6), flat = Math.min(r.wire, span / 2), e = Math.min(0.5, 1 / turns)
  const rise = (t: number): number => (t < e ? (flat * t) / e : t > 1 - e ? span - (flat * (1 - t)) / e : flat + ((span - 2 * flat) * (t - e)) / Math.max(1 - 2 * e, 1e-9))
  const path: Vec3[] = Array.from({ length: n + 1 }, (_, i) => { const t = i / n, a = t * turns * 2 * Math.PI; return [r.radius * Math.cos(a), -r.length / 2 + half + rise(t), -r.radius * Math.sin(a)] as Vec3 })
  return wire(path, half, KIT.spring.sides)
}, { edges: false })
part('coil', (r) => {
  const turns = Math.max(1, Math.round(r.turns)), n = turns * KIT.spring.perTurn, half = r.wire / 2, y0 = -r.length / 2 + half, span = Math.max(r.length - r.wire, 1e-6)
  const helix: Vec3[] = Array.from({ length: n + 1 }, (_, i) => { const t = i / n, a = t * turns * 2 * Math.PI; return [r.radius * Math.cos(a), y0 + span * t, -r.radius * Math.sin(a)] as Vec3 })
  const path = r.leads > 0 ? smoothPath<Vec3>([[r.radius + r.leads, y0, 0], ...helix, [r.radius + r.leads, y0 + span, 0]], { radius: Math.min(r.wire, r.leads / 2), samples: 4 }) : helix
  return wire(path, half, KIT.spring.sides)
}, { edges: false })
part('pipe', (r) => {
  const points = (Array.isArray(r.path) ? r.path : []) as Vec3[]
  if (points.length < 2) return []
  const bend = r.bend ?? KIT.pipe.bend * r.radius
  const path = bend > 0 ? smoothPath<Vec3>(points.map((p) => [p[0], p[1], p[2]] as Vec3), { radius: bend, samples: 8 }) : points
  const wall = r.thickness ?? KIT.pipe.wall * r.radius
  return tubeAlong(path, r.radius, wall > 0 ? r.radius - wall : 0, Math.max(12, KIT.segments / 2))
})

// ── the crank train ──────────────────────────────────────────────────────────────────────────────────
part('piston', (r) => {
  const d = pistonDims(r)
  const cup = translate(upright(spin(pistonProfile({ radius: d.radius, height: d.height, rings: d.rings, crown: d.crown, wall: d.wall }))), 0, -d.height / 2, 0)
  // the wrist pin runs along z through two bosses inside the skirt; the rod's small end sits between them
  const reach = d.radius - 0.6 * d.wall, bossR = KIT.piston.boss * d.pinRadius, inner = KIT.piston.bossGap * d.radius
  const pin = translate(spin(sleeve(0, d.pinRadius, -reach, reach)), 0, d.pinY, 0)
  const boss = (z0: number, z1: number): Soup => translate(spin(sleeve(0, bossR, z0, z1)), 0, d.pinY, 0)
  return merge(cup, pin, boss(inner, reach), boss(-reach, -inner))
})
part('conRod', (r) => {
  const d = conRodDims(r), h = d.length / 2
  const outline = conRodProfile({ length: d.length, bigEndRadius: d.bigRadius, smallEndRadius: d.smallRadius, beamWidth: d.beam, samples: KIT.segments })
  return extrude(shift(outline, 0, -h), [circleProfile({ radius: d.bigBore, center: [0, -h], samples: KIT.segments }), circleProfile({ radius: d.smallBore, center: [0, h], samples: KIT.segments })], -d.half, d.half)
})
part('crankshaft', (r) => {
  const d = crankDims(r), z = d.gap + d.web
  const web = crankWebProfile({ throw: d.throw, journalRadius: d.journalRadius, pinRadius: d.pinRadius, counterweightRadius: d.counterweight > d.mainBoss ? d.counterweight : 1e-9, samples: KIT.segments })
  // each journal (and the pin) starts inside its web, so they are one piece
  const back = merge(extrude(web, [], -z, -d.gap), bar(d.journalRadius, -d.half, -z + 0.5 * d.web))
  if (d.overhung) return merge(back, translate(bar(d.pinRadius, -z + 0.5 * d.web, d.gap), 0, d.throw, 0))
  return merge(back, extrude(web, [], d.gap, z), translate(spin(sleeve(0, d.pinRadius, -z + 0.5 * d.web, z - 0.5 * d.web)), 0, d.throw, 0), bar(d.journalRadius, z - 0.5 * d.web, d.half))
})
part('valve', (r) => {
  const d = valveDims(r)
  return translate(upright(spin(valveProfile({ headRadius: d.headRadius, stemRadius: d.stemRadius, length: d.length, seatAngle: r.seatAngle }))), 0, -d.length / 2, 0)
})

// ── cams ─────────────────────────────────────────────────────────────────────────────────────────────
const lobe = (r: Resolved, bore: number, z0: number, z1: number): Soup => {
  const s = camShape(r.baseRadius, r.lift, r.duration)
  return extrude(camProfile({ baseRadius: s.baseRadius, noseRadius: s.noseRadius, distance: s.distance, samples: 2 * KIT.segments }), bore > 0 ? [ring(bore)] : [], z0, z1)
}
part('cam', (r) => lobe(r, Math.min(r.bore / 2, 0.9 * r.baseRadius), -r.width / 2, r.width / 2))
part('camshaft', (r) => merge(bar(r.radius, -r.length / 2, r.length / 2), ...lobesOf(r).map((l) => translate(turn(lobe(r, 0, -r.lobeWidth / 2, r.lobeWidth / 2), l.angle), 0, 0, l.offset))))

// ── fan ──────────────────────────────────────────────────────────────────────────────────────────────
part('fan', (r) => {
  const blades = Math.max(1, Math.round(r.blades)), hubR = Math.min(r.hub / 2, 0.6 * r.radius), half = r.width / 2
  // hub with a rounded nose toward +z
  const nose: Vec2[] = [[0, -half], [hubR, -half], [hubR, 0.3 * half]]
  for (let i = 1; i <= 8; i++) { const a = (i / 8) * 90 * DEG; nose.push([hubR * Math.cos(a), 0.3 * half + 0.7 * half * Math.sin(a)]) }
  const out: Soup[] = [spin(nose)]
  const root = 0.8 * hubR, stations = KIT.fan.stations, thick = KIT.fan.thickness * r.radius
  for (let k = 0; k < blades; k++) {
    const rings: Vec3[][] = []
    for (let i = 0; i <= stations; i++) {
      // stations crowd toward the tip, where the outline curves
      const u = 1 - (1 - i / stations) ** 1.6, rho = root + (r.radius - root) * u
      // more pitch at the root, less at the tip (a propeller's twist); the chord fills the depth and stays clear of its neighbours
      const beta = Math.min(85, Math.max(8, r.pitch + KIT.fan.twist[0]! * (1 - u) + KIT.fan.twist[1]! * u)) * DEG
      // the outline of a blade: narrow at the root, widest at two thirds of the span, a round tip
      const tipRound = u > KIT.fan.tip ? Math.sqrt(Math.max(0.02, 1 - ((u - KIT.fan.tip) / (1 - KIT.fan.tip)) ** 2)) : 1
      const t = (thick / 2) * (1 - 0.5 * u), cy = Math.cos(beta), cz = Math.sin(beta)
      // the blade with its thickness stays inside the depth of the fan, and its corners inside the radius
      const chord = Math.min((2 * (half - t * cy)) / cz, (KIT.fan.fill * 2 * Math.PI * rho) / blades / cy) * (0.5 + 0.5 * Math.sin(Math.min(1, u / 0.66) * 90 * DEG)) * tipRound
      const a = Math.max(chord / 2, 0), x = Math.sqrt(Math.max(rho * rho - (a * cy + t * cz) ** 2, 0))
      rings.push(([[a, -t], [a, t], [-a, t], [-a, -t]] as Vec2[]).map(([s, n]) => [x, s * cy - n * cz, s * cz + n * cy] as Vec3))
    }
    out.push(turn(loft(rings), (k / blades) * 360))
  }
  return merge(...out)
})

// ── fasteners and housings ───────────────────────────────────────────────────────────────────────────
part('bolt', (r) => {
  const d = boltDims(r)
  const hex: Vec2[] = Array.from({ length: 6 }, (_, i) => [d.headRadius * Math.cos((i / 6) * 2 * Math.PI), d.headRadius * Math.sin((i / 6) * 2 * Math.PI)] as Vec2)
  return upright(merge(extrude(hex, [], d.seatY, d.seatY + d.headHeight), bar(d.radius, d.seatY - d.length, d.seatY + 0.2 * d.headHeight)))
})
/** what a cutaway keeps, in degrees of turning space (after upright(), 180 … 360 is the half toward the viewer) */
const KEEP: Record<string, { from: number; sweep: number }> = { none: { from: 0, sweep: 360 }, half: { from: 0, sweep: 180 }, quarter: { from: 0, sweep: 270 } }
part('liner', (r) => {
  const ri = r.bore / 2, ro = ri + (r.wall ?? KIT.liner.wall * r.bore)
  return upright(spin(sleeve(ri, ro, -r.height / 2, r.height / 2), KEEP[r.cut] ?? KEEP.none))
})
part('block', (r) => {
  const w = (r.width ?? KIT.block.size * r.bore) / 2, d = (r.depth ?? KIT.block.size * r.bore) / 2, radius = Math.min(r.bore / 2, 0.98 * Math.min(w, d))
  // drawn in (x, −z): after upright() the viewer's side is y < 0 here
  const arc = (from: number, to: number): Vec2[] => { const n = Math.max(4, Math.round((KIT.segments * Math.abs(to - from)) / 360)); return Array.from({ length: n + 1 }, (_, i) => { const a = (from + ((to - from) * i) / n) * DEG; return [radius * Math.cos(a), radius * Math.sin(a)] as Vec2 }) }
  const soup = r.cut === 'half' ? extrude([[w, 0], [w, d], [-w, d], [-w, 0], ...arc(180, 0)], [], -r.height / 2, r.height / 2)
    : r.cut === 'quarter' ? extrude([[w, 0], [w, d], [-w, d], [-w, -d], [0, -d], ...arc(270, 0)], [], -r.height / 2, r.height / 2)
    : extrude([[w, -d], [w, d], [-w, d], [-w, -d]], [ring(radius)], -r.height / 2, r.height / 2)
  return upright(soup)
})

// ── belt ─────────────────────────────────────────────────────────────────────────────────────────────
defineKindBackend<{ object: Group; band: Mesh; ribs: InstancedMesh }, Ctx3D>('belt', {
  build(_node, c) {
    const object = new Group()
    const band = c.mesh(new BufferGeometry()), ribs = c.instanced(new BoxGeometry(1, 1, 1), 64)
    object.add(band, ribs)
    return { object, band, ribs }
  },
  update(h, r, c, node) {
    if (!isNode(r.a) || !isNode(r.b)) { h.object.visible = false; return }
    h.object.visible = true
    const s = beltShape(node, r, c.frame)
    const loop = (grow: number): Vec2[] => beltPath({ centerA: [0, 0], radiusA: s.radiusA + grow, centerB: s.center, radiusB: s.radiusB + grow, samples: 2 * KIT.segments })
    // the band is rebuilt only when a wheel moves or changes size, never because the belt runs
    c.geometry(h.band, [KIT.segments, KIT.crease, s.center[0], s.center[1], s.radiusA, s.radiusB, s.thickness, s.width].map((x) => x.toFixed(6)).join(':'), () => toGeometry(extrude(loop(s.thickness), [loop(0)], -s.width / 2, s.width / 2), KIT.crease))
    // ribs across the back of the belt: they travel with it, so the belt is seen to run
    if (!r.ribs) { c.place(h.ribs, []); return }
    const back = loop(s.thickness), lengths = pathLengths(back, true), total = lengths[lengths.length - 1] ?? 0
    const count = Math.max(1, Math.round(total / (KIT.belt.pitch * s.thickness)))
    const u0 = (((s.travel / Math.max(total, 1e-9)) % 1) + 1) % 1
    c.place(h.ribs, Array.from({ length: count }, (_, i) => {
      const at = pointAlong(back, (u0 + i / count) % 1, { closed: true, lengths })
      return { p: [at.point[0], at.point[1], 0] as Vec3, q: qAxisDeg([0, 0, 1], Math.atan2(at.tangent[1], at.tangent[0]) / DEG), s: [KIT.belt.rib[0]! * s.thickness, KIT.belt.rib[1]! * s.thickness, s.width] as Vec3 }
    }))
  },
})
