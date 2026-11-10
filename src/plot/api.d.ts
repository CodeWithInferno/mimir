/** Where the ticks of one axis go: a step (90), a list of values ([0, 90, 180]) or of [value, 'label'] pairs ([[3.14, 'π']]), or false for none. Left out: automatic. */
type Ticks = number | readonly (number | readonly (number | string)[])[] | false
/** A point of a plot in the plot's own units: [x, y]. */
type PlotPoint = readonly number[]
/** A function of x, a list of [x, y] points, or a function that returns such a list (data that changes). */
type PlotSource = ((x: number) => number) | readonly PlotPoint[] | (() => readonly PlotPoint[])
/** A rectangle of the frame; x, y is its lower left corner. s.area('right') returns one. */
interface FrameRect { x: number; y: number; width: number; height: number }
interface PlotCurveOptions {
  id?: string
  color?: Dyn<Color>
  /** Colour by segment: called with each point of the curve, which is cut exactly where the answer changes: colorAt: (x, y) => (y >= 0 ? BLUE : RED). */
  colorAt?: (x: number, y: number) => Color
  /** How many points a function is sampled at across the x range (default 200). */
  samples?: number
  /** Draw only from this x … */
  from?: Dyn<number>
  /** … up to this x. Give a param or a function and the curve draws on with it: to: () => angle(). */
  to?: Dyn<number>
  /** Width of the line (1 = 0.01 units; default 4). */
  strokeWidth?: Dyn<number>
  dashed?: Dyn<boolean>
  opacity?: Dyn<number>
}
interface PlotAreaOptions { id?: string; color?: Dyn<Color>; fillOpacity?: Dyn<number>; /** The y the region is filled from (default 0). */ baseline?: Dyn<number>; samples?: number; from?: Dyn<number>; to?: Dyn<number>; opacity?: Dyn<number> }
interface PlotLineOptions { id?: string; color?: Dyn<Color>; strokeWidth?: Dyn<number>; dashed?: Dyn<boolean>; /** Start and end along the other axis (default: right across the plot). With only `to`, the line starts on the axis: ax.vline(2, { to: () => f(2) }) drops a line from the curve. */ from?: Dyn<number>; to?: Dyn<number>; opacity?: Dyn<number> }
interface PlotDotOptions { id?: string; color?: Dyn<Color>; radius?: Dyn<number>; opacity?: Dyn<number> }
interface PlotMarkOptions { id?: string; color?: Dyn<Color>; size?: number | 'body' | 'label' | 'note' | 'tiny'; /** Also draw a dashed line through the plot at that value. */ line?: Dyn<boolean>; opacity?: Dyn<number> }
interface PlotBracketOptions { id?: string; color?: Dyn<Color>; size?: number | 'body' | 'label' | 'note' | 'tiny'; strokeWidth?: Dyn<number>; /** 0 = the first row of brackets under the axis, 1 = the row beneath it (a bracket around brackets). */ level?: number; opacity?: Dyn<number> }

