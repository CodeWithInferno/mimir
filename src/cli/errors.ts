// Error types of the CLI. Exit codes: 0 clean, 1 errors found in the scene, 2 usage or internal failure.

/** Bad command line. Always exit code 2; main prints the command's usage line under it. */
export class UsageError extends Error {
  readonly exitCode = 2
  constructor(message: string, readonly command: string | null = null) {
    super(message)
    this.name = 'UsageError'
  }
}

/** A failure the user can act on (missing file, no browser, timeout, …). No stack trace is printed. */
export class CliError extends Error {
  constructor(message: string, readonly exitCode: number = 2) {
    super(message)
    this.name = 'CliError'
  }
}

/** Levenshtein distance, used for did-you-mean on flags, commands and doc symbols. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  const prev = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]!
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      prev[j] = Math.min(up + 1, prev[j - 1]! + 1, diag + cost)
      diag = up
    }
  }
  return prev[b.length]!
}

/**
 * Closest candidates to `word` (case-insensitive), nearest first, at most `max`. A candidate qualifies by edit
 * distance (to its full name or to the part after the last dot) or by containing the word / being contained
 * in it; the containment rule needs at least 4 characters, so "cylindr" does not suggest "DR".
 */
export function suggest(word: string, candidates: readonly string[], max = 3): string[] {
  const w = word.toLowerCase()
  const limit = Math.max(2, Math.floor(w.length / 3))
  return candidates
    .map((c) => {
      const lc = c.toLowerCase()
      const tail = lc.includes('.') ? lc.slice(lc.lastIndexOf('.') + 1) : lc
      const d = Math.min(editDistance(w, lc), editDistance(w, tail))
      const contains = (w.length >= 4 && lc.includes(w)) || (tail.length >= 4 && w.includes(tail))
      return { c, d, ok: d <= limit || contains }
    })
    .filter((x) => x.ok)
    .sort((x, y) => x.d - y.d || x.c.length - y.c.length || (x.c < y.c ? -1 : 1))
    .slice(0, max)
    .map((x) => x.c)
}
