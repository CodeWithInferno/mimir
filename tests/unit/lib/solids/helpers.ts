/** Shared builders for the solids tests (test-only: three.js is used here purely as an independent oracle). */
import type { BufferGeometry } from 'three'
import type { Vec3 } from '../../../../src/lib/types.ts'
import {
  type MeshData, type Proxy, type Shape, type TransformParts,
  mat4Compose, mat4Multiply, meshData, primitiveProxy, withWorld,
} from '../../../../src/lib/solids/index.ts'

/** Deterministic pseudo-random floats in [0, 1) for test inputs. */
export function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
}

export const box = (id: string, width: number, height: number, depth: number, parts: TransformParts = {}): Proxy =>
  primitiveProxy(id, { kind: 'box', width, height, depth }, mat4Compose(parts))
export const sphere = (id: string, radius: number, parts: TransformParts = {}): Proxy =>
  primitiveProxy(id, { kind: 'sphere', radius }, mat4Compose(parts))
export const cylinder = (id: string, radius: number, height: number, parts: TransformParts = {}): Proxy =>
  primitiveProxy(id, { kind: 'cylinder', radius, height }, mat4Compose(parts))
export const tube = (id: string, radius: number, thickness: number, height: number, parts: TransformParts = {}): Proxy =>
  primitiveProxy(id, { kind: 'tube', radius, thickness, height }, mat4Compose(parts))
export const prim = (id: string, shape: Shape, parts: TransformParts = {}): Proxy => primitiveProxy(id, shape, mat4Compose(parts))

/** One of every primitive, with awkward (non-round) sizes. */
export const ALL_SHAPES: Shape[] = [
  { kind: 'box', width: 1.3, height: 0.7, depth: 2.1 },
  { kind: 'sphere', radius: 0.9 },
  { kind: 'cylinder', radius: 0.6, height: 1.7 },
  { kind: 'cone', radius: 0.8, height: 1.5 },
  { kind: 'cone', radius: 0.8, height: 1.1, topRadius: 0.3 },
  { kind: 'torus', radius: 1.1, tube: 0.25 },
  { kind: 'tube', radius: 0.9, thickness: 0.2, height: 1.4 },
  { kind: 'capsule', radius: 0.4, height: 2.2 },
]

/** Moves every proxy by the same rigid transform (answers must not change). */
export function moved(proxies: Proxy[], parts: TransformParts): Proxy[] {
  const t = mat4Compose(parts)
  return proxies.map(p => withWorld(p, mat4Multiply(t, p.world)))
}

/** Closed box mesh: 8 shared vertices, 12 outward-facing triangles. */
export function boxMesh(width: number, height: number, depth: number): MeshData {
  const x = width / 2, y = height / 2, z = depth / 2
  const positions = [-x, -y, -z, x, -y, -z, x, y, -z, -x, y, -z, -x, -y, z, x, -y, z, x, y, z, -x, y, z]
  const indices = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]
  return { positions, indices }
}

/** three.js geometry -> MeshData (keeps its duplicated seam vertices, exactly what the renderer will hand over). */
export function fromGeometry(geometry: BufferGeometry): MeshData {
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  const positions = Array.from(position.array as ArrayLike<number>)
  const indices = index ? Array.from(index.array as ArrayLike<number>) : positions.map((_, i) => i).slice(0, positions.length / 3)
  return meshData(positions, indices)
}

export const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
