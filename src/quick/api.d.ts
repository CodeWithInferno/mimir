/** A block of an explain() stage: what cells(), formula(), custom() … return. */
interface QuickBlock { readonly kind: string }
/**
 * A declarative scene: `stage` names the blocks, `story` is a list of steps or a generator that yields them,
 * `controls` are sliders. No positions, sizes, durations or cameras: explain({ title, stage: { row: cells([3, 8, 12]) }, story: [{ say: 'Three [values](row).' }] }).
 */
declare function explain(spec: {
  title?: string
  subtitle?: string
  controls?: Record<string, { from?: number; to?: number; value?: number; step?: number; unit?: string; label?: string; cyclic?: boolean; hidden?: boolean }>
  stage: Record<string, QuickBlock | Placed<unknown>>
  story: QuickStep[] | ((blocks: Record<string, any>) => Iterable<QuickStep>)
  layout?: Record<string, number>
}): unknown
/** One step of an explain() story. Every other key is the name of a block of the stage and holds what changes in it (or a list of changes, played one after the other). */
interface QuickStep { say?: string; set?: Record<string, number>; chapter?: string; note?: string; focus?: string | string[]; title?: string; [block: string]: unknown }
/** A row of values for algorithms: cells([3, 8, 12], { pointers: ['lo', 'hi'], index: true }). State: <pointer>: slot | null, lit / dim: [from, to], compare / swap: [i, j], insert: { at, value }, remove: i, found: i, done: i. Reads: row.value(i), row.length. */
declare function cells(values: (number | string)[], opts?: { pointers?: string[] | Record<string, number | null>; labels?: (string | number)[]; index?: boolean; style?: Record<string, unknown> }): QuickBlock
/** A typeset formula: formula('a^2 + b^2 = c^2'). State: highlight: 'c^2' (a term as written, or null), latex: '…' (the formula it becomes; shared terms glide). Link a term with [words](eq.c^2). */
declare function formula(latex: string, opts?: { colors?: Record<string, Color>; style?: Record<string, unknown> }): QuickBlock
/** A block built with the full API inside the rectangle the stage gives it: custom(({ area, s }) => circle({ radius: 1 }).at(area.center)). Return the object, or { root, targets, change, describe, api }. */
declare function custom(build: (ctx: { s: Scene; id: string; area: Area; rect: Area; control(name: string): Param<number> | undefined }) => unknown, prefer?: { aspect?: number; weight?: number; is3d?: boolean }): QuickBlock
/** A curve from its formula, as a list of points: curve((t) => [R * Math.cos(t), R * Math.sin(t)]). `t` makes one full turn in RADIANS (0 to 2π) unless `from` / `to` say otherwise; a full turn is a closed outline. Use it wherever points are taken: extrude(curve(…)), polygon(curve(…)), chart points. */
declare function curve(formula: (t: number) => readonly number[], opts?: { from?: number; to?: number; samples?: number; closed?: boolean }): number[][]
/** An outline from its radius at every angle (radians, one full turn): polar((a) => 1 + 0.2 * Math.cos(3 * a)). */
declare function polar(radius: (angle: number) => number, opts?: { from?: number; to?: number; samples?: number; closed?: boolean }): number[][]
/** The same outline `distance` further out all the way round (negative: further in). A wall is the curve and its outset: extrude(outset(chamber, 0.3), { holes: [chamber] }). */
declare function outset(points: readonly (readonly number[])[], distance: number): number[][]
/** An outline where a pose puts it: turned by `turn` DEGREES about its own origin, then moved to `at`. A pose is what a 'follows' joint answers: moved(rotor, pose(c)). */
declare function moved(points: readonly (readonly number[])[], pose: { at?: readonly number[]; turn?: number }): number[][]
/** The area an outline encloses. */
declare function areaOf(points: readonly (readonly number[])[]): number
/** The area between two stretches of curve that run between the same two meeting points (a chamber between a wall and a flank). */
declare function areaBetween(a: readonly (readonly number[])[], b: readonly (readonly number[])[]): number
/** The length of a curve; `closed: true` adds the way back to its start. */
declare function lengthOf(points: readonly (readonly number[])[], closed?: boolean): number
/** Register a kind of block for explain(): defineBlock({ kind: 'cells', example }). */
declare function defineBlock<T extends { kind: string }>(def: T): T
/** Named defaults of the stage, the story compiler and cells(). */
declare const STAGE_DEFAULTS: Record<string, number>
declare const STORY_DEFAULTS: Record<string, unknown>
declare const CELLS_DEFAULTS: Record<string, unknown>
declare const FORMULA_DEFAULTS: Record<string, unknown>
/** Defaults of sequence() used as a block of explain(). State: upTo: n (messages drawn), lost: n (that message stops short at a cross), retry: n (that message is marked as sent again). Links: [words](wire.client), [words](wire.m3). */
declare const SEQUENCE_DEFAULTS: Record<string, unknown>

