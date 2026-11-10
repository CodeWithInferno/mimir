/**
 * Narration lint, shaped for `check`: every finding has a code, one sentence with the measured value
 * and the limit, and 1-3 literal fixes. Pure: works from the parsed text, the cue schedule and the part list.
 */
import { editDistance, squash, typoBudget } from './names.ts'
import { GUIDE_VERBS, isGuideVerb } from './parse.ts'
import type { CueSchedule, LintLimits, ManifestPart, NarrationLint, NarrationSpan, ParsedNarration } from './types.ts'

/** Anchor names every part has, valid after a part id (`piston.top`). */
export const STANDARD_ANCHORS: readonly string[] = Object.freeze(['top', 'bottom', 'left', 'right', 'front', 'back', 'center'])

/** Things text-to-speech reads badly: [pattern, what it is, the literal fix]. */
const EAR_HOSTILE: readonly (readonly [RegExp, string, string])[] = [
  [/\be\.g\./i, '"e.g." is an abbreviation', 'write "for example"'],
  [/\bi\.e\./i, '"i.e." is an abbreviation', 'write "that is"'],
  [/\betc\./i, '"etc." is an abbreviation', 'write "and so on"'],
  [/[→←↑↓⇒]/, 'an arrow symbol cannot be spoken', 'say the relation in words, for example "leads to"'],
  [/%/, '"%" is a symbol', 'write "percent"'],
  [/&/, '"&" is a symbol', 'write "and"'],
  [/=/, '"=" is a symbol', 'write "equals"'],
  [/[@#*_`~<>|]/, 'a symbol that text-to-speech reads badly or skips', 'remove the symbol or say it in words'],
  [/\b\d+(\.\d+)?\s?(mm|cm|kg|rpm|psi|kPa|Nm)\b/, 'an abbreviated unit', 'spell the unit out, for example "millimetres"'],
]

/** A token that counts as a spoken word (has a letter or a digit). */
const SPEAKABLE = /[\p{L}\p{N}]/u

/** Lint narration against its schedule and the scene's part list: unknown parts and verbs, pacing, density, lateness. */
export function lintNarration(
  parsed: ParsedNarration,
  schedule: CueSchedule,
  manifest: readonly ManifestPart[],
  limits: LintLimits = {},
): NarrationLint[] {
  const maxSentenceWords = limits.maxSentenceWords ?? 14
  const maxMarksPerSentence = limits.maxMarksPerSentence ?? 2
  const maxDeadAir = limits.maxDeadAir ?? 3
  const maxLate = limits.maxLate ?? 0.25
  const findings: NarrationLint[] = []
  const parts = new Map<string, ManifestPart>()
  for (const part of manifest) if (part && typeof part.id === 'string' && !parts.has(part.id)) parts.set(part.id, part)

  // 1. what the parser already found (unknown verb, arrow without two targets, bad brackets, targets that are not names)
  for (const error of parsed.errors) {
    const fix = error.fix.slice()
    if (error.code === 'GUIDE-NAME' && error.ref) {
      const suggestion = suggestPart(error.ref, manifest)
      if (suggestion) fix.unshift(`replace "${error.ref}" with ${suggestion}`)
    }
    findings.push({ code: error.code, severity: error.severity, what: error.what, fix: fix.slice(0, 3) })
  }

  // 2. per span: every part must exist; an arrow must have exactly two
  for (let i = 0; i < parsed.spans.length; i++) {
    const span = parsed.spans[i]!
    if (!isGuideVerb(span.verb)) {
      findings.push({
        code: 'GUIDE-VERB',
        severity: 'error',
        what: `unknown guide verb "${String(span.verb)}" in ${span.source} (verbs: ${Object.keys(GUIDE_VERBS).join(', ')})`,
        fix: [rewrite(span, span.targets, 'point')],
        spanIndex: i,
      })
      continue
    }
    if (span.verb === 'arrow' && (!span.arrow || span.targets.length !== 2)) {
      findings.push({
        code: 'GUIDE-ARROW',
        severity: 'error',
        what: `arrow needs two parts written from->to, got ${span.targets.length} in ${span.source}`,
        fix: [`[${span.words}](arrow:fromPart->${span.targets[0] ?? 'toPart'})`],
        spanIndex: i,
        measured: span.targets.length,
        limit: 2,
      })
    }
    for (const ref of span.targets) {
      const verdict = checkPart(ref, parts, manifest)
      if (verdict.ok) continue
      const suggestion = verdict.suggestion
      const fix: string[] = []
      if (suggestion) fix.push(rewrite(span, span.targets.map((target) => (target === ref ? suggestion : target))))
      if (isGuideVerb(ref)) fix.push(`a verb needs a part after it: [${span.words}](${ref}:partId)`)
      if (!suggestion) {
        const ids = [...parts.keys()]
        fix.push(ids.length ? `use one of: ${ids.slice(0, 8).join(', ')}${ids.length > 8 ? ', ...' : ''}` : 'give the part an id in the scene, then name it here')
      }
      fix.push(`remove the span: ${span.words}`)
      findings.push({
        code: 'GUIDE-TARGET',
        severity: 'error',
        what: `unknown part "${ref}" in ${span.source}` + (suggestion ? ` - did you mean "${suggestion}"?` : ''),
        fix: fix.slice(0, 3),
        spanIndex: i,
      })
    }
  }

  // 3. the pointer cannot reach a part by the time its word is spoken
  let previousPointerSpan = -1
  for (const cue of schedule.cues) {
    if (!cue.pointer) continue
    const span = parsed.spans[cue.spanIndex]
    if (cue.lateBy > maxLate) {
      const here = span ? span.source : `"${cue.words}"`
      const target = cue.arrow ? cue.arrow[0] : (cue.targets[0] ?? '')
      const before = previousPointerSpan >= 0 ? parsed.spans[previousPointerSpan] : undefined
      findings.push({
        code: 'GUIDE-LATE',
        severity: 'warn',
        what: `the pointer reaches "${target}" ${cue.lateBy.toFixed(2)} s after "${cue.words}" is spoken (limit ${maxLate} s)`,
        fix: before
          ? [`remove the span ${before.source} just before it`, `put more words between ${before.source} and ${here}`, `use glow, which does not move the pointer: [${cue.words}](glow:${target})`]
          : [`start the sentence with a few more words before ${here}`, `use glow, which does not move the pointer: [${cue.words}](glow:${target})`],
        spanIndex: cue.spanIndex,
        measured: cue.lateBy,
        limit: maxLate,
      })
    }
    previousPointerSpan = cue.spanIndex
  }

  // 4. per sentence: length, mark density, things the ear cannot parse
  for (let s = 0; s < parsed.sentences.length; s++) {
    const sentence = parsed.sentences[s]!
    let spokenWords = 0
    let breakAfter = ''
    for (let k = sentence.firstWord; k < sentence.firstWord + sentence.wordCount; k++) {
      const word = parsed.words[k]
      if (!word || !SPEAKABLE.test(word.text)) continue
      spokenWords += 1
      if (!breakAfter && spokenWords >= 4 && spokenWords <= maxSentenceWords && /[,;:]$/.test(word.text)) breakAfter = word.text
    }
    if (spokenWords > maxSentenceWords) {
      findings.push({
        code: 'SAY-LONG',
        severity: 'warn',
        what: `sentence is ${spokenWords} words (limit ${maxSentenceWords}): "${shorten(sentence.text, 60)}"`,
        fix: breakAfter
          ? [`end the sentence after "${breakAfter.replace(/[,;:]$/, '')}" and start a new one`, `cut it to ${maxSentenceWords} words or fewer`]
          : [`split it into two sentences of ${maxSentenceWords} words or fewer`],
        sentenceIndex: s,
        measured: spokenWords,
        limit: maxSentenceWords,
      })
    }

    let marks = 0
    for (const span of parsed.spans) if (span.sentence === s && span.verb !== 'focus') marks += 1
    if (marks > maxMarksPerSentence) {
      findings.push({
        code: 'GUIDE-CROWDED',
        severity: 'warn',
        what: `${marks} guide marks in one sentence (limit ${maxMarksPerSentence}): "${shorten(sentence.text, 60)}"`,
        fix: [`keep the ${maxMarksPerSentence} that matter and write the others as plain words`, 'split the sentence so each one carries one or two marks'],
        sentenceIndex: s,
        measured: marks,
        limit: maxMarksPerSentence,
      })
    }

    for (const [pattern, problem, fix] of EAR_HOSTILE) {
      if (pattern.test(sentence.text)) {
        findings.push({
          code: 'SAY-SYMBOL',
          severity: 'warn',
          what: `${problem} in narration that is spoken aloud: "${shorten(sentence.text, 60)}"`,
          fix: [fix],
          sentenceIndex: s,
        })
      }
    }
  }

  // 5. the same part pointed at twice in a row
  for (let i = 1; i < parsed.spans.length; i++) {
    const previous = parsed.spans[i - 1]!
    const current = parsed.spans[i]!
    if (previous.verb === 'point' && current.verb === 'point' && previous.targets[0] === current.targets[0]) {
      findings.push({
        code: 'GUIDE-REPEAT',
        severity: 'warn',
        what: `points at "${current.targets[0]}" twice in a row (${previous.source} then ${current.source})`,
        fix: [`write the second one as plain words: ${current.words}`],
        spanIndex: i,
      })
    }
  }

  // 6. stretches of narration in which the guide does nothing
  lintDeadAir(parsed, schedule, maxDeadAir, findings)

  // errors first, narration order within each severity
  return findings.filter((finding) => finding.severity === 'error').concat(findings.filter((finding) => finding.severity !== 'error'))
}

function lintDeadAir(parsed: ParsedNarration, schedule: CueSchedule, maxDeadAir: number, findings: NarrationLint[]): void {
  const speechStart = Number.isFinite(schedule.speechStart) ? schedule.speechStart : 0
  const speechEnd = Number.isFinite(schedule.speechEnd) ? schedule.speechEnd : schedule.duration
  if (!(speechEnd - speechStart > maxDeadAir)) return

  if (schedule.cues.length === 0) {
    const silent = speechEnd - speechStart
    findings.push({
      code: 'GUIDE-DEAD-AIR',
      severity: 'warn',
      what: `${silent.toFixed(1)} s of narration and the guide never moves (limit ${maxDeadAir} s)`,
      fix: ['wrap the words that name a part: [spoken words](partId)', 'shorten the narration or split the step'],
      measured: silent,
      limit: maxDeadAir,
    })
    return
  }

  // each cue keeps the eye busy from its landing until its words and its stroke are done
  const busy = schedule.cues
    .map((cue) => ({ from: cue.landAt, to: Math.max(cue.landAt, cue.drawEnd, cue.wordEnd), spanIndex: cue.spanIndex }))
    .sort((a, b) => a.from - b.from)
  let quietFrom = speechStart
  let quietSpan = -1 // span whose end opens the quiet stretch
  const report = (from: number, to: number, nextSpan: number): void => {
    const silent = to - from
    if (!(silent > maxDeadAir)) return
    const textFrom = quietSpan >= 0 ? (parsed.spans[quietSpan]?.end ?? 0) : 0
    const textTo = nextSpan >= 0 ? (parsed.spans[nextSpan]?.start ?? parsed.plain.length) : parsed.plain.length
    const quote = shorten(parsed.plain.slice(textFrom, Math.max(textFrom, textTo)).trim(), 48)
    findings.push({
      code: 'GUIDE-DEAD-AIR',
      severity: 'warn',
      what: `${silent.toFixed(1)} s of narration with no guide cue, from ${from.toFixed(1)} s to ${to.toFixed(1)} s${quote ? ` ("${quote}")` : ''} (limit ${maxDeadAir} s)`,
      fix: ['wrap the part named in that stretch: [spoken words](partId)', 'cut that stretch or move it to its own step'],
      measured: silent,
      limit: maxDeadAir,
    })
  }
  for (const interval of busy) {
    if (interval.from > quietFrom) report(quietFrom, Math.min(interval.from, speechEnd), interval.spanIndex)
    if (interval.to >= quietFrom) {
      quietFrom = interval.to
      quietSpan = interval.spanIndex
    }
  }
  report(quietFrom, speechEnd, -1)
}

/** Is `ref` a part of the scene? When it is not, the nearest name that is. */
function checkPart(ref: string, parts: ReadonlyMap<string, ManifestPart>, manifest: readonly ManifestPart[]): { ok: boolean; suggestion: string | null } {
  if (parts.has(ref)) return { ok: true, suggestion: null }
  // `part.anchor`: the longest dotted prefix that is a part owns the rest as an anchor name
  for (let cut = ref.lastIndexOf('.'); cut > 0; cut = ref.lastIndexOf('.', cut - 1)) {
    const owner = parts.get(ref.slice(0, cut))
    if (!owner) continue
    const anchor = ref.slice(cut + 1)
    if (STANDARD_ANCHORS.includes(anchor) || owner.anchors?.includes(anchor)) return { ok: true, suggestion: null }
    const sibling = suggestPart(ref, manifest)
    if (sibling && sibling.startsWith(owner.id + '.')) return { ok: false, suggestion: sibling }
    // without an anchor list the name cannot be verified here; the render-time check catches a miss
    if (!owner.anchors) return { ok: true, suggestion: null }
    let nearest: string | null = null
    let nearestDistance = Infinity
    for (const candidate of [...STANDARD_ANCHORS, ...owner.anchors]) {
      const distance = editDistance(anchor.toLowerCase(), candidate.toLowerCase())
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearest = candidate
      }
    }
    return { ok: false, suggestion: nearest !== null && nearestDistance <= (anchor.length <= 4 ? 1 : 2) ? `${owner.id}.${nearest}` : owner.id }
  }
  return { ok: false, suggestion: suggestPart(ref, manifest) }
}

/** The part id nearest to `ref`: an exact match on id, last id segment or label ignoring case and separators, else a typo. */
function suggestPart(ref: string, manifest: readonly ManifestPart[]): string | null {
  const wanted = squash(ref)
  const lower = ref.toLowerCase()
  let best: string | null = null
  let bestDistance = Infinity
  for (const part of manifest) {
    if (!part || typeof part.id !== 'string') continue
    const lastSegment = part.id.slice(part.id.lastIndexOf('.') + 1)
    if (wanted && (squash(part.id) === wanted || squash(lastSegment) === wanted || (part.label !== undefined && squash(part.label) === wanted))) {
      return part.id
    }
    let distance = Math.min(editDistance(lower, part.id.toLowerCase()), editDistance(lower, lastSegment.toLowerCase()))
    if (part.label !== undefined) distance = Math.min(distance, editDistance(wanted, squash(part.label)))
    if (distance < bestDistance) {
      bestDistance = distance
      best = part.id
    }
  }
  return bestDistance <= typoBudget(ref) ? best : null
}

/** The span as it should be written with these targets (keeps the words, the verb as authored, and the options). */
function rewrite(span: NarrationSpan, targets: readonly string[], verb: string = span.verb): string {
  const split = span.source.indexOf('](')
  const authoredAction = split >= 0 ? span.source.slice(split + 2) : ''
  const prefix = authoredAction.includes(':') || verb !== span.verb ? (verb === 'point' ? '' : verb + ':') : ''
  const options = span.options.length ? ',' + span.options.join(',') : ''
  return `[${span.words}](${prefix}${targets.join(span.arrow ? '->' : '+')}${options})`
}

function shorten(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(0, limit - 3).trimEnd() + '...'
}
