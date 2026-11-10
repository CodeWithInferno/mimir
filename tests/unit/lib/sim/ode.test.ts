import { describe, expect, test } from 'bun:test'
import { ode, rng } from '../../../../src/lib/sim/index.ts'

const DT = 1 / 240

describe('ode: accuracy against closed forms', () => {
  test('exponential decay matches e^(-kt) on step-aligned times to 1e-10', () => {
    const k = 1.7
    const decay = ode({ y0: [1], f: (_t, y) => [-k * y[0]!] })
    for (const t of [0, 0.5, 1, 2, 5]) {
      expect(Math.abs(decay.at(t)[0]! - Math.exp(-k * t))).toBeLessThan(1e-10)
    }
  })

  test('between steps the linear interpolation error stays under dt^2/8 * max|y"|', () => {
    const k = 1.7
    const decay = ode({ y0: [1], f: (_t, y) => [-k * y[0]!] })
    const bound = ((DT * DT) / 8) * k * k * 1.01
    let worst = 0
    for (let i = 0; i < 400; i++) {
      const t = (i + 0.5) * DT * 0.731
      worst = Math.max(worst, Math.abs(decay.at(t)[0]! - Math.exp(-k * t)))
    }
    expect(worst).toBeLessThan(bound)
    expect(worst).toBeGreaterThan(0)
  })

  test('RK4 global error is fourth order: halving dt cuts the error about 16 times', () => {
    const errorAt = (dt: number): number => Math.abs(ode({ y0: [1], f: (_t, y) => [-3 * y[0]!], dt }).at(1)[0]! - Math.exp(-3))
    const ratio = errorAt(1 / 16) / errorAt(1 / 32)
    expect(ratio).toBeGreaterThan(13)
    expect(ratio).toBeLessThan(19)
  })

  test('harmonic oscillator: energy drift over 100 periods is below 1e-6 (theory: about 1.1e-7)', () => {
    const omega = 2 * Math.PI
    const f = (_t: number, y: { x: number; v: number }) => ({ x: y.v, v: -omega * omega * y.x })
    const spring = ode({ y0: { x: 1, v: 0 }, f })
    const energy = (y: { x: number; v: number }): number => 0.5 * y.v * y.v + 0.5 * omega * omega * y.x * y.x
    const e0 = energy(spring.at(0))
    let worst = 0
    for (let period = 1; period <= 100; period++) {
      worst = Math.max(worst, Math.abs(energy(spring.at(period)) - e0) / e0)
    }
    expect(worst).toBeLessThan(1e-6)
    // position against cos(omega t) after 10 and 100 periods
    expect(Math.abs(spring.at(10).x - 1)).toBeLessThan(1e-6)
    expect(Math.abs(spring.at(10.25).x - Math.cos(omega * 10.25))).toBeLessThan(1e-5)
    expect(Math.abs(spring.at(100).x - 1)).toBeLessThan(1e-6)

    // the method matters: forward Euler gains energy by orders of magnitude more on the same problem
    const euler = ode({ y0: { x: 1, v: 0 }, f, method: 'euler' })
    expect(Math.abs(energy(euler.at(10)) - e0) / e0).toBeGreaterThan(1)
    const midpoint = ode({ y0: { x: 1, v: 0 }, f, method: 'midpoint' })
    const midpointDrift = Math.abs(energy(midpoint.at(10)) - e0) / e0
    expect(midpointDrift).toBeLessThan(1e-3)
    expect(midpointDrift).toBeGreaterThan(worst)
  })

  test('RC circuit: charge curve V0 (1 - e^(-t/RC)) and the research reference values', () => {
    const V0 = 5
    const R = 10e3
    const C = 100e-6
    const tau = R * C
    const charge = ode({ y0: { v: 0 }, f: (_t, y) => ({ v: (V0 - y.v) / tau }) })
    for (const t of [0, 0.1, 0.5, 1, 2, 5]) {
      expect(Math.abs(charge.at(t).v - V0 * (1 - Math.exp(-t / tau)))).toBeLessThan(1e-9)
    }
    expect(charge.at(tau).v).toBeCloseTo(3.1606, 4) // 63.2 % after one time constant
    expect(charge.at(5 * tau).v).toBeCloseTo(4.9663, 4)
    expect(((V0 - charge.at(0).v) / R) * 1e3).toBeCloseTo(0.5, 12) // initial current in mA

    // switch thrown at t = tau: charge for one time constant, then discharge for one (07 section 4.5)
    const switched = ode({ y0: { v: 0 }, f: (t, y) => ({ v: ((t < tau ? V0 : 0) - y.v) / tau }) })
    expect(switched.at(tau).v).toBeCloseTo(3.1606, 4)
    expect(switched.at(2 * tau).v).toBeCloseTo(1.1627, 4)
    // a switch that sits exactly on a step boundary costs no accuracy at all
    expect(Math.abs(switched.at(2 * tau).v - V0 * (1 - Math.exp(-1)) * Math.exp(-1))).toBeLessThan(1e-9)
    // stage times stay inside their own step, so f never sees a time from the wrong side of a boundary
    const seen: number[] = []
    ode({ y0: [0], f: (t) => { seen.push(t); return [0] }, dt: 0.25 }).at(0.5)
    expect(seen.length).toBe(8)
    expect(seen.slice(0, 4).every((t) => t > 0 && t < 0.25)).toBe(true)
    expect(seen.slice(4).every((t) => t > 0.25 && t < 0.5)).toBe(true)
  })

  test('Hodgkin-Huxley action potential reproduces the research run (07 S1)', () => {
    const gNa = 120, gK = 36, gL = 0.3, ENa = 50, EK = -77, EL = -54.387
    const an = (V: number) => (Math.abs(V + 55) < 1e-7 ? 0.1 : (0.01 * (V + 55)) / (1 - Math.exp(-(V + 55) / 10)))
    const bn = (V: number) => 0.125 * Math.exp(-(V + 65) / 80)
    const am = (V: number) => (Math.abs(V + 40) < 1e-7 ? 1 : (0.1 * (V + 40)) / (1 - Math.exp(-(V + 40) / 10)))
    const bm = (V: number) => 4 * Math.exp(-(V + 65) / 18)
    const ah = (V: number) => 0.07 * Math.exp(-(V + 65) / 20)
    const bh = (V: number) => 1 / (1 + Math.exp(-(V + 35) / 10))
    const rest = -65
    const neuron = (amp: number) => ode({
      y0: { V: rest, m: am(rest) / (am(rest) + bm(rest)), h: ah(rest) / (ah(rest) + bh(rest)), n: an(rest) / (an(rest) + bn(rest)) },
      dt: 0.01, // milliseconds
      f: (t, y) => {
        const I = t >= 5 && t < 6 ? amp : 0
        return {
          V: I - gNa * y.m ** 3 * y.h * (y.V - ENa) - gK * y.n ** 4 * (y.V - EK) - gL * (y.V - EL),
          m: am(y.V) * (1 - y.m) - bm(y.V) * y.m,
          h: ah(y.V) * (1 - y.h) - bh(y.V) * y.h,
          n: an(y.V) * (1 - y.n) - bn(y.V) * y.n,
        }
      },
    })
    const peak = (amp: number): { v: number; t: number } => {
      let best = { v: -Infinity, t: 0 }
      for (const [t, v] of neuron(amp).series('V', 0, 40, 4001)) if (v > best.v) best = { v, t }
      return best
    }
    const spike = peak(10)
    expect(spike.v).toBeGreaterThan(38.6) // reference: 39.1 mV at 7.51 ms
    expect(spike.v).toBeLessThan(39.6)
    expect(Math.abs(spike.t - 7.51)).toBeLessThan(0.05)
    expect(peak(6).v).toBeLessThan(-55) // sub-threshold (reference -59.9 mV)
    expect(peak(7).v).toBeGreaterThan(30) // fires (reference 34.9 mV)
    expect(neuron(10).issues).toEqual([])
  })
})

