/** A value, or a pure function of the current state (params, s.t(), other objects); re-evaluated every frame. */
type Dyn<T> = T | (() => T)
type Vec2 = [number, number]
type Vec3 = [number, number, number]
/** A palette token (BLUE), '#rrggbb', '#rrggbbaa' or 'rgb(…)'. */
type Color = string
/** Maps progress 0..1 to eased progress. */
type RateFn = (t: number) => number
/** Anything that denotes a point: [x, y], [x, y, z], an object (its centre), an anchor (box.top, part.anchor('pin')) or a function. */
type PointLike = readonly number[] | Placed<unknown> | (() => readonly number[])
/** 'up' | 'down' | 'left' | 'right' | 'front' | 'back', or a vector such as UP or UR. */
type Direction = 'up' | 'down' | 'left' | 'right' | 'front' | 'back' | readonly number[]
/** A live point on an object; call it for its position now, or pass it wherever a point is expected. */
interface AnchorRef { (): Vec3 }
/** What verbs return; play it with st.play(...). */
interface Anim { readonly isAnim: true; duration: number }
/** A rectangle of the frame; x, y is the MIN corner (left, bottom). */
interface Area { x: number; y: number; width: number; height: number; center: Vec2; left: number; right: number; top: number; bottom: number }

/** Setters every object has. Each object gets ONE placement (at / attach / nextTo / a container). */
interface CommonSetters<R> {
  /** Absolute position (the escape hatch), or the centre of another object: m.at(0, 2) · p.at(0, 2, 0) · m.at(other) · m.at(() => [x, y]). A 2D object placed at a 3D part lands where that part is drawn. */
  at(x: Dyn<number>, y: Dyn<number>, z?: Dyn<number>): R
  at(target: PointLike): R
  /** Offset on top of the placement: m.shift(0.5, 0). */
  shift(dx: number, dy: number, dz?: number): R
  /** Rigidly follow another object: my anchor sits on its anchor (+ gap outwards). p.attach(wheel, { my: 'bottom', to: 'top' }). */
  attach(target: Placed<unknown> | AnchorRef | string, opts?: { my?: string; to?: string; gap?: Dyn<number> }): R
  /** Sit beside another object: m.nextTo(box, 'right', 0.25). */
  nextTo(target: PointLike | string, dir?: Direction, gap?: Dyn<number>): R
  /** Sit on a point of another object and follow it. A 2D object pinned to a 3D part stays flat, at the place where that anchor is drawn: tag.pin(piston, 'top', { offset: [0, 0.4] }). */
  pin(target: Placed<unknown> | AnchorRef | string, anchor?: string, opts?: { offset?: Dyn<readonly number[]> }): R
  pin(target: Placed<unknown> | AnchorRef | string, opts?: { offset?: Dyn<readonly number[]> }): R
  /** Uniform size factor. */
  scale(k: Dyn<number>): R
  /** 0 (invisible) … 1. */
  opacity(a: Dyn<number>): R
  color(c: Dyn<Color>): R
  /** Paint order: higher is on top (2D). */
  z(i: number): R
  /** Change any option of the object's kind: m.set({ width: 3 }); m.to.set({ width: 3 }) tweens to it. */
  set(options: Record<string, unknown>): R
}
/** Members every object has. */
interface Placed<Self> extends CommonSetters<Self> {
  readonly id: string
  /** A named point that follows the object: 'center' 'top' 'bottom' 'left' 'right' 'front' 'back' + the kind's own + define()d ones. */
  anchor(name?: string): AnchorRef
  /** Position of an anchor right now: [x, y, z]. Use inside functions: () => part.world('top')[1]. */
  world(name?: string): Vec3
  /** Add a named local point: wheel.define('pin', [1.5, 0, 0]). */
  define(name: string, local: Dyn<readonly number[]>): Self
}

/** A param: call it for its value (p()), tween it with p.to(v) or st.set(p, v). Shows as a slider. */
interface Param<T = number> { (): T; readonly value: T; /** Tween to a value: st.play(p.to(180)). */ to(v: T, opts?: { duration?: number; rate?: RateFn }): Anim }

