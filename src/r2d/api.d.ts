/** A rectangle of the frame: x, y is its lower left corner. s.area() and s.viewport() return one. */
interface FrameRect { x: number; y: number; width: number; height: number }
/** Setters of 2D objects (also under m.to for tweens). */
interface MobSetters<R> extends CommonSetters<R> {
  /** Fill colour and opacity: m.fill(BLUE, 0.2). */
  fill(c: Dyn<Color | null>, opacity?: Dyn<number>): R
  /** Outline colour and width (width 1 = 0.01 units; 2 is the default). */
  stroke(c: Dyn<Color | null>, width?: Dyn<number>): R
  /** Turn by degrees, counter-clockwise. */
  rotate(deg: Dyn<number>): R
  /** Move to an edge of the frame (or a corner: UL UR DL DR), `gap` away from it; the other axis stays where the object's placement puts it: title.toEdge('up'). */
  toEdge(dir?: Direction, gap?: Dyn<number>): R
  /** Line up one edge with the same edge of a target (an object, a point, or a rectangle such as s.area()), keeping the other axis: label.nextTo(box, 'down').alignTo(box, 'left'). */
  alignTo(target: PointLike | FrameRect | string, dir?: Direction): R
  /** Centre inside a rectangle (s.area('left'), s.viewport(), another object) and scale, keeping proportions, to be as large as fits: diagram.fit(s.area('left'), { padding: 0.3 }). */
  fit(target: FrameRect | Placed<unknown> | string, opts?: { padding?: number }): R
}
/** Tween builder: m.to.shift(1, 0).color(RED) is an Anim. */
interface MobTo extends MobSetters<MobTo>, Anim {}
/**
 * Everything a 2D object has, typed so that chaining keeps the object's own type: `interface Axes extends MobOf<Axes> { plot(fn: (x: number) => number): Mob }`.
 * A kind with tweenable setters of its own (defineKindSetter) names the type of its `to` as well:
 * `interface GaugeTo extends MobSetters<GaugeTo>, Anim { value(v: number): GaugeTo }` and `interface Gauge extends MobOf<Gauge, GaugeTo> { value(v: number): Gauge }`.
 */
interface MobOf<Self, To = MobTo> extends MobSetters<Self>, Placed<Self> {
  /** Tween to the state the chained setters describe: st.play(m.to.scale(1.2).color(YELLOW)). */
  readonly to: To
  /** Live points on the object's box. */
  readonly center: AnchorRef
  readonly top: AnchorRef
  readonly bottom: AnchorRef
  readonly left: AnchorRef
  readonly right: AnchorRef
  /** The corners of the box: upper left, upper right, lower left, lower right. */
  readonly ul: AnchorRef
  readonly ur: AnchorRef
  readonly dl: AnchorRef
  readonly dr: AnchorRef
  /** Ends of a line / arrow or of any open outline (left / right edge for closed shapes). */
  readonly start: AnchorRef
  readonly end: AnchorRef
  /** Live size in frame units. */
  readonly width: () => number
  readonly height: () => number
  /** A live point along the object's outline, by length (0 = start, 1 = end): along a line or an arrow, around a shape. */
  pointAt(alpha: Dyn<number>): () => Vec3
  /** Keep this object in screen space: the 2D camera (st.zoom) does not move or scale it. For titles and readouts. */
  hud(): Self
}
/** A 2D object in frame space (14.222 × 8, origin centre, y up). */
interface Mob extends MobOf<Mob> {}
/** The style options of every shape. `stroke: null` (the default) means "the outline has the shape's `color`": for a shape with no outline say `strokeWidth: 0`. */
interface ShapeStyle { id?: string; color?: Dyn<Color>; fill?: Dyn<Color | null>; fillOpacity?: Dyn<number>; stroke?: Dyn<Color | null>; strokeWidth?: Dyn<number>; dashed?: Dyn<boolean>; opacity?: Dyn<number> }

/** Named text sizes, largest first: 'hero' 90 · 'title' 72 · 'section' 60 · 'body' 48 (default) · 'label' 36 · 'note' 24 · 'tiny' 16 (manim font sizes; 48 is 0.48 units of em). */
type TextSize = number | 'hero' | 'title' | 'section' | 'body' | 'label' | 'note' | 'tiny'
/**
 * A label of at most ~4 words, in Computer Modern (sentences go to st.say). '\n' starts a new line. Text keeps its size on
 * screen when st.zoom moves in (scaleWithZoom: true makes it grow with the picture) and has a thin black outline behind it
 * so it reads over anything (backstroke: 0 removes it; dark text, which sits on something light, gets none). font: 'serif' (default) | 'math' (italic variables) | 'sans' | 'mono'.
 */
