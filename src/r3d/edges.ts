// Line work of the 3D look, as pure geometry (plain arrays in, plain arrays out; no three.js): crease and boundary
// edges of a triangle mesh, seam removal, the crowding measure, the outline of a section plane, and creased shading
// normals. Ported from the look-dev reference (docs/LOOK.md section 4.1 and 5.3).

type Num = ArrayLike<number>

export interface CreaseEdges {
  /** 6 numbers per segment: start xyz, end xyz */
  segs: number[]
  /** 6 numbers per segment: the normals of the two faces that meet there (a boundary edge stores n and -n) */
  norms: number[]
  /** every edge is shared by exactly two faces: a closed solid, which can get a section cap */
  closed: boolean
}

const WELD = 1e4
/** Vertices welded by position: per input vertex the id of its welded point, and the welded points (xyz flat). */
function weld(positions: Num): { vid: Int32Array; P: number[] } {
  const count = Math.floor(positions.length / 3)
  const map = new Map<string, number>(), vid = new Int32Array(count), P: number[] = []
  for (let i = 0; i < count; i++) {
    const x = positions[3 * i]!, y = positions[3 * i + 1]!, z = positions[3 * i + 2]!
    const key = `${Math.round(x * WELD)},${Math.round(y * WELD)},${Math.round(z * WELD)}`
    let id = map.get(key)
    if (id === undefined) { id = P.length / 3; map.set(key, id); P.push(x, y, z) }
    vid[i] = id
  }
  return { vid, P }
}

/**
 * Crease and boundary edges of a triangle mesh, welded by position. An edge is emitted when its two faces differ by
 * more than `creaseDeg`, and always when it has one face only. `index` may be null (a triangle soup).
 */
export function creaseEdges(positions: Num, index: Num | null, creaseDeg: number): CreaseEdges {
  const cosT = Math.cos((creaseDeg * Math.PI) / 180)
  const { vid, P } = weld(positions)
  const edges = new Map<number, [number, number, number, number, number] | null>()
  const segs: number[] = [], norms: number[] = []
  const emit = (u: number, w: number, a: number, b: number, c: number, d: number, e: number, f: number): void => {
    segs.push(P[3 * u]!, P[3 * u + 1]!, P[3 * u + 2]!, P[3 * w]!, P[3 * w + 1]!, P[3 * w + 2]!)
    norms.push(a, b, c, d, e, f)
  }
  const n = index ? index.length : vid.length
  const tri = [0, 0, 0]
  let many = false
  for (let t = 0; t + 2 < n; t += 3) {
    for (let k = 0; k < 3; k++) tri[k] = vid[index ? index[t + k]! : t + k]!
    const a = tri[0]!, b = tri[1]!, c = tri[2]!
    if (a === b || b === c || c === a) continue
    const ux = P[3 * b]! - P[3 * a]!, uy = P[3 * b + 1]! - P[3 * a + 1]!, uz = P[3 * b + 2]! - P[3 * a + 2]!
    const wx = P[3 * c]! - P[3 * a]!, wy = P[3 * c + 1]! - P[3 * a + 1]!, wz = P[3 * c + 2]! - P[3 * a + 2]!
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx
    const len = Math.hypot(nx, ny, nz)
    if (len < 1e-14) continue
    nx /= len; ny /= len; nz /= len
    for (let k = 0; k < 3; k++) {
      const u = tri[k]!, w = tri[(k + 1) % 3]!
      const key = u < w ? u * 4194304 + w : w * 4194304 + u
      const e = edges.get(key)
      if (e === undefined) edges.set(key, [u, w, nx, ny, nz])
      else if (e === null) many = true // a third face on one edge: not a simple solid
      else {
        if (e[2] * nx + e[3] * ny + e[4] * nz <= cosT) emit(e[0], e[1], e[2], e[3], e[4], nx, ny, nz)
        edges.set(key, null)
      }
    }
  }
  let open = 0
  for (const e of edges.values()) if (e) { emit(e[0], e[1], e[2], e[3], e[4], -e[2], -e[3], -e[4]); open++ } // a boundary edge is always a contour
  return { segs, norms, closed: open === 0 && !many && segs.length + edges.size > 0 }
}

