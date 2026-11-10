import { describe, expect, test } from 'bun:test'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { Vec3 } from '../../../../src/lib/types.ts'
import {
  mat4AlignY, mat4Compose, mat4Copy, mat4FromAxisAngle, mat4FromEuler, mat4FromScale, mat4FromTranslation, mat4Identity,
  mat4Invert, mat4Multiply, mat4Position, mat4Scale, transformDirection, transformPoint, transformVector,
} from '../../../../src/lib/solids/index.ts'
import { lcg } from './helpers.ts'

const RAD = Math.PI / 180

function expectClose(actual: ArrayLike<number>, expected: ArrayLike<number>, eps = 1e-12): void {
  expect(actual.length).toBe(expected.length)
  for (let i = 0; i < expected.length; i++) expect(Math.abs((actual[i] as number) - (expected[i] as number))).toBeLessThan(eps)
}

describe('mat4', () => {
  test('identity, translation and scale use the three.js element layout', () => {
    expect(mat4Identity()).toEqual(new Matrix4().elements)
    expect(mat4FromTranslation([1, 2, 3])).toEqual(new Matrix4().makeTranslation(1, 2, 3).elements)
    expect(mat4FromScale([2, 3, 4])).toEqual(new Matrix4().makeScale(2, 3, 4).elements)
    expect(mat4FromScale(2)).toEqual(new Matrix4().makeScale(2, 2, 2).elements)
    expect(mat4Position(mat4FromTranslation([1, 2, 3]))).toEqual([1, 2, 3])
  })

  test('euler degrees match three.js Euler XYZ', () => {
    const random = lcg(1)
    for (let i = 0; i < 20; i++) {
      const x = random() * 720 - 360, y = random() * 720 - 360, z = random() * 720 - 360
      const expected = new Matrix4().makeRotationFromEuler(new Euler(x * RAD, y * RAD, z * RAD, 'XYZ')).elements
      expectClose(mat4FromEuler(x, y, z), expected)
    }
  })

  test('axis-angle matches three.js for named and arbitrary axes', () => {
    const random = lcg(2)
    for (let i = 0; i < 20; i++) {
      const axis: Vec3 = [random() - 0.5, random() - 0.5, random() - 0.5]
      const deg = random() * 720 - 360
      const expected = new Matrix4().makeRotationAxis(new Vector3(...axis).normalize(), deg * RAD).elements
      expectClose(mat4FromAxisAngle(axis, deg), expected)
    }
    expectClose(mat4FromAxisAngle('x', 33), new Matrix4().makeRotationX(33 * RAD).elements)
    expectClose(mat4FromAxisAngle('y', 33), new Matrix4().makeRotationY(33 * RAD).elements)
    expectClose(mat4FromAxisAngle('z', 33), new Matrix4().makeRotationZ(33 * RAD).elements)
  })

  test('quarter turns are exact (no 6e-17 leftovers)', () => {
    expect(mat4FromAxisAngle('z', 90).map(v => v + 0)).toEqual([0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    expect(mat4FromAxisAngle('x', -270).map(v => v + 0)).toEqual(mat4FromAxisAngle('x', 90).map(v => v + 0))
    expect(mat4FromEuler(180, 0, 90).every(v => Number.isInteger(v))).toBe(true)
  })

  test('compose = translate * rotate * scale, matching three.js compose', () => {
    const random = lcg(3)
    for (let i = 0; i < 20; i++) {
      const position: Vec3 = [random() * 10 - 5, random() * 10 - 5, random() * 10 - 5]
      const rotation: Vec3 = [random() * 360, random() * 360, random() * 360]
      const scale: Vec3 = [0.5 + random(), 0.5 + random(), 0.5 + random()]
      const q = new Quaternion().setFromEuler(new Euler(rotation[0] * RAD, rotation[1] * RAD, rotation[2] * RAD, 'XYZ'))
      const expected = new Matrix4().compose(new Vector3(...position), q, new Vector3(...scale)).elements
      expectClose(mat4Compose({ position, rotation, scale }), expected, 1e-11)
    }
    expectClose(mat4Compose({ rotation: { about: 'y', deg: 40 }, scale: 2 }), new Matrix4().makeRotationY(40 * RAD).scale(new Vector3(2, 2, 2)).elements)
    expect(mat4Compose()).toEqual(mat4Identity())
  })

  test('multiply and invert match three.js; inverse really inverts', () => {
    const random = lcg(4)
    for (let i = 0; i < 20; i++) {
      const a = mat4Compose({ position: [random(), random(), random()], rotation: [random() * 360, random() * 360, random() * 360], scale: [1 + random(), 1 + random(), 1 + random()] })
      const b = mat4Compose({ position: [random(), random(), random()], rotation: { about: [random(), random(), 1], deg: random() * 360 }, scale: 0.3 + random() })
      const ta = new Matrix4().fromArray(a), tb = new Matrix4().fromArray(b)
      expectClose(mat4Multiply(a, b), new Matrix4().multiplyMatrices(ta, tb).elements, 1e-11)
      const inverse = mat4Invert(a)
      expect(inverse).not.toBeNull()
      expectClose(inverse!, ta.clone().invert().elements, 1e-11)
      expectClose(mat4Multiply(a, inverse!), mat4Identity(), 1e-11)
    }
  })

  test('multiply and invert accept an aliased output', () => {
    const a = mat4Compose({ position: [1, 2, 3], rotation: [10, 20, 30], scale: 2 })
    const b = mat4Compose({ position: [-1, 0, 4], rotation: [50, 0, 5] })
    const product = mat4Multiply(a, b)
    const inPlace = mat4Copy(a)
    mat4Multiply(inPlace, b, inPlace)
    expectClose(inPlace, product)
    const inverse = mat4Invert(a)!
    const self = mat4Copy(a)
    mat4Invert(self, self)
    expectClose(self, inverse)
  })

  test('invert returns null for singular or non-finite matrices instead of throwing', () => {
    expect(mat4Invert(mat4FromScale([1, 0, 1]))).toBeNull()
    expect(mat4Invert(mat4FromScale(Number.NaN))).toBeNull()
    expect(mat4Invert(mat4FromTranslation([Infinity, 0, 0]))).toBeNull()
  })

  test('points get translation, vectors do not, directions come back unit length', () => {
    const m = mat4Compose({ position: [5, 6, 7], rotation: { about: 'z', deg: 90 }, scale: 2 })
    expect(transformPoint(m, [1, 0, 0]).map(v => v + 0)).toEqual([5, 8, 7])
    expect(transformVector(m, [1, 0, 0]).map(v => v + 0)).toEqual([0, 2, 0])
    expect(transformDirection(m, [3, 0, 0]).map(v => v + 0)).toEqual([0, 1, 0])
    expect(transformDirection(m, [0, 0, 0])).toEqual([0, 0, 0])
    const p: Vec3 = [1, 0, 0]
    expect(transformPoint(m, p, p)).toBe(p)
    expect(p.map(v => v + 0)).toEqual([5, 8, 7])
    expectClose(mat4Scale(mat4Compose({ rotation: [12, 34, 56], scale: [2, 3, 4] })), [2, 3, 4])
  })

  test('mat4AlignY turns the +Y axis onto the requested axis', () => {
    expect(transformVector(mat4AlignY('y'), [0, 1, 0])).toEqual([0, 1, 0])
    expect(transformVector(mat4AlignY('x'), [0, 1, 0]).map(v => v + 0)).toEqual([1, 0, 0])
    expect(transformVector(mat4AlignY('z'), [0, 1, 0]).map(v => v + 0)).toEqual([0, 0, 1])
    expectClose(transformVector(mat4AlignY([0, -2, 0]), [0, 1, 0]), [0, -1, 0])
    const axis: Vec3 = [1, 2, -3]
    const length = Math.hypot(...axis)
    expectClose(transformVector(mat4AlignY(axis), [0, 1, 0]), [axis[0] / length, axis[1] / length, axis[2] / length])
    expect(mat4AlignY([0, 0, 0])).toEqual(mat4Identity())
  })
})
