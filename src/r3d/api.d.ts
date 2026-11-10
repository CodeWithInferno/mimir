/** A material preset: metals (steel aluminium iron brass copper), rubber plastic matte, see-through shells (glass ghost), and glow (unlit, blooms). */
type MaterialName = 'matte' | 'plastic' | 'rubber' | 'steel' | 'aluminium' | 'iron' | 'brass' | 'copper' | 'glass' | 'ghost' | 'glow'
/** What a part is in the assembly. It decides how a part without colour or material is drawn, and what ghost and cutaway do to it. */
type PartRole = 'housing' | 'moving' | 'static' | 'fastener' | 'fluid'
/** A list of points as plain arrays: [[0, 0], [2, 0], [2, 1]] (2D) or [[0, 0, 0], [0, 2, 0]] (3D). */
type PointList = readonly (readonly number[])[]
/** One of the three axes, or a vector. */
type Axis3 = 'x' | 'y' | 'z' | readonly number[]
/** Setters of 3D parts (also under p.to for tweens). */
interface PartSetters<R> extends CommonSetters<R> {
  /** Turn about an axis of the parent ('x' | 'y' | 'z' | [x, y, z]) by degrees; deg may be a function or a param. Different axes add up in call order. */
  rotate(spec: { about: Axis3; deg: Dyn<number> | Param<number> }): R
  /** Rest on top of another part, centred over it, boxes touching (+ gap): lid.on(box). */
  on(target: Placed<unknown> | string, gap?: Dyn<number>): R
  /** Hang directly below another part, centred under it, boxes touching (+ gap). */
  under(target: Placed<unknown> | string, gap?: Dyn<number>): R
  /** p.material('steel') or p.material({ color, roughness?, opacity?, emissive? }): roughness 0 = glossy, opacity below 1 = a see-through shell, emissive above 0 = it glows. */
  material(m: MaterialName | { color?: Color; metalness?: number; roughness?: number; opacity?: number; emissive?: number }): R
}
/** Tween builder: p.to.rotate({ about: 'y', deg: 90 }) is an Anim. */
interface PartTo extends PartSetters<PartTo>, Anim {}
/** Everything a 3D part has, typed so that chaining keeps the part's own type: `interface Gear extends PartOf<Gear> { teeth(): number }`. */
interface PartOf<Self, To = PartTo> extends PartSetters<Self>, Placed<Self> {
  /** Tween to the state the chained setters describe. */
  readonly to: To
  /** Where this part (or group) goes in an exploded view: along `axis` by `distance` (default: order x a share of the model's size); order 1 leaves first. false = it stays where it is. */
  explode(spec: { axis: Direction; distance?: number; order?: number } | false): Self
}
/** A 3D part in world space (y up). Anchors: center top bottom left right front back. */
interface Part extends PartOf<Part> {}
/** Look options of every 3D part. Without color and material a part is drawn by its role: housings dark, the mechanism light. */
interface PartLook {
  id?: string
  /** An accent: the part becomes a dark tinted body drawn in this colour's light. Keep to about three on screen. */
  color?: Dyn<Color>
  material?: MaterialName | { color?: Color; metalness?: number; roughness?: number; opacity?: number; emissive?: number }
  opacity?: Dyn<number>
  /** A housing: it encloses other parts on purpose, turns into an x-ray shell under ghost and focus, and is cut by a cutaway. */
  shell?: boolean
  /** Default: 'housing' for a shell, 'moving' for anything a param, a function, a play or a mate moves, else 'static'. Say 'fastener' for bolts and 'fluid' for a volume of gas or liquid. */
  role?: PartRole
  /** Only for role 'fluid': 0 = resting, 1 = burning (brighter, more light of its own, more bloom). May follow a function. */
  energy?: Dyn<number>
}

