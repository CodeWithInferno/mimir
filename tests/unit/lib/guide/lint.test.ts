import { describe, expect, test } from 'bun:test'
import { editDistance, estimateTiming, lintNarration, nearestName, parseNarration, scheduleCues } from '../../../../src/lib/guide/index.ts'
import type { LintLimits, ManifestPart, NarrationLint, TimingOptions } from '../../../../src/lib/guide/index.ts'

const ENGINE: ManifestPart[] = [{ id: 'piston' }, { id: 'intakeValve' }, { id: 'exhaustValve' }, { id: 'sparkPlug' }, { id: 'crankshaft' }]

function lint(text: string, manifest: readonly ManifestPart[] = ENGINE, timing: TimingOptions = {}, limits?: LintLimits): NarrationLint[] {
  const parsed = parseNarration(text)
  const schedule = scheduleCues(parsed, estimateTiming(parsed, timing))
  return lintNarration(parsed, schedule, manifest, limits)
}
const codes = (findings: NarrationLint[]): string[] => findings.map((finding) => finding.code)

describe('lintNarration - probe assertions (narration_cues.mjs)', () => {
  test('5. unknown part with did-you-mean, unspeakable symbols, the same part twice', () => {
    const findings = lint('the [valve](intakeValv) opens 50% e.g. now [it](piston) and [it](piston).')
    const target = findings.find((finding) => finding.code === 'GUIDE-TARGET')!
    expect(target.what).toContain('did you mean "intakeValve"')
    expect(target.fix[0]).toBe('[valve](intakeValve)')
    expect(codes(findings)).toContain('SAY-SYMBOL')
    expect(codes(findings)).toContain('GUIDE-REPEAT')
  })

  test('5b. a long narration with no cue is dead air, and one long sentence', () => {
    const findings = lint(new Array(31).fill('word').join(' ') + '.')
    expect(codes(findings)).toContain('GUIDE-DEAD-AIR')
    expect(codes(findings)).toContain('SAY-LONG')
  })

  test('7. over-dense cues are reported late', () => {
    const findings = lint('[a](piston) [b](sparkPlug) [c](crankshaft) then a long tail of narration that keeps going for a while.', ENGINE, { duration: 6 })
    expect(findings.filter((finding) => finding.code === 'GUIDE-LATE').length).toBeGreaterThanOrEqual(2)
  })
})

