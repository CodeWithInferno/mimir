/**
 * sim: pure, deterministic simulation helpers whose results are functions of time (DESIGN 3.1).
 * Everything here recomputes from t = 0 on a fixed step and caches, so the value at a time never depends
 * on which times were asked for before. No DOM, no three.js, no clocks, no Math.random.
 */
export { ode } from './ode.ts'
export type { Ode, OdeKey, OdeMethod, OdeOptions, OdeState } from './ode.ts'
export { events } from './events.ts'
export type { EventRecord, EventStep, Events, EventsOptions } from './events.ts'
export { stepper } from './stepper.ts'
export type { StepPhase, StepTiming, Stepper, StepperOptions, StepperSource } from './stepper.ts'
export { rng } from './rng.ts'
export type { Rng } from './rng.ts'
export { clamp, lerp, remap, trail } from './helpers.ts'
export type { TrailOptions } from './helpers.ts'
export { accumulate, accumulator, smoothDamp, smoothDampStep } from './follow.ts'
export type { Accumulator, FixedStepOptions, SmoothDamp, SmoothDampOptions } from './follow.ts'