/** What ax.to gives: the standard tweens plus fit. */
interface AxesTo extends MobSetters<AxesTo>, Anim {
  /** Tween into a rectangle of the frame: st.play(ax.to.fit(s.area('left'))). */
  fit(rect: FrameRect): AxesTo
}
/** A pair of axes. Everything plotted on it is added with its methods and stays tied to its ranges and size. */
interface Axes extends MobOf<Axes, AxesTo> {
  /** A curve: y = fn(x), or a line through points. With { to: param } it draws on up to that x. ax.plot((x) => Math.sin(x), { color: BLUE }). */
  plot(source: PlotSource, opts?: PlotCurveOptions): Mob
  /** The region between a function (or a line through points) and a baseline. ax.area((x) => f(x), { from: 0, to: () => t() }). */
  area(source: PlotSource, opts?: PlotAreaOptions): Mob
  /** A point at [x, y] that follows its value; hidden while outside the ranges. It is an object: tie a model to it with guide(part, dot). */
  dot(point: Dyn<PlotPoint>, opts?: PlotDotOptions): Mob
  /** A dashed vertical line at x: the cursor of a plot. ax.vline(() => angle()). */
  vline(x: Dyn<number>, opts?: PlotLineOptions): Mob
  /** A dashed horizontal line at y: a level, a threshold. */
  hline(y: Dyn<number>, opts?: PlotLineOptions): Mob
  /** The path a moving point has taken so far (or over the last `seconds`). ax.trail(() => [x(), y()]). */
  trail(point: () => PlotPoint, opts?: { id?: string; color?: Dyn<Color>; strokeWidth?: Dyn<number>; seconds?: Dyn<number>; opacity?: Dyn<number> }): Mob
  /** A name under the x axis at a value (the row under the tick labels). ax.mark(90, 'peak'). */
  mark(x: Dyn<number>, text: Dyn<string>, opts?: PlotMarkOptions): Mob
  /** A bracket under the x axis from x0 to x1 with a name beneath; the ends may move. ax.bracket(0, 360, 'one turn'). */
  bracket(x0: Dyn<number>, x1: Dyn<number>, text: Dyn<string>, opts?: PlotBracketOptions): Mob
  /** The point of the frame where a value of the plot is drawn, live: text('here').nextTo(ax.toFrame(90, 1), 'up'). */
  toFrame(x: Dyn<number>, y: Dyn<number>): () => Vec3
  toFrame(point: () => PlotPoint): () => Vec3
  /** Fill a rectangle of the frame, labels included (width and height are then ignored): ax.fit(s.area('right')). */
  fit(rect: FrameRect): Axes
}
/**
 * A pair of axes: thin lines with arrow tips, automatic ticks and numbers. `width` × `height` is the rectangle the two
 * ranges span, centred on the object's position, so two plots at the same height line up. axis: 'zero' puts the lines
 * through 0. Units are written after the tick numbers (xUnit: '°'); xScale / yScale: 'log' for a log axis.
 */
declare function axes(opts?: {
  id?: string; x?: Dyn<readonly number[]>; y?: Dyn<readonly number[]>; width?: Dyn<number>; height?: Dyn<number>
  xLabel?: Dyn<string>; yLabel?: Dyn<string>; xUnit?: Dyn<string>; yUnit?: Dyn<string>
  ticks?: false | { x?: Ticks; y?: Ticks }; xScale?: 'linear' | 'log'; yScale?: 'linear' | 'log'; axis?: 'edge' | 'zero'; grid?: Dyn<boolean>
  color?: Dyn<Color>; strokeWidth?: Dyn<number>; tickLabelSize?: number | 'label' | 'note' | 'tiny'; labelSize?: number | 'label' | 'note' | 'tiny'; opacity?: Dyn<number>
}): Axes

/** What line.to gives: the standard tweens plus fit. */
interface NumberLineTo extends MobSetters<NumberLineTo>, Anim { fit(rect: FrameRect): NumberLineTo }
/** A number line: one axis with ticks. */
interface NumberLine extends MobOf<NumberLine, NumberLineTo> {
  /** A point at a value that follows it; hidden while outside the range. */
  dot(value: Dyn<number>, opts?: PlotDotOptions): Mob
  /** A name under the line at a value. */
  mark(value: Dyn<number>, text: Dyn<string>, opts?: PlotMarkOptions): Mob
  /** A bracket under the line from one value to another, with a name beneath. */
  bracket(from: Dyn<number>, to: Dyn<number>, text: Dyn<string>, opts?: PlotBracketOptions): Mob
  /** The point of the frame where a value sits, live. */
  toFrame(value: Dyn<number>): () => Vec3
  /** Fill the width of a rectangle of the frame, centred in its height. */
  fit(rect: FrameRect): NumberLine
}
/** A number line from range[0] to range[1], `width` units long, with automatic ticks; `label` is written at its end. */
declare function numberLine(opts?: { id?: string; range?: Dyn<readonly number[]>; width?: Dyn<number>; ticks?: Ticks; unit?: Dyn<string>; label?: Dyn<string>; color?: Dyn<Color>; strokeWidth?: Dyn<number>; tickLabelSize?: number | 'label' | 'note' | 'tiny'; labelSize?: number | 'label' | 'note' | 'tiny'; opacity?: Dyn<number> }): NumberLine

/** A bar chart. */
interface Bars extends MobOf<Bars> {
  /** A live point on top of bar i (0 = the first): arrow(note, chart.bar(2)). */
  bar(index: Dyn<number>): () => Vec3
}
/**
 * Bars that follow their values: bars(() => counts(), { labels: ['a', 'b'], range: [0, 10] }). Give `range` when the
 * values move (without it the tallest bar always fills the height). `highlight` = the index of the bar to keep bright.
 */
