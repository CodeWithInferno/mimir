import { describe, expect, test } from 'bun:test'
import {
  DOCK,
  REST_ANGLE_DEG,
  estimateTiming,
  flightDuration,
  flightPose,
  guidePose,
  landingPoint,
  parseNarration,
  scheduleCues,
  smoothstep,
} from '../../../../src/lib/guide/index.ts'
import type { AnchorAt, GuideCue, GuidePose } from '../../../../src/lib/guide/index.ts'
import type { Vec2 } from '../../../../src/lib/types.ts'

const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps
/** Smallest rotation between two angles, in degrees. */
const turn = (a: number, b: number): number => Math.abs(((((a - b) % 360) + 540) % 360) - 180)

function cuesFor(text: string): GuideCue[] {
  const parsed = parseNarration(text)
  return scheduleCues(parsed, estimateTiming(parsed)).cues
}

const DOCK_POINT: Vec2 = [640, 680]
const STILL: Record<string, Vec2> = { piston: [400, 400], valve: [900, 150], port: [200, 120], cylinder: [420, 300] }
const still: AnchorAt = (id) => STILL[id] ?? null

describe('flight - probe assertions (guide_flight.mjs)', () => {
  test('distance-based duration clamps to 0.6 .. 1.4 s at 800 px/s', () => {
    expect(near(flightDuration(10), 0.6)).toBe(true)
    expect(near(flightDuration(480), 0.6)).toBe(true)
    expect(near(flightDuration(800), 1.0)).toBe(true)
    expect(near(flightDuration(1120), 1.4)).toBe(true)
    expect(near(flightDuration(5000), 1.4)).toBe(true)
  })

  const start: Vec2 = [100, 600]
  const end: Vec2 = [900, 200]

  test('progress 0 is the start point, progress 1 is the end point at rest rotation and scale', () => {
    const p0 = flightPose(start, end, 0)
    expect(near(p0.x, start[0]) && near(p0.y, start[1])).toBe(true)
    const pEnd = flightPose(start, end, 1)
    expect(near(pEnd.x, end[0]) && near(pEnd.y, end[1])).toBe(true)
    expect(near(pEnd.angleDeg, -35) && near(pEnd.scale, 1)).toBe(true)
    expect(REST_ANGLE_DEG).toBe(-35)
  })

  test('scale peaks at 1.3 at the midpoint', () => {
    expect(near(flightPose(start, end, 0.5).scale, 1.3, 1e-12)).toBe(true)
  })

  test('the apex is half the control-point lift above the chord midpoint', () => {
    const mid = flightPose(start, end, 0.5)
    const distance = Math.hypot(end[0] - start[0], end[1] - start[1])
    const arc = Math.min(distance * 0.2, 80)
    expect(arc).toBe(80)
    expect(near(mid.y, (start[1] + end[1]) / 2 - arc / 2, 1e-9)).toBe(true)
    expect(near(mid.x, (start[0] + end[0]) / 2, 1e-9)).toBe(true)
    // a short hop lifts 20% of its length
    const short = flightPose([0, 0], [100, 0], 0.5)
    expect(near(short.y, -10, 1e-9)).toBe(true)
  })

  test('pure function of progress', () => {
    const a = flightPose(start, end, 0.37)
    const b = flightPose(start, end, 0.37)
    expect(a).toEqual(b)
  })

  test('landing point is offset then clamped 20 px inside the viewport', () => {
    expect(landingPoint([1275, 5], { width: 1280, height: 800 })).toEqual([1260, 20])
    expect(landingPoint([100, 100], { width: 1280, height: 800 })).toEqual([108, 112])
    expect(landingPoint([100, 100], { width: 1280, height: 800 }, [0, 0], 0)).toEqual([100, 100])
  })
})