/**
 * Collinear segments covered an even number of times are dropped (where two solids of one part butt together their
 * coincident edges cancel) and collinear runs are merged into single long segments.
 */
export function xorSegments(segs: Num, norms: Num | null): { segs: number[]; norms: number[] } {
  interface Group { d: [number, number, number]; o: [number, number, number]; ev: [number, number, number][] }
  const groups = new Map<string, Group>()
  const Q = 2000 // 0.5e-3 units
  for (let i = 0, s = 0; i + 5 < segs.length; i += 6, s++) {
    let dx = segs[i + 3]! - segs[i]!, dy = segs[i + 4]! - segs[i + 1]!, dz = segs[i + 5]! - segs[i + 2]!
    const len = Math.hypot(dx, dy, dz)
    if (len < 1e-6) continue
    dx /= len; dy /= len; dz /= len
    const lead = Math.abs(dx) > 1e-4 ? dx : Math.abs(dy) > 1e-4 ? dy : dz
    if (lead < 0) { dx = -dx; dy = -dy; dz = -dz }
    const t0 = segs[i]! * dx + segs[i + 1]! * dy + segs[i + 2]! * dz
    const t1 = segs[i + 3]! * dx + segs[i + 4]! * dy + segs[i + 5]! * dz
    const ox = segs[i]! - dx * t0, oy = segs[i + 1]! - dy * t0, oz = segs[i + 2]! - dz * t0
    const key = `${Math.round(dx * 500)},${Math.round(dy * 500)},${Math.round(dz * 500)}|${Math.round(ox * Q)},${Math.round(oy * Q)},${Math.round(oz * Q)}`
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { d: [dx, dy, dz], o: [ox, oy, oz], ev: [] }))
    g.ev.push([Math.min(t0, t1), 1, s], [Math.max(t0, t1), -1, s])
  }
  const out: number[] = [], outN: number[] = []
  for (const g of groups.values()) {
    g.ev.sort((p, q) => p[0] - q[0] || q[1] - p[1])
    const spans: [number, number, number][] = []
    let count = 0, start = 0, src = 0
    for (const [t, delta, s] of g.ev) {
      const was = count % 2 === 1
      count += delta
      const now = count % 2 === 1
      if (now && !was) { start = t; src = s }
      else if (was && !now && t - start > 2e-4) {
        const last = spans[spans.length - 1]
        if (last && start - last[1] < 1e-5) last[1] = t; else spans.push([start, t, src])
      }
    }
    for (const [s0, s1, s] of spans) {
      out.push(g.o[0] + g.d[0] * s0, g.o[1] + g.d[1] * s0, g.o[2] + g.d[2] * s0, g.o[0] + g.d[0] * s1, g.o[1] + g.d[1] * s1, g.o[2] + g.d[2] * s1)
      if (norms) for (let k = 0; k < 6; k++) outN.push(norms[6 * s + k]!)
    }
  }
  return { segs: out, norms: outN }
}

/**
 * For every segment: the distance from its midpoint to the nearest segment that runs beside it (roughly parallel,
 * not a chain neighbour), capped. The line shader turns it into pixels to fade crowded lines.
 */
