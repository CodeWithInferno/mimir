import { describe, expect, test } from 'bun:test'
import { basisOf, fitPose, lerpPose, projectWith, VIEWS, mix, ramp, parseColor, toHex, isColor, PALETTE, MATERIALS, type Pose, type Vec3 } from '../../../src/core/index.ts'
import { near } from './helpers.ts'

describe('camera maths', () => {
  const pose = (azimuth: number, elevation: number, distance = 10): Pose => ({ target: [0, 0, 0], azimuth, elevation, distance, fov: 30 })
  test('named views: front looks from +z, side from +x, top straight down', () => {
    expect(near(basisOf(pose(0, 0)).eye, [0, 0, 10])).toBe(true)
    expect(near(basisOf(pose(90, 0)).eye, [10, 0, 0], 1e-9)).toBe(true)
    const top = basisOf(pose(0, 90))
    expect(near(top.eye, [0, 10, 0], 1e-9)).toBe(true)
    expect(near(top.up, [0, 0, -1], 1e-9)).toBe(true) // well defined at the pole
    expect(Object.keys(VIEWS)).toEqual(expect.arrayContaining(['iso', 'front', 'side', 'top']))
  })
  test('projection: x right, y up, depth in front of the eye', () => {
    const b = basisOf(pose(0, 0))
    expect(projectWith(b, 30, 16 / 9, [0, 0, 0])).toEqual({ x: 0, y: 0, depth: 10 })
    const p = projectWith(b, 30, 1, [1, 2, 0])
    expect(p.x).toBeCloseTo(1 / (10 * Math.tan(Math.PI / 12)), 12)
    expect(p.y).toBeCloseTo(2 / (10 * Math.tan(Math.PI / 12)), 12)
    expect(projectWith(b, 30, 1, [0, 0, 20]).depth).toBe(-10)
  })
  test('fitPose frames the points inside the panel and uses most of it', () => {
    const pts: Vec3[] = []
    for (const x of [-3, 3]) for (const y of [0, 8]) for (const z of [-1, 1]) pts.push([x, y, z])
    for (const [az, el, aspect] of [[35, 24, 16 / 9], [0, 0, 16 / 9], [90, 10, 0.8], [0, 90, 1.5]] as const) {
      const fit = fitPose(pts, az, el, 30, aspect)
      const b = basisOf(fit)
      let mx = 0
      for (const p of pts) { const q = projectWith(b, 30, aspect, p); expect(q.depth).toBeGreaterThan(0); mx = Math.max(mx, Math.abs(q.x), Math.abs(q.y)) }
      expect(mx).toBeLessThanOrEqual(0.9)
      expect(mx).toBeGreaterThan(0.6)
    }
  })
  test('lerpPose takes the short way round and blends distance geometrically', () => {
    const a = pose(350, 0, 10), b = pose(10, 20, 40)
    const mid = lerpPose(a, b, 0.5)
    expect(mid.azimuth).toBe(360)
    expect(mid.elevation).toBe(10)
    expect(mid.distance).toBeCloseTo(20, 12)
  })
})

describe('colour', () => {
  test('palette tokens are the ManimGL values', () => {
    expect(PALETTE).toMatchObject({ BLUE: '#58C4DD', TEAL: '#5CD0B3', GREEN: '#83C167', YELLOW: '#FFFF00', GOLD: '#F0AC5F', RED: '#FC6255', MAROON: '#C55F73', PURPLE: '#9A72AC', GREY_A: '#DDDDDD', GREY_B: '#BBBBBB', GREY_C: '#888888', GREY_D: '#444444', GREY_E: '#222222', WHITE: '#FFFFFF', BLACK: '#000000' })
    expect(PALETTE.BLUE_C).toBe(PALETTE.BLUE)
    expect(PALETTE.BLUE_E).toBe('#1C758A')
  })
  test('parsing: hex forms, rgb(), tokens, plain names; garbage is not a colour', () => {
    expect(parseColor('#fff')).toEqual([1, 1, 1, 1])
    expect(parseColor('#00000080')![3]).toBeCloseTo(0.502, 3)
    expect(parseColor('rgb(255, 0, 0)')).toEqual([1, 0, 0, 1])
    expect(parseColor('BLUE')).toEqual(parseColor('#58C4DD'))
    expect(parseColor('red')).toEqual(parseColor(PALETTE.RED))
    expect(isColor('bleu')).toBe(false)
    expect(isColor(3)).toBe(false)
  })
  test('mix blends in squared RGB; ramp is piecewise', () => {
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe(toHex([Math.SQRT1_2, Math.SQRT1_2, Math.SQRT1_2, 1]))
    expect(mix(PALETTE.BLUE, PALETTE.RED, 0).toUpperCase()).toBe(PALETTE.BLUE)
    expect(mix(PALETTE.BLUE, PALETTE.RED, 1).toUpperCase()).toBe(PALETTE.RED)
    const heat = ramp(['#000000', '#FF0000', '#FFFFFF'])
    expect(heat(0)).toBe('#000000')
    expect(heat(0.5)).toBe('#ff0000')
    expect(heat(1)).toBe('#ffffff')
    expect(heat(7)).toBe('#ffffff')
  })
  test('material presets exist for every name in the design', () => {
    for (const name of ['steel', 'aluminium', 'iron', 'brass', 'copper', 'rubber', 'plastic', 'glass', 'ghost', 'glow', 'matte']) expect(MATERIALS[name]).toBeDefined()
    expect(MATERIALS.glass!.shell).toBe(true)
  })
})
