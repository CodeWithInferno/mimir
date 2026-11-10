// The defaults of plots, numbers and readouts. Shared by the pure side (schemas) and the drawing side.
import type { SceneModel } from '../core/index.ts'

/**
 * Every default that shapes a plot, in one place (frame units unless a comment says otherwise; stroke width 1 = 0.01
 * units, text sizes are the engine's font sizes: 48 = body). The values are those of the hand-built reference reel.
 * The ones an author is likely to change are options of the constructors (`color`, `strokeWidth`, `tickLabelSize`,
 * `labelSize`, `radius`, `samples` …) and default to these.
 */
export const PLOT = {
  /** axis lines, tick marks, axis labels */
  axisColor: '#BBBBBB',
  axisWidth: 2,
  /** how far an axis runs past the end of its range, before the arrow tip */
  overhang: 0.25,
  /** length and half-width of an arrow tip */
  tip: 0.11,
  tipHalf: 0.045,
  /** half-length of a tick mark (it crosses the axis) */
  tickLength: 0.05,
  tickLabelSize: 20,
  tickLabelColor: '#888888',
  /** gap between a tick mark and its label */
  tickLabelGap: 0.1,
  /** an automatic tick every so many units along x / along y, at most */
  tickSpacingX: 0.8,
  tickSpacingY: 0.75,
  /** free space kept between two neighbouring tick labels */
  tickLabelClearance: 0.18,
  labelSize: 24,
  labelGap: 0.13,
  gridColor: '#2B2B2B',
  gridWidth: 1,
  /** rows under the axis: marks, then brackets */
  rowGap: 0.12,
  markSize: 24,
  markColor: '#BBBBBB',
  bracketWidth: 1.6,
  /** how far the ends of a bracket turn up, and how far it stays clear of the values it spans */
  bracketHook: 0.07,
  bracketInset: 0.07,
  bracketLabelGap: 0.1,
  /** curves */
  curveWidth: 4,
  samples: 200,
  areaOpacity: 0.25,
  /** the moving point: radius, and the dark rim that separates it from a curve */
  dotRadius: 0.06,
  dotRim: 2.2,
  /** vline / hline / guide: a thin dashed tie */
  tieColor: '#BBBBBB',
  tieWidth: 1.5,
  tieOpacity: 0.66,
  tieDash: 0.052,
  /** a guide is drawn at tieOpacity too, but its dot on the model is not: it has to be found on a lit surface */
  guideColor: '#DDDDDD',
  guideDotRadius: 0.03,
  /** gap a guide keeps to an object it ends on */
  guideBuff: 0.03,
  trailWidth: 2,
  /** seconds between two samples of a trail (a fixed grid in story time) */
  trailStep: 1 / 30,
  /** bars and heat grids */
  barGap: 0.25,
  barOpacity: 0.85,
  /** opacity of what is not highlighted: shapes, and the text that belongs to them */
  dimmed: 0.35,
  dimmedText: 0.6,
  cellSize: 0.6,
  cellGap: 0.04,
  highlightColor: '#FFFF00',
  highlightWidth: 3,
  /** readouts */
  readoutLabelColor: '#BBBBBB',
  /** radius of the dot of a badge and its distance from the name, in em of the text */
  badgeDot: 0.2,
  badgeGap: 0.35,
  /** how far the y axis runs past the top of its name */
  labelClear: 0.1,
  /** the dark rim behind a tick number, as a share of its font size */
  backstroke: 0.22,
  /** outline of a bar */
  barStroke: 1.5,
  /** a cell of a heat grid: corner radius as a share of its side; a number inside takes at most this share of the side, and is this tall at most */
  cellRadius: 0.08,
  cellTextFit: 0.86,
  cellTextSize: 0.45,
  /** a cell lighter than this (relative luminance) gets dark numbers */
  cellLightAbove: 0.35,
} as const
/**
 * The defaults of this module as one scene sees them: `PLOT`, with whatever the engine's config store holds under
 * 'plot.<name>' (model.config('plot.<name>', fallback), when the core has one). Worked out once per scene.
 */
export const plotDefaults = (model: SceneModel): typeof PLOT => model.store<typeof PLOT>('plot.defaults', () => {
  const ask = (model as unknown as { config?: (key: string, fallback: unknown) => unknown }).config
  if (typeof ask !== 'function') return PLOT
  const out = { ...PLOT } as Record<string, unknown>
  for (const key of Object.keys(out)) { const v = ask.call(model, 'plot.' + key, out[key]); if (v !== undefined && typeof v === typeof out[key]) out[key] = v }
  return out as typeof PLOT
})

/**
 * How an object of this module arrives when it is drawn on (create / write), as shares 0..1 of its entrance: a pair
 * [start, end], or a start with a lag (how much later the last of a row starts than the first) and a span (how long
 * each one takes). The order is that of a hand-made animation: lines first, then what stands on them, names last.
 */
export const ENTER = {
  /** axes: the x axis runs out from the corner, the y axis follows, the grid fades in behind */
  xAxis: [0, 0.55],
  yAxis: [0.12, 0.67],
  grid: [0.2, 0.8],
  /** ticks and their numbers, left to right; a number travels tickShift units while it fades in */
  tickStart: 0.3,
  tickLag: 0.35,
  tickSpan: 0.3,
  tickShift: 0.15,
  /** the names of the axes */
  labelStart: 0.45,
  labelLag: 0.15,
  labelSpan: 0.4,
  /** what is plotted on a pair of axes that enters with it waits for this share of the entrance */
  afterAxes: 0.45,
  /** bars: the line they stand on, then each bar grows from it, left to right */
  barBase: [0, 0.4],
  barStart: 0.15,
  barLag: 0.45,
  barSpan: 0.4,
  /** heat grid: cells along the diagonals from the top left, then the names, then the outline */
  cellLag: 0.6,
  cellSpan: 0.4,
  cellLabels: [0.3, 0.9],
  cellMark: [0.7, 1],
} as const

/** the colours of a heat grid from its lowest to its highest value: dark to light on a black stage */
export const MATRIX_RAMP = ['#0E1A20', '#1C758A', '#58C4DD', '#C7E9F1']