describe('flightPose - shape', () => {
  test('smoothstep easing: position at linear progress s is the bezier at 3s^2 - 2s^3', () => {
    const start: Vec2 = [0, 0]
    const end: Vec2 = [400, 0]
    for (const s of [0.1, 0.25, 0.4, 0.6, 0.9]) {
      const e = smoothstep(s)
      const pose = flightPose(start, end, s)
      // control point is (200, -80): lift = min(0.2 * 400, 80)
      expect(pose.x).toBeCloseTo(2 * (1 - e) * e * 200 + e * e * 400, 9)
      expect(pose.y).toBeCloseTo(2 * (1 - e) * e * -80, 9)
      expect(pose.scale).toBeCloseTo(1 + 0.3 * Math.sin(Math.PI * s), 12)
    }
    expect(smoothstep(-1)).toBe(0)
    expect(smoothstep(2)).toBe(1)
    expect(smoothstep(0.5)).toBe(0.5)
  })

  test('heading follows the tangent: 0 = tip up, clockwise on screen', () => {
    // flying right: at the apex the tangent is horizontal, so the tip points right = 90 degrees
    expect(turn(flightPose([0, 0], [400, 0], 0.5).angleDeg, 90)).toBeLessThan(1e-9)
    // flying left: tip points left = -90
    expect(turn(flightPose([400, 0], [0, 0], 0.5).angleDeg, -90)).toBeLessThan(1e-9)
    // flying straight down the screen: 180
    expect(turn(flightPose([0, 0], [0, 400], 0.5).angleDeg, 180)).toBeLessThan(1e-9)
    // straight up: 0
    expect(turn(flightPose([0, 400], [0, 0], 0.5).angleDeg, 0)).toBeLessThan(1e-9)
    // rising first half of an arc to the right points up-right
    const rising = flightPose([0, 0], [400, 0], 0.3).angleDeg
    expect(rising).toBeGreaterThan(0)
    expect(rising).toBeLessThan(90)
  })

  test('heading leaves and rejoins the rest angle without a snap', () => {
    const start: Vec2 = [100, 600]
    const end: Vec2 = [900, 200]
    expect(flightPose(start, end, 0).angleDeg).toBe(REST_ANGLE_DEG)
    let previous = flightPose(start, end, 0)
    for (let k = 1; k <= 1000; k++) {
      const pose = flightPose(start, end, k / 1000)
      expect(turn(pose.angleDeg, previous.angleDeg)).toBeLessThan(4)
      expect(Math.hypot(pose.x - previous.x, pose.y - previous.y)).toBeLessThan(2)
      previous = pose
    }
    expect(previous.angleDeg).toBe(REST_ANGLE_DEG)
  })

  test('a zero-length flight is just the rest pose', () => {
    expect(flightPose([5, 5], [5, 5], 0.5)).toEqual({ x: 5, y: 5, angleDeg: REST_ANGLE_DEG, scale: 1 })
  })
})

