// A neural network that really trains: 2 inputs, 3 hidden neurons, 1 answer, plain gradient descent on 40 days of
// weather. Every brightness, every weight and the error curve are read from that training run.
import { explain, layers, chart } from 'mimir'

// a day is a beach day when it is sunny and not windy
const days = (random) => Array.from({ length: 40 }, () => {
  const sun = random(), wind = random()
  return { x: [sun, wind], y: sun - wind > 0.15 ? 1 : 0 }
})

export default explain({
  title: 'How a neural network learns',
  controls: { sun: { from: 0, to: 1, value: 0.5 }, wind: { from: 0, to: 1, value: 0.5 } },
  stage: {
    net: layers({ sizes: [2, 3, 1], inputs: ['sun', 'wind'], outputs: ['beach day?'], feed: ['sun', 'wind'],
                  train: { data: days, rate: 3, rounds: 300, seed: 7 } }),
    error: chart({ x: 'round', y: 'error', follow: 'net.error' }),
  },
  story: [
    { say: 'A [neuron](net.2.2) holds one number between zero and one: how lit up it is.', net: { focus: '2.2' } },
    { say: 'Its number comes from the neurons that feed it. Each [link](net.1.1-2.2) has a weight: blue pushes up, red pulls down.', net: { focus: '1.1-2.2' } },
    { say: 'Numbers flow forward, layer by layer, to one [answer](net.3.1).', net: { pulse: true } },
    { say: 'At first the weights are random, so the answer is a guess. Sunny and calm should be a yes.', set: { sun: 0.9, wind: 0.1 } },
    { say: 'Learning nudges every weight, round after round, and the [error](error) shrinks.', net: { round: 'end' } },
    { say: 'Now a windy, grey day gives a clear no.', set: { sun: 0.2, wind: 0.9 } },
  ],
})