interface Scene {
  /** A number the story tweens and the viewer can drag: const angle = s.param('angle', { value: 0, min: 0, max: 360, unit: '°' }). cyclic: true says the value goes round (period = one cycle, default the range; degrees over whole turns are cyclic by themselves): check then samples phases of it. group heads its row in the viewer; hidden: true gives it no control there. */
  param(name: string, opts: { value: number; min: number; max: number; step?: number; unit?: string; label?: string; cyclic?: boolean; period?: number; group?: string; hidden?: boolean }): Param<number>
  /** An on/off switch: const cut = s.toggle('cut', { value: false }). */
  toggle(name: string, opts: { value: boolean; label?: string; group?: string; hidden?: boolean }): Param<boolean>
  /** One of several named options: s.choice('mode', { options: ['slow', 'fast'], value: 'slow' }). */
  choice(name: string, opts: { options: string[]; value: string; label?: string; group?: string; hidden?: boolean }): Param<string>
  /** A value only the story drives (st.set(lit, true), count.to(5)); no control in the viewer: const lit = s.state('lit', false). A text needs its options: s.state('mode', 'idle', { options: ['idle', 'busy'] }). */
  state(name: string, initial: boolean): Param<boolean>
  state(name: string, initial: number, opts?: { min?: number; max?: number; label?: string }): Param<number>
  state(name: string, initial: string, opts: { options: string[]; label?: string }): Param<string>
  /** Change settings of this scene (durations, text sizes, the 3D look, guide timing …; keys in docs/CONFIG.md), on the first line of the builder: s.config({ pace: { play: 1.5 }, 'guide.captions': false }). */
  config(settings: Record<string, unknown>): Scene
  /** Read the setting in force: s.config('pace.play'). */
  config(key: string): unknown
  /** Simulation time in seconds (advances with the story; st.clock changes its speed). */
  t(): number
  /** A derived value, computed at most once per frame: const h = s.signal(() => piston.world()[1]). */
  signal<T>(fn: () => T): () => T
  /** Expose a number to `mimir check` / `mimir shot`: s.probe('pistonHeight', () => piston.world()[1]). */
  probe(name: string, fn: () => number): void
  /** The only randomness: seeded and repeatable. Draw numbers while building the scene. */
  rng(seed?: number | string): { (): number; range(a: number, b: number): number; int(a: number, b: number): number; pick<T>(items: readonly T[]): T }
  /** One idea of the story. The function runs once and records what happens: s.step('Intake', st => { … }). */
  step(title: string, build: (st: Step) => void): void
  /** Start a chapter of a long explanation: everything on stage except `keep` fades out, the cameras ease back to the whole picture over the opening (0.8 s; `keepCamera: true` leaves the 2D zoom and the 3D camera where they are), and the steps that follow belong to it. 3–8 chapters of 2–6 steps each. */
  chapter(title: string, opts?: { keep?: (Placed<unknown> | string)[]; keepCamera?: boolean }): void
  /** Where the 3D panel sits: 'full' | 'left' | 'right' | 'top' | 'bottom' (+ share of the frame, default 0.6) or { x, y, width, height } (centre + size). */
  viewport(where?: 'full' | 'left' | 'right' | 'top' | 'bottom' | { x?: number; y?: number; width: number; height: number }, fraction?: number): Area
  /** A region for 2D content, inset by the safe margin. Without arguments: the part the 3D panel leaves free. */
  area(where?: 'full' | 'left' | 'right' | 'top' | 'bottom', fraction?: number): Area
}

interface Step {
  /** Play animations together, then move on: st.play(fadeIn(a), b.to.shift(1, 0), { duration: 2, lag: 0.1 }). */
  play(...anims: (Anim | Anim[] | { duration?: number; lag?: number; rate?: RateFn })[]): Step
  /** Hold for some seconds (default 1). */
  wait(seconds?: number): Step
  /** Tween a param to a value over the whole step (or over { duration } from now). A step that only sweeps lasts 3 s. */
  set<T>(param: Param<T>, value: T, opts?: { duration?: number; rate?: RateFn }): Step
  /** Move the 3D camera (2 s): a named view, a target, angles in degrees, or fit: [parts]. The camera fits the model on its own when never called. */
  camera(spec: { view?: 'iso' | 'front' | 'back' | 'side' | 'left' | 'right' | 'top' | 'bottom'; target?: PointLike; azimuth?: number; elevation?: number; distance?: number; zoom?: number; fit?: true | Placed<unknown> | Placed<unknown>[]; duration?: number }): Step
  /** Move the 2D camera (2 s): frame a 2D object (or a list) and follow it (margin = the room round it as a factor of its size, default 1.3: 1 fits it edge to edge, 2 leaves it half the window), a point [x, y] with { zoom } (0.25 to 8), a rectangle such as s.area(), or null for the whole frame. Beside a 3D panel the 2D camera looks through the rest of the frame: the target is fitted into that part and nothing is pushed over the panel. Objects marked m.hud(), and objects placed on a 3D part, stay put. */
  zoom(target: Placed<unknown> | Placed<unknown>[] | readonly number[] | { x?: number; y?: number; width: number; height: number } | string | null, opts?: { zoom?: number; margin?: number; duration?: number; rate?: RateFn }): Step
  /** Text for read mode only (markdown): extra depth or a formula beside this step's narration. Takes no time, draws nothing on stage. */
  note(markdown: string): Step
  /** Make hidden objects appear (quick fade). */
  show(...objects: (Placed<unknown> | string)[]): Step
  /** Make objects disappear (quick fade). */
  hide(...objects: (Placed<unknown> | string)[]): Step
  /** Speed of simulation time s.t() during this step: st.clock({ speed: 0.25 }) or st.clock({ freeze: true }). */
  clock(opts: { speed?: number; freeze?: boolean }): Step
}

/** The scene module: export default scene({ title: 'How X works' }, s => { … }). defaults: settings of this scene, nested or dotted ({ pace: { play: 1.5 } }; keys in docs/CONFIG.md). */
declare function scene(opts: { title: string; subtitle?: string; defaults?: Record<string, unknown> }, build: (s: Scene) => void): unknown

