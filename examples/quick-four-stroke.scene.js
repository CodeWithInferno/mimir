// A single-cylinder four-stroke engine from kit parts: crank, rod and piston, two valves under two cams at half
// speed, the charge coloured by stroke, and the piston's height read back from the mechanism. The joints place and
// move everything; the only numbers are sizes of parts and where the two cams sit above the cylinder.
import { explain, machine, chart, kit, cylinder, crankSlider, camFollower, GREY_B } from 'mimir'

const BORE = 1.72, THROW = 0.86, VALVE = 0.6, CAM = 0.3, LIFT = 0.14     // real proportions: bore = stroke
const stroke = (crank) => Math.floor((((crank % 720) + 720) % 720) / 180)   // 0 intake, 1 compression, 2 power, 3 exhaust
const camAbove = (side) => [side * 0.45, 3.1 * VALVE + CAM, 0]              // a valve is 3.1 heads long and hangs from its cam
// squeezed gas is dense; it is hot once it has burnt
const charge = (c, m) => {
  const squeeze = 1 - m.probe('piston.travel') / (2 * THROW)
  return { density: 0.2 + 0.8 * squeeze, temperature: [0.1, 0.1 + 0.4 * squeeze, 0.45 + 0.55 * squeeze, 0.35][stroke(c.crank)] }
}

export default explain({
  title: 'Four strokes, two turns',
  controls: { crank: { from: 0, to: 720, unit: '°', cyclic: true } },
  stage: {
    engine: machine({
      parts: {
        crank: kit.crankshaft({ throw: THROW, overhung: true }),
        rod: kit.conRod({ length: 2.78 }),
        piston: kit.piston({ bore: BORE }),
        liner: kit.liner({ bore: BORE }),
        intakeCam: kit.cam({ baseRadius: CAM, lift: LIFT }),
        exhaustCam: kit.cam({ baseRadius: CAM, lift: LIFT }),
        intake: kit.valve({ head: VALVE }),
        exhaust: kit.valve({ head: VALVE }),
        charge: cylinder({ radius: 0.46 * BORE }),
      },
      joints: [
        crankSlider({ crank: 'crank', rod: 'rod', slider: 'piston', angle: 'crank' }),
        ['liner', 'around', 'piston'],
        ['intakeCam', 'on', 'liner.top', { offset: camAbove(-1) }],
        ['exhaustCam', 'on', 'liner.top', { offset: camAbove(1) }],
        camFollower({ cam: 'intakeCam', follower: 'intake', axis: 'down', angle: (c) => (c.crank - 90) / 2 }),      // nose down in the middle of intake
        camFollower({ cam: 'exhaustCam', follower: 'exhaust', axis: 'down', angle: (c) => (c.crank - 630) / 2 }),   // and in the middle of exhaust
        ['charge', 'gas', { from: 'piston.crown', to: 'liner.top', phase: charge }],
        [['intake.head', 'piston.crown'], 'particles', { when: (c) => stroke(c.crank) === 0 }],
        [['piston.crown', 'exhaust.head'], 'particles', { when: (c) => stroke(c.crank) === 3, color: GREY_B }],
      ],
      labels: { intake: 'intake valve', exhaust: 'exhaust valve', intakeCam: 'intake cam', exhaustCam: 'exhaust cam' },
    }),
    height: chart({ x: 'crank', y: 'piston height', curve: ({ engine }) => engine.probe('piston.y') }),
  },
  story: [
    { say: 'Intake: the [piston](engine.piston) goes down, the [intake valve](engine.intake) is pushed open by its cam, and fresh charge flows in.', set: { crank: 100 } },
    { say: 'Compression: both valves are shut. The piston comes back up and squeezes the [charge](engine.charge).', set: { crank: 350 }, engine: { camera: 'front' } },
    { say: 'Power: the charge burns and pushes the piston down. This is the only stroke that does work.', set: { crank: 470 }, engine: { highlight: ['piston', 'charge', 'rod'] } },
    { say: 'Exhaust: the [exhaust valve](engine.exhaust) opens and the piston pushes the burnt gas out.', set: { crank: 640 } },
    { say: 'Each [cam](engine.intakeCam) turns once while the [crank](engine.crank) turns twice: four strokes, two turns.', set: { crank: 720 }, engine: { camera: 'iso', spin: true } },
  ],
})
