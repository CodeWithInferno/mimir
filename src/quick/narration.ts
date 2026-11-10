// What an author gets wrong in a sentence is absorbed here, not reported: the narration rules of `mimir check`
// (src/lib/guide/lint.ts) are run on the sentence while the scene is built, and each finding is repaired the way its
// own fix line says. Too many marks in a sentence: the first few stay marks, the rest are spoken as plain words. A
// pointer that cannot arrive in time (two links back to back): the mark stays, as a glow that needs no pointer. The
// same part twice in a row: once. A symbol the ear cannot parse: the word for it. A sentence that is too long: two.
// Pure text in, text out (no scene): unit-tested under bun.
import { estimateTiming, lintNarration, parseNarration, scheduleCues } from '../lib/guide/index.ts'

/** The limits and timings the engine's guide checks a sentence against (GUIDE_DEFAULTS of src/guide, read from the scene). */
export interface NarrationRules {
  charactersPerSecond: number; commaPause: number; sentencePause: number; leadIn: number
  hop: number; perch: number; drawTime: number; glowTime: number; dockAfter: number
  maximumSentenceWords: number; maximumMarksPerSentence: number; maximumDeadAir: number; maximumLate: number
}
/** Named defaults of the repair. */
export const NARRATION_DEFAULTS = {
  /** most passes of lint-and-repair over one sentence */
  passes: 24,
  /** a sentence is only split where both halves keep at least this many words */
  minimumHalf: 4,
  /** words a too-long sentence may be split before, when it has no comma, semicolon or colon to end on */
  joints: ['and', 'but', 'so', 'then', 'because', 'while', 'which', 'when'] as readonly string[],
}
const LINK = /\[([^\]]*)\]\(([^)]*)\)/g
const UNITS: Record<string, string> = { mm: 'millimetres', cm: 'centimetres', kg: 'kilograms', rpm: 'turns a minute', psi: 'pounds per square inch', kPa: 'kilopascals', Nm: 'newton metres' }
/** Symbols and abbreviations a voice reads badly, as the words for them (the list of src/lib/guide/lint.ts). */
function speakable(words: string): string {
  return words
    .replace(/\be\.g\.,?/gi, 'for example').replace(/\bi\.e\.,?/gi, 'that is').replace(/\betc\./gi, 'and so on')
    .replace(/(\d+(?:\.\d+)?)\s?(mm|cm|kg|rpm|psi|kPa|Nm)\b/g, (_m, n: string, u: string) => `${n} ${UNITS[u]}`)
    .replace(/\s*(?:->|→|⇒)\s*/g, ' to ').replace(/\s*(?:<-|←)\s*/g, ' from ').replace(/↑/g, ' up ').replace(/↓/g, ' down ')
    .replace(/\s*<=\s*/g, ' at most ').replace(/\s*>=\s*/g, ' at least ').replace(/\s*(?:!=|≠)\s*/g, ' is not ')
    .replace(/\s*=+\s*/g, ' equals ').replace(/\s+\+\s+/g, ' plus ').replace(/\s*%/g, ' percent').replace(/\s*&\s*/g, ' and ')
    .replace(/\s*<\s*/g, ' under ').replace(/\s*>\s*/g, ' over ').replace(/\s*\|\s*/g, ' or ').replace(/~\s*/g, 'about ').replace(/#\s*(?=\d)/g, 'number ')
    .replace(/(\w)\*(\w)/g, '$1 times $2').replace(/[@#*_`~]/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
}
/** Apply `fn` to the spoken words only: the plain text and the words of every link, never a link's target. */
const overWords = (say: string, fn: (words: string) => string): string => {
  let out = '', at = 0
  for (const m of say.matchAll(LINK)) { out += fn(say.slice(at, m.index)) + `[${fn(m[1]!).trim()}](${m[2]})`; at = m.index! + m[0].length }
  return out + fn(say.slice(at))
}
/** Rewrite the k-th link of the sentence. */
const editLink = (say: string, k: number, edit: (words: string, inner: string) => string): string => { let i = -1; return say.replace(LINK, (whole, words: string, inner: string) => (++i === k ? edit(words, inner) : whole)) }
const verbOf = (inner: string): string => /^\s*([A-Za-z]+):/.exec(inner)?.[1] ?? 'point'
const upper = (token: string): string => token.replace(/^(\[?)(\p{Ll})/u, (_m, b: string, c: string) => b + c.toUpperCase())

/** Split the sentence that holds word number `limit + 1` of a too-long run: end it at a comma, or before a joining word. */
function splitLong(say: string, limit: number): string | null {
  const tokens = say.match(/\[[^\]]*\]\([^)]*\)\S*|\S+/g) ?? []
  const count = (t: string): number => { const link = /^\[([^\]]*)\]/.exec(t); return link ? link[1]!.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : /[\p{L}\p{N}]/u.test(t) ? 1 : 0 }
  let from = 0
  while (from < tokens.length) {
    let to = from
    while (to < tokens.length - 1 && !/[.!?]["')\]]*$/.test(tokens[to]!.replace(/\]\([^)]*\)/, ''))) to++
    const words = tokens.slice(from, to + 1).map(count)
    const total = words.reduce((a, b) => a + b, 0)
    if (total > limit) {
      // the break nearest the middle that leaves both halves long enough: a comma first, else a joining word
      let best = -1, bestOff = Infinity, joint = false, seen = 0
      for (let i = from; i < to; i++) {
        seen += words[i - from]!
        if (seen < NARRATION_DEFAULTS.minimumHalf || total - seen < NARRATION_DEFAULTS.minimumHalf) continue
        const comma = /[,;:]$/.test(tokens[i]!), joins = NARRATION_DEFAULTS.joints.includes(tokens[i + 1]!.toLowerCase())
        if (!comma && !joins) continue
        const off = Math.abs(seen - total / 2) + (comma ? 0 : total)
        if (off < bestOff) { best = i; bestOff = off; joint = !comma }
      }
      if (best < 0) return null
      tokens[best] = joint ? tokens[best]! + '.' : tokens[best]!.replace(/[,;:]$/, '.')
      tokens[best + 1] = upper(tokens[best + 1]!)
      return tokens.join(' ')
    }
    from = to + 1
  }
  return null
}

/**
 * Make a sentence pass the narration rules of `mimir check`. `say` is in the engine's syntax (`[words](verb:id)`).
 * Returns the sentence to speak and what was changed, in words (for `describe`).
 */
export function absorbNarration(say: string, rules: NarrationRules): { say: string; changes: string[] } {
  const changes: string[] = []
  const note = (what: string): void => { if (!changes.includes(what)) changes.push(what) }
  let text = overWords(say, speakable)
  if (text !== say) note('symbols and abbreviations are spoken as words')
  for (let pass = 0; pass < NARRATION_DEFAULTS.passes; pass++) {
    const parsed = parseNarration(text)
    const timing = estimateTiming(parsed, { charsPerSecond: rules.charactersPerSecond, commaPause: rules.commaPause, sentencePause: rules.sentencePause, leadIn: rules.leadIn })
    const schedule = scheduleCues(parsed, timing, { hop: rules.hop, minPerch: rules.perch, drawTime: rules.drawTime, glowMin: rules.glowTime, dockAfter: rules.dockAfter, lateTolerance: rules.maximumLate } as never)
    const found = lintNarration({ ...parsed, errors: [] }, schedule, parsed.spans.flatMap((sp) => sp.targets).map((id) => ({ id })) as never, { maxSentenceWords: rules.maximumSentenceWords, maxMarksPerSentence: rules.maximumMarksPerSentence, maxDeadAir: rules.maximumDeadAir, maxLate: rules.maximumLate })
    let next = text
    for (const f of found) {
      if (f.code === 'GUIDE-CROWDED' && f.sentenceIndex !== undefined) {
        // keep the first marks of the sentence, speak the last one as plain words
        let last = -1
        parsed.spans.forEach((sp, i) => { if (sp.sentence === f.sentenceIndex && sp.verb !== 'focus') last = i })
        if (last >= 0) { next = editLink(text, last, (words) => words); note(`more than ${rules.maximumMarksPerSentence} links in one sentence: the later ones are spoken without a mark`) }
      } else if (f.code === 'GUIDE-LATE' && f.spanIndex !== undefined) {
        // the pointer cannot be there in time: a glow marks the part without it; a second glow in a row is plain words
        next = editLink(text, f.spanIndex, (words, inner) => (verbOf(inner) === 'point' ? `[${words}](glow:${inner.replace(/^\s*point:/, '')})` : words))
        note('links too close for the pointer to travel: the later one glows instead')
      } else if (f.code === 'GUIDE-REPEAT' && f.spanIndex !== undefined) {
        next = editLink(text, f.spanIndex, (words) => words)
        note('the same part linked twice in a row: the second is plain words')
      } else if (f.code === 'SAY-LONG') {
        const cut = splitLong(text, rules.maximumSentenceWords)
        if (cut) { next = cut; note(`a sentence over ${rules.maximumSentenceWords} words is spoken as two`) }
      } else if (f.code === 'SAY-SYMBOL') {
        // whatever the table above did not know: drop the symbol
        const bare = overWords(text, (w) => w.replace(/[→←↑↓⇒%&=@#*_`~<>|]/g, ' ').replace(/[ \t]{2,}/g, ' '))
        if (bare !== text) { next = bare; note('symbols and abbreviations are spoken as words') }
      }
      if (next !== text) break
    }
    if (next === text) break
    text = next
  }
  return { say: text, changes }
}
