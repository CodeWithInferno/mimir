import { describe, expect, test } from 'bun:test'
import { estimateTiming, parseNarration, scheduleCues } from '../../../../src/lib/guide/index.ts'
import type { CueSchedule, ScheduleOptions, TimingOptions } from '../../../../src/lib/guide/index.ts'

function compile(text: string, timing: TimingOptions = {}, schedule: ScheduleOptions = {}): CueSchedule {
  const parsed = parseNarration(text)
  return scheduleCues(parsed, estimateTiming(parsed, timing), schedule)
}

const TWO_SPANS = 'the [piston](piston) slides down and the [intake valve](ring:intakeValve) opens.'

describe('scheduleCues - probe assertions (narration_cues.mjs)', () => {
  test('6. the pointer leaves early and lands ON the word', () => {
    const s = compile(TWO_SPANS, { duration: 4 }, { hop: 0.6 })
    expect(Math.abs(s.cues[1]!.landAt - s.cues[1]!.wordAt)).toBeLessThan(1e-9)
    expect(Math.abs(s.cues[1]!.fireAt - (s.cues[1]!.wordAt - 0.6))).toBeLessThan(1e-9)
    // a cue too close to t=0 leaves at 0 and lands late, and that is flagged
    expect(s.cues[0]!.fireAt).toBe(0)
    expect(s.cues[0]!.landAt).toBe(0.6)
    expect(s.cues[0]!.late).toBe(true)
    expect(s.cues[0]!.lateBy).toBeCloseTo(0.6 - s.cues[0]!.wordAt, 12)
    expect(s.cues[1]!.late).toBe(false)
    expect(s.cues[1]!.lateBy).toBe(0)
    // ring lives to the step end; point until the next pointer cue takes off
    expect(s.cues[1]!.markEnd).toBe(4)
    expect(s.cues[0]!.markEnd).toBe(s.cues[1]!.fireAt)
  })

  test('7. three cues inside one second cannot all be on time; the minimum perch is always kept', () => {
    const s = compile('[a](piston) [b](sparkPlug) [c](crankshaft) then a long tail of narration that keeps going for a while.', { duration: 6 })
    expect(s.cues.filter((cue) => cue.late).length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < s.cues.length; i++) expect(s.cues[i]!.fireAt).toBeGreaterThanOrEqual(s.cues[i - 1]!.landAt + 0.35 - 1e-9)
  })

  test('8. real word times are used verbatim and the 0.5 s flight is back-timed from them', () => {
    const parsed = parseNarration(TWO_SPANS)
    const timing = estimateTiming(parsed, {
      wordTimes: [
        { offset: 0, time: 0 },
        { offset: parsed.spans[0]!.start, time: 1.25 },
        { offset: parsed.spans[1]!.start, time: 3.1 },
      ],
    })
    const g = scheduleCues(parsed, timing)
    expect(g.cues[0]!.wordAt).toBe(1.25)
    expect(g.cues[1]!.wordAt).toBe(3.1)
    expect(g.cues[0]!.landAt).toBe(1.25)
    expect(g.cues[0]!.fireAt).toBe(0.75)
  })

  test('9. the schedule is deterministic', () => {
    expect(JSON.stringify(compile(TWO_SPANS, { duration: 4 }))).toBe(JSON.stringify(compile(TWO_SPANS, { duration: 4 })))
  })

  test('a reference cue table (worked out by hand from the timing rules) is reproduced', () => {
    const narration =
      'On the intake stroke the [piston](engine.piston) slides down. ' +
      'The [intake valve](ring:engine.intakeValve) opens, and [fuel and air](arrow:engine.intakePort->engine.cylinder) rush in to fill the space. ' +
      'Then the [spark plug](label:engine.sparkPlug) waits for its moment.'
    // the probe weighted every pause as exactly 6 characters
    const s = compile(narration, { commaPause: 6 / 16.5, sentencePause: 6 / 16.5 })
    const table = s.cues.map((cue) => [cue.verb, cue.targets.join('->'), cue.wordAt, cue.fireAt, cue.landAt, cue.drawEnd])
    const expected: [string, string, number, number, number, number][] = [
      ['point', 'engine.piston', 1.515, 1.015, 1.515, 1.515],
      ['ring', 'engine.intakeValve', 3.333, 2.833, 3.333, 3.783],
      ['arrow', 'engine.intakePort->engine.cylinder', 5.152, 4.652, 5.152, 5.602],
      ['label', 'engine.sparkPlug', 8.485, 7.985, 8.485, 8.935],
    ]
    expect(s.duration).toBeCloseTo(10.788, 3)
    expect(table.length).toBe(4)
    for (let i = 0; i < 4; i++) {
      expect(table[i]![0]).toBe(expected[i]![0])
      expect(table[i]![1]).toBe(expected[i]![1])
      for (let k = 2; k < 6; k++) expect(table[i]![k] as number).toBeCloseTo(expected[i]![k] as number, 3)
    }
    expect(s.cues[0]!.markEnd).toBeCloseTo(2.833, 3) // "next"
    for (let i = 1; i < 4; i++) expect(s.cues[i]!.markEnd).toBeCloseTo(10.788, 3)
  })
})

