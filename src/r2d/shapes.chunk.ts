// src/r2d/shapes.chunk.ts: the drawing side of ellipse, dot, polyline, polygon, path, arc and brace (dist/mimir.shapes.js,
// loaded for scenes that use one of them). Each is drawn as ONE <path> made from the outline its kind declares, so
// what is drawn is exactly what arrows stop on, m.pointAt walks and a morph starts from.
import { defineKindBackend, INVALID_COLOR, kindOf, type MNode, type Resolved } from '../core/index.ts'
import type { Subpath } from '../lib/path/index.ts'
import type { Ctx2D } from './index.ts'

/** A path in frame units (y up) as the `d` of an SVG path in the stage's units (y down). */
export function svgPath(path: Subpath[], K: number): string {
  const n = (v: number): string => String(Math.round(v * K * 100) / 100)
  let d = ''
  for (const s of path) {
    const c = s.coords
    if (c.length < 2) continue
    d += `M${n(c[0]!)} ${n(-c[1]!)}`
    for (let i = 2; i + 5 < c.length; i += 6) d += `C${n(c[i]!)} ${n(-c[i + 1]!)} ${n(c[i + 2]!)} ${n(-c[i + 3]!)} ${n(c[i + 4]!)} ${n(-c[i + 5]!)}`
    if (s.closed) d += 'Z'
  }
  return d
}
interface PathHandle { el: SVGPathElement; key: unknown; d: string }
/** A backend that draws a kind's outline. `solid`: the shape is filled with its colour (a dot, a brace) instead of stroked. */
const outlined = (kind: string, solid = false): void => defineKindBackend<PathHandle, Ctx2D>(kind, {
  build: (_node, c) => ({ el: c.draw(c.el<SVGPathElement>('path'), 'stroke'), key: null, d: '' }),
  update(h, r: Resolved, c, node: MNode) {
    const path = kindOf(node.kind)?.outline?.(node, r, c.frame) ?? []
    // the same outline object means the same path: a parsed path string or an unchanged shape is not serialised again
    if (h.key !== path || !h.d) { h.key = path; h.d = svgPath(path, c.K) }
    c.set(h.el, { d: h.d || null })
    if (!solid) { c.paint(h.el, r, node); return }
    const color = node.invalid ? INVALID_COLOR : r.color
    const outline = !node.invalid && r.stroke ? r.stroke : null
    c.set(h.el, { fill: color, stroke: outline ?? 'none', 'stroke-width': outline ? (r.strokeWidth ?? 2) / c.zoom : null, 'stroke-linejoin': 'round' })
  },
})
outlined('ellipse')
outlined('polyline')
outlined('polygon')
outlined('path')
outlined('arc')
outlined('dot', true)
outlined('brace', true)