declare function text(str: Dyn<string | number>, opts?: { id?: string; size?: TextSize; color?: Dyn<Color>; weight?: 'normal' | 'bold'; italic?: boolean; font?: 'serif' | 'math' | 'sans' | 'mono'; align?: 'center' | 'left' | 'right'; backstroke?: number; scaleWithZoom?: boolean; opacity?: Dyn<number> }): Mob
/** Rectangle centred on its position; radius rounds the corners. */
declare function rect(opts?: ShapeStyle & { width?: Dyn<number>; height?: Dyn<number>; radius?: Dyn<number> }): Mob
/** Circle centred on its position. */
declare function circle(opts?: ShapeStyle & { radius?: Dyn<number> }): Mob
/** Ellipse centred on its position; radiusX and radiusY are its half width and half height. */
declare function ellipse(opts?: ShapeStyle & { radiusX?: Dyn<number>; radiusY?: Dyn<number> }): Mob
/** A small filled disc (radius 0.08). dot(point) sits on a point, an object or an anchor (box.top) and follows it; dot() is placed like any object. */
declare function dot(at?: PointLike, opts?: { id?: string; radius?: Dyn<number>; color?: Dyn<Color>; stroke?: Dyn<Color | null>; strokeWidth?: Dyn<number>; opacity?: Dyn<number> }): Mob
declare function dot(opts?: { id?: string; radius?: Dyn<number>; color?: Dyn<Color>; stroke?: Dyn<Color | null>; strokeWidth?: Dyn<number>; opacity?: Dyn<number> }): Mob
/** An open line through points. Points are relative to the object's own position: frame coordinates until you place it with .at(x, y). */
declare function polyline(points: PointLike[], opts?: ShapeStyle): Mob
/** A closed shape through points (3 or more). Points are relative to the object's own position: frame coordinates until you place it with .at(x, y). */
declare function polygon(points: PointLike[], opts?: ShapeStyle): Mob
/** Any outline, written like an SVG path in frame units with y up, relative to the object's position: path('M 0 0 C 1 2, 3 2, 4 0'). yDown: true reads data copied from an SVG file. */
declare function path(d: string, opts?: ShapeStyle & { yDown?: boolean }): Mob
/** Part of a circle around its position, from one angle to another in degrees (0 = right, counter-clockwise). m.start and m.end are its ends. */
declare function arc(opts?: ShapeStyle & { radius?: Dyn<number>; from?: Dyn<number>; to?: Dyn<number> }): Mob
/** A curly brace along one side of an object, which it follows: brace(row, 'down'). Label it with text(…).nextTo(theBrace, 'down'). Extra anchor: 'tip'. */
declare function brace(target: Placed<unknown> | string, direction?: 'down' | 'up' | 'left' | 'right', opts?: { id?: string; gap?: Dyn<number>; depth?: Dyn<number>; color?: Dyn<Color>; opacity?: Dyn<number> }): Mob
/** Line between two points. An end given as an OBJECT stops at its edge; a point or anchor (box.right) is used exactly. bend = degrees of arc. */
declare function line(a: PointLike, b: PointLike, opts?: { id?: string; color?: Dyn<Color>; strokeWidth?: Dyn<number>; dashed?: Dyn<boolean>; bend?: Dyn<number>; buff?: number; opacity?: Dyn<number> }): Mob
/** Arrow from a to b (same end rules as line). bend = degrees of arc; both: true puts a head on each end; head scales the heads (1 = default). */
declare function arrow(a: PointLike, b: PointLike, opts?: { id?: string; color?: Dyn<Color>; strokeWidth?: Dyn<number>; dashed?: Dyn<boolean>; bend?: Dyn<number>; both?: Dyn<boolean>; head?: Dyn<number>; buff?: number; opacity?: Dyn<number> }): Mob
/** One object that is placed, moved and faded as a unit (2D or 3D, by its children). */
declare function group<T extends Mob | Part>(children: T[]): T
/** Lay objects out left → right with a gap, centred on the row's position. */
declare function row(items: Mob[], opts?: { id?: string; gap?: Dyn<number>; align?: 'center' | 'top' | 'bottom' }): Mob
/** Lay objects out top → bottom with a gap. */
declare function column(items: Mob[], opts?: { id?: string; gap?: Dyn<number>; align?: 'center' | 'left' | 'right' }): Mob
/** Lay objects out in rows of `columns` (reading order), each column as wide as its widest item, centred on the grid's position. */
declare function grid(items: Mob[], opts?: { id?: string; columns?: number; gap?: Dyn<number>; align?: 'center' | 'left' | 'right' | 'top' | 'bottom' }): Mob
/** Lay objects out evenly on a circle around the ring's position, the first at startAngle (degrees, 90 = top), clockwise. Without a radius the circle is as small as the items allow. */
declare function ring(items: Mob[], opts?: { id?: string; radius?: Dyn<number>; gap?: Dyn<number>; startAngle?: Dyn<number>; clockwise?: boolean }): Mob