describe('scheduleCues - back-timing', () => {
  test('every on-time pointer cue fires exactly one hop before its word and lands on it', () => {
    const s = compile('Some words first, then the [piston](piston) moves. After a while the [valve](label:valve) opens too.')
    expect(s.cues.length).toBe(2)
    for (const cue of s.cues) {
      expect(cue.pointer).toBe(true)
      expect(cue.landAt).toBe(cue.wordAt)
      expect(cue.fireAt).toBe(cue.wordAt - 0.5)
      expect(cue.lateBy).toBe(0)
      expect(cue.late).toBe(false)
    }
  })

  test('hop length is an option', () => {
    const s = compile('Some words first, then the [piston](piston) moves.', {}, { hop: 0.2 })
    expect(s.cues[0]!.fireAt).toBeCloseTo(s.cues[0]!.wordAt - 0.2, 12)
  })

  test('a lead-in lets the pointer reach a word that opens the narration', () => {
    const late = compile('[Pistons](piston) move.')
    expect(late.cues[0]!.wordAt).toBe(0)
    expect(late.cues[0]!.landAt).toBe(0.5)
    expect(late.cues[0]!.late).toBe(true)
    const onTime = compile('[Pistons](piston) move.', { leadIn: 0.5 })
    expect(onTime.cues[0]!.fireAt).toBe(0)
    expect(onTime.cues[0]!.landAt).toBe(0.5)
    expect(onTime.cues[0]!.late).toBe(false)
  })

  test('lateness inside the tolerance is measured but not flagged', () => {
    // "ab " is 3 characters, so the word starts at 3 / 16.5 = 0.18 s and the pointer lands 0.32 s late
    const s = compile('ab [piston](piston) moves along nicely.')
    expect(s.cues[0]!.lateBy).toBeCloseTo(0.5 - 3 / 16.5, 12)
    expect(s.cues[0]!.late).toBe(true)
    expect(compile('ab [piston](piston) moves along nicely.', {}, { lateTolerance: 0.4 }).cues[0]!.late).toBe(false)
  })

  test('fire and land times never go backwards for the pointer, and fireAt <= landAt <= drawEnd <= markEnd', () => {
    const texts = [
      '[a](a) [b](ring:b) [c](label:c) [d](arrow:a->b) [e](glow:e) [f](focus:f) [g](g).',
      'One [a](a), two [b](glow:b) three. Four [c](arrow:a->c) five six seven eight. [](focus:x)Nine [d](ring:a+b,hold).',
    ]
    for (const text of texts) {
      const s = compile(text)
      let previousLand = -Infinity
      s.cues.forEach((cue, i) => {
        expect(cue.spanIndex).toBe(i)
        expect(cue.fireAt).toBeGreaterThanOrEqual(0)
        expect(cue.landAt).toBeGreaterThanOrEqual(cue.fireAt)
        expect(cue.landAt).toBeGreaterThanOrEqual(cue.wordAt)
        expect(cue.drawEnd).toBeGreaterThanOrEqual(cue.landAt)
        expect(cue.markEnd).toBeGreaterThanOrEqual(cue.drawEnd)
        expect(cue.wordEnd).toBeGreaterThanOrEqual(cue.wordAt)
        if (cue.pointer) {
          expect(cue.fireAt).toBeGreaterThanOrEqual(previousLand + 0.35 - 1e-9)
          previousLand = cue.landAt
        }
      })
    }
  })
})