// flow, chart, layers
/** The simulation of a flow(): every option has a named default (FLOW_JOBS). */
interface FlowJobs {
  /** How many jobs the sources send in all (default 20). */
  count?: number
  /** Seconds between two jobs, or [shortest, longest] drawn per job (default 1). */
  every?: number | [number, number]
  /** Seconds a server works on one job (default [0.8, 1.2]); by node name to say which nodes are servers: { server: [0.9, 1.3], cache: 0.3 }. */
  service?: number | [number, number] | Record<string, number | [number, number]>
  /** Same seed, same run (default 1). */
  seed?: number | string
  /** Seconds a job takes along one link (default 0.8). */
  travel?: number
  /** First backoff of a failed job in seconds (default 1) and the factor it grows by per failure (default 2). */
  backoff?: number
  factor?: number
  /** Failures after which a job is dead when no `-Nx->` link says so (default 3). */
  retries?: number
}
/** What a step can tell a flow block: `system: { crash: 'worker3', until: 30 }`. */
interface FlowChange {
  /** Run the block's clock to this many seconds, or to 'end' (every job done or dead). */
  until?: number | 'end'
  /** Take a node down now (a replicated name means all of them), or for some seconds: { node: 'worker3', for: 8 }. */
  crash?: string | string[] | { node: string; for?: number }
  /** Bring a node back. */
  recover?: string | string[]
  /** Send this many extra jobs that fail at every server. */
  poison?: number
  /** Jobs per second the sources send from now on. */
  rate?: number
  /** 'conservation': the counts become in = done + queued + in flight + dead. */
  show?: 'conservation'
  /** By hand, for a system without jobs: move one job along a route, 'client -> server1 -> cache'. */
  send?: string | string[]
  /** By hand: set the state of a node. */
  busy?: string | string[]
  fail?: string | string[]
  idle?: string | string[]
}
/**
 * A system diagram that runs, from one line: flow('producer -> queue[8] -> worker*3 -> database; worker -fail-> retry -> queue; retry -3x-> dead letters', { jobs: { count: 40, every: 0.5 } }).
 * name[8] = a queue with 8 slots, name*3 = three replicas (name1 … name3), -label-> = a labelled link (-fail-> where failed jobs go, -3x-> the exit after 3 failures, -miss 35%-> a share of the jobs), ; separates chains; or { nodes, links }.
 * Link targets: every node (system.queue, system.worker2), a link (system.queue->worker1), the counts (system.in, .done, .queued, .inFlight, .dead). In a generator story: system.count(name), system.depth(node), system.end().
 */
declare function flow(system: string | { nodes?: Record<string, string | { label?: string; slots?: number; replicas?: number }>; links?: [from: string, to: string, label?: string][] }, options?: { jobs?: FlowJobs; direction?: 'right' | 'down'; look?: Record<string, unknown> }): QuickBlock

