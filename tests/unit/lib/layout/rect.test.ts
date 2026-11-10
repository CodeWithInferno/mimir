import { describe, expect, test } from 'bun:test'
import {
  rectArea, rectCenter, rectContains, rectDistance, rectFromCenter, rectFromPoints, rectInset, rectIntersection,
  rectIntersects, rectUnion, segmentIntersectsRect, segmentsCross,
} from '../../../../src/lib/layout/index.ts'

const a = { x: 0, y: 0, width: 4, height: 2 }

describe('rect helpers', () => {
  test('rectFromCenter and rectCenter are inverses', () => {
    const r = rectFromCenter(1, -2, 6, 4)
    expect(r).toEqual({ x: -2, y: -4, width: 6, height: 4 })
    expect(rectCenter(r)).toEqual([1, -2])
    expect(rectArea(r)).toBe(24)
  })

  test('rectFromPoints bounds every point', () => {
    expect(rectFromPoints([[1, 5], [-2, 3], [0, 9]])).toEqual({ x: -2, y: 3, width: 3, height: 6 })
    expect(rectFromPoints([])).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })

  test('rectIntersects: overlap yes, touching no, margin both ways', () => {
    expect(rectIntersects(a, { x: 3, y: 1, width: 4, height: 4 })).toBe(true)
    expect(rectIntersects(a, { x: 4, y: 0, width: 1, height: 1 })).toBe(false)       // shares an edge
    expect(rectIntersects(a, { x: 5, y: 0, width: 1, height: 1 })).toBe(false)
    expect(rectIntersects(a, { x: 4.2, y: 0, width: 1, height: 1 }, -0.5)).toBe(true) // closer than 0.5
    expect(rectIntersects(a, { x: 3.9, y: 0, width: 1, height: 1 }, 0.2)).toBe(false) // overlap under 0.2 ignored
    expect(rectIntersects(a, a)).toBe(true)
  })

  test('rectIntersection returns the shared region or null', () => {
    expect(rectIntersection(a, { x: 3, y: 1, width: 4, height: 4 })).toEqual({ x: 3, y: 1, width: 1, height: 1 })
    expect(rectIntersection(a, { x: 4, y: 0, width: 1, height: 1 })).toBeNull()
    expect(rectIntersection(a, { x: 10, y: 10, width: 1, height: 1 })).toBeNull()
  })

  test('rectUnion holds all inputs', () => {
    expect(rectUnion(a, { x: -1, y: 1, width: 1, height: 5 })).toEqual({ x: -1, y: 0, width: 5, height: 6 })
    expect(rectUnion(a)).toEqual(a)
    expect(rectUnion()).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })

  test('rectInset shrinks, grows with negatives, keeps the centre and never goes negative', () => {
    expect(rectInset(a, 0.5)).toEqual({ x: 0.5, y: 0.5, width: 3, height: 1 })
    expect(rectInset(a, -1, 0)).toEqual({ x: -1, y: 0, width: 6, height: 2 })
    const collapsed = rectInset(a, 5)
    expect(collapsed.width).toBe(0)
    expect(collapsed.height).toBe(0)
    expect(rectCenter(collapsed)).toEqual(rectCenter(a))
  })

  test('rectContains for rects and points', () => {
    expect(rectContains(a, { x: 1, y: 0, width: 3, height: 2 })).toBe(true)
    expect(rectContains(a, { x: 1, y: 0, width: 3.01, height: 2 })).toBe(false)
    expect(rectContains(a, { x: 1, y: 0, width: 3.01, height: 2 }, 0.02)).toBe(true)
    expect(rectContains(a, [4, 2])).toBe(true)
    expect(rectContains(a, [4.1, 2])).toBe(false)
  })

  test('rectDistance between rects and to points', () => {
    expect(rectDistance(a, { x: 7, y: 6, width: 1, height: 1 })).toBeCloseTo(5, 12)     // 3-4-5 corner to corner
    expect(rectDistance(a, { x: 6, y: 1, width: 1, height: 1 })).toBe(2)
    expect(rectDistance(a, { x: 1, y: 1, width: 9, height: 9 })).toBe(0)
    expect(rectDistance(a, [2, 5])).toBe(3)
    expect(rectDistance(a, [1, 1])).toBe(0)
    expect(rectDistance(a, [-3, -4])).toBeCloseTo(5, 12)
  })

  test('segment tests', () => {
    expect(segmentIntersectsRect([-1, 1], [5, 1], a)).toBe(true)        // straight through
    expect(segmentIntersectsRect([-1, 3], [5, 3], a)).toBe(false)       // passes above
    expect(segmentIntersectsRect([1, 0.5], [2, 1], a)).toBe(true)       // fully inside
    expect(segmentIntersectsRect([-2, -1], [-1, 5], a)).toBe(false)
    expect(segmentIntersectsRect([5, -1], [3, 3], a)).toBe(true)        // clips the corner region
    expect(segmentsCross([0, 0], [2, 2], [0, 2], [2, 0])).toBe(true)
    expect(segmentsCross([0, 0], [2, 2], [2, 2], [4, 0])).toBe(false)   // shared endpoint
    expect(segmentsCross([0, 0], [1, 1], [2, 0], [3, 1])).toBe(false)
    expect(segmentsCross([0, 0], [4, 0], [1, 0], [2, 0])).toBe(false)   // collinear
  })
})
