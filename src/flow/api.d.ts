/** A list of points ([x, y] in 2D, [x, y, z] in 3D; objects and anchors such as tank.right count as points), an object to run along (a 2D object's outline, a 3D part's centre line), or a function that returns a list of points. */
type FlowPath = readonly PointLike[] | Placed<unknown> | (() => readonly (readonly number[])[])
/** Options of flow(). `along` is the position on the path, 0 at its start and 1 at its end. */
interface FlowOptions {
  id?: string
  /** How many particles (default 40). */
  count?: Dyn<number>
  /** Path units per second (default 1), or a function of the position along the path: speed: (along) => 1 / area(along). Particles then bunch up where the stream is slow, as a steady flow does. */
  speed?: number | ((along: number) => number)
  /** Diameter of a particle: frame units in 2D (default 0.08), world units in 3D (default 0.12). */
  size?: Dyn<number>
  /** One colour, or a function of the position along the path: color: (along) => heat(temperatureAt(along)). */
  color?: Color | ((along: number) => Color)
  /** How many whole trips the stream has made; replaces speed × time. Drive it from a mechanism: phase: () => crank() / 360. */
  phase?: Dyn<number>
  /** true / 1 = flowing, false / 0 = nothing; a number between fades the stream. active: () => valveLift() > 0. */
  active?: Dyn<boolean | number>
  /** Half the width of the stream across the path (default 0: single file), or a function of the position along it: spread: (along) => pipeRadius(along). */
  spread?: number | ((along: number) => number)
  /** Share of an open path over which particles appear at its start and vanish at its end (default 0.08). */
  fade?: Dyn<number>
  /** Strength of the soft halo around each particle, 0..1 (default 0.4). */
  glow?: Dyn<number>
  /** A streak behind each particle: the distance it travels in this many seconds (default 0), so faster particles draw longer streaks. Shows direction and speed in a still frame. */
  tail?: Dyn<number>
  /** Join the last point of a list to the first: the stream goes round and round. A closed shape is closed already. */
  closed?: boolean
  /** Travel from the end of the path to its start. */
  reverse?: Dyn<boolean>
  /** The clock the stream runs on, seconds (default s.t()). */
  time?: Dyn<number>
  /** Another seed gives another arrangement of the same stream (default 1). */
  seed?: number | string
  opacity?: Dyn<number>
}
/**
 * Particles streaming along a path: flow([[-4, 0], [4, 0]], { count: 60, speed: 1.5, spread: 0.4 }) · flow(wire) · flow(pipe3d, { color: BLUE }).
 * 2D when the path is 2D, 3D when it has z coordinates or is a 3D part. Each particle is a pure function of time: scrub anywhere.
 */
declare function flow(path: FlowPath, options?: FlowOptions): Mob & Part
/**
 * Particles thrown out from a point when something happens: burst(plug, { when: [2, 4.5], color: YELLOW }).
 * when = the time(s) it fires, in seconds of s.t() (a number, a list, or a function such as () => arrivals.entry().t); or progress = a number you drive from 0 to 1 over its life.
 * direction + cone (degrees) aim it; radius is how far the particles fly; duration is its life in seconds (default 0.8). 3D when the point is 3D.
 */
declare function burst(at: PointLike, options?: { id?: string; count?: Dyn<number>; color?: Dyn<Color>; size?: Dyn<number>; radius?: Dyn<number>; when?: Dyn<number | readonly number[]>; duration?: Dyn<number>; progress?: Dyn<number>; direction?: Dyn<readonly number[]>; cone?: Dyn<number>; glow?: Dyn<number>; time?: Dyn<number>; seed?: number | string; opacity?: Dyn<number> }): Mob & Part
/**
 * The line a moving point has drawn: trail((t) => [x(t), y(t)], { duration: 2 }). The function gives the point at simulation time t (three coordinates make a 3D trail).
 * duration = how many seconds of the past to keep (default: everything since `from`, 0); fade: false draws it at full strength; width 1 = 0.01 units in 2D, pixels in 3D.
 */
