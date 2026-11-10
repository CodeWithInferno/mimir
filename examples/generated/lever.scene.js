import { explain, machine, chart, box, extrude, cylinder, GOLD, TEAL } from 'mimir'

const LOAD_ARM = 1.5, EFFORT_ARM = 3.5, rad = (d) => (d * Math.PI) / 180
const FULCRUM_X = -1

export default explain({
  title: 'How a lever works',
  controls: { push: { from: 0, to: 20, value: 0, unit: '°', label: 'push down' } },
  stage: {
    lever: machine({
      parts: {
        beam: box({ width: 5, height: 0.2, depth: 0.6, color: GOLD })
          .define('load', [-2, 0.4, 0])
          .define('effort', [2.2, 0.2, 0]),
        fulcrum: box({ width: 0.5, height: 0.8, depth: 0.6 }),
        load: box({ width: 0.7, height: 0.7, depth: 0.6, color: TEAL }),
      },
      joints: [
        ['beam', 'spins', { by: (c) => -c.push, about: 'z', at: [FULCRUM_X, 0, 0] }],
        ['fulcrum', 'follows', () => ({ at: [FULCRUM_X, -0.5, 0], turn: 0 })],
        ['load', 'on', 'beam.load'],
      ],
      camera: 'front',
    }),
    travel: chart({
      x: 'push',
      y: 'height moved',
      curves: {
        'effort end': (x) => EFFORT_ARM * Math.sin(rad(x)),
        'load end': (x) => LOAD_ARM * Math.sin(rad(x)),
      },
    }),
  },
  story: [
    { say: 'A stiff [beam](lever.beam) rests on a [fulcrum](lever.fulcrum). A [load](lever.load) sits on the short side.', set: { push: 0 } },
    { say: 'Push the long end down, and the [load](lever.load) rises.', set: { push: 10 } },
    { say: 'The long end travels a long way. The short end moves only a little, but it moves with more force.', set: { push: 20 }, focus: 'travel' },
    { say: 'The two [curves](travel) show it: the long arm moves more than twice as far as the short one.', set: { push: 5 } },
  ],
})