describe('guidePose', () => {
  const cues = cuesFor('Some words and then the [piston](piston) moves, and after that the [valve](ring:valve) opens.')
  const first = cues[0]!
  const second = cues[1]!

  test('fixture: two on-time pointer cues, the pointer flies straight from one to the next', () => {
    expect(first.late || second.late).toBe(false)
    expect(first.dockAt).toBeNull()
    expect(second.dockAt).not.toBeNull()
  })

  test('docked before the first take-off', () => {
    const pose = guidePose(cues, first.fireAt - 0.01, still, DOCK_POINT)
    expect(pose).toEqual({ x: 640, y: 680, angleDeg: REST_ANGLE_DEG, scale: 1, visible: true, from: DOCK, to: DOCK, progress: 1, phase: 'docked', cue: -1 })
    expect(guidePose(cues, 0, still, DOCK_POINT)).toEqual(pose)
    expect(guidePose(cues, -5, still, DOCK_POINT)).toEqual(pose)
  })

  test('takes off from the dock at fireAt and lands on the part exactly at landAt', () => {
    const takeoff = guidePose(cues, first.fireAt, still, DOCK_POINT)
    expect(takeoff.phase).toBe('flying')
    expect([takeoff.x, takeoff.y]).toEqual([640, 680])
    expect(takeoff.progress).toBe(0)
    expect(takeoff.from).toBe(DOCK)
    expect(takeoff.to).toBe('piston')
    expect(takeoff.cue).toBe(0)

    const landed = guidePose(cues, first.landAt, still, DOCK_POINT)
    expect(landed).toEqual({ x: 400, y: 400, angleDeg: REST_ANGLE_DEG, scale: 1, visible: true, from: 'piston', to: 'piston', progress: 1, phase: 'perched', cue: 0 })
  })

  test('mid-flight it is on the lifted bezier, scaled up, heading along the tangent', () => {
    const t = (first.fireAt + first.landAt) / 2
    const pose = guidePose(cues, t, still, DOCK_POINT)
    const reference = flightPose(DOCK_POINT, [400, 400], 0.5)
    expect(pose.progress).toBeCloseTo(0.5, 12)
    expect(pose.x).toBeCloseTo(reference.x, 9)
    expect(pose.y).toBeCloseTo(reference.y, 9)
    expect(pose.angleDeg).toBeCloseTo(reference.angleDeg, 9)
    expect(pose.scale).toBeCloseTo(1.3, 9)
    // lift = min(0.2 * d, 80) px, half of it at the apex
    const distance = Math.hypot(640 - 400, 680 - 400)
    expect(pose.y).toBeCloseTo((680 + 400) / 2 - Math.min(0.2 * distance, 80) / 2, 9)
  })

  test('hops from part to part without visiting the dock', () => {
    const t = (second.fireAt + second.landAt) / 2
    const pose = guidePose(cues, t, still, DOCK_POINT)
    expect(pose.phase).toBe('flying')
    expect(pose.from).toBe('piston')
    expect(pose.to).toBe('valve')
    expect(pose.cue).toBe(1)
    const reference = flightPose([400, 400], [900, 150], 0.5)
    expect(pose.x).toBeCloseTo(reference.x, 9)
    expect(pose.y).toBeCloseTo(reference.y, 9)
    const landed = guidePose(cues, second.landAt, still, DOCK_POINT)
    expect([landed.x, landed.y, landed.phase]).toEqual([900, 150, 'perched'])
  })

  test('returns to the dock on the same arc after 1.5 s idle', () => {
    const dockAt = second.dockAt!
    expect(dockAt).toBeCloseTo(Math.max(second.drawEnd, second.wordEnd) + 1.5, 12)
    expect(guidePose(cues, dockAt - 0.001, still, DOCK_POINT).phase).toBe('perched')

    const leaving = guidePose(cues, dockAt, still, DOCK_POINT)
    expect([leaving.x, leaving.y, leaving.phase, leaving.from, leaving.to, leaving.progress]).toEqual([900, 150, 'flying', 'valve', DOCK, 0])

    const middle = guidePose(cues, dockAt + 0.25, still, DOCK_POINT)
    const reference = flightPose([900, 150], DOCK_POINT, 0.5)
    expect(middle.x).toBeCloseTo(reference.x, 9)
    expect(middle.y).toBeCloseTo(reference.y, 9)
    expect(middle.scale).toBeCloseTo(1.3, 9)

    const home = guidePose(cues, dockAt + 0.5, still, DOCK_POINT)
    expect(home).toEqual({ x: 640, y: 680, angleDeg: REST_ANGLE_DEG, scale: 1, visible: true, from: DOCK, to: DOCK, progress: 1, phase: 'docked', cue: -1 })
    expect(guidePose(cues, dockAt + 500, still, DOCK_POINT)).toEqual(home)
  })

  test('takes off from the dock again when it had gone home between two cues', () => {
    const filler = 'and it keeps moving up and down for a very long time while nothing else happens at all, again and again, '
    const far = cuesFor(`Some words and then the [piston](piston) moves ${filler}until the [valve](valve) opens.`)
    expect(far[0]!.dockAt).not.toBeNull()
    const resting = guidePose(far, far[1]!.fireAt - 0.01, still, DOCK_POINT)
    expect(resting.phase).toBe('docked')
    const flying = guidePose(far, far[1]!.fireAt + 0.25, still, DOCK_POINT)
    expect(flying.from).toBe(DOCK)
    expect(flying.to).toBe('valve')
    const reference = flightPose(DOCK_POINT, [900, 150], 0.5)
    expect(flying.x).toBeCloseTo(reference.x, 9)
    expect(flying.y).toBeCloseTo(reference.y, 9)
  })

  test('purity: the same t gives the same pose, whatever was sampled before', () => {
    const end = second.dockAt! + 1
    const times: number[] = []
    for (let t = -0.5; t <= end; t += 0.0371) times.push(t)
    const forward = times.map((t) => guidePose(cues, t, still, DOCK_POINT))
    const backward = times
      .slice()
      .reverse()
      .map((t) => guidePose(cues, t, still, DOCK_POINT))
      .reverse()
    expect(backward).toEqual(forward)
    // interleaved, repeated, and with a fresh but equal cue list
    const again = cuesFor('Some words and then the [piston](piston) moves, and after that the [valve](ring:valve) opens.')
    for (const k of [7, 3, 90, 3, 41, 7, 120, 0]) {
      const t = times[k % times.length]!
      expect(guidePose(again, t, still, DOCK_POINT)).toEqual(forward[k % times.length]!)
    }
    expect(JSON.stringify(cues)).toBe(JSON.stringify(again))
  })

  test('the cue list is not mutated by sampling', () => {
    const before = JSON.stringify(cues)
    for (let t = 0; t < 12; t += 0.1) guidePose(cues, t, still, DOCK_POINT)
    expect(JSON.stringify(cues)).toBe(before)
  })

  test('position and heading are continuous over the whole step (no pops at take-off, landing or docking)', () => {
    const end = second.dockAt! + 1
    const dt = 1 / 600
    let previous = guidePose(cues, 0, still, DOCK_POINT)
    for (let t = dt; t <= end; t += dt) {
      const pose = guidePose(cues, t, still, DOCK_POINT)
      expect(Math.hypot(pose.x - previous.x, pose.y - previous.y)).toBeLessThan(6)
      expect(turn(pose.angleDeg, previous.angleDeg)).toBeLessThan(8)
      expect(Math.abs(pose.scale - previous.scale)).toBeLessThan(0.01)
      expect(pose.visible).toBe(true)
      previous = pose
    }
  })
})