describe('lintNarration - rules', () => {
  test('clean narration has no findings', () => {
    const text =
      'On the intake stroke the [piston](piston) slides down. ' +
      'The [intake valve](ring:intakeValve) opens, and [fuel and air](arrow:intakeValve->piston) rush in to fill the space. ' +
      'Then the [spark plug](label:sparkPlug) waits for its moment.'
    expect(lint(text)).toEqual([])
    expect(lint('An engine turns heat into motion.')).toEqual([])
    expect(lint('')).toEqual([])
  })

  test('unknown part: GUIDE-TARGET error, nearest name, literal rewrite that keeps verb and options', () => {
    const findings = lint('Some words, then the [valve](ring:intakeValv,hold) opens.')
    expect(findings.length).toBe(1)
    expect(findings[0]!.code).toBe('GUIDE-TARGET')
    expect(findings[0]!.severity).toBe('error')
    expect(findings[0]!.spanIndex).toBe(0)
    expect(findings[0]!.fix[0]).toBe('[valve](ring:intakeValve,hold)')
  })

  test('unknown part: matches labels and the last id segment, ignoring case and separators', () => {
    const manifest: ManifestPart[] = [
      { id: 'engine.piston', label: 'piston' },
      { id: 'engine.intakeValve', label: 'inlet valve' },
      { id: 'engine.sparkPlug', label: 'spark plug' },
    ]
    expect(lint('Some words, then the [piston](piston) moves.', manifest)[0]!.fix[0]).toBe('[piston](engine.piston)')
    expect(lint('Some words, then the [valve](ring:inlet_valve) opens.', manifest)[0]!.fix[0]).toBe('[valve](ring:engine.intakeValve)')
    expect(lint('Some words, then the [plug](label:SPARKPLUG) fires.', manifest)[0]!.fix[0]).toBe('[plug](label:engine.sparkPlug)')
    const arrow = lint('Some words, then [air](arrow:engine.intakeValve->piston) moves.', manifest)
    expect(codes(arrow)).toEqual(['GUIDE-TARGET'])
    expect(arrow[0]!.fix[0]).toBe('[air](arrow:engine.intakeValve->engine.piston)')
  })

  test('unknown part with nothing close lists the known ids', () => {
    const findings = lint('Some words, then the [flux capacitor](fluxCapacitor) hums.')
    expect(findings[0]!.code).toBe('GUIDE-TARGET')
    expect(findings[0]!.what).not.toContain('did you mean')
    expect(findings[0]!.fix[0]).toBe('use one of: piston, intakeValve, exhaustValve, sparkPlug, crankshaft')
    expect(findings[0]!.fix[1]).toBe('remove the span: flux capacitor')
  })

  test('a verb written with no part is explained', () => {
    const findings = lint('Some words, then [this](glow) lights up.')
    expect(findings[0]!.code).toBe('GUIDE-TARGET')
    expect(findings[0]!.fix.some((fix) => fix.includes('[this](glow:partId)'))).toBe(true)
  })

  test('each unknown part of a multi-part span is reported', () => {
    const findings = lint('Some words, then [both](glow:intakeValv+exaustValve) open.')
    expect(codes(findings)).toEqual(['GUIDE-TARGET', 'GUIDE-TARGET'])
    expect(findings[1]!.fix[0]).toBe('[both](glow:intakeValv+exhaustValve)')
  })

  test('anchors: standard ones always pass, listed ones pass, typos of sub-parts and listed anchors fail', () => {
    const manifest: ManifestPart[] = [{ id: 'engine' }, { id: 'engine.piston' }, { id: 'rod', anchors: ['bigEnd', 'smallEnd'] }, { id: 'cam' }]
    expect(lint('Some words, then the [top](engine.piston.top) rises.', manifest)).toEqual([])
    expect(lint('Some words, then the [end](rod.bigEnd) turns.', manifest)).toEqual([])
    expect(lint('Some words, then the [lobe](cam.lobe) turns.', manifest)).toEqual([]) // unverifiable here, not an error

    const sibling = lint('Some words, then the [piston](engine.pistn) moves.', manifest)
    expect(codes(sibling)).toEqual(['GUIDE-TARGET'])
    expect(sibling[0]!.fix[0]).toBe('[piston](engine.piston)')

    const anchor = lint('Some words, then the [end](ring:rod.bigEdn) turns.', manifest)
    expect(codes(anchor)).toEqual(['GUIDE-TARGET'])
    expect(anchor[0]!.fix[0]).toBe('[end](ring:rod.bigEnd)')
  })

  test('unknown verb comes through as GUIDE-VERB', () => {
    const findings = lint('Some words, then the [spark plug](zap:sparkPlug) fires.')
    expect(codes(findings)).toEqual(['GUIDE-VERB'])
    expect(findings[0]!.severity).toBe('error')
    expect(findings[0]!.what).toContain('"zap"')
    expect(findings[0]!.what).toContain('point, ring, label, arrow, glow, focus')
  })

  test('arrow without two targets comes through as GUIDE-ARROW', () => {
    const one = lint('Some words, then [air](arrow:piston) moves.')
    expect(codes(one)).toEqual(['GUIDE-ARROW'])
    const plus = lint('Some words, then [air](arrow:piston+sparkPlug) moves.')
    expect(codes(plus)).toEqual(['GUIDE-ARROW'])
    expect(plus[0]!.fix[0]).toBe('[air](arrow:piston->sparkPlug)')
    // a hand-built span that claims to be an arrow is checked too
    const parsed = parseNarration('Some words, then [air](ring:piston) moves.')
    parsed.spans[0]!.verb = 'arrow'
    const forged = lintNarration(parsed, scheduleCues(parsed, estimateTiming(parsed)), ENGINE)
    expect(codes(forged)).toContain('GUIDE-ARROW')
  })

  test('a target that is not a name gets the nearest part as its first fix', () => {
    const findings = lint('Some words, then the [valve](ring:intake valve) opens.')
    expect(codes(findings)).toEqual(['GUIDE-NAME'])
    expect(findings[0]!.fix[0]).toBe('replace "intake valve" with intakeValve')
  })

  test('sentence over 14 words: 14 passes, 15 is flagged with the count', () => {
    const fourteen = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen.'
    expect(codes(lint(fourteen))).not.toContain('SAY-LONG')
    const fifteen = lint('one two three four five six, seven eight nine ten eleven twelve thirteen fourteen fifteen.')
    const long = fifteen.find((finding) => finding.code === 'SAY-LONG')!
    expect(long.measured).toBe(15)
    expect(long.limit).toBe(14)
    expect(long.what).toContain('15 words (limit 14)')
    expect(long.fix[0]).toBe('end the sentence after "six" and start a new one')
    expect(long.sentenceIndex).toBe(0)
    expect(long.severity).toBe('warn')
    // punctuation-only tokens are not words
    expect(codes(lint('one two three four five six seven — eight nine ten eleven twelve thirteen fourteen.'))).not.toContain('SAY-LONG')
  })

  test('more than 2 marks in a sentence: 2 pass, 3 are flagged, a camera focus is not a mark', () => {
    const two = lint('Slowly the [piston](piston) falls while the [intake valve](ring:intakeValve) opens wide.')
    expect(codes(two)).not.toContain('GUIDE-CROWDED')
    const three = lint('Slowly the [piston](piston) falls while the [intake valve](ring:intakeValve) opens and the [plug](label:sparkPlug) waits.')
    const crowded = three.find((finding) => finding.code === 'GUIDE-CROWDED')!
    expect(crowded.measured).toBe(3)
    expect(crowded.limit).toBe(2)
    expect(crowded.sentenceIndex).toBe(0)
    const withFocus = lint('[](focus:piston)Slowly the [piston](piston) falls while the [intake valve](ring:intakeValve) opens wide.')
    expect(codes(withFocus)).not.toContain('GUIDE-CROWDED')
    // marks are counted per sentence
    const split = lint('Slowly the [piston](piston) falls. Then the [intake valve](ring:intakeValve) opens. Later the [plug](label:sparkPlug) waits.')
    expect(codes(split)).not.toContain('GUIDE-CROWDED')
  })

  test('dead air over 3 s: the silent stretch is measured, located and quoted', () => {
    const text = 'Slowly the [piston](piston) falls. After that nothing at all is pointed at for a good long while, you see.'
    const findings = lint(text)
    const dead = findings.find((finding) => finding.code === 'GUIDE-DEAD-AIR')!
    expect(dead.measured!).toBeGreaterThan(3)
    expect(dead.limit).toBe(3)
    expect(dead.what).toContain('with no guide cue')
    expect(dead.what).toContain('falls. After that nothing')
    expect(dead.severity).toBe('warn')

    // the measured stretch runs from the end of the span's word to the end of speech
    const parsed = parseNarration(text)
    const timing = estimateTiming(parsed)
    const cue = scheduleCues(parsed, timing).cues[0]!
    expect(dead.measured!).toBeCloseTo(timing.speechEnd - Math.max(cue.wordEnd, cue.drawEnd), 9)

    // a cue in the middle breaks it up
    const fixed = lint('Slowly the [piston](piston) falls. After that only the [plug](label:sparkPlug) is marked, you see.')
    expect(codes(fixed)).not.toContain('GUIDE-DEAD-AIR')
  })

  test('dead air is also found before the first cue and between two cues', () => {
    const before = lint('For a good long while nothing at all is pointed at here, you see, and only then the [piston](piston) falls.')
    expect(before.find((finding) => finding.code === 'GUIDE-DEAD-AIR')!.what).toContain('from 0.0 s')
    const between = lint('The [piston](piston) falls here. After that nothing at all is pointed at for a good long while, you see, until the [plug](label:sparkPlug) fires.')
    expect(between.filter((finding) => finding.code === 'GUIDE-DEAD-AIR').length).toBe(1)
  })

  test('short narration with no cue is fine; the limits are options', () => {
    expect(codes(lint('It turns heat into motion.'))).not.toContain('GUIDE-DEAD-AIR')
    expect(codes(lint('It turns heat into motion.', ENGINE, {}, { maxDeadAir: 1 }))).toContain('GUIDE-DEAD-AIR')
    expect(codes(lint('one two three four.', ENGINE, {}, { maxSentenceWords: 3 }))).toContain('SAY-LONG')
    expect(codes(lint('Slowly the [piston](piston) falls while the [valve](ring:intakeValve) opens.', ENGINE, {}, { maxMarksPerSentence: 1 }))).toContain('GUIDE-CROWDED')
  })

  test('pointer landing more than 0.25 s late: flagged with the measured lateness and a cause-specific fix', () => {
    // the word starts at 0 s; the 0.5 s hop cannot be back-timed before the step begins
    const opening = lint('[Pistons](piston) move up and down.')
    const late = opening.find((finding) => finding.code === 'GUIDE-LATE')!
    expect(late.measured!).toBeCloseTo(0.5, 9)
    expect(late.limit).toBe(0.25)
    expect(late.what).toContain('0.50 s after "Pistons" is spoken (limit 0.25 s)')
    expect(late.fix[0]).toBe('start the sentence with a few more words before [Pistons](piston)')
    expect(late.spanIndex).toBe(0)

    // with a lead-in the same narration is on time
    expect(codes(lint('[Pistons](piston) move up and down.', ENGINE, { leadIn: 0.5 }))).not.toContain('GUIDE-LATE')

    // two marks back to back: the second is late because of the first
    const crowded = lint('Some words first, then the [piston](piston) [valve](ring:intakeValve) pair moves together now.')
    const second = crowded.find((finding) => finding.code === 'GUIDE-LATE')!
    expect(second.spanIndex).toBe(1)
    expect(second.fix[0]).toBe('remove the span [piston](piston) just before it')

    // 0.2 s late is inside the tolerance
    const parsed = parseNarration('Some words first, then the [piston](piston) moves.')
    const schedule = scheduleCues(parsed, estimateTiming(parsed))
    schedule.cues[0]!.lateBy = 0.2
    expect(codes(lintNarration(parsed, schedule, ENGINE))).not.toContain('GUIDE-LATE')
    schedule.cues[0]!.lateBy = 0.26
    expect(codes(lintNarration(parsed, schedule, ENGINE))).toContain('GUIDE-LATE')
  })

  test('glow and focus are never late', () => {
    expect(codes(lint('[These](glow:piston) [two](glow:sparkPlug) [parts](focus:crankshaft) matter.'))).not.toContain('GUIDE-LATE')
  })

  test('ear-hostile text is flagged with the replacement', () => {
    const findings = lint('Use 50% power & 12 mm bolts, etc. here.')
    const fixes = findings.filter((finding) => finding.code === 'SAY-SYMBOL').map((finding) => finding.fix[0])
    expect(fixes).toContain('write "percent"')
    expect(fixes).toContain('write "and"')
    expect(fixes).toContain('write "and so on"')
    expect(fixes).toContain('spell the unit out, for example "millimetres"')
  })

  test('errors come first; every finding has a code, a sentence and 1-3 fixes', () => {
    const findings = lint(
      'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen [x](zap:piston) [y](nope) [z] 50% [a](piston) [b](piston) [c](arrow:piston).',
    )
    expect(findings.length).toBeGreaterThanOrEqual(7)
    const severities = findings.map((finding) => finding.severity)
    expect(severities.lastIndexOf('error')).toBeLessThan(severities.indexOf('warn'))
    for (const finding of findings) {
      expect(finding.code).toMatch(/^(GUIDE|SAY)-[A-Z-]+$/)
      expect(finding.what.length).toBeGreaterThan(10)
      expect(finding.fix.length).toBeGreaterThanOrEqual(1)
      expect(finding.fix.length).toBeLessThanOrEqual(3)
      for (const fix of finding.fix) expect(fix.length).toBeGreaterThan(3)
    }
    expect(codes(findings)).toEqual(expect.arrayContaining(['GUIDE-VERB', 'GUIDE-TARGET', 'GUIDE-BARE', 'GUIDE-ARROW', 'SAY-LONG', 'SAY-SYMBOL', 'GUIDE-REPEAT']))
  })

  test('an empty manifest reports every part and says how to fix it', () => {
    const findings = lint('Some words, then the [piston](piston) moves.', [])
    expect(codes(findings)).toEqual(['GUIDE-TARGET'])
    expect(findings[0]!.fix[0]).toBe('give the part an id in the scene, then name it here')
  })

  test('deterministic and does not mutate its inputs', () => {
    const parsed = parseNarration('the [valve](intakeValv) opens 50% now [it](piston) and [it](piston).')
    const schedule = scheduleCues(parsed, estimateTiming(parsed))
    const before = JSON.stringify([parsed, schedule, ENGINE])
    const first = JSON.stringify(lintNarration(parsed, schedule, ENGINE))
    expect(JSON.stringify(lintNarration(parsed, schedule, ENGINE))).toBe(first)
    expect(JSON.stringify([parsed, schedule, ENGINE])).toBe(before)
  })
})

describe('names', () => {
  test('editDistance', () => {
    expect(editDistance('', '')).toBe(0)
    expect(editDistance('abc', 'abc')).toBe(0)
    expect(editDistance('kitten', 'sitting')).toBe(3)
    expect(editDistance('', 'abc')).toBe(3)
    expect(editDistance('intakeValv', 'intakeValve')).toBe(1)
  })

  test('nearestName picks typos and refuses unrelated names', () => {
    expect(nearestName('rng', ['point', 'ring', 'label'])).toBe('ring')
    expect(nearestName('INTAKEVALV', ['piston', 'intakeValve'])).toBe('intakeValve')
    expect(nearestName('fluxCapacitor', ['piston', 'intakeValve'])).toBeNull()
    expect(nearestName('x', [])).toBeNull()
  })
})