declare function bars(values: Dyn<readonly number[]>, opts?: {
  id?: string; labels?: Dyn<readonly string[]>; width?: Dyn<number>; height?: Dyn<number>; range?: Dyn<readonly number[] | null>
  color?: Dyn<Color>; colors?: Dyn<readonly Color[]>; gap?: Dyn<number>; showValues?: Dyn<boolean>; decimals?: number; unit?: Dyn<string>
  highlight?: Dyn<number | null>; labelSize?: number | 'label' | 'note' | 'tiny'; opacity?: Dyn<number>
}): Bars

/** A grid of cells coloured by value. */
interface Matrix extends MobOf<Matrix> {
  /** A live point at the centre of a cell (row 0, column 0 = top left): arrow(note, grid.cell(1, 2)). */
  cell(row: Dyn<number>, column: Dyn<number>): () => Vec3
}
/**
 * A heat grid: matrix(rowsOfNumbers, { rows: ['a', 'b'], columns: ['x', 'y'], showValues: true }). Colours run along
 * `colors` from range[0] to range[1] (default: the smallest and largest value). highlight: { row: 1 } outlines a row,
 * { column: 0 } a column, both together one cell, and dims the rest.
 */
declare function matrix(values: Dyn<readonly (readonly number[])[]>, opts?: {
  id?: string; rows?: Dyn<readonly string[]>; columns?: Dyn<readonly string[]>; cellSize?: Dyn<number>; gap?: Dyn<number>; range?: Dyn<readonly number[] | null>
  colors?: Dyn<readonly Color[]>; showValues?: Dyn<boolean>; decimals?: number; highlight?: Dyn<{ row?: number | null; column?: number | null } | null>; highlightColor?: Dyn<Color>
  labelSize?: number | 'label' | 'note' | 'tiny'; opacity?: Dyn<number>
}): Matrix

/** What n.to gives: the standard tweens plus value. */
interface NumTo extends MobSetters<NumTo>, Anim {
  /** Count to a value: st.play(n.to.value(100)). */
  value(v: number): NumTo
}
/** A number on screen. */
interface Num extends MobOf<Num, NumTo> {
  /** Set the value (a number, or a function to follow); n.to.value(v) counts to it. */
  value(v: Dyn<number>): Num
}
/**
 * A number in tabular figures that follows its value and counts smoothly while it changes: num(() => speed(), { decimals: 1, unit: 'm/s' }).
 * It keeps room for the widest value of the story, so nothing beside it shifts. Without `decimals`: from the param's step, else 2.
 */
declare function num(value: Dyn<number>, opts?: { id?: string; decimals?: number; unit?: Dyn<string>; size?: number | 'hero' | 'title' | 'section' | 'body' | 'label' | 'note' | 'tiny'; color?: Dyn<Color>; weight?: 'normal' | 'bold'; align?: 'center' | 'left' | 'right'; opacity?: Dyn<number> }): Num
/** "name = value unit" on one line: readout('θ', angle, { unit: '°' }). The name holds still while the value counts; a text value is shown as it is. */
declare function readout(label: Dyn<string>, value: Dyn<number | string>, opts?: { id?: string; decimals?: number; unit?: Dyn<string>; size?: number | 'body' | 'label' | 'note' | 'tiny'; color?: Dyn<Color>; labelColor?: Dyn<Color>; opacity?: Dyn<number> }): Mob
/** The name of a state with a dot in that state's colour, for state machines: badge(() => phase(), { colors: { idle: GREY_B, running: GREEN, failed: RED } }). */
declare function badge(state: Dyn<string | number | boolean>, opts?: { id?: string; colors?: Record<string, Color>; color?: Dyn<Color>; size?: number | 'body' | 'label' | 'note' | 'tiny'; opacity?: Dyn<number> }): Mob
/**
 * A thin dashed tie between a point of a model and a point of a plot: guide(piston.anchor('top'), ax.dot(() => [angle(), height()])).
 * Either end is an object (the tie stops at its edge), an anchor, a point, or ax.toFrame(x, y); a 3D part is followed
 * where it is drawn. A first end that is a bare point or an anchor gets a small dot (dot: false to leave it out).
 */
declare function guide(from: PointLike, to: PointLike, opts?: { id?: string; color?: Dyn<Color>; strokeWidth?: Dyn<number>; dashed?: Dyn<boolean>; dot?: Dyn<boolean>; buff?: number; opacity?: Dyn<number> }): Mob
