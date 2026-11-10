// A Wankel rotary engine: nothing here is a kit part. The housing is the epitrochoid from its equation, the rotor's
// flanks are arcs through its three apexes, and the chamber volumes are the areas between the two outlines. The claim
// "all three apexes stay on the housing curve" is declared and measured on the real parts. No position, size,
// duration or camera is written for the scene; every number below is geometry of the engine itself.
import { explain, machine, chart, extrude, cylinder, GOLD } from 'mimir'

const R = 1.05, E = 0.15, DEPTH = 0.36                       // rotor centre to apex, eccentricity of the shaft, thickness
const THIRD = (2 * Math.PI) / 3, rad = (deg) => (deg * Math.PI) / 180
const wall = (t) => [E * Math.cos(3 * t) + R * Math.cos(t), E * Math.sin(3 * t) + R * Math.sin(t)]   // the epitrochoid
const wallFrom = (from, to, n = 48) => Array.from({ length: n + 1 }, (_, i) => wall(from + ((to - from) * i) / n))
const circle = (r, n = 40) => Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)])

// a rotor flank: the arc through two apexes whose middle just clears the waist of the housing (R − 2E from the rotor centre)
const BULGE = R - 2 * E - 0.02 - R / 2, CHORD = R * Math.sin(THIRD / 2), FLANK = (CHORD ** 2 + BULGE ** 2) / (2 * BULGE)
const flank = (k, n = 16) => {
  const mid = THIRD * k + THIRD / 2, centre = R / 2 + BULGE - FLANK, half = Math.asin(CHORD / FLANK)
  return Array.from({ length: n + 1 }, (_, i) => { const a = mid - half + (2 * half * i) / n; return [centre * Math.cos(mid) + FLANK * Math.cos(a), centre * Math.sin(mid) + FLANK * Math.sin(a)] })
}
const apex = (k) => [R * Math.cos(THIRD * k), R * Math.sin(THIRD * k), 0]

// kinematics: the rotor's centre rides the eccentric, the rotor turns at one third of the shaft
const onRotor = (shaft) => { const a = rad(shaft) / 3, cx = E * Math.cos(rad(shaft)), cy = E * Math.sin(rad(shaft)); return ([x, y]) => [cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)] }
// chamber k: the region between the housing wall and flank k, measured from the two outlines
const area = (pts) => Math.abs(pts.reduce((sum, [x, y], i) => { const [u, v] = pts[(i + 1) % pts.length]; return sum + x * v - u * y }, 0)) / 2
const chamber = (k, shaft) => { const t = rad(shaft) / 3 + THIRD * k; return DEPTH * area([...wallFrom(t, t + THIRD), ...flank(k).map(onRotor(shaft)).reverse()]) }
const volumes = Array.from({ length: 180 }, (_, i) => chamber(0, 6 * i)), SMALLEST = Math.min(...volumes), LARGEST = Math.max(...volumes)
const middle = (k, shaft) => { const [a, b] = wall(rad(shaft) / 3 + THIRD * k + THIRD / 2), [x, y] = onRotor(shaft)(flank(k, 2)[1]); return [(a + x) / 2, (b + y) / 2, 0] }
// the state of the charge: squeezed gas is dense; where the chamber is round the housing says which stroke it is in
const charge = (k, shaft) => {
  const squeeze = SMALLEST / chamber(k, shaft), quarter = ((((rad(shaft) / 3 + THIRD * k + THIRD / 2) / (Math.PI / 2)) % 4) + 4) % 4
  return { density: 0.25 + 0.75 * squeeze, temperature: quarter < 1 ? 0.35 : quarter < 2 ? 0.1 : quarter < 3 ? 0.1 + 0.5 * squeeze : 0.4 + 0.6 * squeeze }   // exhaust, intake, compression, power
}
// how far a point is from the wall: on the curve |P|² = E² + R² + 2ER cos 2t, which gives t
const offWall = ([x, y]) => {
  const t = Math.acos(Math.max(-1, Math.min(1, (x * x + y * y - E * E - R * R) / (2 * E * R)))) / 2
  return Math.min(...[t, -t, t + Math.PI, Math.PI - t].map((u) => Math.hypot(wall(u)[0] - x, wall(u)[1] - y)))
}
const FACES = [0, 1, 2], lying = { about: 'x', deg: 90 }      // a cylinder stands along y: lay it along the shaft

export default explain({
  title: 'An engine with no pistons',
  controls: { shaft: { from: 0, to: 1080, unit: '°' } },
  stage: {
    engine: machine({
      parts: {
        housing: extrude(wallFrom(0, 2 * Math.PI, 120).slice(1).map(([x, y]) => [1.22 * x, 1.22 * y]), { depth: DEPTH, holes: [wallFrom(0, 2 * Math.PI, 120).slice(1)] }),
        rotor: FACES.reduce((part, k) => part.define(`apex${k}`, apex(k)), extrude(FACES.flatMap((k) => flank(k).slice(1)), { depth: DEPTH, holes: [circle(0.36)] })),
        shaft: cylinder({ radius: 0.12, height: 2 * DEPTH }).rotate(lying).define('eccentric', [E, 0, 0]),
        lobe: cylinder({ radius: 0.34, height: DEPTH, color: GOLD }).rotate(lying),
        ...Object.fromEntries(FACES.map((k) => [`charge${k}`, cylinder({ radius: 0.2, height: 0.8 * DEPTH }).rotate(lying)])),
      },
      joints: [
        ['shaft', 'spins', { by: 'shaft' }],
        ['lobe', 'on', 'shaft.eccentric'],
        ['rotor', 'spins', { by: (c) => c.shaft / 3, at: 'shaft.eccentric' }],
        ['housing', 'around', 'rotor'],
        ...FACES.flatMap((k) => [
          [`charge${k}`, 'follows', (c) => ({ at: middle(k, c.shaft) })],
          [`charge${k}`, 'gas', { phase: (c) => charge(k, c.shaft), size: (c) => Math.sqrt(chamber(k, c.shaft) / LARGEST) }],
        ]),
      ],
      probes: { 'chamber volume': (c) => chamber(0, c.shaft) },
      checks: { 'all three apexes stay on the housing curve': (c, m) => Math.max(...FACES.map((k) => offWall(m.point(`rotor.apex${k}`)))) },
    }),
    volume: chart({ x: 'shaft', y: 'chamber volume', curve: ({ engine }) => engine.probe('chamber volume') }),
  },
  story: [
    { say: 'A three-cornered [rotor](engine.rotor) rides on the eccentric of a [shaft](engine.shaft), inside a [housing](engine.housing) shaped like a pinched oval.', set: { shaft: 90 } },
    { say: 'The shaft turns three times for one turn of the rotor, and all three corners stay on the wall.', set: { shaft: 360 }, engine: { camera: 'front' } },
    { say: 'So each face traps a pocket of gas that grows and shrinks twice per rotor turn: intake, compression, power, exhaust.', set: { shaft: 720 }, engine: { highlight: ['rotor', 'charge0'] } },
    { say: 'Squeezed gas glows brighter; after ignition it pushes the rotor round. Three faces, three power strokes a turn.', set: { shaft: 1080 }, engine: { camera: 'iso' } },
  ],
})
