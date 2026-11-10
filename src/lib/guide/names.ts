/** Name matching for did-you-mean suggestions. Pure string maths. */

/** Levenshtein distance between two strings. */
export function editDistance(a: string, b: string): number {
  const row = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) row[j] = j
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]!
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]!
      row[j] = Math.min(above + 1, row[j - 1]! + 1, diagonal + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1))
      diagonal = above
    }
  }
  return row[b.length]!
}

/** Largest edit distance that still counts as a typo of `name`. */
export function typoBudget(name: string): number {
  return Math.max(2, Math.floor(name.length / 3))
}

/** The candidate closest to `name` (case-insensitive), or null when none is near enough to be a typo. */
export function nearestName(name: string, candidates: readonly string[]): string | null {
  const wanted = name.toLowerCase()
  let best: string | null = null
  let bestDistance = Infinity
  for (const candidate of candidates) {
    const distance = editDistance(wanted, candidate.toLowerCase())
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  return bestDistance <= typoBudget(name) ? best : null
}

/** Lower-case letters and digits only, so "Intake valve", "intake_valve" and "intakeValve" compare equal. */
export function squash(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}
