/**
 * Tiny 4x4 matrix helpers for the solids library.
 * Matrices are column-major `number[16]` (same layout as three.js `Matrix4.elements` and WebGL):
 * translation lives in elements 12, 13, 14. Angles are degrees. Nothing here allocates unless it returns a new value.
 */
import type { Vec3 } from '../types.ts'

/** Column-major 4x4 matrix, 16 numbers (three.js `Matrix4.elements` layout). */
export type Mat4 = number[]
/** Name of a coordinate axis. */
export type Axis = 'x' | 'y' | 'z'
/** Rotation by `deg` degrees about a named axis or an arbitrary vector (same shape as `p.rotate({ about, deg })`). */
export interface AxisAngle { about: Axis | Vec3; deg: number }
/** Parts of a rigid/scaled transform; applied as translate * rotate * scale. */
export interface TransformParts {
  position?: Vec3
  /** Euler degrees `[x, y, z]` (three.js 'XYZ' order) or an axis-angle. */
  rotation?: Vec3 | AxisAngle
  scale?: number | Vec3
}

const RAD = Math.PI / 180

/** Cosine of an angle in degrees, exact at multiples of 90. */
function cosd(deg: number): number {
  const q = deg / 90
  if (Number.isInteger(q)) { const k = ((q % 4) + 4) % 4; return k === 0 ? 1 : k === 2 ? -1 : 0 }
  return Math.cos(deg * RAD)
}
/** Sine of an angle in degrees, exact at multiples of 90. */
function sind(deg: number): number {
  const q = deg / 90
  if (Number.isInteger(q)) { const k = ((q % 4) + 4) % 4; return k === 1 ? 1 : k === 3 ? -1 : 0 }
  return Math.sin(deg * RAD)
}

/** Returns a new identity matrix. */
export function mat4Identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

/** Returns a copy of `m` (or copies `m` into `out`). */
export function mat4Copy(m: ArrayLike<number>, out: Mat4 = new Array<number>(16)): Mat4 {
  for (let i = 0; i < 16; i++) out[i] = m[i] as number
  return out
}

/** Translation matrix. */
export function mat4FromTranslation(position: Vec3): Mat4 {
  const m = mat4Identity()
  m[12] = position[0]; m[13] = position[1]; m[14] = position[2]
  return m
}

/** Scale matrix from one factor or per-axis factors. */
export function mat4FromScale(scale: number | Vec3): Mat4 {
  const m = mat4Identity()
  if (typeof scale === 'number') { m[0] = scale; m[5] = scale; m[10] = scale } else { m[0] = scale[0]; m[5] = scale[1]; m[10] = scale[2] }
  return m
}

/** Rotation by `deg` degrees about a named axis or an arbitrary (non-zero) vector, right-handed. */
export function mat4FromAxisAngle(about: Axis | Vec3, deg: number): Mat4 {
  let x = 0, y = 0, z = 0
  if (about === 'x') x = 1
  else if (about === 'y') y = 1
  else if (about === 'z') z = 1
  else {
    const len = Math.hypot(about[0], about[1], about[2])
    if (!(len > 0)) return mat4Identity()
    x = about[0] / len; y = about[1] / len; z = about[2] / len
  }
  const c = cosd(deg), s = sind(deg), t = 1 - c
  return [
    t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0,
    t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
    t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0,
    0, 0, 0, 1,
  ]
}

/** Rotation from Euler degrees about x, y, z in three.js 'XYZ' order (matrix = Rx * Ry * Rz). */
export function mat4FromEuler(xDeg: number, yDeg: number, zDeg: number): Mat4 {
  const a = cosd(xDeg), b = sind(xDeg), c = cosd(yDeg), d = sind(yDeg), e = cosd(zDeg), f = sind(zDeg)
  const ae = a * e, af = a * f, be = b * e, bf = b * f
  return [
    c * e, af + be * d, bf - ae * d, 0,
    -c * f, ae - bf * d, be + af * d, 0,
    d, -b * c, a * c, 0,
    0, 0, 0, 1,
  ]
}

/** Rotation that maps the local +Y axis onto `axis` (the revolved primitives here are all Y-axis aligned). */
export function mat4AlignY(axis: Axis | Vec3): Mat4 {
  if (axis === 'y') return mat4Identity()
  if (axis === 'x') return mat4FromAxisAngle('z', -90)
  if (axis === 'z') return mat4FromAxisAngle('x', 90)
  const len = Math.hypot(axis[0], axis[1], axis[2])
  if (!(len > 0)) return mat4Identity()
  const x = axis[0] / len, y = axis[1] / len, z = axis[2] / len
  // rotation axis = Y x target = (z, 0, -x); angle = acos(y)
  const s = Math.hypot(x, z)
  if (s < 1e-12) return y > 0 ? mat4Identity() : mat4FromAxisAngle('x', 180)
  return mat4FromAxisAngle([z, 0, -x], Math.atan2(s, y) / RAD)
}