declare function trail(point: (t: number) => readonly number[], options?: { id?: string; duration?: Dyn<number>; from?: Dyn<number>; color?: Dyn<Color>; width?: Dyn<number>; fade?: Dyn<boolean>; every?: number; time?: Dyn<number>; opacity?: Dyn<number> }): Mob & Part
/**
 * A grid of arrows showing a 2D vector field: field((x, y) => [-y, x], { region: s.area(), density: 1.5 }).
 * region = { x, y, width, height } (x, y = the left bottom corner), an area from s.area(), or an object; density = arrows per unit; scale = length per unit of the field (default: the strongest arrow fills its cell).
 * color may be a function of the relative strength 0..1: color: (strength) => ramp([BLUE, YELLOW])(strength).
 */
declare function field(vector: (x: number, y: number) => readonly number[], options?: { id?: string; region?: { x: number; y: number; width: number; height: number } | Placed<unknown>; density?: Dyn<number>; color?: Color | ((strength: number) => Color); scale?: Dyn<number>; width?: Dyn<number>; time?: Dyn<number>; opacity?: Dyn<number> }): Mob
/**
 * Fill a shape up to a level 0..1: fillLevel(tank, { level: () => volume() / capacity, color: BLUE }).
 * Inside a 3D part the liquid can follow a moving part instead: fillLevel(barrel, { to: piston.anchor('bottom') }) is
 * the water under a piston, fillLevel(liner, { from: piston.anchor('top') }) the charge above it (gas() of that is a gas).
 * A 2D shape is filled inside its outline (from: 'bottom' | 'top' | 'left' | 'right'; surface: false hides the surface line); a 3D part gets a liquid body inside its walls (shape: 'box' | 'cylinder', default: what the part is; inset = wall thickness as a share of its smallest side).
 */
declare function fillLevel(shape: Placed<unknown> | string, options?: { id?: string; level?: Dyn<number>; color?: Dyn<Color>; opacity?: Dyn<number>; from?: 'bottom' | 'top' | 'left' | 'right' | PointLike; to?: PointLike; clear?: Dyn<number>; role?: 'fluid' | null; energy?: Dyn<number>; surface?: Dyn<boolean>; shape?: 'auto' | 'box' | 'cylinder'; inset?: Dyn<number>; material?: MaterialName | { color?: Color; metalness?: number; roughness?: number; opacity?: number; emissive?: number } }): Mob & Part
/**
 * Turn a 3D part into a volume of gas: gas(chamber, { density: () => 1 / volume(), temperature: () => heat() }).
 * The part becomes a glowing see-through body: its colour is `temperature` (0 cold … 1 hot) on the ramp (default 'temperature'; or give color yourself), its brightness is `density` (0 … 1), and the particles inside are squeezed with the part.
 * Make the chamber from the parts that bound it, e.g. between(piston.anchor('top'), head.anchor('bottom'), { radius }).
 */
declare function gas(volume: Part | string, options?: { id?: string; density?: Dyn<number>; temperature?: Dyn<number>; color?: Dyn<Color | null>; ramp?: 'temperature' | 'density' | 'speed' | 'pressure' | readonly Color[]; particles?: Dyn<number>; size?: Dyn<number>; agitation?: Dyn<number>; time?: Dyn<number>; seed?: number | string; opacity?: Dyn<number> }): Part
/**
 * A function from a value in real units to a colour: const heat = colorScale('temperature', { min: 300, max: 2500 }); then color: () => heat(T()).
 * The ramp is a name ('temperature' | 'density' | 'speed' | 'pressure') or a list of colours, low → high; values outside min..max take the end colours.
 */
declare function colorScale(ramp?: 'temperature' | 'density' | 'speed' | 'pressure' | readonly Color[], options?: { min?: number; max?: number }): (value: number) => Color
/** The named colour ramps, low → high, as lists of colours: ramp(RAMPS.temperature)(u). */
declare const RAMPS: { readonly temperature: readonly Color[]; readonly density: readonly Color[]; readonly speed: readonly Color[]; readonly pressure: readonly Color[] }
/** The default of every option of the flow module (count, speed, size, fade, glow, …), by name. */
declare const FLOW_DEFAULTS: Readonly<Record<string, unknown>>
