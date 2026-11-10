import { describe, expect, test } from 'bun:test'
import { GUIDE_VERBS, GUIDE_VERB_NAMES, isGuideVerb, parseNarration } from '../../../../src/lib/guide/index.ts'

describe('parseNarration - probe assertions (narration_cues.mjs)', () => {
  test('1. spans are stripped to their words and located in the spoken text', () => {
    const a = parseNarration('the [piston](piston) slides down and the [intake valve](ring:intakeValve) opens.')
    expect(a.plain).toBe('the piston slides down and the intake valve opens.')
    expect(/[\[\]()]/.test(a.plain)).toBe(false)
    expect(a.spans.length).toBe(2)
    expect(a.spans[0]!.verb).toBe('point')
    expect(a.spans[1]!.verb).toBe('ring')
    expect(a.plain.slice(a.spans[0]!.start, a.spans[0]!.end)).toBe('piston')
    expect(a.plain.slice(a.spans[1]!.start, a.spans[1]!.end)).toBe('intake valve')
    expect(a.spans[1]!.words).toBe('intake valve')
    expect(a.errors).toEqual([])
  })

  test('2. arrow, multi-target, options, zero-width span', () => {
    const b = parseNarration(
      '[fuel and air](arrow:intakePort->cylinder) rush in past [both valves](glow:intakeValve+exhaustValve,hold). [](focus:sparkPlug)Now watch.',
    )
    expect(b.spans[0]!.arrow).toEqual(['intakePort', 'cylinder'])
    expect(b.spans[0]!.targets).toEqual(['intakePort', 'cylinder'])
    expect(b.spans[1]!.targets).toEqual(['intakeValve', 'exhaustValve'])
    expect(b.spans[1]!.arrow).toBeUndefined()
    expect(b.spans[1]!.options).toEqual(['hold'])
    expect(b.spans[2]!.start).toBe(b.spans[2]!.end)
    expect(b.spans[2]!.verb).toBe('focus')
    expect(b.spans[2]!.words).toBe('')
    expect(b.plain).toBe('fuel and air rush in past both valves. Now watch.')
  })

  test('3. what an LLM gets wrong is caught, and the speech survives', () => {
    const c = parseNarration('see the [spark plug](zap:sparkPlug) and [this](420,133) and [POINT:none] and \\[literal\\].')
    const codes = c.errors.map((error) => error.code)
    expect(codes).toContain('GUIDE-VERB')
    expect(codes).toContain('GUIDE-NAME')
    expect(codes).toContain('GUIDE-BARE')
    expect(c.plain).toBe('see the spark plug and this and POINT:none and [literal].')
    expect(c.spans.length).toBe(0)
  })

  test('4. whitespace is collapsed and offsets stay aligned', () => {
    const d = parseNarration('  air   enters the\n   [compressor](compressor)   first. ')
    expect(d.plain).toBe('air enters the compressor first.')
    expect(d.plain.slice(d.spans[0]!.start, d.spans[0]!.end)).toBe('compressor')
  })
})

