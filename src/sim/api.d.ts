/** The next event of events(): it happens `after` seconds from now and `apply` changes the state (mutate the copy it is given, or return a new state). */
interface SimEvent<S> { after: number; apply: (state: S, t: number) => S | void; label?: string }
/** One entry of an events() history: the state that holds from time `t` until the next entry. Entry 0 is the initial state, label 'init'. */
interface SimEventRecord<S> { index: number; t: number; label: string; state: S }
/** The seeded random stream handed to events(): next() in [0, 1), range(a, b), int(a, b), pick(list), normal(mean, deviation), exponential(mean), chance(p), shuffle(list). */
interface SimRandom { next(): number; range(a: number, b: number): number; int(a: number, b: number): number; pick<T>(items: readonly T[]): T; normal(mean?: number, deviation?: number): number; exponential(mean?: number): number; chance(probability: number): boolean; shuffle<T>(items: readonly T[]): T[] }
/** A solved differential equation: a pure function of simulation time, so scrubbing in any order gives the same state. */
interface OdeSolution<Y> {
  /** The state at time `t` in seconds (default: now, s.t()): sim.at().angle. */
  at(t?: number): Y
  /** One component at time `t` (default: now), without allocating: sim.value('angle'). For an array state the key is the index. */
  value(key: Y extends readonly number[] ? number : keyof Y & string, t?: number): number
  /** `count` points [t, value] of one component from t0 to t1 (default 200): the curve for a plot. */
  series(key: Y extends readonly number[] ? number : keyof Y & string, t0: number, t1: number, count?: number): [number, number][]
  /** The fixed step in use, seconds. */
  readonly dt: number
}
/**
 * Integrate dy/dt = f(t, y) from t = 0 with a fixed step (Runge-Kutta 4, dt 1/240 s): ode({ y0: { angle: 30, speed: 0 }, f: (t, y) => ({ angle: y.speed, speed: -k() * y.angle }) }).
 * y0 is an object of named numbers or an array; f returns the derivative in the same shape and may read params: a param the story sweeps is felt as it changes, a slider the viewer holds restarts the run with that value.
 * A state that blows up is SIM-UNSTABLE, and `mimir check` warns when halving dt changes the result by more than `tolerance` (default 0.02).
 */
declare function ode<Y extends number[] | Record<string, number>>(options: { y0: Y; f: (t: number, y: Y) => Y; dt?: number; method?: 'rk4' | 'midpoint' | 'euler'; tolerance?: number }): OdeSolution<Y>
/** A discrete-event simulation as a pure function of simulation time. */
interface EventSimulation<S> {
  /** The state at time `t` (default: now, s.t()). Read it, never change it. */
  at(t?: number): S
  /** The latest event at time `t` (default: now): { index, t, label, state }; s.t() - entry().t is the time since it happened. */
  entry(t?: number): SimEventRecord<S>
  /** Every event up to time `t` (default: now), oldest first. */
  history(t?: number): readonly SimEventRecord<S>[]
}
/**
 * A seeded discrete-event simulation (arrivals, queues, retries): events({ init: { waiting: 0 }, seed: 7, next: (state, rng) => ({ after: rng.exponential(0.8), label: 'arrive', apply: (s) => { s.waiting++ } }) }).
 * `next` is called once per event and returns what happens next ({ after, apply, label? }) or null when nothing more will happen.
 */
declare function events<S>(options: { init: S; next: (state: S, rng: SimRandom, t: number) => SimEvent<S> | null | undefined; seed?: number | string; maxEvents?: number }): EventSimulation<S>
/** The recorded states of an algorithm. */
interface AlgorithmSteps<T> {
  /** How many states were recorded. */
  readonly count: number
  /** Every state in order. */
  readonly states: readonly T[]
  /** State number `i` (clamped to the first and last). */
  at(i: number): T
  /** The state shown at time `t` (default: now, s.t()) when each state lasts `stepSeconds`. */
  atTime(t?: number): T
  /** { index, progress } at time `t` (default: now): the current state and how far it is to the next (0..1), to tween between two states. */
  phase(t?: number): { index: number; progress: number }
}
/**
 * Record the states of an algorithm (a sort, a search, gradient descent) from a list or a generator: stepper(function* () { let x = 4; while (Math.abs(x) > 0.01) { yield { x }; x -= rate() * 2 * x } }, { stepSeconds: 0.5 }).
 * Each yielded state is copied, so a generator may reuse one object. A generator that reads params is run again when they change.
 */
declare function stepper<T>(states: readonly T[] | (() => Iterable<T>), options?: { stepSeconds?: number; maxSteps?: number }): AlgorithmSteps<T>
/** A running integral: call it for the value now (pass it wherever a dynamic number is expected), or .at(t) for another time. */
interface Integral { (): number; at(t: number): number }
/**
 * The running integral of a rate over simulation time: const angle = integrate(() => rpm() * 6) is a crank angle in degrees that never jumps when the story changes the speed; use it as .rotate({ about: 'z', deg: angle }).
 * Define it once, outside any per-frame function.
 */
declare function integrate(rate: (t: number) => number, options?: { dt?: number }): Integral