describe('ode: a pure function of time', () => {
  const sigma = 10, rho = 28, beta = 8 / 3
  const lorenz = (checkpointEvery?: number) => ode({
    y0: [1, 1, 1],
    f: (_t, [x, y, z]) => [sigma * (y! - x!), x! * (rho - z!) - y!, x! * y! - beta * z!],
    checkpointEvery,
  })
  const times = (() => {
    const random = rng('ode-order')
    return Array.from({ length: 300 }, () => random.range(0, 20))
  })()

  test('identical bits whatever the call order (chaotic system, so any difference would explode)', () => {
    const ascending = [...times].sort((a, b) => a - b)
    const descending = [...ascending].reverse()
    const a = lorenz(), b = lorenz(), c = lorenz()
    const fromAscending = new Map(ascending.map((t) => [t, a.at(t)]))
    const fromDescending = new Map(descending.map((t) => [t, b.at(t)]))
    for (const t of times) {
      const shuffled = c.at(t)
      expect(shuffled).toEqual(fromAscending.get(t)!)
      expect(shuffled).toEqual(fromDescending.get(t)!)
    }
    // asking again, in yet another order, on an instance that has already been everywhere
    for (const t of rng(3).shuffle(times)) expect(a.at(t)).toEqual(fromDescending.get(t)!)
    // a fresh instance asked for one late time only
    const late = Math.max(...times)
    expect(lorenz().at(late)).toEqual(fromAscending.get(late)!)
  })

  test('checkpoint spacing changes memory only, never the values', () => {
    const reference = lorenz(1)
    for (const every of [2, 16, 1000, 100000]) {
      const other = lorenz(every)
      for (const t of times.slice(0, 60)) expect(other.at(t)).toEqual(reference.at(t))
    }
  })

  test('reset() recomputes the same curve, and picks up a change in what f reads', () => {
    let gain = -1
    const system = ode({ y0: [1], f: (_t, y) => [gain * y[0]!] })
    const before = system.at(2)[0]!
    system.reset()
    expect(system.at(2)[0]!).toBe(before)
    gain = -2
    system.reset()
    expect(system.at(2)[0]!).toBeCloseTo(Math.exp(-4), 9)
  })

  test('at() returns a fresh object each call, in the shape of y0', () => {
    const system = ode({ y0: { a: 1, b: 2 }, f: () => ({ a: 1, b: -1 }) })
    const first = system.at(1)
    first.a = 999
    expect(system.at(1).a).toBeCloseTo(2, 12)
    expect(system.at(1).b).toBeCloseTo(1, 12)
    expect(Object.keys(system.at(0))).toEqual(['a', 'b'])
    expect(ode({ y0: [3, 4], f: () => [0, 0] }).at(7)).toEqual([3, 4])
  })

  test('f may return or mutate the array it was given', () => {
    const grow = ode({ y0: [1], f: (_t, y) => y }) // dy/dt = y
    expect(grow.at(1)[0]!).toBeCloseTo(Math.E, 9)
    const inPlace = ode({ y0: [1], f: (_t, y) => { y[0] = -y[0]!; return y } })
    expect(inPlace.at(1)[0]!).toBeCloseTo(Math.exp(-1), 9)
  })
})

