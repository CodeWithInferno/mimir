import { explain, chart } from 'mimir'

const f = (x) => (x - 3) ** 2 / 4 + 1
const grad = (x) => (x - 3) / 2

export default explain({
  title: 'How gradient descent finds a minimum',
  stage: {
    bowl: chart({ x: [0, 8], y: [0, 8], curve: (x) => f(x) }),
  },
  story: function* () {
    let x = 7.5
    const rate = 0.8
    yield {
      say: `We start high on the [curve](bowl.curve), at x = ${x.toFixed(1)}, where the loss is ${f(x).toFixed(2)}.`,
      bowl: { mark: [x, 'start'] },
    }
    yield {
      say: `The [slope](bowl.tangent) here is ${grad(x).toFixed(2)}. Uphill is to the right, so we go left.`,
      bowl: { tangentAt: x },
    }
    for (let i = 1; i <= 5; i++) {
      x = x - rate * grad(x)
      yield {
        say: `Step ${i}: move against the slope. Now x = ${x.toFixed(2)} and the loss is ${f(x).toFixed(2)}.`,
        bowl: { mark: [x, 'step ' + i], tangentAt: x },
      }
    }
    yield {
      say: `The slope shrinks as we near the bottom (${grad(x).toFixed(2)}), so the steps shrink too. The minimum is at x = 3.`,
      bowl: { tangentAt: null, band: [2.5, 3.5, 'minimum'] },
    }
  },
})