describe('guidePose - riding moving anchors', () => {
  const cues = cuesFor('Some words and then the [piston](piston) moves, and after that the [valve](ring:valve) opens.')
  const first = cues[0]!
  const second = cues[1]!
  // the piston slides and the valve orbits: anchors are functions of time
  const moving: AnchorAt = (id, t) => (id === 'piston' ? [400 + 60 * t, 400 - 30 * t] : id === 'valve' ? [900 + 50 * Math.sin(t), 150 + 50 * Math.cos(t)] : null)

  test('perched: the pointer sits on the part wherever it is now', () => {
    for (const t of [first.landAt, first.landAt + 0.2, second.fireAt - 0.01]) {
      const pose = guidePose(cues, t, moving, DOCK_POINT)
      expect(pose.phase).toBe('perched')
      expect([pose.x, pose.y]).toEqual(moving('piston', t)!)
    }
  })

  test('in flight: both ends are read at the current time, so it still lands exactly on the part', () => {
    const t = second.fireAt + 0.3
    const pose = guidePose(cues, t, moving, DOCK_POINT)
    const reference = flightPose(moving('piston', t)!, moving('valve', t)!, 0.3 / 0.5)
    expect(pose.x).toBeCloseTo(reference.x, 9)
    expect(pose.y).toBeCloseTo(reference.y, 9)
    const landed = guidePose(cues, second.landAt, moving, DOCK_POINT)
    expect([landed.x, landed.y]).toEqual(moving('valve', second.landAt)!)
    const justBefore = guidePose(cues, second.landAt - 1e-6, moving, DOCK_POINT)
    expect(Math.hypot(justBefore.x - landed.x, justBefore.y - landed.y)).toBeLessThan(0.01)
  })

  test('still pure with moving anchors', () => {
    const t = second.fireAt + 0.123
    const a = guidePose(cues, t, moving, DOCK_POINT)
    guidePose(cues, t + 3, moving, DOCK_POINT)
    guidePose(cues, 0, moving, DOCK_POINT)
    expect(guidePose(cues, t, moving, DOCK_POINT)).toEqual(a)
  })

  test('an arrow rides both of its parts while it is drawn', () => {
    const arrowCues = cuesFor('Now some words and then the [air](arrow:piston->valve) rushes in.')
    const arrow = arrowCues[0]!
    const tail = guidePose(arrowCues, arrow.landAt, moving, DOCK_POINT)
    expect([tail.x, tail.y]).toEqual(moving('piston', arrow.landAt)!)
    const t = (arrow.landAt + arrow.drawEnd) / 2
    const halfway = guidePose(arrowCues, t, moving, DOCK_POINT)
    const a = moving('piston', t)!
    const b = moving('valve', t)!
    expect(halfway.x).toBeCloseTo((a[0] + b[0]) / 2, 9)
    expect(halfway.y).toBeCloseTo((a[1] + b[1]) / 2, 9)
    const later = arrow.drawEnd + 0.3
    const head = guidePose(arrowCues, later, moving, DOCK_POINT)
    expect([head.x, head.y]).toEqual(moving('valve', later)!)
  })

  test('anchorAt is asked with the sampled time', () => {
    const asked: number[] = []
    const t = second.fireAt + 0.2
    guidePose(cues, t, (id, at) => (asked.push(at), STILL[id] ?? null), DOCK_POINT)
    expect(asked.length).toBeGreaterThan(0)
    expect(asked.every((at) => at === t)).toBe(true)
  })
})

