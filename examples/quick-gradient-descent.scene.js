// Gradient descent on a real loss: the mean squared error of the line y = w x through five measured points.
// The path is computed by the update rule itself, so dragging the learning rate recomputes every step.
import { explain, chart } from 'mimir'

const data = [[0.5, 1.1], [1, 1.9], [1.5, 3.2], [2, 3.9], [2.5, 5.1]] // points near y = 2x
const loss = (w) => data.reduce((sum, [x, y]) => sum + (w * x - y) ** 2, 0) / data.length
const slope = (w) => data.reduce((sum, [x, y]) => sum + 2 * x * (w * x - y), 0) / data.length
const descend = (rate, steps) => {
  const path = [[-1, loss(-1)]]
  for (let i = 0; i < steps; i++) { const w = path[i][0] - rate * slope(path[i][0]); path.push([w, loss(w)]) }
  return path
}

export default explain({
  title: 'How gradient descent finds the best fit',
  controls: { rate: { from: 0.02, to: 0.34, value: 0.08, label: 'learning rate' }, steps: { from: 0, to: 12, step: 1, label: 'steps taken' } },
  stage: {
    valley: chart({ x: { name: 'weight', range: [-1.5, 5.5] }, y: 'loss', curve: loss, points: ({ rate, steps }) => descend(rate, Math.round(steps)) }),
    history: chart({ x: { name: 'step', range: [0, 12] }, y: 'loss', points: ({ rate, steps }) => descend(rate, Math.round(steps)).map(([, l], i) => [i, l]) }),
  },
  story: [
    { say: 'The [curve](valley.curve) is the loss: how wrong the fit is for each value of one weight.' },
    { say: 'Start anywhere. The [slope](valley.tangent) there says which way is down.', valley: { tangentAt: -1 } },
    { say: 'Step against the slope, a little at a time. Every [dot](valley.points) is one step.', valley: { tangentAt: null }, set: { steps: 12 } },
    { say: 'The [loss](history.points) falls fast at first, then levels off at the bottom.' },
    { say: 'The learning rate sets the length of a step. Too small and it crawls.', set: { rate: 0.02 } },
    { say: 'Too large and every step jumps across the valley.', set: { rate: 0.3 } },
    { say: 'A middle value lands on the best fit in a few steps.', set: { rate: 0.12 } },
  ],
})