describe('parseNarration - grammar', () => {
  test('the verb table is the six documented verbs', () => {
    expect([...GUIDE_VERB_NAMES]).toEqual(['point', 'ring', 'label', 'arrow', 'glow', 'focus'])
    expect(Object.keys(GUIDE_VERBS)).toEqual([...GUIDE_VERB_NAMES])
    expect(GUIDE_VERBS.glow.pointer).toBe(false)
    expect(GUIDE_VERBS.focus.pointer).toBe(false)
    expect(GUIDE_VERBS.arrow.arity).toBe('pair')
    expect(isGuideVerb('ring')).toBe(true)
    expect(isGuideVerb('constructor')).toBe(false)
    expect(isGuideVerb('toString')).toBe(false)
  })

  test('verb is case-insensitive and whitespace inside the action is ignored', () => {
    const parsed = parseNarration('[both]( Ring : a + b , hold , numbered )')
    expect(parsed.errors).toEqual([])
    expect(parsed.spans[0]!.verb).toBe('ring')
    expect(parsed.spans[0]!.targets).toEqual(['a', 'b'])
    expect(parsed.spans[0]!.options).toEqual(['hold', 'numbered'])
  })

  test('dotted names, digits, hyphens, underscores and a leading # are names', () => {
    const parsed = parseNarration('[a](engine.piston) [b](piston.top) [c](gear-2) [d](_x9) [e](#valve) [f](ring:row.0)')
    expect(parsed.errors).toEqual([])
    expect(parsed.spans.map((span) => span.targets[0])).toEqual(['engine.piston', 'piston.top', 'gear-2', '_x9', 'valve', 'row.0'])
  })

  test('a->b with no verb is an arrow', () => {
    const parsed = parseNarration('[air](intake->cylinder) moves.')
    expect(parsed.errors).toEqual([])
    expect(parsed.spans[0]!.verb).toBe('arrow')
    expect(parsed.spans[0]!.arrow).toEqual(['intake', 'cylinder'])
  })

  test('arrow without exactly two targets is GUIDE-ARROW and the words are still spoken', () => {
    for (const bad of ['[air](arrow:intake)', '[air](arrow:a->b->c)', '[air](arrow:->b)', '[air](arrow:a->)', '[air](arrow:a+b)']) {
      const parsed = parseNarration(`the ${bad} moves.`)
      expect(parsed.errors.map((error) => error.code)).toEqual(['GUIDE-ARROW'])
      expect(parsed.spans).toEqual([])
      expect(parsed.plain).toBe('the air moves.')
    }
    expect(parseNarration('[air](arrow:a+b)').errors[0]!.fix[0]).toBe('[air](arrow:a->b)')
  })

  test('wrong target shapes are GUIDE-SHAPE with a literal fix', () => {
    const pair = parseNarration('[x](ring:a->b)')
    expect(pair.errors[0]!.code).toBe('GUIDE-SHAPE')
    expect(pair.errors[0]!.fix).toEqual(['[x](arrow:a->b)', '[x](ring:a+b)'])
    const many = parseNarration('[x](point:a+b) and [y](label:a+b)')
    expect(many.errors.map((error) => error.code)).toEqual(['GUIDE-SHAPE', 'GUIDE-SHAPE'])
    expect(many.errors[0]!.fix[0]).toBe('[x](ring:a+b)')
    expect(many.spans).toEqual([])
  })

  test('unknown verb suggests the nearest verb and never matches Object.prototype', () => {
    const typo = parseNarration('[x](rng:a,hold)')
    expect(typo.errors[0]!.code).toBe('GUIDE-VERB')
    expect(typo.errors[0]!.fix[0]).toBe('[x](ring:a,hold)')
    expect(parseNarration('[x](constructor:a)').errors[0]!.code).toBe('GUIDE-VERB')
  })

  test('targets that are not names are GUIDE-NAME and carry the offending text', () => {
    const pixels = parseNarration('[this](420,133)')
    expect(pixels.errors[0]!.code).toBe('GUIDE-NAME')
    expect(pixels.errors[0]!.ref).toBe('420')
    const free = parseNarration('[it](ring:intake valve)')
    expect(free.errors[0]!.code).toBe('GUIDE-NAME')
    expect(free.errors[0]!.ref).toBe('intake valve')
    expect(free.plain).toBe('it')
  })

  test('bracket problems are GUIDE-SYNTAX and the text is kept', () => {
    const unclosed = parseNarration('the [piston slides')
    expect(unclosed.errors.map((error) => error.code)).toEqual(['GUIDE-SYNTAX'])
    expect(unclosed.plain).toBe('the [piston slides')

    const nested = parseNarration('[a [b](x)](y)')
    expect(nested.errors[0]!.code).toBe('GUIDE-SYNTAX')
    expect(nested.errors[0]!.at).toBe(0)
    expect(nested.spans.length).toBe(1)
    expect(nested.spans[0]!.words).toBe('b')

    const paren = parseNarration('[a](ring:x')
    expect(paren.errors.map((error) => error.code)).toEqual(['GUIDE-SYNTAX'])
    expect(paren.spans).toEqual([])

    const empty = parseNarration('[a]() and [b](ring:) and [c](,hold)')
    expect(empty.errors.map((error) => error.code)).toEqual(['GUIDE-SYNTAX', 'GUIDE-SYNTAX', 'GUIDE-SYNTAX'])
    expect(empty.plain).toBe('a and b and c')
  })

  test('every error has a position, one sentence and at least one fix', () => {
    const parsed = parseNarration('[a](zap:x) [b](1,2) [c] [d](arrow:x) [e](point:x+y) [f')
    expect(parsed.errors.length).toBe(6)
    for (const error of parsed.errors) {
      expect(error.at).toBeGreaterThanOrEqual(0)
      expect(error.what.length).toBeGreaterThan(10)
      expect(error.fix.length).toBeGreaterThanOrEqual(1)
      expect(error.fix.length).toBeLessThanOrEqual(3)
    }
    expect(parsed.errors.map((error) => error.severity)).toEqual(['error', 'error', 'warn', 'error', 'error', 'error'])
  })

  test('source and at point back into the authored text', () => {
    const text = 'The [intake valve](ring:intakeValve) opens.'
    const span = parseNarration(text).spans[0]!
    expect(span.source).toBe('[intake valve](ring:intakeValve)')
    expect(text.slice(span.at, span.at + span.source.length)).toBe(span.source)
  })

  test('never throws on junk input', () => {
    expect(parseNarration('').plain).toBe('')
    expect(parseNarration('').words).toEqual([])
    expect(parseNarration('').sentences).toEqual([])
    expect(parseNarration(undefined as unknown as string).plain).toBe('')
    expect(parseNarration(null as unknown as string).plain).toBe('')
    expect(parseNarration(42 as unknown as string).plain).toBe('42')
    expect(parseNarration('   \n\t ').plain).toBe('')
    expect(() => parseNarration('[[[]]]((())) ][ )( [](')).not.toThrow()
  })
})