/** One axis of a chart(): its name ('time'), a range ([0, 10]), the name of a control (the axis spans it and the cursor follows it), or both: { name: 'weight', range: [-2, 6] }. */
type ChartAxis = string | readonly number[] | { name?: string; range?: readonly number[] }
/** What a step can tell a chart block: `height: { mark: [90, 'half way'] }`. */
interface ChartChange {
  /** Fade curves in or out, by name ('curve', 'points', a key of `curves`, the name that is followed). */
  show?: string | string[]
  hide?: string | string[]
  /** A dashed line and a name at an x: mark: 90 or mark: [90, 'half way']. */
  mark?: number | [number, string]
  /** A bracket under the axis: band: [2, 5, 'overload']. */
  band?: [number, number, string?]
  /** The tangent of the first curve at an x (null removes it). */
  tangentAt?: number | null
  /** Draw the function curves only up to this x. */
  drawTo?: number
}
/**
 * A plot by names, not places: chart({ x: 'time', y: 'queue depth', follow: 'system.queue' }) · chart({ x: [-3, 3], y: 'loss', curve: (w) => w * w }).
 * A curve is y = f(x) (or (x, { control, block }) => y); points are [x, y] pairs or ({ control, block }) => pairs, read every frame so they follow the controls; follow plots a number of another block over its clock ('system.queue', 'system.done', 'net.error').
 * Ticks, ranges (fitted at every control's extremes) and labels are automatic. Link targets: the curves by name, 'cursor', 'tangent', 'mark1' …
 */
declare function chart(options?: { x?: ChartAxis; y?: ChartAxis; curve?: unknown; curves?: Record<string, unknown>; points?: unknown; follow?: string | string[]; cursor?: string | false; look?: Record<string, unknown> }): QuickBlock

/** What a step can tell a layers block: `net: { pulse: true }`. */
interface LayersChange {
  /** A trained network: go to this round of training, or to 'end'. */
  round?: number | 'end'
  /** One forward pass: a signal runs along every link, layer by layer. */
  pulse?: boolean
  /** Dim everything except one node ('2.1' = layer 2, node 1, counted from 1) or one link ('1.2-2.1'); null clears it. */
  focus?: string | null
  /** New values and / or weights for a network that is not trained; the picture blends to them. */
  set?: { values?: unknown; weights?: unknown }
}
/**
 * A layered network: layers({ sizes: [2, 3, 1], inputs: ['sun', 'wind'], outputs: ['beach day?'], feed: ['sun', 'wind'], train: { data, rate: 3, rounds: 300 } }).
 * Brightness and link colour / width come from `values` and `weights` (lists or functions), or from a network that is really trained on `train.data` ([{ x: [inputs], y: target }], or (random) => such a list) by gradient descent; `feed` names the controls that drive its inputs.
 * Link targets: nodes 'net.2.1', links 'net.1.2-2.1'. A chart follows 'net.error'.
 */
declare function layers(options: { sizes: readonly number[]; values?: unknown; weights?: unknown; inputs?: readonly string[]; outputs?: readonly string[]; names?: readonly string[]; train?: { data: unknown; rate?: number; rounds?: number; seed?: number | string }; feed?: readonly string[]; look?: Record<string, unknown> }): QuickBlock
/** Train a small network outside a block and read the recorded rounds: train({ sizes: [2, 3, 1], data, rate: 3, rounds: 300 }) → { history, errors, forward(net, x), at(round) }. */
declare function train(options: { sizes: readonly number[]; data: unknown; rate?: number; rounds?: number; seed?: number | string }): { rounds: number; history: unknown[]; errors: number[]; forward(net: unknown, x: readonly number[]): number[][]; at(round: number): unknown }

/** Named defaults of the flow, chart and layers blocks (overridden per block with `look`). */
declare const FLOW_BLOCK: Record<string, unknown>
declare const CHART_BLOCK: Record<string, unknown>
declare const LAYERS_BLOCK: Record<string, unknown>

// machine
// machine: a 3D machine for explain(): parts by name, joints that place and move them, everything else automatic.