describe('scheduleCues - verbs and lifetimes', () => {
  test('glow and focus do not move the pointer and start on their word', () => {
    const s = compile('Now the [valves](glow:a+b) light up and we [look closer](focus:a) at them.')
    for (const cue of s.cues) {
      expect(cue.pointer).toBe(false)
      expect(cue.fireAt).toBe(cue.wordAt)
      expect(cue.landAt).toBe(cue.wordAt)
      expect(cue.dockAt).toBeNull()
      expect(cue.lateBy).toBe(0)
    }
  })

  test('a glow lasts 0.6 s past its words and at least 1.2 s; hold keeps it to the step end', () => {
    const short = compile('Then [it](glow:a) glows for quite a long while after that, you see.').cues[0]!
    expect(short.markEnd).toBeCloseTo(short.landAt + 1.2, 12)
    expect(short.drawEnd).toBeCloseTo(short.landAt + 0.45, 12)

    const long = compile('Then [this very long stretch of spoken words](glow:a) glows for a long while after that.').cues[0]!
    expect(long.wordEnd - long.wordAt).toBeGreaterThan(1.2)
    expect(long.markEnd).toBeCloseTo(long.wordEnd + 0.6, 12)

    const custom = compile('Then [it](glow:a) glows for quite a long while after that, you see.', {}, { glowMin: 2, drawTime: 0.1 }).cues[0]!
    expect(custom.markEnd).toBeCloseTo(custom.landAt + 2, 12)
    expect(custom.drawEnd).toBeCloseTo(custom.landAt + 0.1, 12)

    const held = compile('Then [it](glow:a,hold) glows for quite a long while after that, you see.')
    expect(held.cues[0]!.hold).toBe(true)
    expect(held.cues[0]!.markEnd).toBe(held.duration)
  })

  test('ring, label and arrow draw for 0.45 s and live to the end of the STEP', () => {
    const parsed = parseNarration('The [a](ring:a) and the [b](label:b) and the [c](arrow:a->c) are here.')
    const timing = estimateTiming(parsed)
    const s = scheduleCues(parsed, timing, { stepDuration: timing.duration + 1 })
    expect(s.duration).toBe(timing.duration + 1)
    expect(s.speechEnd).toBe(timing.speechEnd)
    for (const cue of s.cues) {
      expect(cue.drawEnd).toBeCloseTo(cue.landAt + 0.45, 12)
      expect(cue.markEnd).toBe(timing.duration + 1)
      expect(cue.hold).toBe(false)
    }
    // a step shorter than its narration is ignored
    expect(scheduleCues(parsed, timing, { stepDuration: 0.1 }).duration).toBe(timing.duration)
  })

  test('a focus lasts until the next focus fires, the last one to the step end', () => {
    const s = compile('[](focus:a)Look here for a moment. [](focus:b)Then look over there.')
    expect(s.cues[0]!.markEnd).toBe(s.cues[1]!.fireAt)
    expect(s.cues[1]!.markEnd).toBe(s.duration)
    expect(s.cues[0]!.drawEnd).toBe(s.cues[0]!.landAt)
  })

  test('an arrow keeps the pointer until its stroke is drawn', () => {
    const s = compile('Now a b c d e f the [air](arrow:a->b) [goes](c) in.')
    const arrow = s.cues[0]!
    const next = s.cues[1]!
    expect(arrow.landAt).toBe(arrow.wordAt)
    expect(next.fireAt).toBeGreaterThanOrEqual(arrow.drawEnd)
    expect(arrow.arrow).toEqual(['a', 'b'])
    expect(arrow.targets).toEqual(['a', 'b'])
  })

  test('an empty span at the very end fires when the narration ends', () => {
    const parsed = parseNarration('Watch this. [](focus:plug)')
    const timing = estimateTiming(parsed)
    const s = scheduleCues(parsed, timing)
    expect(s.cues[0]!.wordAt).toBe(timing.duration)
    expect(s.cues[0]!.wordEnd).toBe(timing.duration)
  })

  test('no spans, no cues', () => {
    const s = compile('An engine turns heat into motion.')
    expect(s.cues).toEqual([])
    expect(s.duration).toBeGreaterThan(0)
  })
})

describe('scheduleCues - dock', () => {
  test('the last pointer cue goes home 1.5 s after it comes to rest', () => {
    const s = compile('Some words and then the [piston](piston) moves.')
    const cue = s.cues[0]!
    expect(cue.dockAt).toBeCloseTo(Math.max(cue.landAt, cue.wordEnd) + 1.5, 12)
    expect(cue.markEnd).toBe(cue.dockAt!)
  })

  test('between two cues it goes home only when the round trip fits', () => {
    const near = compile('Some words and then the [piston](piston) moves and the [valve](valve) opens.')
    expect(near.cues[0]!.dockAt).toBeNull()
    expect(near.cues[0]!.markEnd).toBe(near.cues[1]!.fireAt)

    const filler = 'and it keeps moving up and down for a very long time while nothing else happens at all, again and again, '
    const far = compile(`Some words and then the [piston](piston) moves ${filler}until the [valve](valve) opens.`)
    const first = far.cues[0]!
    expect(first.dockAt).toBeCloseTo(Math.max(first.landAt, first.wordEnd) + 1.5, 12)
    expect(far.cues[1]!.fireAt).toBeGreaterThanOrEqual(first.dockAt! + 0.5 + 0.35)
    expect(first.markEnd).toBe(first.dockAt!)
  })

  test('dockAfter is an option; Infinity turns docking off', () => {
    const quick = compile('Some words and then the [piston](piston) moves.', {}, { dockAfter: 0.2 }).cues[0]!
    expect(quick.dockAt).toBeCloseTo(Math.max(quick.landAt, quick.wordEnd) + 0.2, 12)
    const never = compile('Some words and then the [piston](piston) moves.', {}, { dockAfter: Infinity })
    expect(never.cues[0]!.dockAt).toBeNull()
    expect(never.cues[0]!.markEnd).toBe(never.duration)
  })

  test('it waits for an arrow stroke and for long span words before counting idle time', () => {
    const arrow = compile('Some words and then the [air](arrow:a->b) moves.').cues[0]!
    expect(arrow.dockAt).toBeCloseTo(Math.max(arrow.drawEnd, arrow.wordEnd) + 1.5, 12)
    const long = compile('Then [this very long stretch of spoken words here](piston) ends.').cues[0]!
    expect(long.wordEnd).toBeGreaterThan(long.landAt + 0.45)
    expect(long.dockAt).toBeCloseTo(long.wordEnd + 1.5, 12)
  })
})
