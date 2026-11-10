// A Geneva drive: the kit has no part for it. Both outlines are computed here from the numbers that define the
// mechanism, each part is one extrude(), and the wheel's angle is the closed-form law. The claim "the pin stays on
// the slot centre line" is declared and measured on the real parts. No position, size, duration or camera below.
import { explain, machine, chart, extrude, cylinder, BLUE, GOLD } from 'mimir'

const SLOTS = 4, CRANK = 1, PIN = 0.12                       // slots, radius of the pin circle, radius of the pin
const HALF = Math.PI / SLOTS                                 // half the angle between two slots
const CENTRES = CRANK / Math.sin(HALF), WHEEL = CENTRES * Math.cos(HALF)   // so the pin enters a slot along its centre line
const LOCK = CRANK - 2 * PIN, GAP = 0.03, SLOT = 1.15 * PIN  // locking disc radius, running clearance, half slot width
const arc = (cx, cy, r, from, to, n = 24) => Array.from({ length: n + 1 }, (_, i) => { const a = from + ((to - from) * i) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)] })
/** half the angle, seen from here, over which a circle of radius r1 here is inside a circle r2 round the other shaft */
const meet = (r1, r2) => Math.acos((CENTRES ** 2 + r1 ** 2 - r2 ** 2) / (2 * CENTRES * r1))
const seenFrom = (angle, r1, r2) => Math.asin((r1 * Math.sin(angle)) / r2)

// the wheel, slot by slot: the slot, the rim, a hollow that fits the locking disc, the rim again
const hollow = meet(WHEEL, LOCK + GAP), slotEdge = Math.asin(SLOT / WHEEL), floor = CENTRES - CRANK - SLOT
const wheelOutline = Array.from({ length: SLOTS }, (_, k) => {
  const a = 2 * HALF * k, mid = a + HALF, wide = seenFrom(hollow, WHEEL, LOCK + GAP)
  const turned = ([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]
  return [...[[WHEEL * Math.cos(slotEdge), -SLOT], [floor, -SLOT], [floor, SLOT]].map(turned), ...arc(0, 0, WHEEL, a + slotEdge, mid - hollow, 4),
    ...arc(CENTRES * Math.cos(mid), CENTRES * Math.sin(mid), LOCK + GAP, mid + Math.PI + wide, mid + Math.PI - wide).slice(1), ...arc(0, 0, WHEEL, mid + hollow, a + 2 * HALF - slotEdge, 4).slice(1, -1)]
}).flat()
// the locking disc: round, with a bite the size of the wheel taken out on the side of the pin
const bite = meet(LOCK, WHEEL + GAP)
const discOutline = [...arc(0, 0, LOCK, bite, 2 * Math.PI - bite), ...arc(CENTRES, 0, WHEEL + GAP, Math.PI + seenFrom(bite, LOCK, WHEEL + GAP), Math.PI - seenFrom(bite, LOCK, WHEEL + GAP)).slice(1, -1)]

// the law: while the pin is in a slot the wheel is aimed at the pin; otherwise it rests half a slot either side
const DEG = 180 / Math.PI
const phase = (turn) => { const turns = Math.floor((turn + 180) / 360); return { turns, t: (turn - 360 * turns) / DEG } }
const engaged = (t) => Math.abs(t) < Math.PI / 2 - HALF
const wheelTurned = (turn) => {
  const { turns, t } = phase(turn)
  return DEG * (2 * HALF * turns + (engaged(t) ? Math.atan2(CRANK * Math.sin(t), CENTRES - CRANK * Math.cos(t)) : Math.sign(t) * HALF))
}

export default explain({
  title: 'One turn in, a quarter turn out',
  controls: { turn: { from: -180, to: 540, unit: '°' } },
  stage: {
    drive: machine({
      parts: {
        disc: extrude(discOutline, { depth: 0.2, color: BLUE }).define('face', [0, 0, 0.15]),
        arm: extrude([[-0.2, -0.14], [CRANK + 0.16, -0.14], [CRANK + 0.16, 0.14], [-0.2, 0.14]], { depth: 0.1, color: BLUE }).define('tip', [CRANK, 0, -0.1]),
        pin: cylinder({ radius: PIN, height: 0.3, color: GOLD }).rotate({ about: 'x', deg: 90 }),
        wheel: extrude(wheelOutline, { depth: 0.2 }),
      },
      joints: [
        ['disc', 'spins', { by: 'turn' }],
        ['arm', 'on', 'disc.face'],
        ['pin', 'on', 'arm.tip'],
        ['wheel', 'spins', { by: (c) => 180 - wheelTurned(c.turn), at: [CENTRES, 0, 0] }],
      ],
      probes: { 'wheel turned': (c) => wheelTurned(c.turn) + 45 },
      checks: {
        'the pin stays on the slot centre line': (c, m) => {
          if (!engaged(phase(c.turn).t)) return 0              // the pin is outside the wheel: there is nothing to hold
          const [x, y] = m.local('wheel', m.point('pin'))
          const slot = Math.round(Math.atan2(y, x) / (2 * HALF)) * 2 * HALF
          return Math.abs(y * Math.cos(slot) - x * Math.sin(slot))
        },
      },
    }),
    output: chart({ x: 'turn', y: 'wheel turned', curve: ({ drive }) => drive.probe('wheel turned') }),
  },
  story: [
    { say: 'A [disc](drive.disc) turns steadily and carries a [pin](drive.pin), which is about to enter a slot of the [wheel](drive.wheel).', set: { turn: -45 } },
    { say: 'While the pin is in the slot it drags the wheel round: a quarter turn, fastest in the middle.', set: { turn: 45 }, drive: { camera: 'front' } },
    { say: 'Then the pin leaves. The round back of the [disc](drive.disc) fills a hollow of the wheel and locks it.', set: { turn: 180 }, drive: { highlight: ['disc', 'wheel'] } },
    { say: 'One more turn, one more quarter: steady rotation has become stepping.', set: { turn: 405 }, drive: { camera: 'iso' } },
  ],
})
