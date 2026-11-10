// src/flow/flow.chunk.ts: the lazy chunk 'flow' (dist/mimir.flow.js). The particle maths (./particles.ts), the
// function that resolves a flow for a frame, and the 2D backends: particles, bursts, trails and field arrows on a
// canvas layer, the fill level as clipped SVG. No three.js here, so a 2D scene with a flow never loads the 3D chunk.
import { defineKindBackend, INVALID_COLOR, isNode, mix, parseColor, type Frame, type MNode, type Resolved, type Vec3 } from '../core/index.ts'
import type { Canvas2D, Ctx2D } from '../r2d/index.ts'
import { flattenPath, toPathString, transformPath } from '../lib/path/index.ts'
import { burstProgress, callAt, fieldRegion, filledBox, FLOW_DEFAULTS, flowPoints, slots, trailPoints, type FlowState } from './index.ts'
import * as maths from './particles.ts'

slots.maths = maths

const strength = (v: unknown): number => (v === true ? 1 : typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)

/** The particles of a flow node in a frame (2D or 3D), memoised per frame: the backend and tests ask the same answer. */
function flowState(node: MNode, frame: Frame): FlowState {
  return frame.memo('flow.state' + node.uid, () => {
    const r = frame.props(node)
    const target = r.target as MNode | null
    let points: Vec3[]
    let closed = !!r.closed
    if (target && isNode(target) && node.space === '2d') {
      // the outline of the object the flow runs along: its first stroke, flattened
      const outline = frame.outline(target)
      const line = flattenPath(outline, 0.004)[0] ?? []
      points = line.map((p) => [p[0], p[1], 0] as Vec3)
      if (outline[0]?.closed) { closed = true; points.pop() }
      if (r.reverse) points.reverse()
    } else points = flowPoints(node, r, frame)
    const curve = maths.curveThrough(points, closed)
    const s = maths.stream(curve, {
      count: r.count, seed: r.seed, time: r.time, phase: r.phase, fade: r.fade, active: strength(r.active), samples: FLOW_DEFAULTS.samples, round: node.space === '3d',
      speedAt: typeof r.speedAlong === 'function' ? (u) => callAt(frame, node, r.speedAlong, [u], 0, 'speed') : () => r.speed,
      spreadAt: typeof r.spreadAlong === 'function' ? (u) => callAt(frame, node, r.spreadAlong, [u], 0, 'spread') : () => r.spread,
    })
    // an object whose call had a problem is drawn in the colour of mistakes, like every other kind
    const colorAt = node.invalid ? (): string => INVALID_COLOR : typeof r.colorAlong === 'function' ? (u: number): string => callAt(frame, node, r.colorAlong, [u], r.color as string, 'color') : (): string => r.color
    return { particles: s.particles, transit: s.transit, length: curve.length, colorAt }
  }, { particles: [], transit: Infinity, length: 0, colorAt: () => FLOW_DEFAULTS.color })
}
slots.flowState = flowState

// ── drawing dots on a canvas layer ────────────────────────────────────────────────────────────────────
interface Dot { x: number; y: number; radius: number; color: string; alpha: number; dx: number; dy: number; tail: number }
const rgb = (color: string): string => { const c = parseColor(color) ?? [1, 1, 1, 1]; return `${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)}` }
/** side of a halo sprite in pixels: a halo on screen is smaller than this, so it is only ever scaled down */
const SPRITE = 64
const sprites = new Map<number, HTMLCanvasElement>()
/**
 * The soft halo of a particle as a small picture, made once per colour (to 5 bits a channel: a halo is too faint for
 * more to show) and then stamped. A radial gradient per particle per frame costs about a hundred times as much.
 * The cache is keyed on the colour alone, so what is drawn does not depend on what was drawn before.
 */
