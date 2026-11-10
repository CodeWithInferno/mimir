// How a hash table handles a collision: two keys that hash to the same bucket are chained in it.
import { explain, custom, formula, rect, text, group, fadeIn, WHITE, GOLD, GREY_B } from 'mimir'

const SIZE = 5
const KEYS = ['cat', 'dog', 'owl', 'act']                     // 'cat' and 'act' have the same letters: the same hash
const hash = (key) => [...key].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % SIZE

const table = custom(() => {
  const parts = [], targets = {}, used = new Array(SIZE).fill(0)
  for (let i = 0; i < SIZE; i++) {
    targets[`b${i}`] = rect({ width: 1.7, height: 0.9, color: GREY_B }).at(i * 2, 0)
    parts.push(targets[`b${i}`], text(String(i), { size: 'note', color: GREY_B }).at(i * 2, 0.75))
  }
  for (const key of KEYS) {
    const slot = hash(key), row = used[slot]++
    targets[key] = text(key, { size: 'label', color: row ? GOLD : WHITE }).at(slot * 2, -row * 1.1)
    parts.push(targets[key])
  }
  return {
    root: group(parts), targets,
    change: (st, change) => { if (change.add) st.play(fadeIn(targets[change.add])) },
    describe: (state) => `hash table of ${SIZE} buckets, last key added: ${state.add ?? 'none'}`,
  }
})

export default explain({
  title: 'How a hash table handles a collision',
  stage: { rule: formula(String.raw`\text{bucket} = \text{hash}(\text{key}) \bmod 5`), table },
  story: function* () {
    yield { say: 'A hash table is a row of [buckets](table). A [rule](rule) turns every key into a bucket number.' }
    for (const key of KEYS) {
      const slot = hash(key), clash = KEYS.slice(0, KEYS.indexOf(key)).find((k) => hash(k) === slot)
      yield clash
        ? { say: `"${key}" also lands in [bucket ${slot}](table.b${slot}), where "${clash}" already lives. It is chained [underneath](table.${key}).`, table: { add: key } }
        : { say: `"${key}" hashes to [bucket ${slot}](table.b${slot}) and moves in.`, table: { add: key } }
    }
    yield { say: 'To find a key again, hash it and walk only that one short chain.' }
  },
})
