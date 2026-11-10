// quick-binary-search: explain() with one cells block. The story is the algorithm itself: a generator that runs once
// while the scene is built and yields one step per idea. No positions, sizes, durations or cameras anywhere.
import { explain, cells } from 'mimir'

export default explain({
  title: 'How binary search works',
  stage: { row: cells([3, 8, 12, 17, 21, 34, 42, 55], { pointers: ['lo', 'mid', 'hi'], index: true }) },
  story: function* ({ row }) {
    const target = 34
    let lo = 0, hi = row.length - 1
    yield { say: `We want ${target}. The [row](row) is sorted, so we never have to look at every value.`, row: { lo, hi } }
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      yield { say: `Look at the [middle](row.mid) of what is left: ${row.value(mid)}.`, row: { mid } }
      if (row.value(mid) === target) { yield { say: `That is ${target}. Found it.`, row: { found: mid, lit: mid } }; return }
      const low = row.value(mid) < target
      if (low) lo = mid + 1; else hi = mid - 1
      yield { say: `${row.value(mid)} is too ${low ? 'small' : 'large'}, so that half can no longer hold ${target}.`, row: { lo, hi, mid: null, lit: [lo, hi] } }
    }
  },
})
