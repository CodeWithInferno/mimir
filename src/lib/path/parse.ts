/** SVG path data ⇄ subpaths of absolute cubic beziers. */
import { RAD, appendArc, appendLine, isLine, segmentCount, usable } from './cubic.ts'
import type { Subpath } from './cubic.ts'

interface ParseResult { subpaths: Subpath[]; error: string | null }

const isDigit = (code: number): boolean => code >= 48 && code <= 57

/** Append an SVG endpoint-parameterised arc (spec F.6.5) from (x1, y1) to (x2, y2) as cubics. */
function appendSvgArc(
  out: number[], x1: number, y1: number, radiusX: number, radiusY: number, rotationDeg: number,
  large: number, sweep: number, x2: number, y2: number,
): void {
  if (x1 === x2 && y1 === y2) return
  let rx = Math.abs(radiusX), ry = Math.abs(radiusY)
  if (rx === 0 || ry === 0) { appendLine(out, x1, y1, x2, y2); return }
  const phi = (rotationDeg % 360) * RAD
  const cosP = Math.cos(phi), sinP = Math.sin(phi)
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2
  const px = cosP * dx + sinP * dy, py = -sinP * dx + cosP * dy
  const lambda = (px * px) / (rx * rx) + (py * py) / (ry * ry)
  // radii too small to span the chord are scaled up until they just do: then the centre is the chord's midpoint
  const tight = lambda >= 1
  if (tight) { const k = Math.sqrt(lambda); rx *= k; ry *= k }
  const rx2 = rx * rx, ry2 = ry * ry
  const denominator = rx2 * py * py + ry2 * px * px
  let factor = tight || denominator === 0 ? 0 : Math.sqrt(Math.max(0, (rx2 * ry2 - denominator) / denominator))
  if (large === sweep) factor = -factor
  const cxp = (factor * rx * py) / ry, cyp = (-factor * ry * px) / rx
  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2, cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2
  const theta = Math.atan2((py - cyp) / ry, (px - cxp) / rx)
  let delta = Math.atan2((-py - cyp) / ry, (-px - cxp) / rx) - theta
  if (sweep && delta < 0) delta += 2 * Math.PI
  else if (!sweep && delta > 0) delta -= 2 * Math.PI
  appendArc(out, cx, cy, rx, ry, phi, theta, delta)
  out[out.length - 2] = x2
  out[out.length - 1] = y2
}

