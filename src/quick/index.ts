// Quick scenes: explain(spec) and its blocks (docs/QUICK.md). An author writes a short declarative script: which
// blocks are on stage and what the story says and changes. The stage arranges, the story compiler paces, every block
// turns a change of state into motion. This file only assembles the module: each block lives in its own file, calls
// defineBlock() for its kind and is listed here once (its constructor and its table of named defaults).
import { explain, STORY_DEFAULTS } from './story.ts'
import { STAGE_DEFAULTS } from './stage.ts'
import { custom, defineBlock } from './block.ts'
import { cells, CELLS_DEFAULTS } from './cells.ts'
import { formula, FORMULA_DEFAULTS } from './formula.ts'
import { SEQUENCE_DEFAULTS } from './sequence.ts'
import { flow as flowBlock, FLOW_BLOCK } from './flow.ts'
import { chart, CHART_BLOCK } from './chart.ts'
import { layers, train, LAYERS_BLOCK } from './layers.ts'
import { machine, MACHINE_DEFAULTS } from './machine.ts'
import { flowSystem } from '../flow/index.ts'

export * from './block.ts'
export * from './stage.ts'
export * from './story.ts'
export * from './cells.ts'
export * from './formula.ts'
export * from './sequence.ts'
export { flow as flowBlock, shapeOf, FLOW_BLOCK, type FlowOptions, type FlowState, type FlowChange } from './flow.ts'
export * from './chart.ts'
export * from './layers.ts'
export { machine, MACHINE_DEFAULTS, VIEW_MODES, type MachineState, type MachineReader, type ViewMode } from './machine.ts'

// `flow` is ONE name for the author: the flow module's flow(path) hands a system ('a -> b -> c', { nodes, links }) to this block
flowSystem.make = (system, options) => flowBlock(system, options as never)
// the kinds these constructors make, for did-you-mean (cells, formula, sequence and custom register themselves)
defineBlock({ kind: 'flow', example: "flow('client -> queue[6] -> worker*2 -> database', { jobs: { count: 30 } })" })
defineBlock({ kind: 'chart', example: "chart({ x: 'time', y: 'queue depth', follow: 'system.queue' })" })
defineBlock({ kind: 'layers', example: 'layers({ sizes: [2, 3, 1] })' })
defineBlock({ kind: 'machine', example: "machine({ parts: { arm: box() }, joints: [['arm', 'spins', { by: 'turn' }]] })" })

/** On demand: this module's API is its own chunk (mimir.quickapi.js), loaded before a scene that uses one of its names. */
export const lazy = true
// `sequence` and `flow` are not listed: each is one name the engine already has. sequence() (the diagram module) is
// adopted as a block when it stands in a stage; flow() (the flow module) returns this module's block for a system.
// shapes from maths: an outline is a formula (pure helpers; nothing here draws)
import { areaBetween, areaOf, curve, lengthOf, moved, outset, polar } from '../lib/curves.ts'
export { areaBetween, areaOf, curve, lengthOf, moved, outset, polar, CURVE_SAMPLES, FULL_TURN, type CurveOptions } from '../lib/curves.ts'
export const api = { explain, cells, formula, custom, chart, layers, train, machine, defineBlock, curve, polar, outset, moved, areaOf, areaBetween, lengthOf, STAGE_DEFAULTS, STORY_DEFAULTS, CELLS_DEFAULTS, FORMULA_DEFAULTS, SEQUENCE_DEFAULTS, FLOW_BLOCK, CHART_BLOCK, LAYERS_BLOCK, MACHINE_DEFAULTS }