describe('ode: value() and series()', () => {
  const fall = ode({ y0: { height: 100, speed: 0 }, f: (_t, y) => ({ height: y.speed, speed: -9.81 }) })

  test('value(key, t) equals at(t)[key]', () => {
    for (const t of [0, 0.3331, 1, 2.5]) expect(fall.value('height', t)).toBe(fall.at(t).height)
    expect(ode({ y0: [5, 6], f: () => [1, 0] }).value(0, 2)).toBeCloseTo(7, 12)
  })

  test('series gives n evenly spaced [t, value] points including both ends', () => {
    const points = fall.series('height', 0, 2, 5)
    expect(points.map(([t]) => t)).toEqual([0, 0.5, 1, 1.5, 2])
    for (const [t, height] of points) expect(height).toBeCloseTo(100 - 0.5 * 9.81 * t * t, 9)
    expect(fall.series('speed', 1, 1, 3)).toEqual([[1, fall.at(1).speed], [1, fall.at(1).speed], [1, fall.at(1).speed]])
    expect(fall.series('height', 0, 1).length).toBe(200)
  })
})

describe('ode: bad input never throws', () => {
  test('t before 0 gives y0; NaN time gives y0', () => {
    const system = ode({ y0: [2], f: () => [1] })
    expect(system.at(-5)).toEqual([2])
    expect(system.at(Number.NaN)).toEqual([2])
  })

  test('a diverging system stays finite and reports the problem once', () => {
    // finite-time blow-up: the derivative overflows first, is counted as 0 and reported
    const blowUp = ode({ y0: [1], f: (_t, y) => [y[0]! * y[0]! * 1e6] })
    const late = blowUp.at(10)[0]!
    expect(Number.isFinite(late)).toBe(true)
    expect(blowUp.at(20)[0]!).toBe(late)
    expect(blowUp.issues.length).toBe(1)
    expect(blowUp.issues[0]).toContain('f returned Infinity')

    // finite derivatives whose sum overflows: the state holds at its last finite value
    const overflow = ode({ y0: [1e300], f: () => [1e308], dt: 1 })
    expect(overflow.at(0.5)[0]!).toBe(1e300)
    expect(overflow.at(50)[0]!).toBe(1e300)
    expect(overflow.issues.length).toBe(1)
    expect(overflow.issues[0]).toContain('non-finite')
  })

  test('f that throws or returns junk is reported and treated as a zero derivative', () => {
    const throws = ode({ y0: [1], f: () => { throw new Error('boom') } })
    expect(throws.at(1)).toEqual([1])
    expect(throws.issues.length).toBe(1)
    expect(throws.issues[0]).toContain('boom')

    const junk = ode({ y0: { a: 1, b: 1 }, f: () => ({ a: Number.NaN }) as unknown as { a: number; b: number } })
    expect(junk.at(1)).toEqual({ a: 1, b: 1 })
    expect(junk.issues.length).toBe(1)

    const nothing = ode({ y0: [1], f: (() => undefined) as unknown as () => number[] })
    expect(nothing.at(1)).toEqual([1])
    expect(nothing.issues.length).toBe(1)
  })

  test('bad options fall back to defaults and say so', () => {
    const system = ode({ y0: [1, Number.NaN], f: () => [0, 0], dt: -1, method: 'rk9' as 'rk4' })
    expect(system.dt).toBe(DT)
    expect(system.at(1)).toEqual([1, 0])
    expect(system.issues.length).toBe(3)
    expect(ode({ y0: 5 as unknown as number[], f: () => [] }).at(1)).toEqual([])
    expect(ode(undefined as unknown as { y0: number[]; f: () => number[] }).at(1)).toEqual([])
    expect(system.value(7, 1)).toBe(0)
    expect(system.issues.length).toBe(4)
  })

  test('the step cap bounds the work: past it the state holds', () => {
    let calls = 0
    const system = ode({ y0: [0], f: () => { calls++; return [1] }, maxSteps: 480 })
    expect(system.at(1e12)[0]!).toBeCloseTo(2, 9)
    expect(calls).toBe(480 * 4)
    expect(system.issues.length).toBe(1)
    expect(system.issues[0]).toContain('480-step limit')
  })
})