/** Blend two colours (squared RGB): mix(BLUE, RED, 0.5). */
declare function mix(c1: Color, c2: Color, u: number): Color
/** A colour scale: ramp([BLUE_E, GREEN, YELLOW, RED])(u) with u in 0..1. */
declare function ramp(colors: readonly Color[]): (u: number) => Color

/** Play together. */
declare function all(...anims: (Anim | Anim[])[]): Anim
/** Play one after the other. */
declare function seq(...anims: (Anim | Anim[])[]): Anim
/** Staggered start: each begins lag × (previous duration) after the one before (default lag 0.1). */
declare function lagged(anims: Anim[], opts?: { lag?: number }): Anim

/** Frame size in units: 14.2222 × 8, origin at the centre, y up. Keep content within x ±6.6, y ±3.5. */
declare const FRAME_W: number
declare const FRAME_H: number
/** Direction vectors. */
declare const UP: Vec3
declare const DOWN: Vec3
declare const LEFT: Vec3
declare const RIGHT: Vec3
declare const UL: Vec3
declare const UR: Vec3
declare const DL: Vec3
declare const DR: Vec3
declare const FRONT: Vec3
declare const BACK: Vec3
declare const ORIGIN: Vec3

/** Rate functions (easing). `smooth` is the default; `linear` for sweeps; `thereAndBack` for pulses. */
declare const linear: RateFn
declare const smooth: RateFn
declare const rushInto: RateFn
declare const rushFrom: RateFn
declare const slowInto: RateFn
declare const doubleSmooth: RateFn
declare const thereAndBack: RateFn
declare const lingering: RateFn
/** Up, hold at 1 for pauseRatio of the time, back down. */
declare function thereAndBackWithPause(t: number, pauseRatio?: number): number
/** Backs up a little first, then goes. */
declare function runningStart(t: number, pull?: number): number
/** Passes the target (to about 1.2) and settles back. */
declare function overshoot(t: number, pull?: number): number
/** A there-and-back pulse that swings from side to side; ends where it began. */
declare function wiggle(t: number, wiggles?: number): number
/** Fast at first, then ever slower: 1 - e^(-t / halfLife). */
declare function exponentialDecay(t: number, halfLife?: number): number
/** Stop at a share of the way: notQuiteThere(smooth, 0.7). */
declare function notQuiteThere(f?: RateFn, proportion?: number): RateFn
/** Run f only inside [a, b] of the time. */
declare function squish(f: RateFn, a?: number, b?: number): RateFn
/** A rate function from Bernstein control values: bezier([0, 0, 1, 1]). */
declare function bezier(points: readonly number[]): RateFn
/** manim's spellings of the rate functions above; the same functions under a second name (rush_into === rushInto). */
declare const rush_into: RateFn
declare const rush_from: RateFn
declare const slow_into: RateFn
declare const double_smooth: RateFn
declare const there_and_back: RateFn
declare function there_and_back_with_pause(t: number, pauseRatio?: number): number
declare function running_start(t: number, pull?: number): number
declare function exponential_decay(t: number, halfLife?: number): number
declare function not_quite_there(f?: RateFn, proportion?: number): RateFn
declare function squish_rate_func(f: RateFn, a?: number, b?: number): RateFn

/** Palette (the bare name is the _C shade; _A lightest … _E darkest). */
declare const BLUE: Color
declare const BLUE_A: Color
declare const BLUE_B: Color
declare const BLUE_C: Color
declare const BLUE_D: Color
declare const BLUE_E: Color
declare const TEAL: Color
declare const TEAL_A: Color
declare const TEAL_B: Color
declare const TEAL_C: Color
declare const TEAL_D: Color
declare const TEAL_E: Color
declare const GREEN: Color
declare const GREEN_A: Color
declare const GREEN_B: Color
declare const GREEN_C: Color
declare const GREEN_D: Color
declare const GREEN_E: Color
declare const YELLOW: Color
declare const YELLOW_A: Color
declare const YELLOW_B: Color
declare const YELLOW_C: Color
declare const YELLOW_D: Color
declare const YELLOW_E: Color
declare const GOLD: Color
declare const GOLD_A: Color
declare const GOLD_B: Color
declare const GOLD_C: Color
declare const GOLD_D: Color
declare const GOLD_E: Color
declare const RED: Color
declare const RED_A: Color
declare const RED_B: Color
declare const RED_C: Color
declare const RED_D: Color
declare const RED_E: Color
declare const MAROON: Color
declare const MAROON_A: Color
declare const MAROON_B: Color
declare const MAROON_C: Color
declare const MAROON_D: Color
declare const MAROON_E: Color
declare const PURPLE: Color
declare const PURPLE_A: Color
declare const PURPLE_B: Color
declare const PURPLE_C: Color
declare const PURPLE_D: Color
declare const PURPLE_E: Color
declare const GREY: Color
declare const GREY_A: Color
declare const GREY_B: Color
declare const GREY_C: Color
declare const GREY_D: Color
declare const GREY_E: Color
declare const WHITE: Color
declare const BLACK: Color
declare const PINK: Color
declare const LIGHT_PINK: Color
declare const ORANGE: Color
