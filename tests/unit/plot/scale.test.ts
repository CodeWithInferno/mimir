// Scales, ticks, number formatting and polyline clipping: the pure maths under every plot.
import { describe, expect, test } from 'bun:test'
import { clipPolyline, decimalsFor, formatNumber, formatTick, linearTicks, logTicks, makeScale, MINUS, niceStep, polylineLength, THIN_SPACE, trimPolyline, withUnit } from '../../../src/plot/scale.ts'

describe('scales', () => {
  test('linear maps the range onto 0..1 and back', () => {
    const s = makeScale([10, 30])
    expect(s.at(10)).toBe(0)
    expect(s.at(30)).toBe(1)
    expect(s.at(20)).toBeCloseTo(0.5, 12)
    expect(s.inv(0.25)).toBeCloseTo(15, 12)
  })
  test('log maps decades evenly, and cannot place zero or a negative value', () => {
    const s = makeScale([0.01, 100], true)
    expect(s.log).toBe(true)
    expect(s.at(1)).toBeCloseTo(0.5, 12)
    expect(s.inv(0.75)).toBeCloseTo(10, 9)
    expect(Number.isNaN(s.at(0))).toBe(true)
    expect(Number.isNaN(s.at(-3))).toBe(true)
  })
  test('a range that cannot be used is repaired instead of producing NaN', () => {
    expect(makeScale([5, 5]).max).toBe(6) // empty
    expect(makeScale([8, 2]).min).toBe(2) // reversed
    expect(makeScale(undefined).max).toBe(1)
    expect(makeScale([NaN, Infinity]).at(0.5)).toBeCloseTo(0.5, 12)
    expect(makeScale([-1, 10], true).log).toBe(false) // a log axis needs a positive start: linear instead
  })
})

describe('ticks', () => {
  test('steps are 1, 2 or 5 times a power of ten', () => {
    expect(niceStep(10, 5)).toBe(2)
    expect(niceStep(1, 4)).toBeCloseTo(0.5, 12)
    expect(niceStep(7, 3)).toBe(5)
    expect(niceStep(0.03, 3)).toBeCloseTo(0.01, 12)
    expect(niceStep(1200, 6)).toBe(200)
  })
  test('an axis of degrees steps in quarter and half turns', () => {
    expect(niceStep(720, 4, true)).toBe(180)
    expect(niceStep(720, 8, true)).toBe(90)
    expect(niceStep(360, 8, true)).toBe(45)
    expect(niceStep(720, 5)).toBe(200) // the same axis without the unit
    expect(niceStep(7200, 4, true)).toBe(1800)
  })
  test('ticks are exact multiples inside the range, ends included', () => {
    expect(linearTicks(0, 1, 0.2)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1])
    expect(linearTicks(-1.5, 1.5, 1)).toEqual([-1, 0, 1])
    expect(linearTicks(0.05, 0.95, 0.1).length).toBe(9)
    expect(linearTicks(0, 720, 180)).toEqual([0, 180, 360, 540, 720])
    expect(linearTicks(0, 1, 0)).toEqual([]) // never an endless loop
    expect(linearTicks(0, 1e9, 1).length).toBe(200) // nor an endless list
  })
  test('a log axis gets the powers of ten, and 1-2-5 within one decade', () => {
    expect(logTicks(0.01, 100)).toEqual([0.01, 0.1, 1, 10, 100])
    expect(logTicks(1, 9)).toEqual([1, 2, 5])
    expect(logTicks(0, 10)).toEqual([])
  })
  test('decimals follow the step', () => {
    expect(decimalsFor(5)).toBe(0)
    expect(decimalsFor(0.5)).toBe(1)
    expect(decimalsFor(0.25)).toBe(2)
    expect(decimalsFor(0.1 + 0.2)).toBe(1) // 0.30000000000000004
  })
})

describe('numbers as text', () => {
  test('fixed decimals, a real minus sign, never minus zero', () => {
    expect(formatNumber(3.14159, 2)).toBe('3.14')
    expect(formatNumber(-2, 1)).toBe(MINUS + '2.0')
    expect(formatNumber(-0.001, 2)).toBe('0.00')
    expect(formatNumber(NaN, 2)).toBe('–')
    expect(formatNumber(Infinity)).toBe('∞')
  })
  test('ticks are written as short as they can be', () => {
    expect(formatTick(0.5)).toBe('0.5')
    expect(formatTick(180)).toBe('180')
    expect(formatTick(-0.25)).toBe(MINUS + '0.25')
    expect(formatTick(1e6)).toBe('1e6')
    expect(formatTick(0.00001)).toBe('1e' + MINUS + '5')
  })
  test('a unit follows after a thin space, except degree and percent signs', () => {
    expect(withUnit('381', '°')).toBe('381°')
    expect(withUnit('92', '%')).toBe('92%')
    expect(withUnit('1.5', 'V')).toBe('1.5' + THIN_SPACE + 'V')
    expect(withUnit('7', '')).toBe('7')
  })
})

describe('polylines', () => {
  const box = { x0: 0, x1: 10, y0: 0, y1: 10 }
  test('a line that leaves the rectangle is cut on its edge and comes back as a second piece', () => {
    const pieces = clipPolyline([1, 5, 5, 15, 9, 5], box)
    expect(pieces.length).toBe(2)
    expect(pieces[0]).toEqual([1, 5, 3, 10])
    expect(pieces[1]).toEqual([7, 10, 9, 5])
  })
  test('what is inside stays one piece; what is outside disappears', () => {
    expect(clipPolyline([1, 1, 2, 2, 3, 1], box)).toEqual([[1, 1, 2, 2, 3, 1]])
    expect(clipPolyline([-5, -5, -1, -1], box)).toEqual([])
    expect(clipPolyline([-5, 20, 20, 20], box)).toEqual([])
  })
  test('a value that is not finite ends a piece', () => {
    const pieces = clipPolyline([1, 1, 2, 2, 3, NaN, 4, 4, 5, 5], box)
    expect(pieces).toEqual([[1, 1, 2, 2], [4, 4, 5, 5]])
  })
  test('an unbounded side clips nothing (cutting by x only)', () => {
    expect(clipPolyline([0, -1e9, 10, 1e9], { x0: 2.5, x1: 7.5, y0: -Infinity, y1: Infinity })).toEqual([[2.5, -5e8, 7.5, 5e8]])
  })
  test('trimming keeps the first part of the length', () => {
    const pts = [0, 0, 3, 4, 3, 10]
    expect(polylineLength(pts)).toBe(11)
    expect(trimPolyline(pts, 5)).toEqual([0, 0, 3, 4])
    expect(trimPolyline(pts, 8)).toEqual([0, 0, 3, 4, 3, 7])
    expect(trimPolyline(pts, 100)).toEqual(pts)
    expect(trimPolyline(pts, 0)).toEqual([])
  })
})