export function segmentGaps(segs: Num, cap: number): Float32Array {
  const n = Math.floor(segs.length / 6)
  const gaps = new Float32Array(n).fill(cap)
  if (n < 2 || !(cap > 0)) return gaps
  const h = cap, cells = new Map<number, number[]>()
  const cellKey = (x: number, y: number, z: number): number => (Math.floor(x / h) + 2048) * 16777216 + (Math.floor(y / h) + 2048) * 4096 + (Math.floor(z / h) + 2048)
  const dir = new Float32Array(n * 3), lens = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const o = 6 * i
    const dx = segs[o + 3]! - segs[o]!, dy = segs[o + 4]! - segs[o + 1]!, dz = segs[o + 5]! - segs[o + 2]!
    const len = Math.hypot(dx, dy, dz) || 1e-9
    lens[i] = len; dir[3 * i] = dx / len; dir[3 * i + 1] = dy / len; dir[3 * i + 2] = dz / len
    const steps = Math.min(4096, Math.max(1, Math.ceil(len / (h * 0.5))))
    let lastKey = NaN
    for (let s = 0; s <= steps; s++) {
      const k = cellKey(segs[o]! + (dx * s) / steps, segs[o + 1]! + (dy * s) / steps, segs[o + 2]! + (dz * s) / steps)
      if (k === lastKey) continue
      lastKey = k
      const list = cells.get(k)
      if (list) list.push(i); else cells.set(k, [i])
    }
  }
  for (let i = 0; i < n; i++) {
    const o = 6 * i
    const mx = (segs[o]! + segs[o + 3]!) / 2, my = (segs[o + 1]! + segs[o + 4]!) / 2, mz = (segs[o + 2]! + segs[o + 5]!) / 2
    const dx = dir[3 * i]!, dy = dir[3 * i + 1]!, dz = dir[3 * i + 2]!
    let best = cap
    for (let cx = -1; cx <= 1; cx++) for (let cy = -1; cy <= 1; cy++) for (let cz = -1; cz <= 1; cz++) {
      const list = cells.get(cellKey(mx + cx * h, my + cy * h, mz + cz * h))
      if (!list) continue
      for (const j of list) {
        if (j === i) continue
        if (Math.abs(dx * dir[3 * j]! + dy * dir[3 * j + 1]! + dz * dir[3 * j + 2]!) < 0.7) continue
        const p = 6 * j
        // closest point of segment j to the midpoint of i
        const ex = segs[p + 3]! - segs[p]!, ey = segs[p + 4]! - segs[p + 1]!, ez = segs[p + 5]! - segs[p + 2]!
        let t = ((mx - segs[p]!) * ex + (my - segs[p + 1]!) * ey + (mz - segs[p + 2]!) * ez) / (lens[j]! * lens[j]!)
        t = t < 0 ? 0 : t > 1 ? 1 : t
        const vx = segs[p]! + ex * t - mx, vy = segs[p + 1]! + ey * t - my, vz = segs[p + 2]! + ez * t - mz
        const d2 = vx * vx + vy * vy + vz * vz
        if (d2 >= best * best || d2 < 1e-10) continue
        const along = vx * dx + vy * dy + vz * dz
        if (along * along > d2 * 0.5) continue // ahead or behind on the same chain, not beside
        best = Math.sqrt(d2)
      }
    }
    gaps[i] = best
  }
  return gaps
}

/** Where a plane [nx, ny, nz, constant] crosses a triangle mesh: unordered segments (6 numbers each), in the same space. */
export function sectionSegments(positions: Num, index: Num | null, plane: readonly [number, number, number, number], out: number[] = []): number[] {
  const n = index ? index.length : Math.floor(positions.length / 3)
  const dist = (i: number): number => positions[3 * i]! * plane[0] + positions[3 * i + 1]! * plane[1] + positions[3 * i + 2]! * plane[2] + plane[3]
  const cross = (p: number, q: number, dp: number, dq: number): void => {
    const t = dp / (dp - dq)
    out.push(positions[3 * p]! + (positions[3 * q]! - positions[3 * p]!) * t, positions[3 * p + 1]! + (positions[3 * q + 1]! - positions[3 * p + 1]!) * t, positions[3 * p + 2]! + (positions[3 * q + 2]! - positions[3 * p + 2]!) * t)
  }
  for (let t = 0; t + 2 < n; t += 3) {
    const a = index ? index[t]! : t, b = index ? index[t + 1]! : t + 1, c = index ? index[t + 2]! : t + 2
    const da = dist(a), db = dist(b), dc = dist(c)
    const sa = da > 0, sb = db > 0, sc = dc > 0
    if (sa === sb && sb === sc) continue
    if (sa !== sb) cross(a, b, da, db)
    if (sb !== sc) cross(b, c, db, dc)
    if (sc !== sa) cross(c, a, dc, da)
  }
  return out
}

/**
 * Shading normals with one crease angle: every triangle corner gets the average (weighted by corner angle) of the
 * face normals around its (welded) vertex that are within `creaseDeg` of its own face. Returns a triangle soup (no index): 9 positions and
 * 9 normals per triangle. Degenerate triangles are dropped. creaseDeg 0 = every face flat.
 */