/** What `by` may be: a control by name, a constant, or a pure function of the controls (c.turn) and the machine as it stands (m). */
type MachineDrive = string | number | ((c: Record<string, number>, m: MachineReader) => number)
/** A point of the machine: 'part' (its origin), 'part.anchor' (a kit anchor, or one named with part.define('axle', [x, y, z])), or [x, y, z]. */
type MachinePoint = string | readonly number[]
/** One line of `joints`: how a part relates to the others. Parts are placed in dependency order; a part in no joint sits at the origin and is reported. */
type MachineJoint =
  /** Turns about an axis ('z' by default) by degrees. at = where its origin sits (a point of another part, or [x, y, z]); pivot = one of its own points to turn about instead of its origin. */
  | [part: string, verb: 'spins', options: { about?: 'x' | 'y' | 'z' | readonly number[]; by: MachineDrive; at?: MachinePoint; pivot?: string }]
  /** Moves along an axis ('y' by default) by a distance. */
  | [part: string, verb: 'slides', options: { along?: 'x' | 'y' | 'z' | readonly number[]; by: MachineDrive }]
  /** Rigid: its origin (or its own point `my`) sits on a point of another part and turns with it; offset shifts it in the carrier's axes. */
  | [part: string, verb: 'on', carrier: string, options?: { my?: string; offset?: readonly number[] }]
  /** A link: its first end ('bigEnd' / 'start' / 'bottom') on one point, aimed at the other. */
  | [part: string, verb: 'between', from: MachinePoint, to: MachinePoint]
  /** A housing: placed round what it holds over its whole travel (a kit housing without a height takes it from that travel), and seen through when it would hide it. */
  | [part: string, verb: 'around', ...holds: string[]]
  /** A closed-form law: the pose as a pure function of the controls. turn is degrees about `about` ('z' by default). */
  | [part: string, verb: 'follows', law: (c: Record<string, number>, m: MachineReader) => { at?: readonly number[]; turn?: number; about?: 'x' | 'y' | 'z' | readonly number[] }]
  /** The part becomes a volume of gas. phase = 0..1 (cold to hot), a colour, or { color, temperature, density }; size = a size factor; from / to = two points it stands between (its height follows). */
  | [part: string, verb: 'gas', options: { phase?: (c: Record<string, number>, m: MachineReader) => number | Color | { color?: Color; temperature?: number; density?: number }; size?: (c: Record<string, number>, m: MachineReader) => number; from?: MachinePoint; to?: MachinePoint }]
  /** Particles streaming along a part (a pipe, a sweep) or through a list of points, while `when` is true (or 0..1). */
  | [path: string | MachinePoint[], verb: 'particles', options?: { when?: (c: Record<string, number>, m: MachineReader) => boolean | number; color?: Color }]
  /** A mechanism of the engine named by part names: crankSlider({ crank: 'crank', rod: 'rod', slider: 'piston', angle: 'crank' }), gearPair('a', 'b', { angle: 'turn' }), camFollower({ … }), belt('a', 'b'). angle = a control name or (c, m) => degrees. Its probes are '<mechanism>.<name>': 'crankSlider.fraction'. */
  | CrankSlider | GearPair | GearTrain | RackPinion | Planetary | CamFollower | Belt