/** Sizes are full extents; every part is centred on its position. */
declare function box(opts?: PartLook & { width?: Dyn<number>; height?: Dyn<number>; depth?: Dyn<number> }): Part
/** A ball. */
declare function sphere(opts?: PartLook & { radius?: Dyn<number> }): Part
/** Axis along y. */
declare function cylinder(opts?: PartLook & { radius?: Dyn<number>; height?: Dyn<number> }): Part
/** Axis along y, base at the bottom; extra anchor 'tip'. */
declare function cone(opts?: PartLook & { radius?: Dyn<number>; height?: Dyn<number> }): Part
/** A ring lying flat (axis along y): radius to the middle of the ring, tube = its thickness radius. */
declare function torus(opts?: PartLook & { radius?: Dyn<number>; tube?: Dyn<number> }): Part
/** Hollow cylinder (pipe / sleeve), axis along y: outer radius, wall thickness, height. */
declare function tube(opts?: PartLook & { radius?: Dyn<number>; thickness?: Dyn<number>; height?: Dyn<number> }): Part
/** A flat outline of [x, y] points pushed through `depth` along z (centred on z = 0): plates, brackets, cams. holes = more outlines; bevel = a chamfer on both faces. Lay it flat with .rotate({ about: 'x', deg: 90 }). */
declare function extrude(profile: PointList, opts?: PartLook & { depth?: Dyn<number>; holes?: readonly PointList[]; bevel?: number }): Part
/** A profile of [radius, height] points turned about the y axis: pistons, bottles, pulleys. Start and end on the axis (radius 0) for a solid; run up the outside. */
declare function lathe(profile: PointList, opts?: PartLook & { segments?: number }): Part
/** A round tube of `radius` along a path of [x, y, z] points: pipes, wires, rails. bend = the corner radius (default twice the radius, 0 = sharp); closed joins the ends. Extra anchors 'start' and 'end'. */
declare function sweep(path: PointList, opts?: PartLook & { radius?: Dyn<number>; bend?: number | null; closed?: boolean; sides?: number }): Part
/** Raw triangles: positions as [x, y, z] points, indices as [a, b, c] triples counted from 0 (left out: every three points are one triangle). */
declare function mesh(opts: PartLook & { positions: PointList | readonly number[]; indices?: PointList | readonly number[] | null }): Part
/** A rod from a to b that follows both ({ radius }), or an existing part centred between them with its y axis from a to b ({ part }). */
declare function between(a: PointLike, b: PointLike, opts?: PartLook & { radius?: Dyn<number>; part?: Part }): Part
/** The copies made by repeat(): one group, with a slot per copy called `<id>.<i>`. */
interface Repeat extends PartOf<Repeat> {
  /** Arrange the copies evenly around an axis ('y' by default); copy 0 sits at `phase` degrees and the copies turn with their angle unless turn: false. radius and phase may be functions. */
  ring(opts: { radius: Dyn<number>; axis?: Axis3; phase?: Dyn<number>; turn?: boolean }): Repeat
  /** Arrange the copies in a row, `step` apart ([x, y, z], or a number along x), centred on the repeat unless centered: false. */
  line(opts: { step: Dyn<readonly number[] | number>; centered?: boolean }): Repeat
}
/** `count` parts, each made by the function from its index: repeat(8, (i) => box({ width: 0.2 })).ring({ radius: 2 }). Use i for a size, a colour, or a phase: rotate({ about: 'y', deg: () => spin() + i * 45 }). */
declare function repeat(count: number, make: (i: number, count: number) => Part | Part[]): Repeat

/** A section plane: everything beyond `at` along `axis` is removed ('x' | 'y' | 'z', or a vector that points at the half to remove). Housings, static parts, fasteners and fluids are cut and get hatched faces; moving parts stay whole. parts = cut exactly these instead. */
interface Cutaway { axis?: Axis3; at?: Dyn<number> | Param<number>; parts?: (Part | string)[] | null }
interface Scene {
  /** Housings and fasteners as x-ray shells from the start: s.ghost() or s.ghost(true); exactly these parts: s.ghost([block, head]); off: s.ghost(false). */
  ghost(parts?: true | false | Part | string | (Part | string)[]): void
  /** A cutaway from the start: s.cutaway({ axis: 'z', at: 0 }); `at` may be a param. false removes it. */
  cutaway(cut: Cutaway | false): void
  /** The assembly pulled apart from the start: 0 = assembled, 1 = fully apart; may be a param. Parts go where p.explode({ axis }) says, else away from the model's centre. */
  explode(amount: Dyn<number> | Param<number>): void
  /** Override defaults of the 3D look for this scene: s.look({ line: { sigma: 2 }, focus: { color: '#58C4DD' }, role: { housing: { base: '#2A3038' } } }). Sections: creaseDeg renderer light role stagger accent preset object line focus recede shell fluid cut glow explode enter hover detail camera. */
  look(overrides: Record<string, unknown>): void
}
interface Step {
  /** Fade housings and fasteners to x-ray shells (true), exactly these parts (a list), or back to solid (false). 1 s unless { duration }. */
  ghost(parts?: true | false | Part | string | (Part | string)[], opts?: { duration?: number; rate?: RateFn }): Step
  /** Sweep a section plane in from outside the model, on to another place, or out again (false). 2 s unless { duration }. */
  cutaway(cut: Cutaway | false, opts?: { duration?: number; rate?: RateFn }): Step
  /** Pull the assembly apart (1), part of the way (0..1) or put it back (0). 2 s unless { duration }. Follow it with st.camera({ fit: true }). */
  explode(amount: number, opts?: { duration?: number; rate?: RateFn }): Step
}
