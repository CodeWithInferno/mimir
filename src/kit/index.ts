// Parts kit and mechanisms (pure side, main chunk): constructors, schemas, bounds, anchors, signed distances and the
// kinematics of the mechanisms. The meshes live in ./kit.chunk.ts (lazy chunk 'kit'); the MECH-OPEN rule in ./check.ts.
import { bearing, block, bolt, cam, camshaft, coil, conRod, crankshaft, fan, flywheel, gear, KIT, liner, pipe, piston, pulley, rack, shaft, spring, valve } from './parts.ts'
import { belt, camFollower, crankSlider, fourStroke, gearPair, gearTrain, planetary, rackPinion, valveLift } from './mechanisms.ts'

export * from './parts.ts'
export * from './mechanisms.ts'

/** The parts kit: every part is sized by a few real dimensions, comes with named anchors, and mates with the others at its defaults. */
export const kit = { gear, rack, shaft, bearing, spring, coil, piston, conRod, crankshaft, valve, cam, camshaft, pulley, flywheel, fan, pipe, bolt, liner, block, defaults: KIT }

/** On demand: this module's API is its own chunk (mimir.kitapi.js), loaded before a scene that uses one of its names. */
export const lazy = true
export const api = { kit, crankSlider, gearPair, gearTrain, rackPinion, planetary, camFollower, belt, valveLift, fourStroke }
