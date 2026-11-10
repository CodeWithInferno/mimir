/**
 * Pure layout algorithms: no DOM, no three.js, sizes come in as numbers and centres come out.
 * Frame space (y up) is the default everywhere; functions that care which way is up take `yDown: true`.
 * Same input, same output: nothing here reads a clock or Math.random.
 */
export type { Size } from './rect.ts'
export {
  rectArea, rectCenter, rectContains, rectDistance, rectFromCenter, rectFromPoints, rectInset, rectIntersection,
  rectIntersects, rectUnion, segmentIntersectsRect, segmentsCross,
} from './rect.ts'
export type { Align, ArrangeOptions, Arrangement, Direction, Fit, FitOptions, GridOptions, RingOptions } from './arrange.ts'
export { arrangeColumn, arrangeGrid, arrangeRing, arrangeRow, fitInto, nextTo } from './arrange.ts'
export type { EdgeRoute, GraphEdgeInput, GraphLayout, GraphLayoutInput, GraphNodeInput, NodePosition } from './graph.ts'
export { layoutGraph } from './graph.ts'
export type { TreeLayoutInput } from './tree.ts'
export { layoutTree } from './tree.ts'
export type { ForceLayoutInput, ForceNodeInput } from './force.ts'
export { forceLayout } from './force.ts'
export type { LabelAnchor, LabelSide, PlaceLabelsInput, PlacedLabel } from './labels.ts'
export { placeLabels } from './labels.ts'