/** The machine as it stands now, given to author functions as their second argument. */
interface MachineReader {
  /** World position of 'part' or 'part.anchor'. */
  point(ref: string): Vec3
  /** A world point seen from a part: in the part's own axes, from its origin. */
  local(part: string, point: readonly number[]): Vec3
  /** Distance between two points. */
  distance(a: MachinePoint, b: MachinePoint): number
  /** How far a part is turned about z, degrees (−180 … 180). */
  angle(part: string): number
  /** A probe by name (see MachineApi.probe). */
  probe(name: string): number
}
/** What a declared invariant measured: the largest residual over `samples` control values, where it was, and the limit (MACHINE_DEFAULTS.tolerance × the machine's size). */
interface MachineCheck { name: string; worst: number; at: Record<string, number>; limit: number; samples: number; ok: boolean }
/** What a story (and other blocks, such as a chart curve) can read from a machine: ({ engine }) => engine.probe('piston.y'). */
interface MachineApi {
  /** The part names. */
  parts: string[]
  /** A live number: 'part.x' | 'part.y' | 'part.z' | 'part.angle' | 'part.travel' (distance from where it starts), 'part.anchor.y', a name from `probes`, a mechanism's own ('crankSlider.fraction'); with two points, the distance between them: probe('crank.pin', 'piston.pin'). Also shown by `mimir check` / `mimir shot` as '<block>.<name>'. */
  probe(name: string, to?: string): () => number
  /** Declare an invariant: fn returns how far off the claim is (0 = it holds). Measured at once over every control, and verified again by `mimir check` (MECH-OPEN). */
  check(name: string, fn: (c: Record<string, number>, m: MachineReader) => number): MachineCheck | null
  /** The invariants declared so far, with what was measured. */
  checks(): MachineCheck[]
  /** World position of 'part' or 'part.anchor' now. */
  point(ref: string): Vec3
}
/** State of a machine that a step can change: `engine: { view: 'cutaway', camera: 'front' }`. Each change plays the engine's own transition. */
interface MachineState {
  /** How housings are drawn: 'solid', 'ghost' (x-ray shells), 'cutaway' (a section plane). 'exploded' is not available yet: it is reported and the view stays. */
  view?: 'solid' | 'ghost' | 'cutaway' | 'exploded'
  /** How far the machine is pulled apart, 0..1. Not available yet: anything above 0 is reported and ignored. */
  explode?: number
  /** 'iso' | 'front' | 'back' | 'side' | 'left' | 'right' | 'top' | 'bottom', or a part to look at. The camera frames the whole travel of the machine. */
  camera?: string
  /** A slow orbit: true (MACHINE_DEFAULTS.spinDegrees) or degrees. */
  spin?: boolean | number
  /** Parts to keep lit while the rest of this machine dims, for this step. */
  highlight?: string | string[] | null
  /** Parts to name for this step: ['rod'] (their names), or { rod: 'connecting rod' }. */
  label?: string[] | Record<string, string>
}
/** A 3D machine for explain(): `engine: machine({ parts: { crank: kit.crankshaft(), plate: extrude(outline, { depth: 0.2 }) }, joints: [['plate', 'spins', { by: 'turn' }]] })`. No positions, sizes, durations or cameras: the joints place and move every part, the camera fits the whole travel. */
declare function machine(options: {
  /** name → a kit part, or any 3D primitive / extrude / lathe / sweep. The names are what joints, narration ([rod](engine.rod)) and steps use. */
  parts: Record<string, Part>
  joints?: MachineJoint[]
  /** How housings start: default 'ghost' when a housing would hide what it holds, else 'solid'. */
  view?: 'solid' | 'ghost' | 'cutaway'
  /** The view the camera starts in (default 'iso'), or a part to look at. */
  camera?: string
  /** Display names of parts for labels: { rod: 'connecting rod' }. */
  labels?: Record<string, string>
  /** Named numbers of your own: { volume: (c, m) => … }, read with probe('volume'). */
  probes?: Record<string, (c: Record<string, number>, m: MachineReader) => number>
  /** Invariants: claim → how far off it is (0 = holds): { 'the pin stays in the slot': (c, m) => Math.abs(m.local('wheel', m.point('pin'))[1]) }. */
  checks?: Record<string, (c: Record<string, number>, m: MachineReader) => number>
}): unknown
/** The defaults of machine(), by name: view, camera, aspect, weight, sweepSamples, tolerance, housingMargin, housingSnap, fill, partFill, gasMinSize, spinDegrees, spinSeconds, cutAxis, particleCount, particleSpeed. */
declare const MACHINE_DEFAULTS: Record<string, number | string>
