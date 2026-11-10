/**
 * Seeded random numbers: the only source of randomness a scene may use.
 * Generator: sfc32 (128-bit state, passes PractRand), seeded by hashing the seed text with xmur3.
 */

/** A seeded random stream. The same seed always gives the same sequence. */
export interface Rng {
  /** Next number, uniform in [0, 1). */
  next(): number
  /** Uniform number in [a, b). */
  range(a: number, b: number): number
  /** Uniform whole number between a and b, both included (int(1, 6) is a die). */
  int(a: number, b: number): number
  /** One element of the array, chosen uniformly (undefined for an empty array). */
  pick<T>(items: readonly T[]): T
  /** Normally distributed number (Box-Muller; always consumes two uniforms). */
  normal(mean?: number, deviation?: number): number
  /** Exponentially distributed waiting time with the given mean (time between random arrivals). */
  exponential(mean?: number): number
  /** True with the given probability. */
  chance(probability: number): boolean
  /** A shuffled copy of the array (Fisher-Yates). */
  shuffle<T>(items: readonly T[]): T[]
  /** An independent stream named by `label`; it depends only on the seed and the label, not on how many numbers this stream has produced. */
  fork(label: string | number): Rng
}

/** xmur3 string hash: returns a function producing successive 32-bit seeds from the text. */
function hashWords(text: string): () => number {
  let h = 1779033703 ^ text.length
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return h >>> 0
  }
}

function fromKey(key: string): Rng {
  const words = hashWords(key)
  let a = words() | 0
  let b = words() | 0
  let c = words() | 0
  let d = words() | 0

  const next = (): number => {
    const t = (((a + b) | 0) + d) | 0
    d = (d + 1) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    c = (c + t) | 0
    return (t >>> 0) / 4294967296
  }
  for (let i = 0; i < 15; i++) next()

  const int = (x: number, y: number): number => {
    const low = Math.ceil(Math.min(x, y))
    const high = Math.floor(Math.max(x, y))
    if (!(high >= low)) {
      next()
      return low
    }
    return low + Math.floor(next() * (high - low + 1))
  }

  return {
    next,
    range: (x, y) => x + (y - x) * next(),
    int,
    pick: <T>(items: readonly T[]): T => {
      const u = next()
      return items[Math.floor(u * items.length)] as T
    },
    normal: (mean = 0, deviation = 1) => {
      const radius = Math.sqrt(-2 * Math.log(1 - next()))
      const angle = 2 * Math.PI * next()
      return mean + deviation * radius * Math.cos(angle)
    },
    exponential: (mean = 1) => -mean * Math.log(1 - next()),
    chance: (probability) => next() < probability,
    shuffle: <T>(items: readonly T[]): T[] => {
      const copy = items.slice()
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        const swap = copy[i] as T
        copy[i] = copy[j] as T
        copy[j] = swap
      }
      return copy
    },
    fork: (label) => fromKey(`${key}/${typeof label}:${String(label)}`),
  }
}

/** Creates a seeded random stream: `rng(7).next()`; the same seed always replays the same numbers. */
export function rng(seed: number | string = 0): Rng {
  return fromKey(`${typeof seed}:${String(seed)}`)
}