describe('parseNarration - words and sentences', () => {
  test('words are whitespace tokens with offsets into plain', () => {
    const parsed = parseNarration('The [piston](piston), then the valve.')
    expect(parsed.words.map((word) => word.text)).toEqual(['The', 'piston,', 'then', 'the', 'valve.'])
    for (const word of parsed.words) expect(parsed.plain.slice(word.start, word.end)).toBe(word.text)
    expect(parsed.words.map((word) => word.span)).toEqual([-1, 0, -1, -1, -1])
  })

  test('sentences end at . ! ? followed by a space, not inside a number', () => {
    const parsed = parseNarration('It needs 3.5 volts. Really? "Yes!" And more')
    expect(parsed.sentences.map((sentence) => sentence.text)).toEqual(['It needs 3.5 volts.', 'Really?', '"Yes!"', 'And more'])
    expect(parsed.sentences.map((sentence) => sentence.wordCount)).toEqual([4, 1, 1, 2])
    expect(parsed.sentences.map((sentence) => sentence.firstWord)).toEqual([0, 4, 5, 6])
    for (const sentence of parsed.sentences) expect(parsed.plain.slice(sentence.start, sentence.end)).toBe(sentence.text)
    expect(parsed.words.map((word) => word.sentence)).toEqual([0, 0, 0, 0, 1, 2, 3, 3])
  })

  test('a span knows its words and its sentence', () => {
    const parsed = parseNarration('First one. Then the [intake valve](ring:v) opens. [Last](x)')
    const ring = parsed.spans[0]!
    expect(ring.firstWord).toBe(4)
    expect(ring.wordCount).toBe(2)
    expect(ring.sentence).toBe(1)
    expect(parsed.words[4]!.span).toBe(0)
    expect(parsed.words[5]!.span).toBe(0)
    expect(parsed.spans[1]!.sentence).toBe(2)
    expect(parsed.spans[1]!.firstWord).toBe(parsed.words.length - 1)
  })

  test('an empty span fires at the next word, or at the end of the text', () => {
    const middle = parseNarration('Look at the valves. [](focus:plug)Now watch.')
    expect(middle.spans[0]!.wordCount).toBe(0)
    expect(middle.words[middle.spans[0]!.firstWord]!.text).toBe('Now')
    expect(middle.spans[0]!.sentence).toBe(1)
    expect(middle.words.every((word) => word.span === -1)).toBe(true)

    const end = parseNarration('Watch this. [](focus:plug)')
    expect(end.plain).toBe('Watch this.')
    expect(end.spans[0]!.start).toBe(end.plain.length)
    expect(end.spans[0]!.firstWord).toBe(end.words.length)
    expect(end.spans[0]!.sentence).toBe(0)

    const spaced = parseNarration('a [](focus:x) b')
    expect(spaced.plain).toBe('a b')
    expect(spaced.words[spaced.spans[0]!.firstWord]!.text).toBe('b')
  })

  test('padding inside the brackets is trimmed from the span', () => {
    const parsed = parseNarration('the [  piston  ](piston) moves')
    expect(parsed.plain).toBe('the piston moves')
    expect(parsed.spans[0]!.words).toBe('piston')
    expect(parsed.spans[0]!.wordCount).toBe(1)

    const glued = parseNarration('the[ piston ](piston)moves')
    expect(glued.plain).toBe('the piston moves')
    expect(glued.spans[0]!.words).toBe('piston')
    expect(glued.spans[0]!.start).toBe(4)
    expect(glued.spans[0]!.end).toBe(10)
  })

  test('parsing is deterministic', () => {
    const text = 'The [piston](piston) slides, and [air](arrow:a->b) rushes in. [](focus:x)Done!'
    expect(JSON.stringify(parseNarration(text))).toBe(JSON.stringify(parseNarration(text)))
  })
})
