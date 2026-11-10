// The ambient evaluation context: which model is being built, which frame is being evaluated.
// Kept in its own module so every other core file can read it without import cycles.
import type { SceneModel } from './model.ts'
import type { Frame } from './frame.ts'
import type { StepRec } from './timeline.ts'
import type { MNode } from './node.ts'

export const ctx: {
  /** model that API calls register into (always set while a builder runs; created on demand otherwise) */
  model: SceneModel | null
  /** frame being evaluated: params, s.t(), part.world() read from it */
  frame: Frame | null
  /** step whose callback is running */
  step: StepRec | null
  /** true while a scene builder runs */
  building: boolean
  /** set while model.child() runs a constructor: the node being created is this part of that parent */
  child: { parent: MNode; name: string } | null
  /** factory installed by model.ts so that node/placement code can obtain the ambient model lazily */
  ensureModel: () => SceneModel
} = {
  model: null,
  frame: null,
  step: null,
  building: false,
  child: null,
  ensureModel: () => { throw new Error('mimir core not initialised') },
}

export const currentModel = (): SceneModel => ctx.model ?? ctx.ensureModel()