export function creasedSoup(positions: Num, index: Num | null, creaseDeg: number): { positions: Float32Array; normals: Float32Array } {
  const cosT = Math.cos((Math.min(180, Math.max(0, creaseDeg)) * Math.PI) / 180) - 1e-9
  const { vid, P } = weld(positions)
  const n = index ? index.length : vid.length
  const tris: number[] = [], faceN: number[] = [], src: number[] = [], corner: number[] = []
  const around = new Map<number, number[]>() // welded vertex → face corners (3 x face + corner)
  const angle = (o: number, p: number, q: number): number => {
    const ax = P[3 * p]! - P[3 * o]!, ay = P[3 * p + 1]! - P[3 * o + 1]!, az = P[3 * p + 2]! - P[3 * o + 2]!
    const bx = P[3 * q]! - P[3 * o]!, by = P[3 * q + 1]! - P[3 * o + 1]!, bz = P[3 * q + 2]! - P[3 * o + 2]!
    const d = (ax * bx + ay * by + az * bz) / (Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz) || 1)
    return Math.acos(d < -1 ? -1 : d > 1 ? 1 : d)
  }
  for (let t = 0; t + 2 < n; t += 3) {
    const ia = index ? index[t]! : t, ib = index ? index[t + 1]! : t + 1, ic = index ? index[t + 2]! : t + 2
    const a = vid[ia]!, b = vid[ib]!, c = vid[ic]!
    if (a === undefined || b === undefined || c === undefined || a === b || b === c || c === a) continue
    const ux = P[3 * b]! - P[3 * a]!, uy = P[3 * b + 1]! - P[3 * a + 1]!, uz = P[3 * b + 2]! - P[3 * a + 2]!
    const wx = P[3 * c]! - P[3 * a]!, wy = P[3 * c + 1]! - P[3 * a + 1]!, wz = P[3 * c + 2]! - P[3 * a + 2]!
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx
    const len = Math.hypot(nx, ny, nz)
    if (len < 1e-14) continue
    const f = faceN.length / 3
    faceN.push(nx / len, ny / len, nz / len)
    tris.push(a, b, c)
    src.push(ia, ib, ic)
    // every face counts by the angle it has at the vertex, so how a flat face was cut into triangles does not tilt the normal
    corner.push(angle(a, b, c), angle(b, c, a), angle(c, a, b))
    ;[a, b, c].forEach((v, k) => { const list = around.get(v); if (list) list.push(3 * f + k); else around.set(v, [3 * f + k]) })
  }
  const count = tris.length / 3
  const outP = new Float32Array(count * 9), outN = new Float32Array(count * 9)
  for (let f = 0; f < count; f++) {
    const fx = faceN[3 * f]!, fy = faceN[3 * f + 1]!, fz = faceN[3 * f + 2]!
    for (let k = 0; k < 3; k++) {
      const v = tris[3 * f + k]!, s = src[3 * f + k]!
      let nx = 0, ny = 0, nz = 0
      for (const gc of around.get(v)!) {
        const g = Math.floor(gc / 3), w = corner[gc]!
        const gx = faceN[3 * g]!, gy = faceN[3 * g + 1]!, gz = faceN[3 * g + 2]!
        if (g === f || fx * gx + fy * gy + fz * gz >= cosT) { nx += gx * w; ny += gy * w; nz += gz * w }
      }
      if (nx === 0 && ny === 0 && nz === 0) { nx = fx; ny = fy; nz = fz }
      const len = Math.hypot(nx, ny, nz) || 1
      const o = 9 * f + 3 * k
      // the author's own position (not the welded one): welding is only for finding neighbours
      outP[o] = positions[3 * s]!; outP[o + 1] = positions[3 * s + 1]!; outP[o + 2] = positions[3 * s + 2]!
      outN[o] = nx / len; outN[o + 1] = ny / len; outN[o + 2] = nz / len
    }
  }
  return { positions: outP, normals: outN }
}

/** Everything the line pass needs for one mesh: merged crease segments, their face normals, crowding, closedness. */
export function meshLines(positions: Num, index: Num | null, creaseDeg: number, gapCap: number): { segs: Float32Array; norms: Float32Array; gaps: Float32Array; closed: boolean } {
  const e = creaseEdges(positions, index, creaseDeg)
  const merged = xorSegments(e.segs, e.norms)
  return { segs: new Float32Array(merged.segs), norms: new Float32Array(merged.norms), gaps: segmentGaps(merged.segs, gapCap), closed: e.closed }
}
