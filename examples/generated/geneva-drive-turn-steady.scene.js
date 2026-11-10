import { explain, machine, chart, extrude, curve, polar, box, GOLD } from 'mimir'

const A = 1, D = Math.SQRT2
const rad = (d) => (d * Math.PI) / 180
const deg = (r) => (r * 180) / Math.PI
const Q = Math.PI / 2

// pin angle measured from the line to the wheel centre; the crank control starts 135° before engagement
const pinAngle = (c) => c.crank - 135

// cumulative wheel rotation (degrees) for a pin angle: one closed-form law for the joint and the chart
const wheelDeg = (u) => {
  const k = Math.floor((u + 180) / 360)
  const th = u - 360 * k
  const t = rad(th)
  const phi = Math.abs(th) < 45 ? deg(Math.atan2(A * Math.sin(t), D - A * Math.cos(t))) : (th < 0 ? -45 : 45)
  return 90 * k + phi
}

const wheelOutline = (a) => {
  const m = ((a % Q) + Q) % Q
  const dist = Math.min(m, Q - m)
  return dist < 0.1 ? 0.35 : 1
}

export default explain({
  title: 'How a Geneva drive turns steady rotation into steps',
  controls: { crank: { from: 0, to: 720, value: 0, unit: '°', label: 'driver' } },
  stage: {
    drive: machine({
      parts: {
        hub: extrude(curve((t) => [0.14 * Math.cos(t), 0.14 * Math.sin(t)]), { depth: 0.2 }),
        arm: box({ width: A, height: 0.12, depth: 0.1 }),
        pin: extrude(curve((t) => [0.08 * Math.cos(t), 0.08 * Math.sin(t)]), { depth: 0.3, color: GOLD }),
        wheel: extrude(polar(wheelOutline, { samples: 720 }), { depth: 0.2 }),
      },
      joints: [
        ['arm', 'follows', (c) => {
          const t = rad(pinAngle(c))
          return { at: [(A / 2) * Math.cos(t), (A / 2) * Math.sin(t), 0], turn: pinAngle(c) }
        }],
        ['pin', 'follows', (c) => {
          const t = rad(pinAngle(c))
          return { at: [A * Math.cos(t), A * Math.sin(t), 0], turn: 0 }
        }],
        ['wheel', 'follows', (c) => ({ at: [D, 0, 0], turn: -wheelDeg(pinAngle(c)) })],
      ],
      camera: 'front',
    }),
    steps: chart({
      x: 'crank',
      y: 'wheel turned (°)',
      curve: (x) => wheelDeg(x - 135) + 45,
    }),
  },
  story: [
    { say: 'A steadily turning [arm](drive.arm) carries a [pin](drive.pin) toward a slotted [wheel](drive.wheel).', set: { crank: 60 } },
    { say: 'The pin slides into a slot and pushes the wheel round.', set: { crank: 135 }, drive: { highlight: 'pin' } },
    { say: 'It leaves the slot after a quarter turn of the wheel. Then the wheel stops.', set: { crank: 190 }, drive: { highlight: 'wheel' } },
    { say: 'The pin goes round alone while the wheel [waits](steps).', set: { crank: 430 }, drive: { highlight: null } },
    { say: 'The next lap gives the wheel another quarter turn. Steady in, steps out.', set: { crank: 720 }, drive: { camera: 'iso' } },
  ],
})
