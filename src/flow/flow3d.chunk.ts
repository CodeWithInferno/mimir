// src/flow/flow3d.chunk.ts: the lazy chunk 'flow3d' (dist/mimir.flow3d.js): the three.js side of the flow module.
// Particles are instanced spheres in one draw call per colour; everything goes through Ctx3D, so particles, trails
// and liquids take part in fades, focus dimming, view modes, picking and the id pass like any part.
import { BoxGeometry, BufferGeometry, CylinderGeometry, Group, SphereGeometry, type InstancedMesh, type Mesh } from 'three'
import type { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { apply, boxCenter, defineKindBackend, isNode, mix, qFromTo, type MNode, type Quat, type Vec3 } from '../core/index.ts'
import type { Ctx3D } from '../r3d/three.ts'
import { burstProgress, filledSpan, flowDefaults, gasTint, isRound, slots, trailPoints } from './index.ts'

/** the defaults of the flow module as the scene being drawn sees them (the table, or the engine's config store) */
const D = (c: Ctx3D): ReturnType<typeof flowDefaults> => flowDefaults(c.runtime.model)

interface Dots { object: Group; meshes: InstancedMesh[] }
interface DotItem { p: Vec3; s: number | Vec3; q?: Quat; /** which colour */ k: number }
/** `steps` instanced meshes, one per colour: Ctx3D gives each named material its own look. */
function makeDots(c: Ctx3D, steps: number): Dots {
  const object = new Group()
  const geometry = new SphereGeometry(0.5, 14, 10) // diameter 1: an instance's scale is its size
  const meshes = Array.from({ length: Math.max(1, steps) }, (_, k) => c.instanced(geometry, 32, { material: `dot${k}` }))
  object.add(...meshes)
  return { object, meshes }
}
function placeDots(c: Ctx3D, dots: Dots, items: readonly DotItem[], colors: readonly string[], emissive: number): void {
  dots.meshes.forEach((mesh, k) => {
    c.material(`dot${k}`, { color: colors[Math.min(k, colors.length - 1)] ?? D(c).color, emissive, roughness: 1, metalness: 0 })
    c.place(mesh, items.filter((it) => it.k === k))
  })
}
const UP: Vec3 = [0, 1, 0]
/** a particle stretched back along its direction of travel by `tail` (the sphere's y axis is turned onto the direction) */
const stretched = (p: Vec3, dir: Vec3, size: number, tail: number): Pick<DotItem, 'p' | 's' | 'q'> =>
  tail > 0 ? { p: [p[0] - dir[0] * tail * 0.5, p[1] - dir[1] * tail * 0.5, p[2] - dir[2] * tail * 0.5], s: [size, size + tail, size], q: qFromTo(UP, dir) } : { p, s: size }

defineKindBackend<Dots, Ctx3D>('flow3d', {
  build: (_node, c) => makeDots(c, D(c).colorSteps),
  update(dots, r, c, node) {
    const state = slots.flowState?.(node, c.frame)
    if (!state) { placeDots(c, dots, [], [r.color], 0); return }
    // a colour that varies along the path is drawn in steps: one draw call per step
    const steps = typeof r.colorAlong === 'function' ? dots.meshes.length : 1
    const colors = Array.from({ length: steps }, (_, k) => state.colorAt((k + 0.5) / steps))
    const items: DotItem[] = []
    for (const p of state.particles) {
      const size = r.size * p.size * p.alpha // particles shrink to nothing where a 2D one would fade
      if (size > 1e-5) items.push({ ...stretched(p.p, p.dir, size, r.tail * p.speed * p.alpha), k: Math.min(steps - 1, Math.floor(p.u * steps)) })
    }
    placeDots(c, dots, items, colors, D(c).emissive * r.glow / D(c).glow)
  },
})

defineKindBackend<Dots, Ctx3D>('burst3d', {
  build: (_node, c) => makeDots(c, 1),
  update(dots, r, c, node) {
    const progress = burstProgress(r)
    const maths = slots.maths
    if (progress === null || !maths) { placeDots(c, dots, [], [r.color], 0); return }
    const at = r.at as Vec3
    const streak = r.radius * D(c).burstStreak * (1 - progress) ** 2
    const items = maths.burstParticles({ count: r.count, seed: r.seed, progress, radius: r.radius, round: true, direction: r.direction, cone: r.cone })
      .map((s): DotItem => ({ ...stretched([at[0] + s.p[0], at[1] + s.p[1], at[2] + s.p[2]], s.dir, r.size * s.size * s.alpha, streak * s.alpha), k: 0 }))
    placeDots(c, dots, items, [r.color], D(c).emissive)
  },
})

defineKindBackend<Line2, Ctx3D>('trail3d', {
  build: (_node, c) => c.line([[0, 0, 0], [0, 0, 0]], { px: true, width: D(c).trailWidth }),
  update(line, r, c, node) {
    const pts = trailPoints(node, c.frame)
    line.visible = pts.length >= 2 && r.width > 0
    if (line.visible) c.points(line, pts, { width: r.width })
  },
})

defineKindBackend<Dots, Ctx3D>('gas', {
  build: (_node, c) => makeDots(c, 1),
  update(dots, r, c, node) {
    const target = r.target as MNode | null
    const maths = slots.maths
    if (!maths || !target || !isNode(target) || target.space !== '3d' || !(r.particles > 0)) { placeDots(c, dots, [], [D(c).color], 0); return }
    const frame = c.frame
    const w = frame.world(target)
    const b = frame.localBounds(target)
    const half: Vec3 = [(b.max[0] - b.min[0]) / 2, (b.max[1] - b.min[1]) / 2, (b.max[2] - b.min[2]) / 2]
    const centre = boxCenter(b)
    const size = (r.size ?? D(c).gasParticleSize * 2 * Math.min(half[0], half[2])) * w.s
    // hotter gas moves more
    const points = maths.gasParticles({ count: r.particles, seed: r.seed, time: r.time, half, round: isRound(target, frame), agitation: r.agitation * (D(c).gasHotAgitation[0] + (D(c).gasHotAgitation[1] - D(c).gasHotAgitation[0]) * r.temperature) })
    const items = points.map((p): DotItem => ({ p: apply(w, [centre[0] + p[0], centre[1] + p[1], centre[2] + p[2]]), s: size, k: 0 }))
    // the particles are the lit grains of the gas: its colour, lifted towards white so they read against the body
    placeDots(c, dots, items, [mix(gasTint(node, frame, D(c).color), '#FFFFFF', D(c).gasParticleLift)], D(c).emissive)
  },
})

defineKindBackend<Mesh, Ctx3D>('fill3d', {
  build: (_node, c) => c.mesh(new BufferGeometry()),
  update(mesh, r, c, node) {
    const target = r.target as MNode | null
    mesh.visible = !!target && isNode(target) && (r.level > 0 || !!r.from || !!r.to)
    if (!mesh.visible || !target) return
    const frame = c.frame
    const round = r.shape === 'cylinder' || (r.shape === 'auto' && isRound(target, frame))
    c.geometry(mesh, round ? 'cylinder' : 'box', () => (round ? new CylinderGeometry(0.5, 0.5, 1, 56) : new BoxGeometry(1, 1, 1)))
    const f = filledSpan(target, frame, r as never)
    mesh.visible = f.max[1] - f.min[1] > 1e-6
    if (!mesh.visible) return
    const w = frame.world(target)
    const p = apply(w, boxCenter(f))
    mesh.position.set(p[0], p[1], p[2])
    mesh.quaternion.set(w.q[0], w.q[1], w.q[2], w.q[3])
    mesh.scale.set((f.max[0] - f.min[0]) * w.s, Math.max(1e-6, f.max[1] - f.min[1]) * w.s, (f.max[2] - f.min[2]) * w.s)
  },
})