function haloSprite(color: string): HTMLCanvasElement {
  const c = parseColor(color) ?? [1, 1, 1, 1]
  const q = (x: number): number => Math.round(Math.min(1, Math.max(0, x)) * 31)
  const key = (q(c[0]) << 10) | (q(c[1]) << 5) | q(c[2])
  let sprite = sprites.get(key)
  if (!sprite) {
    sprite = document.createElement('canvas')
    sprite.width = sprite.height = SPRITE
    const g = sprite.getContext('2d')!
    const tone = `${Math.round((q(c[0]) / 31) * 255)},${Math.round((q(c[1]) / 31) * 255)},${Math.round((q(c[2]) / 31) * 255)}`
    const half = SPRITE / 2
    const grad = g.createRadialGradient(half, half, 0, half, half, half)
    grad.addColorStop(0, `rgba(${tone},${FLOW_DEFAULTS.haloOpacity[0]})`)
    grad.addColorStop(0.45, `rgba(${tone},${FLOW_DEFAULTS.haloOpacity[1]})`)
    grad.addColorStop(1, `rgba(${tone},0)`)
    g.fillStyle = grad
    g.fillRect(0, 0, SPRITE, SPRITE)
    if (sprites.size > 1024) sprites.clear()
    sprites.set(key, sprite)
  }
  return sprite
}
/** Each particle: a soft halo, an optional tail along its direction of travel, and a bright core. */
function drawDots(g: CanvasRenderingContext2D, dots: readonly Dot[], glow: number): void {
  const base = g.globalAlpha
  const halo = FLOW_DEFAULTS.haloRadius
  for (const d of dots) {
    if (!(d.alpha > 0.004) || !(d.radius > 0)) continue
    const c = rgb(d.color)
    g.globalAlpha = base * d.alpha
    if (glow > 0) {
      const reach = d.radius * halo
      g.globalAlpha = base * d.alpha * glow
      g.drawImage(haloSprite(d.color), d.x - reach, d.y - reach, 2 * reach, 2 * reach)
      g.globalAlpha = base * d.alpha
    }
    if (d.tail > 0) {
      // a streak that tapers to nothing behind the particle
      const tx = d.x - d.dx * d.tail, ty = d.y - d.dy * d.tail
      const grad = g.createLinearGradient(d.x, d.y, tx, ty)
      grad.addColorStop(0, `rgba(${c},${FLOW_DEFAULTS.tailOpacity})`)
      grad.addColorStop(1, `rgba(${c},0)`)
      g.fillStyle = grad
      g.beginPath()
      g.moveTo(d.x - d.dy * d.radius, d.y + d.dx * d.radius)
      g.lineTo(tx, ty)
      g.lineTo(d.x + d.dy * d.radius, d.y - d.dx * d.radius)
      g.closePath()
      g.fill()
    }
    g.fillStyle = `rgb(${rgb(mix(d.color, '#FFFFFF', FLOW_DEFAULTS.coreLift))})`
    g.beginPath()
    g.arc(d.x, d.y, d.radius, 0, 2 * Math.PI)
    g.fill()
  }
  g.globalAlpha = base
}

defineKindBackend<Canvas2D, Ctx2D>('flow', {
  build: (_node, c) => c.canvas(),
  update(layer, r, c, node) {
    const g = c.begin(layer)
    const s = flowState(node, c.frame)
    drawDots(g, s.particles.map((p) => ({ x: p.p[0], y: p.p[1], radius: (r.size * p.size) / 2, color: s.colorAt(p.u), alpha: p.alpha, dx: p.dir[0], dy: p.dir[1], tail: r.tail * p.speed })), r.glow)
  },
})

defineKindBackend<Canvas2D, Ctx2D>('burst', {
  build: (_node, c) => c.canvas(),
  update(layer, r, c, node) {
    const g = c.begin(layer)
    const progress = burstProgress(r)
    if (progress === null) return
    const at = r.at as Vec3
    const color = node.invalid ? INVALID_COLOR : r.color
    const sparks = maths.burstParticles({ count: r.count, seed: r.seed, progress, radius: r.radius, round: false, direction: Array.isArray(r.direction) ? [r.direction[0], r.direction[1], 0] : null, cone: r.cone })
    // each spark trails a streak that shortens as it slows
    const streak = r.radius * FLOW_DEFAULTS.burstStreak * (1 - progress) ** 2
    drawDots(g, sparks.map((s) => ({ x: at[0] + s.p[0], y: at[1] + s.p[1], radius: (r.size * s.size) / 2, color, alpha: s.alpha, dx: s.dir[0], dy: s.dir[1], tail: streak })), r.glow)
  },
})

defineKindBackend<Canvas2D, Ctx2D>('trail', {
  build: (_node, c) => c.canvas(),
  update(layer, r, c, node) {
    const g = c.begin(layer)
    const pts = trailPoints(node, c.frame)
    if (pts.length < 2 || !(r.width > 0)) return
    const base = g.globalAlpha
    g.strokeStyle = `rgb(${rgb(node.invalid ? INVALID_COLOR : r.color)})`
    g.lineWidth = r.width * 0.01
    g.lineJoin = 'round'
    const stroke = (from: number, to: number): void => {
      g.beginPath()
      g.moveTo(pts[from]![0], pts[from]![1])
      for (let i = from + 1; i <= to; i++) g.lineTo(pts[i]![0], pts[i]![1])
      g.stroke()
    }
    if (!r.fade) { g.lineCap = 'round'; stroke(0, pts.length - 1); return }
    g.lineCap = 'butt'
    const last = pts.length - 1
    const steps = Math.min(FLOW_DEFAULTS.trailSteps, last)
    for (let k = 0; k < steps; k++) {
      const from = Math.round((k * last) / steps), to = Math.round(((k + 1) * last) / steps)
      if (to <= from) continue
      const u = (k + 1) / steps
      g.globalAlpha = base * u * u * (3 - 2 * u)
      stroke(from, to)
    }
    g.globalAlpha = base
  },
})

