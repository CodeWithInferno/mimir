// quick-bubble-sort: the story is bubble sort itself, run once while the scene is built. A step may hold a list of
// changes, played one after the other: compare a pair, then swap it. row.value(i) reads the row as it is by then.
import { explain, cells } from 'mimir'

export default explain({
  title: 'Bubble sort',
  stage: { row: cells([5, 2, 9, 1, 6, 3]) },
  story: function* ({ row }) {
    yield { say: 'Six values in a [row](row), out of order. Compare neighbours and swap the pairs that are the wrong way round.' }
    for (let end = row.length - 1; end > 0; end--) {
      for (let i = 0; i < end; i++) {
        const swap = row.value(i) > row.value(i + 1)
        yield { title: `${row.value(i)} and ${row.value(i + 1)}`, row: swap ? { compare: [i, i + 1], swap: [i, i + 1] } : { compare: [i, i + 1] } }
      }
      yield { say: `The largest value left, ${row.value(end)}, has reached its place.`, row: { done: end } }
    }
    yield { say: 'Only one value is left, so the row is sorted.', row: { done: 0 } }
  },
})