/** Builds translate * rotate * scale from optional position, rotation (Euler degrees or axis-angle) and scale. */
export function mat4Compose(parts: TransformParts = {}): Mat4 {
  const r = parts.rotation
  const m = !r ? mat4Identity() : Array.isArray(r) ? mat4FromEuler(r[0], r[1], r[2]) : mat4FromAxisAngle(r.about, r.deg)
  const s = parts.scale
  if (s !== undefined) {
    const sx = typeof s === 'number' ? s : s[0], sy = typeof s === 'number' ? s : s[1], sz = typeof s === 'number' ? s : s[2]
    m[0]! *= sx; m[1]! *= sx; m[2]! *= sx
    m[4]! *= sy; m[5]! *= sy; m[6]! *= sy
    m[8]! *= sz; m[9]! *= sz; m[10]! *= sz
  }
  const p = parts.position
  if (p) { m[12] = p[0]; m[13] = p[1]; m[14] = p[2] }
  return m
}

/** Matrix product `a * b` (apply `b` first, then `a`). `out` may alias `a` or `b`. */
export function mat4Multiply(a: ArrayLike<number>, b: ArrayLike<number>, out: Mat4 = new Array<number>(16)): Mat4 {
  const a00 = a[0]!, a10 = a[1]!, a20 = a[2]!, a30 = a[3]!
  const a01 = a[4]!, a11 = a[5]!, a21 = a[6]!, a31 = a[7]!
  const a02 = a[8]!, a12 = a[9]!, a22 = a[10]!, a32 = a[11]!
  const a03 = a[12]!, a13 = a[13]!, a23 = a[14]!, a33 = a[15]!
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4]!, b1 = b[c * 4 + 1]!, b2 = b[c * 4 + 2]!, b3 = b[c * 4 + 3]!
    const r0 = a00 * b0 + a01 * b1 + a02 * b2 + a03 * b3
    const r1 = a10 * b0 + a11 * b1 + a12 * b2 + a13 * b3
    const r2 = a20 * b0 + a21 * b1 + a22 * b2 + a23 * b3
    const r3 = a30 * b0 + a31 * b1 + a32 * b2 + a33 * b3
    out[c * 4] = r0; out[c * 4 + 1] = r1; out[c * 4 + 2] = r2; out[c * 4 + 3] = r3
  }
  return out
}

/** Inverse of `m`, or `null` when `m` is singular or contains non-finite numbers. `out` may alias `m`. */
export function mat4Invert(m: ArrayLike<number>, out: Mat4 = new Array<number>(16)): Mat4 | null {
  const a00 = m[0]!, a01 = m[1]!, a02 = m[2]!, a03 = m[3]!
  const a10 = m[4]!, a11 = m[5]!, a12 = m[6]!, a13 = m[7]!
  const a20 = m[8]!, a21 = m[9]!, a22 = m[10]!, a23 = m[11]!
  const a30 = m[12]!, a31 = m[13]!, a32 = m[14]!, a33 = m[15]!
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
  if (!Number.isFinite(det) || det === 0) return null
  const k = 1 / det
  if (!Number.isFinite(k)) return null
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * k
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * k
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * k
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * k
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * k
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * k
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * k
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * k
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * k
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * k
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * k
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * k
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * k
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * k
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * k
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * k
  return out
}

/** Transforms a point (w = 1): rotation, scale and translation apply. `out` may alias `p`. */
export function transformPoint(m: ArrayLike<number>, p: Vec3, out: Vec3 = [0, 0, 0]): Vec3 {
  const x = p[0], y = p[1], z = p[2]
  out[0] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!
  out[1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!
  out[2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!
  return out
}

/** Transforms a vector (w = 0): rotation and scale apply, translation does not; length is NOT normalised. */
export function transformVector(m: ArrayLike<number>, v: Vec3, out: Vec3 = [0, 0, 0]): Vec3 {
  const x = v[0], y = v[1], z = v[2]
  out[0] = m[0]! * x + m[4]! * y + m[8]! * z
  out[1] = m[1]! * x + m[5]! * y + m[9]! * z
  out[2] = m[2]! * x + m[6]! * y + m[10]! * z
  return out
}

/** Transforms a direction (w = 0) and normalises the result to unit length (a zero vector stays zero). */
export function transformDirection(m: ArrayLike<number>, d: Vec3, out: Vec3 = [0, 0, 0]): Vec3 {
  transformVector(m, d, out)
  const len = Math.hypot(out[0], out[1], out[2])
  if (len > 0) { out[0] /= len; out[1] /= len; out[2] /= len }
  return out
}

/** Per-axis scale factors of `m` (lengths of its three basis columns). */
export function mat4Scale(m: ArrayLike<number>): Vec3 {
  return [Math.hypot(m[0]!, m[1]!, m[2]!), Math.hypot(m[4]!, m[5]!, m[6]!), Math.hypot(m[8]!, m[9]!, m[10]!)]
}

/** Translation part of `m`. */
export function mat4Position(m: ArrayLike<number>): Vec3 {
  return [m[12]!, m[13]!, m[14]!]
}
