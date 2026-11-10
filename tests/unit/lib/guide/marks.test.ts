import { describe, expect, test } from 'bun:test'
import { MARK_FADE, activeMarks, estimateTiming, guidePose, markProgress, parseNarration, scheduleCues, smoothstep } from '../../../../src/lib/guide/index.ts'
import type { CueSchedule } from '../../../../src/lib/guide/index.ts'

function compile(text: string, extraStep = 1): CueSchedule {
  const parsed = parseNarration(text)
  const timing = estimateTiming(parsed)
  return scheduleCues(parsed, timing, { stepDuration: timing.duration + extraStep })
}

describe('markProgress', () => {
  const schedule = compile('Some words and then the [valve](ring:valve) opens, and it [glows](glow:valve) for a while longer than that.')
  const ring = schedule.cues[0]!
  const glow = schedule.cues[1]!

  test('nothing before the pointer lands', () => {
    expect(markProgress(ring, ring.landAt - 0.001)).toEqual({ progress: 0, opacity: 0, visible: false })
    expect(markProgress(ring, ring.fireAt)).toEqual({ progress: 0, opacity: 0, visible: false })
    expect(markProgress(ring, -1)).toEqual({ progress: 0, opacity: 0, visible: false })
    expect(markProgress(ring, NaN)).toEqual({ progress: 0, opacity: 0, visible: false })
  })

  test('draws on from landAt to drawEnd with smoothstep, then stays drawn', () => {
    expect(markProgress(ring, ring.landAt)).toEqual({ progress: 0, opacity: 1, visible: true })
    const length = ring.drawEnd - ring.landAt
    expect(length).toBeCloseTo(0.45, 12)
    let previous = 0
    for (let k = 1; k <= 20; k++) {
      const state = markProgress(ring, ring.landAt + (length * k) / 20)
      expect(state.progress).toBeCloseTo(smoothstep(k / 20), 9)
      expect(state.progress).toBeGreaterThanOrEqual(previous)
      expect(state.opacity).toBe(1)
      previous = state.progress
    }
    expect(markProgress(ring, ring.drawEnd).progress).toBe(1)
    expect(markProgress(ring, ring.drawEnd + 2).progress).toBe(1)
  })

  test('fades out over the last 0.3 s and is gone exactly at markEnd', () => {
    expect(MARK_FADE).toBe(0.3)
    expect(ring.markEnd).toBe(schedule.duration)
    expect(markProgress(ring, ring.markEnd - 0.31).opacity).toBe(1)
    const half = markProgress(ring, ring.markEnd - 0.15)
    expect(half.opacity).toBeCloseTo(0.5, 9)
    expect(half.visible).toBe(true)
    let previous = 1
    for (let k = 0; k <= 30; k++) {
      const opacity = markProgress(ring, ring.markEnd - 0.3 + k * 0.01).opacity
      expect(opacity).toBeLessThanOrEqual(previous + 1e-12)
      previous = opacity
    }
    expect(markProgress(ring, ring.markEnd)).toEqual({ progress: 1, opacity: 0, visible: false })
    expect(markProgress(ring, ring.markEnd + 10)).toEqual({ progress: 1, opacity: 0, visible: false })
  })

  test('the fade length is a parameter; zero means a hard cut', () => {
    expect(markProgress(ring, ring.markEnd - 0.5, 1).opacity).toBeCloseTo(0.5, 9)
    expect(markProgress(ring, ring.markEnd - 0.001, 0).opacity).toBe(1)
    expect(markProgress(ring, ring.markEnd, 0).visible).toBe(false)
  })

  test('a glow fades in, expires on its own, and is gone long before the step ends', () => {
    expect(glow.markEnd).toBeLessThan(schedule.duration)
    expect(markProgress(glow, glow.landAt + 0.225).progress).toBeCloseTo(0.5, 9)
    expect(markProgress(glow, glow.markEnd - 0.01).visible).toBe(true)
    expect(markProgress(glow, glow.markEnd).visible).toBe(false)
  })

  test('hold keeps a mark fully visible past the step', () => {
    const held = compile('Some words and then the [valve](ring:valve,hold) opens.').cues[0]!
    expect(held.hold).toBe(true)
    expect(markProgress(held, held.markEnd + 100)).toEqual({ progress: 1, opacity: 1, visible: true })
    expect(markProgress(held, held.landAt - 0.1).visible).toBe(false)
  })

  test('a point has nothing to draw: complete on landing, gone when the pointer leaves', () => {
    const point = compile('Some words and then the [piston](piston) moves and the [valve](valve) opens.').cues[0]!
    expect(markProgress(point, point.landAt)).toEqual({ progress: 1, opacity: 1, visible: true })
    expect(markProgress(point, point.markEnd).visible).toBe(false)
  })

  test('a mark shorter than the fade never exceeds its own life', () => {
    const brief = { ...ring, landAt: 1, drawEnd: 1, markEnd: 1.1 }
    expect(markProgress(brief, 1)).toEqual({ progress: 1, opacity: 1, visible: true })
    expect(markProgress(brief, 1.05).opacity).toBeCloseTo(0.5, 9)
    expect(markProgress(brief, 1.1).visible).toBe(false)
  })

  test('an arrow stroke and the pointer drawing it share one progress value', () => {
    const cues = compile('Now some words and then the [air](arrow:port->cylinder) rushes in.').cues
    const arrow = cues[0]!
    for (const u of [0.1, 0.35, 0.5, 0.8]) {
      const t = arrow.landAt + u * (arrow.drawEnd - arrow.landAt)
      const pose = guidePose(cues, t, (id) => (id === 'port' ? [0, 0] : [100, 0]), [0, 500])
      expect(pose.progress).toBe(markProgress(arrow, t).progress)
      expect(pose.x).toBeCloseTo(100 * markProgress(arrow, t).progress, 9)
    }
  })

  test('pure: same cue and time, same state', () => {
    for (const t of [0, ring.landAt + 0.1, ring.markEnd - 0.1, 99]) expect(markProgress(ring, t)).toEqual(markProgress(ring, t))
  })
})

