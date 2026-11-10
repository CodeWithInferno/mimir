import { explain, machine, chart, extrude, curve, polar, outset, moved, areaBetween, GOLD } from 'mimir'

const R = 1.05, E = 0.15, THIRD = (2 * Math.PI) / 3, rad = (deg) => (deg * Math.PI) / 180
const wall = (t) => [E * Math.cos(3 * t) + R * Math.cos(t), E * Math.sin(3 * t) + R * Math.sin(t)]
const flank = (a) => 0.61 * (R / 2 / Math.cos((a % THIRD) - THIRD / 2)) + 0.39 * R
const pose = (c) => ({ at: [E * Math.cos(rad(c.shaft)), E * Math.sin(rad(c.shaft)), 0], turn: c.shaft / 3 })
const chamber = (shaft) => areaBetween(
  curve(wall, { from: rad(shaft) / 3, to: rad(shaft) / 3 + THIRD, samples: 48 }),
  moved(polar(flank, { from: 0, to: THIRD, samples: 48 }), pose({ shaft }))
)

export default explain({
  title: 'How a Wankel rotary engine works',
  controls: { shaft: { from: 0, to: 1080, unit: '°', cyclic: true } },
  stage: {
    engine: machine({
      parts: {
        housing: extrude(outset(curve(wall), 0.12), { depth: 0.4, holes: [curve(wall)] }),
        rotor: extrude(polar(flank), { depth: 0.36, holes: [curve((t) => [0.3 * Math.cos(t), 0.3 * Math.sin(t)])] }),
        lobe: extrude(curve((t) => [0.29 * Math.cos(t), 0.29 * Math.sin(t)]), { depth: 0.36, color: GOLD }),
      },
      joints: [
        ['rotor', 'follows', pose],
        ['lobe', 'follows', (c) => ({ at: pose(c).at, turn: c.shaft })],
        ['housing', 'around', 'rotor'],
      ],
      camera: 'front',
    }),
    volume: chart({ x: 'shaft', y: 'chamber volume', curve: (x) => chamber(x) }),
  },
  story: [
    { say: 'A three-cornered [rotor](engine.rotor) sits inside an oval [housing](engine.housing). No pistons at all.', set: { shaft: 0 } },
    { say: 'The rotor rides on an off-centre [lobe](engine.lobe) of the shaft.', set: { shaft: 90 }, engine: { highlight: 'lobe' } },
    { say: 'The shaft turns three times for each turn of the rotor, so its tips always touch the wall.', set: { shaft: 360 }, engine: { highlight: 'rotor' } },
    { say: 'Each face traps a pocket that [grows and shrinks](volume). Growing draws air in; shrinking squeezes it.', set: { shaft: 720 }, engine: { highlight: null } },
    { say: 'One pocket goes through intake, compression, power and exhaust, and every face does this in turn.', set: { shaft: 1080 }, engine: { camera: 'iso' } },
  ],
})
