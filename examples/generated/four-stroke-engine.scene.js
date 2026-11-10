import { explain, machine, chart, kit, crankSlider } from 'mimir'

export default explain({
  title: 'How a four-stroke engine works',
  controls: { crank: { from: 0, to: 720, unit: '°', cyclic: true, label: 'crankshaft' } },
  stage: {
    engine: machine({
      parts: {
        crank: kit.crankshaft({ throw: 0.86, overhung: true }),
        rod: kit.conRod({ length: 2.78 }),
        piston: kit.piston({ bore: 1.72 }),
        liner: kit.liner({ bore: 1.72, cut: 'half' }),
      },
      joints: [
        crankSlider({ crank: 'crank', rod: 'rod', slider: 'piston', angle: 'crank' }),
        ['liner', 'around', 'piston'],
      ],
      camera: 'front',
    }),
    height: chart({
      x: 'crank',
      y: 'piston height',
      curve: ({ engine }) => engine.probe('piston.y'),
    }),
  },
  story: [
    {
      say: 'A [piston](engine.piston) slides in a cylinder, driven by the [crank](engine.crank) through a [rod](engine.rod).',
      set: { crank: 45 },
    },
    {
      say: 'Intake: the piston moves down and draws in fresh air and fuel.',
      set: { crank: 180 },
      engine: { highlight: 'piston' },
    },
    {
      say: 'Compression: the piston rises and squeezes the mixture.',
      set: { crank: 360 },
    },
    {
      say: 'Power: a spark ignites it, and the burning gas pushes the piston down.',
      set: { crank: 540 },
      engine: { highlight: 'crank' },
    },
    {
      say: 'Exhaust: the piston rises again and pushes the burnt gas out.',
      set: { crank: 720 },
      engine: { highlight: 'piston' },
    },
    {
      say: 'Four strokes take two full turns of the [crank](engine.crank), as the [height](height) curve shows.',
      engine: { camera: 'iso', highlight: null },
    },
  ],
})
