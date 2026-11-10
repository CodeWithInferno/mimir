// Camera model for the 3D panel: an orbit pose, named views, auto-fit and projection. Pure maths (no three.js),
// so projection, OFF-FRAME checks and label anchoring work without a GPU. r3d applies the same pose to three.
import { closeConfigGroup, liveConfig } from './config.ts'
import { add, boxCenter, cross, DEG, dot, emptyBox, expand, lerp, lerp3, mul, norm, sub, type Vec3 } from './math.ts'

export interface Pose {
  /** point the camera looks at */
  target: Vec3
  /** degrees around the y axis, 0 = looking from +z (front), 90 = from +x (side) */
  azimuth: number
  /** degrees above the horizon, 90 = straight down */
  elevation: number
  distance: number
  /** vertical field of view, degrees */
  fov: number
}
export const DEFAULT_FOV = 30
export const VIEWS: Record<string, { azimuth: number; elevation: number }> = {
  iso: { azimuth: 35, elevation: 24 },
  front: { azimuth: 0, elevation: 0 },
  back: { azimuth: 180, elevation: 0 },
  side: { azimuth: 90, elevation: 0 },
  right: { azimuth: 90, elevation: 0 },
  left: { azimuth: -90, elevation: 0 },
  top: { azimuth: 0, elevation: 90 },
  bottom: { azimuth: 0, elevation: -90 },
}
/** Defaults of the 3D camera, read through the config store ('camera.fov' …). */
export const CAMERA_DEFAULTS = liveConfig('camera', {
  /** vertical field of view, degrees */
  fov: DEFAULT_FOV,
  /** the named view the camera looks from until a step says otherwise: iso, front, back, side, left, right, top, bottom */
  view: 'iso',
  /** share of the 3D panel the model fills when the camera fits it on its own */
  fill: 0.8,
  /** share of the panel the named parts fill with st.camera({ fit: [parts] }) */
  fitFill: 0.6,
}, { min: 0.05, oneOf: { view: Object.keys(VIEWS) } })
closeConfigGroup('camera')

export interface Basis { eye: Vec3; right: Vec3; up: Vec3; back: Vec3 }
/** Camera frame of a pose. `back` points from the target to the eye. Well defined at elevation ±90 too. */
export function basisOf(p: Pose): Basis {
  const az = p.azimuth * DEG, el = p.elevation * DEG
  const back: Vec3 = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)]
  const right: Vec3 = [Math.cos(az), 0, -Math.sin(az)]
  const up = norm(cross(back, right))
  return { eye: add(p.target, mul(back, p.distance)), right, up, back }
}

export interface Projected { /** normalised device coordinates, −1..1 inside the panel */ x: number; y: number; /** distance in front of the eye along the view axis (≤ 0 = behind) */ depth: number }
export function projectWith(b: Basis, fov: number, aspect: number, p: Vec3): Projected {
  const v = sub(p, b.eye)
  const depth = -dot(v, b.back)
  const k = Math.tan((fov * DEG) / 2)
  const d = depth > 1e-9 ? depth : 1e-9
  return { x: dot(v, b.right) / (d * k * aspect), y: dot(v, b.up) / (d * k), depth }
}

/** Target and distance that frame a set of world points from a given direction. `fill` = share of the panel used. */
export function fitPose(points: readonly Vec3[], azimuth: number, elevation: number, fov: number, aspect: number, fill: number = CAMERA_DEFAULTS.fill): Pose {
  const box = emptyBox()
  for (const p of points) if (Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2])) expand(box, p)
  if (!(box.min[0] <= box.max[0])) return { target: [0, 0, 0], azimuth, elevation, distance: 10, fov }
  let target = boxCenter(box)
  const radius = Math.max(1e-3, Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]) / 2)
  const half = (fov * DEG) / 2
  const halfMin = Math.atan(Math.tan(half) * Math.min(1, aspect))
  let distance = radius / Math.sin(halfMin)
  // tighten: centre the projected extent, then scale the distance so the largest extent fills `fill` of the panel
  for (let i = 0; i < 4; i++) {
    const b = basisOf({ target, azimuth, elevation, distance, fov })
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (const p of points) {
      const q = projectWith(b, fov, aspect, p)
      if (q.x < x0) x0 = q.x
      if (q.x > x1) x1 = q.x
      if (q.y < y0) y0 = q.y
      if (q.y > y1) y1 = q.y
    }
    if (!Number.isFinite(x0)) break
    const k = Math.tan(half)
    // shift the target so the projected box is centred (in the view plane through the target)
    const cx = ((x0 + x1) / 2) * distance * k * aspect, cy = ((y0 + y1) / 2) * distance * k
    target = add(target, add(mul(b.right, cx), mul(b.up, cy)))
    const m = Math.max((x1 - x0) / 2, (y1 - y0) / 2)
    if (m > 1e-6) distance = Math.max(distance * (m / fill), radius * 1.05)
  }
  return { target, azimuth, elevation, distance: Math.max(distance, radius * 1.02), fov }
}

const wrap180 = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180
export function lerpPose(a: Pose, b: Pose, u: number): Pose {
  return {
    target: lerp3(a.target, b.target, u),
    azimuth: a.azimuth + wrap180(b.azimuth - a.azimuth) * u,
    elevation: lerp(a.elevation, b.elevation, u),
    distance: Math.exp(lerp(Math.log(Math.max(a.distance, 1e-6)), Math.log(Math.max(b.distance, 1e-6)), u)),
    fov: lerp(a.fov, b.fov, u),
  }
}
export const poseOk = (p: Pose): boolean => p.target.every(Number.isFinite) && Number.isFinite(p.azimuth) && Number.isFinite(p.elevation) && p.distance > 0 && Number.isFinite(p.distance) && p.fov > 0 && p.fov < 179
