// Shared by the core tests: build a scene from a builder function, with every seed module registered.
import { compile, scene, type SceneModel } from '../../../src/core/index.ts'
import '../../../src/r2d/index.ts'
import '../../../src/r3d/index.ts'
import '../../../src/anim/index.ts'
import '../../../src/guide/index.ts'

export function build(fn: (s: any) => void, title = 'test'): SceneModel {
  return compile(scene({ title }, fn))
}
export const codes = (m: SceneModel): string[] => m.diagnostics.list.map((d) => d.code)
export const near = (a: readonly number[], b: readonly number[], eps = 1e-9): boolean => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]!) <= eps)