defineKindBackend<Canvas2D, Ctx2D>('field', {
  build: (_node, c) => c.canvas(),
  update(layer, r, c, node) {
    const g = c.begin(layer)
    if (typeof r.vector !== 'function') return
    const frame = c.frame
    const region = fieldRegion(node, r, frame)
    const arrows = maths.fieldArrows({ ...region, density: r.density, scale: r.scale, reach: FLOW_DEFAULTS.fieldReach, vector: (x, y) => callAt<readonly number[] | null>(frame, node, r.vector, [x, y], null, 'the field') })
    const base = g.globalAlpha
    const width = r.width * 0.01
    g.lineWidth = width
    g.lineCap = 'round'
    for (const a of arrows) {
      const len = Math.hypot(a.dx, a.dy)
      if (!(len > width)) continue
      const color = rgb(node.invalid ? INVALID_COLOR : typeof r.colorAlong === 'function' ? callAt(frame, node, r.colorAlong, [a.strength], r.color as string, 'color') : r.color)
      // centred on its cell; weak arrows are dimmer as well as shorter
      const x0 = a.x - a.dx / 2, y0 = a.y - a.dy / 2, x1 = a.x + a.dx / 2, y1 = a.y + a.dy / 2
      const ux = a.dx / len, uy = a.dy / len
      const head = Math.min(len * FLOW_DEFAULTS.fieldHead, width * FLOW_DEFAULTS.fieldHeadWidths)
      g.globalAlpha = base * (FLOW_DEFAULTS.fieldFaint + (1 - FLOW_DEFAULTS.fieldFaint) * a.strength)
      g.strokeStyle = `rgb(${color})`
      g.fillStyle = `rgb(${color})`
      g.beginPath()
      g.moveTo(x0, y0)
      g.lineTo(x1 - ux * head * 0.8, y1 - uy * head * 0.8)
      g.stroke()
      g.beginPath()
      g.moveTo(x1, y1)
      g.lineTo(x1 - ux * head - uy * head * 0.5, y1 - uy * head + ux * head * 0.5)
      g.lineTo(x1 - ux * head + uy * head * 0.5, y1 - uy * head - ux * head * 0.5)
      g.closePath()
      g.fill()
    }
    g.globalAlpha = base
  },
})

// ── fill level of a 2D shape: a rectangle clipped to the shape's outline, and a line at the surface ──────────────────
interface FillHandle { g: SVGGElement; shape: SVGPathElement; body: SVGRectElement; top: SVGLineElement }
defineKindBackend<FillHandle, Ctx2D>('fill', {
  build(_node, c) {
    const id = c.uid('fill')
    const clip = c.el('clipPath', { id, clipPathUnits: 'userSpaceOnUse' })
    const shape = c.el<SVGPathElement>('path')
    clip.appendChild(shape)
    c.defs.appendChild(clip)
    const g = c.el<SVGGElement>('g', { 'clip-path': `url(#${id})` })
    const body = c.draw(c.el<SVGRectElement>('rect', { stroke: 'none' }), 'fill')
    const top = c.draw(c.el<SVGLineElement>('line', { 'stroke-linecap': 'butt' }), 'fill')
    g.append(body, top)
    return { g, shape, body, top }
  },
  update(h, r: Resolved, c, node) {
    const target = r.target as MNode | null
    if (!target || !isNode(target)) return
    const K = c.K
    // SVG y points down: flip the outline, which is in frame coordinates
    c.set(h.shape, { d: toPathString(transformPath(c.frame.outline(target), [K, 0, 0, -K, 0, 0]), 2) })
    const f = filledBox(c.frame.boxIn(node, target), r.level, r.from)
    const empty = !(r.level > 0)
    const color = node.invalid ? INVALID_COLOR : r.color
    c.set(h.body, { x: f.min[0] * K, y: -f.max[1] * K, width: Math.max(0, f.max[0] - f.min[0]) * K, height: Math.max(0, f.max[1] - f.min[1]) * K, fill: color, 'fill-opacity': r.fillOpacity, display: empty ? 'none' : null })
    // the surface: the edge of the filled part that is not a wall
    const edge = r.from === 'top' ? [f.min[0], f.min[1], f.max[0], f.min[1]] : r.from === 'left' ? [f.max[0], f.min[1], f.max[0], f.max[1]] : r.from === 'right' ? [f.min[0], f.min[1], f.min[0], f.max[1]] : [f.min[0], f.max[1], f.max[0], f.max[1]]
    c.set(h.top, { x1: edge[0]! * K, y1: -edge[1]! * K, x2: edge[2]! * K, y2: -edge[3]! * K, stroke: mix(color, '#FFFFFF', FLOW_DEFAULTS.surfaceLift), 'stroke-width': FLOW_DEFAULTS.surfaceWidth, display: empty || !r.surface || r.level >= 1 ? 'none' : null })
  },
  dispose(h) { h.shape.parentElement?.remove() },
})