describe('activeMarks', () => {
  const schedule = compile('First the [piston](piston) moves, and then the [valve](ring:valve) opens, and it [glows](glow:valve) a bit. Then nothing else happens for quite a long while, really.')
  const [point, ring, glow] = schedule.cues

  test('lists exactly the visible marks, in cue order, with their state', () => {
    expect(activeMarks(schedule.cues, 0)).toEqual([])
    const early = activeMarks(schedule.cues, point!.landAt + 0.05)
    expect(early.map((mark) => mark.index)).toEqual([0])
    expect(early[0]!.cue).toBe(point!)

    const t = glow!.landAt + 0.2
    const marks = activeMarks(schedule.cues, t)
    expect(marks.map((mark) => mark.cue.verb)).toEqual(['ring', 'glow'])
    for (const mark of marks) {
      expect(mark).toEqual({ index: mark.index, cue: schedule.cues[mark.index]!, ...markProgress(mark.cue, t) })
      expect(mark.visible).toBe(true)
    }
  })

  test('marks belong to their step: nothing is left at the end, and nothing after it', () => {
    expect(activeMarks(schedule.cues, glow!.markEnd + 0.01).map((mark) => mark.cue.verb)).toEqual(['ring'])
    expect(activeMarks(schedule.cues, schedule.duration)).toEqual([])
    expect(activeMarks(schedule.cues, schedule.duration + 5)).toEqual([])
    expect(ring!.markEnd).toBe(schedule.duration)
  })

  test('pure and order-independent', () => {
    const times = [0.3, 2.2, 4.4, 1.1, 9.9, 2.2, 0.3]
    const first = times.map((t) => JSON.stringify(activeMarks(schedule.cues, t)))
    const second = times
      .slice()
      .reverse()
      .map((t) => JSON.stringify(activeMarks(schedule.cues, t)))
      .reverse()
    expect(second).toEqual(first)
    expect(first[1]).toBe(first[5]!)
  })
})
