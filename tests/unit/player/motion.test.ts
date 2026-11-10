// The motion primitives (UI design specification 8.1): every animation is a pure function of progress.
import { describe, expect, test } from 'bun:test'
import { bezier, clamp, clock, D, enter, exit, lagged, lerp, move, smooth, span, spring, sspan } from '../../../src/player/motion.ts'
import { cutCue } from '../../../src/player/caption.ts'
import { playGlyph } from '../../../src/player/dom.ts'

describe('easing', () => {
  test('every curve starts at 0, ends at 1 and stays inside', () => {
    for (const f of [smooth, enter, exit, move]) {
      expect(f(0)).toBeCloseTo(0, 6)
      expect(f(1)).toBeCloseTo(1, 6)
      expect(f(-3)).toBeCloseTo(0, 6)
      expect(f(7)).toBeCloseTo(1, 6)
      for (let i = 1; i < 20; i++) { const y = f(i / 20); expect(y).toBeGreaterThanOrEqual(-1e-9); expect(y).toBeLessThanOrEqual(1 + 1e-9) }
    }
  })
  test('smooth is manim\'s: symmetric, flat at both ends', () => {
    expect(smooth(0.5)).toBeCloseTo(0.5, 10)
    expect(smooth(0.25) + smooth(0.75)).toBeCloseTo(1, 10)
    expect(smooth(0.001)).toBeLessThan(1e-7)
  })
  test('a bezier is the CSS curve of the same numbers', () => {
    const ease = bezier(0.25, 0.1, 0.25, 1) // CSS `ease`
    expect(ease(0.5)).toBeCloseTo(0.8024, 3)
    expect(bezier(0, 0, 1, 1)(0.37)).toBeCloseTo(0.37, 4)
    expect(move(0.5)).toBeGreaterThan(0.8) // decelerates: most of the way by half time
    expect(exit(0.5)).toBeLessThan(0.2) // accelerates
  })
  test('the same progress gives the same value: nothing remembers', () => {
    const a = [0.9, 0.1, 0.5].map((p) => move(p)), b = [0.5, 0.9, 0.1].map((p) => move(p))
    expect(a[0]).toBe(b[1])
    expect(a[1]).toBe(b[2])
    expect(a[2]).toBe(b[0])
  })
  test('span and lag choreograph inside one progress value', () => {
    expect(span(0.5, 0.2, 0.6)).toBeCloseTo(0.75)
    expect(span(0.1, 0.2, 0.6)).toBe(0)
    expect(sspan(0.4, 0.2, 0.6)).toBeCloseTo(0.5)
    ;[0.6, 0.5, 0.4].forEach((want, i) => expect(lagged(0.5, i, 3, 0.1)).toBeCloseTo(clamp(want), 10))
    expect(lagged(1, 2, 3, 0.1)).toBe(1)
    expect(lagged(0, 0, 3, 0.1)).toBe(0)
    expect(lerp(10, 20, 0.25)).toBe(12.5)
  })
  test('a turned channel slows, stops and comes back: the spring starts with the speed it had and never overshoots', () => {
    const w = (2 * Math.PI) / 0.45
    expect(spring(0, 0.6, -2, 1, w, 1)).toBeCloseTo(0.6, 10)
    const dt = 1e-4
    expect((spring(dt, 0.6, -2, 1, w, 1) - 0.6) / dt).toBeCloseTo(-2, 1)
    let low = 1, high = 0
    for (let t = 0; t < 1; t += 0.005) { const x = spring(t, 0.6, -2, 1, w, 1); low = Math.min(low, x); high = Math.max(high, x) }
    expect(low).toBeGreaterThan(0.5)
    expect(high).toBeLessThanOrEqual(1 + 1e-9)
    expect(spring(1, 0.6, -2, 1, w, 1)).toBeCloseTo(1, 3)
  })
  test('the durations are the spec\'s', () => {
    expect([D.wake, D.sleep, D.idle, D.read, D.readBack, D.explore, D.exploreBack, D.note, D.noteClose, D.swap, D.palette, D.paletteClose, D.share, D.error, D.play, D.dot, D.now, D.reset, D.warp, D.held, D.dissolve])
      .toEqual([150, 400, 2200, 640, 420, 420, 300, 380, 180, 220, 180, 110, 200, 220, 160, 160, 320, 250, 440, 180, 160])
  })
  test('minutes are never zero-padded', () => {
    expect([clock(0), clock(53.9), clock(89), clock(600), clock(-4)]).toEqual(['0:00', '0:53', '1:29', '10:00', '0:00'])
  })
})

describe('the play glyph', () => {
  test('two halves of a triangle become two bars, eight points each way', () => {
    const [a0, b0] = playGlyph(0), [a1, b1] = playGlyph(1), [am] = playGlyph(0.5)
    expect(a0).toBe('M4.00 2.50L8.90 5.30L8.90 10.70L4.00 13.50Z')
    expect(b0).toBe('M8.90 5.30L13.60 8.00L13.60 8.00L8.90 10.70Z')
    expect(a1).toBe('M3.60 2.60L6.60 2.60L6.60 13.40L3.60 13.40Z')
    expect(b1).toBe('M9.40 2.60L12.40 2.60L12.40 13.40L9.40 13.40Z')
    expect(am).toBe('M3.80 2.55L7.75 3.95L7.75 12.05L3.80 13.45Z')
  })
})

describe('captions under a small stage', () => {
  const words = (s: string, cue: (w: string, i: number) => number = () => -1) => s.split(' ').map((text, i) => ({ text, t0: i, t1: i + 1, cue: cue(text, i) }))
  const text = (c: { text: string }[][]) => c.map((ws) => ws.map((w) => w.text).join(' '))
  test('a sentence that fits is one cue', () => {
    expect(text(cutCue(words('Turning becomes sliding.'), 60))).toEqual(['Turning becomes sliding.'])
  })
  test('one that does not is cut at its pauses until every cue fits', () => {
    const cues = cutCue(words('A wheel, a rod and a slider: turning becomes sliding, and that is all there is to it.'), 40)
    expect(text(cues)).toEqual(['A wheel, a rod and a slider:', 'turning becomes sliding,', 'and that is all there is to it.'])
    for (const c of text(cues)) expect(c.length).toBeLessThanOrEqual(40)
  })
  test('the words of one name are never parted while there is another place to cut', () => {
    const cues = cutCue(words('The crank pin rides on the wheel off its centre', (_w, i) => (i === 1 || i === 2 ? 0 : -1)), 30)
    expect(text(cues).some((c) => /crank$/.test(c))).toBe(false)
  })
  test('a single word longer than the zone is a cue of its own: it is the only thing that may wrap', () => {
    expect(text(cutCue(words('Pneumonoultramicroscopicsilicovolcanoconiosis'), 10))).toEqual(['Pneumonoultramicroscopicsilicovolcanoconiosis'])
  })
})