function parse(d: unknown): ParseResult {
  const subpaths: Subpath[] = []
  if (typeof d !== 'string') return { subpaths, error: 'path data must be a string' }
  const n = d.length
  let i = 0
  let coords: number[] | null = null
  let started = false
  let cx = 0, cy = 0, sx = 0, sy = 0 // current point, start of the current subpath
  let hx = 0, hy = 0, previous = 0   // last handle; previous: 0 none, 1 cubic, 2 quadratic
  let command = ''
  let error: string | null = null

  const skip = (): void => {
    while (i < n) {
      const code = d.charCodeAt(i)
      if (code === 32 || code === 44 || (code >= 9 && code <= 13)) i++
      else break
    }
  }
  const number = (): number => {
    skip()
    const start = i
    let code = d.charCodeAt(i)
    if (code === 43 || code === 45) i++
    let digits = 0
    while (isDigit(d.charCodeAt(i))) { i++; digits++ }
    if (d.charCodeAt(i) === 46) {
      i++
      while (isDigit(d.charCodeAt(i))) { i++; digits++ }
    }
    if (digits === 0) { i = start; return NaN }
    code = d.charCodeAt(i)
    if (code === 101 || code === 69) {
      let j = i + 1
      const sign = d.charCodeAt(j)
      if (sign === 43 || sign === 45) j++
      if (isDigit(d.charCodeAt(j))) {
        while (isDigit(d.charCodeAt(j))) j++
        i = j
      }
    }
    return +d.slice(start, i)
  }
  const flag = (): number => {
    skip()
    const code = d.charCodeAt(i)
    if (code === 48 || code === 49) { i++; return code - 48 }
    return NaN
  }
  const finish = (closed: boolean): void => {
    if (coords && coords.length > 2) subpaths.push({ coords, closed })
    coords = null
  }
  const open = (): number[] => coords ?? (coords = [cx, cy])
  const lineTo = (x: number, y: number): void => {
    appendLine(open(), cx, cy, x, y)
    cx = x; cy = y; previous = 0
  }
  const cubicTo = (x1: number, y1: number, x2: number, y2: number, x: number, y: number): void => {
    open().push(x1, y1, x2, y2, x, y)
    hx = x2; hy = y2; cx = x; cy = y; previous = 1
  }
  const quadTo = (qx: number, qy: number, x: number, y: number): void => {
    open().push(cx + ((qx - cx) * 2) / 3, cy + ((qy - cy) * 2) / 3, x + ((qx - x) * 2) / 3, y + ((qy - y) * 2) / 3, x, y)
    hx = qx; hy = qy; cx = x; cy = y; previous = 2
  }
  const close = (): void => {
    if (coords && coords.length > 2) {
      if (cx !== sx || cy !== sy) {
        const tolerance = 1e-9 * (1 + Math.abs(sx) + Math.abs(sy))
        if (Math.abs(cx - sx) <= tolerance && Math.abs(cy - sy) <= tolerance) {
          coords[coords.length - 2] = sx
          coords[coords.length - 1] = sy
        } else appendLine(coords, cx, cy, sx, sy)
      }
      finish(true)
    } else coords = null
    cx = sx; cy = sy; previous = 0
  }

  for (;;) {
    skip()
    if (i >= n) break
    const at = i
    const code = d.charCodeAt(i)
    const letter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
    if (letter) {
      const ch = d[i]
      if ('MmLlHhVvCcSsQqTtAaZz'.indexOf(ch) < 0) { error = `unknown command "${ch}" at position ${at}`; break }
      if (!started && ch !== 'M' && ch !== 'm') { error = `path data must start with M, found "${ch}"`; break }
      command = ch
      i++
      if (ch === 'Z' || ch === 'z') { close(); continue }
    } else if (!started) {
      error = 'path data must start with M'
      break
    } else if (command === 'Z' || command === 'z') {
      error = `expected a command at position ${at}`
      break
    } else if (command === 'M') command = 'L'
    else if (command === 'm') command = 'l'

    const relative = command >= 'a'
    const ox = relative ? cx : 0, oy = relative ? cy : 0
    const kind = relative ? command.toUpperCase() : command
    let a = 0, b = 0, c = 0, e = 0, f = 0, g = 0, h = 0
    if (kind === 'H' || kind === 'V') a = number()
    else if (kind === 'M' || kind === 'L' || kind === 'T') { a = number(); b = number() }
    else if (kind === 'S' || kind === 'Q') { a = number(); b = number(); c = number(); e = number() }
    else if (kind === 'C') { a = number(); b = number(); c = number(); e = number(); f = number(); g = number() }
    else { a = number(); b = number(); c = number(); e = flag(); f = flag(); g = number(); h = number() }
    if (a !== a || b !== b || c !== c || e !== e || f !== f || g !== g || h !== h) {
      skip()
      error = `expected ${kind === 'A' ? 'arc arguments (rx ry rotation large-arc sweep x y)' : 'a number'} for "${command}" at position ${i}`
      break
    }
    if (Math.abs(a) + Math.abs(b) + Math.abs(c) + Math.abs(e) + Math.abs(f) + Math.abs(g) + Math.abs(h) === Infinity) {
      error = `number out of range for "${command}" at position ${at}`
      break
    }

    if (kind === 'M') {
      finish(false)
      cx = sx = a + ox; cy = sy = b + oy
      coords = [cx, cy]
      started = true
      previous = 0
    } else if (kind === 'L') lineTo(a + ox, b + oy)
    else if (kind === 'H') lineTo(a + ox, cy)
    else if (kind === 'V') lineTo(cx, a + oy)
    else if (kind === 'C') cubicTo(a + ox, b + oy, c + ox, e + oy, f + ox, g + oy)
    else if (kind === 'S') {
      const rx = previous === 1 ? 2 * cx - hx : cx, ry = previous === 1 ? 2 * cy - hy : cy
      cubicTo(rx, ry, a + ox, b + oy, c + ox, e + oy)
    } else if (kind === 'Q') quadTo(a + ox, b + oy, c + ox, e + oy)
    else if (kind === 'T') {
      const qx = previous === 2 ? 2 * cx - hx : cx, qy = previous === 2 ? 2 * cy - hy : cy
      quadTo(qx, qy, a + ox, b + oy)
    } else {
      const x = g + ox, y = h + oy
      appendSvgArc(open(), cx, cy, a, b, c, e, f, x, y)
      cx = x; cy = y; previous = 0
    }
  }
  finish(false)
  return { subpaths, error }
}

/** Parse SVG path data (M L H V C S Q T A Z, absolute and relative) into subpaths of absolute cubic beziers; never throws, keeps what parsed before an error. */
export function parsePath(d: string): Subpath[] {
  return parse(d).subpaths
}

/** Why a path-data string is invalid ("expected a number for "L" at position 12"), or null when it parses completely. */
export function validatePath(d: string): string | null {
  return parse(d).error
}

/** Serialise subpaths to compact absolute SVG path data (M, L, C, Z) with at most `precision` decimals. */
export function toPathString(path: Subpath[], precision = 3): string {
  const subpaths = usable(path)
  const digits = precision >= 0 && precision <= 12 ? Math.round(precision) : 3
  const scale = 10 ** digits
  const fmt = (v: number): string => {
    const r = Math.round(v * scale) / scale
    return r === r && r !== Infinity && r !== -Infinity ? '' + r : '0'
  }
  let s = ''
  for (let k = 0; k < subpaths.length; k++) {
    const sp = subpaths[k]
    const c = sp.coords
    const n = segmentCount(sp)
    if (s) s += ' '
    s += 'M' + fmt(c[0]) + ' ' + fmt(c[1])
    for (let j = 0; j < n; j++) {
      const i = 6 * j
      if (isLine(c, i)) {
        // the closing straight edge is implied by Z
        if (sp.closed && j === n - 1 && n > 1) break
        s += ' L' + fmt(c[i + 6]) + ' ' + fmt(c[i + 7])
      } else {
        s += ' C' + fmt(c[i + 2]) + ' ' + fmt(c[i + 3]) + ' ' + fmt(c[i + 4]) + ' ' + fmt(c[i + 5]) + ' ' + fmt(c[i + 6]) + ' ' + fmt(c[i + 7])
      }
    }
    if (sp.closed) s += ' Z'
  }
  return s
}
