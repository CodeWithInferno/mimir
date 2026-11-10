// How a rack and pinion turns rotation into sliding: kit parts, one kit mechanism, the rack's travel read back.
import { explain, machine, chart, kit, rackPinion } from 'mimir'

export default explain({
  title: 'How a rack and pinion turns rotation into sliding',
  controls: { turn: { from: 0, to: 360, unit: '°' } },
  stage: {
    gear: machine({
      parts: {
        pinion: kit.gear({ teeth: 14, module: 0.25, width: 0.5 }),
        rack: kit.rack({ teeth: 24, module: 0.25, width: 0.5 }),
        shaft: kit.shaft({ radius: 0.2, length: 1.6 }),
      },
      joints: [
        rackPinion({ rack: 'rack', pinion: 'pinion', angle: 'turn' }),
        ['shaft', 'on', 'pinion.center'],
      ],
    }),
    travel: chart({ x: 'turn', y: 'rack travel', curve: ({ gear }) => gear.probe('rack.travel') }),
  },
  story: [
    { say: 'A round [pinion](gear.pinion) meshes with a straight [rack](gear.rack): the same teeth, laid out flat.', set: { turn: 30 } },
    { say: 'Turn the pinion and each tooth pushes the rack one tooth along.', set: { turn: 120 }, gear: { camera: 'front' } },
    { say: "The [travel](travel) grows in a straight line: one full turn moves the rack by the pinion's circumference.", set: { turn: 360 } },
    { say: 'Turn it back and the rack slides back. That is how a steering wheel moves the wheels.', set: { turn: 0 }, gear: { camera: 'iso' } },
  ],
})
