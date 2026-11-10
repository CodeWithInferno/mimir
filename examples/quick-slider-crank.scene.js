// A crank, a rod and a piston: kit parts, one mechanism of the engine named as a joint, one housing. No position,
// size, duration or camera is written here; the chart is the piston's height read back from the mechanism.
import { explain, machine, chart, kit, crankSlider } from 'mimir'

export default explain({
  title: 'Turning becomes sliding',
  controls: { crank: { from: 0, to: 360, unit: '°', cyclic: true } },
  stage: {
    engine: machine({
      parts: {
        crank: kit.crankshaft({ throw: 0.86, overhung: true }),
        rod: kit.conRod({ length: 2.78 }),
        piston: kit.piston({ bore: 1.72 }),
        liner: kit.liner({ bore: 1.72, cut: 'half' }),
      },
      joints: [crankSlider({ crank: 'crank', rod: 'rod', slider: 'piston', angle: 'crank' }), ['liner', 'around', 'piston']],
    }),
    height: chart({ x: 'crank', y: 'piston height', curve: ({ engine }) => engine.probe('piston.y') }),
  },
  story: [
    { say: 'A [rod](engine.rod) ties the [crank](engine.crank) to a [piston](engine.piston) that can only slide in its liner.', set: { crank: 60 } },
    { say: 'After a quarter turn the piston is already past the middle of its stroke, because the rod leans.', set: { crank: 90 }, engine: { camera: 'front' } },
    { say: 'Half a turn is one full stroke: twice the throw of the [crank](engine.crank).', set: { crank: 180 }, engine: { highlight: ['crank', 'piston'] } },
    { say: 'The second half turn pushes the piston back to the top.', set: { crank: 360 }, engine: { camera: 'iso' } },
  ],
})