describe('guidePose - arrows, missing parts, odd input', () => {
  test('an arrow is drawn with the pointer as its pen tip: tail at landing, head when the stroke ends', () => {
    const cues = cuesFor('Now some words and then the [air](arrow:port->cylinder) rushes in.')
    const arrow = cues[0]!
    const approach = guidePose(cues, arrow.fireAt + 0.25, still, DOCK_POINT)
    expect(approach.to).toBe('port')

    const landed = guidePose(cues, arrow.landAt, still, DOCK_POINT)
    expect([landed.x, landed.y, landed.phase, landed.from, landed.to, landed.progress]).toEqual([200, 120, 'drawing', 'port', 'cylinder', 0])

    const halfway = guidePose(cues, (arrow.landAt + arrow.drawEnd) / 2, still, DOCK_POINT)
    expect(halfway.phase).toBe('drawing')
    expect(halfway.progress).toBeCloseTo(0.5, 9)
    expect(halfway.x).toBeCloseTo(310, 9)
    expect(halfway.y).toBeCloseTo(210, 9)
    expect(halfway.angleDeg).toBe(REST_ANGLE_DEG)

    const done = guidePose(cues, arrow.drawEnd, still, DOCK_POINT)
    expect([done.x, done.y, done.phase, done.from, done.to, done.progress]).toEqual([420, 300, 'perched', 'cylinder', 'cylinder', 1])
  })

  test('a part that cannot be pointed at is skipped: the pointer stays where it was', () => {
    const cues = cuesFor('Some words and then the [piston](piston) moves, and after that the [ghost](nowhere) and the [valve](valve) too.')
    const [piston, ghost, valve] = cues as [GuideCue, GuideCue, GuideCue]
    const during = guidePose(cues, (ghost.fireAt + ghost.landAt) / 2, still, DOCK_POINT)
    expect([during.x, during.y]).toEqual([400, 400])
    expect(during.scale).toBe(1)
    const after = guidePose(cues, ghost.landAt + 0.1, still, DOCK_POINT)
    expect([after.x, after.y, after.from]).toEqual([400, 400, 'piston'])
    const onward = guidePose(cues, valve.fireAt, still, DOCK_POINT)
    expect([onward.x, onward.y, onward.from, onward.to]).toEqual([400, 400, 'piston', 'valve'])
    expect(piston.pointer).toBe(true)
  })

  test('nothing resolvable: it never leaves the dock', () => {
    const cues = cuesFor('Some words and then the [piston](piston) moves, and the [valve](valve) too.')
    for (let t = 0; t < 12; t += 0.07) {
      const pose = guidePose(cues, t, () => null, DOCK_POINT)
      expect(pose.phase === 'perched' || pose.phase === 'drawing').toBe(false)
      expect([pose.x, pose.y]).toEqual([640, 680])
      expect(pose.scale).toBe(1)
      expect(pose.angleDeg).toBe(REST_ANGLE_DEG)
    }
    const junk = guidePose(cues, cues[0]!.landAt, () => [NaN, 3] as Vec2, DOCK_POINT)
    expect([junk.x, junk.y]).toEqual([640, 680])
  })

  test('cues that do not move the pointer leave it docked', () => {
    const cues = cuesFor('Now the [valves](glow:piston+valve) light up and we [look](focus:piston) closer.')
    for (const t of [0, 1, 2, 3, 10]) expect(guidePose(cues, t, still, DOCK_POINT).phase).toBe('docked')
    expect(guidePose([], 1, still, DOCK_POINT).phase).toBe('docked')
  })

  test('a ring around several parts perches on the first', () => {
    const cues = cuesFor('Some words and then [both of them](ring:valve+piston) light up.')
    const pose = guidePose(cues, cues[0]!.landAt, still, DOCK_POINT)
    expect([pose.x, pose.y, pose.to]).toEqual([900, 150, 'valve'])
  })

  test('a non-finite time or dock is reported as not visible instead of throwing', () => {
    const cues = cuesFor('Some words and then the [piston](piston) moves.')
    expect(guidePose(cues, NaN, still, DOCK_POINT).visible).toBe(false)
    expect(guidePose(cues, 1, still, [NaN, 0]).visible).toBe(false)
    expect(guidePose(cues, Infinity, still, DOCK_POINT).visible).toBe(false)
  })

  test('a late cue still flies a full hop and lands at its landAt', () => {
    const cues = cuesFor('[Pistons](piston) move.')
    const cue = cues[0]!
    expect(cue.late).toBe(true)
    const poses: GuidePose[] = [0, 0.25, 0.5].map((t) => guidePose(cues, t, still, DOCK_POINT))
    expect(poses[0]!.progress).toBe(0)
    expect(poses[1]!.progress).toBeCloseTo(0.5, 12)
    expect([poses[2]!.x, poses[2]!.y, poses[2]!.phase]).toEqual([400, 400, 'perched'])
  })
})
