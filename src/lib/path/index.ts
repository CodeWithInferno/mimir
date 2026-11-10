/**
 * Pure 2D path maths for draw-on and morph animations (manim's ShowCreation / Transform).
 *
 * A path is `Subpath[]`. Each subpath is absolute cubic beziers in one flat array:
 *   coords = [x0, y0,  c1x, c1y, c2x, c2y, x1, y1,  c1x, c1y, c2x, c2y, x2, y2, …]   (2 + 6·n numbers, n curves)
 * A closed subpath ends exactly on its first point. Straight lines are cubics with handles at 1/3 and 2/3.
 * Nothing here throws on bad input or reads the clock, and nothing mutates its arguments except the optional
 * `out` buffer of morphAt. Angles are degrees.
 * Coordinates are whatever the caller uses; the shape builders assume the y-up frame.
 */
export type { Subpath } from './cubic.ts'
export { parsePath, validatePath, toPathString } from './parse.ts'
export { rectPath, circlePath, ellipsePath, polygonPath, polylinePath, arcPath, arrowPath } from './shapes.ts'
export type {
  RectPathOptions, CirclePathOptions, EllipsePathOptions, ArcPathOptions, ArrowPathOptions, ArrowPath,
} from './shapes.ts'
export { measurePath, pathLength, pointAt, trimPath, bounds, flattenPath, transformPath } from './measure.ts'
export type { PathMeasure, PathPoint, Matrix2D } from './measure.ts'
export { morphPlan, morphAt } from './morph.ts'
export type { MorphOptions, MorphPair, MorphPlan } from './morph.ts'
