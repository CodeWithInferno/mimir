/**
 * solids: pure geometry for the 3D checks (FLOATING, INTERPENETRATE, CONTAINED, COINCIDENT, MECH-OPEN, CAMERA-CLIP).
 * No DOM, no three.js, no runtime APIs. Vectors are plain arrays, matrices are column-major number[16], angles are degrees.
 *
 * Typical use:
 *   const piston = primitiveProxy('piston', { kind: 'cylinder', radius: 0.4, height: 0.6 }, mat4Compose({ position: [0, 1, 0] }))
 *   const liner  = primitiveProxy('liner',  { kind: 'tube', radius: 0.5, thickness: 0.08, height: 2 })
 *   penetration(piston, liner)            // null, or { depth, point, fractionInside, fractionInsideOther }
 *   gap(piston, liner)                    // clearance in world units, 0 when touching
 *   floaters([piston, liner], ['liner'])  // detached groups with their span and nearest part
 */
export type { Axis, AxisAngle, Mat4, TransformParts } from './mat4.ts'
export {
  mat4AlignY, mat4Compose, mat4Copy, mat4FromAxisAngle, mat4FromEuler, mat4FromScale, mat4FromTranslation, mat4Identity,
  mat4Invert, mat4Multiply, mat4Position, mat4Scale, transformDirection, transformPoint, transformVector,
} from './mat4.ts'

export type { Shape } from './sdf.ts'
export {
  sdfBox, sdfCapsule, sdfCone, sdfCylinder, sdfSphere, sdfTorus, sdfTube, shapeBounds, shapeMinExtent, shapeSdf, shapeVolume,
} from './sdf.ts'

export type { MeshData } from './mesh.ts'
export {
  meshArea, meshBounds, meshData, meshDistance, meshIsClosed, meshSdf, meshSignedDistance, meshVolume, pointInMesh,
} from './mesh.ts'

export type { Proxy, Proxy as SolidProxy, ProxyOptions } from './proxy.ts'
export {
  mateResidual, meshProxy, minExtent, primitiveProxy, sdfProxy, span, unionBounds, withWorld, worldBounds,
} from './proxy.ts'

export { DEFAULT_SAMPLES, localSurfaceSamples, surfaceSamples } from './sample.ts'

export type { Nearest, Penetration, QueryOptions } from './query.ts'
export { closestSurfacePoint, coincident, contained, gap, iou, nearest, penetration, signedDistance, touching } from './query.ts'

export type { ContactGraph, Floater, FloaterOptions } from './graph.ts'
export { axisLabel, contactGraph, floaters } from './graph.ts'
